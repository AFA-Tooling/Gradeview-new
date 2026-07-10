jest.mock('./apiv2', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));
jest.mock('./apiCache', () => ({ cachedApiGet: jest.fn() }));

import {
  applyCanonicalGrade,
  buildStudentProfileData,
} from './studentProfileData';
import { processStudentData } from './studentDataProcessor';

const COMPONENTS = [
  ['attendance', 'Attendance / Participation', 'attendance', 15],
  ['labs', 'Labs', 'labs', 80],
  ['projects', 'Projects', 'projects', 155],
  ['quest', 'Quest', 'exam', 25],
  ['midterm', 'Midterm', 'exam', 50],
  ['postterm', 'Postterm', 'exam', 75],
];

const AVERY_SCORES = {
  attendance: 15,
  labs: 64.5,
  projects: 141,
  quest: 24.5,
  midterm: 32.67,
  postterm: 42,
};

const JORDAN_SCORES = {
  attendance: 15,
  labs: 53.3,
  projects: 154.33,
  quest: 25,
  midterm: 48.4,
  postterm: 72.3,
};

function canonicalGrade(scores, { exactScore, displayScore, letter }) {
  const categories = Object.fromEntries(COMPONENTS.map(([key, label, type, cap]) => [
    key,
    {
      key,
      label,
      type,
      basis: 'policy_final',
      exactScore: scores[key],
      cap,
      percentage: (scores[key] / cap) * 100,
      status: 'available',
      source: `${key}_effective`,
    },
  ]));
  const examExactScore = scores.quest + scores.midterm + scores.postterm;
  return {
    schemaVersion: '1.0',
    basis: 'policy_final',
    status: 'complete',
    exactScore,
    displayScore,
    cap: 400,
    percentage: (exactScore / 400) * 100,
    letter,
    bin: {
      grade: letter,
      range: letter === 'B-' ? '320-329' : '360-369',
      minScore: letter === 'B-' ? 320 : 360,
      maxScore: letter === 'B-' ? 329 : 369,
    },
    rounding: { mode: 'half_up_integer', precision: 0 },
    categories,
    subtotals: {
      exams: {
        basis: 'policy_final',
        exactScore: examExactScore,
        cap: 150,
        percentage: (examExactScore / 150) * 100,
        categoryKeys: ['quest', 'midterm', 'postterm'],
      },
    },
    asOf: '2026-07-09T12:00:00.000Z',
    source: 'course_policy_summary',
    rawEvidence: { basis: 'raw_evidence', status: 'not_aggregated' },
    dueWorkProgress: { basis: 'due_work_progress', status: 'not_aggregated' },
  };
}

const AVERY_GRADE = canonicalGrade(AVERY_SCORES, {
  exactScore: 319.67,
  displayScore: 320,
  letter: 'B-',
});

const JORDAN_GRADE = canonicalGrade(JORDAN_SCORES, {
  exactScore: 368.33,
  displayScore: 368,
  letter: 'A-',
});

function profilePayload(grade, overrides = {}) {
  return {
    canonicalGrade: grade,
    grades: {},
    rawGrades: { sortBy: 'time', submissions: [] },
    categoryStats: {},
    bins: {
      total_points_cap: 400,
      overall_cap_points: 400,
      assignment_points: {
        'Attendance / Participation': 15,
        Labs: 80,
        Projects: 155,
        Quest: 25,
        Midterm: 50,
        Postterm: 75,
      },
      bins: [
        { grade: 'A+', range: '390-400' },
        { grade: 'A', range: '370-389' },
        { grade: 'A-', range: '360-369' },
        { grade: 'B-', range: '320-329' },
      ],
      rounding_policy: 'nearest integer, 0.5 rounds up',
    },
    examPolicy: { rows: [], examComponentTrends: {} },
    ...overrides,
  };
}

