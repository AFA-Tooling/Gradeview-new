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
            assignments_data = {}
            students_data = set()
            
            # Download all assignments and their scores
            # print(f"[DEBUG] About to call _get_course_assignments({course_id})")
            course_assignments = self._get_course_assignments(course_id)
            if not course_assignments:
                raise RuntimeError(
                    f"No assignments found for course {course_id}. "
                    "This is usually caused by missing course access for the configured Gradescope account."
                )
            # print(f"[DEBUG] Retrieved {len(course_assignments)} assignments from Gradescope")
            logger.info(f"Retrieved {len(course_assignments)} assignments from Gradescope")
            total_assignments = len(course_assignments)

            catalog_result = None
            if save_to_db:
                from api.core.ingest_optimized import upsert_gradescope_assignment_catalog
                catalog_result = upsert_gradescope_assignment_catalog(
                    course_gradescope_id=course_id,
                    catalog=course_assignments,
                    course_config=course_config,
                )

            assignments_failed = []
            
            for index, catalog_entry in enumerate(course_assignments, start=1):
                assignment_id = catalog_entry['assignment_id']
                assignment_name = catalog_entry['title']
                start_pct = int(10 + ((index - 1) / max(1, total_assignments)) * 80)
                emit_progress({
                    "event": "progress",
                    "status": "running",
                    "stage": "assignment_start",
                    "message": f"Syncing assignment {index}/{total_assignments}: {assignment_name}",
                    "progress": start_pct,
                    "subCurrent": index,
                    "subTotal": total_assignments,
                    "subLabel": assignment_name,
                })
                logger.info(f"Downloading scores for: {assignment_name} (ID: {assignment_id})")
                
                try:
                    import time as _time
                    print(f"[{_ts()}] Processing {assignment_name}...", flush=True)
                    
                    # Download CSV scores for this assignment
                    _dl_start = _time.time()
                    scores_csv = self.gs_client.download_scores(course_id, assignment_id)
                    _dl_elapsed = _time.time() - _dl_start
                    
                    if scores_csv:
                        # Ensure scores_csv is a string (not bytes)
                        if isinstance(scores_csv, bytes):
                            scores_csv = scores_csv.decode('utf-8')
                        
                        logger.info(f"[INFO] [{_ts()}] `save_to_db` is {save_to_db} for {assignment_name}")
                        
                        # Parse CSV and save to database if requested
                        if save_to_db:
                            # Use optimized batch ingestion
                            from api.core.ingest_optimized import write_assignment_scores_optimized
                            
                            _db_start = _time.time()
                            result = write_assignment_scores_optimized(
                                course_gradescope_id=course_id,
                                assignment_id=assignment_id,
                                assignment_name=assignment_name,
                                csv_content=scores_csv,
                                course_config=course_config,
                                catalog_entry=catalog_entry,
                            )
                            if not result.get('success'):
                                raise RuntimeError(result.get('error') or 'Database ingestion failed')
                            _db_elapsed = _time.time() - _db_start
                            
                            # if result.get('skipped'):
                            #     print(f"[{_ts()}] Skipped {assignment_name} - {result.get('reason')} ({_db_elapsed:.2f}s)", flush=True)
                            # elif result.get('success'):
                            #     print(f"[{_ts()}] Saved {assignment_name} ({result.get('submissions_processed')} subs, {_db_elapsed:.2f}s)", flush=True)
                            # else:
                            #     print(f"[{_ts()}] Failed {assignment_name}: {result.get('error')} ({_db_elapsed:.2f}s)", flush=True)
                        
                        assignments_data[assignment_id] = assignment_name
                        
                        # Count unique students
                        import csv
                        import io
                        reader = csv.DictReader(io.StringIO(scores_csv))
                        for row in reader:
                            if 'SID' in row:
                                students_data.add(row['SID'])

                        done_pct = int(10 + (index / max(1, total_assignments)) * 80)
                        emit_progress({
                            "event": "progress",
                            "status": "running",
                            "stage": "assignment_done",
                            "message": f"Finished assignment {index}/{total_assignments}: {assignment_name}",
                            "progress": done_pct,
                            "subCurrent": index,
                            "subTotal": total_assignments,
                            "subLabel": assignment_name,
                        })
                
                except Exception as e:
                    logger.error(f"Failed to sync {assignment_name}: {e}")
                    assignments_failed.append({
                        'assignment_id': assignment_id,
                        'title': assignment_name,
                        'error': str(e),
                    })
                    done_pct = int(10 + (index / max(1, total_assignments)) * 80)
                    emit_progress({
                        "event": "progress",
                        "status": "running",
                        "stage": "assignment_failed",
                        "message": f"Failed assignment {index}/{total_assignments}: {assignment_name}",
                        "progress": done_pct,
                        "subCurrent": index,
                        "subTotal": total_assignments,
                        "subLabel": assignment_name,
                    })
                    # print(f"[{_ts()}] Error: {assignment_name}: {e}", flush=True)
                    continue
            
            results = {
                "success": True,
                "course_id": course_id,
                "assignments_synced": len(assignments_data),
                "students_synced": len(students_data),
                "catalog": catalog_result,
                "assignments_failed": assignments_failed,
            }

            if assignments_failed:
                raise RuntimeError(
                    f"Failed to sync {len(assignments_failed)} of {total_assignments} assignments"
                )
            
            # print(f"[{_ts()}] Sync completed: {results}", flush=True)
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
