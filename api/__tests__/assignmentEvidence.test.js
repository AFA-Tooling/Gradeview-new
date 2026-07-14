import {
    ASSIGNMENT_EVIDENCE_STATUS,
    attachAssignmentEvidenceToCanonicalGrade,
    assignmentEvidenceRequestError,
    buildCourseAssignmentCatalogResponse,
    buildStudentAssignmentEvidenceQuery,
    groupAssignmentEvidence,
    joinAssignmentCatalogWithEvidence,
    queryCourseAssignmentCatalog,
    queryStudentAssignmentEvidence,
    resolveAssignmentEvidenceStatus,
    serializeAssignmentEvidence,
    summarizeAssignmentEvidence,
} from '../lib/assignmentEvidence.mjs';

const NOW = Date.parse('2026-07-09T12:00:00.000Z');
const PAST_DUE = '2026-07-01T12:00:00.000Z';
const FUTURE_DUE = '2026-07-20T12:00:00.000Z';
const SYNCED_AT = '2026-07-08T12:00:00.000Z';

function catalogRow(index, overrides = {}) {
    return {
        assignment_pk: String(index),
        external_assignment_id: `course:assignment:${index}`,
        assignment_name: `Assignment ${index}`,
        category: 'Labs',
        assignment_max_points: 10,
        assignment_metadata: {},
        assignment_last_synced_at: SYNCED_AT,
        course_last_synced_at: SYNCED_AT,
        course_id: 'course-1',
        gradescope_course_id: 'gs-1',
        student_id: 'student-1',
        student_email: 'student@example.edu',
        student_name: 'Student One',
        ...overrides,
    };
}