describe('student profile canonical adapter', () => {
  test.each([
    ['Avery', AVERY_GRADE, 319.67, 320, 'B-'],
    ['Jordan', JORDAN_GRADE, 368.33, 368, 'A-'],
  ])('%s uses backend exact/display/cap/letter even with no raw or due rows', (
    _name,
    grade,
    exactScore,
    displayScore,
    letter,
  ) => {
    const result = buildStudentProfileData(profilePayload(grade), 'student@example.edu', _name);

    expect(result).toMatchObject({
      policyStandingStatus: 'complete',
      policyFinalExactScore: exactScore,
      policyFinalDisplayScore: displayScore,
      policyFinalCap: 400,
      policyFinalLetter: letter,
      totalScore: exactScore,
      displayScore,
      totalCapPoints: 400,
      gradeLetter: letter,
    });
    expect(result.canonicalGrade).toBe(grade);
    expect(result.rawAssignmentsList).toEqual([]);
    expect(result.categoriesData['Attendance / Participation'].exactScore).toBe(15);
    expect(result.categoriesData.Labs.exactScore).toBe(grade.categories.labs.exactScore);
    expect(result.categoriesData.Projects.exactScore).toBe(grade.categories.projects.exactScore);
  });

  test('exam-only due rows cannot clamp non-exam categories or the course standing', () => {
    const examOnlyGrades = {
      Quest: {
        'Quest 1': { student: 25, max: 25, dueAt: '2026-06-01T00:00:00.000Z' },
      },
      Midterm: {
        Midterm: { student: 48.4, max: 50, dueAt: '2026-06-02T00:00:00.000Z' },
      },
      Postterm: {
        Postterm: { student: 72.3, max: 75, dueAt: '2026-06-03T00:00:00.000Z' },
      },
    };
    const rawExamRows = [
      { category: 'Quest', name: 'Quest 1', score: 25, maxPoints: 25, dueAt: '2026-06-01T00:00:00.000Z' },
      { category: 'Midterm', name: 'Midterm', score: 48.4, maxPoints: 50, dueAt: '2026-06-02T00:00:00.000Z' },
      { category: 'Postterm', name: 'Postterm', score: 72.3, maxPoints: 75, dueAt: '2026-06-03T00:00:00.000Z' },
    ];

    const result = buildStudentProfileData(profilePayload(JORDAN_GRADE, {
      grades: examOnlyGrades,
      rawGrades: { sortBy: 'time', submissions: rawExamRows },
    }), 'jordan@example.edu', 'Jordan');

    expect(result.rawAssignmentsList).toHaveLength(3);
    expect(result.categoriesData['Attendance / Participation'].exactScore).toBe(15);
    expect(result.categoriesData.Labs.exactScore).toBe(53.3);
    expect(result.categoriesData.Projects.exactScore).toBe(154.33);
    expect(result.totalScore).toBe(368.33);
    expect(result.displayScore).toBe(368);
    expect(result.policyFinalLetter).toBe('A-');
  });

  test('41b3e4b regression: profile retains future and no-due non-exam catalog rows', () => {
    const rawRows = [
      {
        assignmentId: 'lab-future',
        category: 'Labs',
        name: 'Lab Future',
        score: null,
        maxPoints: 10,
        evidenceStatus: 'not_due',
        dueAt: '2099-07-20T00:00:00.000Z',
      },
      {
        assignmentId: 'project-unknown',
        category: 'Projects',
        name: 'Project Due Unknown',
        score: null,
        maxPoints: 20,
        evidenceStatus: 'due_unknown',
        dueAt: null,
      },
    ];
    const result = buildStudentProfileData(profilePayload(AVERY_GRADE, {
      grades: {
        Labs: {
          'Lab Future': {
            assignmentId: 'lab-future', student: null, max: 10, evidenceStatus: 'not_due',
            dueAt: '2099-07-20T00:00:00.000Z',
          },
        },
        Projects: {
          'Project Due Unknown': {
            assignmentId: 'project-unknown', student: null, max: 20, evidenceStatus: 'due_unknown',
            dueAt: null,
          },
        },
      },
      rawGrades: {
        basis: 'assignment_evidence',
        catalogCount: 2,
        sortBy: 'time',
        submissions: rawRows,
      },
    }), 'student@example.edu', 'Student');

    expect(result.rawAssignmentsList.map((row) => row.name)).toEqual([
      'Lab Future', 'Project Due Unknown',
    ]);
    expect(result.assignmentsList.map((row) => row.name)).toEqual([
      'Lab Future', 'Project Due Unknown',
    ]);
    expect(result.totalScore).toBe(AVERY_GRADE.exactScore);
    expect(result.categoriesData.Labs.exactScore).toBe(AVERY_GRADE.categories.labs.exactScore);
    expect(result.categoriesData.Projects.exactScore).toBe(AVERY_GRADE.categories.projects.exactScore);
  });

  test('passes through authoritative evidence IDs, statuses, and nullable scores without coercion', () => {
    const evidence = [
      {
        assignmentId: 'lab-duplicate-a',
        category: 'Labs',
        name: 'Duplicate Lab',
        evidenceStatus: 'due_unknown',
        score: null,
        recordedScore: null,
        maxPoints: 10,
        dueAt: null,
        releaseAt: null,
        sourceSyncStatus: 'synced',
        requestError: null,
      },
      {
        assignmentId: 'lab-duplicate-b',
        category: 'Labs',
        name: 'Duplicate Lab',
        evidenceStatus: 'earned_zero',
        score: 0,
        recordedScore: 0,
        maxPoints: 10,
        dueAt: '2026-07-01T12:00:00.000Z',
        releaseAt: '2026-06-01T12:00:00.000Z',
        sourceSyncStatus: 'synced',
        requestError: null,
      },
    ];

    const result = buildStudentProfileData(profilePayload(AVERY_GRADE, {
      rawGrades: {
        basis: 'assignment_evidence',
        catalogCount: 2,
        sortBy: 'time',
        submissions: evidence,
      },
    }), 'student@example.edu', 'Student');

    expect(result.assignmentEvidence).toHaveLength(2);
    expect(result.assignmentEvidence.map((row) => row.assignmentId)).toEqual([
      'lab-duplicate-a',
      'lab-duplicate-b',
    ]);
    expect(result.assignmentEvidence.map((row) => row.evidenceStatus)).toEqual([
      'due_unknown',
      'earned_zero',
    ]);
    expect(result.assignmentEvidence.map((row) => row.score)).toEqual([null, 0]);
    expect(result.assignmentEvidence).toEqual(evidence);
  });

  test('student data processor retains future and no-due rows in both API adapters', () => {
    const timeRows = [
      {
        category: 'Labs', name: 'Future Lab', score: null, maxPoints: 10,
        evidenceStatus: 'not_due', dueAt: '2099-07-20T00:00:00.000Z',
      },
      {
        category: 'Projects', name: 'Unknown Project', score: null, maxPoints: 20,
        evidenceStatus: 'due_unknown', dueAt: null,
      },
    ];
    const timeResult = processStudentData({
      sortBy: 'time',
      submissions: timeRows,
    }, 'student@example.edu', 'Student', 'time');
    expect(timeResult.assignmentsList.map((row) => row.name)).toEqual([
      'Future Lab', 'Unknown Project',
    ]);

    const groupedResult = processStudentData({
      Labs: {
        'Future Lab': {
          student: null, max: 10, evidenceStatus: 'not_due',
          dueAt: '2099-07-20T00:00:00.000Z',
        },
      },
      Projects: {
        'Unknown Project': {
          student: null, max: 20, evidenceStatus: 'due_unknown', dueAt: null,
        },
      },
    }, 'student@example.edu', 'Student');
    expect(groupedResult.assignmentsList.map((row) => row.name)).toEqual([
      'Future Lab', 'Unknown Project',
    ]);
  });

  test('fractional category exact scores and exact exam subtotal are never ceiled', () => {
    const result = applyCanonicalGrade({
      totalScore: 147,
      totalCapPoints: 150,
      categoriesData: {
        Quest: { total: 25, capPoints: 25 },
        Midterm: { total: 49, capPoints: 50 },
        Postterm: { total: 73, capPoints: 75 },
      },
      assignmentsList: [],
    }, JORDAN_GRADE);

    expect(result.categoriesData.Labs.exactScore).toBe(53.3);
    expect(result.categoriesData.Projects.exactScore).toBe(154.33);
    expect(result.categoriesData.Midterm.exactScore).toBe(48.4);
    expect(result.categoriesData.Postterm.exactScore).toBe(72.3);
    expect(result.examPolicySubtotal).toMatchObject({
      exactScore: 145.7,
      cap: 150,
      categoryKeys: ['quest', 'midterm', 'postterm'],
    });
    expect(result.examPolicySubtotal.exactScore).not.toBe(
      Math.ceil(25) + Math.ceil(48.4) + Math.ceil(72.3),
    );
  });

  test('missing canonical contract is explicit unavailable and never promoted to a full standing', () => {
    const result = applyCanonicalGrade({
      totalScore: 147,
      totalCapPoints: 400,
      overallPercentage: 36.75,
      categoriesData: {
        Quest: { total: 25, capPoints: 25 },
        Midterm: { total: 49, capPoints: 50 },
        Postterm: { total: 73, capPoints: 75 },
      },
      assignmentsList: [],
    }, null);

    expect(result).toMatchObject({
      canonicalGrade: null,
      policyStandingStatus: 'unavailable',
      policyStandingError: 'canonical_grade_missing',
      policyFinalExactScore: null,
      policyFinalDisplayScore: null,
      policyFinalLetter: null,
      totalScore: null,
      displayScore: null,
      totalCapPoints: null,
      overallPercentage: null,
      gradeLetter: null,
      rawEvidenceStanding: {
        basis: 'raw_evidence',
        status: 'available',
        exactScore: 147,
        cap: 400,
        percentage: 36.75,
      },
    });
    expect(result.categoriesData.Quest.basis).toBe('raw_evidence');

    const emptyPayloadResult = buildStudentProfileData(
      profilePayload(null),
      'missing@example.edu',
      'Missing Contract',
    );
    expect(emptyPayloadResult).toMatchObject({
      canonicalGrade: null,
      policyStandingStatus: 'unavailable',
      policyStandingError: 'canonical_grade_missing',
      totalScore: null,
      displayScore: null,
      gradeLetter: null,
      rawEvidenceStanding: {
        basis: 'raw_evidence',
        status: 'unavailable',
      },
    });
  });
});
