#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import delete, select

ROOT_DIR = Path(__file__).resolve().parents[1]
load_dotenv(ROOT_DIR / ".env")
load_dotenv()

if not os.getenv("DATABASE_URL") and os.getenv("GRADESYNC_DATABASE_URL"):
    os.environ["DATABASE_URL"] = os.environ["GRADESYNC_DATABASE_URL"]

from api.core import models  # noqa: E402
from api.core.db import SessionLocal, init_db  # noqa: E402


DEFAULT_COURSE_ID = os.getenv("DEMO_COURSE_ID", "demo_cs10_spring2025")
DEFAULT_USER_EMAIL = os.getenv("DEMO_USER_EMAIL", "public-demo@gradeview.local")
DEFAULT_COURSE_NAME = "Demo: CS10 - The Beauty and Joy of Computing"

CATEGORIES = [
    ("Attendance / Participation", ["attendance", "participation", "lecture", "discussion"]),
    ("Labs", ["lab", "labs"]),
    ("Projects", ["project", "final project"]),
    ("Quest", ["quest"]),
    ("Midterm", ["midterm"]),
    ("Postterm", ["postterm", "final"]),
]

QUEST_COMPONENTS = [
    ("Abstraction", 3),
    ("Number Representation", 4),
    ("Iteration", 4),
    ("Domain and Range", 3),
    ("Booleans", 4),
    ("Functions", 4),
    ("HOFs I", 3),
]

MIDTERM_COMPONENTS = [
    ("Scope", 8),
    ("Iteration", 12),
    ("Recursion", 12),
    ("Fractal", 10),
    ("Testing+2048", 8),
]

POSTTERM_COMPONENTS = [
    ("Generative AI", 10),
    ("Ethics in AI", 8),
    ("HCI", 8),
    ("Python Advanced", 10),
    ("Generic Base Conversion", 10),
    ("Concurrency", 9),
    ("HOFs I", 10),
    ("Coding Python", 10),
]

FIRST_NAMES = [
    "Avery", "Jordan", "Riley", "Morgan", "Casey", "Taylor", "Quinn", "Jamie",
    "Alex", "Cameron", "Drew", "Hayden", "Kai", "Logan", "Maya", "Nia",
    "Owen", "Priya", "Sam", "Sasha", "Theo", "Uma", "Val", "Wes",
    "Yara", "Zoe", "Iris", "Noah", "Mina", "Eli", "Lena", "Arun",
]

LAST_NAMES = [
    "Chen", "Patel", "Rivera", "Nguyen", "Kim", "Garcia", "Johnson", "Singh",
    "Brown", "Lee", "Martinez", "Davis", "Lopez", "Wilson", "Anderson", "Thomas",
    "Moore", "Jackson", "White", "Harris", "Clark", "Lewis", "Young", "Walker",
    "Hall", "Allen", "King", "Wright", "Scott", "Green", "Baker", "Adams",
]


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create a synthetic GradeView demo course in PostgreSQL.",
    )
    parser.add_argument("--course-id", default=DEFAULT_COURSE_ID)
    parser.add_argument("--course-name", default=DEFAULT_COURSE_NAME)
    parser.add_argument("--students", type=int, default=32)
    parser.add_argument("--demo-user-email", default=DEFAULT_USER_EMAIL)
    parser.add_argument("--seed", type=int, default=20260629)
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Remove all courses whose gradescope_course_id starts with demo_ before recreating this course.",
    )
    return parser.parse_args()


