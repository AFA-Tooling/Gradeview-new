jest.mock('../lib/dbHelper.mjs', () => ({
    getPool: jest.fn(),
    getEnrolledCourseRoster: jest.fn(),
    getStaffCourses: jest.fn(),
    getStudentCourses: jest.fn(),
    getStudentAssignmentEvidence: jest.fn(),
    getStudentExamComponentTrends: jest.fn(),
    getStudentExamPolicyScores: jest.fn(),
    getStudentGradeFlow: jest.fn(),
    getStudentPolicySummaries: jest.fn(),
    getCategoryAverages: jest.fn(),
    studentEnrolledInCourse: jest.fn(),
    getStudentProjectionInputs: jest.fn(),
    getCourseProjectionConfig: jest.fn(),
    getStudentConceptStructure: jest.fn(),
    getStudentQuestComponentTrend: jest.fn(),
}));

jest.mock('../lib/authlib.mjs', () => ({
    validateAdminOrStudentMiddleware: (_req, _res, next) => next(),
    validateStaffOrAdminMiddleware: (_req, _res, next) => next(),
    validateStudentSelfOrStaffOrAdminMiddleware: (_req, _res, next) => next(),
}));

import adminAssignmentsRouter from '../v2/Routes/admin/assignments/index.js';
import { buildAdminAssignmentsRouteResponse } from '../v2/Routes/admin/assignments/assignmentsResponse.mjs';
import studentsRouter from '../v2/Routes/students/index.js';
import { buildStudentsRosterResponse } from '../v2/Routes/students/rosterResponse.mjs';
import studentGradesRouter from '../v2/Routes/students/grades/index.js';
import { buildStudentGradesRouteResponse } from '../v2/Routes/students/grades/gradesResponse.mjs';
import studentProfileRouter from '../v2/Routes/students/profile/index.js';
import { buildStudentProfileRouteResponse } from '../v2/Routes/students/profile/profileResponse.mjs';

function hasRoute(router, path) {
    return Array.isArray(router?.stack)
        && router.stack.some((layer) => layer?.route?.path === path);
}

const EVIDENCE = [{
    schemaVersion: '1.0',
    basis: 'assignment_evidence',
    assignmentId: 'assignment-1',
    externalAssignmentId: 'external-1',
    category: 'Labs',
    rawCategory: 'Labs',
    name: 'Lab 1',
    maxPoints: 10,
    evidenceStatus: 'earned_zero',
    score: 0,
    recordedScore: 0,
    percentage: 0,
    submitted: true,
    hasSourceRecord: true,
    hasUsableSubmission: true,
    hasSubmissionEvidence: true,
    submissionStatus: 'submitted',
    submissionTime: '2026-07-01T12:00:00.000Z',
    dueAt: '2026-06-30T12:00:00.000Z',
    dueState: 'past_due',
    sourceSyncStatus: 'synced',
    applicable: true,
    requestError: null,
}];

describe('production route response wiring smoke', () => {
    test('all four modified production routers load and register their GET endpoint', () => {
        expect(hasRoute(studentProfileRouter, '/')).toBe(true);
        expect(hasRoute(studentGradesRouter, '/')).toBe(true);
        expect(hasRoute(adminAssignmentsRouter, '/')).toBe(true);
        expect(hasRoute(studentsRouter, '/')).toBe(true);
    });

    test('profile payload assembly exposes the exact canonical due-work namespace', () => {
        const dueWorkProgress = {
            basis: 'due_work_progress',
            status: 'partial',
            catalogCount: 1,
            statusCounts: { earned_zero: 1 },
            categories: {},
        };
        const canonicalGrade = {
            basis: 'policy_final',
            exactScore: 319.67,
            displayScore: 320,
            cap: 400,
            categories: {},
            dueWorkProgress,
        };
        const rawGrades = {
            basis: 'assignment_evidence',
            catalogCount: 1,
            submissions: EVIDENCE,
        };

        const response = buildStudentProfileRouteResponse({
            courseId: 'demo-cs10',
            canonicalGrade,
            groupedSubmissions: { Labs: { 'Lab 1': { student: 0, max: 10 } } },
            rawGrades,
            categoryAverages: { Labs: 80 },
            bins: { total_points_cap: 400 },
            policyRows: [{ examType: 'quest' }],
            examComponentTrends: { quest: { series: [] } },
            profileSummary: { email: 'student@example.edu' },
            categoryBlocks: [{ key: 'labs' }],
            gradeFlow: null,
        });

        expect(response).toMatchObject({
            courseId: 'demo-cs10',
            canonicalGrade,
            dueWorkProgress,
            rawGrades: {
                basis: 'assignment_evidence',
                catalogCount: 1,
                sortBy: 'time',
            },
            examPolicy: { total: 1 },
        });
        expect(response.dueWorkProgress).toBe(response.canonicalGrade.dueWorkProgress);
        expect(response.dueWorkProgress).toBe(dueWorkProgress);
        expect(() => JSON.stringify(response)).not.toThrow();
    });

    test('grades route builder preserves true zero in time and grouped response shapes', () => {
        const timeResponse = buildStudentGradesRouteResponse(EVIDENCE, 'time');
        expect(timeResponse).toMatchObject({
            basis: 'assignment_evidence',
            catalogCount: 1,
            sortBy: 'time',
            statusCounts: { earned_zero: 1 },
        });
        expect(timeResponse.submissions[0].score).toBe(0);

        const groupedResponse = buildStudentGradesRouteResponse(EVIDENCE, null);
        expect(groupedResponse.Labs['Lab 1']).toMatchObject({
            student: 0,
            max: 10,
            evidenceStatus: 'earned_zero',
        });
    });

    test('admin assignments route builder selects legacy and metadata response shapes', () => {
        const catalog = [{
            schemaVersion: '1.0',
            basis: 'assignment_catalog',
            assignmentId: 'assignment-1',
            externalAssignmentId: 'external-1',
            category: 'Labs',
            rawCategory: '_labs_raw',
            name: 'Lab 1',
            maxPoints: 10,
            dueAt: null,
            releaseAt: null,
            dueState: 'due_unknown',
            sourceSyncStatus: 'synced',
        }];
        const legacy = buildAdminAssignmentsRouteResponse(catalog, false);
        expect(legacy.body).toEqual({ Labs: { 'Lab 1': 10 } });
        expect(legacy.catalogResponse.catalogCount).toBe(1);

        const metadata = buildAdminAssignmentsRouteResponse(catalog, true);
        expect(metadata.body).toBe(metadata.catalogResponse);
        expect(metadata.body.catalog[0]).toMatchObject({
            assignmentId: 'assignment-1',
            rawCategory: '_labs_raw',
        });
    });

    test('students route builder keeps canonical roster and legacy dropdown in one response', () => {
        const roster = [{
            id: 'student-1',
            name: 'Student One',
            email: 'student@example.edu',
            courseId: 'course-1',
            rosterSource: 'enrolled_students',
        }];
        expect(buildStudentsRosterResponse(roster)).toEqual({
            rosterSource: 'enrolled_students',
            rosterCount: 1,
            roster,
            students: [['Student One', 'student@example.edu']],
        });
    });
});