describe('assignment evidence state machine', () => {
    test.each([
        ['submitted', {
            submission_pk: 's1', submission_status: 'submitted', total_score: 7, due_at: PAST_DUE,
        }, ASSIGNMENT_EVIDENCE_STATUS.SUBMITTED, 7],
        ['earned zero', {
            submission_pk: 's1', submission_status: 'submitted', total_score: 0, due_at: PAST_DUE,
        }, ASSIGNMENT_EVIDENCE_STATUS.EARNED_ZERO, 0],
        ['missing past due', {
            due_at: PAST_DUE,
        }, ASSIGNMENT_EVIDENCE_STATUS.MISSING, null],
        ['not due', {
            due_at: FUTURE_DUE,
        }, ASSIGNMENT_EVIDENCE_STATUS.NOT_DUE, null],
        ['due unknown', {
            due_at: null,
        }, ASSIGNMENT_EVIDENCE_STATUS.DUE_UNKNOWN, null],
        ['not synced', {
            due_at: PAST_DUE, assignment_last_synced_at: null, course_last_synced_at: SYNCED_AT,
        }, ASSIGNMENT_EVIDENCE_STATUS.NOT_SYNCED, null],
        ['not applicable', {
            due_at: PAST_DUE, assignment_metadata: { not_applicable: true },
        }, ASSIGNMENT_EVIDENCE_STATUS.NOT_APPLICABLE, null],
        ['request error', {
            due_at: PAST_DUE, assignment_last_synced_at: null, request_error: 'source timeout',
        }, ASSIGNMENT_EVIDENCE_STATUS.REQUEST_ERROR, null],
    ])('%s is explicit and serializable', (_label, overrides, expectedStatus, expectedScore) => {
        const serialized = serializeAssignmentEvidence(catalogRow(1, overrides), { now: NOW });
        expect(serialized.evidenceStatus).toBe(expectedStatus);
        expect(serialized.score).toBe(expectedScore);
        expect(JSON.parse(JSON.stringify(serialized)).evidenceStatus).toBe(expectedStatus);
    });

    test.each([
        ['past due', PAST_DUE, ASSIGNMENT_EVIDENCE_STATUS.MISSING],
        ['future due', FUTURE_DUE, ASSIGNMENT_EVIDENCE_STATUS.NOT_DUE],
        ['no due metadata', null, ASSIGNMENT_EVIDENCE_STATUS.DUE_UNKNOWN],
    ])('synced catalog with no submission is %s and legacy student remains null', (
        _label,
        dueAt,
        expectedStatus,
    ) => {
        const serialized = serializeAssignmentEvidence(catalogRow(10, {
            due_at: dueAt,
            submission_pk: null,
            total_score: null,
        }), { now: NOW });
        expect(serialized).toMatchObject({
            evidenceStatus: expectedStatus,
            sourceSyncStatus: 'synced',
            score: null,
            recordedScore: null,
            submitted: false,
        });
        expect(groupAssignmentEvidence([serialized]).Labs['Assignment 10'].student).toBeNull();
    });

    test('state priority is N/A, usable stored evidence, request error, not synced, then schedule', () => {
        expect(resolveAssignmentEvidenceStatus(catalogRow(11, {
            assignment_metadata: { not_applicable: true },
            source_sync_status: 'request_error',
            request_error: 'timeout',
        }), NOW)).toBe(ASSIGNMENT_EVIDENCE_STATUS.NOT_APPLICABLE);

        expect(resolveAssignmentEvidenceStatus(catalogRow(12, {
            submission_pk: 'stored-zero',
            submission_status: 'submitted',
            total_score: 0,
            source_sync_status: 'request_error',
            request_error: 'timeout',
        }), NOW)).toBe(ASSIGNMENT_EVIDENCE_STATUS.EARNED_ZERO);

        expect(resolveAssignmentEvidenceStatus(catalogRow(13, {
            submission_pk: 'error-placeholder',
            submission_status: 'missing',
            total_score: 0,
            source_sync_status: 'request_error',
            request_error: 'timeout',
            due_at: PAST_DUE,
        }), NOW)).toBe(ASSIGNMENT_EVIDENCE_STATUS.REQUEST_ERROR);

        expect(resolveAssignmentEvidenceStatus(catalogRow(14, {
            submission_status: 'not_synced',
            request_error: null,
            due_at: PAST_DUE,
        }), NOW)).toBe(ASSIGNMENT_EVIDENCE_STATUS.NOT_SYNCED);
    });

    test('course-level timestamp alone deliberately cannot prove assignment evidence was synced', () => {
        const serialized = serializeAssignmentEvidence(catalogRow(15, {
            assignment_last_synced_at: null,
            course_last_synced_at: SYNCED_AT,
            submission_pk: null,
            due_at: PAST_DUE,
        }), { now: NOW });
        expect(serialized).toMatchObject({
            evidenceStatus: ASSIGNMENT_EVIDENCE_STATUS.NOT_SYNCED,
            sourceSyncStatus: 'not_synced',
        });
    });

    test.each([
        ['future due', FUTURE_DUE, ASSIGNMENT_EVIDENCE_STATUS.NOT_DUE],
        ['unknown due', null, ASSIGNMENT_EVIDENCE_STATUS.DUE_UNKNOWN],
        ['past due', PAST_DUE, ASSIGNMENT_EVIDENCE_STATUS.MISSING],
    ])('Missing source placeholder follows %s schedule instead of row existence', (_label, dueAt, expected) => {
        const row = catalogRow(2, {
            submission_pk: 'missing-placeholder',
            submission_id: 'demo-placeholder',
            submission_status: 'missing',
            total_score: 0,
            submission_time: null,
            submission_count: 0,
            due_at: dueAt,
        });
        expect(resolveAssignmentEvidenceStatus(row, NOW)).toBe(expected);
        const serialized = serializeAssignmentEvidence(row, { now: NOW });
        expect(serialized.hasSourceRecord).toBe(true);
        expect(serialized.hasUsableSubmission).toBe(false);
        expect(serialized.score).toBeNull();
        expect(serialized.recordedScore).toBe(0);
    });

    test('blank placeholder row is not silently promoted to submitted', () => {
        const serialized = serializeAssignmentEvidence(catalogRow(3, {
            submission_pk: 'blank-placeholder',
            submission_status: null,
            total_score: null,
            submission_id: null,
            submission_time: null,
            submission_count: 0,
            due_at: null,
        }), { now: NOW });
        expect(serialized).toMatchObject({
            evidenceStatus: ASSIGNMENT_EVIDENCE_STATUS.DUE_UNKNOWN,
            hasSourceRecord: true,
            hasUsableSubmission: false,
            score: null,
        });
    });

    test('stored score survives a later sync failure with a warning', () => {
        const serialized = serializeAssignmentEvidence(catalogRow(4, {
            submission_pk: 'stored',
            submission_status: 'submitted',
            total_score: 8.5,
            source_sync_status: 'request_error',
            request_error: 'latest refresh failed',
        }), { now: NOW });
        expect(serialized).toMatchObject({
            evidenceStatus: ASSIGNMENT_EVIDENCE_STATUS.SUBMITTED,
            score: 8.5,
            sourceSyncStatus: 'request_error',
            syncWarning: 'request_error',
            requestError: null,
        });
    });

    test('future release without a due date is not due; timing does not erase the row', () => {
        expect(serializeAssignmentEvidence(catalogRow(5, {
            release_at: FUTURE_DUE,
            due_at: null,
        }), { now: NOW })).toMatchObject({
            evidenceStatus: ASSIGNMENT_EVIDENCE_STATUS.NOT_DUE,
            dueState: 'due_unknown',
        });
    });

    test('due progress includes missing work in its denominator and excludes incomplete timing/sync states', () => {
        const rows = [
            serializeAssignmentEvidence(catalogRow(20, {
                submission_pk: 'submitted', submission_status: 'submitted', total_score: 8, due_at: PAST_DUE,
            }), { now: NOW }),
            serializeAssignmentEvidence(catalogRow(21, {
                submission_pk: 'zero', submission_status: 'submitted', total_score: 0, due_at: PAST_DUE,
            }), { now: NOW }),
            serializeAssignmentEvidence(catalogRow(22, { due_at: PAST_DUE }), { now: NOW }),
            serializeAssignmentEvidence(catalogRow(23, { due_at: FUTURE_DUE }), { now: NOW }),
            serializeAssignmentEvidence(catalogRow(24, { due_at: null }), { now: NOW }),
            serializeAssignmentEvidence(catalogRow(25, {
                due_at: PAST_DUE, assignment_last_synced_at: null,
            }), { now: NOW }),
        ];
        const summary = summarizeAssignmentEvidence(rows);
        expect(summary).toMatchObject({
            status: 'partial',
            totalItems: 6,
            submittedItems: 2,
            missingItems: 1,
            notDueItems: 1,
            dueUnknownItems: 1,
            notSyncedItems: 1,
            dueItemCount: 3,
            dueScore: 8,
            dueMax: 30,
        });
        expect(summary.duePercentage).toBeCloseTo((8 / 30) * 100);
    });
});

