const COURSE_PREDICATE = '(c.id::text = $1 OR c.gradescope_course_id::text = $1)';

const VIEW_DEFINITIONS = Object.freeze({
    students: Object.freeze({
        description: 'One row per enrolled student with aggregate assignment performance.',
        columns: Object.freeze({
            student_name: 'text',
            student_sid: 'text',
            average_score: 'number',
            score_stddev: 'number',
            assignment_count: 'integer',
            latest_submission_at: 'timestamp',
        }),
        defaultSelect: ['student_name', 'student_sid', 'average_score'],
        sql: `
            SELECT
                s.legal_name AS student_name,
                s.sid AS student_sid,
                ROUND(AVG(sub.total_score / NULLIF(sub.max_points, 0) * 100)::numeric, 2) AS average_score,
                ROUND(STDDEV(sub.total_score / NULLIF(sub.max_points, 0) * 100)::numeric, 2) AS score_stddev,
                COUNT(DISTINCT CASE WHEN sub.id IS NOT NULL THEN a.id END)::integer AS assignment_count,
                MAX(sub.submission_time) AS latest_submission_at
            FROM courses c
            JOIN students s ON s.course_id = c.id
            LEFT JOIN submissions sub ON sub.student_id = s.id
            LEFT JOIN assignments a ON a.id = sub.assignment_id AND a.course_id = c.id
            WHERE ${COURSE_PREDICATE}
            GROUP BY s.id, s.legal_name, s.sid
        `,
    }),
    assignments: Object.freeze({
        description: 'One row per assignment with score, participation, and timing metrics.',
        columns: Object.freeze({
            assignment_title: 'text',
            category: 'text',
            max_points: 'number',
            average_score: 'number',
            submission_count: 'integer',
            latest_submission_at: 'timestamp',
            due_at: 'timestamp',
        }),
        defaultSelect: ['assignment_title', 'category', 'average_score', 'submission_count'],
        sql: `
            SELECT
                a.title AS assignment_title,
                COALESCE(a.category, 'Uncategorized') AS category,
                ROUND(a.max_points::numeric, 2) AS max_points,
                ROUND((AVG(sub.total_score / NULLIF(sub.max_points, 0) * 100) FILTER (WHERE s.id IS NOT NULL))::numeric, 2) AS average_score,
                COUNT(s.id)::integer AS submission_count,
                MAX(sub.submission_time) FILTER (WHERE s.id IS NOT NULL) AS latest_submission_at,
                a.due_at
            FROM courses c
            JOIN assignments a ON a.course_id = c.id
            LEFT JOIN submissions sub ON sub.assignment_id = a.id
            LEFT JOIN students s ON s.id = sub.student_id AND s.course_id = c.id
            WHERE ${COURSE_PREDICATE}
            GROUP BY a.id, a.title, a.category, a.max_points, a.due_at
        `,
    }),
    categories: Object.freeze({
        description: 'One row per assignment category for cross-category comparison.',
        columns: Object.freeze({
            category: 'text',
            average_score: 'number',
            assignment_count: 'integer',
            submission_count: 'integer',
        }),
        defaultSelect: ['category', 'average_score', 'assignment_count', 'submission_count'],
        sql: `
            SELECT
                COALESCE(a.category, 'Uncategorized') AS category,
                ROUND((AVG(sub.total_score / NULLIF(sub.max_points, 0) * 100) FILTER (WHERE s.id IS NOT NULL))::numeric, 2) AS average_score,
                COUNT(DISTINCT a.id)::integer AS assignment_count,
                COUNT(s.id)::integer AS submission_count
            FROM courses c
            JOIN assignments a ON a.course_id = c.id
            LEFT JOIN submissions sub ON sub.assignment_id = a.id
            LEFT JOIN students s ON s.id = sub.student_id AND s.course_id = c.id
            WHERE ${COURSE_PREDICATE}
            GROUP BY COALESCE(a.category, 'Uncategorized')
        `,
    }),
    submissions: Object.freeze({
        description: 'Submission-level rows for recent activity and timestamp questions.',
        columns: Object.freeze({
            student_name: 'text',
            student_sid: 'text',
            assignment_title: 'text',
            category: 'text',
            score: 'number',
            max_points: 'number',
            score_percentage: 'number',
            submission_time: 'timestamp',
            status: 'text',
            lateness: 'text',
        }),
        defaultSelect: ['student_name', 'assignment_title', 'score_percentage', 'submission_time'],
        sql: `
            SELECT
                s.legal_name AS student_name,
                s.sid AS student_sid,
                a.title AS assignment_title,
                COALESCE(a.category, 'Uncategorized') AS category,
                ROUND(sub.total_score::numeric, 2) AS score,
                ROUND(sub.max_points::numeric, 2) AS max_points,
                ROUND((sub.total_score / NULLIF(sub.max_points, 0) * 100)::numeric, 2) AS score_percentage,
                sub.submission_time,
                sub.status,
                sub.lateness
            FROM courses c
            JOIN assignments a ON a.course_id = c.id
            JOIN submissions sub ON sub.assignment_id = a.id
            JOIN students s ON s.id = sub.student_id AND s.course_id = c.id
            WHERE ${COURSE_PREDICATE}
        `,
    }),
    daily_activity: Object.freeze({
        description: 'One row per submission day with activity totals.',
        columns: Object.freeze({
            activity_date: 'date',
            submission_count: 'integer',
            active_students: 'integer',
            average_score: 'number',
        }),
        defaultSelect: ['activity_date', 'submission_count', 'active_students'],
        sql: `
            SELECT
                DATE_TRUNC('day', sub.submission_time)::date AS activity_date,
                COUNT(sub.id)::integer AS submission_count,
                COUNT(DISTINCT s.id)::integer AS active_students,
                ROUND(AVG(sub.total_score / NULLIF(sub.max_points, 0) * 100)::numeric, 2) AS average_score
            FROM courses c
            JOIN assignments a ON a.course_id = c.id
            JOIN submissions sub ON sub.assignment_id = a.id
            JOIN students s ON s.id = sub.student_id AND s.course_id = c.id
            WHERE ${COURSE_PREDICATE}
              AND sub.submission_time IS NOT NULL
            GROUP BY DATE_TRUNC('day', sub.submission_time)::date
        `,
    }),
    course_summary: Object.freeze({
        description: 'A single row of course-wide counts and score statistics.',
        columns: Object.freeze({
            total_students: 'integer',
            total_assignments: 'integer',
            total_submissions: 'integer',
            average_score: 'number',
            minimum_score: 'number',
            maximum_score: 'number',
        }),
        defaultSelect: ['total_students', 'total_assignments', 'total_submissions', 'average_score'],
        sql: `
            SELECT
                COUNT(DISTINCT s.id)::integer AS total_students,
                COUNT(DISTINCT a.id)::integer AS total_assignments,
                COUNT(sub.id)::integer AS total_submissions,
                ROUND(AVG(sub.total_score / NULLIF(sub.max_points, 0) * 100)::numeric, 2) AS average_score,
                ROUND(MIN(sub.total_score / NULLIF(sub.max_points, 0) * 100)::numeric, 2) AS minimum_score,
                ROUND(MAX(sub.total_score / NULLIF(sub.max_points, 0) * 100)::numeric, 2) AS maximum_score
            FROM courses c
            LEFT JOIN students s ON s.course_id = c.id
            LEFT JOIN assignments a ON a.course_id = c.id
            LEFT JOIN submissions sub ON sub.assignment_id = a.id AND sub.student_id = s.id
            WHERE ${COURSE_PREDICATE}
        `,
    }),
});

