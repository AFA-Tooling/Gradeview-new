import {
  CATEGORY_DEFINITIONS,
  EVIDENCE_STATUSES,
  buildCategoryPresentation,
  buildCategoryPresentations,
  buildLedgerCsv,
  buildTopActions,
  filterLedgerRows,
  formatAttemptCount,
  formatCourseDateTime,
  formatEvidenceScore,
  getActualClobberRows,
  getAssignmentEvidence,
  getCanonicalContractState,
  getCanonicalStanding,
  getMostImportantCategory,
  getProgressAnalysis,
  isDueWorkStatus,
  mergeExperienceQuery,
  parseCategoryPageQuery,
  parseExamMode,
  parseExamSelection,
  parseLedgerQuery,
  sortLedgerRows,
  summarizeEvidence,
} from './studentExperienceModel';

const CATEGORY_VALUES = {
  attendance: [15, 15],
  labs: [64.5, 80],
  projects: [141, 155],
  quest: [24.5, 25],
  midterm: [32.67, 50],
  postterm: [42, 75],
};

function canonicalGrade({ exactScore = 319.67, displayScore = 320, letter = 'B-' } = {}) {
  return {
    schemaVersion: '1.0',
    basis: 'policy_final',
    status: 'complete',
    exactScore,
    displayScore,
    cap: 400,
    percentage: (exactScore / 400) * 100,
    letter,
    bin: { grade: letter, range: '320-329', minScore: 320, maxScore: 329 },
    categories: Object.fromEntries(CATEGORY_DEFINITIONS.map((definition) => {
      const [score, cap] = CATEGORY_VALUES[definition.key];
      return [definition.key, {
        key: definition.key,
        label: definition.label,
        type: definition.type,
        basis: 'policy_final',
        exactScore: score,
        cap,
        percentage: (score / cap) * 100,
        status: 'available',
        source: `${definition.key}_effective`,
      }];
    })),
    subtotals: {
      exams: {
        basis: 'policy_final',
        exactScore: 99.17,
        cap: 150,
        categoryKeys: ['quest', 'midterm', 'postterm'],
      },
    },
  };
}

function evidenceRow(definition, status, overrides = {}) {
  const scored = ['earned_zero', 'submitted'].includes(status);
  return {
    schemaVersion: '1.0',
    basis: 'assignment_evidence',
    assignmentId: `${definition.key}-${status}`,
    category: definition.label,
    rawCategory: definition.label,
    name: `${definition.shortLabel} ${status}`,
    maxPoints: 10,
    evidenceStatus: status,
    score: status === 'earned_zero' ? 0 : (status === 'submitted' ? 7 : null),
    recordedScore: status === 'earned_zero' ? 0 : (status === 'submitted' ? 7 : null),
    percentage: scored ? (status === 'earned_zero' ? 0 : 70) : null,
    submissionTime: scored ? '2026-07-01T12:00:00.000Z' : null,
    dueAt: ['missing', 'earned_zero', 'submitted'].includes(status)
      ? '2026-07-01T12:00:00.000Z'
      : null,
    sourceSyncStatus: status === 'not_synced' ? 'not_synced' : 'synced',
    requestError: status === 'request_error' ? 'source timeout' : null,
    ...overrides,
  };
}

