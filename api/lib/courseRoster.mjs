import { normalizeCatalogCategory } from './assignmentEvidence.mjs';

function optionalNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function rosterKey(student = {}) {
    const id = student.id ?? student.studentId ?? student.student_id;
    const courseId = student.courseId ?? student.course_id;
    if (id !== null && id !== undefined && id !== '') return `${courseId || ''}:${id}`;
    return `${courseId || ''}:${String(student.email || student.student_email || '').trim().toLowerCase()}`;
}

export function buildEnrolledCourseRosterQuery(courseId = null) {
    const values = [];
    let courseFilter = '';
    if (courseId !== null && courseId !== undefined && String(courseId).trim()) {
        values.push(String(courseId));
        courseFilter = 'WHERE c.id::text = $1 OR c.gradescope_course_id::text = $1';
    }

    return {
        text: `
            SELECT
                st.id::text AS student_id,
                st.sid,
                st.email AS student_email,
                COALESCE(st.legal_name, st.email) AS student_name,
                c.id::text AS course_id,
                c.gradescope_course_id,
                c.name AS course_name
            FROM students st
            JOIN courses c ON c.id = st.course_id
            ${courseFilter}
            ORDER BY c.id, student_name, st.email, st.id
        `,
        values,
    };
}

export function normalizeEnrolledRosterRows(rows = []) {
    const byKey = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
        const student = {
            id: row.student_id == null ? null : String(row.student_id),
            sid: row.sid || null,
            name: row.student_name || row.legal_name || row.student_email || 'Unknown',
            email: row.student_email || row.email || null,
            courseId: row.course_id == null ? null : String(row.course_id),
            gradescopeCourseId: row.gradescope_course_id == null ? null : String(row.gradescope_course_id),
            courseName: row.course_name || null,
            rosterSource: 'enrolled_students',
            identityStatus: row.student_email || row.email ? 'available' : 'email_unavailable',
        };
        const key = rosterKey(student);
        if (!byKey.has(key)) byKey.set(key, student);
    });
    return Array.from(byKey.values());
}

export async function queryEnrolledCourseRoster(pool, courseId = null) {
    const query = buildEnrolledCourseRosterQuery(courseId);
    const result = await pool.query(query.text, query.values);
    return normalizeEnrolledRosterRows(result?.rows || []);
}

export function enrolledRosterToLegacyPairs(roster = []) {
    const seen = new Set();
    return (Array.isArray(roster) ? roster : []).reduce((pairs, student) => {
        const email = String(student?.email || '').trim().toLowerCase();
        if (!email || seen.has(email)) return pairs;
        seen.add(email);
        pairs.push([student.name || student.email, student.email]);
        return pairs;
    }, []);
}

export function buildRosterScoreRowsQuery(courseId = null) {
    const values = [];
    let courseFilter = '';
    if (courseId !== null && courseId !== undefined && String(courseId).trim()) {
        values.push(String(courseId));
        courseFilter = 'AND (c.id::text = $1 OR c.gradescope_course_id::text = $1)';
    }

    return {
        text: `
            SELECT
                st.id::text AS student_id,
                st.course_id::text AS course_id,
                COALESCE(a.category, 'Uncategorized') AS category,
                a.title AS assignment_name,
                s.total_score
            FROM submissions s
            JOIN students st ON st.id = s.student_id
            JOIN assignments a
              ON a.id = s.assignment_id
             AND a.course_id = st.course_id
            JOIN courses c ON c.id = st.course_id
            WHERE a.title IS NOT NULL
              ${courseFilter}
            ORDER BY st.id, category, a.title
        `,
        values,
    };
}

export function mergeEnrolledRosterWithScoreRows(roster = [], scoreRows = []) {
    const students = (Array.isArray(roster) ? roster : []).map((student) => ({
        ...student,
        scores: {},
    }));
    const byKey = new Map(students.map((student) => [rosterKey(student), student]));

    (Array.isArray(scoreRows) ? scoreRows : []).forEach((row) => {
        const key = rosterKey({
            id: row.student_id,
            courseId: row.course_id,
            email: row.student_email,
        });
        const student = byKey.get(key);
        const assignmentName = String(row.assignment_name || '').trim();
        if (!student || !assignmentName) return;
        const category = normalizeCatalogCategory(row.category || 'Uncategorized');
        if (!student.scores[category]) student.scores[category] = {};
        student.scores[category][assignmentName] = optionalNumber(row.total_score);
    });

    return students;
}

export async function queryRosterBackedStudentScores(pool, courseId = null) {
    const scoreQuery = buildRosterScoreRowsQuery(courseId);
    const [roster, scoreResult] = await Promise.all([
        queryEnrolledCourseRoster(pool, courseId),
        pool.query(scoreQuery.text, scoreQuery.values),
    ]);
    return mergeEnrolledRosterWithScoreRows(roster, scoreResult?.rows || []);
}
