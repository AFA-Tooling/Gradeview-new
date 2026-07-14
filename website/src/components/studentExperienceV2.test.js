import React from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import {
  AssignmentLedger,
  CategoryDetailPage,
  ExplainScorePage,
  ExamsOverviewPage,
  SingleExamPage,
  StudentReportContent,
  StudentWorkspaceHome,
} from './studentExperienceV2';
import {
  CATEGORY_DEFINITIONS,
  EVIDENCE_STATUSES,
  formatEvidenceScore,
  getEvidenceStatusMeta,
} from './studentExperienceModel';

jest.mock('react-chartjs-2', () => ({
  Radar: ({ data, options }) => (
    <div data-testid="radar-chart">
      {data.labels.join(', ')}
      <output>{JSON.stringify(data.datasets.map((dataset) => dataset.data))}</output>
      <output data-testid="radar-tooltip">
        {data.labels.map((_label, index) => {
          const dataset = data.datasets[0] || {};
          const result = options?.plugins?.tooltip?.callbacks?.label?.({
            dataIndex: index,
            parsed: { r: dataset.data?.[index] },
            dataset,
          });
          return Array.isArray(result) ? result.join(' ') : result;
        }).filter(Boolean).join(' | ')}
      </output>
    </div>
  ),
  Line: ({ data }) => <div data-testid="line-chart">{data.labels.join(', ')}</div>,
  Doughnut: ({ data, options }) => (
    <div data-testid="doughnut-chart">
      {data.labels.join(', ')}
      <output data-testid="doughnut-tooltip">
        {data.labels.map((_label, index) => {
          const result = options?.plugins?.tooltip?.callbacks?.label?.({ dataIndex: index });
          return Array.isArray(result) ? result.join(' ') : result;
        }).filter(Boolean).join(' | ')}
      </output>
    </div>
  ),
}));

jest.mock('./GradeDataFlow', () => () => <div>Grade flow</div>);
jest.mock('../views/conceptMap', () => () => <div>Concept map</div>);

const category = (key, label, exactScore, cap) => ({
  basis: 'policy_final',
  key,
  label,
  type: ['quest', 'midterm', 'postterm'].includes(key) ? 'exam' : key,
  exactScore,
  cap,
  percentage: (exactScore / cap) * 100,
  status: 'available',
  source: `${key}_effective`,
});

const evidence = (assignmentId, categoryName, name, evidenceStatus, overrides = {}) => ({
  basis: 'assignment_evidence',
  assignmentId,
  category: categoryName,
  rawCategory: categoryName,
  name,
  evidenceStatus,
  score: ['submitted', 'earned_zero'].includes(evidenceStatus) ? (evidenceStatus === 'earned_zero' ? 0 : 8) : null,
  recordedScore: ['submitted', 'earned_zero'].includes(evidenceStatus) ? (evidenceStatus === 'earned_zero' ? 0 : 8) : null,
  maxPoints: 10,
  percentage: evidenceStatus === 'submitted' ? 80 : (evidenceStatus === 'earned_zero' ? 0 : null),
  dueAt: '2026-07-10T00:00:00.000Z',
  submissionTime: evidenceStatus === 'submitted' ? '2026-07-09T23:00:00.000Z' : null,
  sourceSyncStatus: 'synced',
  requestError: null,
  ...overrides,
});

