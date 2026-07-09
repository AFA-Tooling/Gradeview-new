export const COURSE_SCOPE_PREDICATE = '(c.id::text = $1 OR c.gradescope_course_id::text = $1)';

export function normalizeCourseId(value) {
    if (Array.isArray(value) || value === null || value === undefined) return '';
    return String(value).trim();
}

export function createLiveCourseSource(courseId) {
    const normalized = normalizeCourseId(courseId);
    if (!normalized) {
        throw new Error('course_id is required');
    }
    return {
        type: 'live_course',
        course_id: normalized,
    };
}

export function addLiveCourseSource(result, courseId) {
    return {
        ...result,
        source: createLiveCourseSource(courseId),
    };
}

export function assertCourseScopedSql(sql) {
    const normalized = String(sql || '').replace(/\s+/g, ' ').toLowerCase();
    const usesCourseJoin = /\bjoin courses c\b/.test(normalized);
    const usesInternalId = /\bc\.id::text\s*=\s*\$1\b/.test(normalized);
    const usesExternalId = /\bc\.gradescope_course_id::text\s*=\s*\$1\b/.test(normalized);

    if (!usesCourseJoin || !usesInternalId || !usesExternalId) {
        throw new Error('AI query must be scoped to the selected course with parameter $1');
    }
    return true;
}
