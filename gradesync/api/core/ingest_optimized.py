"""
Optimized ingestion module with batch operations and incremental sync support.
"""
import io
import csv
import logging
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
from sqlalchemy import and_
from sqlalchemy.dialects.postgresql import insert
from .db import SessionLocal
from .models import Course, Assignment, Student, Submission
from .ingest import _categorize_assignment

logger = logging.getLogger(__name__)

def _ts():
    """Return current timestamp for debug logs."""
    return datetime.now().strftime('%H:%M:%S.%f')[:-3]


def should_sync_assignment(
    session, 
    course_id: int, 
    assignment_id: str, 
    force_sync: bool = False,
    sync_if_older_than_hours: int = 24
) -> bool:
    """
    Check if an assignment needs to be synced based on last sync time.
    
    Args:
        session: Database session
        course_id: Internal course ID
        assignment_id: Gradescope assignment ID
        force_sync: If True, always sync regardless of last sync time
        sync_if_older_than_hours: Sync if last sync was more than N hours ago
        
    Returns:
        True if assignment should be synced, False otherwise
    """
    if force_sync:
        return True
    
    assignment = session.query(Assignment).filter(
        Assignment.assignment_id == str(assignment_id),
        Assignment.course_id == course_id
    ).first()
    
    if not assignment or not assignment.last_synced_at:
        # Never synced before, must sync
        return True
    
    # Check if last sync was too long ago
    now = datetime.now(timezone.utc)
    hours_since_sync = (now - assignment.last_synced_at).total_seconds() / 3600
    
    return hours_since_sync >= sync_if_older_than_hours


def batch_upsert_submissions(
    session,
    assignment_db_id: int,
    submissions_data: List[Dict[str, Any]]
) -> int:
    """
    Batch upsert submissions using PostgreSQL's ON CONFLICT.
    Much faster than individual inserts.
    
    Args:
        session: Database session
        assignment_db_id: Database ID of the assignment
        submissions_data: List of submission dicts
        
    Returns:
        Number of submissions upserted
    """
    if not submissions_data:
        return 0
    
    # Prepare data for bulk upsert
    for sub in submissions_data:
        sub['assignment_id'] = assignment_db_id
    
    # Use PostgreSQL INSERT ... ON CONFLICT DO UPDATE
    try:
        stmt = insert(Submission).values(submissions_data)
        stmt = stmt.on_conflict_do_update(
            constraint='uq_assignment_student',
            set_={
                'total_score': stmt.excluded.total_score,
                'max_points': stmt.excluded.max_points,
                'status': stmt.excluded.status,
                'submission_id': stmt.excluded.submission_id,
                'submission_time': stmt.excluded.submission_time,
                'lateness': stmt.excluded.lateness,
                'view_count': stmt.excluded.view_count,
                'submission_count': stmt.excluded.submission_count,
                'scores_by_question': stmt.excluded.scores_by_question,
            }
        )
        
        logger.info(f"[INFO] Executing batch upsert for {len(submissions_data)} submissions")
        result = session.execute(stmt)
        logger.info(f"[INFO] Batch execute completed, committing...")
        session.commit()
        logger.info(f"[INFO] Batch commit completed")
        
        logger.info(f"Batch upserted {len(submissions_data)} submissions")
        return len(submissions_data)
    except Exception as e:
        logger.error(f"[INFO] Error in batch_upsert_submissions: {e}")
        session.rollback()
        raise


def batch_upsert_students(
    session,
    course_db_id: int,
    students_data: List[Dict[str, str]]
) -> Dict[str, int]:
    """
    Batch upsert students and return mapping of email -> student_id.
    
    Args:
        session: Database session
        students_data: List of student dicts with 'sid' and 'email'
        
    Returns:
        Dict mapping email to student_id
    """
    if not students_data:
        return {}
    
    # Use PostgreSQL INSERT ... ON CONFLICT DO NOTHING
    stmt = insert(Student).values(students_data)
    stmt = stmt.on_conflict_do_nothing(constraint='uq_student_email_course')
    
    session.execute(stmt)
    session.commit()
    
    # Query to get all student IDs
    emails = [s['email'] for s in students_data]
    students = session.query(Student).filter(
        Student.course_id == course_db_id,
        Student.email.in_(emails)
    ).all()
    
    email_to_id = {s.email: s.id for s in students}
    logger.info(f"Batch processed {len(students_data)} students")
    
    return email_to_id


