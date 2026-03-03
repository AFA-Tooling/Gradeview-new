#!/usr/bin/env python3
"""
Backfill computed exam policy scores without running external syncs.

Usage:
  python3 gradesync/scripts/backfill_exam_policy.py
  python3 gradesync/scripts/backfill_exam_policy.py --course cs10_sp26
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
from api.core.models import Course
from api.core.exam_policy import compute_effective_exam_scores


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
            return course
    return session.query(Course).filter(Course.gradescope_course_id == course_key).first()


def main():
    parser = argparse.ArgumentParser(description="Backfill exam policy computed scores")
    parser.add_argument("--course", dest="course", help="Optional course key (e.g., cs10_sp26)")
    args = parser.parse_args()

    init_db()

    session = SessionLocal()
    try:
        keys = _resolve_course_keys(args.course)
        summary = []

        for key in keys:
            course = _find_db_course(session, key)
            if not course:
                summary.append({"course": key, "status": "skipped", "reason": "course not found in db"})
                continue

            result = compute_effective_exam_scores(session, course.id)
            session.commit()
            summary.append({
                "course": key,
                "course_db_id": course.id,
                "status": "ok",
                **result,
            })

        print(json.dumps({"ok": True, "results": summary}, ensure_ascii=False, indent=2))
    except Exception as exc:
        session.rollback()
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise
    finally:
        session.close()


if __name__ == "__main__":
    main()