const FILTER_OPERATORS = Object.freeze({
    eq: '=',
    ne: '<>',
    lt: '<',
    lte: '<=',
    gt: '>',
    gte: '>=',
    contains: 'ILIKE',
});

export class SemanticQueryError extends Error {
    constructor(reason) {
        super(reason);
        this.name = 'SemanticQueryError';
        this.status = 422;
        this.code = 'SEMANTIC_QUERY_INVALID';
        this.reason = reason;
        this.recovery = 'Inspect the analytics catalog, then retry with supported fields and operators.';
        this.isControlledApiError = true;
    }
}

function requireView(viewName) {
    const normalized = String(viewName || '').trim();
    const view = VIEW_DEFINITIONS[normalized];
    if (!view) {
        throw new SemanticQueryError(`Unknown analytics view: ${normalized || '(missing)'}.`);
    }
    return { viewName: normalized, view };
}

function requireField(view, field, context) {
    const normalized = String(field || '').trim();
    if (!Object.hasOwn(view.columns, normalized)) {
        throw new SemanticQueryError(`Unsupported ${context} field: ${normalized || '(missing)'}.`);
    }
    return normalized;
}

export function getSemanticCatalog() {
    return {
        version: 1,
        operators: Object.keys(FILTER_OPERATORS),
        max_limit: 100,
        views: Object.fromEntries(Object.entries(VIEW_DEFINITIONS).map(([name, view]) => [name, {
            description: view.description,
            fields: view.columns,
            default_select: view.defaultSelect,
        }])),
    };
}

