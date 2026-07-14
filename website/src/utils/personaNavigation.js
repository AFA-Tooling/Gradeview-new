import {
  STUDENT_PERSONA,
  buildStudentExperiencePath,
  isValidStudentIdentifier,
} from './studentRoutes';

export const SHELL_PERMISSION_STATUS = Object.freeze({
  GUEST: 'guest',
  RESOLVING: 'resolving',
  READY: 'ready',
  ERROR: 'error',
});

export const SHELL_UI_CAPABILITIES_STORAGE_KEY = 'shellUiCapabilities';

export const SHELL_SESSION_STORAGE_KEYS = Object.freeze([
  'token',
  'permissions',
  SHELL_UI_CAPABILITIES_STORAGE_KEY,
  'email',
  'name',
  'profilepicture',
  'selectedCourseId',
  'selectedStudentEmail',
]);

export const SHELL_PERSONA = Object.freeze({
  GUEST: 'guest',
  RESOLVING: 'resolving',
  STUDENT_SELF: 'student-self',
  STAFF_CLASS: 'staff-class',
  STAFF_STUDENT_REVIEW: 'staff-student-review',
});

export const STUDENT_NAV_ITEMS = Object.freeze([
  { name: 'Workspace', href: '/profile', icon: 'workspace', page: 'workspace', exact: true },
  { name: 'Report', href: '/profile/report', icon: 'report', page: 'report', exact: true },
  { name: 'Attendance', href: '/profile/attendance', icon: 'attendance', page: 'attendance', exact: true },
  { name: 'Labs', href: '/profile/labs', icon: 'labs', page: 'labs', exact: true },
  { name: 'Projects', href: '/profile/projects', icon: 'projects', page: 'projects', exact: true },
  { name: 'Exams', href: '/profile/exams', icon: 'exams', page: 'exams' },
  { name: 'Assignments', href: '/profile/assignments', icon: 'assignments', page: 'assignments', exact: true },
  { name: 'Explain Score', href: '/profile/explain', icon: 'explain', page: 'explain', exact: true },
  { name: 'Concepts', href: '/profile/concepts', icon: 'concepts', page: 'concepts', exact: true },
  { name: 'Policy', href: '/profile/policy', icon: 'policy', page: 'policy', exact: true },
]);

export const STAFF_NAV_ITEMS = Object.freeze([
  { name: 'Assignments', href: '/admin?tab=assignments', icon: 'assignments', activeTab: 'assignments' },
  { name: 'Students', href: '/admin?tab=students', icon: 'students', activeTab: 'students' },
  { name: 'AI Analytics', href: '/admin?tab=analytics', icon: 'ai-analytics', activeTab: 'analytics' },
  { name: 'Grade Sync', href: '/gradesync', icon: 'grade-sync', exact: true },
  { name: 'Alerts', href: '/alerts', icon: 'alerts', exact: true },
  { name: 'Settings', href: '/settings', icon: 'settings', exact: true },
]);

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase();
}

function collectPermissionSources(...sources) {
  return sources.flatMap((source) => {
    if (!source || typeof source !== 'object') return [];
    return source.permissions && typeof source.permissions === 'object'
      ? [source, source.permissions]
      : [source];
  });
}

