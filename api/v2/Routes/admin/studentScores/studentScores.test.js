jest.mock('../../../../lib/dbHelper.mjs', () => ({
    getAllStudentPolicySummaries: jest.fn(),
    getAllStudentScores: jest.fn(),
    getAssignmentDistribution: jest.fn(),
    getCategorySummaryDistribution: jest.fn(),
    getStudentPolicySummaries: jest.fn(),
}));

import {
    getAllStudentPolicySummaries,
    getAllStudentScores,
    getStudentPolicySummaries,
} from '../../../../lib/dbHelper.mjs';
import router, {
    buildStudentsWithSummary,
    createStudentScoresListHandler,
} from './index.js';

const STATUS_CYCLE = [
    'earned_zero',
    'submitted',
    'missing',
    'not_due',
    'due_unknown',
    'not_synced',
    'not_applicable',
    'request_error',
];

const CANONICAL_CATEGORIES = {
    attendance: { exactScore: 15, cap: 15 },
    labs: { exactScore: 64.5, cap: 80 },
    projects: { exactScore: 141, cap: 155 },
};

function canonicalGrade() {
    return {
        basis: 'policy_final',
        status: 'complete',
        exactScore: 319.67,
        displayScore: 320,
        cap: 400,
        percentage: 79.9175,
        letter: 'B-',
        categories: CANONICAL_CATEGORIES,
        rawEvidence: { basis: 'raw_evidence', status: 'not_aggregated' },
        dueWorkProgress: { basis: 'due_work_progress', status: 'not_aggregated' },
    };
}

function assignmentEvidence(studentNumber) {
    return Array.from({ length: 24 }, (_unused, index) => {
        const evidenceStatus = STATUS_CYCLE[index % STATUS_CYCLE.length];
        const scored = evidenceStatus === 'earned_zero' || evidenceStatus === 'submitted';
        return {
            schemaVersion: '1.0',
            basis: 'assignment_evidence',
            assignmentId: `assignment-${index + 1}`,
            externalAssignmentId: `demo:assignment:${index + 1}`,
            category: index < 8 ? 'Labs' : 'Projects',
            rawCategory: index < 8 ? 'Labs' : 'Projects',
            name: `Assignment ${index + 1}`,
            maxPoints: 10,
            evidenceStatus,
            score: evidenceStatus === 'earned_zero' ? 0 : (evidenceStatus === 'submitted' ? 8 : null),
            recordedScore: evidenceStatus === 'earned_zero' ? 0 : (evidenceStatus === 'submitted' ? 8 : null),
            submitted: scored,
            hasSourceRecord: scored,
            hasUsableSubmission: scored,
            hasSubmissionEvidence: scored,
            dueState: evidenceStatus === 'not_due' ? 'not_due' : 'past_due',
            sourceSyncStatus: evidenceStatus === 'not_synced' ? 'not_synced' : 'synced',
            applicable: evidenceStatus !== 'not_applicable',
            requestError: evidenceStatus === 'request_error' ? 'source timeout' : null,
            student: {
                id: String(studentNumber),
                email: `student${studentNumber}@example.edu`,
            },
            course: { id: '10', gradescopeCourseId: 'demo-cs10' },
        };
    });
}

function rosterStudents(count = 32) {
    return Array.from({ length: count }, (_unused, index) => {
        const studentNumber = index + 1;
        const evidence = assignmentEvidence(studentNumber);
        return {
            id: String(studentNumber),
            sid: `SID${String(studentNumber).padStart(3, '0')}`,
            name: `Student ${studentNumber}`,
            email: `student${studentNumber}@example.edu`,
            courseId: '10',
            gradescopeCourseId: 'demo-cs10',
            rosterSource: 'enrolled_students',
            scores: index === 0 ? { Labs: { 'Assignment 1': 0 } } : {},
            assignmentEvidence: evidence,
            assignmentEvidenceSummary: {
                schemaVersion: '1.0',
                basis: 'assignment_evidence',
                catalogCount: 24,
                catalogIds: evidence.map((row) => row.assignmentId),
                statusCounts: Object.fromEntries(STATUS_CYCLE.map((status) => [status, 3])),
            },
        };
    });
}

function policySummary() {
    return {
        canonicalGrade: canonicalGrade(),
        summaryByKey: {},
        summarySectionTotals: { Labs: 64.5, Projects: 141 },
        summaryTotal: 319.67,
        deprecated: {},
    };
}

function summariesForEmails(_courseId, emails = []) {
    return Promise.resolve(new Map(emails.map((email) => [email, policySummary()])));
}

