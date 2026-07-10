import { AIAgent, AIQueryRequestError } from './aiAgent';

describe('AIAgent course-scoped requests', () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends the current course id on the backend request', async () => {
    localStorage.setItem('token', 'test-token');
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        answer: 'Scoped result',
        source: { type: 'live_course', course_id: 'GS 42' },
      }),
    });
    const agent = new AIAgent();

    const result = await agent.queryBackend('Show statistics', { courseId: ' GS 42 ' });

    expect(fetch).toHaveBeenCalledWith(
      '/api/v2/admin/ai-query?course_id=GS%2042',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.source).toEqual({ type: 'live_course', course_id: 'GS 42' });
  });

  it('sends the current course id on the schema request', async () => {
    localStorage.setItem('token', 'test-token');
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ schema: { assignments: ['id'] } }),
    });
    const agent = new AIAgent();

    await expect(agent.fetchDatabaseSchema(' GS 42 ')).resolves.toEqual({ assignments: ['id'] });

    expect(fetch).toHaveBeenCalledWith(
      '/api/v2/admin/ai-query/schema?course_id=GS%2042',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }),
    );
  });

  it('throws on a failed request instead of returning an analysis result', async () => {
    localStorage.setItem('token', 'test-token');
    fetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'course access denied' }),
    });
    const agent = new AIAgent();

    await expect(agent.processQuery('Show statistics', { courseId: 'course-a' }))
      .rejects.toEqual(expect.objectContaining({
        name: 'AIQueryRequestError',
        status: 403,
        message: 'course access denied',
      }));
  });

  it('preserves the stable API code, reason, and recovery for a forbidden course', async () => {
    localStorage.setItem('token', 'test-token');
    fetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        code: 'COURSE_SCOPE_FORBIDDEN',
        reason: 'This course is outside the signed session scope.',
        recovery: 'Choose an authorized course.',
      }),
    });
    const agent = new AIAgent();

    await expect(agent.queryBackend('Show statistics', { courseId: 'course-b' }))
      .rejects.toEqual(expect.objectContaining({
        status: 403,
        code: 'COURSE_SCOPE_FORBIDDEN',
        reason: 'This course is outside the signed session scope.',
        recovery: 'Choose an authorized course.',
      }));
  });

  it('distinguishes a request timeout from a server failure', async () => {
    jest.useFakeTimers();
    localStorage.setItem('token', 'test-token');
    fetch.mockImplementation((_, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const abortError = new Error('aborted');
        abortError.name = 'AbortError';
        reject(abortError);
      });
    }));
    const agent = new AIAgent();

    const request = agent.queryBackend('Show statistics', {
      courseId: 'course-a',
      timeoutMs: 20,
    });
    jest.advanceTimersByTime(20);

    await expect(request).rejects.toEqual(expect.objectContaining({
      code: 'REQUEST_TIMEOUT',
      status: 0,
    }));
    jest.useRealTimers();
  });

  it('rejects a 200 response that contains an error payload', async () => {
    localStorage.setItem('token', 'test-token');
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ type: 'error', answer: 'Query failed' }),
    });
    const agent = new AIAgent();

    await expect(agent.queryBackend('Show statistics', { courseId: 'course-a' }))
      .rejects.toEqual(expect.objectContaining({ message: 'Query failed' }));
  });

  it('rejects a response attributed to another course', async () => {
    localStorage.setItem('token', 'test-token');
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        answer: 'Wrong course',
        source: { type: 'live_course', course_id: 'course-b' },
      }),
    });
    const agent = new AIAgent();

    await expect(agent.queryBackend('Show statistics', { courseId: 'course-a' }))
      .rejects.toBeInstanceOf(AIQueryRequestError);
  });
});
