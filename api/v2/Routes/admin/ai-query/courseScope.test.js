import {
    COURSE_SCOPE_PREDICATE,
    addLiveCourseSource,
    assertCourseScopedSql,
    normalizeCourseId,
} from './courseScope.js';

describe('AI query course scope', () => {
    it('normalizes a single course id and rejects ambiguous values', () => {
        expect(normalizeCourseId(' 884422 ')).toBe('884422');
        expect(normalizeCourseId(['course-a', 'course-b'])).toBe('');
    });

    it('requires both internal and Gradescope course matching via parameter $1', () => {
        const sql = `
            SELECT a.id
            FROM assignments a
            JOIN courses c ON c.id = a.course_id
            WHERE ${COURSE_SCOPE_PREDICATE}
        `;

        expect(assertCourseScopedSql(sql)).toBe(true);
        expect(() => assertCourseScopedSql('SELECT * FROM assignments'))
            .toThrow('scoped to the selected course');
    });

    it('marks successful payloads as live data from the requested course', () => {
        expect(addLiveCourseSource({ answer: 'ok' }, ' course-a ')).toEqual({
            answer: 'ok',
            source: { type: 'live_course', course_id: 'course-a' },
        });
    });
});
