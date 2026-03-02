"""
Unified Configuration Manager for GradeSync.

Loads GradeSync settings from the repository root config.json (`gradesync` section)
with backward compatibility for legacy gradesync/config.json format.
"""
import json
import os
from pathlib import Path
from typing import Dict, List, Optional, Any
import logging

logger = logging.getLogger(__name__)

def _resolve_default_config_path() -> Path:
    """Resolve default config path with fallback to legacy location."""
    root_config = Path(__file__).parent.parent.parent / "config.json"
    legacy_config = Path(__file__).parent.parent / "config.json"
    if root_config.exists():
        return root_config
    return legacy_config


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
            raise FileNotFoundError(f"Configuration file not found: {self.config_path}")
        
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
    
    def get_course(self, course_id: str) -> Optional[CourseConfig]:
        """Get configuration for a specific course."""
        return self.courses.get(course_id)
    
    def list_courses(self) -> List[str]:
        """List all available course IDs."""
        return list(self.courses.keys())
    
    def list_course_configs(self) -> List[CourseConfig]:
        """List all course configurations."""
        return list(self.courses.values())
    
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
