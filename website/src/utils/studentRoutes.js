export const STUDENT_PERSONA = Object.freeze({
  SELF: 'student-self',
  STAFF: 'staff-review',
});

const PAGE_DEFINITIONS = Object.freeze([
  { key: 'workspace', kind: 'workspace', selfSuffix: '', staffSuffix: 'workspace', label: 'Student Workspace' },
  { key: 'report', kind: 'report', selfSuffix: 'report', staffSuffix: 'report', label: 'Student Report' },
  { key: 'attendance', kind: 'category', pageKey: 'attendance', selfSuffix: 'attendance', staffSuffix: 'attendance', label: 'Attendance' },
  { key: 'labs', kind: 'category', pageKey: 'labs', selfSuffix: 'labs', staffSuffix: 'labs', label: 'Labs' },
  { key: 'projects', kind: 'category', pageKey: 'projects', selfSuffix: 'projects', staffSuffix: 'projects', label: 'Projects' },
  { key: 'exams', kind: 'exams', selfSuffix: 'exams', staffSuffix: 'exams', label: 'Exams' },
  { key: 'quest', kind: 'singleExam', examKey: 'quest', selfSuffix: 'exams/quest', staffSuffix: 'exams/quest', label: 'Quest' },
  { key: 'midterm', kind: 'singleExam', examKey: 'midterm', selfSuffix: 'exams/midterm', staffSuffix: 'exams/midterm', label: 'Midterm' },
  { key: 'postterm', kind: 'singleExam', examKey: 'postterm', selfSuffix: 'exams/postterm', staffSuffix: 'exams/postterm', label: 'Postterm' },
  { key: 'assignments', kind: 'assignments', selfSuffix: 'assignments', staffSuffix: 'assignments', label: 'Assignment Ledger' },
  { key: 'explain', kind: 'explain', selfSuffix: 'explain', staffSuffix: 'explain', label: 'Explain Score' },
  { key: 'concepts', kind: 'concepts', selfSuffix: 'concepts', staffSuffix: 'concepts', label: 'Concept Diagnosis' },
  { key: 'policy', kind: 'policy', selfSuffix: 'policy', staffSuffix: 'policy', label: 'Policy Reference', courseContext: true },
]);

const PAGE_BY_KEY = new Map(PAGE_DEFINITIONS.map((page) => [page.key, page]));
const SELF_PAGE_BY_SUFFIX = new Map(PAGE_DEFINITIONS.map((page) => [page.selfSuffix, page]));
const STAFF_PAGE_BY_SUFFIX = new Map(PAGE_DEFINITIONS.map((page) => [page.staffSuffix, page]));

function stripSlashes(value = '') {
  return String(value || '').replace(/^\/+|\/+$/g, '');
}

function normalizeSearch(search = '') {
  const value = String(search || '').trim();
  if (!value) return '';
  return value.startsWith('?') ? value : `?${value}`;
}

function safeDecodePathSegment(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return '';
  }
}

export function isValidStudentIdentifier(value = '') {
  const identifier = String(value || '').trim();
  if (!identifier || identifier.length > 254 || /[\s/\\\u0000-\u001f]/.test(identifier)) return false;
  return /^[^@]+@[^@]+\.[^@]+$/.test(identifier);
}

function toPageResult(page) {
  if (!page) {
    return {
      key: 'unknown',
      kind: 'unknown',
      label: 'Student page not found',
      courseContext: false,
    };
  }
  return { ...page };
}

export function parseStudentExperiencePath(pathname = '') {
  const normalizedPath = `/${stripSlashes(pathname)}`;

  if (normalizedPath === '/profile' || normalizedPath.startsWith('/profile/')) {
    const suffix = stripSlashes(normalizedPath.slice('/profile'.length));
    return {
      persona: STUDENT_PERSONA.SELF,
      identifier: '',
      identifierValid: true,
      page: toPageResult(SELF_PAGE_BY_SUFFIX.get(suffix)),
    };
  }

  if (normalizedPath === '/students' || normalizedPath.startsWith('/students/')) {
    const remainder = stripSlashes(normalizedPath.slice('/students'.length));
    const [rawIdentifier = '', ...suffixParts] = remainder.split('/');
    const identifier = safeDecodePathSegment(rawIdentifier);
    const suffix = stripSlashes(suffixParts.join('/'));
    const page = suffix
      ? STAFF_PAGE_BY_SUFFIX.get(suffix)
      : PAGE_BY_KEY.get('report');

    return {
      persona: STUDENT_PERSONA.STAFF,
      identifier,
      identifierValid: isValidStudentIdentifier(identifier),
      page: toPageResult(page),
    };
  }

  return {
    persona: null,
    identifier: '',
    identifierValid: false,
    page: toPageResult(null),
  };
}

