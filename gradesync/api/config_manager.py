"""
Unified Configuration Manager for GradeSync.

Loads GradeSync settings from the repository root config.json (`gradesync` section).
"""
import json
import os
from pathlib import Path
from typing import Dict, List, Optional, Any
import logging

logger = logging.getLogger(__name__)

def _resolve_default_config_path() -> Path:
    """Resolve default config path at repository root."""
    root_config = Path(__file__).parent.parent / "config.json"
    return root_config


DEFAULT_CONFIG_PATH = _resolve_default_config_path()


class CourseConfig:
    """Configuration for a single course."""
    
    def __init__(self, course_data: Dict[str, Any]):
        self.data = course_data
        self.general = self._resolve_general(course_data)
        self.gradesync_section = self._resolve_gradesync(course_data)
        self.gradeview_section = self._resolve_gradeview(course_data)

        self.id = self.general.get("id") or course_data.get("id")
        self.name = self.general.get("name") or course_data.get("name")
        self.department = self.general.get("department") or course_data.get("department")
        self.course_number = self.general.get("course_number") or course_data.get("course_number")
        self.semester = self.general.get("semester") or course_data.get("semester")
        self.year = self.general.get("year") or course_data.get("year")
        self.instructor = self.general.get("instructor") or course_data.get("instructor")
        
        # Source configurations (supports nested gradesync.sources and legacy shapes)
        self.sources = self.gradesync_section.get("sources", course_data.get("sources", {}))
        self.gradescope = self._resolve_source("gradescope")
        self.prairielearn = self._resolve_source("prairielearn")
        self.iclicker = self._resolve_source("iclicker")
        self.database = self.gradesync_section.get("database", course_data.get("database", {}))
        self.assignment_categories = self.gradesync_section.get("assignment_categories", course_data.get("assignment_categories", []))

    def _resolve_general(self, course_data: Dict[str, Any]) -> Dict[str, Any]:
        general = course_data.get("general", {})
        return general if isinstance(general, dict) else {}

    def _resolve_gradesync(self, course_data: Dict[str, Any]) -> Dict[str, Any]:
        section = course_data.get("gradesync", {})
        return section if isinstance(section, dict) else {}

    def _resolve_gradeview(self, course_data: Dict[str, Any]) -> Dict[str, Any]:
        section = course_data.get("gradeview", {})
        return section if isinstance(section, dict) else {}

    def _resolve_source(self, source_name: str) -> Dict[str, Any]:
        source_config = self.sources.get(source_name, {})
        if isinstance(source_config, dict) and source_config:
            return source_config
        legacy = self.data.get(source_name, {})
        return legacy if isinstance(legacy, dict) else {}
    
    @property
    def gradescope_enabled(self) -> bool:
        return self.gradescope.get("enabled", False)
    
    @property
    def gradescope_course_id(self) -> Optional[str]:
        return self.gradescope.get("course_id")
    
    @property
    def prairielearn_enabled(self) -> bool:
        return self.prairielearn.get("enabled", False)
    
    @property
    def prairielearn_course_id(self) -> Optional[str]:
        return self.prairielearn.get("course_id")
    
    @property
    def iclicker_enabled(self) -> bool:
        return self.iclicker.get("enabled", False)
    
    @property
    def iclicker_course_names(self) -> List[str]:
        return self.iclicker.get("course_names", [])
    
    @property
    def database_enabled(self) -> bool:
        return self.database.get("enabled", False)
    
    @property
    def use_db_as_primary(self) -> bool:
        return self.database.get("use_as_primary", False)
    
    @property
    def categories(self) -> List[Dict[str, Any]]:
        """Get assignment categories configuration."""
        return self.assignment_categories
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return self.data