export function compileSemanticQuery(spec, courseId) {
    const normalizedCourseId = String(courseId || '').trim();
    if (!normalizedCourseId) {
        throw new SemanticQueryError('course_id is required.');
    }

    const { viewName, view } = requireView(spec?.view);
    const requested = Array.isArray(spec?.select) && spec.select.length > 0
        ? spec.select
        : view.defaultSelect;
    const select = [...new Set(requested.map((field) => requireField(view, field, 'select')))];
    const values = [normalizedCourseId];
    const predicates = [];

    for (const filter of Array.isArray(spec?.filters) ? spec.filters : []) {
        const field = requireField(view, filter?.field, 'filter');
        const operatorName = String(filter?.operator || 'eq').trim().toLowerCase();

        if (operatorName === 'in') {
            if (!Array.isArray(filter?.value) || filter.value.length === 0 || filter.value.length > 50) {
                throw new SemanticQueryError('The in operator requires 1 to 50 values.');
            }
            const placeholders = filter.value.map((value) => {
                values.push(value);
                return `$${values.length}`;
            });
            predicates.push(`${field} IN (${placeholders.join(', ')})`);
            continue;
        }

        const sqlOperator = FILTER_OPERATORS[operatorName];
        if (!sqlOperator) {
            throw new SemanticQueryError(`Unsupported filter operator: ${operatorName}.`);
        }
        values.push(operatorName === 'contains' ? `%${String(filter?.value ?? '')}%` : filter?.value);
        predicates.push(`${field} ${sqlOperator} $${values.length}`);
    }

    const orderBy = [];
    for (const order of Array.isArray(spec?.order_by) ? spec.order_by : []) {
        const field = requireField(view, order?.field, 'order');
        const direction = String(order?.direction || 'asc').trim().toLowerCase();
        if (!['asc', 'desc'].includes(direction)) {
            throw new SemanticQueryError(`Unsupported order direction: ${direction}.`);
        }
        orderBy.push(`${field} ${direction.toUpperCase()} NULLS LAST`);
    }

    const rawLimit = Number(spec?.limit ?? 50);
    if (!Number.isInteger(rawLimit) || rawLimit < 1) {
        throw new SemanticQueryError('limit must be a positive integer.');
    }
    const limit = Math.min(rawLimit, 100);
    const text = `
        WITH analytics AS (${view.sql.trim()})
        SELECT ${select.join(', ')}
        FROM analytics
        ${predicates.length > 0 ? `WHERE ${predicates.join(' AND ')}` : ''}
        ${orderBy.length > 0 ? `ORDER BY ${orderBy.join(', ')}` : ''}
        LIMIT ${limit}
    `;

    return {
        view: viewName,
        spec: { view: viewName, select, filters: spec?.filters || [], order_by: spec?.order_by || [], limit },
        text,
        values,
    };
}

function sevenDaysAgoIso(now) {
    return new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}