def reset_courses(db, course_ids: list[int]) -> None:
    if not course_ids:
        return

    assignment_ids = [
        row[0]
        for row in db.execute(
            select(models.Assignment.id).where(models.Assignment.course_id.in_(course_ids)),
        )
    ]
    student_ids = [
        row[0]
        for row in db.execute(
            select(models.Student.id).where(models.Student.course_id.in_(course_ids)),
        )
    ]

    if assignment_ids:
        db.execute(delete(models.Submission).where(models.Submission.assignment_id.in_(assignment_ids)))
    if student_ids:
        db.execute(delete(models.Submission).where(models.Submission.student_id.in_(student_ids)))

    db.execute(delete(models.SummarySheet).where(models.SummarySheet.course_id.in_(course_ids)))
    db.execute(delete(models.StudentExamEffectiveScore).where(models.StudentExamEffectiveScore.course_id.in_(course_ids)))
    db.execute(delete(models.StudentAttendanceEffectiveScore).where(models.StudentAttendanceEffectiveScore.course_id.in_(course_ids)))
    db.execute(delete(models.ExamAttemptMap).where(models.ExamAttemptMap.course_id.in_(course_ids)))
    db.execute(delete(models.AssignmentCategory).where(models.AssignmentCategory.course_id.in_(course_ids)))
    db.execute(delete(models.CourseConfig).where(models.CourseConfig.course_id.in_(course_ids)))
    db.execute(delete(models.CoursePermission).where(models.CoursePermission.course_id.in_(course_ids)))
    db.execute(delete(models.Assignment).where(models.Assignment.course_id.in_(course_ids)))
    db.execute(delete(models.Student).where(models.Student.course_id.in_(course_ids)))
    db.execute(delete(models.Course).where(models.Course.id.in_(course_ids)))


def find_course_ids(db, *, course_id: str | None = None, all_demo: bool = False) -> list[int]:
    stmt = select(models.Course.id)
    if all_demo:
        stmt = stmt.where(models.Course.gradescope_course_id.like("demo\\_%", escape="\\"))
    else:
        stmt = stmt.where(models.Course.gradescope_course_id == course_id)
    return [row[0] for row in db.execute(stmt)]


def upsert_demo_user(db, email: str) -> models.User:
    normalized_email = email.strip().lower()
    user = db.execute(
        select(models.User).where(models.User.email == normalized_email),
    ).scalar_one_or_none()

    if user is None:
        user = models.User(
            email=normalized_email,
            name="Public Demo Admin",
            role="admin",
            is_active=True,
        )
        db.add(user)
    else:
        user.name = user.name or "Public Demo Admin"
        user.role = "admin"
        user.is_active = True

    db.flush()
    return user


def create_course(db, args: argparse.Namespace, owner: models.User) -> models.Course:
    course = models.Course(
        gradescope_course_id=args.course_id,
        name=args.course_name,
        department="CS",
        course_number="10",
        semester="Spring",
        year="2026",
        instructor="GradeView Demo Staff",
        number_of_students=args.students,
        owner_id=owner.id,
        is_active=True,
        last_synced_at=datetime.now(timezone.utc),
    )
    db.add(course)
    db.flush()

    db.add(models.CoursePermission(
        course_id=course.id,
        user_id=owner.id,
        permission_level="owner",
        granted_by=owner.id,
    ))

    db.add(models.CourseConfig(
        course_id=course.id,
        gradescope_enabled=False,
        gradescope_course_id=args.course_id,
        gradescope_sync_interval_hours=24,
        prairielearn_enabled=False,
        prairielearn_course_id=None,
        iclicker_enabled=False,
        iclicker_course_names=[],
        database_enabled=True,
        use_as_primary=True,
    ))

    for display_order, (name, patterns) in enumerate(CATEGORIES):
        db.add(models.AssignmentCategory(
            course_id=course.id,
            name=name,
            patterns=patterns,
            display_order=display_order,
        ))

    db.flush()
    return course