export function parseStoredPermissions(rawValue) {
  if (!rawValue) return {};
  if (typeof rawValue === 'object') return rawValue;
  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function buildLoginUiCapabilities(loginData = {}) {
  if (loginData?.demo !== true) return null;
  return {
    demo: true,
    read_only: true,
    source: 'demo-login',
  };
}

function setOrRemoveStorageValue(storage, key, value) {
  const normalized = value == null ? '' : String(value).trim();
  if (normalized) {
    storage.setItem(key, normalized);
  } else {
    storage.removeItem(key);
  }
}

export function persistShellLoginSession(storage, {
  loginData = {},
  identity = {},
  selectedCourseId = '',
} = {}) {
  if (!storage?.setItem || !storage?.removeItem) return null;

  storage.setItem('token', loginData?.token || '');
  storage.setItem('permissions', JSON.stringify(loginData?.permissions || {}));
  setOrRemoveStorageValue(storage, 'email', identity.email);
  setOrRemoveStorageValue(storage, 'name', identity.name);
  setOrRemoveStorageValue(storage, 'profilepicture', identity.profilepicture);
  setOrRemoveStorageValue(storage, 'selectedCourseId', selectedCourseId);
  storage.removeItem('selectedStudentEmail');

  const uiCapabilities = buildLoginUiCapabilities(loginData);
  if (uiCapabilities) {
    storage.setItem(SHELL_UI_CAPABILITIES_STORAGE_KEY, JSON.stringify(uiCapabilities));
  } else {
    storage.removeItem(SHELL_UI_CAPABILITIES_STORAGE_KEY);
  }
  return uiCapabilities;
}

export function clearShellSession(storage) {
  if (!storage?.removeItem) return;
  SHELL_SESSION_STORAGE_KEYS.forEach((key) => storage.removeItem(key));
}

export function decodePermissionToken(token, decodeToken) {
  const rawToken = String(token || '').replace(/^Bearer\s+/i, '').trim();
  if (!rawToken || typeof decodeToken !== 'function') return {};
  try {
    const claims = decodeToken(rawToken);
    return claims && typeof claims === 'object' ? claims : {};
  } catch {
    return {};
  }
}

export function deriveShellCapabilities(...permissionSources) {
  const sources = collectPermissionSources(...permissionSources);
  const courseRoles = sources.flatMap((source) => Object.values(source.course_roles || {}));
  const roles = sources.flatMap((source) => [source.role, ...courseRoles]).map(normalizeRole);
  const isStaff = sources.some((source) => (
    source.is_super === true
    || source.has_course_admin === true
    || source.has_instructor === true
  )) || roles.some((role) => ['super_admin', 'course_admin', 'instructor'].includes(role));
  const isStudent = sources.some((source) => source.has_student === true)
    || roles.includes('student');
  const isDemo = sources.some((source) => source.is_demo === true || source.demo === true);
  const explicitlyReadOnly = sources.some((source) => (
    source.read_only === true || source.is_read_only === true
  ));

  return {
    isStaff,
    isStudent,
    isDemo,
    isReadOnly: isDemo || explicitlyReadOnly,
    hasKnownRole: isStaff || isStudent,
    primaryRole: isStaff ? 'staff' : isStudent ? 'student' : 'unknown',
  };
}

export function createInitialPermissionState({
  token = '',
  storedPermissions = {},
  storedUiCapabilities = {},
  tokenClaims = {},
} = {}) {
  if (!String(token || '').trim()) {
    return {
      status: SHELL_PERMISSION_STATUS.GUEST,
      capabilities: deriveShellCapabilities(),
      error: null,
    };
  }

  const capabilities = deriveShellCapabilities(storedPermissions, storedUiCapabilities, tokenClaims);
  return {
    status: capabilities.hasKnownRole
      ? SHELL_PERMISSION_STATUS.READY
      : SHELL_PERMISSION_STATUS.RESOLVING,
    capabilities,
    error: null,
  };
}

export function permissionStateReducer(state, action) {
  switch (action.type) {
    case 'permissions-resolved': {
      const resolved = deriveShellCapabilities(action.permissions, action.tokenClaims);
      const capabilities = {
        ...resolved,
        isDemo: state.capabilities.isDemo || resolved.isDemo,
        isReadOnly: state.capabilities.isReadOnly || resolved.isReadOnly,
      };
      return {
        status: capabilities.hasKnownRole
          ? SHELL_PERMISSION_STATUS.READY
          : SHELL_PERMISSION_STATUS.ERROR,
        capabilities,
        error: capabilities.hasKnownRole ? null : 'No active course role was returned.',
      };
    }
    case 'permissions-failed':
      if (state.capabilities.hasKnownRole) {
        return { ...state, error: action.error || 'Permissions could not be refreshed.' };
      }
      return {
        ...state,
        status: SHELL_PERMISSION_STATUS.ERROR,
        error: action.error || 'Permissions could not be loaded.',
      };
    default:
      return state;
  }
}

export function getStudentReviewContext(pathname) {
  const match = String(pathname || '').match(/^\/students\/([^/]+)(?:\/|$)/i);
  if (!match) return null;
  try {
    return { identifier: decodeURIComponent(match[1]) };
  } catch {
    return { identifier: match[1] };
  }
}

function buildStaffStudentSection(pathname, {
  selectedStudentIdentifier = '',
  courseId = '',
} = {}) {
  const routeIdentifier = getStudentReviewContext(pathname)?.identifier || '';
  const identifier = isValidStudentIdentifier(routeIdentifier)
    ? routeIdentifier
    : isValidStudentIdentifier(selectedStudentIdentifier)
      ? String(selectedStudentIdentifier).trim()
      : '';

  if (!identifier) {
    return {
      title: 'STUDENT',
      description: 'Select a student in Students to open student views.',
      items: [{
        name: 'Select student',
        href: '/admin?tab=students',
        icon: 'select-student',
        exact: true,
        active: false,
      }],
    };
  }

  const search = courseId
    ? `?${new URLSearchParams({ course_id: String(courseId).trim() }).toString()}`
    : '';
  return {
    title: 'STUDENT',
    items: STUDENT_NAV_ITEMS.map((item) => ({
      ...item,
      href: buildStudentExperiencePath({
        persona: STUDENT_PERSONA.STAFF,
        identifier,
        page: item.page,
        search,
      }),
    })),
  };
}

export function buildNavigationModel(capabilities, pathname = '/', options = {}) {
  if (!capabilities?.hasKnownRole) {
    return {
      persona: SHELL_PERSONA.RESOLVING,
      personaLabel: 'Loading navigation',
      sections: [],
      reviewContext: null,
    };
  }

  if (capabilities.isStaff) {
    const reviewContext = getStudentReviewContext(pathname);
    return {
      persona: reviewContext
        ? SHELL_PERSONA.STAFF_STUDENT_REVIEW
        : SHELL_PERSONA.STAFF_CLASS,
      personaLabel: reviewContext ? 'Student review' : 'Class workspace',
      sections: [
        buildStaffStudentSection(pathname, options),
        { title: 'ADMIN', items: STAFF_NAV_ITEMS },
      ],
      reviewContext,
    };
  }

  return {
    persona: SHELL_PERSONA.STUDENT_SELF,
    personaLabel: 'Student workspace',
    sections: [{ title: 'STUDENT', items: STUDENT_NAV_ITEMS }],
    reviewContext: null,
  };
}

export function buildShellRenderModel({
  loggedIn,
  permissionState,
  pathname = '/',
  selectedStudentIdentifier = '',
  courseId = '',
}) {
  const capabilities = permissionState?.capabilities || deriveShellCapabilities();
  return {
    showSidebar: Boolean(loggedIn),
    showDemoBanner: Boolean(loggedIn && capabilities.isDemo),
    showReadOnlyBanner: Boolean(loggedIn && capabilities.isReadOnly),
    navigation: loggedIn
      ? buildNavigationModel(capabilities, pathname, {
          selectedStudentIdentifier,
          courseId,
        })
      : {
          persona: SHELL_PERSONA.GUEST,
          personaLabel: 'Signed out',
          sections: [],
          reviewContext: null,
        },
  };
}

export function formatCourseLabel(course) {
  const pieces = [course?.year, course?.semester, course?.name]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  if (pieces.length > 0) return pieces.join(' ');
  return String(course?.gradescope_course_id || course?.id || 'Course').trim();
}

export function normalizeCourseList(list) {
  const merged = new Map();
  (Array.isArray(list) ? list : []).forEach((course) => {
    const id = String(course?.id || course?.gradescope_course_id || '').trim();
    const key = String(course?.gradescope_course_id || id).trim();
    if (!id || !key || merged.has(key)) return;
    merged.set(key, { ...course, id });
  });
  return Array.from(merged.values());
}

export function resolveCourseQueryId(courseId, courses = []) {
  const selectedId = String(courseId || '').trim();
  const matched = courses.find((course) => String(course?.id || '') === selectedId);
  return String(matched?.gradescope_course_id || selectedId).trim();
}

export function getCourseControlModel(courses, selectedCourseId) {
  const normalizedCourses = normalizeCourseList(courses);
  if (normalizedCourses.length === 0) {
    return { kind: 'none', courses: [], selectedCourse: null, label: '', accessibleName: 'Current course' };
  }

  const selectedCourse = normalizedCourses.find(
    (course) => String(course.id) === String(selectedCourseId),
  ) || normalizedCourses[0];
  const label = formatCourseLabel(selectedCourse);
  return {
    kind: normalizedCourses.length === 1 ? 'static' : 'select',
    courses: normalizedCourses,
    selectedCourse,
    value: String(selectedCourse.id),
    label,
    accessibleName: normalizedCourses.length === 1
      ? `Current course: ${label}`
      : 'Current course',
  };
}

export function isNavigationItemActive(item, pathname, search = '') {
  if (item.active === false) return false;
  const hrefPath = String(item.href || '').split('?')[0] || '/';
  const pathMatches = hrefPath === '/'
    ? pathname === '/'
    : item.exact
      ? pathname === hrefPath
      : pathname === hrefPath || pathname.startsWith(`${hrefPath}/`);
  if (!pathMatches) return false;
  if (!item.activeTab) return true;

  const requestedTab = new URLSearchParams(search).get('tab');
  const activeTab = ['students', 'analytics'].includes(requestedTab)
    ? requestedTab
    : 'assignments';
  return activeTab === item.activeTab;
}