export function planNaturalLanguageQuery(userQuery, now = new Date()) {
    const query = String(userQuery || '').trim();
    const lower = query.toLowerCase();
    if (!query) throw new SemanticQueryError('query is required.');

    if (/fluctuation|variance|standard deviation|波动/.test(lower)) {
        return { view: 'students', select: ['student_name', 'student_sid', 'average_score', 'score_stddev', 'assignment_count'], order_by: [{ field: 'score_stddev', direction: 'desc' }], limit: 10 };
    }
    if (/hardest|most difficult|最难/.test(lower)) {
        return { view: 'assignments', select: ['assignment_title', 'category', 'average_score', 'submission_count'], filters: [{ field: 'submission_count', operator: 'gt', value: 0 }], order_by: [{ field: 'average_score', direction: 'asc' }], limit: 10 };
    }
    if (/latest submission|最近.*提交|最新.*提交/.test(lower) && /assignment|作业/.test(lower)) {
        return { view: 'assignments', select: ['assignment_title', 'category', 'latest_submission_at', 'submission_count'], order_by: [{ field: 'latest_submission_at', direction: 'desc' }], limit: 50 };
    }
    if (/compare/.test(lower) && /project/.test(lower) && /exam/.test(lower)) {
        return { view: 'categories', filters: [{ field: 'category', operator: 'in', value: ['Projects', 'Exams'] }], order_by: [{ field: 'category', direction: 'asc' }], limit: 10 };
    }
    if (/below\s*60|under\s*60|低于\s*60/.test(lower)) {
        return { view: 'students', select: ['student_name', 'student_sid', 'average_score', 'assignment_count'], filters: [{ field: 'average_score', operator: 'lt', value: 60 }], order_by: [{ field: 'average_score', direction: 'asc' }], limit: 100 };
    }
    if (/last week|past week|最近一周/.test(lower) && /submission|activity|提交/.test(lower)) {
        return { view: 'daily_activity', filters: [{ field: 'activity_date', operator: 'gte', value: sevenDaysAgoIso(now) }], order_by: [{ field: 'activity_date', direction: 'asc' }], limit: 8 };
    }
    if (/most assignments|最多.*作业/.test(lower)) {
        return { view: 'students', select: ['student_name', 'student_sid', 'assignment_count', 'average_score'], order_by: [{ field: 'assignment_count', direction: 'desc' }], limit: 10 };
    }
    if (/top\s*10|最高.*10|前\s*10/.test(lower) && /student|grade|学生|成绩/.test(lower)) {
        return { view: 'students', select: ['student_name', 'student_sid', 'average_score', 'assignment_count'], order_by: [{ field: 'average_score', direction: 'desc' }], limit: 10 };
    }
    if (/all students?.*average|students?.*average scores?|所有学生.*平均/.test(lower)) {
        return { view: 'students', select: ['student_name', 'student_sid', 'average_score', 'assignment_count'], order_by: [{ field: 'student_name', direction: 'asc' }], limit: 100 };
    }
    if (/semester|statistics|overview|统计|概览|平均/.test(lower)) {
        return { view: 'course_summary' };
    }
    if (/assignment|作业/.test(lower)) {
        return { view: 'assignments', order_by: [{ field: 'assignment_title', direction: 'asc' }], limit: 50 };
    }
    if (/student|学生/.test(lower)) {
        return { view: 'students', order_by: [{ field: 'average_score', direction: 'desc' }], limit: 50 };
    }
    throw new SemanticQueryError('The question could not be mapped to a supported analytics view.');
}

export function summarizeSemanticResult(spec, rows) {
    const count = Array.isArray(rows) ? rows.length : 0;
    const labels = {
        students: 'student performance',
        assignments: 'assignment performance',
        categories: 'category comparison',
        submissions: 'submission',
        daily_activity: 'daily submission activity',
        course_summary: 'course summary',
    };
    return count === 0
        ? `No matching ${labels[spec.view] || 'analytics'} data was found.`
        : `Found ${count} ${labels[spec.view] || 'analytics'} result${count === 1 ? '' : 's'} from the selected live course.`;
}

export async function describeLiveCourseAnalytics(pool, courseId) {
    const normalizedCourseId = String(courseId || '').trim();
    if (!normalizedCourseId) throw new SemanticQueryError('course_id is required.');

    const [courseResult, columnsResult] = await Promise.all([
        pool.query(`
            SELECT c.id, c.gradescope_course_id, c.name, c.semester, c.year
            FROM courses c
            WHERE ${COURSE_PREDICATE}
            LIMIT 1
        `, [normalizedCourseId]),
        pool.query(`
            SELECT table_name, column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = ANY($1::text[])
            ORDER BY table_name, ordinal_position
        `, [['courses', 'students', 'assignments', 'submissions', 'course_policies', 'student_exam_effective_scores', 'student_attendance_effective_scores']]),
    ]);

    if (courseResult.rows.length === 0) {
        throw new SemanticQueryError('The selected course does not exist in the live database.');
    }
    const databaseTables = {};
    for (const row of columnsResult.rows) {
        databaseTables[row.table_name] ||= [];
        databaseTables[row.table_name].push({ name: row.column_name, type: row.data_type });
    }

    return {
        course: courseResult.rows[0],
        catalog: getSemanticCatalog(),
        database_schema: databaseTables,
    };
}
