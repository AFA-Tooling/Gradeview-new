import {
    COURSE_QUERY_PLAN_ID,
    addLiveCourseSource,
    approveGeneratedCourseSql,
    buildCourseScopedExecution,
    buildGeneratedCourseScopedExecution,
    getCourseScopedQueryPlan,
    normalizeCourseId,
} from './courseScope.js';

describe('AI query course scope', () => {
    const approved = getCourseScopedQueryPlan(COURSE_QUERY_PLAN_ID.COURSE_OVERVIEW).sql.trim();

    it('normalizes one course id and rejects ambiguous values', () => {
        expect(normalizeCourseId(' 884422 ')).toBe('884422');
        expect(normalizeCourseId(['course-a', 'course-b'])).toBe('');
    });

    it('binds a server-owned rule plan to exactly one $1 course value', () => {
        const execution = buildCourseScopedExecution(
            COURSE_QUERY_PLAN_ID.SCORE_STATISTICS,
            ' course-a ',
        );

        expect(execution.values).toEqual(['course-a']);
        expect(execution.text).toContain('c.id::text = $1');
        expect(execution.text).toContain('c.gradescope_course_id::text = $1');
        expect(execution.text).not.toMatch(/\$2\b/);
    });

    it.each([
        COURSE_QUERY_PLAN_ID.STUDENT_VARIANCE,
        COURSE_QUERY_PLAN_ID.COURSE_OVERVIEW,
    ])('%s constrains student identity to the already authorized course join', (planId) => {
        const plan = getCourseScopedQueryPlan(planId);
        expect(plan.sql).toContain('JOIN students s ON s.id = sub.student_id AND s.course_id = c.id');
    });

    it('re-resolves generated SQL to a trusted plan before binding course scope', () => {
        const execution = buildGeneratedCourseScopedExecution(approved, 'course-b');

        expect(execution.planId).toBe(COURSE_QUERY_PLAN_ID.COURSE_OVERVIEW);
        expect(execution.text).toBe(getCourseScopedQueryPlan(execution.planId).sql);
        expect(execution.values).toEqual(['course-b']);
        expect(approveGeneratedCourseSql(approved).id).toBe(execution.planId);
    });

    it.each([
        ['comment', `${approved} -- predicate is present`],
        ['union', `${approved} UNION SELECT * FROM students`],
        ['OR tautology', approved.replace('WHERE (c.id::text = $1 OR c.gradescope_course_id::text = $1)', 'WHERE (c.id::text = $1 OR c.gradescope_course_id::text = $1 OR TRUE)')],
        ['unused scoped CTE', `WITH scoped AS (SELECT 1 FROM courses c WHERE (c.id::text = $1 OR c.gradescope_course_id::text = $1)) SELECT * FROM students`],
        ['subquery escape', `SELECT * FROM (${approved}) scoped CROSS JOIN students`],
        ['second statement', `${approved}; SELECT * FROM students`],
        ['second course parameter', approved.replace(/\$1/g, '$2')],
        ['multiple course parameters', approved.replace('c.gradescope_course_id::text = $1', 'c.gradescope_course_id::text = $2')],
    ])('rejects %s bypass text before execution', (_, sql) => {
        expect(() => buildGeneratedCourseScopedExecution(sql, 'course-a'))
            .toThrow('approved course-scoped query plan');
    });

    it('marks successful payloads as live data from the requested course', () => {
        expect(addLiveCourseSource({ answer: 'ok' }, ' course-a ')).toEqual({
            answer: 'ok',
            source: { type: 'live_course', course_id: 'course-a' },
        });
    });
});
