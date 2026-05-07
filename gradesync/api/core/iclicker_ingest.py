"""
iClicker attendance ingest.

Parses an iClicker attendance CSV (one section / course at a time) and upserts
Course / Assignment / Student / Submission rows.

Modeling decision: each iClicker section (Lecture / Lab / Discussion) is stored
as a single Assignment with category="Attendance". A student's total_score is
(Present + Excused) and max_points is the number of tracked sessions. Per-session
status is preserved in scores_by_question.
"""
import io
import csv
import os
import logging
from typing import Optional, List

from .db import SessionLocal, init_db
from .models import Course, Assignment, Student, Submission

logger = logging.getLogger(__name__)


# Columns that are NOT per-session attendance columns
_NON_SESSION_COLS = {
    "First Name", "Last Name", "Student Name", "Name",
    "Student ID", "SIS ID", "SID", "Email", "User Name", "Username",
    "Total Absent", "Total Present", "Total Excused",
    "Total Tracked", "Sections", "Section",
    "Remote ID", "Remote", "iClicker Remote ID",
}

_PRESENT_VALUES = {"PRESENT", "EXCUSED", "P", "E"}
_ABSENT_VALUES = {"ABSENT", "A"}


def _norm(v) -> str:
    return (v or "").strip()


def _to_int(v) -> Optional[int]:
    s = _norm(v)
    if not s:
        return None
    try:
        return int(float(s))
    except ValueError:
        return None


def _build_full_name(row: dict) -> Optional[str]:
    name = _norm(row.get("Student Name") or row.get("Name"))
    if name:
        return name
    first = _norm(row.get("First Name"))
    last = _norm(row.get("Last Name"))
    full = f"{first} {last}".strip()
    return full or None


def _extract_sid(row: dict) -> Optional[str]:
    for key in ("Student ID", "SIS ID", "SID"):
        v = _norm(row.get(key))
        if v:
            return v
    return None