const studentData = {
  studentName: 'Avery Example',
  totalScore: 1,
  totalCapPoints: 150,
  categoriesData: { Labs: { total: 0, capPoints: 80 } },
  canonicalGrade: {
    basis: 'policy_final',
    status: 'available',
    exactScore: 321.37,
    displayScore: 321.4,
    cap: 400,
    percentage: 80.3425,
    letter: 'B-',
    bin: { grade: 'B-', range: '320-329', minScore: 320, maxScore: 329 },
    source: 'course_policy_summary',
    categories: {
      attendance: category('attendance', 'Attendance / Participation', 14, 15),
      labs: category('labs', 'Labs', 53.3, 80),
      projects: category('projects', 'Projects', 153.57, 155),
      quest: category('quest', 'Quest', 24.5, 25),
      midterm: category('midterm', 'Midterm', 39, 50),
      postterm: category('postterm', 'Postterm', 37, 75),
    },
    subtotals: { exams: { basis: 'policy_final', exactScore: 100.5, cap: 150 } },
  },
  gradeBins: [
    { grade: 'C+', range: '310-319', minScore: 310, maxScore: 319 },
    { grade: 'B-', range: '320-329', minScore: 320, maxScore: 329 },
    { grade: 'B', range: '330-339', minScore: 330, maxScore: 339 },
    { grade: 'B+', range: '340-349', minScore: 340, maxScore: 349 },
    { grade: 'A-', range: '350-369', minScore: 350, maxScore: 369 },
    { grade: 'A', range: '370-400', minScore: 370, maxScore: 400 },
  ],
  assignmentEvidence: [
    evidence('attendance-1', 'Attendance / Participation', 'Lecture 1', 'submitted'),
    evidence('lab-missing', 'Labs', 'Lab Missing', 'missing'),
    evidence('lab-duplicate-a', 'Labs', 'Duplicate Lab', 'due_unknown', { dueAt: null }),
    evidence('lab-duplicate-b', 'Labs', 'Duplicate Lab', 'earned_zero'),
    evidence('project-zero', 'Projects', 'Project Zero', 'earned_zero', { lateness: '01:00:00' }),
    evidence('quest-future', 'Quest', 'Quest Future', 'not_due'),
    evidence('midterm-unsynced', 'Midterm', 'Midterm Sync', 'not_synced'),
    evidence('postterm-na', 'Postterm', 'Postterm Optional', 'not_applicable'),
  ],
  examPolicyRows: [
    { examType: 'quest', attemptNo: 1, assignmentId: 'quest-1', assignmentTitle: 'Quest 1', rawPercentage: 70, questionBestPercentage: 75, finalPercentage: 75 },
    { examType: 'quest', attemptNo: 2, assignmentId: 'quest-2', assignmentTitle: 'Quest 2', rawPercentage: 80, questionBestPercentage: 82, clobberedPercentage: 90, finalPercentage: 90, clobberSourceTitle: 'Postterm' },
    { examType: 'quest', attemptNo: 3, assignmentId: 'quest-3', assignmentTitle: 'Quest 3', rawPercentage: 88, questionBestPercentage: 89, finalPercentage: 89 },
    { examType: 'midterm', attemptNo: 1, assignmentId: 'midterm-1', assignmentTitle: 'Midterm', rawPercentage: 78, questionBestPercentage: 78, finalPercentage: 78 },
    { examType: 'postterm', attemptNo: 1, assignmentId: 'postterm-1', assignmentTitle: 'Postterm', rawPercentage: 88, questionBestPercentage: 89, finalPercentage: 89 },
  ],
  examComponentTrends: {
    quest: { components: ['Pointers', 'Trees', 'Unscored'], series: [{ name: 'Attempt 1', data: [70, 80, null] }, { name: 'Attempt 2', data: [90, 85, null] }] },
    midterm: { components: ['Memory'], series: [{ name: 'Attempt 1', data: [78] }] },
    postterm: { components: ['Systems'], series: [{ name: 'Attempt 1', data: [89] }] },
  },
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</output>;
}

function renderRoutes(routes, initialEntry) {
  const router = createMemoryRouter(routes.map((route) => ({
    ...route,
    element: <>{route.element}<LocationProbe /></>,
  })), { initialEntries: [initialEntry] });
  return { router, ...render(<RouterProvider router={router} />) };
}

