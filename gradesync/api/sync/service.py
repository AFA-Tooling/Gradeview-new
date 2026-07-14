"""
Unified Grade Sync Service

Orchestrates grade synchronization across all platforms:
- Gradescope
- PrairieLearn
- iClicker
"""
import logging
import sys
import os
import json
from pathlib import Path
from typing import Optional, Dict, List, Any, Callable
from datetime import datetime, timezone

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from api.config_manager import get_course_config, get_config_manager, EnvConfig
from api.core.db import SessionLocal, engine
from api.core.models import Course, SyncRun
from sqlalchemy import String, cast, or_, text

logger = logging.getLogger(__name__)

SYNC_LOCK_NAMESPACE = int(os.getenv("GRADESYNC_LOCK_NAMESPACE", "734501"))


class SyncAlreadyRunningError(RuntimeError):
    """Raised when a course-level sync lock is already held."""


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _json_safe(payload: Any) -> Any:
    return json.loads(json.dumps(payload, default=str))


class GradeSyncResult:
    """Result of a grade sync operation."""
    
    def __init__(self, source: str, success: bool, message: str, details: Optional[Dict] = None):
        self.source = source
        self.success = success
        self.message = message
        self.details = details or {}
        self.timestamp = datetime.now()
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "source": self.source,
            "success": self.success,
            "message": self.message,
            "details": self.details,
            "timestamp": self.timestamp.isoformat()
        }


