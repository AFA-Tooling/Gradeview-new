import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') }); // Relative to api/lib/ is ../../

let pool = null;

const QUEST_SUMMARY_CAP = 25;
const ATTENDANCE_SUMMARY_CAP = 15;

const QUEST_CATEGORY_ALIASES = {
    'abstraction': 'abstraction',
    'number representation': 'number representation',
    'iteration': 'iteration',
    'domain and range': 'domain and range',
    'booleans': 'booleans',
    'boolean': 'booleans',
    'conditional operators and booleans': 'booleans',
    'functions': 'functions',
    'hofs i': 'hofs i',
    'hof i': 'hofs i',
    'higher order functions': 'hofs i',
    'higher-order functions': 'hofs i',
};
const QUEST_UNMAPPED_BUCKET = '__quest_unmapped__';

/**
 * Gets or creates a PostgreSQL connection pool.
 * @returns {Pool} PostgreSQL pool instance
 */
export function getPool() {
    if (!pool) {
        const {
            POSTGRES_HOST,
            POSTGRES_PORT,
            POSTGRES_DB,
            POSTGRES_USER,
            POSTGRES_PASSWORD,
            GRADESYNC_DATABASE_URL,
            DATABASE_URL
        } = process.env;

        let poolConfig;

        if (POSTGRES_HOST && POSTGRES_USER && POSTGRES_DB) {
            poolConfig = {
                host: POSTGRES_HOST,
                port: parseInt(POSTGRES_PORT || '5432', 10),
                database: POSTGRES_DB,
                user: POSTGRES_USER,
                password: POSTGRES_PASSWORD,
                max: 20, // Max number of clients in the pool
                idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
                connectionTimeoutMillis: 10000, // Increased to 10 seconds for Cloud SQL
                keepAlive: true, // Enable keep-alive to avoid timeouts from the proxy
                ssl: POSTGRES_HOST.includes('.') && !POSTGRES_HOST.includes('localhost') && POSTGRES_HOST !== 'cloud-sql-proxy'
                    ? { rejectUnauthorized: false } // Enable SSL for external IPs (Cloud SQL)
                    : false,
            };
        } else {
            const databaseUrl = GRADESYNC_DATABASE_URL || DATABASE_URL;
            if (!databaseUrl) {
                throw new Error('Database configuration not found. Please set POSTGRES_HOST/USER/PASSWORD/DB or GRADESYNC_DATABASE_URL environment variables.');
            }
            poolConfig = {
                connectionString: databaseUrl,
                max: 20,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 5000,
                keepAlive: true,
            };
        }
        
        pool = new Pool(poolConfig);
        
        pool.on('error', (err) => {
            console.error('PostgreSQL pool error:', err);
        });
    }
    
    return pool;
}

/**
 * Gets student submissions sorted by submission time
 * @param {string} email - The student's email
 * @param {string} courseId - Optional course ID filter
 * @returns {Promise<Array>} Array of submissions with assignment details
 */
export async function getStudentSubmissionsByTime(email, courseId = null) {
    const pool = getPool();
    
    let query = `
        SELECT 
            a.title as assignment_name,
            a.category,
            s.total_score as score,
            a.max_points,
            s.submission_time,
            s.lateness,
            c.name as course_name,
            c.semester,
            c.year
        FROM submissions s
        JOIN assignments a ON s.assignment_id = a.id
        JOIN students st ON s.student_id = st.id
        JOIN courses c ON a.course_id = c.id
        WHERE st.email = $1
    `;
    
    const params = [email];
    
    if (courseId) {
        query += ` AND (c.gradescope_course_id::text = $2 OR c.id::text = $2)`;
        params.push(courseId);
    }
    
    query += `
        ORDER BY s.submission_time DESC
    `;
    
    try {
        const result = await pool.query(query, params);
        
        return result.rows.map(row => ({
            category: row.category || 'Uncategorized',
            name: row.assignment_name,
            score: parseFloat(row.score) || 0,
            maxPoints: parseFloat(row.max_points) || 0,
            percentage: row.max_points > 0 ? (parseFloat(row.score) / parseFloat(row.max_points)) * 100 : 0,
            submissionTime: row.submission_time,
            lateness: row.lateness,
            courseName: row.course_name,
            semester: row.semester,
            year: row.year,
        }));
    } catch (err) {
        console.error('Error fetching student submissions by time:', err);
        throw err;
    }
}

/**
 * Gets all submissions for a student with grouped assignment structure and time data
 * @param {string} email - The student's email
 * @param {string} courseId - Optional course ID filter
 * @returns {Promise<Object>} Object grouped by category/assignment plus submission times
 */