class ConfigManager:
    """Manages application configuration."""
    
    def __init__(self, config_path: Optional[Path] = None):
        self.config_path = config_path or DEFAULT_CONFIG_PATH
        self.config_data: Dict[str, Any] = {}
        self.courses: Dict[str, CourseConfig] = {}
        self.global_settings: Dict[str, Any] = {}
        self._load_config()
    
    def _load_config(self):
        """Load configuration from JSON file."""
        if not self.config_path.exists():
            logger.warning(
                "Configuration file not found at %s; falling back to database-backed configuration",
                self.config_path,
            )
            self.config_data = {}
            self.courses = {}
            self.global_settings = {}
            return
        
        try:
            with open(self.config_path, 'r') as f:
                raw_data = json.load(f)

            if isinstance(raw_data, dict) and isinstance(raw_data.get("gradesync"), dict):
                self.config_data = raw_data.get("gradesync", {})
            else:
                self.config_data = raw_data if isinstance(raw_data, dict) else {}
            
            # Load courses
            for course_data in self.config_data.get("courses", []):
                course_config = CourseConfig(course_data)
                if not course_config.id:
                    logger.warning("Skipping course entry without id: %s", course_data)
                    continue
                self.courses[course_config.id] = course_config
            
            # Load global settings
            self.global_settings = self.config_data.get("global_settings", {})
            
            logger.info("Loaded configuration for %s courses from %s", len(self.courses), self.config_path)
            
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON in configuration file: {e}")

    @staticmethod
    def _safe_int(value: Any, default: int = 0) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    def _build_course_config_from_db(self, course: Any, db_config: Any, categories: List[Any]) -> Optional[CourseConfig]:
        if not course:
            return None

        external_course_id = str(getattr(course, "gradescope_course_id", None) or getattr(course, "id", "")).strip()
        if not external_course_id:
            return None

        category_rows = sorted(
            categories or [],
            key=lambda row: (getattr(row, "display_order", 0) or 0, getattr(row, "name", "") or "")
        )
        assignment_categories = [
            {
                "name": getattr(row, "name", "") or "",
                "patterns": list(getattr(row, "patterns", None) or []),
                "display_order": self._safe_int(getattr(row, "display_order", 0), 0),
            }
            for row in category_rows
            if getattr(row, "name", None)
        ]

        gradescope_course_id = (
            getattr(db_config, "gradescope_course_id", None)
            or getattr(course, "gradescope_course_id", None)
            or external_course_id
        )

        course_data = {
            "id": external_course_id,
            "general": {
                "id": external_course_id,
                "name": getattr(course, "name", None) or f"Course {external_course_id}",
                "department": getattr(course, "department", None) or "",
                "course_number": getattr(course, "course_number", None) or "",
                "semester": getattr(course, "semester", None) or "",
                "year": self._safe_int(getattr(course, "year", None), 0),
                "instructor": getattr(course, "instructor", None) or "",
            },
            "gradesync": {
                "sources": {
                    "gradescope": {
                        "enabled": bool(
                            getattr(db_config, "gradescope_enabled", False)
                            if db_config is not None
                            else bool(gradescope_course_id)
                        ),
                        "course_id": str(gradescope_course_id),
                    },
                    "prairielearn": {
                        "enabled": bool(getattr(db_config, "prairielearn_enabled", False)) if db_config is not None else False,
                        "course_id": getattr(db_config, "prairielearn_course_id", None) if db_config is not None else None,
                    },
                    "iclicker": {
                        "enabled": bool(getattr(db_config, "iclicker_enabled", False)) if db_config is not None else False,
                        "course_names": list(getattr(db_config, "iclicker_course_names", None) or []) if db_config is not None else [],
                    },
                },
                "database": {
                    "enabled": bool(getattr(db_config, "database_enabled", True)) if db_config is not None else True,
                    "use_as_primary": bool(getattr(db_config, "use_as_primary", True)) if db_config is not None else True,
                },
                "assignment_categories": assignment_categories,
            },
        }

        return CourseConfig(course_data)

    def _get_course_from_db(self, course_id: str) -> Optional[CourseConfig]:
        from sqlalchemy import String, cast, or_
        from api.core.db import SessionLocal
        from api.core.models import Course, CourseConfig as CourseConfigModel, AssignmentCategory

        session = SessionLocal()
        try:
            normalized = str(course_id or "").strip()
            if not normalized:
                return None

            row = (
                session.query(Course, CourseConfigModel)
                .outerjoin(CourseConfigModel, CourseConfigModel.course_id == Course.id)
                .filter(
                    or_(
                        Course.gradescope_course_id == normalized,
                        cast(Course.id, String) == normalized,
                    )
                )
                .first()
            )
            if not row:
                return None

            course, db_config = row
            categories = session.query(AssignmentCategory).filter(AssignmentCategory.course_id == course.id).all()
            return self._build_course_config_from_db(course, db_config, categories)
        finally:
            session.close()

    def _list_course_configs_from_db(self) -> List[CourseConfig]:
        from api.core.db import SessionLocal
        from api.core.models import Course, CourseConfig as CourseConfigModel, AssignmentCategory

        session = SessionLocal()
        try:
            rows = (
                session.query(Course, CourseConfigModel)
                .outerjoin(CourseConfigModel, CourseConfigModel.course_id == Course.id)
                .all()
            )
            if not rows:
                return []

            course_ids = [course.id for course, _ in rows]
            category_rows = (
                session.query(AssignmentCategory)
                .filter(AssignmentCategory.course_id.in_(course_ids))
                .all()
            )
            categories_by_course: Dict[int, List[Any]] = {}
            for category in category_rows:
                categories_by_course.setdefault(category.course_id, []).append(category)

            built: List[CourseConfig] = []
            for course, db_config in rows:
                cfg = self._build_course_config_from_db(
                    course,
                    db_config,
                    categories_by_course.get(course.id, []),
                )
                if cfg is not None:
                    built.append(cfg)

            return built
        finally:
            session.close()
    
    def get_course(self, course_id: str) -> Optional[CourseConfig]:
        """Get configuration for a specific course."""
        normalized = str(course_id or "").strip()
        if not normalized:
            return None

        file_cfg = self.courses.get(normalized)
        if file_cfg is not None:
            return file_cfg

        for cfg in self.courses.values():
            if str(cfg.gradescope_course_id or "").strip() == normalized:
                return cfg

        try:
            return self._get_course_from_db(normalized)
        except Exception as exc:
            logger.warning("Failed to resolve course %s from DB fallback: %s", normalized, exc)
            return None
    
    def list_courses(self) -> List[str]:
        """List all available course IDs."""
        return [cfg.id for cfg in self.list_course_configs()]
    
    def list_course_configs(self) -> List[CourseConfig]:
        """List all course configurations."""
        merged: Dict[str, CourseConfig] = {
            str(cfg.id): cfg for cfg in self.courses.values() if str(getattr(cfg, "id", "")).strip()
        }

        try:
            for db_cfg in self._list_course_configs_from_db():
                key = str(db_cfg.id or "").strip()
                if key:
                    merged[key] = db_cfg
        except Exception as exc:
            logger.warning("Failed to load DB-backed course configurations: %s", exc)

        return list(merged.values())
    
    def get_global_setting(self, key: str, default: Any = None) -> Any:
        """Get a global setting value."""
        return self.global_settings.get(key, default)
    
    def reload(self):
        """Reload configuration from file."""
        self.courses.clear()
        self.global_settings.clear()
        self._load_config()