class GradeSyncService:
    """Service to synchronize grades from multiple sources."""
    
    def __init__(self, course_id: str):
        self.course_id = course_id
        # Always reload config manager to pick up latest DB state
        get_config_manager().reload()
        self.config = get_course_config(course_id)
        
        if not self.config:
            raise ValueError(f"Course configuration not found: {course_id}")
        
        self.results: List[GradeSyncResult] = []

    def resolve_or_create_course_row(self, session) -> Course:
        """Resolve the DB course row used for sync locking and run tracking."""
        requested_id = str(self.course_id or "").strip()
        external_course_id = str(self.config.gradescope_course_id or requested_id).strip()
        if not external_course_id:
            raise ValueError(f"Course {self.course_id} does not have a Gradescope course id")

        course = (
            session.query(Course)
            .filter(
                or_(
                    Course.gradescope_course_id == external_course_id,
                    cast(Course.id, String) == requested_id,
                )
            )
            .first()
        )

        if course:
            return course

        course = Course(
            name=self.config.name,
            gradescope_course_id=external_course_id,
            department=self.config.department,
            course_number=self.config.course_number,
            semester=self.config.semester,
            year=str(self.config.year or ""),
            instructor=self.config.instructor,
            is_active=True,
        )
        session.add(course)
        session.commit()
        session.refresh(course)
        return course
    
    def sync_all(self, progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None) -> Dict[str, Any]:
        """
        Sync grades from all enabled sources for this course.
        
        Returns:
            Dict with sync results from each source
        """
        logger.info(f"Starting grade sync for course: {self.course_id}")

        def emit_progress(payload: Dict[str, Any]):
            if progress_callback:
                progress_callback(payload)

        steps = []
        if self.config.gradescope_enabled:
            steps.append(("gradescope", "Syncing Gradescope", self._sync_gradescope))
        else:
            logger.info("Gradescope sync disabled for this course")

        if self.config.prairielearn_enabled:
            steps.append(("prairielearn", "Syncing PrairieLearn", self._sync_prairielearn))
        else:
            logger.info("PrairieLearn sync disabled for this course")

        if self.config.iclicker_enabled:
            steps.append(("iclicker", "Syncing iClicker", self._sync_iclicker))
        else:
            logger.info("iClicker sync disabled for this course")

        if self.config.database_enabled:
            steps.append(("database", "Refreshing derived scores", self._refresh_derived_scores))

        total_steps = len(steps)

        if total_steps == 0:
            emit_progress({
                "event": "progress",
                "status": "running",
                "message": "No sync sources enabled for this course",
                "progress": 100,
                "currentStep": 0,
                "totalSteps": 0,
                "source": None,
                "stage": "completed",
            })

        for idx, (source, label, step_fn) in enumerate(steps, start=1):
            base_progress = int(((idx - 1) / total_steps) * 100)
            done_progress = int((idx / total_steps) * 100)

            emit_progress({
                "event": "progress",
                "status": "running",
                "message": f"{label}...",
                "progress": max(1, base_progress),
                "currentStep": idx,
                "totalSteps": total_steps,
                "source": source,
                "stage": "start",
            })

            def step_progress(event: Dict[str, Any]):
                step_raw_progress = event.get("progress", 0)
                try:
                    step_progress_pct = max(0, min(100, int(step_raw_progress)))
                except Exception:
                    step_progress_pct = 0

                overall_progress = int(base_progress + ((done_progress - base_progress) * step_progress_pct / 100))

                emit_progress({
                    "event": "progress",
                    "status": event.get("status", "running"),
                    "message": event.get("message", f"{label}..."),
                    "progress": max(1, min(100, overall_progress)),
                    "currentStep": idx,
                    "totalSteps": total_steps,
                    "source": source,
                    "stage": event.get("stage", "running"),
                    "sourceSuccess": event.get("sourceSuccess"),
                    "subCurrent": event.get("subCurrent"),
                    "subTotal": event.get("subTotal"),
                    "subLabel": event.get("subLabel"),
                })

            result = step_fn(progress_callback=step_progress)
            self.results.append(result)

            emit_progress({
                "event": "progress",
                "status": "running",
                "message": result.message,
                "progress": done_progress,
                "currentStep": idx,
                "totalSteps": total_steps,
                "source": source,
                "stage": "completed" if result.success else "failed",
                "sourceSuccess": result.success,
            })
        
        # Compile summary
        summary = {
            "course_id": self.course_id,
            "course_name": self.config.name,
            "timestamp": datetime.now().isoformat(),
            "results": [r.to_dict() for r in self.results],
            "overall_success": all(r.success for r in self.results)
        }
        
        logger.info(f"Grade sync completed for {self.course_id}. Overall success: {summary['overall_success']}")
        return summary
    
    def _sync_gradescope(self, progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None) -> GradeSyncResult:
        """Sync grades from Gradescope using new services layer."""
        logger.info(f"Syncing Gradescope for course {self.config.gradescope_course_id}")
        
        try:
            # Import new Gradescope sync from services layer
            from api.services.gradescope import GradescopeSync
            
            # Get credentials from environment
            email, password = EnvConfig.get_gradescope_credentials()
            
            # Create sync instance
            sync = GradescopeSync(
                email=email,
                password=password
            )
            
            # Sync grades with course config
            result = sync.sync_course(
                course_id=self.config.gradescope_course_id,
                save_to_db=self.config.database_enabled,
                course_name=self.config.name,
                course_config=self.config.to_dict(),
                progress_callback=progress_callback,
            )
            
            return GradeSyncResult(
                source="gradescope",
                success=True,
                message=f"Successfully synced {result.get('assignments_synced', 0)} assignments",
                details=result
            )
            
        except Exception as e:
            logger.exception(f"Gradescope sync failed: {e}")
            return GradeSyncResult(
                source="gradescope",
                success=False,
                message=f"Gradescope sync failed: {str(e)}"
            )
    
    def _sync_prairielearn(self, progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None) -> GradeSyncResult:
        """Sync grades from PrairieLearn using new services layer."""
        logger.info(f"Syncing PrairieLearn for course {self.config.prairielearn_course_id}")
        
        try:
            # Import new PrairieLearn sync from services layer
            from api.services.prairielearn import PrairieLearnSync
            
            # Get credentials from environment
            api_token = EnvConfig.get_prairielearn_token()
            
            # Create sync instance
            sync = PrairieLearnSync(
                api_token=api_token
            )
            
            # Sync grades
            result = sync.sync_course(
                course_id=self.config.prairielearn_course_id,
                save_to_db=self.config.database_enabled,
                target_course_gradescope_id=self.config.gradescope_course_id,
                target_course_name=self.config.name,
                course_categories=self.config.categories,
            )
            
            return GradeSyncResult(
                source="prairielearn",
                success=True,
                message=f"Successfully synced PrairieLearn grades",
                details=result
            )
            
        except Exception as e:
            logger.exception(f"PrairieLearn sync failed: {e}")
            return GradeSyncResult(
                source="prairielearn",
                success=False,
                message=f"PrairieLearn sync failed: {str(e)}"
            )
    
    def _sync_iclicker(self, progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None) -> GradeSyncResult:
        """Sync grades from iClicker using new services layer."""
        logger.info(f"Syncing iClicker for course {self.course_id}")
        
        try:
            # Import new iClicker sync from services layer
            from api.services.iclicker import IClickerSync
            
            # Get credentials from environment
            username, password = EnvConfig.get_iclicker_credentials()
            
            # Create sync instance
            sync = IClickerSync(
                username=username,
                password=password,
                course_gradescope_id=self.config.gradescope_course_id,
                course_name=self.config.name,
                course_categories=self.config.categories,
            )

            # Sync grades for all course sections
            result = sync.sync_courses(
                course_names=self.config.iclicker_course_names,
                save_to_db=self.config.database_enabled
            )
            
            return GradeSyncResult(
                source="iclicker",
                success=True,
                message=f"Successfully synced iClicker for {len(self.config.iclicker_course_names)} sections",
                details=result
            )
            
        except Exception as e:
            logger.exception(f"iClicker sync failed: {e}")
            return GradeSyncResult(
                source="iclicker",
                success=False,
                message=f"iClicker sync failed: {str(e)}"
            )
    
    def _refresh_derived_scores(self, progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None) -> GradeSyncResult:
        """Refresh derived policy tables without writing summary_sheets."""
        logger.info(f"Refreshing derived scores in database for {self.course_id}")
        
        try:
            from api.core.models import Assignment, Student, Submission
            
            session = SessionLocal()
            try:
                # Get course, create if not exists
                course = session.query(Course).filter(
                    Course.gradescope_course_id == self.config.gradescope_course_id
                ).first()
                
                if not course:
                    logger.info(f"Course {self.config.gradescope_course_id} not found, creating...")
                    course = Course(
                        name=self.config.name,
                        gradescope_course_id=self.config.gradescope_course_id
                    )
                    session.add(course)
                    session.commit()
                    logger.info(f"Created course: {course.name} (ID: {course.id})")
                
                # Get all data
                assignments = session.query(Assignment).filter(
                    Assignment.course_id == course.id,
                    Assignment.is_visible.is_not(False),
                ).all()
                
                students = session.query(Student).filter(
                    Student.course_id == course.id
                ).all()
                
                submissions = session.query(Submission).join(Assignment).filter(
                    Assignment.course_id == course.id,
                    Assignment.is_visible.is_not(False),
                ).all()
                
                from api.core.exam_policy import compute_effective_exam_scores
                policy_result = compute_effective_exam_scores(session, course.id)

                from api.core.attendance_policy import compute_attendance_scores
                attendance_result = compute_attendance_scores(session, course.id, policy=self.config.policy)

                from api.core.lab_project_policy import compute_all_lab_project_scores
                lab_project_result = compute_all_lab_project_scores(session, course.id, policy=self.config.policy)

                session.commit()

                return GradeSyncResult(
                    source="database",
                    success=True,
                    message=f"Refreshed derived scores: {len(students)} students, {len(assignments)} assignments",
                    details={
                        "students": len(students),
                        "assignments": len(assignments),
                        "submissions": len(submissions),
                        "policy": policy_result,
                        "attendance": attendance_result,
                        "lab_project": lab_project_result,
                    }
                )
                
            finally:
                session.close()
                
        except Exception as e:
            logger.exception(f"Derived score refresh failed: {e}")
            return GradeSyncResult(
                source="database",
                success=False,
                message=f"Derived score refresh failed: {str(e)}"
            )


