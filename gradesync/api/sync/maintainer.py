"""
Nightly GradeSync maintainer.

Runs due syncs for DB-active courses. Intended to run as a single long-lived
container separate from the FastAPI workers.
"""
import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, time as day_time, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from api.core.db import SessionLocal, init_db
from api.core.models import Course, CourseConfig as CourseConfigModel
from api.sync.service import SyncAlreadyRunningError, sync_course_grades

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

TRUE_VALUES = {"1", "true", "yes", "y", "on"}


@dataclass
class MaintainerCourse:
    db_id: int
    sync_id: str
    name: str
    semester: str
    year: str
    interval_hours: int
    last_synced_at: Optional[datetime]


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in TRUE_VALUES


def env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        logger.warning("Invalid integer for %s=%r; using %s", name, value, default)
        return default


def parse_schedule_time(value: str) -> day_time:
    try:
        hour_text, minute_text = value.split(":", 1)
        hour = int(hour_text)
        minute = int(minute_text)
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            return day_time(hour=hour, minute=minute)
    except Exception:
        pass
    logger.warning("Invalid GRADESYNC_MAINTAINER_TIME=%r; using 03:00", value)
    return day_time(hour=3, minute=0)


def normalize_timestamp(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def course_has_enabled_work(config: Optional[CourseConfigModel]) -> bool:
    if config is None:
        return True
    return any([
        bool(config.gradescope_enabled),
        bool(config.prairielearn_enabled),
        bool(config.iclicker_enabled),
        bool(config.database_enabled),
    ])


def list_active_courses(default_interval_hours: int) -> list[MaintainerCourse]:
    semester_filter = (os.getenv("GRADESYNC_MAINTAINER_SEMESTER") or "").strip().lower()
    year_filter = (os.getenv("GRADESYNC_MAINTAINER_YEAR") or "").strip()

    session = SessionLocal()
    try:
        rows = (
            session.query(Course, CourseConfigModel)
            .outerjoin(CourseConfigModel, CourseConfigModel.course_id == Course.id)
            .filter(Course.is_active == True)
            .order_by(Course.year, Course.semester, Course.id)
            .all()
        )

        courses: list[MaintainerCourse] = []
        for course, config in rows:
            semester = str(course.semester or "").strip()
            year = str(course.year or "").strip()
            if semester_filter and semester.lower() != semester_filter:
                continue
            if year_filter and year != year_filter:
                continue
            if not course_has_enabled_work(config):
                continue

            interval_hours = default_interval_hours
            if config is not None and config.gradescope_sync_interval_hours:
                interval_hours = int(config.gradescope_sync_interval_hours)
            if interval_hours <= 0:
                continue

            sync_id = str(course.gradescope_course_id or course.id).strip()
            if not sync_id:
                continue

            courses.append(
                MaintainerCourse(
                    db_id=course.id,
                    sync_id=sync_id,
                    name=course.name or f"Course {sync_id}",
                    semester=semester,
                    year=year,
                    interval_hours=interval_hours,
                    last_synced_at=normalize_timestamp(course.last_synced_at),
                )
            )

        return courses
    finally:
        session.close()


def is_due(course: MaintainerCourse, now_utc: datetime, force: bool = False) -> bool:
    if force:
        return True
    if course.last_synced_at is None:
        return True
    return now_utc - course.last_synced_at >= timedelta(hours=course.interval_hours)


def run_due_courses(force: bool = False) -> None:
    now_utc = datetime.now(timezone.utc)
    default_interval_hours = env_int("GRADESYNC_MAINTAINER_DEFAULT_INTERVAL_HOURS", 24)
    stagger_seconds = max(0, env_int("GRADESYNC_MAINTAINER_STAGGER_SECONDS", 30))
    courses = list_active_courses(default_interval_hours)
    due_courses = [course for course in courses if is_due(course, now_utc, force=force)]

    logger.info(
        "GradeSync maintainer found %s active course(s), %s due for sync",
        len(courses),
        len(due_courses),
    )

    for index, course in enumerate(due_courses):
        label = f"{course.year} {course.semester} {course.name}".strip()
        logger.info("Starting maintainer sync for %s (%s)", label, course.sync_id)
        try:
            result = sync_course_grades(course.sync_id, triggered_by="maintainer")
            logger.info(
                "Finished maintainer sync for %s: overall_success=%s",
                course.sync_id,
                result.get("overall_success"),
            )
        except SyncAlreadyRunningError as exc:
            logger.info("Skipping %s because another sync is running: %s", course.sync_id, exc)
        except Exception:
            logger.exception("Maintainer sync failed for %s", course.sync_id)

        if stagger_seconds and index < len(due_courses) - 1:
            time.sleep(stagger_seconds)


def next_run_at(now: datetime, scheduled_time: day_time) -> datetime:
    candidate = datetime.combine(now.date(), scheduled_time, tzinfo=now.tzinfo)
    if candidate <= now:
        candidate += timedelta(days=1)
    return candidate


def sleep_until(target: datetime) -> None:
    while True:
        now = datetime.now(target.tzinfo)
        seconds = (target - now).total_seconds()
        if seconds <= 0:
            return
        time.sleep(min(seconds, 3600))


def main() -> None:
    enabled = env_bool("GRADESYNC_MAINTAINER_ENABLED", True)
    if not enabled:
        logger.info("GradeSync maintainer disabled; sleeping")
        while True:
            time.sleep(3600)

    logger.info("Initializing database tables for GradeSync maintainer")
    init_db()

    force = env_bool("GRADESYNC_MAINTAINER_FORCE", False)
    if env_bool("GRADESYNC_MAINTAINER_ONCE", False):
        run_due_courses(force=force)
        return

    timezone_name = os.getenv("GRADESYNC_MAINTAINER_TIMEZONE", "America/Los_Angeles")
    schedule_time = parse_schedule_time(os.getenv("GRADESYNC_MAINTAINER_TIME", "03:00"))
    try:
        tz = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        logger.warning("Invalid GRADESYNC_MAINTAINER_TIMEZONE=%r; using America/Los_Angeles", timezone_name)
        tz = ZoneInfo("America/Los_Angeles")

    if env_bool("GRADESYNC_MAINTAINER_RUN_ON_START", False):
        run_due_courses(force=force)

    while True:
        target = next_run_at(datetime.now(tz), schedule_time)
        logger.info("Next GradeSync maintainer run scheduled for %s", target.isoformat())
        sleep_until(target)
        run_due_courses(force=force)


if __name__ == "__main__":
    main()
