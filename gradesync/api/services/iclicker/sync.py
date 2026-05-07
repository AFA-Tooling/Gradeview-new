"""
iClicker Sync Module

High-level sync operations for iClicker attendance data.
"""
from typing import Dict, Any, List, Optional
import logging
import os

from .client import IClickerClient

logger = logging.getLogger(__name__)


class IClickerSync:
    """
    Sync iClicker attendance to database.

    Orchestrates:
    - iClicker web scraping (Selenium)
    - CSV download per section
    - Database persistence (Course / Assignment / Student / Submission)
    """

    def __init__(
        self,
        username: str,
        password: str,
        download_dir: Optional[str] = None,
        course_gradescope_id: Optional[str] = None,
        course_name: Optional[str] = None,
        course_categories: Optional[List[Dict[str, Any]]] = None,
    ):
        """
        Args:
            username: Campus login username (passed to iClicker SSO).
            password: Campus login password.
            download_dir: Directory for CSV downloads.
            course_gradescope_id: External course id used to locate the Course
                row in the database. Required when save_to_db=True.
            course_name: Course display name (used when creating Course row).
            course_categories: Course assignment-categories config (currently
                unused for iClicker; attendance has its own category).
        """
        self.ic_client = IClickerClient(
            username=username,
            password=password,
            download_dir=download_dir,
        )
        self.course_gradescope_id = course_gradescope_id
        self.course_name = course_name
        self.course_categories = course_categories

    def sync_courses(
        self,
        course_names: List[str],
        save_to_db: bool = True,
    ) -> Dict[str, Any]:
        """
        Sync multiple iClicker sections.

        Args:
            course_names: Section titles (e.g., ["[CS10 | Sp25] Lecture", ...]).
            save_to_db: Whether to upsert rows into the database.

        Returns:
            Dict with sync results.
        """
        if save_to_db and not self.course_gradescope_id:
            raise ValueError(
                "course_gradescope_id is required when save_to_db=True"
            )

        logger.info(f"Starting iClicker sync for {len(course_names)} sections")

        try:
            self.ic_client.login()
            files = self.ic_client.download_all_courses(course_names)

            synced_courses = []
            for course_name, file_path in files.items():
                try:
                    df = self.ic_client.read_attendance_csv(file_path)

                    db_result = None
                    if save_to_db:
                        from api.core.iclicker_ingest import (
                            write_iclicker_attendance_to_db,
                        )
                        db_result = write_iclicker_attendance_to_db(
                            course_gradescope_id=self.course_gradescope_id,
                            section_name=course_name,
                            csv_filepath=file_path,
                            course_name=self.course_name,
                            course_categories=self.course_categories,
                        )

                    synced_courses.append({
                        "course": course_name,
                        "records": len(df),
                        "file": file_path,
                        "db": db_result,
                    })

                    # Clean up the downloaded CSV after a successful ingest so
                    # the download dir doesn't accumulate stale files between runs.
                    if save_to_db and db_result:
                        try:
                            os.remove(file_path)
                        except OSError as cleanup_err:
                            logger.warning(
                                "Could not delete %s: %s", file_path, cleanup_err
                            )

                except Exception as e:
                    logger.exception(f"Failed to process {course_name}: {e}")
                    continue

            results = {
                "success": True,
                "courses_synced": len(synced_courses),
                "courses": synced_courses,
            }

            logger.info(f"Sync completed: {results}")
            return results

        except Exception as e:
            logger.error(f"Sync failed: {e}")
            raise
        finally:
            self.ic_client.close()

    def close(self):
        """Close clients."""
        self.ic_client.close()
