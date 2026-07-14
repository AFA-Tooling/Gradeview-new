"""
Gradescope Sync Module

High-level sync operations for Gradescope data.
"""
from typing import Dict, Any, Optional, Callable, List
import logging
import json
import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from bs4 import BeautifulSoup
from .client import GRADESCOPE_ROOT, GradescopeClient

logger = logging.getLogger(__name__)


def is_published_assignment(catalog_entry: Dict[str, Any]) -> bool:
    """Return whether Gradescope currently exposes an assignment to students."""
    return catalog_entry.get('is_published') is True


def _parse_catalog_datetime(value: Optional[str], timezone_name: str) -> Optional[datetime]:
    if not value:
        return None
    parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=ZoneInfo(timezone_name))
    return parsed.astimezone(timezone.utc)


def parse_assignment_catalog(html: str, *, now: Optional[datetime] = None) -> List[Dict[str, Any]]:
    """Parse the authoritative Gradescope AssignmentsTable payload."""
    table = BeautifulSoup(html, 'html.parser').find(
        'div',
        {'data-react-class': 'AssignmentsTable'},
    )
    if table is None or not table.get('data-react-props'):
        raise RuntimeError('Gradescope AssignmentsTable payload was not found')

    props = json.loads(table.get('data-react-props'))
    timezone_name = (props.get('timezone') or {}).get('identifier') or 'America/Los_Angeles'
    seen_at = now or datetime.now(timezone.utc)
    catalog = []
    seen_ids = set()

    for row in props.get('table_data') or []:
        assignment_url = str(row.get('url') or '')
        match = re.search(r'/assignments/(\d+)', assignment_url)
        if match is None:
            match = re.search(r'(\d+)$', str(row.get('id') or ''))
        title = ' '.join(str(row.get('title') or '').split())
        if match is None or not title:
            continue

        assignment_id = match.group(1)
        if assignment_id in seen_ids:
            raise RuntimeError(f'Duplicate assignment ID in Gradescope catalog: {assignment_id}')
        seen_ids.add(assignment_id)

        window = dict(row.get('submission_window') or {})
        max_points = row.get('total_points')
        try:
            max_points = float(max_points) if max_points not in (None, '') else None
        except (TypeError, ValueError):
            max_points = None

        catalog.append({
            'assignment_id': assignment_id,
            'title': title,
            'source_type': str(row.get('type') or 'assignment'),
            'max_points': max_points,
            'release_at': _parse_catalog_datetime(window.get('release_date'), timezone_name),
            'due_at': _parse_catalog_datetime(window.get('due_date'), timezone_name),
            'late_due_at': _parse_catalog_datetime(window.get('hard_due_date'), timezone_name),
            'is_published': row.get('is_published'),
            'catalog_seen_at': seen_at,
            'course_timezone': timezone_name,
            'raw': row,
        })

    if not catalog:
        raise RuntimeError('Gradescope AssignmentsTable did not contain any assignments')
    return catalog

def _ts():
    """Return current timestamp for debug logs."""
    return datetime.now().strftime('%H:%M:%S.%f')[:-3]