describe('student experience A1/A2 presentation contract', () => {
  test.each(CATEGORY_DEFINITIONS.flatMap((definition) => (
    EVIDENCE_STATUSES.map((status) => [definition, status])
  )))('%s preserves %s without collapsing unavailable scores to zero', (definition, status) => {
    const row = evidenceRow(definition, status);
    const presentation = buildCategoryPresentation({
      canonicalGrade: canonicalGrade(),
      assignmentEvidence: [row],
    }, definition.key);

    expect(presentation.basis).toBe('policy_final');
    expect(presentation.exactScore).toBe(CATEGORY_VALUES[definition.key][0]);
    expect(presentation.evidenceRows).toHaveLength(1);
    expect(presentation.evidenceRows[0].evidenceStatus).toBe(status);
    expect(presentation.evidenceRows[0].score).toBe(
      status === 'earned_zero' ? 0 : (status === 'submitted' ? 7 : null),
    );
    if (['earned_zero', 'missing'].includes(status)) {
      expect(formatEvidenceScore(presentation.evidenceRows[0])).toBe('0 / 10');
    } else if (!['submitted'].includes(status)) {
      expect(formatEvidenceScore(presentation.evidenceRows[0])).not.toBe('0 / 10');
    }
    expect(isDueWorkStatus(status)).toBe(['earned_zero', 'submitted', 'missing'].includes(status));
  });

  test.each([
    ['Avery', canonicalGrade(), 319.67, 320, 'B-', 64.5],
    ['Jordan', canonicalGrade({ exactScore: 368.33, displayScore: 368, letter: 'A-' }), 368.33, 368, 'A-', 64.5],
  ])('%s keeps one canonical standing across every page model', (
    _name,
    grade,
    exact,
    display,
    letter,
    labs,
  ) => {
    const studentData = {
      canonicalGrade: grade,
      totalScore: 0,
      displayScore: 0,
      totalCapPoints: 5,
      gradeLetter: 'F',
      categoriesData: { Labs: { total: 0, maxPoints: 1 } },
      assignmentEvidence: [],
    };

    expect(getCanonicalStanding(studentData)).toMatchObject({
      exactScore: exact,
      displayScore: display,
      cap: 400,
      letter,
    });
    const presentations = buildCategoryPresentations(studentData);
    expect(presentations.find((block) => block.key === 'labs')).toMatchObject({
      exactScore: labs,
      cap: 80,
      basis: 'policy_final',
    });
  });

  test('category status keeps an unavailable placeholder zero distinct from real evidence', () => {
    const grade = canonicalGrade();
    grade.categories.labs = {
      ...grade.categories.labs,
      exactScore: 0,
      cap: 80,
      percentage: 0,
      status: 'unavailable',
      source: 'labs_policy_unavailable',
    };
    const labEvidence = evidenceRow(CATEGORY_DEFINITIONS[1], 'submitted', {
      assignmentId: 'lab-real-evidence',
      score: 8,
      recordedScore: 8,
      maxPoints: 10,
      percentage: 80,
    });

    const labs = buildCategoryPresentations({ canonicalGrade: grade, assignmentEvidence: [labEvidence] })
      .find((block) => block.key === 'labs');

    expect(labs).toMatchObject({
      exactScore: null,
      cap: 80,
      percentage: null,
      canonicalStatus: 'unavailable',
      source: 'labs_policy_unavailable',
      summary: {
        submittedItems: 1,
        rawScore: 8,
        rawMax: 10,
      },
    });

    expect(getCanonicalContractState({ canonicalGrade: grade })).toEqual(expect.objectContaining({
      partial: true,
      unavailableCategories: ['Labs'],
      message: 'Partial data · Labs unavailable; total/letter may be incomplete',
    }));
  });

  test('complete canonical data does not produce a partial-data warning', () => {
    expect(getCanonicalContractState({ canonicalGrade: canonicalGrade() })).toEqual(expect.objectContaining({
      partial: false,
      unavailableCategories: [],
      message: '',
    }));
  });

  test('due-work denominator excludes unknown, unsynced, not-due, N/A, and error rows', () => {
    const definition = CATEGORY_DEFINITIONS[1];
    const rows = EVIDENCE_STATUSES.map((status) => evidenceRow(definition, status));
    const summary = summarizeEvidence(getAssignmentEvidence({ assignmentEvidence: rows }));

    expect(summary.dueItemCount).toBe(3);
    expect(summary.dueScore).toBe(7);
    expect(summary.dueMax).toBe(30);
    expect(summary.statusCounts).toEqual(Object.fromEntries(
      EVIDENCE_STATUSES.map((status) => [status, 1]),
    ));
  });

  test('progress analysis focuses on points already lost and the best possible finish', () => {
    const definition = CATEGORY_DEFINITIONS[1];
    const analysis = getProgressAnalysis({
      canonicalGrade: canonicalGrade(),
      gradeBins: [
        { grade: 'B+', minScore: 340 },
        { grade: 'A-', minScore: 350 },
        { grade: 'A', minScore: 370 },
      ],
      assignmentEvidence: [
        evidenceRow(definition, 'submitted'),
        evidenceRow(definition, 'missing', { assignmentId: 'lab-missing' }),
        evidenceRow(definition, 'not_due', { assignmentId: 'lab-future', maxPoints: 100 }),
        evidenceRow(definition, 'due_unknown', { assignmentId: 'lab-unknown', maxPoints: 100 }),
      ],
    });

    expect(analysis).toMatchObject({
      courseCap: 400,
      dueScore: 7,
      dueCap: 20,
      pointsLost: 13,
      happyScore: 387,
      happyGrade: 'A',
      happyGradeFloor: 370,
      lowerGrade: 'A-',
      gradeTolerance: 17,
    });
  });

  test('Top Actions are concrete, timezone-aware, point-specific Ledger deep links', () => {
    const missing = evidenceRow(CATEGORY_DEFINITIONS[2], 'missing', {
      assignmentId: 'project-2',
      name: 'Project 2: Spelling Bee',
      maxPoints: 25,
      dueAt: '2026-07-10T00:00:00.000Z',
    });
    const [action] = buildTopActions({ assignmentEvidence: [missing] });
    const url = new URL(action.to, 'https://gradeview.local');

    expect(action.title).toBe('Resolve Project 2: Spelling Bee');
    expect(action.detail).toContain('Jul 9, 2026, 5:00 PM PDT');
    expect(action.detail).toContain('Up to 25 points');
    expect(url.pathname).toBe('/profile/assignments');
    expect(url.searchParams.get('category')).toBe('Projects');
    expect(url.searchParams.get('status')).toBe('missing');
    expect(url.searchParams.get('search')).toBe('Project 2: Spelling Bee');
  });

  test('Most important category ranks actionable risk rather than the largest cap', () => {
    const blocks = buildCategoryPresentations({
      canonicalGrade: canonicalGrade(),
      assignmentEvidence: [
        evidenceRow(CATEGORY_DEFINITIONS[1], 'missing', { assignmentId: 'lab-risk' }),
        evidenceRow(CATEGORY_DEFINITIONS[2], 'submitted', { assignmentId: 'project-safe' }),
      ],
    });

    expect(getMostImportantCategory(blocks)).toMatchObject({
      key: 'labs',
      importanceReason: '1 missing assignment',
    });
  });
});