export function getStudentPage(pageOrKey = 'workspace') {
  if (typeof pageOrKey === 'object' && pageOrKey?.key) {
    return PAGE_BY_KEY.get(pageOrKey.key) || null;
  }
  return PAGE_BY_KEY.get(String(pageOrKey || '')) || null;
}

export function buildStudentExperiencePath({
  persona = STUDENT_PERSONA.SELF,
  identifier = '',
  page = persona === STUDENT_PERSONA.STAFF ? 'report' : 'workspace',
  search = '',
} = {}) {
  const definition = getStudentPage(page);
  if (!definition) return '';

  const query = normalizeSearch(search);
  if (persona === STUDENT_PERSONA.STAFF) {
    if (!isValidStudentIdentifier(identifier)) return '';
    const base = `/students/${encodeURIComponent(String(identifier).trim())}`;
    return `${base}/${definition.staffSuffix}${query}`;
  }

  const suffix = definition.selfSuffix ? `/${definition.selfSuffix}` : '';
  return `/profile${suffix}${query}`;
}

export function mergeStudentRouteQuery(search = '', updates = {}) {
  const params = new URLSearchParams(normalizeSearch(search));
  Object.entries(updates || {}).forEach(([key, rawValue]) => {
    if (rawValue === undefined || rawValue === null || rawValue === '') {
      params.delete(key);
      return;
    }
    params.set(key, String(rawValue));
  });
  const value = params.toString();
  return value ? `?${value}` : '';
}

export function getStudentRouteCourseId(search = '') {
  return new URLSearchParams(normalizeSearch(search)).get('course_id') || '';
}

export function resolveCourseSelection(courseId = '', courses = []) {
  const requested = String(courseId || '').trim();
  if (!requested) return '';
  const courseList = Array.isArray(courses) ? courses : [];
  const matched = courseList.find((course) => (
    String(course?.id || '') === requested
    || String(course?.gradescope_course_id || '') === requested
  ));
  if (matched) return String(matched.id);
  return courseList.length === 0 ? requested : '';
}

export function getStableCourseIdentifier(course, fallback = '') {
  return String(course?.gradescope_course_id || course?.id || fallback || '').trim();
}

export function normalizeStudentOption(rawStudent) {
  if (Array.isArray(rawStudent)) {
    return {
      name: String(rawStudent[0] || rawStudent[1] || '').trim(),
      email: String(rawStudent[1] || '').trim().toLowerCase(),
      section: String(rawStudent[2] || '').trim(),
    };
  }

  return {
    name: String(rawStudent?.name || rawStudent?.legal_name || rawStudent?.email || '').trim(),
    email: String(rawStudent?.email || '').trim().toLowerCase(),
    section: String(rawStudent?.section || rawStudent?.section_name || '').trim(),
  };
}

export function normalizeStudentOptions(rawStudents = []) {
  return (Array.isArray(rawStudents) ? rawStudents : [])
    .map(normalizeStudentOption)
    .filter((student) => isValidStudentIdentifier(student.email))
    .sort((a, b) => (
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      || a.email.localeCompare(b.email)
    ));
}

function combineSearch(currentSearch, targetSearch) {
  const current = new URLSearchParams(normalizeSearch(currentSearch));
  const target = new URLSearchParams(normalizeSearch(targetSearch));
  current.forEach((value, key) => {
    if (!target.has(key)) target.set(key, value);
  });
  const value = target.toString();
  return value ? `?${value}` : '';
}

export function scopeProfileHrefForStaff(href, currentLocation) {
  const current = parseStudentExperiencePath(currentLocation?.pathname || '');
  if (current.persona !== STUDENT_PERSONA.STAFF || !current.identifierValid) return '';

  let target;
  try {
    target = new URL(String(href || ''), 'https://gradeview.local');
  } catch {
    return '';
  }
  if (target.origin !== 'https://gradeview.local') return '';

  const targetContext = parseStudentExperiencePath(target.pathname);
  if (targetContext.persona !== STUDENT_PERSONA.SELF || targetContext.page.kind === 'unknown') return '';

  return buildStudentExperiencePath({
    persona: STUDENT_PERSONA.STAFF,
    identifier: current.identifier,
    page: targetContext.page,
    search: combineSearch(currentLocation?.search || '', target.search),
  });
}

export function getClassHealthStudentsPath() {
  return '/admin?tab=students';
}

export { PAGE_DEFINITIONS };