class GradescopeSync:
    """
    Sync Gradescope grades to database.
    Orchestrates:
    - Gradescope API access
    - Data transformation
    - Database persistence
    """
    
    def __init__(
        self,
        email: str,
        password: str
    ):
        """
        Initialize Gradescope sync.
        
        Args:
            email: Gradescope email
            password: Gradescope password
        """
        self.gs_client = GradescopeClient(timeout=1800)
        self.email = email
        self.password = password
        
    def sync_course(
        self,
        course_id: str,
        save_to_db: bool = True,
        course_name: Optional[str] = None,
        course_config: Optional[Dict[str, Any]] = None,
        progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> Dict[str, Any]:
        """
        Sync a Gradescope course.
        
        Args:
            course_id: Gradescope course ID
            save_to_db: Whether to save to database (default True)
            course_name: Optional course name
            course_config: Optional course configuration with categories
            
        Returns:
            Dictionary with sync results
        """
        # print(f"[DEBUG] Starting Gradescope sync for course {course_id}")
        logger.info(f"Starting Gradescope sync for course {course_id}")

        def emit_progress(payload: Dict[str, Any]):
            if progress_callback:
                progress_callback(payload)
        
        try:
            # Login to Gradescope
            # print("[DEBUG] Attempting Gradescope login...")
            logger.info("Attempting Gradescope login...")
            emit_progress({
                "event": "progress",
                "status": "running",
                "stage": "login",
                "message": "Logging in to Gradescope...",
                "progress": 2,
            })
            login_result = self.gs_client.log_in(self.email, self.password)
            # print(f"[DEBUG] Login result: {login_result}")
            logger.info(f"Login result: {login_result}")
            
            if not login_result:
                raise RuntimeError("Failed to login to Gradescope")
            
            # Get assignments for the course
            # print("[DEBUG] Fetching course assignments...")
            logger.info("Fetching course assignments...")
            emit_progress({
                "event": "progress",
                "status": "running",
                "stage": "fetch_assignments",
                "message": "Loading assignment list...",
                "progress": 5,
            })
            # Fetch the catalog once for stable IDs, publication state, and dates.
            source_catalog = self._get_course_assignments(course_id)
            if not source_catalog:
                raise RuntimeError(
                    f"No assignments found for course {course_id}. "
                    "This is usually caused by missing course access for the configured Gradescope account."
                )
            course_assignments = [
                assignment
                for assignment in source_catalog
                if is_published_assignment(assignment)
            ]
            unpublished_count = len(source_catalog) - len(course_assignments)
            logger.info(
                "Retrieved %d assignments from Gradescope; %d are published and %d will be ignored",
                len(source_catalog),
                len(course_assignments),
                unpublished_count,
            )
            catalog_result = None
            if save_to_db:
                from api.core.ingest_optimized import upsert_gradescope_assignment_catalog
                catalog_result = upsert_gradescope_assignment_catalog(
                    course_gradescope_id=course_id,
                    catalog=course_assignments,
                    course_config=course_config,
                )

            emit_progress({
                "event": "progress",
                "status": "running",
                "stage": "download_gradebook",
                "message": "Downloading the course gradebook...",
                "progress": 20,
            })
            gradebook_csv = self.gs_client.download_gradebook(course_id)
            if not gradebook_csv:
                raise RuntimeError(f"Failed to download course gradebook for {course_id}")
            if isinstance(gradebook_csv, bytes):
                gradebook_csv = gradebook_csv.decode('utf-8-sig')

            emit_progress({
                "event": "progress",
                "status": "running",
                "stage": "ingest_gradebook",
                "message": "Saving course grades in one batch...",
                "progress": 55,
            })
            from api.core.ingest_optimized import (
                parse_gradescope_course_gradebook,
                write_course_gradebook_optimized,
            )
            if save_to_db:
                gradebook_result = write_course_gradebook_optimized(
                    course_gradescope_id=course_id,
                    csv_content=gradebook_csv,
                    catalog=course_assignments,
                    course_config=course_config,
                )
                if not gradebook_result.get('success'):
                    raise RuntimeError(
                        gradebook_result.get('error') or 'Course gradebook ingestion failed'
                    )
            else:
                parsed = parse_gradescope_course_gradebook(
                    gradebook_csv,
                    course_assignments,
                )
                gradebook_result = {
                    'success': True,
                    'students_processed': len(parsed['students']),
                    'assignments_processed': len(parsed['matched_assignments']),
                    'submissions_processed': len(parsed['submissions']),
                    'unmatched_assignment_titles': parsed['unmatched_assignment_titles'],
                }

            results = {
                "success": True,
                "course_id": course_id,
                "assignments_synced": gradebook_result['assignments_processed'],
                "assignments_discovered": len(source_catalog),
                "unpublished_skipped": unpublished_count,
                "students_synced": gradebook_result['students_processed'],
                "submissions_synced": gradebook_result['submissions_processed'],
                "assignments_missing_from_gradebook": gradebook_result['unmatched_assignment_titles'],
                "catalog": catalog_result,
                "assignments_failed": [],
            }

            emit_progress({
                "event": "progress",
                "status": "running",
                "stage": "gradebook_done",
                "message": f"Finished {results['assignments_synced']} assignments in one batch",
                "progress": 90,
            })
            logger.info(f"Sync completed: {results}")
            return results
            
        except Exception as e:
            logger.error(f"Sync failed: {e}")
            raise
        finally:
            self.gs_client.logout()
    
    def close(self):
        """Close clients."""
        self.gs_client.logout()
    
    def _get_course_assignments(self, course_id: str) -> List[Dict[str, Any]]:
        """
        Get all assignments for a course using Gradescope API.
        
        Args:
            course_id: Gradescope course ID
            
        Returns:
            Normalized rows from AssignmentsTable.data-react-props.table_data
        """
        try:
            url = f"{GRADESCOPE_ROOT}/courses/{course_id}"
            response = self.gs_client.session.get(url, timeout=self.gs_client.request_timeout)

            if response.status_code in (401, 403):
                raise PermissionError(
                    f"Unauthorized to access Gradescope course {course_id}. "
                    "Verify GRADESCOPE_EMAIL has instructor/TA access to this course."
                )

            response.raise_for_status()
            
            assignments = parse_assignment_catalog(response.text)
            logger.info(f"Found {len(assignments)} assignments for course {course_id}")
            return assignments
            
        except PermissionError:
            raise
        except Exception as e:
            logger.error(f"Failed to get assignments for course {course_id}: {e}")
            raise RuntimeError(f"Failed to fetch assignments for course {course_id}: {e}") from e
    
    def _save_assignment_to_db(
        self,
        course_id: str,
        assignment_id: str,
        assignment_name: str,
        scores_csv: str,
        course_config: Optional[Any] = None
    ):
        """Save assignment scores to database from CSV string content."""
        try:
            import tempfile
            import os
            
            # Create temporary file to store CSV content
            with tempfile.NamedTemporaryFile(mode='w', suffix='.csv', delete=False, encoding='utf-8') as f:
                f.write(scores_csv)
                temp_filepath = f.name
            
            try:
                from api.core.ingest import write_assignment_scores_to_db
                
                # Extract course metadata from config
                course_categories = None
                course_name = None
                department = None
                course_number = None
                semester = None
                year = None
                instructor = None
                
                if course_config:
                    course_categories = course_config.get('assignment_categories', [])
                    course_name = course_config.get('name')
                    department = course_config.get('department')
                    course_number = course_config.get('course_number')
                    semester = course_config.get('semester')
                    year = course_config.get('year')
                    instructor = course_config.get('instructor')
                
                write_assignment_scores_to_db(
                    course_gradescope_id=course_id,
                    assignment_id=assignment_id,
                    assignment_name=assignment_name,
                    csv_filepath=temp_filepath,
                    course_name=course_name,
                    department=department,
                    course_number=course_number,
                    semester=semester,
                    year=year,
                    instructor=instructor,
                    course_categories=course_categories
                )
                # print(f"[DEBUG] Saved {assignment_name} to database")
                logger.info(f"Saved {assignment_name} to database")
                
            finally:
                # Clean up temp file
                if os.path.exists(temp_filepath):
                    os.remove(temp_filepath)
            
        except Exception as e:
            # print(f"[DEBUG] Failed to save {assignment_name} to database: {e}")
            logger.error(f"Failed to save {assignment_name} to database: {e}")
            # import traceback
            # traceback.print_exc()