export async function getStudentSubmissionsGrouped(email, courseId = null) {
    const pool = getPool();
    
    let query;
    let params;

    if (courseId) {
        query = `
            SELECT
                a.title as assignment_name,
                a.category,
                COALESCE(s.total_score, 0) as score,
                a.max_points,
                s.submission_time,
                s.lateness
            FROM assignments a
            JOIN courses c ON a.course_id = c.id
            LEFT JOIN students st ON st.email = $1 AND st.course_id = c.id
            LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = st.id
            WHERE (c.gradescope_course_id::text = $2 OR c.id::text = $2)
            ORDER BY a.category, a.title
        `;
        params = [email, courseId];
    } else {
        query = `
            SELECT 
                a.title as assignment_name,
                a.category,
                s.total_score as score,
                a.max_points,
                s.submission_time,
                s.lateness
            FROM submissions s
            JOIN assignments a ON s.assignment_id = a.id
            JOIN students st ON s.student_id = st.id
            JOIN courses c ON a.course_id = c.id
            WHERE st.email = $1
        `;
        params = [email];
    }
    
    try {
        const result = await pool.query(query, params);
        
        // Group by category
        const grouped = {};
        
        result.rows.forEach(row => {
            const category = row.category || 'Uncategorized';
            const assignmentName = row.assignment_name;
            
            if (!grouped[category]) {
                grouped[category] = {};
            }
            
            grouped[category][assignmentName] = {
                student: parseFloat(row.score) || 0,
                max: parseFloat(row.max_points) || 0,
                submissionTime: row.submission_time,
                lateness: row.lateness,
            };
        });
        
        return grouped;
    } catch (err) {
        console.error('Error fetching grouped student submissions:', err);
        throw err;
    }
}

/**
 * Gets policy-computed exam scores for a student.
 * @param {string} email - The student's email
 * @param {string|null} courseId - Optional course filter (internal id or gradescope_course_id)
 * @returns {Promise<Array>} Effective policy rows ordered by exam type and attempt
 */
export async function getStudentExamPolicyScores(email, courseId = null) {
    const pool = getPool();

    let query = `
        SELECT
            e.exam_type,
            e.attempt_no,
            e.raw_percentage,
            e.question_best_percentage,
            e.clobbered_percentage,
            e.final_percentage,
            e.assignment_id,
            a.title AS assignment_title,
            e.clobber_source_assignment_id,
            src.title AS clobber_source_title,
            e.details,
            e.computed_at,
            c.id AS course_id,
            c.gradescope_course_id
        FROM student_exam_effective_scores e
        JOIN students st ON st.id = e.student_id
        JOIN courses c ON c.id = e.course_id
        LEFT JOIN assignments a ON a.id = e.assignment_id
        LEFT JOIN assignments src ON src.id = e.clobber_source_assignment_id
        WHERE st.email = $1
    `;

    const params = [email];
    if (courseId) {
        query += ` AND (c.id::text = $2 OR c.gradescope_course_id::text = $2)`;
        params.push(String(courseId));
    }

    query += `
        ORDER BY
            CASE LOWER(e.exam_type)
                WHEN 'quest' THEN 1
                WHEN 'midterm' THEN 2
                WHEN 'postterm' THEN 3
                ELSE 9
            END,
            e.attempt_no ASC
    `;

    const result = await pool.query(query, params);

    return result.rows.map((row) => ({
        examType: row.exam_type,
        attemptNo: Number(row.attempt_no) || 0,
        assignmentId: row.assignment_id,
        assignmentTitle: row.assignment_title || '',
        rawPercentage: row.raw_percentage == null ? null : Number(row.raw_percentage),
        questionBestPercentage: row.question_best_percentage == null ? null : Number(row.question_best_percentage),
        clobberedPercentage: row.clobbered_percentage == null ? null : Number(row.clobbered_percentage),
        finalPercentage: row.final_percentage == null ? null : Number(row.final_percentage),
        clobberSourceAssignmentId: row.clobber_source_assignment_id,
        clobberSourceTitle: row.clobber_source_title || null,
        details: row.details || {},
        computedAt: row.computed_at,
        courseId: row.course_id,
        gradescopeCourseId: row.gradescope_course_id,
    }));
}

function normalizeComponentKey(value) {
    return String(value || '').trim().toLowerCase();
}

function parseQuestAttemptNo(title) {
    const text = String(title || '');
    const match = text.match(/quest\s*[-:]?\s*(\d+)/i);
    if (!match) return null;
    const attemptNo = Number(match[1]);
    return Number.isFinite(attemptNo) ? attemptNo : null;
}

/**
 * Gets Quest component progression curves for a student.
 * Curves represent cumulative best percentages after Quest-1, Quest-2, Quest-3.
 * @param {string} email
 * @param {string|null} courseId
 * @returns {Promise<{components:string[], series:Array<{name:string,data:number[]}>}>}
 */
