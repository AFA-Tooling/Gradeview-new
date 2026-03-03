import re
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple, List

from sqlalchemy.orm import Session

from .models import Assignment, Student, Submission, ExamAttemptMap, StudentExamEffectiveScore

_EXAM_PATTERN = re.compile(r"\b(Quest|Midterm|Postterm)\s*[-:]?\s*(\d+)\b", re.IGNORECASE)


def _to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def parse_exam_identity(title: Optional[str]) -> Dict[str, Any]:
    text = (title or "").strip()
    if not text:
        return {"exam_type": None, "attempt_no": None, "is_practice": False}

    match = _EXAM_PATTERN.search(text)
    exam_type = None
    attempt_no = None
    if match:
        exam_type = match.group(1).lower()
        attempt_no = int(match.group(2))

    is_practice = "practice" in text.lower()
    return {
        "exam_type": exam_type,
        "attempt_no": attempt_no,
        "is_practice": is_practice,
    }


def _extract_component_caps(assignment: Assignment) -> Dict[str, float]:
    metadata = assignment.assignment_metadata if isinstance(assignment.assignment_metadata, dict) else {}
    components = metadata.get("components")
    if not isinstance(components, list):
        return {}

    caps: Dict[str, float] = {}
    for component in components:
        if not isinstance(component, dict):
            continue
        key = str(component.get("key", "")).strip()
        if not key:
            continue
        cap = _to_float(component.get("max_points"))
        if cap is None:
            continue
        old = caps.get(key)
        if old is None or cap > old:
            caps[key] = cap
    return caps


def _submission_percentage(submission: Optional[Submission], assignment: Assignment) -> Optional[float]:
    if not submission:
        return None
    score = _to_float(submission.total_score)
    if score is None:
        return None
    max_points = _to_float(assignment.max_points)
    if max_points is None or max_points <= 0:
        return None
    return (score / max_points) * 100.0


