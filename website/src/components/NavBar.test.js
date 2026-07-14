import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import NavBar from './NavBar';
import { StudentSelectionContext } from './StudentSelectionWrapper';
import StudentProfile from '../views/studentProfile';
import { cachedApiGet } from '../utils/apiCache';
import {
  fetchStudentGradeFlow,
  fetchStudentProfileData,
} from '../utils/studentProfileData';

jest.mock('../utils/apiCache', () => ({
  cachedApiGet: jest.fn(),
}));

jest.mock('../utils/studentProfileData', () => ({
  fetchStudentGradeFlow: jest.fn(),
  fetchStudentProfileData: jest.fn(),
  resolveCourseQueryId: (courseId, courses = []) => (
    courses.find((course) => String(course.id) === String(courseId))?.gradescope_course_id
    || courseId
  ),
}));

jest.mock('./studentExperienceV2', () => ({
  StudentWorkspaceHome: ({ studentData }) => <div>{studentData.marker}</div>,
  StudentReportContent: ({ studentData }) => <><h1>Student Report</h1><div>{studentData.marker}</div></>,
  CategoryDetailPage: ({ studentData }) => <div>{studentData.marker}</div>,
  ExamsOverviewPage: ({ studentData }) => <div>{studentData.marker}</div>,
  SingleExamPage: ({ studentData }) => <div>{studentData.marker}</div>,
  AssignmentLedger: ({ studentData }) => <div>{studentData.marker}</div>,
  ExplainScorePage: ({ studentData }) => <div>{studentData.marker}</div>,
  ConceptsPage: ({ studentData }) => <div>{studentData.marker}</div>,
  PolicyReference: () => <div>Policy Reference</div>,
  UnknownStudentExperienceRoute: () => <div>Unknown student page</div>,
}));

const COURSE_A = {
  id: '1',
  gradescope_course_id: 'demo-cs10',
  year: '2026',
  semester: 'Spring',
  name: 'Demo CS10',
};

const COURSE_B = {
  id: '2',
  gradescope_course_id: 'demo-cs61c',
  year: '2027',
  semester: 'Fall',
  name: 'Systems Course B',
};

const STUDENTS = [
  ['Aaron Old Identity', 'old@example.com', 'Lab 100'],
  ['Avery Chen', 'avery@example.com', 'Lab 101'],
];

function installMatchMedia(isMobile) {
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: isMobile && query === '(max-width:900px)',
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
}

function renderWithNavigation(
  initialEntry,
  setSelectedStudent,
  includeProfile = true,
  selectedStudent = 'old@example.com',
) {
  const router = createMemoryRouter([
    {
      path: '*',
      element: (
        <>
          <NavBar />
          {includeProfile && <StudentProfile />}
        </>
      ),
    },
  ], { initialEntries: [initialEntry] });

  return {
    router,
    ...render(
      <StudentSelectionContext.Provider value={{
        selectedStudent,
        setSelectedStudent,
      }}>
        <RouterProvider router={router} />
      </StudentSelectionContext.Provider>,
    ),
  };
}