export async function getStudentQuestComponentTrend(email, courseId = null) {
    const pool = getPool();

    const componentOrder = [
        'Abstraction',
        'Number Representation',
        'Iteration',
        'Domain and Range',
        'Booleans',
        'Functions',
        'HOFs I',
    ];

    let query = `
        SELECT
            a.id AS assignment_id,
            a.title AS assignment_title,
            a.max_points AS assignment_max_points,
            a.assignment_metadata,
            s.total_score,
            s.max_points AS submission_max_points,
            s.scores_by_question,
            e.attempt_no
        FROM students st
        JOIN courses c ON c.id = st.course_id
        JOIN submissions s ON s.student_id = st.id
        JOIN assignments a ON a.id = s.assignment_id AND a.course_id = c.id
        LEFT JOIN exam_attempt_map e
            ON e.assignment_id = a.id
           AND e.course_id = c.id
           AND LOWER(e.exam_type) = 'quest'
        WHERE st.email = $1
          AND LOWER(COALESCE(a.category, '')) = 'quest'
    `;

    const params = [email];
    if (courseId) {
        query += ` AND (c.id::text = $2 OR c.gradescope_course_id::text = $2)`;
        params.push(String(courseId));
    }

    query += ` ORDER BY a.title`;

    const result = await pool.query(query, params);

    const attemptMap = new Map();

    for (const row of result.rows) {
        const attemptNo = Number(row.attempt_no) || parseQuestAttemptNo(row.assignment_title);
        if (!attemptNo || attemptNo < 1 || attemptNo > 3) {
            continue;
        }

        const assignmentMetadata = row.assignment_metadata && typeof row.assignment_metadata === 'object'
            ? row.assignment_metadata
            : {};
        const components = Array.isArray(assignmentMetadata.components) ? assignmentMetadata.components : [];
        const componentCapsByKey = new Map();
        for (const component of components) {
            const key = normalizeComponentKey(component?.key);
            if (!key) continue;
            const maxPoints = Number(component?.max_points);
            if (Number.isFinite(maxPoints) && maxPoints > 0) {
                componentCapsByKey.set(key, maxPoints);
            }
        }

        const scoresByQuestion = row.scores_by_question && typeof row.scores_by_question === 'object'
            ? row.scores_by_question
            : {};
        const embeddedCapsRaw = scoresByQuestion.component_caps && typeof scoresByQuestion.component_caps === 'object'
            ? scoresByQuestion.component_caps
            : {};
        const embeddedCaps = new Map();
        for (const [capKey, capValue] of Object.entries(embeddedCapsRaw)) {
            const normCapKey = normalizeComponentKey(capKey);
            const numericCap = Number(capValue);
            if (normCapKey && Number.isFinite(numericCap) && numericCap > 0) {
                embeddedCaps.set(normCapKey, numericCap);
            }
        }

        const assignmentMax = Number(row.assignment_max_points);
        const submissionMax = Number(row.submission_max_points);
        const totalScore = Number(row.total_score);
        const overallPercentage = Number(scoresByQuestion.score_perc);
        let fallbackPct = null;
        if (Number.isFinite(overallPercentage)) {
            fallbackPct = overallPercentage;
        } else {
            const denom = Number.isFinite(submissionMax) && submissionMax > 0
                ? submissionMax
                : (Number.isFinite(assignmentMax) && assignmentMax > 0 ? assignmentMax : null);
            if (denom && Number.isFinite(totalScore)) {
                fallbackPct = (totalScore / denom) * 100;
            }
        }

        const existing = attemptMap.get(attemptNo) || {};
        const merged = { ...existing };

        for (const componentName of componentOrder) {
            const targetKey = normalizeComponentKey(componentName);

            let componentPct = null;

            for (const [rawKey, rawValue] of Object.entries(scoresByQuestion)) {
                const normKey = normalizeComponentKey(rawKey);
                if (!normKey || normKey === 'source' || normKey === 'score_perc') continue;
                if (normKey === 'component caps') continue;
                if (normKey !== targetKey) continue;

                const score = Number(rawValue);
                const cap = Number(componentCapsByKey.get(normKey) ?? embeddedCaps.get(normKey));
                if (Number.isFinite(score) && Number.isFinite(cap) && cap > 0) {
                    const roundedScore = Math.ceil(score * 10) / 10;
                    componentPct = (roundedScore / cap) * 100;
                }
            }

            if (!Number.isFinite(componentPct) && Number.isFinite(fallbackPct)) {
                componentPct = fallbackPct;
            }

            if (Number.isFinite(componentPct)) {
                merged[componentName] = Math.max(0, Math.min(100, Number(componentPct)));
            }
        }

        attemptMap.set(attemptNo, merged);
    }

    const getAttemptPct = (attemptNo, componentName) => {
        const item = attemptMap.get(attemptNo);
        if (!item) return 0;
        const value = Number(item[componentName]);
        return Number.isFinite(value) ? value : 0;
    };

    const after1 = componentOrder.map((componentName) => getAttemptPct(1, componentName));
    const after2 = componentOrder.map((componentName, index) => Math.max(after1[index], getAttemptPct(2, componentName)));
    const after3 = componentOrder.map((componentName, index) => Math.max(after2[index], getAttemptPct(3, componentName)));

    return {
        components: componentOrder,
        series: [
            { name: 'After Quest-1', data: after1.map((value) => Number(value.toFixed(2))) },
            { name: 'After Quest-2 (Cumulative Best)', data: after2.map((value) => Number(value.toFixed(2))) },
            { name: 'After Quest-3 (Cumulative Best)', data: after3.map((value) => Number(value.toFixed(2))) },
        ],
    };
}

/**
 * Checks if a student exists in the database
 * @param {string} email - The student's email
 * @returns {Promise<boolean>} True if student exists
 */
export async function studentExistsInDb(email) {
    const pool = getPool();
    
    try {
        const result = await pool.query(
            'SELECT id FROM students WHERE email = $1 LIMIT 1',
            [email]
        );
        return result.rows.length > 0;
    } catch (err) {
        console.error('Error checking student existence:', err);
        return false;
    }
}

