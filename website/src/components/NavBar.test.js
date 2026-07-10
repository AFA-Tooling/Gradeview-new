import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
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

function renderWithNavigation(initialEntry, setSelectedStudent, includeProfile = true) {
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
        selectedStudent: 'old@example.com',
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

  test('keeps the URL student authoritative on direct load and course changes', async () => {
    const setSelectedStudent = jest.fn();
    const { router } = renderWithNavigation(
      '/students/avery%40example.com/report?course_id=demo-cs61c',
      setSelectedStudent,
    );

    expect(screen.queryByText(/old@example.com/i)).not.toBeInTheDocument();
    expect(await screen.findByText('Loaded avery@example.com for course 2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Return to Class Health' })).toHaveAttribute(
      'href',
      '/admin?tab=students',
    );

    const courseSelector = await screen.findByRole('combobox', { name: /Current course/ });
    expect(courseSelector).toHaveTextContent('2027 Fall Systems Course B');
    expect(localStorage.getItem('selectedCourseId')).toBe(COURSE_B.id);
    expect(setSelectedStudent).not.toHaveBeenCalledWith('old@example.com');
    expect(setSelectedStudent.mock.calls.every(([email]) => email === 'avery@example.com')).toBe(true);

    act(() => {
      window.dispatchEvent(new CustomEvent('selectedCourseChanged', {
        detail: { courseId: COURSE_A.id },
      }));
    });

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/students/avery%40example.com/report');
      expect(new URLSearchParams(router.state.location.search).get('course_id')).toBe('demo-cs10');
    });
    expect(await screen.findByText('Loaded avery@example.com for course 1')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Current course/ })).toHaveTextContent(
      '2026 Spring Demo CS10',
    );
    expect(fetchStudentProfileData.mock.calls.every(
      ([options]) => options.studentEmail === 'avery@example.com',
    )).toBe(true);
    expect(setSelectedStudent).not.toHaveBeenCalledWith('old@example.com');
  });

  test('returns from the mobile account menu to the Students tab', async () => {
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
    await user.click(await screen.findByRole('menuitem', { name: 'Return to Class Health' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/admin');
      expect(router.state.location.search).toBe('?tab=students');
    });
  });
});
