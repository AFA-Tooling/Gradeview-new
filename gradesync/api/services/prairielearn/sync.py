"""
PrairieLearn Sync Module

High-level sync operations for PrairieLearn gradebook data.
"""
from typing import Dict, Any, Optional, List
import logging
import re
import math
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

    _QUEST_COMPONENT_ORDER = [
        "Abstraction",
        "Number Representation",
        "Iteration",
        "Domain and Range",
        "Booleans",
        "Functions",
        "HOFs I",
    ]

    @classmethod
    def _normalize_component_name(cls, question_topic: Any, question_name: Any) -> Optional[str]:
        topic_text = str(question_topic or "").strip()
        name_text = str(question_name or "").strip()

        generic_topics = {"other", "template", "misc", "general"}
        if topic_text.lower() in generic_topics and name_text:
            candidate = name_text.rsplit("/", 1)[-1]
        else:
            candidate = topic_text or name_text.rsplit("/", 1)[-1]

        normalized = candidate.lower().replace("-", " ").replace("_", " ").replace("/", " ").strip()
        normalized = re.sub(r"\s+", " ", normalized)

        aliases = {
            "abstraction": "Abstraction",
            "number representation": "Number Representation",
            "iteration": "Iteration",
            "domain and range": "Domain and Range",
            "domain range": "Domain and Range",
            "booleans": "Booleans",
            "boolean": "Booleans",
            "functions": "Functions",
            "function": "Functions",
            "function ordering": "Functions",
            "hofs i": "HOFs I",
            "hof i": "HOFs I",
            "hofs": "HOFs I",
            "hof": "HOFs I",
            "higher order functions": "HOFs I",
            "higher-order functions": "HOFs I",
            "binary hex dec": "Number Representation",
            "binary hexadecimal decimal": "Number Representation",
            "number systems": "Number Representation",
        }
        direct = aliases.get(normalized)
        if direct:
            return direct

        for key, mapped in aliases.items():
            if key in normalized:
                return mapped

        for item in cls._QUEST_COMPONENT_ORDER:
            if item.lower() in normalized:
                return item

        return None

    def _collect_quest_component_scores(
        self,
        pl_course_id: str,
        gradebook_rows: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        assessment_instance_meta: Dict[str, Dict[str, str]] = {}

        for row in gradebook_rows:
            for item in row.get("assessments") or []:
                assessment_name = str(item.get("assessment_name") or "").strip().lower()
                if "quest" not in assessment_name or "practice" in assessment_name:
                    continue

                attempt_no = self._to_float(item.get("assessment_number"))
                if attempt_no not in (1.0, 2.0, 3.0):
                    continue

                instance_id = str(item.get("assessment_instance_id") or "").strip()
                assessment_id = str(item.get("assessment_id") or "").strip()
                if not instance_id or not assessment_id:
                    continue

                assessment_instance_meta[instance_id] = {
                    "assessment_id": assessment_id,
                }

        instance_component_map: Dict[str, Dict[str, Any]] = {}
        assessment_component_caps: Dict[str, Dict[str, float]] = {}

        for instance_id, meta in assessment_instance_meta.items():
            full_component_caps: Dict[str, float] = {}
            try:
                instance_questions = self.pl_client._call_api(
                    f"/course_instances/{pl_course_id}/assessment_instances/{instance_id}/instance_questions"
                )
                for question in instance_questions if isinstance(instance_questions, list) else []:
                    component_name = self._normalize_component_name(
                        question.get("question_topic") or question.get("topic"),
                        question.get("question_name") or question.get("title") or question.get("name"),
                    )
                    if not component_name:
                        continue

                    cap = (
                        self._to_float(question.get("assessment_question_max_points"))
                        or self._to_float(question.get("max_points"))
                        or self._to_float(question.get("points"))
                    )
                    if cap is None:
                        continue

                    full_component_caps[component_name] = float(full_component_caps.get(component_name, 0.0)) + float(cap)
            except Exception as exc:
                logger.warning(
                    "Failed to fetch PrairieLearn instance questions for %s: %s",
                    instance_id,
                    exc,
                )

            try:
                submissions = self.pl_client._call_api(
                    f"/course_instances/{pl_course_id}/assessment_instances/{instance_id}/submissions"
                )
            except Exception as exc:
                logger.warning(
                    "Failed to fetch PrairieLearn instance submissions for %s: %s",
                    instance_id,
                    exc,
                )
                continue

            best_by_question: Dict[str, Dict[str, Any]] = {}
            for submission in submissions if isinstance(submissions, list) else []:
                component_name = self._normalize_component_name(
                    submission.get("question_topic"),
                    submission.get("question_name"),
                )
                if not component_name:
                    continue

                question_key = str(
                    submission.get("instance_question_id")
                    or submission.get("question_id")
                    or ""
                ).strip()
                if not question_key:
                    continue

                points = self._to_float(submission.get("instance_question_points"))
                cap = self._to_float(submission.get("assessment_question_max_points"))
                if points is None:
                    continue

                old = best_by_question.get(question_key)
                if not old or points > float(old.get("points", 0.0)):
                    best_by_question[question_key] = {
                        "component": component_name,
                        "points": points,
                        "cap": cap,
                    }

            component_scores: Dict[str, float] = {}
            component_caps: Dict[str, float] = {}
            for entry in best_by_question.values():
                component = entry["component"]
                component_scores[component] = float(component_scores.get(component, 0.0)) + float(entry.get("points", 0.0))
                cap_value = entry.get("cap")
                if cap_value is not None:
                    component_caps[component] = float(component_caps.get(component, 0.0)) + float(cap_value)

            if full_component_caps:
                component_caps = {**full_component_caps}
                for component_name in full_component_caps.keys():
                    component_scores.setdefault(component_name, 0.0)

            instance_component_map[instance_id] = {
                "component_scores": component_scores,
                "component_caps": component_caps,
            }

            assessment_id = meta.get("assessment_id")
            if assessment_id:
                caps_for_assessment = assessment_component_caps.setdefault(assessment_id, {})
                for component, cap_value in component_caps.items():
                    old_cap = caps_for_assessment.get(component)
                    if old_cap is None or cap_value > old_cap:
                        caps_for_assessment[component] = cap_value

        return {
            "instance_component_map": instance_component_map,
            "assessment_component_caps": assessment_component_caps,
        }

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
    def _round_up_score(value: Any) -> Optional[float]:
        numeric = PrairieLearnSync._to_float(value)
        if numeric is None:
            return None
        if not math.isfinite(numeric):
            return None
        return float(math.ceil(numeric))

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

            quest_component_data = {
                "instance_component_map": {},
                "assessment_component_caps": {},
            }
            if nested_format:
                quest_component_data = self._collect_quest_component_scores(pl_course_id, gradebook_rows)

            instance_component_map = quest_component_data.get("instance_component_map", {})
            assessment_component_caps = quest_component_data.get("assessment_component_caps", {})

            score_columns = self._select_score_columns(gradebook_rows)

            assignment_id_by_col: Dict[str, int] = {}
            assignments_upserted = 0

            if nested_format:
                active_assessment_ids = set()
                assessment_max_points: Dict[str, float] = {}
                for row in gradebook_rows:
                    for item in row.get("assessments") or []:
                        points_val = self._to_float(item.get("points"))
                        if points_val is not None:
                            assessment_id = str(item.get("assessment_id") or "").strip()
                            if assessment_id:
                                active_assessment_ids.add(assessment_id)
                        max_points_val = self._to_float(item.get("max_points"))
                        assessment_id_for_max = str(item.get("assessment_id") or "").strip()
                        if assessment_id_for_max and max_points_val is not None and max_points_val > 0:
                            old_max = assessment_max_points.get(assessment_id_for_max)
                            if old_max is None or max_points_val > old_max:
                                assessment_max_points[assessment_id_for_max] = max_points_val

                for assessment_id in sorted(active_assessment_ids):
                    info = assessments_by_id.get(assessment_id)
                    column = str(getattr(info, "number", "") or assessment_id)
                    title = (getattr(info, "title", "") or assessment_id).strip()
                    category = _categorize_assignment(title, course_categories)
                    max_points = assessment_max_points.get(assessment_id)
                    if max_points is None:
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

                    component_caps = assessment_component_caps.get(assessment_id) or {}
                    if component_caps:
                        metadata["scores_schema"] = "quest_components"
                        metadata["components"] = [
                            {
                                "key": component_name,
                                "max_points": float(component_caps.get(component_name, 0.0)),
                                "display_order": idx,
                            }
                            for idx, component_name in enumerate(self._QUEST_COMPONENT_ORDER)
                            if component_name in component_caps
                        ]

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

                        score = self._round_up_score(item.get("points"))
                        if score is None:
                            continue

                        instance_id = str(item.get("assessment_instance_id") or "").strip()
                        component_data = instance_component_map.get(instance_id) if instance_id else None

                        scores_payload = {
                            "source": "prairielearn",
                            "assessment_number": item.get("assessment_number"),
                            "assessment_label": item.get("assessment_label"),
                            "assessment_name": item.get("assessment_name"),
                            "score_perc": self._to_float(item.get("score_perc")),
                        }
                        if component_data:
                            for component_name, component_score in (component_data.get("component_scores") or {}).items():
                                numeric_component = self._to_float(component_score)
                                scores_payload[component_name] = numeric_component if numeric_component is not None else 0.0
                            caps_from_instance = component_data.get("component_caps") or {}
                            caps_from_assessment = assessment_component_caps.get(assessment_id) or {}
                            component_caps = {**caps_from_instance, **caps_from_assessment}
                            if component_caps:
                                scores_payload["component_caps"] = component_caps
                                for component_name in component_caps.keys():
                                    scores_payload.setdefault(component_name, 0.0)

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
                            "scores_by_question": scores_payload,
                        })
                else:
                    for column, assignment_db_id in assignment_id_by_col.items():
                        score = self._round_up_score(row.get(column))
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