/**
 * Gets courses a student is enrolled in, based on students table membership.
 * @param {string} email - The student's email
 * @returns {Promise<Array<{id:number,name:string,gradescope_course_id:string,department:string,course_number:string,semester:string,year:number}>>}
 */
export async function getStudentCourses(email) {
    const pool = getPool();

    const query = `
        SELECT DISTINCT
            c.id,
            c.name,
            c.gradescope_course_id,
            c.department,
            c.course_number,
            c.semester,
            c.year
        FROM students st
        JOIN courses c ON st.course_id = c.id
        WHERE st.email = $1
        ORDER BY c.year DESC, c.semester, c.department, c.course_number, c.name
    `;

    try {
        const result = await pool.query(query, [email]);
        return result.rows;
    } catch (err) {
        console.error('Error fetching student courses:', err);
        throw err;
    }
}

/**
 * Gets courses a staff/admin user is assigned to via course_permissions.
 * @param {string} email - User email
 * @returns {Promise<Array<{id:number,name:string,gradescope_course_id:string,department:string,course_number:string,semester:string,year:number,permission_level:string,user_role:string}>>}
 */
export async function getStaffCourses(email) {
    const pool = getPool();

    const query = `
        SELECT DISTINCT
            c.id,
            c.name,
            c.gradescope_course_id,
            c.department,
            c.course_number,
            c.semester,
            c.year,
            cp.permission_level,
            u.role AS user_role
        FROM users u
        JOIN course_permissions cp ON cp.user_id = u.id
        JOIN courses c ON c.id = cp.course_id
        WHERE LOWER(u.email) = LOWER($1)
          AND u.is_active = true
          AND c.is_active = true
        ORDER BY c.year DESC, c.semester, c.department, c.course_number, c.name
    `;

    try {
        const result = await pool.query(query, [email]);
        return result.rows;
    } catch (err) {
        console.error('Error fetching staff courses:', err);
        throw err;
    }
}

/**
 * Checks whether a student is enrolled in a given course.
 * @param {string} email - Student email
 * @param {string|number} courseId - Internal course id or gradescope course id
 * @returns {Promise<boolean>}
 */
export async function studentEnrolledInCourse(email, courseId) {
    const pool = getPool();

    const query = `
        SELECT 1
        FROM students st
        JOIN courses c ON st.course_id = c.id
        WHERE st.email = $1
          AND (c.id::text = $2 OR c.gradescope_course_id::text = $2)
        LIMIT 1
    `;

    try {
        const result = await pool.query(query, [email, String(courseId)]);
        return result.rows.length > 0;
    } catch (err) {
        console.error('Error checking student course enrollment:', err);
        throw err;
    }
}

/**
 * Gets score distribution for a specific assignment across all students
 * Optimized with JOIN to fetch all data in one query
 * @param {string} assignmentName - The assignment title
 * @param {string} category - The assignment category
 * @returns {Promise<Array>} Array of {studentName, studentEmail, score, maxPoints}
 */
export async function getAssignmentDistribution(assignmentName, category, courseId = null) {
    const pool = getPool();
    
    // NOTE: We ignore the 'category' parameter because frontend section names
    // don't match database category values. Only match by assignment title.
    let query = `
        SELECT 
            st.legal_name as student_name,
            st.email as student_email,
            s.total_score as score,
            a.max_points
        FROM submissions s
        JOIN assignments a ON s.assignment_id = a.id
        JOIN students st ON s.student_id = st.id
        JOIN courses c ON a.course_id = c.id
        WHERE a.title = $1
          AND s.total_score IS NOT NULL
    `;

    const params = [assignmentName];

    if (courseId) {
        query += ` AND (c.gradescope_course_id::text = $2 OR c.id::text = $2)`;
        params.push(courseId);
    }

    query += ` ORDER BY st.legal_name`;
    
    try {
        const result = await pool.query(query, params);
        
        return result.rows.map(row => ({
            studentName: row.student_name,
            studentEmail: row.student_email,
            score: parseFloat(row.score) || 0,
            maxPoints: parseFloat(row.max_points) || 0,
        }));
    } catch (err) {
        console.error('Error fetching assignment distribution:', err);
        throw err;
    }
}

function normalizeSummaryCategoryName(category = '') {
    return String(category || '').trim().toLowerCase();
}

function isAttendanceSummaryCategory(category = '') {
    const normalized = normalizeSummaryCategoryName(category);
    return normalized.includes('attendance') || normalized.includes('attendence');
}

function getSummaryCapByCategory(category = '') {
    const normalized = normalizeSummaryCategoryName(category);
    if (normalized === 'quest') return QUEST_SUMMARY_CAP;
    if (isAttendanceSummaryCategory(normalized)) return ATTENDANCE_SUMMARY_CAP;
    return null;
}

function normalizeQuestCategoryKey(value = '') {
    const normalized = normalizeComponentKey(value)
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!normalized) return null;
    const direct = QUEST_CATEGORY_ALIASES[normalized];
    if (direct) return direct;

    for (const [alias, canonical] of Object.entries(QUEST_CATEGORY_ALIASES)) {
        if (normalized.includes(alias)) {
            return canonical;
        }
    }

    return null;
}