def write_assignment_scores_optimized(
    course_gradescope_id: str,
    assignment_id: str,
    assignment_name: str,
    csv_content: str,
    course_config: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    logger.info(f"[INFO] [{_ts()}] === Entered write_assignment_scores_optimized for {assignment_name} ===")
    """
    Optimized version of write_assignment_scores_to_db with batch operations.
    
    Args:
        course_gradescope_id: Gradescope course ID
        assignment_id: Gradescope assignment ID
        assignment_name: Assignment title
        csv_content: CSV content as string
        course_config: Optional course configuration
        
    Returns:
        Dict with sync results
    """
    import time as _time
    _fn_start = _time.time()
    # print(f"[{_ts()}] DB: Starting write_assignment_scores_optimized for {assignment_name}")
    
    logger.info(f"[INFO] [{_ts()}] Attempting to create DB session for {assignment_name}...")
    session = SessionLocal()
    logger.info(f"[INFO] [{_ts()}] DB session created successfully for {assignment_name} ({_time.time() - _fn_start:.2f}s)")
    
    try:
        # Get or create course
        _step_start = _time.time()
        course = session.query(Course).filter(
            Course.gradescope_course_id == course_gradescope_id
        ).first()
        # print(f"[{_ts()}] DB: Course query ({_time.time() - _step_start:.2f}s)")
        
        if not course:
                logger.info(f"Course {course_gradescope_id} not found, creating...")

                course_name = None
                department = None
                course_number = None
                semester = None
                year = None
                instructor = None

                if course_config:
                    course_name = course_config.get('name')
                    department = course_config.get('department')
                    course_number = course_config.get('course_number')
                    semester = course_config.get('semester')
                    year = course_config.get('year')
                    instructor = course_config.get('instructor')

                course = Course(
                    gradescope_course_id=course_gradescope_id,
                    name=course_name,
                    department=department,
                    course_number=course_number,
                    semester=semester,
                    year=year,
                    instructor=instructor,
                )
                session.add(course)
                session.flush()
                logger.info(f"Created course {course_gradescope_id} with DB id {course.id}")
        else:
                if course_config:
                    updated = False
                    course_name = course_config.get('name')
                    department = course_config.get('department')
                    course_number = course_config.get('course_number')
                    semester = course_config.get('semester')
                    year = course_config.get('year')
                    instructor = course_config.get('instructor')

                    if course_name and course.name != course_name:
                        course.name = course_name
                        updated = True
                    if department and course.department != department:
                        course.department = department
                        updated = True
                    if course_number and course.course_number != course_number:
                        course.course_number = course_number
                        updated = True
                    if semester and course.semester != semester:
                        course.semester = semester
                        updated = True
                    if year and course.year != year:
                        course.year = year
                        updated = True
                    if instructor and course.instructor != instructor:
                        course.instructor = instructor
                        updated = True

                    if updated:
                        session.flush()
        
        # Get or create assignment
        _step_start = _time.time()
        assignment = session.query(Assignment).filter(
            Assignment.assignment_id == str(assignment_id),
            Assignment.course_id == course.id
        ).first()
        # print(f"[{_ts()}] DB: Assignment query ({_time.time() - _step_start:.2f}s)")
        
        course_categories = None
        if course_config and isinstance(course_config, dict):
            course_categories = course_config.get('assignment_categories')
        category = _categorize_assignment(assignment_name, course_categories)

        if not assignment:
            assignment = Assignment(
                assignment_id=str(assignment_id),
                course_id=course.id,
                title=assignment_name,
                category=category,
            )
            session.add(assignment)
            session.flush()
        else:
            updated_assignment = False
            if assignment.title != assignment_name:
                assignment.title = assignment_name
                updated_assignment = True
            if category and assignment.category != category:
                assignment.category = category
                updated_assignment = True
            if updated_assignment:
                session.flush()
        
        # Parse CSV
        reader = csv.DictReader(io.StringIO(csv_content))
        fieldnames = reader.fieldnames or []
        primary_name_column = fieldnames[0] if fieldnames else "Name"

        known_columns = {
            primary_name_column,
            'SID',
            'Email',
            'Sections',
            'Total Score',
            'Max Points',
            'Status',
            'Submission ID',
            'Submission Time',
            'Lateness (H:M:S)',
            'View Count',
            'Submission Count',
        }

        question_columns = [
            column_name for column_name in fieldnames
            if column_name and column_name not in known_columns
        ]

        def parse_float(value: Any) -> Optional[float]:
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

        def parse_int(value: Any) -> Optional[int]:
            if value is None:
                return None
            if isinstance(value, int):
                return value
            text = str(value).strip()
            if not text:
                return None
            try:
                return int(float(text))
            except ValueError:
                return None
        
        # Collect data for batch operations
        students_data = []
        submissions_data = []
        seen_emails = set()
        assignment_max_points = 0.0
        question_categories: Dict[str, str] = {}
        question_max_points: Dict[str, float] = {}
        
        for row in reader:
            email_raw = str(row.get('Email', '') or '').strip()
            sid = str(row.get('SID', '') or '').strip()

            row_marker_source = email_raw or str(row.get(primary_name_column, '') or '').strip()
            row_marker = row_marker_source.strip().upper()

            if row_marker == 'CATEGORY':
                for question_column in question_columns:
                    category_value = str(row.get(question_column, '') or '').strip()
                    if category_value:
                        question_categories[question_column] = category_value
                continue

            if row_marker in {'MAX POINTS', 'MAX_POINTS', 'MAXPOINTS'}:
                for question_column in question_columns:
                    max_points_value = parse_float(row.get(question_column))
                    if max_points_value is not None:
                        question_max_points[question_column] = max_points_value
                continue

            email = email_raw
            
            if not email or email in seen_emails:
                continue
            
            seen_emails.add(email)
            
            # Student data
            students_data.append({
                'course_id': course.id,
                'email': email,
                'sid': sid,
                'legal_name': row.get(primary_name_column, '') if fieldnames else ''
            })
            
            per_question_scores: Dict[str, float] = {}
            for question_column in question_columns:
                question_score = parse_float(row.get(question_column))
                if question_score is not None:
                    per_question_scores[question_column] = question_score

            parsed_max_points = parse_float(row.get('Max Points'))
            if parsed_max_points is None and question_max_points:
                parsed_max_points = float(sum(question_max_points.values()))

            if parsed_max_points and parsed_max_points > assignment_max_points:
                assignment_max_points = parsed_max_points

            total_score = parse_float(row.get('Total Score'))
            if total_score is None and per_question_scores:
                total_score = float(sum(per_question_scores.values()))

            # Submission data (will add student_id later)
            submission = {
                'total_score': total_score,
                'max_points': parsed_max_points,
                'status': row.get('Status', ''),
                'submission_id': row.get('Submission ID', ''),
                'submission_time': None,  # Initialize to None, will be set if parsing succeeds
                'lateness': row.get('Lateness (H:M:S)', ''),
                'view_count': parse_int(row.get('View Count')),
                'submission_count': parse_int(row.get('Submission Count')),
                'scores_by_question': per_question_scores,
            }
            
            # Parse submission time, expecting "YYYY-MM-DD HH:MM:SS ZZZZ" format
            sub_time_str = row.get('Submission Time', '')
            if sub_time_str:
                try:
                    # This handles formats like "2025-09-17 15:38:04 -0700"
                    parsed_time = datetime.strptime(sub_time_str, "%Y-%m-%d %H:%M:%S %z")
                    submission['submission_time'] = parsed_time
                except ValueError:
                    # If parsing fails, keep submission_time as None
                    logger.warning(f"Failed to parse submission time '{sub_time_str}' for {email}")
            
            submissions_data.append({**submission, 'email': email})

        assignment_metadata = assignment.assignment_metadata if isinstance(assignment.assignment_metadata, dict) else {}
        if question_columns:
            assignment_metadata['scores_schema'] = 'per_question_columns'
            assignment_metadata['components'] = [
                {
                    'key': question_column,
                    'category': question_categories.get(question_column),
                    'max_points': question_max_points.get(question_column),
                    'display_order': idx,
                }
                for idx, question_column in enumerate(question_columns)
            ]
            assignment.assignment_metadata = assignment_metadata

        if assignment_max_points <= 0 and question_max_points:
            assignment_max_points = float(sum(question_max_points.values()))

        if assignment_max_points > 0 and (
            assignment.max_points is None
            or float(assignment.max_points or 0) <= 0
            or float(assignment.max_points or 0) != assignment_max_points
        ):
            assignment.max_points = assignment_max_points
            session.flush()
        
        # Batch upsert students
        logger.info(f"[INFO] Starting batch_upsert_students for {assignment_name}")
        email_to_id = batch_upsert_students(session, course.id, students_data)
        logger.info(f"[INFO] batch_upsert_students completed, got {len(email_to_id)} student IDs")
        
        # Add student_id to submissions and remove email
        logger.info(f"[INFO] Preparing final submissions for {assignment_name}")
        final_submissions = []
        for sub in submissions_data:
            email = sub.pop('email')
            student_id = email_to_id.get(email)
            if student_id:
                sub['student_id'] = student_id
                final_submissions.append(sub)
        logger.info(f"[INFO] Prepared {len(final_submissions)} final submissions")
        
        # Batch upsert submissions
        logger.info(f"[INFO] Starting batch_upsert_submissions for {assignment_name}")
        num_submissions = batch_upsert_submissions(
            session,
            assignment.id,
            final_submissions
        )
        logger.info(f"[INFO] batch_upsert_submissions completed, processed {num_submissions} submissions")
        
        # Update assignment sync timestamp
        logger.info(f"[INFO] Updating last_synced_at for {assignment_name}")
        assignment.last_synced_at = datetime.now(timezone.utc)
        session.commit()
        logger.info(f"[INFO] Session committed for {assignment_name}")
        
        logger.info(f"Successfully synced {assignment_name}: {num_submissions} submissions")
        
        return {
            "success": True,
            "assignment_name": assignment_name,
            "students_processed": len(students_data),
            "submissions_processed": num_submissions
        }
        
    except Exception as e:
        session.rollback()
        logger.error(f"Error syncing {assignment_name}: {e}")
        return {
            "success": False,
            "error": str(e)
        }
    
    finally:
        session.close()
