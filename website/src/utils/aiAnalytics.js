export const AI_QUERY_STATUS = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  SUCCESS: 'success',
  ERROR: 'error',
});

export const SAMPLE_ANALYTICS_SOURCE = Object.freeze({
  type: 'sample',
  label: 'Sample data',
});

export function normalizeAIAnalyticsCourseId(value) {
  if (Array.isArray(value) || value === null || value === undefined) return '';
  return String(value).trim();
}

export function resolveAIAnalyticsCourse(selectedCourseId, courses = []) {
  const selectedId = normalizeAIAnalyticsCourseId(selectedCourseId);
  const courseList = Array.isArray(courses) ? courses : [];
  const course = courseList.find((candidate) => {
    const internalId = normalizeAIAnalyticsCourseId(candidate?.id);
    const gradescopeId = normalizeAIAnalyticsCourseId(candidate?.gradescope_course_id);
    return selectedId && (internalId === selectedId || gradescopeId === selectedId);
  });
  const courseId = normalizeAIAnalyticsCourseId(
    course?.gradescope_course_id || course?.id || selectedId,
  );
  const courseLabel = String(
    course?.name
      || [course?.department, course?.course_number, course?.semester, course?.year]
        .filter(Boolean)
        .join(' ')
      || 'Selected course',
  ).trim();

  return { course, courseId, courseLabel };
}

export function buildCourseScopedAIPath(path, courseId) {
  const normalizedCourseId = normalizeAIAnalyticsCourseId(courseId);
  if (!normalizedCourseId) {
    throw new Error('A selected course is required for AI Analytics.');
  }
  const separator = String(path).includes('?') ? '&' : '?';
  return `${path}${separator}course_id=${encodeURIComponent(normalizedCourseId)}`;
}

export function createLiveCourseSource(courseId, courseLabel = 'Selected course') {
  return {
    type: 'live_course',
    course_id: normalizeAIAnalyticsCourseId(courseId),
    label: String(courseLabel || 'Selected course').trim(),
  };
}

export function getAnalyticsSourceLabel(source) {
  if (source?.type === 'sample') {
    return 'Sample data · Not from the selected course';
  }
  if (source?.type === 'live_course') {
    return `Live course data · ${source.label || 'Selected course'}`;
  }
  return 'Source unavailable';
}

export function createInitialAIQueryState() {
  return {
    status: AI_QUERY_STATUS.IDLE,
    requestId: 0,
    query: '',
    result: null,
    error: null,
    source: null,
  };
}

export function aiQueryReducer(state, action) {
  switch (action.type) {
    case 'query-started':
      return {
        status: AI_QUERY_STATUS.LOADING,
        requestId: action.requestId,
        query: action.query,
        result: null,
        error: null,
        source: null,
      };
    case 'query-succeeded':
      if (action.requestId !== state.requestId) return state;
      return {
        ...state,
        status: AI_QUERY_STATUS.SUCCESS,
        result: action.result,
        error: null,
        source: action.source,
      };
    case 'query-failed':
      if (action.requestId !== state.requestId) return state;
      return {
        ...state,
        status: AI_QUERY_STATUS.ERROR,
        result: null,
        error: action.error,
        source: null,
      };
    default:
      return state;
  }
}

export function getAIQueryFailurePresentation(error) {
  const status = Number(error?.status || 0);
  const detail = String(error?.message || '').trim();

  if (error?.code === 'COURSE_REQUIRED') {
    return {
      title: 'Select a course before querying',
      message: 'AI Analytics needs a current course to keep results scoped correctly.',
      recovery: 'Choose a course from the course selector, then retry the query.',
    };
  }
  if (error?.code === 'SOURCE_MISMATCH') {
    return {
      title: 'The course changed before results arrived',
      message: 'The response did not match the currently selected course, so it was discarded.',
      recovery: 'Retry the query for the course now shown above.',
    };
  }
  if (status === 403) {
    return {
      title: 'This course query is not permitted',
      message: detail || 'Your account does not have access to AI Analytics for this course.',
      recovery: 'Confirm the selected course or ask a course administrator to verify your access, then retry.',
    };
  }
  if (status === 401) {
    return {
      title: 'Your session ended',
      message: detail || 'The server could not verify the current session.',
      recovery: 'Return to the sign-in page, restore the session, then retry this course query.',
    };
  }
  if (status === 400) {
    return {
      title: 'The query could not be processed',
      message: detail || 'The server could not understand this query.',
      recovery: 'Review the question or choose one of the course query examples, then retry.',
    };
  }
  if (status === 429) {
    return {
      title: 'AI Analytics is temporarily busy',
      message: 'The query rate limit was reached.',
      recovery: 'Wait a moment, then retry this query.',
    };
  }
  if (status >= 500) {
    return {
      title: 'The course analysis service is unavailable',
      message: 'No result was produced for this query.',
      recovery: 'Retry now. If the problem continues, contact the GradeView administrator.',
    };
  }
  return {
    title: 'The query did not complete',
    message: detail || 'No result was produced for this query.',
    recovery: 'Check your connection and retry the query.',
  };
}