function toCeilNumber(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.ceil(numeric);
}

function buildQuestComponentCapMap(assignmentMetadata = {}, scoresByQuestion = {}) {
    const capMap = new Map();

    const metadataComponents = Array.isArray(assignmentMetadata?.components)
        ? assignmentMetadata.components
        : [];
    metadataComponents.forEach((component) => {
        const key = normalizeComponentKey(component?.key || component?.name || component?.label);
        const cap = Number(component?.max_points);
        if (key && Number.isFinite(cap) && cap > 0) {
            capMap.set(key, cap);
        }
    });

    const embeddedCaps = scoresByQuestion?.component_caps && typeof scoresByQuestion.component_caps === 'object'
        ? scoresByQuestion.component_caps
        : {};
    Object.entries(embeddedCaps).forEach(([rawKey, rawCap]) => {
        const key = normalizeComponentKey(rawKey);
        const cap = Number(rawCap);
        if (key && Number.isFinite(cap) && cap > 0) {
            capMap.set(key, cap);
        }
    });

    return capMap;
}

function extractQuestComponentScores(scoresByQuestion = {}, componentCaps = new Map()) {
    const componentScores = new Map();
    if (!scoresByQuestion || typeof scoresByQuestion !== 'object') {
        return componentScores;
    }

    for (const [rawKey, rawValue] of Object.entries(scoresByQuestion)) {
        const key = normalizeComponentKey(rawKey);
        if (!key || key === 'source' || key === 'score_perc' || key === 'component caps' || key === 'component_caps') {
            continue;
        }

        const score = Number(rawValue);
        if (!Number.isFinite(score)) {
            continue;
        }

        const cap = Number(componentCaps.get(key));
        const boundedScore = Number.isFinite(cap) && cap > 0
            ? Math.min(score, cap)
            : score;

        const existing = Number(componentScores.get(key));
        if (!Number.isFinite(existing) || boundedScore > existing) {
            componentScores.set(key, boundedScore);
        }
    }

    return componentScores;
}

