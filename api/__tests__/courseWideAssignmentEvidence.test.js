import {
    ASSIGNMENT_EVIDENCE_STATUS,
    buildCourseWideAssignmentEvidenceGroups,
    buildCourseWideAssignmentEvidenceQuery,
    queryCourseWideAssignmentEvidence,
} from '../lib/assignmentEvidence.mjs';
import { queryRosterBackedStudentScores } from '../lib/courseRoster.mjs';

const NOW = Date.parse('2026-07-09T12:00:00.000Z');
const PAST_DUE = '2026-07-01T12:00:00.000Z';
const FUTURE_DUE = '2026-07-20T12:00:00.000Z';
const SYNCED_AT = '2026-07-08T12:00:00.000Z';

function demoCatalog() {
    const categories = [
        ...Array.from({ length: 6 }, () => 'Attendance / Participation'),
        ...Array.from({ length: 8 }, () => 'Labs'),
        ...Array.from({ length: 5 }, () => 'Projects'),
        ...Array.from({ length: 3 }, () => 'Quest'),
        'Midterm',
        'Postterm',
    ];
    return categories.map((category, index) => ({
        assignment_pk: String(index + 1),
        external_assignment_id: `demo:assignment:${index + 1}`,
        assignment_name: index === 8 || index === 9 ? 'Duplicate Visible Title' : `Assignment ${index + 1}`,
        category,
        assignment_max_points: 10,
        assignment_metadata: index === 5
            ? { not_applicable_students: ['student1@example.edu'] }
            : (index === 6
                ? { source_sync_status: 'request_error', request_error: 'source timeout' }
                : {}),
        assignment_last_synced_at: index === 4 ? null : SYNCED_AT,
        exam_due_at: index === 2 ? FUTURE_DUE : (index === 3 ? null : PAST_DUE),
        exam_release_at: null,
    }));
}

function demoMatrixRows(studentCount = 32) {
    const catalog = demoCatalog();
    const rows = [];

    for (let studentIndex = 0; studentIndex < studentCount; studentIndex += 1) {
        const studentNumber = studentIndex + 1;
        catalog.forEach((assignment, assignmentIndex) => {
            const row = {
                student_id: String(studentNumber),
                student_sid: `SID${String(studentNumber).padStart(3, '0')}`,
                student_email: `student${studentNumber}@example.edu`,
                student_name: `Student ${studentNumber}`,
                course_id: '10',
                gradescope_course_id: 'demo-cs10',
                course_name: 'Demo CS 10',
                semester: 'Spring',
                year: '2026',
                course_last_synced_at: SYNCED_AT,
                ...assignment,
                submission_pk: null,
                submission_status: null,
                total_score: null,
                submission_max_points: null,
                submission_id: null,
                submission_time: null,
                submission_count: 0,
                request_error: assignmentIndex === 6 ? 'source timeout' : null,
            };

            if (studentIndex === 0 && assignmentIndex === 0) {
                Object.assign(row, {
                    submission_pk: 'submission-earned-zero',
                    submission_status: 'submitted',
                    total_score: 0,
                    submission_max_points: 10,
                    submission_id: 'external-earned-zero',
                    submission_time: '2026-06-30T12:00:00.000Z',
                    submission_count: 1,
                });
            }
            if (studentIndex === 0 && assignmentIndex === 7) {
                Object.assign(row, {
                    submission_pk: 'submission-positive',
                    submission_status: 'submitted',
                    total_score: 8,
                    submission_max_points: 10,
                    submission_id: 'external-positive',
                    submission_time: '2026-06-30T13:00:00.000Z',
                    submission_count: 1,
                });
            }
            rows.push(row);
        });
        rows.push({
            student_id: String(studentNumber),
            student_sid: `SID${String(studentNumber).padStart(3, '0')}`,
            student_email: `student${studentNumber}@example.edu`,
            student_name: `Student ${studentNumber}`,
            course_id: '10',
            gradescope_course_id: 'demo-cs10',
            course_name: 'Demo CS 10',
            assignment_pk: 'hidden-rollup',
            external_assignment_id: 'labs_rollup:total',
            assignment_name: 'Labs',
            category: 'Labs',
            assignment_max_points: 80,
            assignment_metadata: {},
            assignment_last_synced_at: SYNCED_AT,
            submission_pk: null,
            total_score: null,
        });
    }

    rows.push({
        student_id: 'other-student',
        student_sid: 'OTHER',
        student_email: 'other@example.edu',
        student_name: 'Other Student',
        course_id: '20',
        gradescope_course_id: 'other-course',
        course_name: 'Other Course',
        assignment_pk: 'other-assignment',
        external_assignment_id: 'other:assignment',
        assignment_name: 'Other Assignment',
        category: 'Labs',
        assignment_max_points: 10,
        assignment_metadata: {},
        assignment_last_synced_at: SYNCED_AT,
        exam_due_at: PAST_DUE,
        submission_pk: 'other-submission',
        submission_status: 'submitted',
        total_score: 10,
    });

    return rows;
}

function sumCounts(counts = {}) {
    return Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
}