# Global configuration manager instance
_config_manager: Optional[ConfigManager] = None


def get_config_manager(config_path: Optional[Path] = None) -> ConfigManager:
    """Get or create the global configuration manager."""
    global _config_manager
    if _config_manager is None or config_path is not None:
        _config_manager = ConfigManager(config_path)
    return _config_manager


def get_course_config(course_id: str) -> Optional[CourseConfig]:
    """Convenience function to get a course configuration."""
    return get_config_manager().get_course(course_id)


def list_available_courses() -> List[str]:
    """Convenience function to list all available courses."""
    return get_config_manager().list_courses()


# Environment variables configuration
class EnvConfig:
    """Manages environment variables."""
    
    @staticmethod
    def get_gradescope_credentials() -> tuple[str, str]:
        """Get Gradescope email and password."""
        email = os.getenv("GRADESCOPE_EMAIL")
        password = os.getenv("GRADESCOPE_PASSWORD")
        if not email or not password:
            raise ValueError("GRADESCOPE_EMAIL and GRADESCOPE_PASSWORD must be set")
        return email, password
    
    @staticmethod
    def get_prairielearn_token() -> str:
        """Get PrairieLearn API token."""
        token = os.getenv("PL_API_TOKEN")
        if not token:
            raise ValueError("PL_API_TOKEN must be set")
        return token
    
    @staticmethod
    def get_iclicker_credentials() -> tuple[str, str]:
        """Get iClicker username and password."""
        username = os.getenv("ICLICKER_USERNAME")
        password = os.getenv("ICLICKER_PASSWORD")
        if not username or not password:
            raise ValueError("ICLICKER_USERNAME and ICLICKER_PASSWORD must be set")
        return username, password
    
    @staticmethod
    def get_database_url() -> str:
        """Get database connection URL."""
        url = os.getenv("DATABASE_URL")
        if not url:
            raise ValueError("DATABASE_URL must be set")
        return url