async function getQuestSummaryDistribution(courseId = null) {
    const pool = getPool();

    let query = `
        SELECT
            st.id AS student_id,
            st.legal_name AS student_name,
            st.email AS student_email,
            s.total_score,
            s.scores_by_question,
            a.title AS assignment_title,
            a.max_points AS assignment_max_points,
            a.assignment_metadata
        FROM students st
        JOIN courses c ON st.course_id = c.id
        LEFT JOIN submissions s ON s.student_id = st.id
        LEFT JOIN assignments a
          ON a.id = s.assignment_id
         AND a.course_id = c.id
         AND LOWER(COALESCE(a.category, '')) = 'quest'
    `;

    const params = [];
    if (courseId) {
        query += ` WHERE (c.gradescope_course_id::text = $1 OR c.id::text = $1)`;
        params.push(String(courseId));
    }

    query += ` ORDER BY st.legal_name, a.title`;

    const result = await pool.query(query, params);

    const extractComponentScore = (rawValue) => {
        const direct = Number(rawValue);
        if (Number.isFinite(direct)) {
            return direct;
        }

        if (rawValue && typeof rawValue === 'object') {
            const candidates = [rawValue.score, rawValue.points, rawValue.value, rawValue.raw];
            for (const candidate of candidates) {
                const numeric = Number(candidate);
                if (Number.isFinite(numeric)) {
                    return numeric;
                }
            }
        }

        const text = String(rawValue ?? '').trim();
        if (!text) return null;

        if (text.includes('/')) {
            const numerator = text.split('/', 1)[0].trim();
            const matched = numerator.match(/-?\d+(?:\.\d+)?/);
            if (matched) {
                const parsed = Number(matched[0]);
                if (Number.isFinite(parsed)) return parsed;
            }
        }

        if (text.endsWith('%')) {
            const parsed = Number(text.slice(0, -1).trim());
            if (Number.isFinite(parsed)) return parsed;
        }

        const matched = text.match(/-?\d+(?:\.\d+)?/);
        if (matched) {
            const parsed = Number(matched[0]);
            if (Number.isFinite(parsed)) return parsed;
        }

        return null;
    };

    const studentMap = new Map();

    result.rows.forEach((row) => {
        const studentId = String(row.student_id);
        if (!studentMap.has(studentId)) {
            studentMap.set(studentId, {
                studentName: row.student_name,
                studentEmail: row.student_email,
                categoryBest: new Map(),
                categoryCaps: new Map(),
            });
        }

        const student = studentMap.get(studentId);
        const hasQuestRow = row.assignment_title != null;
        if (!hasQuestRow) {
            return;
        }

        const scoresByQuestion = row.scores_by_question && typeof row.scores_by_question === 'object'
            ? row.scores_by_question
            : {};

        const scoreLookup = new Map();
        Object.entries(scoresByQuestion).forEach(([rawKey, rawValue]) => {
            const key = normalizeComponentKey(rawKey);
            if (!key || key === 'source' || key === 'score_perc' || key === 'component caps' || key === 'component_caps') {
                return;
            }
            const parsedScore = extractComponentScore(rawValue);
            if (Number.isFinite(parsedScore)) {
                scoreLookup.set(key, parsedScore);
            }
        });

        const assignmentMetadata = row.assignment_metadata && typeof row.assignment_metadata === 'object'
            ? row.assignment_metadata
            : {};
        const components = Array.isArray(assignmentMetadata.components)
            ? assignmentMetadata.components
            : [];

        if (components.length > 0) {
            const assignmentCategoryScores = new Map();
            const assignmentCategoryCaps = new Map();

            components.forEach((component) => {
                const key = normalizeComponentKey(component?.key);
                if (!key) return;

                const categoryRaw = String(component?.category || component?.key || '').trim();
                const categoryKey = normalizeQuestCategoryKey(categoryRaw);
                if (!categoryKey) return;

                const score = Number(scoreLookup.get(key));
                if (Number.isFinite(score)) {
                    assignmentCategoryScores.set(
                        categoryKey,
                        (Number(assignmentCategoryScores.get(categoryKey)) || 0) + score,
                    );
                }

                const cap = Number(component?.max_points);
                if (Number.isFinite(cap) && cap > 0) {
                    assignmentCategoryCaps.set(
                        categoryKey,
                        (Number(assignmentCategoryCaps.get(categoryKey)) || 0) + cap,
                    );
                }
            });

            assignmentCategoryScores.forEach((categoryScore, categoryKey) => {
                const existing = Number(student.categoryBest.get(categoryKey));
                if (!Number.isFinite(existing) || categoryScore > existing) {
                    student.categoryBest.set(categoryKey, categoryScore);
                }
            });

            const assignmentRecognizedTotal = Array.from(assignmentCategoryScores.values()).reduce(
                (sum, value) => sum + (Number(value) || 0),
                0,
            );
            const assignmentTotal = Number(row.total_score);
            const residual = Number.isFinite(assignmentTotal)
                ? Math.max(0, assignmentTotal - assignmentRecognizedTotal)
                : 0;

            if (residual > 0.0001) {
                const existingResidual = Number(student.categoryBest.get(QUEST_UNMAPPED_BUCKET));
                if (!Number.isFinite(existingResidual) || residual > existingResidual) {
                    student.categoryBest.set(QUEST_UNMAPPED_BUCKET, residual);
                }
            }

            assignmentCategoryCaps.forEach((categoryCap, categoryKey) => {
                const oldCap = Number(student.categoryCaps.get(categoryKey));
                if (!Number.isFinite(oldCap) || categoryCap > oldCap) {
                    student.categoryCaps.set(categoryKey, categoryCap);
                }
            });

            return;
        }

        scoreLookup.forEach((score, key) => {
            const categoryKey = normalizeQuestCategoryKey(key);
            if (!categoryKey) return;

            const existing = Number(student.categoryBest.get(categoryKey));
            if (!Number.isFinite(existing) || score > existing) {
                student.categoryBest.set(categoryKey, score);
            }
        });
    });

    return Array.from(studentMap.values()).map((student) => {
        let categoryTotal = 0;
        student.categoryBest.forEach((bestScore, categoryKey) => {
            const cap = Number(student.categoryCaps.get(categoryKey));
            categoryTotal += Number.isFinite(cap) && cap > 0
                ? Math.min(bestScore, cap)
                : bestScore;
        });

        return {
            studentName: student.studentName,
            studentEmail: student.studentEmail,
            score: Math.min(QUEST_SUMMARY_CAP, toCeilNumber(categoryTotal)),
        };
    });
}

async function getAttendanceSummaryDistribution(category, courseId = null) {
    const pool = getPool();
    const normalizedCategory = normalizeSummaryCategoryName(category);

    let query = `
        SELECT
            st.id AS student_id,
            st.legal_name AS student_name,
            st.email AS student_email,
            s.total_score,
            s.max_points AS submission_max_points,
            a.max_points AS assignment_max_points
        FROM students st
        JOIN courses c ON st.course_id = c.id
        LEFT JOIN submissions s ON s.student_id = st.id
        LEFT JOIN assignments a
          ON a.id = s.assignment_id
         AND a.course_id = c.id
         AND LOWER(COALESCE(a.category, '')) = $1
        WHERE 1=1
    `;

    const params = [normalizedCategory];
    if (courseId) {
        query += ` AND (c.gradescope_course_id::text = $2 OR c.id::text = $2)`;
        params.push(String(courseId));
    }

    query += ` ORDER BY st.legal_name`;

    const result = await pool.query(query, params);
    const studentMap = new Map();

    result.rows.forEach((row) => {
        const studentId = String(row.student_id);
        if (!studentMap.has(studentId)) {
            studentMap.set(studentId, {
                studentName: row.student_name,
                studentEmail: row.student_email,
                passCount: 0,
            });
        }

        const hasAttendanceRow = row.assignment_max_points != null;
        if (!hasAttendanceRow) {
            return;
        }

        const score = Number(row.total_score);
        const submissionMax = Number(row.submission_max_points);
        const assignmentMax = Number(row.assignment_max_points);
        const denominator = Number.isFinite(submissionMax) && submissionMax > 0
            ? submissionMax
            : (Number.isFinite(assignmentMax) && assignmentMax > 0 ? assignmentMax : 0);

        const passed = Number.isFinite(score)
            && (
                score >= 1
                || (denominator > 0 && (score / denominator) >= 0.6)
            );

        if (passed) {
            const student = studentMap.get(studentId);
            student.passCount += 1;
        }
    });

    return Array.from(studentMap.values()).map((student) => ({
        studentName: student.studentName,
        studentEmail: student.studentEmail,
        score: Math.min(ATTENDANCE_SUMMARY_CAP, toCeilNumber(student.passCount)),
    }));
}

