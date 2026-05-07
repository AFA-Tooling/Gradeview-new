#!/usr/bin/env python3
"""
Plan B verification: ingest pre-downloaded iClicker CSVs, then run the
attendance policy and print results.

Auto-classifies each CSV as lecture / lab / discussion based on the weekday
distribution of session columns:
    only Mon/Wed     → lecture
    Tue + Thu        → lab
    only Thu (or 1 weekday)  → discussion
"""
import os
import re
import sys
import csv
from collections import Counter
from datetime import datetime
from pathlib import Path

os.environ["POSTGRES_HOST"] = "localhost"
os.environ["POSTGRES_PORT"] = "5433"
sys.path.insert(0, str(Path(__file__).parent))

from dotenv import load_dotenv
load_dotenv("/Users/zhangweishu/Gradeview-new/.env")
os.environ["POSTGRES_HOST"] = "localhost"
os.environ["POSTGRES_PORT"] = "5433"
os.environ.pop("DATABASE_URL", None)

from api.core.iclicker_ingest import write_iclicker_attendance_to_db
from api.core.attendance_policy import compute_attendance_scores
from api.core.db import SessionLocal
from api.core.models import (
    Course,
    Assignment,
    Submission,
    Student,
    StudentAttendanceEffectiveScore,
)
from sqlalchemy import func

COURSE_GS_ID = "1232070"
COURSE_NAME = "CS10: The Beauty and Joy of Computing"
CSV_DIR = Path(__file__).parent / "iclicker_csv_exports"

_DATE_RE = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{2,4})")
_SESSION_PREFIX_RE = re.compile(r"^Class\s+\d+\s*-\s*Attendance", re.IGNORECASE)


def _parse_date(s):
    m = _DATE_RE.search(s)
    if not m:
        return None
    mm, dd, yy = m.groups()
    if len(yy) == 2:
        yy = "20" + yy
    try:
        return datetime(int(yy), int(mm), int(dd))
    except ValueError:
        return None


