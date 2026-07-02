"""
Attendance policy computation.

Hardcoded CS10 policy (the policy is mature; reconfigurable later if needed):

  Lecture
    - iClicker section title contains "Lecture"
    - Friday sessions don't count (only Mon/Wed required)
    - Makeup: Gradescope assignment titled "Lecture Quiz N" (ordinal-matched)
    - Drop lowest 5

  Lab
    - iClicker section title contains "Lab"
    - Lab 1 is excluded (no attendance grade per policy)
    - Makeup: full credit on Gradescope assignment titled "Lab N"
    - Drop lowest 5

  Discussion
    - iClicker section title contains "Discussion"
    - Makeup: Gradescope "Discussion N" or "Worksheet N" (ordinal-matched)
    - Drop lowest 1

For each (student, session) we compute attended := iClicker(PRESENT|EXCUSED)
OR makeup_submission has full credit (>= 99.9%). Sessions with no makeup option
configured (e.g. all of them by default for lab, since labs are themselves the
makeup) just rely on iClicker.

Final percentage = max(0, attended_after_drops) / (total - drops) * 100.
"""
from __future__ import annotations

import re
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from .models import (
    Assignment,
    Student,
    Submission,
    StudentAttendanceEffectiveScore,
)

logger = logging.getLogger(__name__)

# ----- Hardcoded policy constants -----------------------------------------
LECTURE_DROPS = 5
LAB_DROPS = 5
DISCUSSION_DROPS = 1

LAB_SKIP_FIRST_N = 0            # Lab 1 already absent from iClicker data; don't double-skip
LECTURE_SKIP_FRIDAY = True      # Friday lectures are optional

# A makeup counts if the student earned at least this fraction of full credit.
MAKEUP_FULL_CREDIT_THRESHOLD = 0.999

# iClicker statuses that count as "attended"
_PRESENT_STATUSES = {"PRESENT", "EXCUSED", "P", "E"}

# How to recognise an iClicker section by its Assignment.title
_KIND_PATTERNS = [
    ("lecture", re.compile(r"\blecture\b", re.IGNORECASE)),
    ("lab",        re.compile(r"\blab\b", re.IGNORECASE)),
    ("discussion", re.compile(r"\bdiscussion\b", re.IGNORECASE)),
]

# How to recognise the corresponding Gradescope makeup assignment.
# Each entry: (kind, regex with capturing group for ordinal).
_MAKEUP_PATTERNS = {
    "lecture":    re.compile(r"\blecture\s*quiz\s*(\d+)\b", re.IGNORECASE),
    "lab":        re.compile(r"\blab\s*(\d+)\b", re.IGNORECASE),
    "discussion": re.compile(r"\b(?:discussion|worksheet)\s*(\d+)\b", re.IGNORECASE),
}


def _detect_kind(title: Optional[str]) -> Optional[str]:
    if not title:
        return None
    for kind, pat in _KIND_PATTERNS:
        if pat.search(title):
            return kind
    return None


def _parse_session_date(date_label: str) -> Optional[datetime]:
    """Extract a datetime from iClicker session column headers.

    Handles formats like:
      'Class 3 - Attendance 01/27/26'
      'Sep 5, 2025'
      '9/5/2025'
      '2025-09-05'
    Returns None if no date can be found.
    """
    if not date_label:
        return None
    text = date_label.strip()

    # Pull out the first MM/DD/YY[YY] occurrence, if any.
    m = re.search(r'(\d{1,2})/(\d{1,2})/(\d{2,4})', text)
    if m:
        mm, dd, yy = m.groups()
        if len(yy) == 2:
            yy = "20" + yy
        try:
            return datetime(int(yy), int(mm), int(dd))
        except ValueError:
            pass

    # Strip prefixes like "Class 3 - Attendance "
    candidates = [text]
    for sep in (" - ", ": "):
        if sep in text:
            candidates.append(text.split(sep, 1)[1].strip())

    formats = ("%b %d, %Y", "%B %d, %Y", "%Y-%m-%d", "%b %d %Y", "%B %d %Y")
    for cand in candidates:
        for fmt in formats:
            try:
                return datetime.strptime(cand, fmt)
            except ValueError:
                continue
    return None


def _is_friday(date_label: str) -> bool:
    dt = _parse_session_date(date_label)
    return dt.weekday() == 4 if dt else False


