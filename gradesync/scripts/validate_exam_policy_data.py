#!/usr/bin/env python3
"""Validate computed exam policy data shape in DB."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT / "gradesync"))

from api.core.db import SessionLocal
from api.core.models import ExamAttemptMap, StudentExamEffectiveScore, Course


def main():
    session = SessionLocal()
    try:
        courses = session.query(Course).all()
        output = []

        for course in courses:
            mapped_count = session.query(ExamAttemptMap).filter(ExamAttemptMap.course_id == course.id).count()
            effective_count = session.query(StudentExamEffectiveScore).filter(StudentExamEffectiveScore.course_id == course.id).count()
            null_final_count = session.query(StudentExamEffectiveScore).filter(
                StudentExamEffectiveScore.course_id == course.id,
                StudentExamEffectiveScore.final_percentage.is_(None),
            ).count()
            sample = session.query(StudentExamEffectiveScore).filter(
                StudentExamEffectiveScore.course_id == course.id
            ).limit(5).all()

            output.append({
                "course_id": course.id,
                "gradescope_course_id": course.gradescope_course_id,
                "mapped_attempts": mapped_count,
                "effective_rows": effective_count,
                "rows_with_null_final": null_final_count,
                "sample": [
                    {
                        "student_id": row.student_id,
                        "exam_type": row.exam_type,
                        "attempt_no": row.attempt_no,
                        "raw_percentage": float(row.raw_percentage) if row.raw_percentage is not None else None,
                        "question_best_percentage": float(row.question_best_percentage) if row.question_best_percentage is not None else None,
                        "clobbered_percentage": float(row.clobbered_percentage) if row.clobbered_percentage is not None else None,
                        "final_percentage": float(row.final_percentage) if row.final_percentage is not None else None,
                    }
                    for row in sample
                ],
            })

        print(json.dumps({"ok": True, "courses": output}, ensure_ascii=False, indent=2))
    finally:
        session.close()


if __name__ == "__main__":
    main()