def classify_csv(path):
    """Return one of 'lecture' / 'lab' / 'discussion' based on weekdays."""
    with open(path, encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = next(reader)
    weekdays = Counter()
    for col in header:
        if not _SESSION_PREFIX_RE.match(col):
            continue
        dt = _parse_date(col)
        if dt:
            weekdays[dt.weekday()] += 1   # Mon=0..Sun=6
    days = set(weekdays.keys())
    # Lab = mix of Tue(1)+Thu(3)
    if 1 in days and 3 in days:
        return "lab", weekdays
    # Lecture = Mon(0) and/or Wed(2) (plus possibly Fri)
    if days <= {0, 2, 4}:
        return "lecture", weekdays
    # Discussion = single weekday (likely Thu)
    if len(days) == 1:
        return "discussion", weekdays
    # Fallback: treat as discussion
    return "discussion", weekdays


def main():
    csvs = sorted(CSV_DIR.glob("*.csv"))
    if not csvs:
        sys.exit(f"No CSVs in {CSV_DIR}")

    print(f"Found {len(csvs)} CSV(s) in {CSV_DIR}\n")

    classified = {}
    for path in csvs:
        kind, weekdays = classify_csv(path)
        wd_names = sorted(["Mon Tue Wed Thu Fri Sat Sun".split()[w]
                           for w in weekdays.keys()])
        print(f"  {path.name}")
        print(f"    weekday distribution: {dict(weekdays)}  ({wd_names})")
        print(f"    -> {kind}")
        if kind in classified:
            print(f"    !! Conflict: '{kind}' already taken by {classified[kind].name}")
            continue
        classified[kind] = path
    print()

    if not classified:
        sys.exit("Could not classify any CSV.")

    print("=" * 70)
    print("Step 1: Ingesting CSVs into DB")
    print("=" * 70)

    section_titles = {
        "lecture":    "[CS10 | Sp26] Lecture",
        "lab":        "[CS10 | Sp26] Lab",
        "discussion": "[CS10 | Sp26] Discussion",
    }

    for kind, path in classified.items():
        section = section_titles[kind]
        print(f"\n  {kind} <- {path.name} (section='{section}')")
        result = write_iclicker_attendance_to_db(
            course_gradescope_id=COURSE_GS_ID,
            section_name=section,
            csv_filepath=str(path),
            course_name=COURSE_NAME,
        )
        print(f"    {result}")

    print()
    print("=" * 70)
    print("Step 2: Running attendance policy")
    print("=" * 70)

    s = SessionLocal()
    try:
        course = s.query(Course).filter(
            Course.gradescope_course_id == COURSE_GS_ID
        ).first()
        if not course:
            sys.exit("Course row missing — ingest didn't create it?")

        policy_result = compute_attendance_scores(s, course.id)
        s.commit()
        print(f"\n  policy result: {policy_result}\n")

        print("=" * 70)
        print("Step 3: Verification")
        print("=" * 70)

        # iClicker assignments and their session counts
        ic_assignments = s.query(Assignment).filter(
            Assignment.course_id == course.id,
            Assignment.assignment_id.like("iclicker:%"),
        ).all()
        print(f"\n  iClicker assignments in course: {len(ic_assignments)}")
        for a in ic_assignments:
            sub_count = s.query(func.count(Submission.id)).filter(
                Submission.assignment_id == a.id
            ).scalar()
            print(f"    [{a.id}] {a.title} | max_points={a.max_points} | "
                  f"submissions={sub_count}")

        # Sample submissions: pick a section, dump first 3
        print("\n  Sample submissions (first iClicker assignment):")
        if ic_assignments:
            sample_assignment = ic_assignments[0]
            sample_subs = s.query(Submission, Student).join(
                Student, Student.id == Submission.student_id
            ).filter(
                Submission.assignment_id == sample_assignment.id
            ).limit(3).all()
            for sub, stu in sample_subs:
                sbq = sub.scores_by_question
                n_sessions = len(sbq) if isinstance(sbq, list) else 0
                statuses = Counter(
                    e.get("status") for e in (sbq if isinstance(sbq, list) else [])
                )
                print(f"    {stu.legal_name:30s} | score={sub.total_score}/{sub.max_points} | "
                      f"sessions_in_json={n_sessions} | statuses={dict(statuses)}")

        # Effective scores summary
        print("\n  Effective attendance scores (per kind):")
        rows = s.query(StudentAttendanceEffectiveScore).filter(
            StudentAttendanceEffectiveScore.course_id == course.id
        ).all()
        by_kind = {}
        for r in rows:
            by_kind.setdefault(r.kind, []).append(r)
        for kind, rs in sorted(by_kind.items()):
            pcts = [float(r.final_percentage or 0) for r in rs]
            attend = [r.attended_sessions for r in rs]
            total = [r.total_required_sessions for r in rs]
            drops = [r.drops_applied for r in rs]
            print(f"\n    {kind} | n_students={len(rs)}")
            print(f"      total_required: min={min(total)} max={max(total)} mode={Counter(total).most_common(1)[0]}")
            print(f"      attended:       min={min(attend)} max={max(attend)} avg={sum(attend)/len(attend):.1f}")
            print(f"      drops_applied:  {Counter(drops).most_common()}")
            print(f"      final_pct:      min={min(pcts):.1f} max={max(pcts):.1f} avg={sum(pcts)/len(pcts):.1f}")

        # Sample 5 students' details across all kinds
        print("\n  Sample students (first 5 alphabetically):")
        students = s.query(Student).filter(
            Student.course_id == course.id
        ).order_by(Student.legal_name).limit(5).all()
        for stu in students:
            print(f"\n    {stu.legal_name} ({stu.email})")
            for r in s.query(StudentAttendanceEffectiveScore).filter(
                StudentAttendanceEffectiveScore.student_id == stu.id
            ).order_by(StudentAttendanceEffectiveScore.kind).all():
                print(f"      {r.kind:10s} attended={r.attended_sessions}/"
                      f"{r.total_required_sessions} drops={r.drops_applied} "
                      f"raw={float(r.raw_percentage or 0):.1f}% "
                      f"final={float(r.final_percentage or 0):.1f}%")
    finally:
        s.close()


if __name__ == "__main__":
    main()