def sync_course_grades(
    course_id: str,
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    triggered_by: str = "manual",
) -> Dict[str, Any]:
    """
    Convenience function to sync all grades for a course.
    
    Args:
        course_id: Course identifier (e.g., 'cs10_fa25')
        triggered_by: Source of the sync request (manual, maintainer, etc.)
    
    Returns:
        Dict with sync results
    """
    service = GradeSyncService(course_id)
    session = SessionLocal()
    lock_connection = None
    lock_acquired = False
    lock_course_id: Optional[int] = None
    run_id: Optional[int] = None

    try:
        course = service.resolve_or_create_course_row(session)
        lock_course_id = int(course.id)
        lock_connection = engine.connect()
        lock_acquired = bool(
            lock_connection.execute(
                text("SELECT pg_try_advisory_lock(:namespace, :course_id)"),
                {"namespace": SYNC_LOCK_NAMESPACE, "course_id": lock_course_id},
            ).scalar()
        )

        if not lock_acquired:
            raise SyncAlreadyRunningError(f"Grade sync is already running for course {course_id}")

        started_at = _utc_now()
        run = SyncRun(
            course_id=course.id,
            trigger=(triggered_by or "manual")[:50],
            status="running",
            started_at=started_at,
        )
        session.add(run)
        session.commit()
        session.refresh(run)
        run_id = run.id

        result = service.sync_all(progress_callback=progress_callback)
        overall_success = bool(result.get("overall_success"))
        finished_at = _utc_now()

        run_update = {
            "status": "completed" if overall_success else "failed",
            "finished_at": finished_at,
            "duration_seconds": max(0, int((finished_at - started_at).total_seconds())),
            "summary": _json_safe(result),
            "error": None if overall_success else "One or more sync steps failed",
        }
        session.query(SyncRun).filter(SyncRun.id == run_id).update(run_update)

        if overall_success:
            session.query(Course).filter(Course.id == course.id).update({
                "last_synced_at": finished_at,
            })

        session.commit()
        return result

    except Exception as exc:
        session.rollback()
        if run_id is not None:
            finished_at = _utc_now()
            try:
                run = session.query(SyncRun).filter(SyncRun.id == run_id).first()
                if run is not None:
                    started_at = run.started_at or finished_at
                    if started_at.tzinfo is None:
                        started_at = started_at.replace(tzinfo=timezone.utc)
                    run.status = "failed"
                    run.finished_at = finished_at
                    run.duration_seconds = max(0, int((finished_at - started_at).total_seconds()))
                    run.error = str(exc)
                    session.commit()
            except Exception:
                session.rollback()
                logger.exception("Failed to record sync failure for course %s", course_id)
        raise

    finally:
        if lock_acquired and lock_course_id is not None and lock_connection is not None:
            try:
                lock_connection.execute(
                    text("SELECT pg_advisory_unlock(:namespace, :course_id)"),
                    {"namespace": SYNC_LOCK_NAMESPACE, "course_id": lock_course_id},
                )
            except Exception:
                logger.exception("Failed to release sync lock for course %s", course_id)
        if lock_connection is not None:
            lock_connection.close()
        session.close()
