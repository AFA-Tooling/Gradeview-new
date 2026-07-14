import React from 'react';
import { render, screen, within } from '@testing-library/react';
import StudentProfile from './StudentProfile';
import { fetchStudentProfileData } from '../utils/studentProfileData';

jest.mock('../utils/studentProfileData', () => ({
  applyCanonicalSummaryTotals: jest.fn((value) => value),
  fetchStudentProfileData: jest.fn(),
}));

jest.mock('./StudentProfileContent', () => function MockStudentProfileContent() {
  return <div>Shared report details</div>;
});

jest.mock('./GradeDataFlow', () => () => <div>Grade flow</div>);
jest.mock('../views/conceptMap', () => () => <div>Concept map</div>);

const profileData = {
  studentName: 'Kimberly Villa',
  canonicalGrade: {
    basis: 'policy_final',
    status: 'available',
    exactScore: 25,
    displayScore: 25,
    cap: 400,
    percentage: 6.25,
    letter: 'F',
    bin: { grade: 'F', range: '0-249', minScore: 0, maxScore: 249 },
    categories: {},
  },
  gradeBins: [
    { grade: 'A-', minScore: 350 },
    { grade: 'A', minScore: 370 },
  ],
  assignmentEvidence: [{
    basis: 'assignment_evidence',
    assignmentId: 'lab-7',
    category: 'Labs',
    name: 'Lab 7',
    evidenceStatus: 'missing',
    score: null,
    maxPoints: 1,
    dueAt: '2026-07-01T12:00:00.000Z',
  }],
};

describe('Class Health Student Report modal', () => {
  beforeEach(() => {
    fetchStudentProfileData.mockResolvedValue(profileData);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('fetches the full profile and renders the shared progress cards', async () => {
    render(
      <StudentProfile
        open
        onClose={jest.fn()}
        studentEmail="kimberly.villa@berkeley.edu"
        studentName="Kimberly Villa"
        selectedCourse="course-101"
        courses={[{ id: 'course-101', gradescope_course_id: 'gs-101' }]}
      />,
    );

    expect(await screen.findByRole('dialog', { name: 'Student Report' })).toBeInTheDocument();
    expect(fetchStudentProfileData).toHaveBeenCalledWith(expect.objectContaining({
      studentEmail: 'kimberly.villa@berkeley.edu',
      selectedCourse: 'course-101',
    }));

    const cards = screen.getByTestId('progress-analysis-cards');
    expect(within(cards).getByText('Overall score')).toBeInTheDocument();
    expect(within(cards).getByText('25 / 400')).toBeInTheDocument();
    expect(within(cards).getByText('Happy score')).toBeInTheDocument();
    expect(within(cards).getByText('399 / 400')).toBeInTheDocument();
    expect(within(cards).getByText('Grade safety margin')).toBeInTheDocument();
    expect(within(cards).getByText('29 pts')).toBeInTheDocument();
    expect(screen.queryByText('Final Policy Snapshot')).not.toBeInTheDocument();
  });
});