/**
 * Gets score distribution for category summary (sum of all assignments in category)
 * @param {string} category - The assignment category (may not match DB, legacy parameter)
 * @returns {Promise<Array>} Array of {studentName, studentEmail, score}
 */
export async function getCategorySummaryDistribution(category, courseId = null) {
    const normalizedCategory = normalizeSummaryCategoryName(category);
    if (normalizedCategory === 'quest') {
        return getQuestSummaryDistribution(courseId);
    }

    if (isAttendanceSummaryCategory(normalizedCategory)) {
        return getAttendanceSummaryDistribution(category, courseId);
    }

    const pool = getPool();
    
    let query = `
        SELECT 
            st.legal_name as student_name,
            st.email as student_email,
            SUM(s.total_score) as total_score
        FROM submissions s
        JOIN assignments a ON s.assignment_id = a.id
        JOIN students st ON s.student_id = st.id
        JOIN courses c ON a.course_id = c.id
                WHERE COALESCE(a.category, 'Uncategorized') = $1
          AND s.total_score IS NOT NULL
    `;

    const params = [category];

    if (courseId) {
        query += ` AND (c.gradescope_course_id::text = $2 OR c.id::text = $2)`;
        params.push(courseId);
    }

    query += `
        GROUP BY st.id, st.legal_name, st.email
        HAVING SUM(s.total_score) > 0
        ORDER BY st.legal_name
    `;
    
    try {
        const result = await pool.query(query, params);
        
        return result.rows.map(row => ({
            studentName: row.student_name,
            studentEmail: row.student_email,
            score: toCeilNumber(row.total_score),
        }));
    } catch (err) {
        console.error('Error fetching category summary distribution:', err);
        throw err;
    }
}

/**
 * Gets score distribution for assignments by their titles (for section summaries)
 * @param {string[]} assignmentTitles - Array of assignment titles to sum
 * @returns {Promise<Array>} Array of {studentName, studentEmail, score}
 */
export async function getAssignmentsSummaryDistribution(assignmentTitles) {
    const pool = getPool();
    
    if (!assignmentTitles || assignmentTitles.length === 0) {
        return [];
    }
    
    // Create placeholders for parameterized query: $1, $2, $3, ...
    const placeholders = assignmentTitles.map((_, i) => `$${i + 1}`).join(', ');
    
    const query = `
        SELECT 
            st.legal_name as student_name,
            st.email as student_email,
            SUM(s.total_score) as total_score
        FROM submissions s
        JOIN assignments a ON s.assignment_id = a.id
        JOIN students st ON s.student_id = st.id
        WHERE a.title IN (${placeholders})
          AND s.total_score IS NOT NULL
        GROUP BY st.id, st.legal_name, st.email
        ORDER BY st.legal_name
    `;
    
    try {
        const result = await pool.query(query, assignmentTitles);
        
        return result.rows.map(row => ({
            studentName: row.student_name,
            studentEmail: row.student_email,
            score: parseFloat(row.total_score) || 0,
        }));
    } catch (err) {
        console.error('Error fetching assignments summary distribution:', err);
        throw err;
    }
}

/**
 * Gets all student scores in one query
 * Returns data in the format expected by admin UI
 * @returns {Promise<Array>} Array of {name, email, scores: {category: {assignmentName: score}}}
 */
export async function getAllStudentScores(courseId = null) {
    const pool = getPool();
    
    let query = `
        SELECT 
            st.legal_name as student_name,
            st.email as student_email,
            COALESCE(a.category, 'Uncategorized') as category,
            a.title as assignment_name,
            s.total_score
        FROM students st
        LEFT JOIN submissions s ON st.id = s.student_id
        LEFT JOIN assignments a ON s.assignment_id = a.id
    `;

    const params = [];
    if (courseId) {
        query += `
            JOIN courses c ON a.course_id = c.id
            WHERE (c.gradescope_course_id::text = $1 OR c.id::text = $1)
        `;
        params.push(courseId);
    }

    query += ` ORDER BY st.email, COALESCE(a.category, 'Uncategorized'), a.title`;
    
    try {
        const result = await pool.query(query, params);
        
        // Group by student, then by category, then by assignment
        const studentMap = new Map();
        
        result.rows.forEach(row => {
            const email = row.student_email;
            
            if (!studentMap.has(email)) {
                studentMap.set(email, {
                    name: row.student_name || 'Unknown',
                    email: email,
                    scores: {}
                });
            }
            
            const student = studentMap.get(email);
            
            // Only add scores if assignment exists
            if (row.category && row.assignment_name) {
                if (!student.scores[row.category]) {
                    student.scores[row.category] = {};
                }
                student.scores[row.category][row.assignment_name] = row.total_score;
            }
        });
        
        return Array.from(studentMap.values());
    } catch (err) {
        console.error('Error fetching all student scores:', err);
        throw err;
    }
}

