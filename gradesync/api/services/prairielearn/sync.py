"""
PrairieLearn Sync Module

High-level sync operations for PrairieLearn gradebook data.
"""
from typing import Dict, Any, Optional, List
import logging
import re
from datetime import datetime, timezone
from sqlalchemy.dialects.postgresql import insert

from api.core.db import SessionLocal
from api.core.models import Course, Assignment, Student, Submission
from api.core.ingest import _categorize_assignment
from .client import PrairieLearnClient

logger = logging.getLogger(__name__)


class PrairieLearnSync:
    """
    Sync PrairieLearn grades to database.
    
    Orchestrates:
    - PrairieLearn API access
    - Gradebook retrieval
    - Database persistence
    """
    
    def __init__(
        self,
        api_token: str
    ):
        """
        Initialize PrairieLearn sync.
        
        Args:
            api_token: PrairieLearn API token
        """
        self.pl_client = PrairieLearnClient(api_token=api_token)
    
    def sync_course(
        self,
        course_id: str,
        save_to_db: bool = True,
        target_course_gradescope_id: Optional[str] = None,
        target_course_name: Optional[str] = None,
        course_categories: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """
        Sync a PrairieLearn course.
        
        Args:
            course_id: PrairieLearn course instance ID
            save_to_db: Whether to save to database
            
        Returns:
            Dictionary with sync results
        """
        logger.info(f"Starting PrairieLearn sync for course {course_id}")
        
        try:
            # Get course info
            course_info = self.pl_client.get_course_info(course_id)
            logger.info(f"Course: {course_info.title}")
            
            # Get gradebook
            gradebook_df = self.pl_client.get_gradebook(course_id)
            
            # Get assessments
            assessments = self.pl_client.get_assessments(course_id)
            
            db_result = {
                "enabled": save_to_db,
                "saved": False,
                "assignments_upserted": 0,
                "students_upserted": 0,
                "submissions_upserted": 0,
            }

            if save_to_db:
                db_result = self._save_gradebook_to_db(
                    pl_course_id=course_id,
                    gradebook_rows=gradebook_df.to_dict(orient="records"),
                    assessments=assessments,
                    target_course_gradescope_id=target_course_gradescope_id,
                    target_course_name=target_course_name or course_info.title,
                    course_categories=course_categories,
                )
            
            results = {
                "success": True,
                "course_id": course_id,
                "course_title": course_info.title,
                "assessments_synced": len(assessments),
                "students_synced": len(gradebook_df),
                "database": db_result,
            }
            
            logger.info(f"Sync completed: {results}")
            return results
            
        except Exception as e:
            logger.error(f"Sync failed: {e}")
            raise
        finally:
            self.pl_client.close()
    
    def close(self):
        """Close clients."""
        self.pl_client.close()

    @staticmethod
    def _to_float(value: Any) -> Optional[float]:
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return float(value)
        text = str(value).strip()
        if not text:
            return None

        # Common PrairieLearn gradebook cell shapes:
        # - "17.3 / 25.0"
        # - "17.3/25.0 (69%)"
        if "/" in text:
            numerator = text.split("/", 1)[0].strip()
            match = re.search(r"-?\d+(?:\.\d+)?", numerator)
            if match:
                try:
                    return float(match.group(0))
                except ValueError:
                    pass

        if text.endswith('%'):
            text = text[:-1].strip()
        try:
            return float(text)
        except ValueError:
            match = re.search(r"-?\d+(?:\.\d+)?", text)
            if match:
                try:
                    return float(match.group(0))
                except ValueError:
                    return None
            return None

    @staticmethod
    def _select_score_columns(rows: List[Dict[str, Any]]) -> List[str]:
        if not rows:
            return []
        ignored = {
            "UID",
            "Name",
            "UIN",
            "Role",
            "Enrollment",
        }
        columns = []
        for key in rows[0].keys():
            if key in ignored:
                continue
            columns.append(key)
        return columns

    def _save_gradebook_to_db(
        self,
        pl_course_id: str,
        gradebook_rows: List[Dict[str, Any]],
        assessments: List[Any],
        target_course_gradescope_id: Optional[str],
        target_course_name: Optional[str],
        course_categories: Optional[List[Dict[str, Any]]],
    ) -> Dict[str, Any]:
        session = SessionLocal()
        try:
            course_key = (target_course_gradescope_id or "").strip() or f"pl:{pl_course_id}"
            course = session.query(Course).filter(Course.gradescope_course_id == course_key).first()
            if not course:
                course = Course(
                    gradescope_course_id=course_key,
                    name=target_course_name,
                )
                session.add(course)
                session.flush()
            elif target_course_name and course.name != target_course_name:
                course.name = target_course_name
                session.flush()

            assessments_by_number: Dict[str, Any] = {
                str(a.number).strip(): a for a in assessments if str(getattr(a, "number", "")).strip()
            }
            assessments_by_id: Dict[str, Any] = {
                str(getattr(a, "assessment_id", "")).strip(): a
                for a in assessments
                if str(getattr(a, "assessment_id", "")).strip()
            }

            nested_format = bool(
                gradebook_rows
                and isinstance(gradebook_rows[0], dict)
                and isinstance(gradebook_rows[0].get("assessments"), list)
            )

            score_columns = self._select_score_columns(gradebook_rows)

            assignment_id_by_col: Dict[str, int] = {}
            assignments_upserted = 0

            if nested_format:
                active_assessment_ids = set()
                for row in gradebook_rows:
                    for item in row.get("assessments") or []:
                        points_val = self._to_float(item.get("points"))
                        if points_val is not None:
                            assessment_id = str(item.get("assessment_id") or "").strip()
                            if assessment_id:
                                active_assessment_ids.add(assessment_id)

                for assessment_id in sorted(active_assessment_ids):
                    info = assessments_by_id.get(assessment_id)
                    column = str(getattr(info, "number", "") or assessment_id)
                    title = (getattr(info, "title", "") or assessment_id).strip()
                    category = _categorize_assignment(title, course_categories)
                    max_points = getattr(info, "points", None)
                    if max_points is not None and max_points <= 0:
                        max_points = None

                    metadata = {
                        "source": "prairielearn",
                        "pl_course_id": str(pl_course_id),
                        "pl_assessment_id": assessment_id,
                        "pl_number": getattr(info, "number", None) if info else None,
                        "pl_short_name": getattr(info, "short_name", None) if info else None,
                    }

                    external_assignment_id = f"pl:{pl_course_id}:{assessment_id}"

                    assignment = session.query(Assignment).filter(
                        Assignment.course_id == course.id,
                        Assignment.assignment_id == external_assignment_id,
                    ).first()

                    if not assignment:
                        assignment = Assignment(
                            assignment_id=external_assignment_id,
                            course_id=course.id,
                            title=title,
                            category=category,
                            max_points=max_points,
                            assignment_metadata=metadata,
                            last_synced_at=datetime.now(timezone.utc),
                        )
                        session.add(assignment)
                        session.flush()
                        assignments_upserted += 1
                    else:
                        assignment.title = title
                        assignment.category = category
                        if max_points is not None:
                            assignment.max_points = max_points
                        assignment.assignment_metadata = metadata
                        assignment.last_synced_at = datetime.now(timezone.utc)
                        session.flush()

                    assignment_id_by_col[assessment_id] = assignment.id

                score_columns = sorted(active_assessment_ids)
            else:
                for column in score_columns:
                    assessment = assessments_by_number.get(column)
                    if assessment:
                        external_assignment_id = f"pl:{pl_course_id}:{assessment.assessment_id}"
                        title = assessment.title or column
                        category = _categorize_assignment(title, course_categories)
                        max_points = assessment.points if assessment.points and assessment.points > 0 else None
                        metadata = {
                            "source": "prairielearn",
                            "pl_course_id": str(pl_course_id),
                            "pl_assessment_id": str(assessment.assessment_id),
                            "pl_number": assessment.number,
                            "pl_short_name": assessment.short_name,
                        }
                    else:
                        external_assignment_id = f"pl:{pl_course_id}:col:{column}"
                        title = column
                        category = _categorize_assignment(title, course_categories)
                        max_points = None
                        metadata = {
                            "source": "prairielearn",
                            "pl_course_id": str(pl_course_id),
                            "pl_assessment_id": None,
                            "pl_number": column,
                            "pl_short_name": None,
                        }

                    assignment = session.query(Assignment).filter(
                        Assignment.course_id == course.id,
                        Assignment.assignment_id == external_assignment_id,
                    ).first()

                    if not assignment:
                        assignment = Assignment(
                            assignment_id=external_assignment_id,
                            course_id=course.id,
                            title=title,
                            category=category,
                            max_points=max_points,
                            assignment_metadata=metadata,
                            last_synced_at=datetime.now(timezone.utc),
                        )
                        session.add(assignment)
                        session.flush()
                        assignments_upserted += 1
                    else:
                        assignment.title = title
                        assignment.category = category
                        if max_points is not None:
                            assignment.max_points = max_points
                        assignment.assignment_metadata = metadata
                        assignment.last_synced_at = datetime.now(timezone.utc)
                        session.flush()

                    assignment_id_by_col[column] = assignment.id

            students_data = []
            for row in gradebook_rows:
                role = str(row.get("Role", row.get("user_role", ""))).strip().lower()
                if role and role != "student":
                    continue

                email = str(row.get("UID", row.get("user_uid", ""))).strip()
                if not email:
                    continue

                students_data.append({
                    "course_id": course.id,
                    "email": email,
                    "sid": str(row.get("UIN", row.get("user_uin", "")) or "").strip() or None,
                    "legal_name": str(row.get("Name", row.get("user_name", "")) or "").strip() or None,
                })

            if students_data:
                stmt = insert(Student).values(students_data)
                stmt = stmt.on_conflict_do_update(
                    constraint='uq_student_email_course',
                    set_={
                        'sid': stmt.excluded.sid,
                        'legal_name': stmt.excluded.legal_name,
                    }
                )
                session.execute(stmt)
                session.commit()

            students = session.query(Student).filter(Student.course_id == course.id).all()
            student_id_by_email = {s.email: s.id for s in students if s.email}

            submissions_data = []
            for row in gradebook_rows:
                role = str(row.get("Role", row.get("user_role", ""))).strip().lower()
                if role and role != "student":
                    continue

                email = str(row.get("UID", row.get("user_uid", ""))).strip()
                student_id = student_id_by_email.get(email)
                if not student_id:
                    continue

                enrollment = str(row.get("Enrollment", "") or "").strip()
                if nested_format:
                    for item in row.get("assessments") or []:
                        assessment_id = str(item.get("assessment_id") or "").strip()
                        assignment_db_id = assignment_id_by_col.get(assessment_id)
                        if not assignment_db_id:
                            continue

                        score = self._to_float(item.get("points"))
                        if score is None:
                            continue

                        submissions_data.append({
                            "assignment_id": assignment_db_id,
                            "student_id": student_id,
                            "total_score": score,
                            "max_points": self._to_float(item.get("max_points")),
                            "status": enrollment or "Recorded",
                            "submission_id": str(item.get("assessment_instance_id") or "") or None,
                            "submission_time": None,
                            "lateness": None,
                            "view_count": None,
                            "submission_count": None,
                            "scores_by_question": {
                                "source": "prairielearn",
                                "assessment_number": item.get("assessment_number"),
                                "assessment_label": item.get("assessment_label"),
                                "assessment_name": item.get("assessment_name"),
                                "score_perc": self._to_float(item.get("score_perc")),
                            },
                        })
                else:
                    for column, assignment_db_id in assignment_id_by_col.items():
                        score = self._to_float(row.get(column))
                        if score is None:
                            continue

                        submissions_data.append({
                            "assignment_id": assignment_db_id,
                            "student_id": student_id,
                            "total_score": score,
                            "max_points": None,
                            "status": enrollment or "Recorded",
                            "submission_id": None,
                            "submission_time": None,
                            "lateness": None,
                            "view_count": None,
                            "submission_count": None,
                            "scores_by_question": {
                                "source": "prairielearn",
                                "column": column,
                            },
                        })

            if submissions_data:
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
                session.execute(stmt)

            session.commit()

            return {
                "enabled": True,
                "saved": True,
                "course_db_id": course.id,
                "course_key": course_key,
                "score_columns_detected": len(score_columns),
                "assignments_upserted": assignments_upserted,
                "students_upserted": len(student_id_by_email),
                "submissions_upserted": len(submissions_data),
            }
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()