function demoCatalogRows() {
    const categories = [
        ...Array.from({ length: 6 }, () => 'Attendance / Participation'),
        ...Array.from({ length: 8 }, () => 'Labs'),
        ...Array.from({ length: 5 }, () => 'Projects'),
        ...Array.from({ length: 3 }, () => 'Quest'),
        'Midterm',
        'Postterm',
    ];
    return categories.map((category, index) => catalogRow(index + 1, {
        category,
        assignment_name: `${category} ${index + 1}`,
        due_at: index >= 19 ? PAST_DUE : null,
    }));
}

describe('catalog authority and LEFT JOIN contract', () => {
    test('mocked production query keeps all 24 visible assignments with only five evidence rows', async () => {
        const joinedRows = demoCatalogRows().map((row, index) => ({
            ...row,
            submission_pk: index >= 19 ? `submission-${index}` : null,
            submission_status: index >= 19 ? 'submitted' : null,
            total_score: index >= 19 ? 8 : null,
            submission_time: index >= 19 ? '2026-07-01T10:00:00.000Z' : null,
        }));
        const pool = { query: jest.fn().mockResolvedValue({ rows: joinedRows }) };

        const evidence = await queryStudentAssignmentEvidence(pool, {
            email: 'student@example.edu',
            courseId: 'gs-1',
            now: NOW,
        });

        expect(evidence).toHaveLength(24);
        expect(new Set(evidence.map((row) => row.assignmentId))).toHaveProperty('size', 24);
        expect(new Set(evidence.map((row) => row.category))).toEqual(new Set([
            'Attendance / Participation', 'Labs', 'Projects', 'Quest', 'Midterm', 'Postterm',
        ]));
        expect(Object.fromEntries([
            'Attendance / Participation', 'Labs', 'Projects', 'Quest', 'Midterm', 'Postterm',
        ].map((category) => [
            category,
            evidence.filter((row) => row.category === category).length,
        ]))).toEqual({
            'Attendance / Participation': 6,
            Labs: 8,
            Projects: 5,
            Quest: 3,
            Midterm: 1,
            Postterm: 1,
        });
        expect(evidence.filter((row) => row.hasUsableSubmission)).toHaveLength(5);
        expect(evidence.slice(0, 19).every((row) => row.evidenceStatus === 'due_unknown')).toBe(true);

        const [queryText, params] = pool.query.mock.calls[0];
        expect(queryText).toMatch(/FROM\s+students\s+st[\s\S]+JOIN\s+assignments\s+a[\s\S]+LEFT\s+JOIN\s+submissions\s+s/i);
        expect(queryText).not.toMatch(/FROM\s+submissions\s+s/i);
        expect(params).toEqual(['student@example.edu', 'gs-1']);
    });

    test('every evidence subset preserves catalog length and IDs', () => {
        const catalog = demoCatalogRows();
        const allEvidence = catalog.map((row, index) => ({
            assignment_pk: row.assignment_pk,
            submission_pk: `submission-${index}`,
            submission_status: 'submitted',
            total_score: index,
        }));
        const expectedIds = catalog.map((row) => row.assignment_pk);

        for (let size = 0; size <= allEvidence.length; size += 1) {
            const joined = joinAssignmentCatalogWithEvidence(catalog, allEvidence.slice(0, size), { now: NOW });
            expect(joined).toHaveLength(catalog.length);
            expect(joined.map((row) => row.assignmentId)).toEqual(expectedIds);
        }
        for (let mask = 0; mask < 64; mask += 1) {
            const subset = allEvidence.filter((_row, index) => ((index * 17 + mask * 13) % 7) < 3);
            expect(joinAssignmentCatalogWithEvidence(catalog, subset, { now: NOW })).toHaveLength(24);
        }
    });

    test('profile canonical exact score and categories are invariant for every evidence subset', () => {
        const canonical = {
            basis: 'policy_final',
            exactScore: 319.67,
            displayScore: 320,
            categories: {
                attendance: { exactScore: 15, cap: 15 },
                labs: { exactScore: 64.5, cap: 80 },
                projects: { exactScore: 141, cap: 155 },
            },
        };
        const catalog = demoCatalogRows();
        const allEvidence = catalog.map((row, index) => ({
            assignment_pk: row.assignment_pk,
            submission_pk: `submission-${index}`,
            submission_status: 'submitted',
            total_score: index === 0 ? 0 : 8,
        }));

        const assertCanonicalInvariant = (evidenceSubset) => {
            const joined = joinAssignmentCatalogWithEvidence(catalog, evidenceSubset, { now: NOW });
            const decorated = attachAssignmentEvidenceToCanonicalGrade(canonical, joined, []);
            expect(decorated.exactScore).toBe(canonical.exactScore);
            expect(decorated.displayScore).toBe(canonical.displayScore);
            expect(decorated.categories).toEqual(canonical.categories);
            expect(decorated.rawEvidence.catalogCount).toBe(24);
        };

        for (let size = 0; size <= allEvidence.length; size += 1) {
            assertCanonicalInvariant(allEvidence.slice(0, size));
        }
        for (let mask = 0; mask < 64; mask += 1) {
            assertCanonicalInvariant(allEvidence.filter((_row, index) => (
                ((index * 19 + mask * 11) % 9) < 4
            )));
        }
        expect(canonical).not.toHaveProperty('rawEvidence');
    });

    test('known raw categories stay visible, synthetic/internal/unpublished rows do not, duplicate titles keep IDs', () => {
        const catalog = [
            catalogRow(1, { category: '_attendance_raw', assignment_name: 'Session 1' }),
            catalogRow(2, { category: '_labs_raw', assignment_name: 'Lab 1' }),
            catalogRow(3, { category: '_projects_raw', assignment_name: 'Project 1' }),
            catalogRow(4, { category: '_internal', assignment_name: 'Internal' }),
            catalogRow(5, { external_assignment_id: 'labs_rollup:1', assignment_name: 'Labs' }),
            catalogRow(6, { assignment_name: 'Unpublished', assignment_metadata: { published: false } }),
            catalogRow(7, { assignment_name: 'Duplicate' }),
            catalogRow(8, { assignment_name: 'Duplicate' }),
            catalogRow(9, { assignment_name: 'Visible Practice', assignment_metadata: { is_practice: true } }),
        ];
        const joined = joinAssignmentCatalogWithEvidence(catalog, [], { now: NOW });
        expect(joined.map((row) => [row.assignmentId, row.category, row.rawCategory])).toEqual([
            ['1', 'Attendance / Participation', '_attendance_raw'],
            ['2', 'Labs', '_labs_raw'],
            ['3', 'Projects', '_projects_raw'],
            ['7', 'Labs', 'Labs'],
            ['8', 'Labs', 'Labs'],
            ['9', 'Labs', 'Labs'],
        ]);
    });

    test('unpublished assignments require real submission evidence to appear', () => {
        const unpublished = catalogRow(10, {
            assignment_name: 'Unpublished retake',
            is_published: false,
            due_at: PAST_DUE,
        });

        expect(joinAssignmentCatalogWithEvidence([unpublished], [], { now: NOW })).toEqual([]);
        expect(joinAssignmentCatalogWithEvidence([unpublished], [{
            assignment_pk: '10',
            submission_pk: 'submission-10',
            submission_status: 'submitted',
            total_score: 9,
        }], { now: NOW })).toMatchObject([{
            assignmentId: '10',
            evidenceStatus: ASSIGNMENT_EVIDENCE_STATUS.SUBMITTED,
            score: 9,
        }]);
    });

    test('catalog endpoint helper uses the same visibility contract and stable error state', async () => {
        const pool = {
            query: jest.fn().mockResolvedValue({
                rows: [
                    catalogRow(1, { category: '_labs_raw', assignment_name: 'Lab 1' }),
                    catalogRow(2, { external_assignment_id: 'labs_rollup:1', assignment_name: 'Labs' }),
                ],
            }),
        };
        const catalog = await queryCourseAssignmentCatalog(pool, 'gs-1');
        const response = buildCourseAssignmentCatalogResponse(catalog);
        expect(response).toMatchObject({
            basis: 'assignment_catalog',
            catalogCount: 1,
            assignments: { Labs: { 'Lab 1': 10 } },
        });
        expect(response.catalog[0]).toMatchObject({ category: 'Labs', rawCategory: '_labs_raw' });

        const failedPool = { query: jest.fn().mockRejectedValue(new Error('database unavailable')) };
        await expect(queryStudentAssignmentEvidence(failedPool, {
            email: 'student@example.edu',
        })).rejects.toMatchObject({
            code: 'ASSIGNMENT_EVIDENCE_REQUEST_ERROR',
            status: 503,
        });
        expect(assignmentEvidenceRequestError(new Error('timeout'))).toMatchObject({
            evidenceStatus: 'request_error',
            code: 'ASSIGNMENT_EVIDENCE_REQUEST_ERROR',
        });
    });

    test('query builder is course scoped and parameterized', () => {
        const query = buildStudentAssignmentEvidenceQuery('student@example.edu', 'course-1');
        expect(query.values).toEqual(['student@example.edu', 'course-1']);
        expect(query.text).toContain('c.id::text = $2');
        expect(query.text).toContain('s.student_id = st.id');
        expect(query.text).toContain('a.is_published');
    });
});
