import {
  AI_QUERY_STATUS,
  SAMPLE_ANALYTICS_SOURCE,
  aiQueryReducer,
  buildCourseScopedAIPath,
  createInitialAIQueryState,
  createLiveCourseSource,
  getAIQueryFailurePresentation,
  getAnalyticsSourceLabel,
  resolveAIAnalyticsCourse,
} from './aiAnalytics';

describe('AI Analytics course scope', () => {
  it('uses the normalized Gradescope course id in request paths', () => {
    const context = resolveAIAnalyticsCourse(' 17 ', [
      { id: 17, gradescope_course_id: ' 884422 ', name: 'Demo Course' },
    ]);

    expect(context).toMatchObject({ courseId: '884422', courseLabel: 'Demo Course' });
    expect(buildCourseScopedAIPath('/api/v2/admin/ai-query', context.courseId))
      .toBe('/api/v2/admin/ai-query?course_id=884422');
  });

  it('encodes external course ids without reusing another course', () => {
    const first = resolveAIAnalyticsCourse('course-a', [
      { id: 'course-a', gradescope_course_id: 'GS A' },
      { id: 'course-b', gradescope_course_id: 'GS B' },
    ]);
    const second = resolveAIAnalyticsCourse('course-b', [
      { id: 'course-a', gradescope_course_id: 'GS A' },
      { id: 'course-b', gradescope_course_id: 'GS B' },
    ]);

    expect(buildCourseScopedAIPath('/api/v2/admin/ai-query', first.courseId))
      .toContain('course_id=GS%20A');
    expect(buildCourseScopedAIPath('/api/v2/admin/ai-query', second.courseId))
      .toContain('course_id=GS%20B');
  });
});

describe('AI Analytics request state', () => {
  it('clears a previous success and never exposes it as a failed query result', () => {
    const previousSuccess = {
      ...createInitialAIQueryState(),
      status: AI_QUERY_STATUS.SUCCESS,
      requestId: 1,
      result: { answer: 'Old result' },
      source: createLiveCourseSource('course-a', 'Course A'),
    };
    const loading = aiQueryReducer(previousSuccess, {
      type: 'query-started',
      requestId: 2,
      query: 'new query',
    });
    const failed = aiQueryReducer(loading, {
      type: 'query-failed',
      requestId: 2,
      error: { title: 'Failed' },
    });

    expect(loading.result).toBeNull();
    expect(failed).toMatchObject({ status: AI_QUERY_STATUS.ERROR, result: null, source: null });
  });

  it('ignores a late response from an older request', () => {
    const loading = aiQueryReducer(createInitialAIQueryState(), {
      type: 'query-started',
      requestId: 4,
      query: 'current course query',
    });
    const state = aiQueryReducer(loading, {
      type: 'query-succeeded',
      requestId: 3,
      result: { answer: 'stale result' },
      source: createLiveCourseSource('old-course', 'Old Course'),
    });

    expect(state).toBe(loading);
    expect(state.status).toBe(AI_QUERY_STATUS.LOADING);
  });
});

describe('AI Analytics source and recovery labels', () => {
  it('visibly distinguishes sample data from live course data', () => {
    expect(getAnalyticsSourceLabel(SAMPLE_ANALYTICS_SOURCE))
      .toBe('Sample data · Not from the selected course');
    expect(getAnalyticsSourceLabel(createLiveCourseSource('42', 'CS 101')))
      .toBe('Live course data · CS 101');
  });

  it('does not tell an already authenticated user to log in again for a 403', () => {
    const presentation = getAIQueryFailurePresentation({
      status: 403,
      message: 'course access denied',
    });
    const copy = Object.values(presentation).join(' ').toLowerCase();

    expect(copy).not.toContain('log in');
    expect(copy).not.toContain('logged in');
    expect(presentation.recovery).toContain('selected course');
  });
});