describe('course-wide assignment evidence query contract', () => {
    test('query is parameterized, course constrained, and uses one roster×catalog LEFT JOIN', () => {
        const query = buildCourseWideAssignmentEvidenceQuery('demo-cs10');
        expect(query.values).toEqual(['demo-cs10']);
        expect(query.text).toMatch(/FROM\s+courses\s+c[\s\S]+JOIN\s+students\s+st/i);
        expect(query.text).toMatch(/LEFT\s+JOIN\s+assignments\s+a[\s\S]+a\.course_id\s*=\s*st\.course_id/i);
        expect(query.text).toMatch(/LEFT\s+JOIN\s+submissions\s+s[\s\S]+s\.assignment_id\s*=\s*a\.id[\s\S]+s\.student_id\s*=\s*st\.id/i);
        expect(query.text).toMatch(/c\.id::text\s*=\s*\$1[\s\S]+c\.gradescope_course_id::text\s*=\s*\$1/i);

        expect(() => buildCourseWideAssignmentEvidenceQuery(null)).toThrow(expect.objectContaining({
            code: 'COURSE_SCOPE_REQUIRED',
            status: 400,
        }));
    });

    test.each([1, 32, 64])('production query count stays one for %i enrolled students', async (studentCount) => {
        const pool = { query: jest.fn().mockResolvedValue({ rows: demoMatrixRows(studentCount) }) };
        const groups = await queryCourseWideAssignmentEvidence(pool, {
            courseId: 'demo-cs10',
            now: NOW,
        });

        expect(pool.query).toHaveBeenCalledTimes(1);
        expect(groups).toHaveLength(studentCount);
        expect(groups.every((student) => student.assignmentEvidence.length === 24)).toBe(true);
        expect(groups.reduce((sum, student) => sum + student.assignmentEvidence.length, 0)).toBe(studentCount * 24);
    });

    test('Demo 32×24 matrix preserves IDs, all explicit states, zero-submission students, and course isolation', async () => {
        const pool = { query: jest.fn().mockResolvedValue({ rows: demoMatrixRows(32) }) };
        const students = await queryRosterBackedStudentScores(pool, 'demo-cs10', { now: NOW });

        expect(pool.query).toHaveBeenCalledTimes(1);
        expect(students).toHaveLength(32);
        expect(students).toHaveLength(new Set(students.map((student) => student.email)).size);
        expect(students.some((student) => student.email === 'other@example.edu')).toBe(false);
        expect(students.every((student) => student.assignmentEvidence.length === 24)).toBe(true);
        expect(students.every((student) => student.assignmentEvidenceSummary.catalogCount === 24)).toBe(true);
        expect(students.every((student) => sumCounts(student.assignmentEvidenceSummary.statusCounts) === 24)).toBe(true);

        const first = students[0];
        expect(first.assignmentEvidence.map((assignment) => assignment.assignmentId)).toHaveLength(24);
        expect(new Set(first.assignmentEvidence.map((assignment) => assignment.assignmentId)).size).toBe(24);
        expect(first.assignmentEvidence.filter((assignment) => assignment.name === 'Duplicate Visible Title')).toHaveLength(2);
        expect(first.assignmentEvidence.map((assignment) => assignment.evidenceStatus)).toEqual(expect.arrayContaining([
            ASSIGNMENT_EVIDENCE_STATUS.EARNED_ZERO,
            ASSIGNMENT_EVIDENCE_STATUS.SUBMITTED,
            ASSIGNMENT_EVIDENCE_STATUS.MISSING,
            ASSIGNMENT_EVIDENCE_STATUS.NOT_DUE,
            ASSIGNMENT_EVIDENCE_STATUS.DUE_UNKNOWN,
            ASSIGNMENT_EVIDENCE_STATUS.NOT_SYNCED,
            ASSIGNMENT_EVIDENCE_STATUS.NOT_APPLICABLE,
            ASSIGNMENT_EVIDENCE_STATUS.REQUEST_ERROR,
        ]));
        expect(first.assignmentEvidence[0]).toMatchObject({
            evidenceStatus: 'earned_zero',
            score: 0,
            recordedScore: 0,
        });
        expect(first.assignmentEvidence[1]).toMatchObject({
            evidenceStatus: 'missing',
            score: null,
            recordedScore: null,
        });
        expect(first.assignmentEvidence.find((assignment) => assignment.assignmentId === '3')).toMatchObject({
            evidenceStatus: 'not_due',
            score: null,
            dueState: 'not_due',
        });
        expect(first.assignmentEvidence.find((assignment) => assignment.assignmentId === '4')).toMatchObject({
            evidenceStatus: 'due_unknown',
            score: null,
            dueAt: null,
        });
        expect(first.assignmentEvidence.find((assignment) => assignment.assignmentId === '5')).toMatchObject({
            evidenceStatus: 'not_synced',
            sourceSyncStatus: 'not_synced',
        });
        expect(first.assignmentEvidence.find((assignment) => assignment.assignmentId === '6')).toMatchObject({
            evidenceStatus: 'not_applicable',
            applicable: false,
        });
        expect(first.assignmentEvidence.find((assignment) => assignment.assignmentId === '7')).toMatchObject({
            evidenceStatus: 'request_error',
            sourceSyncStatus: 'request_error',
            requestError: 'source timeout',
        });
        expect(first.scores['Attendance / Participation']['Assignment 1']).toBe(0);

        const zeroSubmissionStudent = students[31];
        expect(zeroSubmissionStudent.scores).toEqual({});
        expect(zeroSubmissionStudent.assignmentEvidence).toHaveLength(24);
        expect(zeroSubmissionStudent.assignmentEvidence.every((assignment) => assignment.hasSourceRecord === false)).toBe(true);
        expect(Object.keys(zeroSubmissionStudent.assignmentEvidenceSummary.statusCounts)).toEqual(
            Object.values(ASSIGNMENT_EVIDENCE_STATUS),
        );
    });

    test('pure grouping defensively drops rows outside either accepted course identifier', () => {
        const groups = buildCourseWideAssignmentEvidenceGroups(demoMatrixRows(2), {
            courseId: '10',
            now: NOW,
        });
        expect(groups).toHaveLength(2);
        expect(groups.every((student) => student.courseId === '10')).toBe(true);
        expect(groups.flatMap((student) => student.assignmentEvidence).some((row) => (
            row.assignmentId === 'other-assignment'
        ))).toBe(false);
    });
});
