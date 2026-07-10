export const COURSE_SCOPE_PREDICATE = '(c.id::text = $1 OR c.gradescope_course_id::text = $1)';

export const COURSE_QUERY_PLAN_ID = Object.freeze({
    STUDENT_VARIANCE: 'student_variance',
    ASSIGNMENT_DIFFICULTY: 'assignment_difficulty',
    SCORE_STATISTICS: 'score_statistics',
    COURSE_OVERVIEW: 'course_overview',
});

const COURSE_QUERY_PLANS = Object.freeze({
    [COURSE_QUERY_PLAN_ID.STUDENT_VARIANCE]: Object.freeze({
        id: COURSE_QUERY_PLAN_ID.STUDENT_VARIANCE,
        sql: `
            WITH student_stats AS (
                SELECT
                    s.id,
                    s.legal_name AS name,
                    s.sid AS student_id,
                    COUNT(sub.id) AS total_submissions,
                    AVG(sub.total_score / NULLIF(sub.max_points, 0) * 100) AS avg_score,
                    STDDEV(sub.total_score / NULLIF(sub.max_points, 0) * 100) AS score_stddev
                FROM assignments a
                JOIN courses c ON c.id = a.course_id
                JOIN submissions sub ON a.id = sub.assignment_id
                JOIN students s ON s.id = sub.student_id AND s.course_id = c.id
                WHERE ${COURSE_SCOPE_PREDICATE}
                GROUP BY s.id, s.legal_name, s.sid
                HAVING COUNT(sub.id) > 0
            )
            SELECT
                name,
                student_id,
                ROUND(avg_score::numeric, 2) AS avg_score,
                ROUND(score_stddev::numeric, 2) AS variance,
                total_submissions
            FROM student_stats
            WHERE score_stddev IS NOT NULL
            ORDER BY score_stddev DESC
            LIMIT 10
        `,
    }),
    [COURSE_QUERY_PLAN_ID.ASSIGNMENT_DIFFICULTY]: Object.freeze({
        id: COURSE_QUERY_PLAN_ID.ASSIGNMENT_DIFFICULTY,
        sql: `
            SELECT
                a.title,
                a.category,
                ROUND(a.max_points::numeric, 2) AS max_points,
                COUNT(sub.id) AS submission_count,
                ROUND(AVG(sub.total_score / NULLIF(a.max_points, 0) * 100)::numeric, 2) AS avg_score_pct
            FROM assignments a
            JOIN courses c ON c.id = a.course_id
            LEFT JOIN submissions sub ON a.id = sub.assignment_id
            WHERE ${COURSE_SCOPE_PREDICATE}
              AND a.title IS NOT NULL
            GROUP BY a.id, a.title, a.category, a.max_points
            HAVING COUNT(sub.id) > 0
            ORDER BY avg_score_pct ASC
            LIMIT 10
        `,
    }),
    [COURSE_QUERY_PLAN_ID.SCORE_STATISTICS]: Object.freeze({
        id: COURSE_QUERY_PLAN_ID.SCORE_STATISTICS,
        sql: `
            WITH score_stats AS (
                SELECT
                    (sub.total_score / NULLIF(sub.max_points, 0) * 100) AS score_pct
                FROM submissions sub
                JOIN assignments a ON a.id = sub.assignment_id
                JOIN courses c ON c.id = a.course_id
                WHERE ${COURSE_SCOPE_PREDICATE}
                  AND sub.total_score IS NOT NULL
                  AND sub.max_points IS NOT NULL
                  AND sub.max_points > 0
            )
            SELECT
                ROUND(AVG(score_pct)::numeric, 2) AS mean,
                ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY score_pct)::numeric, 2) AS median,
                ROUND(STDDEV(score_pct)::numeric, 2) AS std_dev,
                ROUND(MIN(score_pct)::numeric, 2) AS min,
                ROUND(MAX(score_pct)::numeric, 2) AS max,
                COUNT(*) AS total_records
            FROM score_stats
        `,
    }),
    [COURSE_QUERY_PLAN_ID.COURSE_OVERVIEW]: Object.freeze({
        id: COURSE_QUERY_PLAN_ID.COURSE_OVERVIEW,
        sql: `
            SELECT
                COUNT(DISTINCT s.id) AS total_students,
                COUNT(DISTINCT a.id) AS total_assignments,
                COUNT(sub.id) AS total_submissions,
                ROUND(AVG(sub.total_score / NULLIF(sub.max_points, 0) * 100)::numeric, 2) AS overall_avg
            FROM assignments a
            JOIN courses c ON c.id = a.course_id
            JOIN submissions sub ON sub.assignment_id = a.id
            JOIN students s ON s.id = sub.student_id AND s.course_id = c.id
            WHERE ${COURSE_SCOPE_PREDICATE}
        `,
    }),
});

export class CourseScopeQueryError extends Error {
    constructor(reason = 'The generated query is not an approved course-scoped query plan.') {
        super(reason);
        this.name = 'CourseScopeQueryError';
        this.status = 422;
        this.code = 'AI_QUERY_SCOPE_REJECTED';
        this.reason = reason;
        this.recovery = 'Retry with a supported course analytics question or use a rule-based query.';
        this.isControlledApiError = true;
    }
}

export function normalizeCourseId(value) {
    if (Array.isArray(value) || value === null || value === undefined) return '';
    return String(value).trim();
}

export function createLiveCourseSource(courseId) {
    const normalized = normalizeCourseId(courseId);
    if (!normalized) {
        throw new CourseScopeQueryError('course_id is required for live course analytics.');
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

function normalizeSql(sql) {
    return String(sql || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

export function getCourseScopedQueryPlan(planId) {
    const plan = COURSE_QUERY_PLANS[String(planId || '')];
    if (!plan) {
        throw new CourseScopeQueryError('The requested analytics query plan is not supported.');
    }
    return plan;
}

export function listCourseScopedQueryPlans() {
    return Object.values(COURSE_QUERY_PLANS).map((plan) => ({
        id: plan.id,
        sql: plan.sql.trim(),
    }));
}

export function approveGeneratedCourseSql(sql) {
    const rawSql = String(sql || '').trim();
    if (!rawSql || rawSql.includes(';')) {
        throw new CourseScopeQueryError();
    }

    const normalized = normalizeSql(rawSql);
    const approved = Object.values(COURSE_QUERY_PLANS).find(
        (plan) => normalizeSql(plan.sql) === normalized,
    );

    if (!approved) {
        throw new CourseScopeQueryError();
    }

    return approved;
}

export function assertCourseScopedSql(sql) {
    approveGeneratedCourseSql(sql);
    return true;
}

export function buildCourseScopedExecution(planId, courseId) {
    const normalizedCourseId = normalizeCourseId(courseId);
    if (!normalizedCourseId) {
        throw new CourseScopeQueryError('course_id is required for live course analytics.');
    }

    const plan = getCourseScopedQueryPlan(planId);
    return {
        planId: plan.id,
        text: plan.sql,
        values: [normalizedCourseId],
    };
}

export function buildGeneratedCourseScopedExecution(sql, courseId) {
    const approved = approveGeneratedCourseSql(sql);
    return buildCourseScopedExecution(approved.id, courseId);
}
