import {
    buildEnrolledCourseRosterQuery,
    enrolledRosterToLegacyPairs,
    mergeEnrolledRosterWithScoreRows,
    normalizeEnrolledRosterRows,
    queryEnrolledCourseRoster,
    queryRosterBackedStudentScores,
} from '../lib/courseRoster.mjs';
import { buildStudentsRosterResponse } from '../v2/Routes/students/rosterResponse.mjs';

function demoRosterRows(count = 32) {
    return Array.from({ length: count }, (_unused, index) => ({
        student_id: String(index + 1),
        sid: `SID${String(index + 1).padStart(3, '0')}`,
        student_email: `student${index + 1}@example.edu`,
        student_name: `Student ${index + 1}`,
        course_id: '10',
        gradescope_course_id: 'demo-cs10',
        course_name: 'Demo CS 10',
    }));
}

function emailSet(students = []) {
    return new Set(students.map((student) => (
        Array.isArray(student) ? student[1] : student.email
    )));
}

describe('enrolled roster authority', () => {
    test('roster query is course scoped and never depends on submissions', () => {
        const query = buildEnrolledCourseRosterQuery('demo-cs10');
        expect(query.values).toEqual(['demo-cs10']);
        expect(query.text).toMatch(/FROM\s+students\s+st\s+JOIN\s+courses\s+c/i);
        expect(query.text).not.toMatch(/submissions/i);
        expect(query.text).toContain('c.gradescope_course_id::text = $1');
    });

    test('Demo roster keeps all 32 enrolled students, including 27 with zero submission rows', async () => {
        const joinedRows = demoRosterRows().map((student, index) => ({
            ...student,
            assignment_pk: 'assignment-1',
            external_assignment_id: 'demo:assignment:1',
            assignment_name: 'Assignment 1',
            category: '_labs_raw',
            assignment_max_points: 10,
            assignment_metadata: {},
            assignment_last_synced_at: '2026-07-08T12:00:00.000Z',
            submission_pk: index < 5 ? `submission-${index + 1}` : null,
            submission_status: index < 5 ? 'submitted' : null,
            total_score: index < 5 ? index : null,
        }));
        const pool = {
            query: jest.fn().mockResolvedValue({ rows: joinedRows }),
        };

        const students = await queryRosterBackedStudentScores(pool, 'demo-cs10');
        expect(students).toHaveLength(32);
        expect(new Set(students.map((student) => student.id)).size).toBe(32);
        expect(students.filter((student) => Object.keys(student.scores).length > 0)).toHaveLength(5);
        expect(students.filter((student) => Object.keys(student.scores).length === 0)).toHaveLength(27);
        expect(students[0].scores.Labs['Assignment 1']).toBe(0);
        expect(students[31]).toMatchObject({
            id: '32',
            email: 'student32@example.edu',
            rosterSource: 'enrolled_students',
            scores: {},
        });
        expect(pool.query).toHaveBeenCalledTimes(1);
        const [queryText, params] = pool.query.mock.calls[0];
        expect(queryText).toMatch(/JOIN\s+students\s+st[\s\S]+LEFT\s+JOIN\s+assignments\s+a[\s\S]+LEFT\s+JOIN\s+submissions\s+s/i);
        expect(params).toEqual(['demo-cs10']);
    });

    test('roster endpoint, score matrix, and legacy dropdown have identical Demo membership', () => {
        const roster = normalizeEnrolledRosterRows(demoRosterRows());
        const scoreMatrix = mergeEnrolledRosterWithScoreRows(roster, []);
        const response = buildStudentsRosterResponse(roster);

        expect(roster).toHaveLength(32);
        expect(scoreMatrix).toHaveLength(32);
        expect(response.roster).toHaveLength(32);
        expect(response.students).toHaveLength(32);
        expect(emailSet(scoreMatrix)).toEqual(emailSet(roster));
        expect(emailSet(response.roster)).toEqual(emailSet(roster));
        expect(emailSet(response.students)).toEqual(emailSet(roster));
    });

    test('adding or removing score evidence cannot change roster membership or IDs', () => {
        const roster = normalizeEnrolledRosterRows(demoRosterRows());
        const expectedIds = roster.map((student) => student.id);
        const scoreRows = roster.map((student, index) => ({
            student_id: student.id,
            course_id: student.courseId,
            category: 'Labs',
            assignment_name: `Lab ${index + 1}`,
            total_score: index,
        }));

        for (let size = 0; size <= scoreRows.length; size += 1) {
            const merged = mergeEnrolledRosterWithScoreRows(roster, scoreRows.slice(0, size));
            expect(merged).toHaveLength(32);
            expect(merged.map((student) => student.id)).toEqual(expectedIds);
        }
    });

    test('canonical identity is course+student and retains records the legacy email adapter cannot represent', () => {
        const roster = normalizeEnrolledRosterRows([
            ...demoRosterRows(2),
            {
                student_id: '1',
                sid: 'SID001-B',
                student_email: 'student1@example.edu',
                student_name: 'Student 1 other course',
                course_id: '20',
                gradescope_course_id: 'other-course',
                course_name: 'Other Course',
            },
            {
                student_id: '99',
                sid: 'SID099',
                student_email: null,
                student_name: 'No Email',
                course_id: '20',
                gradescope_course_id: 'other-course',
                course_name: 'Other Course',
            },
        ]);
        expect(roster).toHaveLength(4);
        expect(roster.filter((student) => student.email === 'student1@example.edu')).toHaveLength(2);
        expect(roster.filter((student) => student.email == null)).toHaveLength(1);

        const legacy = enrolledRosterToLegacyPairs(roster);
        expect(legacy).toEqual([
            ['Student 1', 'student1@example.edu'],
            ['Student 2', 'student2@example.edu'],
        ]);
        expect(buildStudentsRosterResponse(roster)).toMatchObject({
            rosterSource: 'enrolled_students',
            rosterCount: 4,
            roster,
            students: legacy,
        });
    });

    test('queryEnrolledCourseRoster returns the same normalized membership contract', async () => {
        const pool = { query: jest.fn().mockResolvedValue({ rows: demoRosterRows() }) };
        const roster = await queryEnrolledCourseRoster(pool, 'demo-cs10');
        expect(roster).toHaveLength(32);
        expect(roster.every((student) => student.rosterSource === 'enrolled_students')).toBe(true);
        expect(pool.query.mock.calls[0][1]).toEqual(['demo-cs10']);
    });
});