/**
 * Gets students with submissions in a specific course.
 * @param {string} courseId - Course ID or Gradescope course ID
 * @returns {Promise<Array<Array<string>>>} List of [legalName, email]
 */
export async function getStudentsByCourse(courseId) {
    const pool = getPool();

    const query = `
        SELECT DISTINCT
            COALESCE(st.legal_name, st.email) AS student_name,
            st.email AS student_email
        FROM submissions s
        JOIN students st ON s.student_id = st.id
        JOIN assignments a ON s.assignment_id = a.id
        JOIN courses c ON a.course_id = c.id
        WHERE (c.gradescope_course_id::text = $1 OR c.id::text = $1)
        ORDER BY student_name ASC
    `;

    try {
        const result = await pool.query(query, [courseId]);
        return result.rows.map((row) => [row.student_name, row.student_email]);
    } catch (err) {
        console.error('Error fetching students by course:', err);
        throw err;
    }
}

/**
 * Gets class average percentage for each category
 * @returns {Promise<Object>} Object with category names as keys and average percentages as values
 */
export async function getCategoryAverages(courseId = null) {
    const pool = getPool();
    
    try {
        let query = `
            SELECT 
                a.category,
                AVG((s.total_score / NULLIF(a.max_points, 0)) * 100) as avg_percentage
            FROM submissions s
            JOIN assignments a ON s.assignment_id = a.id
            JOIN courses c ON a.course_id = c.id
            WHERE a.category IS NOT NULL 
              AND a.category != 'Uncategorized'
              AND a.category != 'uncategorized'
              AND s.total_score IS NOT NULL
              AND a.max_points > 0
        `;

        const params = [];
        if (courseId) {
            query += ` AND (c.gradescope_course_id::text = $1 OR c.id::text = $1)`;
            params.push(courseId);
        }

        query += ` GROUP BY a.category`;
        
        const result = await pool.query(query, params);
        
        const categoryAverages = {};
        result.rows.forEach(row => {
            const avgPercentage = parseFloat(row.avg_percentage);
            categoryAverages[row.category] = isNaN(avgPercentage) ? 0 : parseFloat(avgPercentage.toFixed(2));
        });
        
        return categoryAverages;
    } catch (err) {
        console.error('Error fetching category averages:', err);
        throw err;
    }
}

/**
 * Gets assignment max points grouped by category for a course.
 * @param {string|null} courseId - Optional internal/gradescope course id filter
 * @returns {Promise<Object>} Object shaped like { category: { assignmentTitle: maxPoints } }
 */
export async function getCourseAssignmentMatrix(courseId = null) {
    const pool = getPool();

    let query = `
        SELECT
            COALESCE(a.category, 'Uncategorized') AS category,
            a.title AS assignment_name,
            a.max_points,
            c.id AS course_id,
            c.gradescope_course_id
        FROM assignments a
        JOIN courses c ON a.course_id = c.id
    `;

    const params = [];
    if (courseId) {
        query += ` WHERE (c.gradescope_course_id::text = $1 OR c.id::text = $1)`;
        params.push(String(courseId));
    }

    query += ` ORDER BY category, assignment_name`;

    const result = await pool.query(query, params);
    const matrix = {};

    result.rows.forEach((row) => {
        const category = row.category || 'Uncategorized';
        if (!matrix[category]) {
            matrix[category] = {};
        }
        matrix[category][row.assignment_name] = Number(row.max_points) || 0;
    });

    return matrix;
}

/**
 * Gets total possible score (sum of assignment max points) for a course.
 * @param {string|null} courseId - Optional internal/gradescope course id filter
 * @returns {Promise<number>}
 */
export async function getCourseTotalPossibleScore(courseId = null) {
    const pool = getPool();

    let query = `
        SELECT COALESCE(SUM(a.max_points), 0) AS total_points
        FROM assignments a
        JOIN courses c ON a.course_id = c.id
    `;

    const params = [];
    if (courseId) {
        query += ` WHERE (c.gradescope_course_id::text = $1 OR c.id::text = $1)`;
        params.push(String(courseId));
    }

    const result = await pool.query(query, params);
    return Number(result.rows?.[0]?.total_points) || 0;
}

/**
 * Gets all students (name/email) from database, optionally filtered by course.
 * @param {string|null} courseId - Optional internal/gradescope course id filter
 * @returns {Promise<Array<Array<string>>>} List of [legalName, email]
 */
export async function getAllStudentsFromDb(courseId = null) {
    const pool = getPool();

    let query = `
        SELECT DISTINCT
            COALESCE(st.legal_name, st.email) AS student_name,
            st.email AS student_email
        FROM students st
        JOIN courses c ON st.course_id = c.id
    `;

    const params = [];
    if (courseId) {
        query += ` WHERE (c.gradescope_course_id::text = $1 OR c.id::text = $1)`;
        params.push(String(courseId));
    }

    query += ` ORDER BY student_name ASC`;

    const result = await pool.query(query, params);
    return result.rows.map((row) => [row.student_name, row.student_email]);
}

/**
 * Closes the database connection pool
 */
export async function closePool() {
    if (pool) {
        await pool.end();
        pool = null;
    }
}