def assignment_blueprints(course_key: str) -> list[dict]:
    blueprints: list[dict] = []

    for idx in range(1, 7):
        blueprints.append({
            "assignment_id": f"{course_key}:attendance:{idx}",
            "title": f"Lecture Check-in {idx}",
            "category": "Attendance / Participation",
            "max_points": 1,
            "kind": "attendance",
        })

    for idx, title in enumerate([
        "Lab 1: Welcome to Snap",
        "Lab 2: Predicates and Conditionals",
        "Lab 3: Number Representation",
        "Lab 4: Lists and Recursion",
        "Lab 5: Higher-Order Functions",
        "Lab 6: Python Data",
        "Lab 7: Concurrency",
        "Lab 8: Generative AI Studio",
    ], start=1):
        blueprints.append({
            "assignment_id": f"{course_key}:lab:{idx}",
            "title": title,
            "category": "Labs",
            "max_points": 10,
            "kind": "lab",
        })

    for idx, (title, max_points) in enumerate([
        ("Project 1: Wordle-lite", 15),
        ("Project 2: Spelling Bee", 25),
        ("Project 3: 2048", 35),
        ("Project 4: Explore", 20),
        ("Final Project", 60),
    ], start=1):
        blueprints.append({
            "assignment_id": f"{course_key}:project:{idx}",
            "title": title,
            "category": "Projects",
            "max_points": max_points,
            "kind": "project",
        })

    for attempt in range(1, 4):
        blueprints.append({
            "assignment_id": f"{course_key}:quest:{attempt}",
            "title": f"Quest {attempt}",
            "category": "Quest",
            "max_points": 25,
            "kind": "exam",
            "exam_type": "quest",
            "attempt_no": attempt,
            "components": QUEST_COMPONENTS,
        })

    blueprints.append({
        "assignment_id": f"{course_key}:midterm:1",
        "title": "Midterm 1",
        "category": "Midterm",
        "max_points": 50,
        "kind": "exam",
        "exam_type": "midterm",
        "attempt_no": 1,
        "components": MIDTERM_COMPONENTS,
    })

    blueprints.append({
        "assignment_id": f"{course_key}:postterm:1",
        "title": "Postterm",
        "category": "Postterm",
        "max_points": 75,
        "kind": "exam",
        "exam_type": "postterm",
        "attempt_no": 1,
        "components": POSTTERM_COMPONENTS,
    })

    return blueprints


def create_assignments(db, course: models.Course, course_key: str) -> list[models.Assignment]:
    assignments = []
    release_base = datetime(2026, 1, 20, tzinfo=timezone.utc)

    for index, blueprint in enumerate(assignment_blueprints(course_key)):
        components = blueprint.get("components") or []
        assignment = models.Assignment(
            assignment_id=blueprint["assignment_id"],
            course_id=course.id,
            title=blueprint["title"],
            category=blueprint["category"],
            max_points=blueprint["max_points"],
            assignment_metadata={
                "demo": True,
                "source": "demo",
                "components": [
                    {
                        "key": name,
                        "category": name,
                        "max_points": points,
                    }
                    for name, points in components
                ],
            },
            last_synced_at=datetime.now(timezone.utc),
            gradescope_updated_at=release_base + timedelta(days=index * 4),
            updated_at=datetime.now(timezone.utc),
        )
        assignment.demo_blueprint = blueprint
        db.add(assignment)
        assignments.append(assignment)

    db.flush()

    for assignment in assignments:
        blueprint = assignment.demo_blueprint
        if blueprint.get("kind") != "exam":
            continue
        db.add(models.ExamAttemptMap(
            course_id=course.id,
            assignment_id=assignment.id,
            exam_type=blueprint["exam_type"],
            attempt_no=blueprint["attempt_no"],
            is_mandatory=blueprint["exam_type"] != "quest",
            is_practice=False,
            release_at=assignment.gradescope_updated_at,
            due_at=assignment.gradescope_updated_at + timedelta(days=7),
            extra_metadata={"demo": True},
        ))

    db.flush()
    return assignments


def student_ability(index: int, rng: random.Random) -> float:
    if index < 8:
        base = 0.92
    elif index < 20:
        base = 0.81
    elif index < 28:
        base = 0.68
    else:
        base = 0.54
    return clamp(rng.gauss(base, 0.045), 0.35, 0.99)


