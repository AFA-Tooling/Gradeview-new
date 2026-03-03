#!/usr/bin/env python3
"""
Reclassify assignment categories by title patterns from config.json,
and refresh summary_sheets without pulling from external sources.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT / "gradesync"))

from api.config_manager import get_config_manager
from api.core.db import SessionLocal, init_db
from api.core.models import Course, Assignment, Student, Submission
from api.core.ingest import _categorize_assignment
from api.core.models import SummarySheet


def _resolve_course_keys(requested: str | None) -> list[str]:
    config = get_config_manager()
    if requested:
        return [requested]
    return config.list_courses()


def _find_db_course(session, course_key: str):
    config = get_config_manager().get_course(course_key)
    if config and config.gradescope_course_id:
        course = session.query(Course).filter(Course.gradescope_course_id == config.gradescope_course_id).first()
        if course:
            return course, config
    course = session.query(Course).filter(Course.gradescope_course_id == course_key).first()
    return course, config


def _refresh_summary_for_course(session, course_id: int):
    students = session.query(Student).filter(Student.course_id == course_id).all()
    assignments = session.query(Assignment).filter(Assignment.course_id == course_id).all()
    submissions_rows = (
        session.query(Submission)
        .join(Assignment, Submission.assignment_id == Assignment.id)
        .filter(Assignment.course_id == course_id)
        .all()
    )
    submissions = {(sub.assignment_id, sub.student_id): sub for sub in submissions_rows}

    session.query(SummarySheet).filter(SummarySheet.course_id == course_id).delete(synchronize_session=False)

    rows = []
    for student in students:
        for assignment in assignments:
            sub = submissions.get((assignment.id, student.id))
            score = float(sub.total_score) if sub and sub.total_score is not None else None
            rows.append(
                {
                    "course_id": course_id,
                    "student_id": student.id,
                    "assignment_id": assignment.id,
                    "score": score,
                }
            )

    if rows:
        session.bulk_insert_mappings(SummarySheet, rows, render_nulls=True)


def main():
    parser = argparse.ArgumentParser(description="Reclassify assignments and refresh summary sheets")
    parser.add_argument("--course", dest="course", help="Optional course key (e.g., cs10_sp26)")
    args = parser.parse_args()

    init_db()

    session = SessionLocal()
    try:
        keys = _resolve_course_keys(args.course)
        output = []

        for key in keys:
            course, config = _find_db_course(session, key)
            if not course or not config:
                output.append({"course": key, "status": "skipped", "reason": "course not found in db or config"})
                continue

            course_categories = config.categories or []

            assignments = session.query(Assignment).filter(Assignment.course_id == course.id).all()
            updated = 0
            for assignment in assignments:
                title = assignment.title or ""
                new_category = _categorize_assignment(title, course_categories)
                if assignment.category != new_category:
                    assignment.category = new_category
                    updated += 1

            session.flush()
            _refresh_summary_for_course(session, course.id)
            session.commit()

            output.append({
                "course": key,
                "course_db_id": course.id,
                "status": "ok",
                "assignments_reclassified": updated,
                "policy": "skipped",
            })

        print(json.dumps({"ok": True, "results": output}, ensure_ascii=False, indent=2))
    except Exception as exc:
        session.rollback()
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise
    finally:
        session.close()


if __name__ == "__main__":
    main()