def write_iclicker_attendance_to_db(
    course_gradescope_id: str,
    section_name: str,
    csv_filepath: str,
    course_name: Optional[str] = None,
    course_categories: Optional[List[dict]] = None,
) -> dict:
    """Parse an iClicker attendance CSV and upsert rows.

    Args:
        course_gradescope_id: External course id used to locate / create Course.
        section_name: Human-readable section title from iClicker
            (e.g. "[CS10 | Sp25] Lecture"). Used as both Assignment.title and
            Assignment.assignment_id (prefixed) since iClicker has no numeric id.
        csv_filepath: Path to the downloaded CSV.
        course_name: Optional course name (only used when creating Course).
        course_categories: Currently unused (Attendance is its own category).

    Returns:
        Dict with counts: students_processed, sessions, max_points.
    """
    init_db()
    session = SessionLocal()

    try:
        course = session.query(Course).filter(
            Course.gradescope_course_id == course_gradescope_id
        ).first()
        if not course:
            course = Course(
                gradescope_course_id=course_gradescope_id,
                name=course_name,
            )
            session.add(course)
            session.flush()

        # iClicker has no numeric assignment id; namespace by section name so
        # multiple sections coexist as distinct Assignments under one course.
        ic_assignment_id = f"iclicker:{section_name}"
        assignment = session.query(Assignment).filter(
            Assignment.assignment_id == ic_assignment_id,
            Assignment.course_id == course.id,
        ).first()
        # Category prefixed with '_' so the dashboard hides it. The roll-up
        # "Attendance / Participation" Assignment is created by attendance_policy
        # — the per-section iClicker assignments are kept only for audit.
        if not assignment:
            assignment = Assignment(
                assignment_id=ic_assignment_id,
                course_id=course.id,
                title=section_name,
                category="_attendance_raw",
            )
            session.add(assignment)
            session.flush()
        else:
            assignment.title = section_name
            assignment.category = "_attendance_raw"

        with open(csv_filepath, "rb") as fh:
            content = fh.read().decode("utf-8-sig", errors="replace")

        reader = csv.DictReader(io.StringIO(content))
        if not reader.fieldnames:
            raise ValueError(f"iClicker CSV has no header: {csv_filepath}")

        # Session columns are everything that isn't a known metadata column.
        session_cols = [
            f for f in reader.fieldnames
            if f and f.strip() and f not in _NON_SESSION_COLS
        ]

        rows = list(reader)

        # Compute the section's session count from the row that tracked the most
        # (handles students who joined mid-term and were tracked for fewer days).
        max_tracked = 0
        for row in rows:
            tracked = (
                (_to_int(row.get("Total Absent")) or 0)
                + (_to_int(row.get("Total Present")) or 0)
                + (_to_int(row.get("Total Excused")) or 0)
            )
            if tracked > max_tracked:
                max_tracked = tracked

        max_points = max_tracked or len(session_cols) or None
        if max_points:
            assignment.max_points = max_points

        students_processed = 0

        for row in rows:
            name = _build_full_name(row)
            sid = _extract_sid(row)
            email = _norm(row.get("Email")) or None

            # Skip blank rows / footers
            if not name and not sid and not email:
                continue

            student = None
            if email:
                student = session.query(Student).filter(
                    Student.course_id == course.id,
                    Student.email == email,
                ).first()
            if not student and sid:
                student = session.query(Student).filter(
                    Student.course_id == course.id,
                    Student.sid == sid,
                ).first()

            if not student:
                if not (email or sid):
                    continue
                student = Student(
                    course_id=course.id,
                    sid=sid,
                    email=email,
                    legal_name=name,
                )
                session.add(student)
                session.flush()
            else:
                if email and student.email != email:
                    student.email = email
                if sid and student.sid != sid:
                    student.sid = sid
                if name and student.legal_name != name:
                    student.legal_name = name

            present = _to_int(row.get("Total Present")) or 0
            excused = _to_int(row.get("Total Excused")) or 0
            absent = _to_int(row.get("Total Absent")) or 0
            tracked = present + excused + absent

            # Fall back to counting per-session columns if totals are missing
            if tracked == 0 and session_cols:
                for col in session_cols:
                    val = _norm(row.get(col)).upper()
                    if val in _PRESENT_VALUES:
                        present += 1
                        tracked += 1
                    elif val in _ABSENT_VALUES:
                        absent += 1
                        tracked += 1

            total_score = present + excused
            row_max = tracked or max_points

            # Store as ordered list with explicit ordinals so downstream policy
            # can map "the Nth lecture session" deterministically. iClicker
            # exports session columns in chronological order.
            scores_by_session = [
                {
                    "ordinal": idx,
                    "date": col,
                    "status": _norm(row.get(col)).upper() or "UNKNOWN",
                }
                for idx, col in enumerate(session_cols, start=1)
            ]

            existing = session.query(Submission).filter(
                Submission.assignment_id == assignment.id,
                Submission.student_id == student.id,
            ).first()

            if existing:
                existing.total_score = total_score
                existing.max_points = row_max
                existing.status = "Graded"
                existing.scores_by_question = scores_by_session
            else:
                session.add(Submission(
                    assignment_id=assignment.id,
                    student_id=student.id,
                    total_score=total_score,
                    max_points=row_max,
                    status="Graded",
                    scores_by_question=scores_by_session,
                ))

            students_processed += 1

        student_count = session.query(Student).filter(
            Student.course_id == course.id
        ).count()
        if course.number_of_students != student_count:
            course.number_of_students = student_count

        session.commit()
        logger.info(
            "Ingested iClicker section '%s' for course %s: %d students, %d sessions",
            section_name, course_gradescope_id, students_processed, max_points or 0,
        )
        return {
            "section": section_name,
            "students_processed": students_processed,
            "sessions": max_points or 0,
            "max_points": max_points,
        }
    except Exception as e:
        session.rollback()
        logger.exception("Failed to ingest iClicker CSV %s: %s", csv_filepath, e)
        raise
    finally:
        session.close()
