"""
Lab and Project aggregation policy (CS10).

Hardcoded per syllabus:

Labs (80 pts total)
  * Each lab = its set of Gradescope items (typically Code + Conceptual,
    sometimes 1, sometimes more). All-or-nothing: full credit on EVERY
    item in the group → 1 lab credit, otherwise 0.
  * Practice exam labs (title starts with "Lab Practice" or "Practice
    Midterm" / "Practice Postterm") graded on completion (any score > 0).
  * Optional labs (title contains "Optional") are skipped.
  * Drop lowest 2 lab credits.
  * Score = passed / max(1, total_groups - 2) * 80, capped at 80.

Projects (155 pts total: P1=15, P2=25, P3=35, P4=20, Final=60)
  * Group by project number; canonicalise titles to fold RESUBMISSION
    rows back into their original sub-item, taking max(original, resub).
  * project_score = sum(max_per_subitem) / sum(max_points) * cap.
  * No drops.

Raw lab/project Assignments are demoted to '_labs_raw' / '_projects_raw'
so the dashboard shows only the rollups.
"""
from __future__ import annotations

import re
import logging
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from .models import Assignment, Student, Submission

logger = logging.getLogger(__name__)

# ------------- Default per-project caps -----------------------------------
PROJECT_CAPS = [
    ("1", "Project 1: Wordle™-lite",   15, [re.compile(r"\bproject\s*1\b", re.I)]),
    ("2", "Project 2: Spelling Bee",   25, [re.compile(r"\bproject\s*2\b", re.I)]),
    ("3", "Project 3: 2048",           35, [re.compile(r"\bproject\s*3\b", re.I)]),
    ("4", "Project 4: Explore",        20, [re.compile(r"\bproject\s*4\b", re.I)]),
    ("5", "Final Project",             60, [
        re.compile(r"\bproject\s*5\b", re.I),
        re.compile(r"\bfinal\s+project\b", re.I),
    ]),
]

LAB_DROP_LOWEST = 2
LAB_TOTAL_PTS = 80

PRACTICE_LAB_PATTERNS = (
    re.compile(r"\bpractice\s+midterm\b", re.I),
    re.compile(r"\bpractice\s+postterm\b", re.I),
    re.compile(r"\blab\s+practice\b", re.I),
)
OPTIONAL_LAB_PATTERN = re.compile(r"\boptional\b", re.I)

# Titles that look practice-related but are actually exam-prep on other
# platforms (not labs). They must never be counted as labs even if a previous
# misclassified policy run dumped them into '_labs_raw'.
NON_LAB_PREFIX_PATTERNS = (
    re.compile(r"\bprairielearn\b", re.I),
)


def _looks_like_non_lab(title: str) -> bool:
    return any(p.search(title or "") for p in NON_LAB_PREFIX_PATTERNS)

LAB_BASE_TITLE_RE = re.compile(r"\s*\((?:code|conceptual)\)\s*$", re.I)

FULL_CREDIT_THRESHOLD = 0.999

# Stale staff-test assignments tend to have a handful of submissions while
# real assignments have ~one per enrolled student. We exclude anything with
# fewer than this many submissions to avoid giving everyone an automatic
# fail on a duplicate / abandoned assignment.
MIN_SUBMISSIONS_FOR_LIVE = 20


# ----------- Helpers ------------------------------------------------------

