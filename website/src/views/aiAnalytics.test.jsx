import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AIAnalytics from './aiAnalytics';

const mockInitialize = jest.fn();
const mockProcessQuery = jest.fn();

jest.mock('../services/aiAgent', () => ({
  __esModule: true,
  default: {
    getSuggestions: () => ['Show the selected course overview'],
    initialize: (...args) => mockInitialize(...args),
    processQuery: (...args) => mockProcessQuery(...args),
  },
}));

jest.mock('../components/AIAgentSettings', () => function MockSettings() {
  return null;
});

const COURSES = [{
  id: '1',
  gradescope_course_id: 'demo-course',
  name: 'Demo Course',
}];

async function runQuery(user, question = 'Show overview') {
  await user.type(screen.getByLabelText('Ask about the selected course'), question);
  await user.click(screen.getByRole('button', { name: 'Run query' }));
}

describe('AI Analytics live request states', () => {
  beforeEach(() => {
    mockInitialize.mockReset().mockResolvedValue(undefined);
    mockProcessQuery.mockReset();
  });

  it('uses the selected authorized course and labels a successful live result', async () => {
    const user = userEvent.setup();
    mockProcessQuery.mockResolvedValue({
      answer: 'Live overview for Demo Course',
      data: [{ total_students: 32 }],
      source: { type: 'live_course', course_id: 'demo-course' },
    });
    render(<AIAnalytics selectedCourseId="1" courses={COURSES} />);

    await runQuery(user);

    expect(await screen.findByText('Live overview for Demo Course')).toBeInTheDocument();
    expect(screen.getByText('Live course data · Demo Course')).toBeInTheDocument();
    expect(mockInitialize).toHaveBeenCalledWith(expect.objectContaining({ courseId: 'demo-course' }));
    expect(mockProcessQuery).toHaveBeenCalledWith(
      'Show overview',
      expect.objectContaining({ courseId: 'demo-course', signal: expect.any(AbortSignal) }),
    );
    expect(screen.queryByText(/Sample data/i)).not.toBeInTheDocument();
  });

  it('keeps the restored module layout while showing an honest live empty result', async () => {
    const user = userEvent.setup();
    mockProcessQuery.mockResolvedValue({
      answer: 'No matching rows for this course.',
      data: [],
      source: { type: 'live_course', course_id: 'demo-course' },
    });
    render(<AIAnalytics selectedCourseId="1" courses={COURSES} />);

    await runQuery(user);

    expect(await screen.findByText('No matching rows for this course.')).toBeInTheDocument();
    expect(screen.getByText(/returned no tabular rows/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Knowledge Gap Diagnosis' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Student Success Alert' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Question Quality Analysis' })).toBeInTheDocument();
  });

  it('renders live statistics objects instead of dropping their values', async () => {
    const user = userEvent.setup();
    mockProcessQuery.mockResolvedValue({
      answer: 'Overall statistics are as follows:',
      data: { average_score: 82.5, student_count: 32 },
      source: { type: 'live_course', course_id: 'demo-course' },
    });
    render(<AIAnalytics selectedCourseId="1" courses={COURSES} />);

    await runQuery(user, 'Show statistics');

    expect(await screen.findByRole('table', { name: 'Live AI Analytics result fields' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'average_score' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '82.5' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'student_count' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '32' })).toBeInTheDocument();
  });

  it('clears an older live result when a 403 course-scope failure arrives', async () => {
    const user = userEvent.setup();
    mockProcessQuery
      .mockResolvedValueOnce({
        answer: 'Old live result',
        data: [{ total_students: 32 }],
        source: { type: 'live_course', course_id: 'demo-course' },
      })
      .mockRejectedValueOnce({
        status: 403,
        code: 'COURSE_SCOPE_FORBIDDEN',
        reason: 'The selected course is outside this session scope.',
        recovery: 'Choose an authorized course and retry.',
      });
    render(<AIAnalytics selectedCourseId="1" courses={COURSES} />);

    await runQuery(user, 'First query');
    expect(await screen.findByText('Old live result')).toBeInTheDocument();
    const input = screen.getByLabelText('Ask about the selected course');
    await user.clear(input);
    await user.type(input, 'Forbidden query');
    await user.click(screen.getByRole('button', { name: 'Run query' }));

    expect(await screen.findByText('This course query is not permitted')).toBeInTheDocument();
    expect(screen.getByText(/COURSE_SCOPE_FORBIDDEN/)).toBeInTheDocument();
    expect(screen.queryByText('Old live result')).not.toBeInTheDocument();
    expect(screen.queryByText(/Sample data/i)).not.toBeInTheDocument();
  });

  it.each([
    [{ status: 500, code: 'INTERNAL_ERROR', reason: 'The service failed.', recovery: 'Retry later.' }, 'The course analysis service is unavailable', 'INTERNAL_ERROR'],
    [{ status: 0, code: 'REQUEST_TIMEOUT', reason: 'No result arrived in time.', recovery: 'Retry now.' }, 'The live course query timed out', 'REQUEST_TIMEOUT'],
    [{ status: 409, code: 'SOURCE_MISMATCH', reason: 'Wrong course source.', recovery: 'Retry.' }, 'The course changed before results arrived', 'SOURCE_MISMATCH'],
  ])('renders a distinct failure without a pseudo-live card', async (failure, title, code) => {
    const user = userEvent.setup();
    mockProcessQuery.mockRejectedValue(failure);
    render(<AIAnalytics selectedCourseId="1" courses={COURSES} />);

    await runQuery(user);

    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(code))).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Live analysis result' })).not.toBeInTheDocument();
  });

  it('retries in place and only renders the new successful result', async () => {
    const user = userEvent.setup();
    mockProcessQuery
      .mockRejectedValueOnce({
        status: 500,
        code: 'INTERNAL_ERROR',
        reason: 'Temporary failure.',
        recovery: 'Retry.',
      })
      .mockResolvedValueOnce({
        answer: 'Fresh live result',
        data: [{ total_students: 32 }],
        source: { type: 'live_course', course_id: 'demo-course' },
      });
    render(<AIAnalytics selectedCourseId="1" courses={COURSES} />);

    await runQuery(user);
    expect(await screen.findByText('The course analysis service is unavailable')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry query' }));

    expect(await screen.findByText('Fresh live result')).toBeInTheDocument();
    expect(screen.queryByText('Temporary failure.')).not.toBeInTheDocument();
  });

  it('shows a real empty selection state and no cross-course static examples', async () => {
    render(<AIAnalytics selectedCourseId="" courses={COURSES} />);

    expect(screen.getByText('No course selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run query' })).toBeDisabled();
    expect(screen.getByRole('heading', { name: 'Semantic Data Detective' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Knowledge Gap Diagnosis' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Student Success Alert' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Question Quality Analysis' })).toBeInTheDocument();
    await waitFor(() => expect(mockInitialize).not.toHaveBeenCalled());
    expect(document.body.textContent).not.toMatch(/Zhang San|Li Si|example\.com|Memory Management|Pointer usage|Binary Tree/i);
  });
});