function mockResponse() {
    const res = {
        statusCode: 200,
        body: null,
        status: jest.fn((statusCode) => {
            res.statusCode = statusCode;
            return res;
        }),
        json: jest.fn((body) => {
            res.body = body;
            return res;
        }),
    };
    return res;
}

function listRouteHandler() {
    const routeLayer = router.stack.find((layer) => layer?.route?.path === '/');
    return routeLayer.route.stack[0].handle;
}

describe('admin studentScores assignment-evidence production wiring', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getAllStudentScores.mockResolvedValue(rosterStudents());
        getAllStudentPolicySummaries.mockImplementation(summariesForEmails);
    });

    test('buildStudentsWithSummary batches roster emails and preserves canonical grade invariants', async () => {
        const students = rosterStudents();
        const originalCanonical = canonicalGrade();
        const originalSnapshot = JSON.parse(JSON.stringify(originalCanonical));
        const getAllImpl = jest.fn((_courseId, emails = []) => Promise.resolve(new Map(
            emails.map((email) => [email, {
                ...policySummary(),
                canonicalGrade: originalCanonical,
            }]),
        )));

        const result = await buildStudentsWithSummary(students, 'demo-cs10', {
            getAllStudentPolicySummariesImpl: getAllImpl,
        });

        expect(getAllImpl).toHaveBeenCalledTimes(1);
        expect(getAllImpl).toHaveBeenCalledWith(
            'demo-cs10',
            students.map((student) => student.email),
        );
        expect(getStudentPolicySummaries).not.toHaveBeenCalled();
        expect(result).toHaveLength(32);
        expect(result.map((student) => student.email)).toEqual(students.map((student) => student.email));

        result.forEach((student) => {
            expect(student.assignmentEvidence).toHaveLength(24);
            expect(student.assignmentEvidenceSummary.catalogCount).toBe(24);
            expect(student.canonicalGrade).toMatchObject({
                exactScore: originalCanonical.exactScore,
                displayScore: originalCanonical.displayScore,
                cap: originalCanonical.cap,
                letter: originalCanonical.letter,
                categories: originalCanonical.categories,
                rawEvidence: {
                    catalogCount: 24,
                    statusCounts: student.assignmentEvidenceSummary.statusCounts,
                },
                dueWorkProgress: {
                    catalogCount: 24,
                    statusCounts: student.assignmentEvidenceSummary.statusCounts,
                },
            });
            expect(student.dueWorkProgress).toBe(student.canonicalGrade.dueWorkProgress);
            expect(student.canonicalGrade.categories).toEqual(CANONICAL_CATEGORIES);
        });
        expect(originalCanonical).toEqual(originalSnapshot);
    });

    test('registered GET handler executes the production batch path and returns Alerts/ClassHealth roster parity', async () => {
        const students = rosterStudents();
        getAllStudentScores.mockResolvedValue(students);
        const res = mockResponse();
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

        await listRouteHandler()({ query: { course_id: 'demo-cs10' } }, res);

        consoleSpy.mockRestore();
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ dataSource: 'database', queryTime: expect.any(Number) });
        expect(res.body.students).toHaveLength(32);
        expect(new Set(res.body.students.map((student) => student.email))).toEqual(
            new Set(students.map((student) => student.email)),
        );
        expect(getAllStudentScores).toHaveBeenCalledTimes(1);
        expect(getAllStudentScores).toHaveBeenCalledWith('demo-cs10');
        expect(getAllStudentPolicySummaries).toHaveBeenCalledTimes(1);
        expect(getAllStudentPolicySummaries.mock.calls[0][1]).toHaveLength(32);
        expect(getStudentPolicySummaries).not.toHaveBeenCalled();
        expect(res.body.students[0].dueWorkProgress).toBe(
            res.body.students[0].canonicalGrade.dueWorkProgress,
        );
        expect(res.body.students[0].assignmentEvidence[0]).toMatchObject({
            evidenceStatus: 'earned_zero',
            score: 0,
        });
    });

    test('list handler preserves stable course-scope errors from the production data seam', async () => {
        const error = new Error('course_id is required');
        error.code = 'COURSE_SCOPE_REQUIRED';
        error.status = 400;
        error.details = { field: 'course_id' };
        const res = mockResponse();
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const handler = createStudentScoresListHandler({
            getAllStudentScoresImpl: jest.fn().mockRejectedValue(error),
        });

        await handler({ query: {} }, res);

        consoleSpy.mockRestore();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.body).toEqual({
            code: 'COURSE_SCOPE_REQUIRED',
            details: { field: 'course_id' },
            error: 'course_id is required',
            students: [],
        });
    });
});
