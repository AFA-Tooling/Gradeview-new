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
from pathlib import Path
from typing import Optional, Dict, List, Any, Callable
from datetime import datetime

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from api.config_manager import get_course_config, get_config_manager, EnvConfig
from api.core.db import SessionLocal
from api.core.models import Course
from api.core.ingest import save_summary_sheet_to_db

logger = logging.getLogger(__name__)


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
        # Always reload config to pick up runtime edits to config.json
        get_config_manager().reload()
        self.config = get_course_config(course_id)
        
        if not self.config:
            raise ValueError(f"Course configuration not found: {course_id}")
        
        self.results: List[GradeSyncResult] = []
    
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
            steps.append(("database", "Updating summary sheets", self._update_summary_sheets))

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
                password=password
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
    
    def _update_summary_sheets(self, progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None) -> GradeSyncResult:
        """Update summary sheets in database."""
        logger.info(f"Updating summary sheets in database for {self.course_id}")
        
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
                    Assignment.course_id == course.id
                ).all()
                
                students = session.query(Student).filter(
                    Student.course_id == course.id
                ).all()
                
                submissions = session.query(Submission).join(Assignment).filter(
                    Assignment.course_id == course.id
                ).all()
                
                submission_lookup = {
                    (sub.assignment_id, sub.student_id): sub 
                    for sub in submissions
                }
                
                course_data = {
                    "course": course,
                    "assignments": assignments,
                    "students": students,
                    "submissions": submission_lookup
                }
                
                # Save to summary_sheets table with course categories
                save_summary_sheet_to_db(
                    self.config.gradescope_course_id, 
                    course_data,
                    course_categories=self.config.categories
                )

                from api.core.exam_policy import compute_effective_exam_scores
                policy_result = compute_effective_exam_scores(session, course.id)
                session.commit()
                
                return GradeSyncResult(
                    source="database",
                    success=True,
                    message=f"Updated summary sheets: {len(students)} students, {len(assignments)} assignments",
                    details={
                        "students": len(students),
                        "assignments": len(assignments),
                        "submissions": len(submissions),
                        "policy": policy_result,
                    }
                )
                
            finally:
                session.close()
                
        except Exception as e:
            logger.exception(f"Summary sheet update failed: {e}")
            return GradeSyncResult(
                source="database",
                success=False,
                message=f"Summary sheet update failed: {str(e)}"
            )


def sync_course_grades(
    course_id: str,
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None
) -> Dict[str, Any]:
    """
    Convenience function to sync all grades for a course.
    
    Args:
        course_id: Course identifier (e.g., 'cs10_fa25')
    
    Returns:
        Dict with sync results
    """
    service = GradeSyncService(course_id)
    return service.sync_all(progress_callback=progress_callback)