def create_students(db, course: models.Course, count: int, rng: random.Random) -> list[tuple[models.Student, float]]:
    count = max(1, count)
    students = []

    for index in range(count):
        first_name = FIRST_NAMES[index % len(FIRST_NAMES)]
        last_name = LAST_NAMES[(index * 7 + index // len(FIRST_NAMES)) % len(LAST_NAMES)]
        display_suffix = f" {index + 1}" if index >= len(FIRST_NAMES) else ""
        student = models.Student(
            course_id=course.id,
            sid=f"313010{index + 1:04d}",
            email=f"demo-student-{index + 1:02d}@gradeview.local",
            legal_name=f"{first_name} {last_name}{display_suffix}",
        )
        db.add(student)
        students.append((student, student_ability(index, rng)))

    db.flush()
    return students


def score_components(components: list[tuple[str, int]], pct: float, rng: random.Random) -> tuple[float, dict]:
    scores_by_question = {"component_caps": {name: points for name, points in components}}
    total = 0.0

    for name, points in components:
        component_pct = clamp(rng.gauss(pct, 0.07), 0.05, 1.0)
        score = round(points * component_pct, 2)
        scores_by_question[name] = score
        total += score

    scores_by_question["score_perc"] = round((total / sum(points for _, points in components)) * 100, 2)
    scores_by_question["source"] = "demo"
    return round(total, 2), scores_by_question


def assignment_pct(ability: float, blueprint: dict, rng: random.Random) -> float:
    kind = blueprint["kind"]
    adjustment = {
        "attendance": 0.06,
        "lab": 0.04,
        "project": -0.02,
        "exam": -0.03,
    }.get(kind, 0)

    if blueprint.get("exam_type") == "quest":
        adjustment += (blueprint.get("attempt_no", 1) - 1) * 0.035
    if blueprint.get("exam_type") == "postterm":
        adjustment += 0.025
    if blueprint["category"] == "Projects" and "Final" in blueprint["title"]:
        adjustment -= 0.035

    return clamp(rng.gauss(ability + adjustment, 0.075), 0.0, 1.0)


def should_mark_missing(ability: float, blueprint: dict, rng: random.Random) -> bool:
    if blueprint["kind"] == "attendance":
        return False
    if blueprint["kind"] == "exam":
        return rng.random() < max(0.01, (0.82 - ability) * 0.035)
    return rng.random() < max(0.015, (0.88 - ability) * 0.08)


def create_submissions(
    db,
    course: models.Course,
    students: list[tuple[models.Student, float]],
    assignments: list[models.Assignment],
    rng: random.Random,
) -> dict[tuple[int, int], float]:
    submission_scores: dict[tuple[int, int], float] = {}
    start = datetime(2026, 1, 27, tzinfo=timezone.utc)

    for assignment_index, assignment in enumerate(assignments):
        blueprint = assignment.demo_blueprint
        max_points = float(assignment.max_points)
        due_at = start + timedelta(days=assignment_index * 4)

        for student, ability in students:
            missing = should_mark_missing(ability, blueprint, rng)
            pct = assignment_pct(ability, blueprint, rng)

            if missing:
                score = 0.0
                status = "missing"
                submission_time = None
                lateness = ""
                scores_by_question = {"source": "demo", "missing": True}
            elif blueprint.get("components"):
                score, scores_by_question = score_components(blueprint["components"], pct, rng)
                status = "submitted"
                lateness = "late" if rng.random() < max(0.03, (0.85 - ability) * 0.12) else ""
                submission_time = due_at + timedelta(hours=2 if lateness else -rng.randint(1, 48))
            else:
                score = round(max_points * pct, 2)
                status = "submitted"
                lateness = "late" if rng.random() < max(0.03, (0.85 - ability) * 0.12) else ""
                submission_time = due_at + timedelta(hours=3 if lateness else -rng.randint(1, 48))
                scores_by_question = {
                    "Autograder": score,
                    "component_caps": {"Autograder": max_points},
                    "score_perc": round((score / max_points) * 100, 2) if max_points else 0,
                    "source": "demo",
                }

            submission = models.Submission(
                assignment_id=assignment.id,
                student_id=student.id,
                total_score=score,
                max_points=max_points,
                status=status,
                submission_id=f"demo-{assignment.id}-{student.id}",
                submission_time=submission_time,
                lateness=lateness,
                view_count=rng.randint(0, 6),
                submission_count=0 if missing else rng.randint(1, 4),
                scores_by_question=scores_by_question,
            )
            db.add(submission)
            db.add(models.SummarySheet(
                course_id=course.id,
                student_id=student.id,
                assignment_id=assignment.id,
                score=score,
            ))
            submission_scores[(student.id, assignment.id)] = score

    db.flush()
    return submission_scores


def create_exam_effective_scores(
    db,
    course: models.Course,
    students: list[tuple[models.Student, float]],
    assignments: list[models.Assignment],
    submission_scores: dict[tuple[int, int], float],
) -> None:
    exam_assignments = [
        assignment for assignment in assignments
        if assignment.demo_blueprint.get("kind") == "exam"
    ]
    postterm = next(
        (assignment for assignment in exam_assignments if assignment.demo_blueprint.get("exam_type") == "postterm"),
        None,
    )

    for student, _ in students:
        best_by_exam: dict[str, float] = {}
        postterm_pct = 0.0
        if postterm is not None:
            postterm_pct = (
                float(submission_scores[(student.id, postterm.id)])
                / float(postterm.max_points)
                * 100
            )

        for assignment in exam_assignments:
            blueprint = assignment.demo_blueprint
            exam_type = blueprint["exam_type"]
            raw_pct = (
                float(submission_scores[(student.id, assignment.id)])
                / float(assignment.max_points)
                * 100
            )

            question_best = max(best_by_exam.get(exam_type, 0.0), raw_pct)
            best_by_exam[exam_type] = question_best
            clobbered_pct = None
            clobber_source_id = None
            final_pct = question_best

            if exam_type == "midterm" and postterm is not None:
                clobbered_pct = max(raw_pct, postterm_pct * 0.85)
                if clobbered_pct > raw_pct:
                    clobber_source_id = postterm.id
                final_pct = max(final_pct, clobbered_pct)

            db.add(models.StudentExamEffectiveScore(
                course_id=course.id,
                student_id=student.id,
                exam_type=exam_type,
                attempt_no=blueprint["attempt_no"],
                assignment_id=assignment.id,
                raw_percentage=round(raw_pct, 2),
                question_best_percentage=round(question_best, 2),
                clobbered_percentage=round(clobbered_pct, 2) if clobbered_pct is not None else None,
                final_percentage=round(final_pct, 2),
                clobber_source_assignment_id=clobber_source_id,
                details={"demo": True, "assignment_title": assignment.title},
            ))


def create_attendance_effective_scores(
    db,
    course: models.Course,
    students: list[tuple[models.Student, float]],
    rng: random.Random,
) -> None:
    specs = [
        ("lecture", 14, 3),
        ("lab", 8, 1),
        ("discussion", 7, 1),
    ]

    for student, ability in students:
        for kind, required, drops in specs:
            attendance_rate = clamp(rng.gauss(ability + 0.04, 0.08), 0.2, 1.0)
            attended = int(round(required * attendance_rate))
            effective_total = max(1, required - drops)
            effective_attended = min(effective_total, attended)
            raw_pct = (attended / required) * 100
            final_pct = (effective_attended / effective_total) * 100

            db.add(models.StudentAttendanceEffectiveScore(
                course_id=course.id,
                student_id=student.id,
                kind=kind,
                iclicker_assignment_id=None,
                total_required_sessions=required,
                attended_sessions=attended,
                drops_applied=drops,
                effective_attended=effective_attended,
                effective_total=effective_total,
                raw_percentage=round(raw_pct, 2),
                final_percentage=round(final_pct, 2),
                details={"demo": True},
            ))


def create_demo_course(args: argparse.Namespace) -> dict:
    rng = random.Random(args.seed)
    init_db()
    db = SessionLocal()

    try:
        if args.clean:
            reset_courses(db, find_course_ids(db, all_demo=True))
        else:
            reset_courses(db, find_course_ids(db, course_id=args.course_id))

        owner = upsert_demo_user(db, args.demo_user_email)
        course = create_course(db, args, owner)
        assignments = create_assignments(db, course, args.course_id)
        students = create_students(db, course, args.students, rng)
        submission_scores = create_submissions(db, course, students, assignments, rng)
        create_exam_effective_scores(db, course, students, assignments, submission_scores)
        create_attendance_effective_scores(db, course, students, rng)

        db.commit()
        return {
            "course_id": course.id,
            "gradescope_course_id": course.gradescope_course_id,
            "students": len(students),
            "assignments": len(assignments),
            "submissions": len(students) * len(assignments),
            "demo_user_email": owner.email,
        }
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def main() -> None:
    args = parse_args()
    summary = create_demo_course(args)
    print("Demo course ready")
    print(f"  Course: {summary['gradescope_course_id']} (internal id {summary['course_id']})")
    print(f"  Demo admin: {summary['demo_user_email']}")
    print(f"  Students: {summary['students']}")
    print(f"  Assignments: {summary['assignments']}")
    print(f"  Submissions: {summary['submissions']}")


if __name__ == "__main__":
    main()