describe('route-authoritative staff shell navigation', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('token', 'Bearer staff-token');
    localStorage.setItem('permissions', JSON.stringify({ has_course_admin: true }));
    localStorage.setItem('email', 'staff@example.com');
    localStorage.setItem('name', 'Course Staff');
    localStorage.setItem('selectedCourseId', COURSE_A.id);
    localStorage.setItem('selectedStudentEmail', 'old@example.com');
    installMatchMedia(false);

    cachedApiGet.mockImplementation((path) => {
      if (path.startsWith('/me/permissions')) {
        return Promise.resolve({ data: { permissions: { has_course_admin: true } } });
      }
      if (path === '/admin/sync' || path === '/students/courses') {
        return Promise.resolve({ data: { courses: [COURSE_A, COURSE_B] } });
      }
      if (path.startsWith('/students?course_id=')) {
        return Promise.resolve({ data: { students: STUDENTS } });
      }
      return Promise.reject(new Error(`Unexpected API path: ${path}`));
    });
    fetchStudentProfileData.mockImplementation(({ studentEmail, selectedCourse }) => Promise.resolve({
      name: studentEmail === 'avery@example.com' ? 'Avery Chen' : 'Old Identity',
      studentName: studentEmail === 'avery@example.com' ? 'Avery Chen' : 'Old Identity',
      marker: `Loaded ${studentEmail} for course ${selectedCourse}`,
    }));
    fetchStudentGradeFlow.mockResolvedValue({ nodes: [], edges: [] });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('keeps the URL student authoritative on direct refresh', async () => {
    const setSelectedStudent = jest.fn();
    renderWithNavigation(
      '/students/avery%40example.com/report?course_id=demo-cs61c',
      setSelectedStudent,
    );

    expect(screen.queryByText(/old@example.com/i)).not.toBeInTheDocument();
    expect(await screen.findByText('Loaded avery@example.com for course 2')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'STUDENT' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ADMIN' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Workspace' })).toHaveAttribute(
      'href',
      '/students/avery%40example.com/workspace?course_id=demo-cs61c',
    );
    expect(screen.getByRole('link', { name: 'Report' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Students' })).toHaveAttribute(
      'href',
      '/admin?tab=students',
    );
    expect(screen.queryByRole('link', { name: 'Class Health' })).not.toBeInTheDocument();

    const courseSelector = await screen.findByRole('combobox', { name: /Current course/ });
    expect(courseSelector).toHaveTextContent('2027 Fall Systems Course B');
    expect(localStorage.getItem('selectedCourseId')).toBe(COURSE_B.id);
    expect(setSelectedStudent).not.toHaveBeenCalledWith('old@example.com');
    expect(setSelectedStudent.mock.calls.every(([email]) => email === 'avery@example.com')).toBe(true);

    expect(fetchStudentProfileData.mock.calls.every(
      ([options]) => options.studentEmail === 'avery@example.com',
    )).toBe(true);
    expect(setSelectedStudent).not.toHaveBeenCalledWith('old@example.com');
  });

  test('keeps Student and Admin groups in the mobile menu without duplicate Settings', async () => {
    installMatchMedia(true);
    const user = userEvent.setup();
    const { router } = renderWithNavigation(
      '/students/avery%40example.com/report?course_id=demo-cs61c',
      jest.fn(),
      false,
    );

    await user.click(screen.getByRole('button', {
      name: 'Open navigation and account menu for Course Staff',
    }));
    expect(await screen.findByText('STUDENT')).toBeInTheDocument();
    expect(screen.getByText('ADMIN')).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem', { name: 'Settings' })).toHaveLength(1);
    expect(screen.getByRole('menuitem', { name: 'Workspace' })).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Students' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/admin');
      expect(router.state.location.search).toBe('?tab=students');
    });
  });

  test('uses the persisted selected student from a class page', async () => {
    renderWithNavigation('/admin', jest.fn(), false, 'old@example.com');

    expect(await screen.findByRole('heading', { name: 'STUDENT' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ADMIN' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Workspace' })).toHaveAttribute(
        'href',
        '/students/old%40example.com/workspace?course_id=demo-cs10',
      );
    });
  });

  test('keeps the support contact at the bottom of the desktop sidebar', async () => {
    renderWithNavigation('/admin', jest.fn(), false, 'old@example.com');

    const sidebar = await screen.findByRole('complementary', { name: /sidebar/i });
    const supportLink = screen.getByRole('link', { name: 'gradeview@lists.berkeley.edu' });

    expect(sidebar).toContainElement(supportLink);
    expect(supportLink).toHaveAttribute('href', 'mailto:gradeview@lists.berkeley.edu');
    expect(sidebar.querySelector('footer')).toBe(sidebar.querySelector('footer:last-child'));
  });

  test('updates selected-student links when the class course changes', async () => {
    renderWithNavigation('/admin', jest.fn(), false, 'old@example.com');

    const courseSelector = await screen.findByRole('combobox', { name: /Current course/ });
    await waitFor(() => expect(courseSelector).toHaveTextContent('2026 Spring Demo CS10'));
    const nativeCourseInput = courseSelector.parentElement.querySelector('input');
    fireEvent.change(nativeCourseInput, { target: { value: COURSE_B.id } });

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /Current course/ })).toHaveTextContent(
        '2027 Fall Systems Course B',
      );
      expect(screen.getByRole('link', { name: 'Workspace' })).toHaveAttribute(
        'href',
        '/students/old%40example.com/workspace?course_id=demo-cs61c',
      );
    });
    expect(localStorage.getItem('selectedCourseId')).toBe(COURSE_B.id);
  });

  test('explains how to select a student when no review target exists', async () => {
    localStorage.removeItem('selectedStudentEmail');
    cachedApiGet.mockImplementation((path) => {
      if (path.startsWith('/me/permissions')) {
        return Promise.resolve({ data: { permissions: { has_course_admin: true } } });
      }
      if (path === '/admin/sync' || path === '/students/courses') {
        return Promise.resolve({ data: { courses: [COURSE_A] } });
      }
      if (path.startsWith('/students?course_id=')) {
        return Promise.resolve({ data: { students: [] } });
      }
      return Promise.reject(new Error(`Unexpected API path: ${path}`));
    });

    renderWithNavigation('/admin', jest.fn(), false, '');

    expect(await screen.findByText(/Select a student in Students/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Select student' })).toHaveAttribute(
      'href',
      '/admin?tab=students',
    );
    expect(screen.queryByRole('link', { name: 'Workspace' })).not.toBeInTheDocument();
  });

  test('keeps ordinary students on Student navigation only', async () => {
    localStorage.setItem('permissions', JSON.stringify({ has_student: true }));
    cachedApiGet.mockImplementation((path) => {
      if (path.startsWith('/me/permissions')) {
        return Promise.resolve({ data: { permissions: { has_student: true } } });
      }
      if (path === '/students/courses') {
        return Promise.resolve({ data: { courses: [COURSE_A] } });
      }
      return Promise.reject(new Error(`Unexpected API path: ${path}`));
    });

    renderWithNavigation('/profile', jest.fn(), false, '');

    expect(await screen.findByRole('heading', { name: 'STUDENT' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Workspace' })).toHaveAttribute('href', '/profile');
    expect(screen.queryByRole('heading', { name: 'ADMIN' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Students' })).not.toBeInTheDocument();
  });

  test('shows one low-interruption Demo status chip without a sidebar notice', async () => {
    localStorage.setItem('shellUiCapabilities', JSON.stringify({ demo: true, read_only: true }));

    renderWithNavigation('/admin', jest.fn(), false);

    expect(await screen.findByLabelText(/Demo mode, read-only interface/i)).toHaveTextContent(
      'Demo · Read-only',
    );
    expect(screen.queryByText(/View-only experience/i)).not.toBeInTheDocument();
  });

  test('clears shell state and uses router navigation on logout', async () => {
    const user = userEvent.setup();
    const { router } = renderWithNavigation('/admin', jest.fn(), false);

    await user.click(screen.getByRole('button', { name: 'Open account menu for Course Staff' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Logout' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('permissions')).toBeNull();
    expect(localStorage.getItem('selectedCourseId')).toBeNull();
    expect(localStorage.getItem('selectedStudentEmail')).toBeNull();
  });
});
