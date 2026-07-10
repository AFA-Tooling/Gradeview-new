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
});
