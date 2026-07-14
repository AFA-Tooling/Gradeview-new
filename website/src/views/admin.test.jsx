import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import Admin from './admin';
import { cachedApiGet } from '../utils/apiCache';

jest.mock('../utils/apiCache', () => ({
  cachedApiGet: jest.fn(),
}));

jest.mock('../utils/apiv2', () => ({
  get: jest.fn(),
}));

jest.mock('./aiAnalytics', () => function MockAIAnalytics() {
  return <div>AI analytics panel</div>;
});

jest.mock('../components/StudentProfile', () => function MockStudentProfile({
  open,
  onClose,
  studentEmail,
  studentName,
}) {
  if (!open) return null;
  return (
    <div role="dialog" aria-label="Student Report">
      <div>{studentName}</div>
      <div>{studentEmail}</div>
      <button type="button" onClick={onClose}>Close</button>
    </div>
  );
});

jest.mock('react-chartjs-2', () => ({
  Bar: () => <div>Bar chart</div>,
  Line: () => <div>Line chart</div>,
}));

function renderAdmin(initialEntry) {
  const router = createMemoryRouter([
    { path: '/admin', element: <Admin /> },
  ], { initialEntries: [initialEntry] });

  return {
    router,
    ...render(<RouterProvider router={router} />),
  };
}

const studentScoreFixture = [
  {
    name: 'Avery Chen',
    email: 'avery.chen@example.edu',
    scores: { Labs: { 'Lab 1': 9 } },
    summarySectionTotals: { Labs: 9 },
    canonicalGrade: { exactScore: 9, displayScore: 9, percentage: 90, letter: 'A' },
  },
  {
    name: 'Zoe Patel',
    email: 'zoe.patel@example.edu',
    scores: { Labs: { 'Lab 1': 5 } },
    summarySectionTotals: { Labs: 5 },
    canonicalGrade: { exactScore: 5, displayScore: 5, percentage: 50, letter: 'F' },
  },
];

function mockStudentScoreData() {
  localStorage.setItem('selectedCourseId', 'course-101');
  const pendingCourseRequest = new Promise(() => {});
  cachedApiGet.mockImplementation((path) => {
    if (path === '/admin/sync' || path === '/students/courses') {
      return pendingCourseRequest;
    }
    if (path.startsWith('/admin/assignments')) {
      return Promise.resolve({ data: { Labs: { 'Lab 1': 10 } } });
    }
    if (path.startsWith('/admin/studentScores')) {
      return Promise.resolve({ data: { students: studentScoreFixture } });
    }
    if (path.startsWith('/bins')) {
      return Promise.resolve({
        data: { assignment_points: { Labs: 10 }, overall_cap_points: 10 },
      });
    }
    return Promise.resolve({ data: {} });
  });
}