def _to_float(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _frac(score: Any, max_pts: Any) -> Optional[float]:
    s = _to_float(score)
    m = _to_float(max_pts)
    if s is None or m is None or m <= 0:
        return None
    return s / m


def _policy_dict(policy: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    return policy if isinstance(policy, dict) else {}


def _policy_rules(policy: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    rules = _policy_dict(policy).get("rules", {})
    return rules if isinstance(rules, dict) else {}


def _lab_total_pts(policy: Optional[Dict[str, Any]]) -> float:
    rules = _policy_rules(policy).get("labs", {})
    if isinstance(rules, dict):
        try:
            value = float(rules.get("cap", LAB_TOTAL_PTS))
            if value > 0:
                return value
        except (TypeError, ValueError):
            pass

    for component in _policy_dict(policy).get("components", []) or []:
        if not isinstance(component, dict):
            continue
        if str(component.get("type", "")).lower() == "labs" or str(component.get("key", "")).lower() == "labs":
            try:
                value = float(component.get("cap", LAB_TOTAL_PTS))
                if value > 0:
                    return value
            except (TypeError, ValueError):
                pass

    return LAB_TOTAL_PTS


def _lab_drop_lowest(policy: Optional[Dict[str, Any]]) -> int:
    rules = _policy_rules(policy).get("labs", {})
    if isinstance(rules, dict):
        try:
            return max(0, int(rules.get("drop_lowest", LAB_DROP_LOWEST)))
        except (TypeError, ValueError):
            return LAB_DROP_LOWEST
    return LAB_DROP_LOWEST


def _project_caps(policy: Optional[Dict[str, Any]]) -> List[Tuple[str, str, float, List[re.Pattern]]]:
    rules = _policy_rules(policy).get("projects", {})
    items = rules.get("items", []) if isinstance(rules, dict) else []
    if not isinstance(items, list) or not items:
        return PROJECT_CAPS

    parsed: List[Tuple[str, str, float, List[re.Pattern]]] = []
    for index, item in enumerate(items, start=1):
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or index)
        label = str(item.get("label") or item.get("title") or f"Project {key}")
        try:
            cap = float(item.get("cap", 0))
        except (TypeError, ValueError):
            cap = 0
        patterns = []
        for pattern in item.get("patterns", []) or []:
            try:
                patterns.append(re.compile(str(pattern), re.I))
            except re.error:
                patterns.append(re.compile(re.escape(str(pattern)), re.I))
        if cap > 0 and patterns:
            parsed.append((key, label, cap, patterns))

    return parsed or PROJECT_CAPS


def _lab_base_title(title: str) -> str:
    """Strip '(Code)' / '(Conceptual)' suffix to get the canonical lab name."""
    return LAB_BASE_TITLE_RE.sub("", title or "").strip()


def _project_canonical(title: str) -> str:
    """Canonical sub-item key: strip RESUBMISSION markers, lowercase, alnum-only."""
    s = re.sub(r"\bresubmission\b", "", title or "", flags=re.IGNORECASE)
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _is_practice_lab(title: str) -> bool:
    return any(p.search(title or "") for p in PRACTICE_LAB_PATTERNS)


def _is_optional_lab(title: str) -> bool:
    return bool(OPTIONAL_LAB_PATTERN.search(title or ""))


def _detect_project_key(title: str, project_caps: Optional[List[Tuple[str, str, float, List[re.Pattern]]]] = None) -> Optional[str]:
    for key, _, _, patterns in (project_caps or PROJECT_CAPS):
        for p in patterns:
            if p.search(title or ""):
                return key
    return None


# ----------- Public API ---------------------------------------------------

def compute_lab_score(session: Session, course_id: int, policy: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Compute the 80-pt Labs rollup per student, write virtual Assignment+Submissions."""
    lab_total_pts = _lab_total_pts(policy)
    lab_drop_lowest = _lab_drop_lowest(policy)
    # Pull every assignment that could be a lab. We look at:
    #   - current 'Labs' category
    #   - already-hidden '_labs_raw' (re-runs)
    #   - uncategorized practice midterm/postterm labs
    candidates = session.query(Assignment).filter(
        Assignment.course_id == course_id
    ).all()

    # Pre-compute submission counts to filter stale duplicates.
    from sqlalchemy import func as _f
    sub_counts: Dict[int, int] = dict(
        session.query(Submission.assignment_id, _f.count(Submission.id))
        .filter(Submission.assignment_id.in_([a.id for a in candidates]))
        .group_by(Submission.assignment_id)
        .all()
    )

    lab_items: List[Assignment] = []
    for a in candidates:
        title = a.title or ""
        aid = a.assignment_id or ""
        # Skip our own rollups
        if aid.startswith("labs_rollup:") or aid.startswith("project_rollup:") \
                or aid.startswith("attendance_rollup:"):
            continue
        if _is_optional_lab(title):
            continue
        # Hard exclude: PrairieLearn / exam-prep titles even if mis-tagged
        # as '_labs_raw' by an earlier run.
        if _looks_like_non_lab(title):
            continue
        # Real lab if it's already in Labs / hidden Labs, OR if it's an
        # uncategorized practice exam lab (per syllabus). Items that already
        # belong to other graded categories (Midterm / Postterm / Quest /
        # Projects / Attendance) are NOT labs even if their title happens
        # to contain 'practice midterm' (e.g. "PrairieLearn Practice Midterm").
        if a.category in ("Labs", "_labs_raw"):
            if sub_counts.get(a.id, 0) >= MIN_SUBMISSIONS_FOR_LIVE:
                lab_items.append(a)
        elif a.category in (None, "Uncategorized") and _is_practice_lab(title):
            if sub_counts.get(a.id, 0) >= MIN_SUBMISSIONS_FOR_LIVE:
                lab_items.append(a)

    if not lab_items:
        logger.info("Course %s: no lab assignments found", course_id)
        return {"groups": 0, "students_written": 0}

    # Group by base title (strips '(Code)' / '(Conceptual)').
    groups: Dict[str, List[Assignment]] = defaultdict(list)
    for a in lab_items:
        groups[_lab_base_title(a.title)].append(a)

    group_keys = sorted(groups.keys())
    logger.info("Course %s: %d lab groups: %s", course_id, len(group_keys), group_keys)

    # Pre-fetch submissions for all lab assignment IDs
    lab_ids = [a.id for a in lab_items]
    sub_lookup: Dict[Tuple[int, int], Submission] = {}
    for s in session.query(Submission).filter(
        Submission.assignment_id.in_(lab_ids)
    ).all():
        sub_lookup[(s.assignment_id, s.student_id)] = s

    # All students enrolled in the course
    students = session.query(Student).filter(Student.course_id == course_id).all()

    total_groups = len(group_keys)
    drops = lab_drop_lowest
    effective_total = max(1, total_groups - drops)

    rollup_assignment = _ensure_rollup_assignment(
        session, course_id, "labs_rollup:total",
        title="Labs", category="Labs", max_points=lab_total_pts,
    )

    students_written = 0
    for stu in students:
        per_lab: List[Dict[str, Any]] = []
        for gkey in group_keys:
            assignments_in_group = groups[gkey]
            is_practice = any(_is_practice_lab(a.title) for a in assignments_in_group)
            passed = _evaluate_lab_group(stu.id, assignments_in_group, sub_lookup, is_practice)
            per_lab.append({
                "lab": gkey,
                "passed": passed,
                "is_practice": is_practice,
                "items": [{"id": a.id, "title": a.title} for a in assignments_in_group],
            })

        passed_count = sum(1 for x in per_lab if x["passed"])
        # Drop lowest 2 (i.e. drop 2 fails first; if 0 fails, drop nothing
        # changes since all passes contribute equally).
        passed_after_drop = min(passed_count, effective_total)
        score = passed_after_drop / effective_total * lab_total_pts

        _upsert_submission(
            session, rollup_assignment.id, stu.id,
            total_score=round(score, 2),
            max_points=lab_total_pts,
            scores_by_question={
                "passed_count": passed_count,
                "total_groups": total_groups,
                "drops": drops,
                "effective_total": effective_total,
                "labs": per_lab,
            },
        )
        students_written += 1

    return {
        "groups": total_groups,
        "students_written": students_written,
        "drops": drops,
        "effective_total": effective_total,
    }


def compute_project_scores(session: Session, course_id: int, policy: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Compute one rollup per project (5 total), write virtual Assignments+Submissions."""
    project_caps = _project_caps(policy)
    # Gather candidates from current 'Projects' or already-hidden '_projects_raw'
    candidates = session.query(Assignment).filter(
        Assignment.course_id == course_id,
        Assignment.category.in_(("Projects", "_projects_raw")),
    ).all()
    if not candidates:
        return {"projects": 0, "students_written": 0}

    by_project: Dict[str, List[Assignment]] = defaultdict(list)
    for a in candidates:
        key = _detect_project_key(a.title, project_caps)
        if key is None:
            logger.debug("Skipping unrecognised project assignment: %r", a.title)
            continue
        by_project[key].append(a)

    # Pre-fetch all submissions for project assignments
    project_ids = [a.id for grp in by_project.values() for a in grp]
    sub_lookup: Dict[Tuple[int, int], Submission] = {}
    for s in session.query(Submission).filter(
        Submission.assignment_id.in_(project_ids)
    ).all():
        sub_lookup[(s.assignment_id, s.student_id)] = s

    students = session.query(Student).filter(Student.course_id == course_id).all()

    total_written = 0
    project_summary = []

    for key, _, cap, _ in project_caps:
        assignments_in_proj = by_project.get(key, [])
        if not assignments_in_proj:
            logger.info("Course %s: no assignments for project %s", course_id, key)
            continue

        # Canonicalise sub-items (fold RESUBMISSION rows together)
        sub_items: Dict[str, List[Assignment]] = defaultdict(list)
        for a in assignments_in_proj:
            sub_items[_project_canonical(a.title)].append(a)

        # The denominator: sum of max_points across canonical sub-items
        # (use max max_points across original/resub to avoid double-counting).
        denom = 0.0
        for canon, items in sub_items.items():
            mx = max((_to_float(a.max_points) or 0.0) for a in items)
            denom += mx
        if denom <= 0:
            logger.warning("Course %s: project %s has zero denominator", course_id, key)
            continue

        # Cap meta: write canonical title (e.g. "Project 1: Wordle™-lite")
        canon_title = next(t for k, t, _, _ in project_caps if k == key)
        rollup = _ensure_rollup_assignment(
            session, course_id, f"project_rollup:{key}",
            title=canon_title, category="Projects", max_points=cap,
        )

        for stu in students:
            earned = 0.0
            sub_breakdown: List[Dict[str, Any]] = []
            for canon, items in sub_items.items():
                # Pick best score across original + resubmission for this sub-item
                best_frac = None
                best_item: Optional[Assignment] = None
                best_score = None
                for a in items:
                    sub = sub_lookup.get((a.id, stu.id))
                    if sub is None:
                        continue
                    f = _frac(sub.total_score, a.max_points)
                    if f is None:
                        continue
                    if best_frac is None or f > best_frac:
                        best_frac = f
                        best_item = a
                        best_score = _to_float(sub.total_score)
                mx = max((_to_float(a.max_points) or 0.0) for a in items)
                contribution = (best_frac or 0.0) * mx
                earned += contribution
                sub_breakdown.append({
                    "canonical": canon,
                    "best_frac": round(best_frac, 4) if best_frac is not None else None,
                    "best_score": best_score,
                    "max": mx,
                    "best_item_id": best_item.id if best_item else None,
                })

            project_score = (earned / denom) * cap

            _upsert_submission(
                session, rollup.id, stu.id,
                total_score=round(project_score, 2),
                max_points=cap,
                scores_by_question={
                    "project_key": key,
                    "earned": round(earned, 4),
                    "denom": round(denom, 4),
                    "cap": cap,
                    "sub_items": sub_breakdown,
                },
            )
            total_written += 1

        project_summary.append({"key": key, "title": canon_title, "cap": cap,
                                 "items": len(assignments_in_proj),
                                 "canonical_subitems": len(sub_items)})

    return {
        "projects": len(project_summary),
        "details": project_summary,
        "students_written": total_written,
    }


def hide_lab_project_raw(session: Session, course_id: int) -> Dict[str, int]:
    """Demote raw lab/project assignments so the dashboard only sees rollups.

    Skips the rollup assignments themselves. Optional labs are also moved
    so they don't leak into the visible 'Labs' column.
    """
    moved_labs = 0
    moved_projects = 0
    candidates = session.query(Assignment).filter(
        Assignment.course_id == course_id,
    ).all()
    for a in candidates:
        aid = a.assignment_id or ""
        # Don't touch the rollups
        if aid.startswith("labs_rollup:") or aid.startswith("project_rollup:") \
                or aid.startswith("attendance_rollup:"):
            continue
        title = a.title or ""
        # Lab raws: things currently labeled Labs, plus uncategorized practice
        # labs we promoted into the lab pool. Don't move items that already
        # belong to graded exam / project categories.
        is_lab_raw = (
            a.category == "Labs"
            or (a.category in (None, "Uncategorized") and _is_practice_lab(title))
            or (_is_optional_lab(title) and "lab" in title.lower())
        )
        if is_lab_raw:
            if a.category != "_labs_raw":
                a.category = "_labs_raw"
                moved_labs += 1
            continue
        # Project raws
        if a.category == "Projects":
            a.category = "_projects_raw"
            moved_projects += 1
    return {"moved_labs": moved_labs, "moved_projects": moved_projects}


# ----------- Internals ----------------------------------------------------

def _evaluate_lab_group(
    student_id: int,
    items: List[Assignment],
    sub_lookup: Dict[Tuple[int, int], Submission],
    is_practice: bool,
) -> bool:
    """Pass criterion for one lab group."""
    if is_practice:
        # Completion: any submission with score > 0 in any item passes.
        for a in items:
            sub = sub_lookup.get((a.id, student_id))
            if sub and (_to_float(sub.total_score) or 0) > 0:
                return True
        return False

    # Regular: every item must be (effectively) full credit.
    for a in items:
        sub = sub_lookup.get((a.id, student_id))
        f = _frac(sub.total_score if sub else None, a.max_points)
        if f is None or f < FULL_CREDIT_THRESHOLD:
            return False
    return True


def _ensure_rollup_assignment(
    session: Session,
    course_id: int,
    assignment_id: str,
    *,
    title: str,
    category: str,
    max_points: float,
) -> Assignment:
    a = session.query(Assignment).filter(
        Assignment.assignment_id == assignment_id,
        Assignment.course_id == course_id,
    ).first()
    if a:
        a.title = title
        a.category = category
        a.max_points = max_points
        return a
    a = Assignment(
        assignment_id=assignment_id,
        course_id=course_id,
        title=title,
        category=category,
        max_points=max_points,
    )
    session.add(a)
    session.flush()
    return a


def _upsert_submission(
    session: Session,
    assignment_id: int,
    student_id: int,
    *,
    total_score: float,
    max_points: float,
    scores_by_question: Any,
) -> None:
    existing = session.query(Submission).filter(
        Submission.assignment_id == assignment_id,
        Submission.student_id == student_id,
    ).first()
    if existing:
        existing.total_score = total_score
        existing.max_points = max_points
        existing.status = "Graded"
        existing.scores_by_question = scores_by_question
    else:
        session.add(Submission(
            assignment_id=assignment_id,
            student_id=student_id,
            total_score=total_score,
            max_points=max_points,
            status="Graded",
            scores_by_question=scores_by_question,
        ))


# ----------- Top-level driver --------------------------------------------

def compute_all_lab_project_scores(session: Session, course_id: int, policy: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Run all lab+project rollups and hide raws. Idempotent."""
    lab_result = compute_lab_score(session, course_id, policy=policy)
    proj_result = compute_project_scores(session, course_id, policy=policy)
    session.flush()
    hide_result = hide_lab_project_raw(session, course_id)
    session.flush()
    return {
        "labs": lab_result,
        "projects": proj_result,
        "hidden": hide_result,
    }