def compute_effective_exam_scores(session: Session, course_id: int) -> Dict[str, int]:
    assignments = session.query(Assignment).filter(Assignment.course_id == course_id).all()
    students = session.query(Student).filter(Student.course_id == course_id).all()

    if not assignments or not students:
        return {
            "attempts_mapped": 0,
            "effective_rows_upserted": 0,
        }

    map_by_assignment = {
        item.assignment_id: item
        for item in session.query(ExamAttemptMap).filter(ExamAttemptMap.course_id == course_id).all()
    }

    attempts_mapped = 0
    mapped_assignments = []

    for assignment in assignments:
        metadata = assignment.assignment_metadata if isinstance(assignment.assignment_metadata, dict) else {}
        parsed = parse_exam_identity(assignment.title)

        exam_type = metadata.get("exam_type") or parsed["exam_type"]
        attempt_no = metadata.get("attempt_no") or parsed["attempt_no"]
        is_practice = bool(metadata.get("is_practice", parsed["is_practice"]))

        if not exam_type or not attempt_no:
            continue

        if not isinstance(assignment.assignment_metadata, dict):
            assignment.assignment_metadata = {}
        assignment.assignment_metadata["exam_type"] = exam_type
        assignment.assignment_metadata["attempt_no"] = int(attempt_no)
        assignment.assignment_metadata["is_practice"] = is_practice
        assignment.assignment_metadata["is_mandatory"] = bool(metadata.get("is_mandatory", int(attempt_no) == 1))

        mapped_assignments.append(assignment)

        mapped = map_by_assignment.get(assignment.id)
        if not mapped:
            mapped = ExamAttemptMap(
                course_id=course_id,
                assignment_id=assignment.id,
                exam_type=exam_type,
                attempt_no=int(attempt_no),
                is_mandatory=bool(assignment.assignment_metadata.get("is_mandatory", int(attempt_no) == 1)),
                is_practice=is_practice,
                extra_metadata={"source": "assignment_metadata"},
            )
            session.add(mapped)
            attempts_mapped += 1
        else:
            changed = False
            if mapped.exam_type != exam_type:
                mapped.exam_type = exam_type
                changed = True
            if mapped.attempt_no != int(attempt_no):
                mapped.attempt_no = int(attempt_no)
                changed = True
            mandatory = bool(assignment.assignment_metadata.get("is_mandatory", int(attempt_no) == 1))
            if mapped.is_mandatory != mandatory:
                mapped.is_mandatory = mandatory
                changed = True
            if mapped.is_practice != is_practice:
                mapped.is_practice = is_practice
                changed = True
            if changed:
                attempts_mapped += 1

    session.flush()

    submissions = (
        session.query(Submission)
        .join(Assignment, Submission.assignment_id == Assignment.id)
        .filter(Assignment.course_id == course_id)
        .all()
    )
    submission_lookup = {(sub.assignment_id, sub.student_id): sub for sub in submissions}

    grouped_assignments: Dict[str, Dict[int, List[Assignment]]] = defaultdict(lambda: defaultdict(list))
    for assignment in mapped_assignments:
        exam_type = assignment.assignment_metadata.get("exam_type")
        attempt_no = int(assignment.assignment_metadata.get("attempt_no"))
        if assignment.assignment_metadata.get("is_practice"):
            continue
        grouped_assignments[exam_type][attempt_no].append(assignment)

    existing_effective = {
        (row.student_id, row.exam_type, row.attempt_no): row
        for row in session.query(StudentExamEffectiveScore).filter(
            StudentExamEffectiveScore.course_id == course_id
        ).all()
    }

    upserted = 0

    for student in students:
        for exam_type, attempts in grouped_assignments.items():
            component_caps: Dict[str, float] = {}
            component_best: Dict[str, float] = {}

            for assignment_group in attempts.values():
                for assignment in assignment_group:
                    caps = _extract_component_caps(assignment)
                    for key, cap in caps.items():
                        old_cap = component_caps.get(key)
                        if old_cap is None or cap > old_cap:
                            component_caps[key] = cap

                    submission = submission_lookup.get((assignment.id, student.id))
                    if not submission:
                        continue
                    scores = submission.scores_by_question if isinstance(submission.scores_by_question, dict) else {}
                    for key, raw_score in scores.items():
                        score = _to_float(raw_score)
                        if score is None:
                            continue
                        old_score = component_best.get(key)
                        if old_score is None or score > old_score:
                            component_best[key] = score

            question_best_pct = None
            if component_caps:
                denominator = float(sum(component_caps.values()))
                numerator = float(sum(min(component_best.get(key, 0.0), cap) for key, cap in component_caps.items()))
                if denominator > 0:
                    question_best_pct = (numerator / denominator) * 100.0

            ordered_attempts = sorted(attempts.keys())
            raw_per_attempt: Dict[int, Tuple[Optional[float], Optional[int], Optional[Assignment]]] = {}

            for attempt_no in ordered_attempts:
                best_raw = None
                best_assignment_id = None
                for assignment in attempts[attempt_no]:
                    submission = submission_lookup.get((assignment.id, student.id))
                    raw_pct = _submission_percentage(submission, assignment)
                    if raw_pct is None:
                        continue
                    if best_raw is None or raw_pct > best_raw:
                        best_raw = raw_pct
                        best_assignment_id = assignment.id
                raw_per_attempt[attempt_no] = (best_raw, best_assignment_id, None)

            suffix_best: Dict[int, Tuple[Optional[float], Optional[int]]] = {}
            running_best_pct = None
            running_best_assignment_id = None
            for attempt_no in reversed(ordered_attempts):
                raw_pct, raw_assignment_id, _ = raw_per_attempt[attempt_no]
                if raw_pct is not None and (running_best_pct is None or raw_pct > running_best_pct):
                    running_best_pct = raw_pct
                    running_best_assignment_id = raw_assignment_id
                suffix_best[attempt_no] = (running_best_pct, running_best_assignment_id)

            for attempt_no in ordered_attempts:
                raw_pct, raw_assignment_id, raw_assignment_obj = raw_per_attempt[attempt_no]
                clobbered_pct, clobber_source_id = suffix_best[attempt_no]

                finals = [v for v in (raw_pct, question_best_pct, clobbered_pct) if v is not None]
                final_pct = max(finals) if finals else None

                assignment_id = raw_assignment_id
                if assignment_id is None:
                    assignment_id = (attempts[attempt_no][0].id if attempts[attempt_no] else None)
                if assignment_id is None:
                    continue

                key = (student.id, exam_type, attempt_no)
                details = {
                    "raw_assignment_id": raw_assignment_id,
                    "clobber_source_assignment_id": clobber_source_id,
                    "question_component_count": len(component_caps),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }

                row = existing_effective.get(key)
                if not row:
                    row = StudentExamEffectiveScore(
                        course_id=course_id,
                        student_id=student.id,
                        exam_type=exam_type,
                        attempt_no=attempt_no,
                        assignment_id=assignment_id,
                        raw_percentage=raw_pct,
                        question_best_percentage=question_best_pct,
                        clobbered_percentage=clobbered_pct,
                        final_percentage=final_pct,
                        clobber_source_assignment_id=clobber_source_id,
                        details=details,
                        computed_at=datetime.now(timezone.utc),
                    )
                    session.add(row)
                    existing_effective[key] = row
                    upserted += 1
                else:
                    row.assignment_id = assignment_id
                    row.raw_percentage = raw_pct
                    row.question_best_percentage = question_best_pct
                    row.clobbered_percentage = clobbered_pct
                    row.final_percentage = final_pct
                    row.clobber_source_assignment_id = clobber_source_id
                    row.details = details
                    row.computed_at = datetime.now(timezone.utc)
                    upserted += 1

    session.flush()

    return {
        "attempts_mapped": attempts_mapped,
        "effective_rows_upserted": upserted,
    }