describe('URL-backed page state', () => {
  test('restores Labs tab/status, exam mode, and safe invalid fallbacks', () => {
    expect(parseCategoryPageQuery('?tab=policy&status=not_synced', 'labs')).toEqual({
      tab: 'policy',
      status: 'not_synced',
    });
    expect(parseCategoryPageQuery('?tab=bogus&status=zero', 'labs')).toEqual({
      tab: 'overview',
      status: 'all',
    });
    expect(parseExamMode('?mode=question-best')).toBe('question_best');
    expect(parseExamMode('?mode=bogus')).toBe('clobber');
    expect(parseExamSelection('?exam=midterm')).toBe('midterm');
    expect(parseExamSelection('?exam=bogus')).toBe('quest');
  });

  test('updates one state key while preserving unrelated query parameters', () => {
    const search = mergeExperienceQuery('?course_id=demo&filter=missing', {
      mode: 'raw',
    });
    const params = new URLSearchParams(search);
    expect(params.get('course_id')).toBe('demo');
    expect(params.get('filter')).toBe('missing');
    expect(params.get('mode')).toBe('raw');
  });

  test('restores Ledger category/status/search/group and filters authoritative rows', () => {
    const definitions = CATEGORY_DEFINITIONS;
    const rows = getAssignmentEvidence({
      assignmentEvidence: [
        evidenceRow(definitions[1], 'missing', { assignmentId: 'lab-a', name: 'Duplicate' }),
        evidenceRow(definitions[1], 'submitted', { assignmentId: 'lab-b', name: 'Duplicate' }),
        evidenceRow(definitions[2], 'missing', { assignmentId: 'project-a', name: 'Project 1' }),
      ],
    });
    const state = parseLedgerQuery(
      '?category=Labs&status=missing&search=Duplicate&group=status',
      rows,
    );

    expect(state).toEqual({
      category: 'Labs',
      status: 'missing',
      search: 'Duplicate',
      group: 'status',
    });
    expect(filterLedgerRows(rows, state).map((row) => row.assignmentId)).toEqual(['lab-a']);
    expect(sortLedgerRows(rows, 'category').map((row) => row.assignmentId)).toEqual([
      'lab-a', 'lab-b', 'project-a',
    ]);
  });
});

describe('Ledger CSV and exam semantics', () => {
  test('CSV keeps duplicate IDs, blank unknown scores, true zero, year, and PST/PDT timezone', () => {
    const labs = CATEGORY_DEFINITIONS[1];
    const rows = getAssignmentEvidence({
      assignmentEvidence: [
        evidenceRow(labs, 'due_unknown', {
          assignmentId: 'duplicate-a', name: 'Duplicate', score: null, recordedScore: null,
        }),
        evidenceRow(labs, 'earned_zero', {
          assignmentId: 'duplicate-b', name: 'Duplicate', score: 0, recordedScore: 0,
          dueAt: '2026-07-10T00:00:00.000Z',
        }),
      ],
    });
    const csv = buildLedgerCsv(rows);
    const lines = csv.split('\r\n');

    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('duplicate-a,Labs,Duplicate,due_unknown,,,10');
    expect(lines[1]).not.toContain('due_unknown,0,0');
    expect(lines[2]).toContain('duplicate-b,Labs,Duplicate,earned_zero,0,0,10');
    expect(csv).toContain('Jul 9, 2026, 5:00 PM PDT');
    expect(formatCourseDateTime('2026-01-10T00:00:00.000Z')).toContain('PST');
  });

  test('clobber rows require a real positive change and attempt grammar is correct', () => {
    const rows = [
      { clobberSourceTitle: 'Postterm', questionBestPercentage: 80, finalPercentage: 80 },
      { clobberSourceTitle: 'Postterm', questionBestPercentage: 80, finalPercentage: 90 },
      { clobberSourceTitle: null, questionBestPercentage: 70, finalPercentage: 90 },
    ];
    expect(getActualClobberRows(rows)).toEqual([rows[1]]);
    expect(formatAttemptCount(1)).toBe('1 attempt');
    expect(formatAttemptCount(2)).toBe('2 attempts');
  });
});
