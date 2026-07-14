import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import StudentSelectionWrapper from '../components/StudentSelectionWrapper';
import StudentProfile from './studentProfile';
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

jest.mock('../components/studentExperienceV2', () => ({
  StudentWorkspaceHome: ({ studentData, compactHeader }) => <><h1>Student Workspace</h1><div data-testid="compact-header">{compactHeader ? 'compact' : 'full'}</div><div>{studentData.marker}</div></>,
  StudentReportContent: ({ studentData, staffMode, compactHeader }) => (
    <>
      <h1>Student Report</h1>
      <div data-testid="report-mode">{staffMode ? 'staff' : 'self'}</div>
      <div data-testid="compact-header">{compactHeader ? 'compact' : 'full'}</div>
      <div>{studentData.marker}</div>
    </>
  ),
  CategoryDetailPage: ({ studentData, pageKey, compactHeader }) => <><h1>{pageKey} page</h1><div data-testid="compact-header">{compactHeader ? 'compact' : 'full'}</div><div>{studentData.marker}</div></>,
  ExamsOverviewPage: ({ studentData, compactHeader }) => <><h1>Exams</h1><div data-testid="compact-header">{compactHeader ? 'compact' : 'full'}</div><div>{studentData.marker}</div></>,
  SingleExamPage: ({ studentData, examKey, compactHeader }) => <><h1>{examKey}</h1><div data-testid="compact-header">{compactHeader ? 'compact' : 'full'}</div><div>{studentData.marker}</div></>,
  AssignmentLedger: ({ studentData, compactHeader }) => <><h1>Assignment Ledger</h1><div data-testid="compact-header">{compactHeader ? 'compact' : 'full'}</div><div>{studentData.marker}</div></>,
  ExplainScorePage: ({ studentData, compactHeader }) => <><h1>Explain Score</h1><div data-testid="compact-header">{compactHeader ? 'compact' : 'full'}</div><div>{studentData.marker}</div></>,
  ConceptsPage: ({ studentData, compactHeader }) => <><h1>Concepts</h1><div data-testid="compact-header">{compactHeader ? 'compact' : 'full'}</div><div>{studentData.marker}</div></>,
  PolicyReference: ({ compactHeader }) => <><h1>Policy Reference</h1><div data-testid="compact-header">{compactHeader ? 'compact' : 'full'}</div></>,
  UnknownStudentExperienceRoute: () => <h1>Unknown student page</h1>,
}));

const COURSE = {
  id: '1',
  gradescope_course_id: 'demo-cs10',
  year: '2026',
  semester: 'Spring',
  name: 'Demo CS10',
};

const STUDENTS = [
  ['Avery Chen', 'avery@example.com', 'Lab 101'],
  ['Jordan Singh', 'jordan@example.com', 'Lab 102'],
];

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function renderProfile(initialEntry) {
  const router = createMemoryRouter([
    { path: '/profile/*', element: <StudentProfile /> },
    { path: '/students/:studentId/*', element: <StudentProfile /> },
  ], { initialEntries: [initialEntry] });

  const view = render(
    <StudentSelectionWrapper>
      <RouterProvider router={router} />
    </StudentSelectionWrapper>,
  );

  return { router, ...view };
}

function defaultProfileFor({ studentEmail, studentName }) {
  return Promise.resolve({
    name: studentName,
    studentName,
    marker: `Loaded ${studentEmail}`,
  });
}

