import re
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple, List

from sqlalchemy import func
from sqlalchemy.orm import Session

from .models import Assignment, Student, Submission, ExamAttemptMap, StudentExamEffectiveScore

_EXAM_PATTERN = re.compile(r"\b(Quest|Midterm|Postterm)\s*[-:]?\s*(\d+)\b", re.IGNORECASE)

_POSTTERM_TOPIC_ALIASES = {
    "programming paradigms": "Programming Paradigms",
    "hci": "HCI",
    "sp26 hci almeda": "HCI",
    "fa25 hci aveni": "HCI",
    "human computer interaction": "HCI",
    "human-computer interaction": "HCI",
    "genai": "Generative AI",
    "generative ai": "Generative AI",
    "ethics in ai": "Ethics in AI",
    "ethics ai": "Ethics in AI",
    "python advanced": "Python Advanced",
    "generic base conversion": "Generic Base Conversion",
    "base conversion": "Generic Base Conversion",
    "number representation": "Generic Base Conversion",
    "concurrency": "Concurrency",
    "concurrency race": "Concurrency",
    "concurrency race deadlock": "Concurrency",
    "hofs i": "HOFs I",
    "hof i": "HOFs I",
    "hofs": "HOFs I",
    "higher order functions": "HOFs I",
    "higher-order functions": "HOFs I",
    "coding python data structures": "Coding Python",
    "coding python": "Coding Python",
    "autograder": "Snap!",
    "1: autograder (20.0 pts)": "Snap!",
    "1: autograder (10.0 pts)": "Snap!",
}


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


def _component_key(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower().replace("_", " ").replace("-", " "))


def _canonical_component(exam_type: Optional[str], value: Any, assignment_title: Optional[str] = None) -> Optional[str]:
    key = _component_key(value)
    title_key = _component_key(assignment_title)
    if not key:
        return None
    if "survey" in key or key.startswith("pledge") or key.startswith("assessment "):
        return None

    if exam_type == "postterm":
        if key == "python":
            return "Coding Python" if "with python" in title_key or "with snap" in title_key else "Python Advanced"
        if "autograder" in key:
            return "Snap!"
        return _POSTTERM_TOPIC_ALIASES.get(key)

    if exam_type == "midterm":
        if key == "scoping":
            return "Scope"
        if key == "recursion":
            return "Recursion Tracing"
        if "autograder" in key:
            return "Fractal"

    return str(value or "").strip()


def _distribute_aggregate_scores(
    exam_type: Optional[str],
    scores: Dict[str, Any],
    caps: Dict[str, float],
) -> Dict[str, float]:
    adjustments: Dict[str, float] = defaultdict(float)

    def raw_score(raw_key: str) -> float:
        wanted = _component_key(raw_key)
        for key, value in scores.items():
            if _component_key(key) == wanted:
                return _to_float(value) or 0.0
        return 0.0

    def distribute(raw_key: str, targets: List[str]) -> None:
        remaining = raw_score(raw_key)
        for target in targets:
            cap = caps.get(target) or 0.0
            if cap <= 0:
                continue
            room = max(0.0, cap - adjustments[target])
            used = min(max(remaining, 0.0), room)
            if used > 0:
                adjustments[target] += used
            remaining -= used
            if remaining <= 0:
                break

    if exam_type == "postterm":
        distribute("Lecture", ["Generative AI", "Ethics in AI", "HCI"])
    elif exam_type == "midterm":
        distribute("Lecture", ["Algorithms", "Computers In Education", "Testing+2048", "Savingtheworld"])
        distribute("Logical Procedures", ["Iteration"])

    return dict(adjustments)


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


def _extract_component_caps(assignment: Assignment, exam_type: Optional[str] = None) -> Dict[str, float]:
    metadata = assignment.assignment_metadata if isinstance(assignment.assignment_metadata, dict) else {}
    components = metadata.get("components")
    caps: Dict[str, float] = {}

    if isinstance(components, list):
        for component in components:
            if not isinstance(component, dict):
                continue
            key = _canonical_component(exam_type, component.get("key", ""), assignment.title)
            if not key:
                continue
            cap = _to_float(component.get("max_points"))
            if cap is None or cap <= 0:
                continue
            caps[key] = caps.get(key, 0.0) + cap

    if not caps and metadata.get("source") != "prairielearn":
        cap = _to_float(assignment.max_points)
        key = _canonical_component(exam_type, "Autograder", assignment.title)
        if key and cap is not None and cap > 0:
            caps[key] = cap
    return caps


def _submission_percentage(submission: Optional[Submission], assignment: Assignment) -> Optional[float]:
    if not submission:
        return None
    score = _to_float(submission.total_score)
    if score is None:
        return None
    max_points = _to_float(assignment.max_points) or _to_float(submission.max_points)
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
            component_best_pct: Dict[str, float] = {}

            for assignment_group in attempts.values():
                attempt_component_scores: Dict[str, float] = defaultdict(float)
                attempt_component_caps: Dict[str, float] = defaultdict(float)

                for assignment in assignment_group:
                    caps = _extract_component_caps(assignment, exam_type)
                    for key, cap in caps.items():
                        if attempt_component_caps[key] <= 0:
                            attempt_component_caps[key] = cap

                    submission = submission_lookup.get((assignment.id, student.id))
                    if not submission:
                        continue
                    scores = submission.scores_by_question if isinstance(submission.scores_by_question, dict) else {}
                    score_by_component: Dict[str, float] = {}
                    for raw_key, raw_value in scores.items():
                        key = _canonical_component(exam_type, raw_key, assignment.title)
                        if not key:
                            continue
                        score = _to_float(raw_value)
                        if score is None:
                            continue
                        score_by_component[key] = score_by_component.get(key, 0.0) + score

                    for key, score in _distribute_aggregate_scores(exam_type, scores, caps).items():
                        score_by_component[key] = score_by_component.get(key, 0.0) + score

                    for key, cap in caps.items():
                        score = score_by_component.get(key)
                        if score is None:
                            continue
                        attempt_component_scores[key] += min(max(score, 0.0), cap)

                for key, cap in attempt_component_caps.items():
                    if cap <= 0:
                        continue
                    old_cap = component_caps.get(key)
                    if old_cap is None or cap > old_cap:
                        component_caps[key] = cap
                    pct = attempt_component_scores.get(key, 0.0) / cap
                    old_pct = component_best_pct.get(key)
                    if old_pct is None or pct > old_pct:
                        component_best_pct[key] = pct

            question_best_pct = None
            if component_caps:
                denominator = float(sum(component_caps.values()))
                numerator = float(sum(component_best_pct.get(key, 0.0) * cap for key, cap in component_caps.items()))
                if denominator > 0:
                    question_best_pct = (numerator / denominator) * 100.0

            ordered_attempts = sorted(attempts.keys())
            raw_per_attempt: Dict[int, Tuple[Optional[float], Optional[int], Optional[Assignment]]] = {}

            for attempt_no in ordered_attempts:
                total_score = 0.0
                total_cap = 0.0
                best_assignment_id = None
                for assignment in attempts[attempt_no]:
                    submission = submission_lookup.get((assignment.id, student.id))
                    if not submission:
                        continue
                    score = _to_float(submission.total_score)
                    max_points = _to_float(assignment.max_points) or _to_float(submission.max_points)
                    if score is None or max_points is None or max_points <= 0:
                        continue
                    total_score += score
                    total_cap += max_points
                    if best_assignment_id is None:
                        best_assignment_id = assignment.id
                best_raw = (total_score / total_cap) * 100.0 if total_cap > 0 else None
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
                    "raw_attempt_policy": "sum_parts",
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
