import {
    SemanticQueryError,
    compileSemanticQuery,
    getSemanticCatalog,
    planNaturalLanguageQuery,
} from './semanticQuery.js';

describe('semantic course analytics', () => {
    it('publishes only supported read-only views and fields', () => {
        const catalog = getSemanticCatalog();
        expect(Object.keys(catalog.views)).toEqual(expect.arrayContaining([
            'students',
            'assignments',
            'categories',
            'submissions',
            'daily_activity',
            'course_summary',
        ]));
        expect(catalog.views.students.fields).not.toHaveProperty('email');
        expect(catalog.max_limit).toBe(100);
    });

    it('compiles selected fields, filters, and ordering with bound values', () => {
        const execution = compileSemanticQuery({
            view: 'students',
            select: ['student_name', 'average_score'],
            filters: [{ field: 'average_score', operator: 'lt', value: 60 }],
            order_by: [{ field: 'average_score', direction: 'asc' }],
            limit: 10,
        }, ' course-a ');

        expect(execution.values).toEqual(['course-a', 60]);
        expect(execution.text).toContain('(c.id::text = $1 OR c.gradescope_course_id::text = $1)');
        expect(execution.text).toContain('WHERE average_score < $2');
        expect(execution.text).toContain('ORDER BY average_score ASC NULLS LAST');
        expect(execution.text).toContain('LIMIT 10');
        expect(execution.text).not.toContain('course-a');
    });

    it('caps result size and parameterizes category lists', () => {
        const execution = compileSemanticQuery({
            view: 'categories',
            filters: [{ field: 'category', operator: 'in', value: ['Projects', 'Exams'] }],
            limit: 1000,
        }, '1329547');

        expect(execution.values).toEqual(['1329547', 'Projects', 'Exams']);
        expect(execution.text).toContain('category IN ($2, $3)');
        expect(execution.text).toContain('LIMIT 100');
    });

    it.each([
        [{ view: 'students', select: ['email'] }, 'Unsupported select field'],
        [{ view: 'students', filters: [{ field: 'average_score; DROP TABLE students', operator: 'gt', value: 0 }] }, 'Unsupported filter field'],
        [{ view: 'students', order_by: [{ field: 'average_score', direction: 'sideways' }] }, 'Unsupported order direction'],
        [{ view: 'unknown' }, 'Unknown analytics view'],
    ])('rejects invalid or injectable spec %#', (spec, message) => {
        expect(() => compileSemanticQuery(spec, 'course-a')).toThrow(message);
        expect(() => compileSemanticQuery(spec, 'course-a')).toThrow(SemanticQueryError);
    });

    it.each([
        ['Find students with the highest grade fluctuation', 'students', 'score_stddev'],
        ['Which assignments are the hardest?', 'assignments', 'average_score'],
        ["Show all students' average scores", 'students', 'student_name'],
        ['Find assignments with latest submission times', 'assignments', 'latest_submission_at'],
        ['Compare average scores of Projects and Exams', 'categories', 'category'],
        ["Show this semester's statistics", 'course_summary', null],
        ['Find students with scores below 60', 'students', 'average_score'],
        ['Submission activity in the last week', 'daily_activity', 'activity_date'],
        ['Which student has the most assignments?', 'students', 'assignment_count'],
        ['View top 10 students by grade', 'students', 'average_score'],
    ])('maps the UI example %s', (question, expectedView, expectedField) => {
        const spec = planNaturalLanguageQuery(question, new Date('2026-07-14T12:00:00Z'));
        expect(spec.view).toBe(expectedView);
        if (expectedField) expect(JSON.stringify(spec)).toContain(expectedField);
        expect(() => compileSemanticQuery(spec, '1329547')).not.toThrow();
    });
});