describe('Class Health tab URL state', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('selectedCourseId', '1');
    const pendingRequest = new Promise(() => {});
    cachedApiGet.mockImplementation((path) => {
      if (path.startsWith('/admin/studentScores')) {
        return Promise.resolve({ data: { students: [] } });
      }
      return pendingRequest;
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('direct load of tab=students renders Student Scores Overview', async () => {
    renderAdmin('/admin?tab=students');

    expect(await screen.findByRole('heading', { name: 'Student Scores Overview' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Students' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByPlaceholderText('Search assignments…')).not.toBeInTheDocument();
  });

  test('restores another legal tab from the URL', async () => {
    renderAdmin('/admin?tab=analytics');

    expect(await screen.findByText('AI analytics panel')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'AI Analytics' })).toHaveAttribute('aria-selected', 'true');
  });

  test('falls back safely to Assignments for an invalid tab value', () => {
    renderAdmin('/admin?tab=not-a-tab');

    expect(screen.getByRole('tab', { name: 'Assignments' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByPlaceholderText('Search assignments…')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Student Scores Overview' })).not.toBeInTheDocument();
  });

  test('tab actions update the URL and preserve unrelated query parameters', async () => {
    const user = userEvent.setup();
    const { router } = renderAdmin(
      '/admin?tab=students&course_id=demo-cs10&filter=missing',
    );
    await screen.findByRole('heading', { name: 'Student Scores Overview' });

    await user.click(screen.getByRole('tab', { name: 'Assignments' }));

    await waitFor(() => {
      const params = new URLSearchParams(router.state.location.search);
      expect(params.get('tab')).toBe('assignments');
      expect(params.get('course_id')).toBe('demo-cs10');
      expect(params.get('filter')).toBe('missing');
    });
    expect(screen.getByRole('tab', { name: 'Assignments' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByPlaceholderText('Search assignments…')).toBeInTheDocument();
  });

  test('student names open a report dialog without leaving Class Health', async () => {
    mockStudentScoreData();
    const user = userEvent.setup();
    const { router } = renderAdmin('/admin?tab=students&filter=missing');

    const studentButton = await screen.findByRole('button', {
      name: 'View report for Avery Chen (avery.chen@example.edu)',
    });

    studentButton.focus();
    expect(studentButton).toHaveFocus();
    await user.click(studentButton);

    expect(screen.getByRole('dialog', { name: 'Student Report' })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent('Avery Chen');
    expect(screen.getByRole('dialog')).toHaveTextContent('avery.chen@example.edu');
    expect(router.state.location.pathname).toBe('/admin');
    expect(router.state.location.search).toBe('?tab=students&filter=missing');

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Student Report' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Student Scores Overview' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin');
    expect(router.state.location.search).toBe('?tab=students&filter=missing');
  });

  test('search filters by name or email and presents a clear empty state', async () => {
    mockStudentScoreData();
    const user = userEvent.setup();
    renderAdmin('/admin?tab=students');

    const search = await screen.findByRole('searchbox', { name: 'Search students' });
    await screen.findByRole('button', {
      name: 'View report for Avery Chen (avery.chen@example.edu)',
    });

    await user.type(search, 'zoe.patel');
    await waitFor(() => {
      expect(screen.queryByRole('button', {
        name: 'View report for Avery Chen (avery.chen@example.edu)',
      })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', {
      name: 'View report for Zoe Patel (zoe.patel@example.edu)',
    })).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'nobody@example.edu');
    expect(await screen.findByRole('status')).toHaveTextContent(
      'No students match "nobody@example.edu". Try a different name or email.',
    );
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
  });

  test('search does not narrow the existing full-roster CSV export', async () => {
    mockStudentScoreData();
    const user = userEvent.setup();
    const NativeBlob = global.Blob;
    const csvPayloads = [];
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const anchorClick = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    global.Blob = jest.fn((parts, options) => {
      csvPayloads.push(parts);
      return new NativeBlob(parts, options);
    });
    URL.createObjectURL = jest.fn(() => 'blob:student-scores');
    URL.revokeObjectURL = jest.fn();

    try {
      renderAdmin('/admin?tab=students');
      const search = await screen.findByRole('searchbox', { name: 'Search students' });
      await screen.findByRole('button', {
        name: 'View report for Avery Chen (avery.chen@example.edu)',
      });

      await user.type(search, 'Avery');
      await waitFor(() => {
        expect(screen.queryByRole('button', {
          name: 'View report for Zoe Patel (zoe.patel@example.edu)',
        })).not.toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: 'Export CSV' }));

      const csv = csvPayloads.flat().join('');
      expect(csv).toContain('Avery Chen');
      expect(csv).toContain('Zoe Patel');
    } finally {
      global.Blob = NativeBlob;
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
      anchorClick.mockRestore();
    }
  });

  test('sort controls expose the current direction and the next action', async () => {
    mockStudentScoreData();
    const user = userEvent.setup();
    renderAdmin('/admin?tab=students');
    await screen.findByRole('button', {
      name: 'View report for Avery Chen (avery.chen@example.edu)',
    });

    const ascendingAction = screen.getByRole('button', { name: 'Sort by Total ascending' });
    await user.click(ascendingAction);

    const descendingAction = screen.getByRole('button', { name: 'Sort by Total descending' });
    expect(descendingAction.closest('th')).toHaveAttribute('aria-sort', 'ascending');
    await user.click(descendingAction);

    expect(screen.getByRole('button', { name: 'Sort by Total ascending' }).closest('th'))
      .toHaveAttribute('aria-sort', 'descending');
  });

  test('raw column controls use progressive disclosure without changing their behavior', async () => {
    mockStudentScoreData();
    const user = userEvent.setup();
    renderAdmin('/admin?tab=students');
    await screen.findByRole('button', {
      name: 'View report for Avery Chen (avery.chen@example.edu)',
    });

    const summary = screen.getByText('Raw columns (0 of 1 selected)').closest('summary');
    const details = summary.closest('details');
    expect(details).toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Both' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled();

    await user.click(summary);
    expect(details).not.toHaveAttribute('open');
    await user.click(summary);
    expect(details).toHaveAttribute('open');
    await user.click(screen.getByRole('button', { name: 'Select All' }));

    expect(await screen.findByText('Raw columns (1 of 1 selected)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Labs (1/1)' })).toBeInTheDocument();
    expect(details).toHaveAttribute('open');
  });

  test('raw column controls start collapsed on narrow screens', async () => {
    mockStudentScoreData();
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = jest.fn(() => ({
      matches: true,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }));

    try {
      renderAdmin('/admin?tab=students');
      await screen.findByRole('button', {
        name: 'View report for Avery Chen (avery.chen@example.edu)',
      });
      expect(screen.getByText('Raw columns (0 of 1 selected)').closest('details'))
        .not.toHaveAttribute('open');
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });
});