describe('student experience canonical contract surfaces', () => {
  test.each(CATEGORY_DEFINITIONS.flatMap((definition) => (
    EVIDENCE_STATUSES.map((status) => [definition.key, status, definition])
  )))('%s category page renders authoritative %s evidence without score coercion', (_key, status, definition) => {
    const row = evidence(`${definition.key}-${status}`, definition.label, `${definition.shortLabel} ${status}`, status, {
      dueAt: status === 'due_unknown' ? null : '2026-07-10T00:00:00.000Z',
      requestError: status === 'request_error' ? 'source timeout' : null,
    });
    const query = definition.key === 'labs' ? `?tab=list&status=${status}` : `?status=${status}`;
    renderRoutes([{
      path: `/profile/${definition.key}`,
      element: <CategoryDetailPage studentData={{ ...studentData, assignmentEvidence: [row] }} pageKey={definition.key} />,
    }], `/profile/${definition.key}${query}`);

    expect(screen.getByText(row.name)).toBeInTheDocument();
    expect(screen.getAllByText(getEvidenceStatusMeta(status, row).label).length).toBeGreaterThan(0);
    if (!['submitted', 'earned_zero'].includes(status)) {
      expect(screen.getAllByText(formatEvidenceScore(row)).length).toBeGreaterThan(0);
    }
  });

  test('category evidence keeps a full-width readable table instead of sharing a compressed row', () => {
    renderRoutes([{
      path: '/profile/attendance',
      element: <CategoryDetailPage studentData={studentData} pageKey="attendance" />,
    }], '/profile/attendance');

    const evidenceRegion = screen.getByTestId('category-evidence-region');
    const table = within(evidenceRegion).getByRole('table');

    expect(evidenceRegion).toHaveClass('MuiGrid-grid-xs-12');
    expect(evidenceRegion).not.toHaveClass('MuiGrid-grid-md-8');
    expect(table).toHaveStyle({ minWidth: '1040px' });
    expect(screen.getByRole('heading', { name: 'Policy Applied' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Action' })).toBeInTheDocument();
  });

  test('Workspace concrete action opens a URL-filtered Ledger and browser back restores Workspace', async () => {
    const user = userEvent.setup();
    const { router } = renderRoutes([
      { path: '/profile', element: <StudentWorkspaceHome studentData={studentData} /> },
      { path: '/profile/assignments', element: <AssignmentLedger studentData={studentData} /> },
    ], '/profile');

    expect(screen.getByText('321.37 / 400')).toBeInTheDocument();
    expect(screen.getByText('368 / 400')).toBeInTheDocument();
    expect(screen.getByText('18 pts')).toBeInTheDocument();
    expect(screen.getByText(/32 pts lost from 40 currently due points/)).toBeInTheDocument();
    expect(screen.getByText(/Highest possible finish if all remaining work earns full credit · A-/)).toBeInTheDocument();
    expect(screen.getByText(/below 350 moves to B\+/)).toBeInTheDocument();
    expect(screen.queryByText('321.4 / 400')).not.toBeInTheDocument();
    expect(screen.queryByText('1 / 150')).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: /Resolve Lab Missing/i }));

    expect(screen.getByRole('heading', { name: 'Assignment Ledger' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Lab Missing')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('category=Labs');
    expect(screen.getByTestId('location')).toHaveTextContent('status=missing');
    expect(screen.getByText('lab-missing')).toBeInTheDocument();

    await act(async () => router.navigate(-1));
    expect(await screen.findByRole('heading', { name: 'Student Workspace' })).toBeInTheDocument();
    expect(screen.queryByText(/Partial data ·/)).not.toBeInTheDocument();
  });

  test('staff-view Workspace actions keep the reviewed student and course context', async () => {
    const user = userEvent.setup();
    renderRoutes([
      { path: '/students/:studentId/workspace', element: <StudentWorkspaceHome studentData={studentData} /> },
      { path: '/students/:studentId/assignments', element: <AssignmentLedger studentData={studentData} /> },
    ], '/students/avery%40example.com/workspace?course_id=demo-cs10');

    expect(screen.queryAllByRole('link').some((link) => link.getAttribute('href')?.startsWith('/profile'))).toBe(false);
    await user.click(screen.getByRole('link', { name: /Resolve Lab Missing/i }));

    expect(screen.getByRole('heading', { name: 'Assignment Ledger' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/students/avery%40example.com/assignments');
    expect(screen.getByTestId('location')).toHaveTextContent('course_id=demo-cs10');
    expect(screen.getByTestId('location')).toHaveTextContent('category=Labs');
    expect(screen.getByTestId('location')).toHaveTextContent('status=missing');
  });

  test('staff report removes the redundant page heading while keeping report actions', () => {
    render(<StudentReportContent studentData={studentData} staffMode />);

    expect(screen.queryByRole('heading', { name: 'Student Report' })).not.toBeInTheDocument();
    expect(screen.queryByText('One-page staff review of the canonical policy-final standing and assignment evidence.')).not.toBeInTheDocument();
    const progressCards = screen.getByTestId('progress-analysis-cards');
    expect(within(progressCards).getByText('Overall score')).toBeInTheDocument();
    expect(within(progressCards).getByText('Happy score')).toBeInTheDocument();
    expect(within(progressCards).getByText('Grade safety margin')).toBeInTheDocument();
    expect(within(progressCards).getByText('321.37 / 400')).toBeInTheDocument();
    expect(within(progressCards).getByText('368 / 400')).toBeInTheDocument();
    expect(within(progressCards).getByText('18 pts')).toBeInTheDocument();
    expect(screen.queryByText('Final Policy Snapshot')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy summary' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark reviewed' })).toBeInTheDocument();
  });

  test('compact staff category pages hide the contextual heading but retain actions', () => {
    renderRoutes([{
      path: '/students/:studentId/projects',
      element: <CategoryDetailPage studentData={studentData} pageKey="projects" compactHeader />,
    }], '/students/avery%40example.com/projects?course_id=demo-cs10');

    expect(screen.queryByRole('heading', { name: 'Projects' })).not.toBeInTheDocument();
    expect(screen.queryByText('Summary, evidence, policy applied, impact, and action for this grading area.')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open catalog rows' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Projects Evidence' })).toBeInTheDocument();
  });

  test('Report, category page, and exam title repeat canonical values without legacy fallbacks', () => {
    const report = renderRoutes([{ path: '/profile/report', element: <StudentReportContent studentData={studentData} /> }], '/profile/report');
    expect(screen.getAllByText(/321\.37 \/ 400/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('53.3').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Partial data ·/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Overall Summary' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Category Performance Radar' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Score Trend' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Detailed Assignment Scores' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Assignment ID' })).toBeInTheDocument();
    expect(screen.getByTestId('detailed-assignment-table')).toHaveStyle({
      minWidth: '1120px',
      tableLayout: 'fixed',
    });
    expect(screen.getByText('lab-duplicate-a')).toBeInTheDocument();
    expect(screen.getByText('lab-duplicate-b')).toBeInTheDocument();
    expect(screen.getByText('quest-future')).toBeInTheDocument();
    expect(screen.getAllByText('3 attempts').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1 attempt').length).toBeGreaterThanOrEqual(2);
    report.unmount();

    const labs = renderRoutes([{ path: '/profile/labs', element: <CategoryDetailPage studentData={studentData} pageKey="labs" /> }], '/profile/labs?tab=overview');
    expect(screen.getByText('53.3 / 80')).toBeInTheDocument();
    labs.unmount();

    renderRoutes([{ path: '/profile/exams/quest', element: <SingleExamPage studentData={studentData} examKey="quest" /> }], '/profile/exams/quest?mode=raw');
    expect(screen.getByRole('heading', { name: 'Quest 24.5 / 25' })).toBeInTheDocument();
  });

  test('restored report keeps canonical decimal precision in the snapshot, chart tooltips, and tables', () => {
    const precisionStudent = {
      ...studentData,
      totalScore: 999,
      totalCapPoints: 141,
      canonicalGrade: {
        ...studentData.canonicalGrade,
        exactScore: 317.13,
        displayScore: 317,
        percentage: 79.2825,
        categories: {
          ...studentData.canonicalGrade.categories,
          labs: {
            ...studentData.canonicalGrade.categories.labs,
            exactScore: 26.67,
            cap: 80,
            percentage: 33.3375,
          },
        },
      },
    };

    renderRoutes([{ path: '/profile/report', element: <StudentReportContent studentData={precisionStudent} /> }], '/profile/report');

    expect(screen.getAllByText(/317\.13 \/ 400/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/317 \/ 400/)).not.toBeInTheDocument();
    expect(screen.queryByText(/999 \/ 141/)).not.toBeInTheDocument();
    expect(screen.getAllByText('26.67').length).toBeGreaterThan(0);
    expect(screen.getByTestId('doughnut-tooltip')).toHaveTextContent('Earned : 26.67 / 80');
    expect(screen.getAllByTestId('radar-tooltip').some((tooltip) => tooltip.textContent.includes('(26.67/80)'))).toBe(true);
    expect(screen.queryByText(/27 \/ 80/)).not.toBeInTheDocument();
  });

  test('unavailable canonical category zero stays unavailable while nonzero evidence remains visible', () => {
    const unavailableStudent = {
      ...studentData,
      canonicalGrade: {
        ...studentData.canonicalGrade,
        categories: {
          ...studentData.canonicalGrade.categories,
          labs: {
            ...studentData.canonicalGrade.categories.labs,
            exactScore: 0,
            cap: 80,
            percentage: 0,
            status: 'unavailable',
            source: 'labs_policy_unavailable',
          },
        },
      },
      assignmentEvidence: [
        ...studentData.assignmentEvidence,
        evidence('lab-real-evidence', 'Labs', 'Lab with real evidence', 'submitted', { score: 8, recordedScore: 8, maxPoints: 10, percentage: 80 }),
      ],
    };

    const partialMessage = 'Partial data · Labs unavailable; total/letter may be incomplete';
    const report = renderRoutes([{ path: '/profile/report', element: <StudentReportContent studentData={unavailableStudent} /> }], '/profile/report');

    expect(screen.queryByText('0 / 80')).not.toBeInTheDocument();
    expect(screen.queryByText('0.0% final policy')).not.toBeInTheDocument();
    expect(screen.getByText('lab-real-evidence')).toBeInTheDocument();
    expect(screen.getAllByText('8 / 10').length).toBeGreaterThan(0);
    expect(screen.getByTestId('doughnut-tooltip')).toHaveTextContent('Earned : Unavailable / 80');
    expect(screen.getByText(partialMessage)).toBeInTheDocument();
    const performancePanel = screen.getByRole('heading', { name: 'Performance by Category' }).closest('.MuiPaper-root');
    expect(within(performancePanel).getByRole('row', { name: /Labs Unavailable 80 Unavailable Unavailable/i })).toBeInTheDocument();
    report.unmount();

    const workspace = renderRoutes([{ path: '/profile', element: <StudentWorkspaceHome studentData={unavailableStudent} /> }], '/profile');
    expect(screen.getByText(partialMessage)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Labs final policy progress' })).toHaveAttribute('aria-valuenow', '0');
    workspace.unmount();

    renderRoutes([{ path: '/profile/explain', element: <ExplainScorePage studentData={unavailableStudent} /> }], '/profile/explain');
    expect(screen.getByText(partialMessage)).toBeInTheDocument();
  });

  test('Labs URL restores a distinct Policy tab and preserves unrelated query state', async () => {
    const user = userEvent.setup();
    renderRoutes([{ path: '/profile/labs', element: <CategoryDetailPage studentData={studentData} pageKey="labs" /> }], '/profile/labs?tab=policy&status=missing&keep=1#evidence');
    expect(screen.getByText('Labs · Policy')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Assignment' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Lab List' }));
    expect(screen.getByText('Labs · List')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('keep=1');
    expect(screen.getByTestId('location')).toHaveTextContent('#evidence');
    expect(screen.getByText('Lab Missing')).toBeInTheDocument();
  });

  test.each([
    ['raw', 'Quest Raw Attempts', 'Question Best Matrix', 'Quest Clobber Outcome'],
    ['question_best', 'Question Best Matrix', 'Quest Raw Attempts', 'Quest Clobber Outcome'],
    ['clobber', 'Quest Clobber Outcome', 'Quest Raw Attempts', 'Question Best Matrix'],
  ])('Exam %s mode renders only its relevant evidence structure', (mode, visible, hiddenA, hiddenB) => {
    renderRoutes([{ path: '/profile/exams', element: <ExamsOverviewPage studentData={studentData} /> }], `/profile/exams?mode=${mode}`);
    expect(screen.getByText(visible)).toBeInTheDocument();
    expect(screen.queryByText(hiddenA)).not.toBeInTheDocument();
    expect(screen.queryByText(hiddenB)).not.toBeInTheDocument();
  });

  test('Exam selection is URL-restorable, invalid values fall back safely, and back restores selection', async () => {
    const user = userEvent.setup();
    const { router } = renderRoutes([{ path: '/profile/exams', element: <ExamsOverviewPage studentData={studentData} /> }], '/profile/exams?mode=raw&exam=midterm&keep=1');
    expect(screen.getByText('Midterm Raw Attempts')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Quest.*3 attempts/i }));
    expect(screen.getByText('Quest Raw Attempts')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('exam=quest');
    expect(screen.getByTestId('location')).toHaveTextContent('keep=1');
    await act(async () => router.navigate(-1));
    expect(screen.getByText('Midterm Raw Attempts')).toBeInTheDocument();
    await act(async () => router.navigate('/profile/exams?mode=raw&exam=bogus'));
    expect(screen.getByText('Quest Raw Attempts')).toBeInTheDocument();
  });

  test('Question-best component null remains unavailable instead of becoming a zero', () => {
    renderRoutes([{ path: '/profile/exams', element: <ExamsOverviewPage studentData={studentData} /> }], '/profile/exams?mode=question_best&exam=quest');
    expect(screen.getByText('Unscored')).toBeInTheDocument();
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument();
    expect(screen.getByTestId('radar-chart')).toHaveTextContent('[70,80,null]');
  });

  test('single-attempt clobber mode collapses the ladder and uses correct grammar', () => {
    renderRoutes([{ path: '/profile/exams/midterm', element: <SingleExamPage studentData={studentData} examKey="midterm" /> }], '/profile/exams/midterm?mode=clobber');
    expect(screen.getAllByText(/1 attempt/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/1 attempts/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Net gain/)).not.toBeInTheDocument();
  });

  test('Ledger restores URL filters, keeps duplicate IDs in one table, and exports explicit CSV scopes', async () => {
    const user = userEvent.setup();
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn(() => 'blob:ledger');
    URL.revokeObjectURL = jest.fn();

    const view = renderRoutes([{ path: '/profile/assignments', element: <AssignmentLedger studentData={studentData} /> }], '/profile/assignments?category=Labs&group=none');
    expect(screen.getByText('Showing 3 of 8 catalog rows')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader', { name: 'Assignment ID' })).toHaveLength(1);
    expect(screen.getByText('lab-duplicate-a')).toBeInTheDocument();
    expect(screen.getByText('lab-duplicate-b')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Export current filtered CSV/i }));
    await user.click(screen.getByRole('button', { name: /Export all catalog CSV/i }));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(clickSpy).toHaveBeenCalledTimes(2);

    view.unmount();
    clickSpy.mockRestore();
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  test('Ledger distinguishes empty catalog from an empty filtered result', () => {
    const filtered = renderRoutes([{ path: '/profile/assignments', element: <AssignmentLedger studentData={studentData} /> }], '/profile/assignments?status=request_error');
    expect(screen.getByText(/0 of 8 catalog rows match/)).toBeInTheDocument();
    filtered.unmount();

    renderRoutes([{ path: '/profile/assignments', element: <AssignmentLedger studentData={{ ...studentData, assignmentEvidence: [] }} /> }], '/profile/assignments');
    expect(screen.getByText(/No authoritative assignment catalog was returned/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export all catalog CSV/i })).toBeDisabled();
  });
});