def _to_float(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _is_full_credit(submission: Submission, assignment: Assignment) -> bool:
    score = _to_float(submission.total_score)
    if score is None:
        return False
    max_pts = (
        _to_float(submission.max_points)
        or _to_float(assignment.max_points)
    )
    if not max_pts or max_pts <= 0:
        return False
    return (score / max_pts) >= MAKEUP_FULL_CREDIT_THRESHOLD


def _build_makeup_index(
    assignments: List[Assignment],
) -> Dict[str, Dict[int, Assignment]]:
    """Return {kind: {ordinal: Assignment}} from Gradescope-style assignments.

    iClicker assignments (whose assignment_id starts with 'iclicker:') are
    excluded so we don't accidentally treat them as their own makeups.
    """
    out: Dict[str, Dict[int, Assignment]] = {"lecture": {}, "lab": {}, "discussion": {}}
    for a in assignments:
        if (a.assignment_id or "").startswith("iclicker:"):
            continue
        title = a.title or ""
        # Skip "Practice" — they're not the official makeup
        if "practice" in title.lower():
            continue
        for kind, pat in _MAKEUP_PATTERNS.items():
            m = pat.search(title)
            if m:
                try:
                    ordinal = int(m.group(1))
                except (TypeError, ValueError):
                    continue
                # First match wins; if duplicates exist (rare), keep the
                # one with the higher max_points since that's typically the
                # graded version vs a re-release.
                existing = out[kind].get(ordinal)
                if existing is None or (
                    _to_float(a.max_points) or 0
                ) > (_to_float(existing.max_points) or 0):
                    out[kind][ordinal] = a
                break
    return out


def _drops_for(kind: str) -> int:
    return {
        "lecture": LECTURE_DROPS,
        "lab": LAB_DROPS,
        "discussion": DISCUSSION_DROPS,
    }[kind]


def _process_iclicker_submission(
    kind: str,
    sub: Submission,
    makeup_by_ordinal: Dict[int, Assignment],
    submissions_by_assignment_student: Dict[Tuple[int, int], Submission],
) -> Tuple[int, int, List[Dict[str, Any]]]:
    """Compute (attended_count, total_required, per_session_details) for one student."""
    raw = sub.scores_by_question
    if not isinstance(raw, list):
        # Backwards compat: legacy dict format {date: status}
        raw = [
            {"ordinal": i, "date": k, "status": (v or "").upper()}
            for i, (k, v) in enumerate((raw or {}).items(), start=1)
        ]

    details: List[Dict[str, Any]] = []
    attended = 0
    total = 0
    counted_ordinal = 0  # ordinal among required sessions, used for makeup matching

    for entry in raw:
        ordinal = entry.get("ordinal")
        date_label = entry.get("date") or ""
        status = (entry.get("status") or "").upper()

        # --- exclusions per kind --------------------------------------
        if kind == "lecture" and LECTURE_SKIP_FRIDAY and _is_friday(date_label):
            details.append({
                "ordinal": ordinal, "date": date_label, "status": status,
                "required": False, "attended": False, "reason": "friday_optional",
            })
            continue
        if kind == "lab" and ordinal is not None and ordinal <= LAB_SKIP_FIRST_N:
            details.append({
                "ordinal": ordinal, "date": date_label, "status": status,
                "required": False, "attended": False, "reason": "lab1_excluded",
            })
            continue

        counted_ordinal += 1
        total += 1

        # --- iClicker present? ----------------------------------------
        if status in _PRESENT_STATUSES:
            attended += 1
            details.append({
                "ordinal": ordinal, "date": date_label, "status": status,
                "required": True, "attended": True, "reason": "iclicker",
            })
            continue

        # --- makeup? --------------------------------------------------
        makeup = makeup_by_ordinal.get(counted_ordinal)
        if makeup:
            mk_sub = submissions_by_assignment_student.get(
                (makeup.id, sub.student_id)
            )
            if mk_sub and _is_full_credit(mk_sub, makeup):
                attended += 1
                details.append({
                    "ordinal": ordinal, "date": date_label, "status": status,
                    "required": True, "attended": True,
                    "reason": "makeup",
                    "makeup_assignment_id": makeup.id,
                    "makeup_title": makeup.title,
                })
                continue

        details.append({
            "ordinal": ordinal, "date": date_label, "status": status,
            "required": True, "attended": False,
            "reason": "absent" if status == "ABSENT" else "no_record",
            "makeup_assignment_id": makeup.id if makeup else None,
        })

    return attended, total, details


def _attendance_policy_rules(policy: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(policy, dict):
        return {}
    rules = policy.get("rules", {})
    attendance = rules.get("attendance", {}) if isinstance(rules, dict) else {}
    return attendance if isinstance(attendance, dict) else {}


def _attendance_cap(policy: Optional[Dict[str, Any]]) -> float:
    rules = _attendance_policy_rules(policy)
    try:
        value = float(rules.get("cap", 15))
        if value > 0:
            return value
    except (TypeError, ValueError):
        pass
    for component in (policy or {}).get("components", []) if isinstance(policy, dict) else []:
        if not isinstance(component, dict):
            continue
        if str(component.get("type", "")).lower() == "attendance":
            try:
                value = float(component.get("cap", 15))
                if value > 0:
                    return value
            except (TypeError, ValueError):
                pass
    return 15


def compute_attendance_scores(session: Session, course_id: int, policy: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Compute & persist effective attendance scores for a course.

    Idempotent: re-running overwrites the matching rows in
    student_attendance_effective_scores.
    """
    assignments = session.query(Assignment).filter(
        Assignment.course_id == course_id
    ).all()
    if not assignments:
        return {"sections_processed": 0, "rows_upserted": 0}

    iclicker_assignments_by_kind: Dict[str, List[Assignment]] = {}
    for a in assignments:
        if not (a.assignment_id or "").startswith("iclicker:"):
            continue
        kind = _detect_kind(a.title)
        if kind is None:
            logger.warning("iClicker assignment %r has unrecognised kind", a.title)
            continue
        iclicker_assignments_by_kind.setdefault(kind, []).append(a)

    if not iclicker_assignments_by_kind:
        return {"sections_processed": 0, "rows_upserted": 0}

    makeup_index = _build_makeup_index(assignments)
    logger.info(
        "Makeup index for course %s: %s",
        course_id,
        {k: sorted(v.keys()) for k, v in makeup_index.items()},
    )

    # Pre-fetch all submissions for makeup assignments to avoid N+1 queries
    makeup_assignment_ids = [
        a.id for kind_map in makeup_index.values() for a in kind_map.values()
    ]
    submissions_lookup: Dict[Tuple[int, int], Submission] = {}
    if makeup_assignment_ids:
        for s in session.query(Submission).filter(
            Submission.assignment_id.in_(makeup_assignment_ids)
        ).all():
            submissions_lookup[(s.assignment_id, s.student_id)] = s

    rows_upserted = 0
    sections_processed = 0

    for kind, ic_assignments in iclicker_assignments_by_kind.items():
        # If there are multiple iClicker sections of the same kind
        # (unusual but possible), process each separately and emit one row per
        # section by overwriting kind keying — for now we just process the
        # first section per kind and warn.
        if len(ic_assignments) > 1:
            logger.warning(
                "Multiple iClicker '%s' sections found for course %s: %s. "
                "Only the first will count for attendance.",
                kind, course_id, [a.title for a in ic_assignments],
            )
        ic_assignment = ic_assignments[0]
        sections_processed += 1

        ic_submissions = session.query(Submission).filter(
            Submission.assignment_id == ic_assignment.id
        ).all()

        drops = _drops_for(kind)
        kind_makeup_index = makeup_index.get(kind, {})

        for sub in ic_submissions:
            attended, total, details = _process_iclicker_submission(
                kind=kind,
                sub=sub,
                makeup_by_ordinal=kind_makeup_index,
                submissions_by_assignment_student=submissions_lookup,
            )

            actual_drops = min(drops, max(0, total - attended), total)
            effective_attended = attended  # drops only forgive absences
            effective_total = max(0, total - actual_drops)
            # Cap effective_attended at effective_total
            effective_attended_capped = min(effective_attended, effective_total)

            raw_pct = (attended / total * 100.0) if total > 0 else None
            final_pct = (
                (effective_attended_capped / effective_total * 100.0)
                if effective_total > 0 else None
            )

            existing = session.query(StudentAttendanceEffectiveScore).filter(
                StudentAttendanceEffectiveScore.course_id == course_id,
                StudentAttendanceEffectiveScore.student_id == sub.student_id,
                StudentAttendanceEffectiveScore.kind == kind,
            ).first()

            payload = dict(
                iclicker_assignment_id=ic_assignment.id,
                total_required_sessions=total,
                attended_sessions=attended,
                drops_applied=actual_drops,
                effective_attended=effective_attended_capped,
                effective_total=effective_total,
                raw_percentage=raw_pct,
                final_percentage=final_pct,
                details={"sessions": details},
            )

            if existing:
                for k, v in payload.items():
                    setattr(existing, k, v)
            else:
                session.add(StudentAttendanceEffectiveScore(
                    course_id=course_id,
                    student_id=sub.student_id,
                    kind=kind,
                    **payload,
                ))
            rows_upserted += 1

    session.flush()

    # ---- Roll up per-kind percentages into a single 15-pt assignment -----
    rollup_stats = _write_rollup_assignment(session, course_id, drops_per_kind={
        "lecture": LECTURE_DROPS,
        "lab": LAB_DROPS,
        "discussion": DISCUSSION_DROPS,
    }, policy=policy)

    # ---- Hide raw makeup assignments from the dashboard ------------------
    # iClicker raw category was already set to '_attendance_raw' at ingest.
    # Gradescope-side Lecture Quiz / Discussion N assignments are still in
    # category 'Attendance / Participation' from the configured patterns;
    # demote those so they don't appear as separate columns.
    hidden_count = _hide_makeup_assignments(session, course_id)

    session.flush()
    logger.info(
        "Attendance policy: course=%s sections=%d rows=%d rollup=%s hidden=%d",
        course_id, sections_processed, rows_upserted, rollup_stats, hidden_count,
    )
    return {
        "sections_processed": sections_processed,
        "rows_upserted": rows_upserted,
        "rollup": rollup_stats,
        "hidden_makeup_assignments": hidden_count,
    }


# Title patterns identifying assignments that are makeup-data only and should
# not be shown as their own graded column.
_MAKEUP_TITLE_PATTERNS = (
    re.compile(r"\blecture\s*quiz\b", re.IGNORECASE),
    re.compile(r"\bdiscussion\s+\d+", re.IGNORECASE),
    re.compile(r"\bworksheet\s+\d+", re.IGNORECASE),
)


def _hide_makeup_assignments(session: Session, course_id: int) -> int:
    """Set category='_attendance_raw' on Gradescope-side makeup assignments.

    These are still useful (we read submissions from them in the policy
    computation) but should not appear as their own dashboard columns.
    """
    candidates = session.query(Assignment).filter(
        Assignment.course_id == course_id,
        Assignment.category != "_attendance_raw",
    ).all()
    n = 0
    for a in candidates:
        title = a.title or ""
        if any(p.search(title) for p in _MAKEUP_TITLE_PATTERNS):
            a.category = "_attendance_raw"
            n += 1
    return n


def _write_rollup_assignment(
    session: Session,
    course_id: int,
    drops_per_kind: Dict[str, int],
    policy: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Materialise a single 'Attendance / Participation' Assignment + per-student
    Submission carrying the policy-correct 0-15 score.

    Score: equal-weight 5 pts per kind. Each kind contributes
    `final_percentage / 100 * 5` (final_percentage is post-drop, capped at 100).
    Students with no iClicker data for a kind contribute 0 for that kind.
    """
    from .models import StudentAttendanceEffectiveScore

    title = "Attendance / Participation"
    rollup_assignment_id = "attendance_rollup:participation"
    kinds = ("lecture", "lab", "discussion")
    max_points_total = _attendance_cap(policy)
    per_kind_pts = max_points_total / max(1, len(kinds))

    rollup = session.query(Assignment).filter(
        Assignment.assignment_id == rollup_assignment_id,
        Assignment.course_id == course_id,
    ).first()
    if not rollup:
        rollup = Assignment(
            assignment_id=rollup_assignment_id,
            course_id=course_id,
            title=title,
            category="Attendance / Participation",
            max_points=max_points_total,
        )
        session.add(rollup)
        session.flush()
    else:
        rollup.title = title
        rollup.category = "Attendance / Participation"
        rollup.max_points = max_points_total

    eff_rows = session.query(StudentAttendanceEffectiveScore).filter(
        StudentAttendanceEffectiveScore.course_id == course_id
    ).all()
    by_student: Dict[int, Dict[str, Any]] = {}
    for r in eff_rows:
        by_student.setdefault(r.student_id, {})[r.kind] = r

    students_written = 0
    for student_id, kind_map in by_student.items():
        components = {}
        total = 0.0
        for kind in kinds:
            r = kind_map.get(kind)
            pct = float(r.final_percentage) if r and r.final_percentage is not None else 0.0
            pct = max(0.0, min(100.0, pct))
            pts = pct / 100.0 * per_kind_pts
            components[kind] = {
                "final_percentage": pct,
                "points": round(pts, 2),
                "attended": getattr(r, "attended_sessions", None),
                "total": getattr(r, "total_required_sessions", None),
                "drops_applied": getattr(r, "drops_applied", None),
            }
            total += pts
        total_score = round(total, 2)

        existing = session.query(Submission).filter(
            Submission.assignment_id == rollup.id,
            Submission.student_id == student_id,
        ).first()
        if existing:
            existing.total_score = total_score
            existing.max_points = max_points_total
            existing.status = "Graded"
            existing.scores_by_question = components
        else:
            session.add(Submission(
                assignment_id=rollup.id,
                student_id=student_id,
                total_score=total_score,
                max_points=max_points_total,
                status="Graded",
                scores_by_question=components,
            ))
        students_written += 1

    return {
        "rollup_assignment_id": rollup.id,
        "students_written": students_written,
        "max_points": max_points_total,
        "per_kind_pts": per_kind_pts,
    }