describe('route-driven student profile', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('selectedCourseId', '1');
    cachedApiGet.mockImplementation((path) => {
      if (path === '/admin/sync' || path === '/students/courses') {
        return Promise.resolve({ data: { courses: [COURSE] } });
      }
      if (path.startsWith('/students?course_id=')) {
        return Promise.resolve({ data: { students: STUDENTS } });
      }
      return Promise.reject(new Error(`Unexpected API path: ${path}`));
    });
    fetchStudentProfileData.mockImplementation(defaultProfileFor);
    fetchStudentGradeFlow.mockResolvedValue({ nodes: [], edges: [] });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('restores staff student, course, and subpage from a direct deep link', async () => {
    const { router } = renderProfile(
      '/students/avery%40example.com/labs?course_id=demo-cs10',
    );

    expect(await screen.findByRole('heading', { name: 'labs page' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.queryByText('Staff student review')).not.toBeInTheDocument();
    expect(screen.getByTestId('compact-header')).toHaveTextContent('compact');
    expect(screen.queryByRole('link', { name: /Back to Class Health/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Search students by name or email')).toBeInTheDocument();
    expect(fetchStudentProfileData).toHaveBeenCalledWith(expect.objectContaining({
      studentEmail: 'avery@example.com',
      selectedCourse: '1',
    }));
    expect(router.state.location.pathname).toBe('/students/avery%40example.com/labs');
    expect(router.state.location.search).toBe('?course_id=demo-cs10');
  });

  test('keeps the self route in student persona without staff controls', async () => {
    localStorage.setItem('email', 'self@example.com');
    localStorage.setItem('name', 'Self Student');
    renderProfile('/profile/report');

    expect(await screen.findByRole('heading', { name: 'Student Report' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByTestId('report-mode')).toHaveTextContent('self');
    expect(screen.getByTestId('compact-header')).toHaveTextContent('full');
    expect(screen.queryByText('Staff student review')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Search students by name or email')).not.toBeInTheDocument();
    expect(fetchStudentProfileData).toHaveBeenCalledWith(expect.objectContaining({
      studentEmail: 'self@example.com',
    }));
  });

  test('selector pushes history and back/forward restore the student', async () => {
    const user = userEvent.setup();
    const { router } = renderProfile(
      '/students/avery%40example.com/report?course_id=demo-cs10',
    );
    const selector = await screen.findByLabelText('Search students by name or email');
    await screen.findByText('Loaded avery@example.com');

    await user.click(selector);
    await user.clear(selector);
    await user.type(selector, 'Jordan');
    await user.click(await screen.findByText('Jordan Singh'));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/students/jordan%40example.com/report');
    });
    expect(router.state.location.search).toBe('?course_id=demo-cs10');
    expect(await screen.findByText('Loaded jordan@example.com')).toBeInTheDocument();

    await act(async () => { await router.navigate(-1); });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/students/avery%40example.com/report');
    });
    expect(await screen.findByText('Loaded avery@example.com')).toBeInTheDocument();

    await act(async () => { await router.navigate(1); });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/students/jordan%40example.com/report');
    });
  });

  test('invalid identifiers render an explicit error and do not fetch a profile', async () => {
    renderProfile('/students/not-an-email/report?course_id=demo-cs10');

    expect(await screen.findByRole('heading', { name: 'Invalid student link' })).toBeInTheDocument();
    expect(fetchStudentProfileData).not.toHaveBeenCalled();
  });

  test('aborts an old request and ignores its late response', async () => {
    const averyRequest = deferred();
    const jordanRequest = deferred();
    fetchStudentProfileData.mockImplementation(({ studentEmail }) => (
      studentEmail === 'avery@example.com' ? averyRequest.promise : jordanRequest.promise
    ));
    const { router } = renderProfile(
      '/students/avery%40example.com/report?course_id=demo-cs10',
    );

    await waitFor(() => expect(fetchStudentProfileData).toHaveBeenCalledTimes(1));
    const averySignal = fetchStudentProfileData.mock.calls[0][0].signal;

    await act(async () => {
      await router.navigate('/students/jordan%40example.com/report?course_id=demo-cs10');
    });
    await waitFor(() => expect(fetchStudentProfileData).toHaveBeenCalledTimes(2));
    expect(averySignal.aborted).toBe(true);

    await act(async () => {
      averyRequest.resolve({ name: 'Avery Chen', marker: 'Late Avery response' });
      await Promise.resolve();
    });
    expect(screen.queryByText('Late Avery response')).not.toBeInTheDocument();

    await act(async () => {
      jordanRequest.resolve({ name: 'Jordan Singh', marker: 'Current Jordan response' });
    });
    expect(await screen.findByText('Current Jordan response')).toBeInTheDocument();
  });

  test('switching students immediately hides old content and identity while loading', async () => {
    const jordanRequest = deferred();
    fetchStudentProfileData.mockImplementation(({ studentEmail, studentName }) => (
      studentEmail === 'jordan@example.com'
        ? jordanRequest.promise
        : Promise.resolve({ name: studentName, studentName, marker: 'Avery loaded content' })
    ));
    const { router } = renderProfile(
      '/students/avery%40example.com/report?course_id=demo-cs10',
    );
    expect(await screen.findByText('Avery loaded content')).toBeInTheDocument();
    expect(screen.getByText('Avery Chen')).toBeInTheDocument();

    await act(async () => {
      await router.navigate('/students/jordan%40example.com/report?course_id=demo-cs10');
    });

    expect(await screen.findByTestId('student-identity-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('Avery loaded content')).not.toBeInTheDocument();
    expect(screen.queryByText('Avery Chen')).not.toBeInTheDocument();

    await act(async () => {
      jordanRequest.resolve({ name: 'Jordan Singh', studentName: 'Jordan Singh', marker: 'Jordan loaded content' });
    });
    expect(await screen.findByText('Jordan loaded content')).toBeInTheDocument();
  });

  test('policy is presented as course context without a student selector or identity', async () => {
    renderProfile('/students/avery%40example.com/policy?course_id=demo-cs10');

    expect(await screen.findByRole('heading', { name: 'Policy Reference' })).toBeInTheDocument();
    expect(screen.getByText('Course policy')).toBeInTheDocument();
    expect(screen.queryByLabelText('Search students by name or email')).not.toBeInTheDocument();
    expect(screen.queryByText('avery@example.com')).not.toBeInTheDocument();
  });

  test('empty data has an explicit state and is not rendered as a zero score', async () => {
    fetchStudentProfileData.mockResolvedValue(null);
    renderProfile('/students/avery%40example.com/report?course_id=demo-cs10');

    expect(await screen.findByRole('heading', { name: 'No student data available' })).toBeInTheDocument();
    expect(screen.getByText(/not being treated as a zero score/i)).toBeInTheDocument();
  });
});
