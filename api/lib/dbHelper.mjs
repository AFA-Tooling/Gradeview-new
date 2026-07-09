import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    getCoursePolicy,
    getCoursePolicyComponents,
    getCoursePolicyProjectItems,
    getPolicyComponentForSummary,
    getPolicySummaryCap,
    normalizePolicyKey,
} from './coursePolicy.mjs';
import {
    buildCanonicalGrade,
    buildPolicySummary,
    canonicalGradeToGradeFlowTotal,
    canonicalGradeToLegacySummary,
    resolveQuestPolicyScore,
} from './canonicalGrade.mjs';
import { buildPolicySummaryFromComponentMaps } from './policySummaryBuilder.mjs';

export { buildPolicySummaryFromComponentMaps } from './policySummaryBuilder.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') }); // Relative to api/lib/ is ../../

let pool = null;

const QUEST_SUMMARY_CAP = 25;
const MIDTERM_SUMMARY_CAP = 50;
const POSTTERM_SUMMARY_CAP = 75;
const ATTENDANCE_SUMMARY_CAP = 15;
const LABS_SUMMARY_CAP = 80;
const PROJECTS_SUMMARY_CAP = 155;

const COURSE_POLICY_COMPONENTS = [
    { key: 'attendance', label: 'Attendance / Participation', cap: ATTENDANCE_SUMMARY_CAP },
    { key: 'labs', label: 'Labs', cap: LABS_SUMMARY_CAP },
    { key: 'projects', label: 'Projects', cap: PROJECTS_SUMMARY_CAP },
    { key: 'quest', label: 'Quest', cap: QUEST_SUMMARY_CAP },
    { key: 'midterm', label: 'Midterm', cap: MIDTERM_SUMMARY_CAP },
    { key: 'postterm', label: 'Postterm', cap: POSTTERM_SUMMARY_CAP },
];

const POLICY_SUMMARY_CACHE_TTL_MS = Math.max(
    0,
    Number(process.env.POLICY_SUMMARY_CACHE_TTL_MS || 30000),
);
const policySummaryCache = new Map();

function getPolicySummaryCacheKey(courseId = null) {
    return String(courseId || '__all_courses__');
}

async function buildCoursePolicySummaryMaps(courseId = null) {
    const policy = await getCoursePolicy(courseId, getPool());
    const components = getCoursePolicyComponents(policy);
    const byComponent = await Promise.all(
        components.map(async (component) => {
            const rows = await getCategorySummaryDistribution(
                component.summary_source || component.label,
                courseId,
                { policy, component },
            );
            const rowMap = new Map();
            (rows || []).forEach((row) => {
                const email = String(row?.studentEmail || '').trim().toLowerCase();
                if (!email) return;
                rowMap.set(email, {
                    exactScore: Number(row?.exactScore ?? row?.score) || 0,
                    status: String(row?.status || 'available'),
                    source: String(row?.source || component.summary_source || component.label),
                });
            });
            return { component, rowMap };
        }),
    );

    return {
        policy,
        components,
        byComponent,
        asOf: new Date().toISOString(),
    };
}

async function getCoursePolicySummaryMaps(courseId = null) {
    const cacheKey = getPolicySummaryCacheKey(courseId);
    const now = Date.now();
    const cached = policySummaryCache.get(cacheKey);

    if (POLICY_SUMMARY_CACHE_TTL_MS > 0 && cached && cached.expiresAt > now) {
        return cached.promise || cached.value;
    }

    const promise = buildCoursePolicySummaryMaps(courseId);
    if (POLICY_SUMMARY_CACHE_TTL_MS > 0) {
        policySummaryCache.set(cacheKey, {
            expiresAt: now + POLICY_SUMMARY_CACHE_TTL_MS,
            promise,
        });
    }

    try {
        const value = await promise;
        if (POLICY_SUMMARY_CACHE_TTL_MS > 0) {
            policySummaryCache.set(cacheKey, {
                expiresAt: Date.now() + POLICY_SUMMARY_CACHE_TTL_MS,
                value,
            });
        }
        return value;
    } catch (err) {
        policySummaryCache.delete(cacheKey);
        throw err;
    }
}

export function clearPolicySummaryCache(courseId = null) {
    if (courseId) {
        policySummaryCache.delete(getPolicySummaryCacheKey(courseId));
        return;
    }
    policySummaryCache.clear();
}

const PROJECT_POLICY_CAPS = [
    { key: '1', label: 'Project 1: Wordle™-lite', cap: 15, patterns: [/\bproject\s*1\b/i] },
    { key: '2', label: 'Project 2: Spelling Bee', cap: 25, patterns: [/\bproject\s*2\b/i] },
    { key: '3', label: 'Project 3: 2048', cap: 35, patterns: [/\bproject\s*3\b/i] },
    { key: '4', label: 'Project 4: Explore', cap: 20, patterns: [/\bproject\s*4\b/i] },
    { key: '5', label: 'Final Project', cap: 60, patterns: [/\bproject\s*5\b/i, /\bfinal\s+project\b/i] },
];

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

const POSTTERM_TOPIC_ORDER = [
    'Programming Paradigms',
    'HCI',
    'Generative AI',
    'Ethics in AI',
    'Python Advanced',
    'Generic Base Conversion',
    'Concurrency',
    'HOFs I',
    'Coding Python',
    'Snap!',
];

const POSTTERM_TOPIC_ALIASES = {
    'programming paradigms': 'Programming Paradigms',
    'hci': 'HCI',
    'sp26 hci almeda': 'HCI',
    'fa25 hci aveni': 'HCI',
    'human computer interaction': 'HCI',
    'human-computer interaction': 'HCI',
    'genai': 'Generative AI',
    'generative ai': 'Generative AI',
    'ethics in ai': 'Ethics in AI',
    'ethics ai': 'Ethics in AI',
    'python advanced': 'Python Advanced',
    'generic base conversion': 'Generic Base Conversion',
    'base conversion': 'Generic Base Conversion',
    'number representation': 'Generic Base Conversion',
    'concurrency': 'Concurrency',
    'concurrency race': 'Concurrency',
    'concurrency race deadlock': 'Concurrency',
    'hofs i': 'HOFs I',
    'hof i': 'HOFs I',
    'hofs': 'HOFs I',
    'higher order functions': 'HOFs I',
    'higher-order functions': 'HOFs I',
    'coding python data structures': 'Coding Python',
    'coding python': 'Coding Python',
    'autograder': 'Snap!',
    '1: autograder (20.0 pts)': 'Snap!',
    '1: autograder (10.0 pts)': 'Snap!',
};

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
                connectionTimeoutMillis: 30000, // Allow more time under bursty load
                keepAlive: true, // Enable keep-alive to avoid timeouts from the proxy
                keepAliveInitialDelayMillis: 10000,
                maxLifetimeSeconds: 300,
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
                connectionTimeoutMillis: 30000,
                keepAlive: true,
                keepAliveInitialDelayMillis: 10000,
                maxLifetimeSeconds: 300,
            };
        }
        
        pool = new Pool(poolConfig);
        
        pool.on('error', (err) => {
            console.error('PostgreSQL pool error:', err);
        });
    }
    
    return pool;
}

function safeJsonObject(value) {
    if (!value) return {};
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return {};
}

function firstPresentValue(...values) {
    return values.find((value) => value !== undefined && value !== null && value !== '');
}

function normalizeDateValue(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function resolveAssignmentDueAt(row = {}) {
    const metadata = safeJsonObject(row.assignment_metadata);
    const submissionWindow = safeJsonObject(metadata.submission_window || metadata.submissionWindow);
    const dates = safeJsonObject(metadata.dates);

    return normalizeDateValue(firstPresentValue(
        row.due_at,
        row.exam_due_at,
        metadata.due,
        metadata.due_at,
        metadata.dueAt,
        metadata.due_date,
        metadata.dueDate,
        metadata.deadline,
        metadata.deadline_at,
        metadata.deadlineAt,
        submissionWindow.due_date,
        submissionWindow.dueDate,
        submissionWindow.due_at,
        submissionWindow.dueAt,
        dates.due,
        dates.due_at,
        dates.dueAt,
    ));
}

export function resolveAssignmentReleaseAt(row = {}) {
    const metadata = safeJsonObject(row.assignment_metadata);
    const submissionWindow = safeJsonObject(metadata.submission_window || metadata.submissionWindow);
    const dates = safeJsonObject(metadata.dates);

    return normalizeDateValue(firstPresentValue(
        row.release_at,
        row.exam_release_at,
        metadata.release,
        metadata.release_at,
        metadata.releaseAt,
        metadata.release_date,
        metadata.releaseDate,
        submissionWindow.release_date,
        submissionWindow.releaseDate,
        submissionWindow.release_at,
        submissionWindow.releaseAt,
        dates.release,
        dates.release_at,
        dates.releaseAt,
    ));
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
            a.assignment_metadata,
            eam.due_at AS exam_due_at,
            eam.release_at AS exam_release_at,
            c.name as course_name,
            c.semester,
            c.year
        FROM submissions s
        JOIN assignments a ON s.assignment_id = a.id
        JOIN students st ON s.student_id = st.id
        JOIN courses c ON a.course_id = c.id
        LEFT JOIN exam_attempt_map eam
          ON eam.assignment_id = a.id
         AND eam.course_id = c.id
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
            dueAt: resolveAssignmentDueAt(row),
            releaseAt: resolveAssignmentReleaseAt(row),
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
                s.lateness,
                a.assignment_metadata,
                eam.due_at AS exam_due_at,
                eam.release_at AS exam_release_at
            FROM assignments a
            JOIN courses c ON a.course_id = c.id
            LEFT JOIN students st ON st.email = $1 AND st.course_id = c.id
            LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = st.id
            LEFT JOIN exam_attempt_map eam
              ON eam.assignment_id = a.id
             AND eam.course_id = c.id
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
                s.lateness,
                a.assignment_metadata,
                eam.due_at AS exam_due_at,
                eam.release_at AS exam_release_at
            FROM submissions s
            JOIN assignments a ON s.assignment_id = a.id
            JOIN students st ON s.student_id = st.id
            JOIN courses c ON a.course_id = c.id
            LEFT JOIN exam_attempt_map eam
              ON eam.assignment_id = a.id
             AND eam.course_id = c.id
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
                dueAt: resolveAssignmentDueAt(row),
                releaseAt: resolveAssignmentReleaseAt(row),
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
    return parseExamAttemptNo(title, 'quest');
}

function parseExamAttemptNo(title, examType) {
    const text = String(title || '');
    const type = String(examType || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = text.match(new RegExp(`\\b${type}\\s*[-:]?\\s*(\\d+)`, 'i'));
    if (!match) return null;
    const attemptNo = Number(match[1]);
    return Number.isFinite(attemptNo) ? attemptNo : null;
}

function canonicalizeExamComponentName(examType, value, assignmentTitle = '') {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const key = normalizeComponentKey(raw)
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const titleKey = normalizeComponentKey(assignmentTitle)
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (examType === 'postterm') {
        if (key.includes('survey') || key.startsWith('pledge')) return null;
        if (key === 'python') {
            return titleKey.includes('with python') || titleKey.includes('with snap')
                ? 'Coding Python'
                : 'Python Advanced';
        }
        if (key.includes('autograder')) {
            return 'Snap!';
        }
        return POSTTERM_TOPIC_ALIASES[key] || null;
    }

    if (examType === 'midterm') {
        if (key === 'scoping') return 'Scope';
        if (key === 'recursion') return 'Recursion Tracing';
        if (key.includes('autograder')) return 'Fractal';
    }

    return raw;
}

/**
 * Gets Quest component progression curves for a student.
 * Curves represent cumulative best percentages after Quest-1, Quest-2, Quest-3.
 * @param {string} email
 * @param {string|null} courseId
 * @returns {Promise<{components:string[], series:Array<{name:string,data:number[]}>}>}
 */
export async function getStudentQuestComponentTrend(email, courseId = null) {
    const trends = await getStudentExamComponentTrends(email, courseId);
    return trends.quest;
}

export async function getStudentExamComponentTrends(email, courseId = null) {
    const pool = getPool();

    const questComponentOrder = [
        'Abstraction',
        'Number Representation',
        'Iteration',
        'Domain and Range',
        'Booleans',
        'Functions',
        'HOFs I',
    ];
    const examLabels = {
        quest: 'Quest',
        midterm: 'Midterm',
        postterm: 'Postterm',
    };
    const metadataKeys = new Set([
        'source',
        'score_perc',
        'component caps',
        'component_caps',
        'components',
        'assessment_number',
        'assessment label',
        'assessment_label',
        'assessment name',
        'assessment_name',
        'column',
        'directions',
        'instructions',
        'pledge',
        'survey',
    ]);

    let query = `
        SELECT
            a.id AS assignment_id,
            a.title AS assignment_title,
            a.max_points AS assignment_max_points,
            a.assignment_metadata,
            s.total_score,
            s.max_points AS submission_max_points,
            s.scores_by_question,
            LOWER(COALESCE(e.exam_type, '')) AS exam_type,
            e.attempt_no
        FROM students st
        JOIN courses c ON c.id = st.course_id
        JOIN submissions s ON s.student_id = st.id
        JOIN assignments a ON a.id = s.assignment_id AND a.course_id = c.id
        JOIN exam_attempt_map e
            ON e.assignment_id = a.id
           AND e.course_id = c.id
        WHERE st.email = $1
          AND LOWER(COALESCE(e.exam_type, '')) IN ('quest', 'midterm', 'postterm')
          AND COALESCE(e.is_practice, false) = false
    `;

    const params = [email];
    if (courseId) {
        query += ` AND (c.id::text = $2 OR c.gradescope_course_id::text = $2)`;
        params.push(String(courseId));
    }

    query += ` ORDER BY a.title`;

    const result = await pool.query(query, params);

    const byExam = {
        quest: { componentOrder: [...questComponentOrder], componentSet: new Set(questComponentOrder), componentCaps: new Map(), attemptMap: new Map() },
        midterm: { componentOrder: [], componentSet: new Set(), componentCaps: new Map(), attemptMap: new Map() },
        postterm: { componentOrder: [...POSTTERM_TOPIC_ORDER], componentSet: new Set(POSTTERM_TOPIC_ORDER), componentCaps: new Map(), attemptMap: new Map() },
    };

    const addComponent = (examType, componentName, cap = null) => {
        const holder = byExam[examType];
        if (!holder || !componentName) return;
        if (!holder.componentSet.has(componentName)) {
            holder.componentSet.add(componentName);
            holder.componentOrder.push(componentName);
        }
        const numericCap = Number(cap);
        if (Number.isFinite(numericCap) && numericCap > 0) {
            const existingCap = Number(holder.componentCaps.get(componentName));
            if (!Number.isFinite(existingCap) || numericCap > existingCap) {
                holder.componentCaps.set(componentName, numericCap);
            }
        }
    };

    for (const row of result.rows) {
        const examType = String(row.exam_type || '').trim().toLowerCase();
        if (!byExam[examType]) {
            continue;
        }
        const attemptNo = Number(row.attempt_no)
            || parseExamAttemptNo(row.assignment_title, examType);
        if (!attemptNo || attemptNo < 1) {
            continue;
        }

        const assignmentMetadata = row.assignment_metadata && typeof row.assignment_metadata === 'object'
            ? row.assignment_metadata
            : {};
        const components = Array.isArray(assignmentMetadata.components) ? assignmentMetadata.components : [];
        const componentCapsByKey = buildExamComponentCapMap(
            examType,
            row.assignment_title,
            assignmentMetadata,
            row.scores_by_question || {},
            row.assignment_max_points ?? row.submission_max_points,
        );
        const componentLabelByKey = new Map();
        for (const component of components) {
            const key = normalizeComponentKey(component?.key || component?.name || component?.label);
            if (!key) continue;
            if (metadataKeys.has(key) || key.includes('survey') || key.startsWith('pledge')) continue;
            const rawLabel = String(component?.key || component?.name || component?.label || '').trim();
            const label = canonicalizeExamComponentName(examType, rawLabel, row.assignment_title);
            if (label) {
                componentLabelByKey.set(key, label);
                const cap = Number(componentCapsByKey.get(normalizeComponentKey(label)));
                addComponent(examType, label, cap);
            }
        }

        const scoresByQuestion = row.scores_by_question && typeof row.scores_by_question === 'object'
            ? row.scores_by_question
            : {};

        const holder = byExam[examType];
        const attempt = holder.attemptMap.get(attemptNo) || new Map();
        const aggregateAdjustments = distributeAggregateExamScores(examType, scoresByQuestion, componentCapsByKey);

        for (const [rawKey, rawValue] of Object.entries(scoresByQuestion)) {
            const key = normalizeComponentKey(rawKey);
            if (!key || metadataKeys.has(key)) continue;
            if (key.includes('survey') || key.startsWith('pledge')) continue;

            const label = componentLabelByKey.get(key) || canonicalizeExamComponentName(examType, rawKey, row.assignment_title);
            if (!label) continue;

            const score = Number(rawValue);
            const cap = Number(componentCapsByKey.get(normalizeComponentKey(label)));
            if (!Number.isFinite(score) || !Number.isFinite(cap) || cap <= 0) {
                continue;
            }

            addComponent(examType, label, cap);
            const existing = attempt.get(label) || { score: 0, cap: 0 };
            attempt.set(label, {
                score: existing.score + Math.min(Math.max(score, 0), cap),
                cap: existing.cap > 0 ? existing.cap : cap,
            });
        }

        aggregateAdjustments.forEach((score, label) => {
            addComponent(examType, label);
            const cap = Number(componentCapsByKey.get(normalizeComponentKey(label)));
            if (!Number.isFinite(score) || !Number.isFinite(cap) || cap <= 0) return;
            addComponent(examType, label, cap);
            const existing = attempt.get(label) || { score: 0, cap: 0 };
            attempt.set(label, {
                score: Math.min(cap, existing.score + score),
                cap: existing.cap > 0 ? existing.cap : cap,
            });
        });

        holder.attemptMap.set(attemptNo, attempt);
    }

    const buildTrend = (examType) => {
        const holder = byExam[examType];
        const components = holder.componentOrder;
        const attemptNos = Array.from(holder.attemptMap.keys()).sort((a, b) => a - b);
        if (components.length === 0 || attemptNos.length === 0) {
            return { components: [], componentCaps: [], series: [] };
        }

        const getAttemptPct = (attemptNo, componentName) => {
            const item = holder.attemptMap.get(attemptNo);
            if (!item) return 0;
            const value = item.get(componentName);
            const score = Number(value?.score);
            const cap = Number(value?.cap);
            if (!Number.isFinite(score) || !Number.isFinite(cap) || cap <= 0) return 0;
            return Math.max(0, Math.min(100, (score / cap) * 100));
        };

        let cumulative = components.map(() => 0);
        const label = examLabels[examType] || examType;
        const series = attemptNos.map((attemptNo) => {
            const raw = components.map((componentName) => getAttemptPct(attemptNo, componentName));
            cumulative = raw.map((value, index) => Math.max(value, cumulative[index] || 0));
            return {
                name: `After ${label}-${attemptNo}${attemptNo === attemptNos[0] ? '' : ' (Cumulative Best)'}`,
                data: cumulative.map((value) => Number(value.toFixed(2))),
            };
        });

        return {
            components,
            componentCaps: components.map((componentName) => {
                const cap = Number(holder.componentCaps.get(componentName));
                return Number.isFinite(cap) && cap > 0 ? cap : null;
            }),
            series,
        };
    };

    return {
        quest: buildTrend('quest'),
        midterm: buildTrend('midterm'),
        postterm: buildTrend('postterm'),
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

function getPolicyComponentCapByType(policy, type, fallback = null) {
    const normalizedType = String(type || '').trim().toLowerCase();
    const component = getCoursePolicyComponents(policy).find((item) => (
        String(item?.type || '').trim().toLowerCase() === normalizedType
        || normalizePolicyKey(item?.key || '') === normalizedType
    ));
    const cap = Number(component?.cap);
    return Number.isFinite(cap) && cap > 0 ? cap : fallback;
}

function isAttendanceSummaryCategory(category = '') {
    const normalized = normalizeSummaryCategoryName(category);
    return normalized.includes('attendance') || normalized.includes('attendence');
}

function getSummaryCapByCategory(category = '') {
    const normalized = normalizeSummaryCategoryName(category);
    if (normalized === 'quest') return QUEST_SUMMARY_CAP;
    if (normalized.includes('midterm')) return MIDTERM_SUMMARY_CAP;
    if (normalized.includes('postterm') || normalized.includes('posterm')) return POSTTERM_SUMMARY_CAP;
    if (isAttendanceSummaryCategory(normalized)) return ATTENDANCE_SUMMARY_CAP;
    return null;
}

export async function getConfiguredSummaryCap(category = '', courseId = null) {
    const policy = await getCoursePolicy(courseId, getPool());
    const configuredCap = getPolicySummaryCap(category, policy);
    if (Number.isFinite(Number(configuredCap)) && Number(configuredCap) > 0) {
        return Number(configuredCap);
    }
    return getSummaryCapByCategory(category);
}

function policyProjectRegex(pattern = '') {
    try {
        return new RegExp(pattern, 'i');
    } catch {
        return new RegExp(String(pattern || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }
}

function detectPolicyProject(title = '', policy = null) {
    const projectItems = policy ? getCoursePolicyProjectItems(policy) : PROJECT_POLICY_CAPS;
    return projectItems.find((project) => {
        const patterns = Array.isArray(project.patterns) ? project.patterns : [];
        return patterns.some((pattern) => {
            if (pattern instanceof RegExp) {
                return pattern.test(title || '');
            }
            return policyProjectRegex(pattern).test(title || '');
        });
    }) || null;
}

async function getExamSummaryDistribution(examType, capPoints, courseId = null, options = {}) {
    const pool = getPool();
    const normalizedExamType = String(examType || '').trim().toLowerCase();
    const includePosttermClobber = Boolean(options.includePosttermClobber);
    const rawCategory = options.rawCategory || null;

    let query = `
        SELECT
            st.id AS student_id,
            st.legal_name AS student_name,
            st.email AS student_email,
            MAX(CASE
                WHEN LOWER(COALESCE(e.exam_type, '')) = $1
                THEN COALESCE(e.final_percentage, e.question_best_percentage, e.clobbered_percentage, e.raw_percentage)
                ELSE NULL
            END) AS primary_best_percentage,
            MAX(CASE
                WHEN LOWER(COALESCE(e.exam_type, '')) = 'postterm'
                THEN COALESCE(e.final_percentage, e.question_best_percentage, e.clobbered_percentage, e.raw_percentage)
                ELSE NULL
            END) AS postterm_best_percentage
        FROM students st
        JOIN courses c ON st.course_id = c.id
        LEFT JOIN student_exam_effective_scores e
          ON e.student_id = st.id
         AND e.course_id = c.id
        WHERE 1=1
    `;

    const params = [normalizedExamType];
    if (courseId) {
        query += ` AND (c.gradescope_course_id::text = $2 OR c.id::text = $2)`;
        params.push(String(courseId));
    }

    query += `
        GROUP BY st.id, st.legal_name, st.email
        ORDER BY st.legal_name
    `;

    const result = await pool.query(query, params);
    const hasEffectiveData = result.rows.some((row) => (
        toOptionalNumber(row.primary_best_percentage) != null
        || (includePosttermClobber && toOptionalNumber(row.postterm_best_percentage) != null)
    ));

    if (!hasEffectiveData && rawCategory) {
        return getRawCategorySummaryDistribution(rawCategory, courseId, capPoints);
    }

    return result.rows.map((row) => {
        const primaryBestPct = toOptionalNumber(row.primary_best_percentage);
        const posttermBestPct = toOptionalNumber(row.postterm_best_percentage);

        let effectivePct = primaryBestPct ?? 0;
        if (includePosttermClobber && posttermBestPct != null) {
            effectivePct = Math.max(effectivePct, posttermBestPct);
        }

        const rawScore = (effectivePct / 100) * capPoints;
        const hasPolicyEvidence = primaryBestPct != null
            || (includePosttermClobber && posttermBestPct != null);
        return {
            studentName: row.student_name,
            studentEmail: row.student_email,
            score: Math.min(capPoints, toExactNumber(rawScore)),
            status: hasPolicyEvidence ? 'available' : 'unavailable',
            source: `student_exam_effective_scores:${normalizedExamType}`,
        };
    });
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

function toExactNumber(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return numeric;
}

function toOptionalNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
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

function buildExamComponentCapMap(examType, assignmentTitle, assignmentMetadata = {}, scoresByQuestion = {}, assignmentMaxPoints = null) {
    const rawCapMap = buildQuestComponentCapMap(assignmentMetadata, scoresByQuestion);
    const capMap = new Map();
    rawCapMap.forEach((cap, rawKey) => {
        const canonical = canonicalizeExamComponentName(examType, rawKey, assignmentTitle);
        if (!canonical) return;
        const key = normalizeComponentKey(canonical);
        capMap.set(key, Number(capMap.get(key) || 0) + Number(cap));
    });

    if (capMap.size === 0) {
        const metadata = assignmentMetadata && typeof assignmentMetadata === 'object' ? assignmentMetadata : {};
        const source = String(metadata.source || '').trim().toLowerCase();
        if (source !== 'prairielearn') {
            const scoreKeys = Object.keys(scoresByQuestion || {}).filter((key) => !isGraphMetadataScoreKey(key));
            const firstScoreKey = scoreKeys[0] || 'Autograder';
            const canonical = canonicalizeExamComponentName(examType, firstScoreKey, assignmentTitle);
            const cap = Number(assignmentMaxPoints);
            if (canonical && Number.isFinite(cap) && cap > 0) {
                capMap.set(normalizeComponentKey(canonical), cap);
            }
        }
    }

    return capMap;
}

function distributeAggregateExamScores(examType, scoresByQuestion = {}, capMap = new Map()) {
    const adjustments = new Map();
    const getRawScore = (rawKey) => {
        const direct = Number(scoresByQuestion?.[rawKey]);
        if (Number.isFinite(direct)) return direct;
        const normalized = normalizeComponentKey(rawKey);
        for (const [key, value] of Object.entries(scoresByQuestion || {})) {
            if (normalizeComponentKey(key) === normalized) {
                const numeric = Number(value);
                return Number.isFinite(numeric) ? numeric : 0;
            }
        }
        return 0;
    };
    const add = (component, value) => {
        const key = normalizeComponentKey(component);
        const cap = Number(capMap.get(key));
        if (!Number.isFinite(cap) || cap <= 0) return value;
        const existing = Number(adjustments.get(component) || 0);
        const room = Math.max(0, cap - existing);
        const used = Math.min(Math.max(value, 0), room);
        if (used > 0) adjustments.set(component, existing + used);
        return value - used;
    };
    const distribute = (rawKey, targets) => {
        let remaining = getRawScore(rawKey);
        for (const target of targets) {
            remaining = add(target, remaining);
            if (remaining <= 0) break;
        }
    };

    if (examType === 'postterm') {
        distribute('Lecture', ['Generative AI', 'Ethics in AI', 'HCI']);
    } else if (examType === 'midterm') {
        distribute('Lecture', ['Algorithms', 'Computers In Education', 'Testing+2048', 'Savingtheworld']);
        distribute('Logical Procedures', ['Iteration']);
    }

    return adjustments;
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

async function getQuestSummaryDistributionFromComponents(courseId = null, questCap = QUEST_SUMMARY_CAP) {
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
                hasQuestData: false,
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

        student.hasQuestData = true;

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

    return Array.from(studentMap.values()).filter((student) => student.hasQuestData).map((student) => {
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
            score: Math.min(questCap, toExactNumber(categoryTotal)),
            status: 'available',
            source: 'quest_component_best',
        };
    });
}

async function getQuestSummaryDistribution(courseId = null, questCap = QUEST_SUMMARY_CAP) {
    const pool = getPool();

    let policyQuery = `
        SELECT
            st.id AS student_id,
            st.legal_name AS student_name,
            st.email AS student_email,
            MAX(e.final_percentage) AS final_percentage,
            MAX(e.question_best_percentage) AS question_best_percentage
        FROM students st
        JOIN courses c ON st.course_id = c.id
        LEFT JOIN student_exam_effective_scores e
          ON e.student_id = st.id
         AND e.course_id = c.id
         AND LOWER(COALESCE(e.exam_type, '')) = 'quest'
    `;

    const params = [];
    if (courseId) {
        policyQuery += ` WHERE (c.gradescope_course_id::text = $1 OR c.id::text = $1)`;
        params.push(String(courseId));
    }

    policyQuery += `
        GROUP BY st.id, st.legal_name, st.email
        ORDER BY st.legal_name
    `;

    try {
        const policyResult = await pool.query(policyQuery, params);
        const hasPolicyData = policyResult.rows.some((row) => (
            toOptionalNumber(row.final_percentage) != null
            || toOptionalNumber(row.question_best_percentage) != null
        ));

        if (hasPolicyData) {
            const componentFallbackRows = await getQuestSummaryDistributionFromComponents(courseId, questCap);
            const componentFallbackByEmail = new Map(
                componentFallbackRows.map((row) => [
                    String(row.studentEmail || '').trim().toLowerCase(),
                    row,
                ]),
            );

            return policyResult.rows.map((row) => {
                const finalPct = toOptionalNumber(row.final_percentage);
                const questionBestPct = toOptionalNumber(row.question_best_percentage);
                const fallbackRow = componentFallbackByEmail.get(
                    String(row.student_email || '').trim().toLowerCase(),
                );
                const fallbackScore = Number(fallbackRow?.score);
                const resolution = resolveQuestPolicyScore({
                    policyFinalScore: finalPct == null ? null : (finalPct / 100) * questCap,
                    questionBestScore: questionBestPct == null ? null : (questionBestPct / 100) * questCap,
                    reconstructedScore: Number.isFinite(fallbackScore) ? fallbackScore : null,
                    cap: questCap,
                });

                return {
                    studentName: row.student_name,
                    studentEmail: row.student_email,
                    score: resolution.exactScore,
                    status: resolution.status,
                    source: resolution.source,
                };
            }).filter((row) => row.status === 'available');
        }
    } catch (err) {
        console.warn('Quest policy summary query failed, falling back to component summary:', err?.message || err);
    }

    return getQuestSummaryDistributionFromComponents(courseId, questCap);
}

async function getAttendanceSummaryDistribution(category, courseId = null, policy = null) {
    const pool = getPool();
    const normalizedCategory = normalizeSummaryCategoryName(category);
    const attendanceCap = getPolicyComponentCapByType(policy, 'attendance', ATTENDANCE_SUMMARY_CAP);
    const attendanceKindCount = Math.max(1, Number(policy?.rules?.attendance?.kind_count ?? 3) || 3);
    const attendancePerKindPoints = attendanceCap / attendanceKindCount;

    let effectiveQuery = `
        SELECT
            st.legal_name AS student_name,
            st.email AS student_email,
            SUM(
                LEAST(
                    $1::numeric,
                    GREATEST(0, COALESCE(e.final_percentage, 0)) / 100.0 * $1::numeric
                )
            ) AS policy_score
        FROM student_attendance_effective_scores e
        JOIN students st ON st.id = e.student_id
        JOIN courses c ON c.id = e.course_id
        WHERE 1=1
    `;
    const effectiveParams = [attendancePerKindPoints];
    if (courseId) {
        effectiveParams.push(String(courseId));
        effectiveQuery += ` AND (c.gradescope_course_id::text = $${effectiveParams.length} OR c.id::text = $${effectiveParams.length})`;
    }
    effectiveQuery += `
        GROUP BY st.id, st.legal_name, st.email
        ORDER BY st.legal_name
    `;

    const effectiveResult = await pool.query(effectiveQuery, effectiveParams);
    if (effectiveResult.rows.length > 0) {
        return effectiveResult.rows.map((row) => ({
            studentName: row.student_name,
            studentEmail: row.student_email,
            score: Math.min(attendanceCap, toExactNumber(row.policy_score)),
            status: 'available',
            source: 'student_attendance_effective_scores',
        }));
    }

    const includeLectureQuiz = Boolean(policy?.rules?.attendance?.include_lecture_quiz_without_iclicker);

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
         AND a.title !~* 'practice'
    `;
    if (!includeLectureQuiz) {
        query += ` AND a.title !~* 'lecture\\s+quiz'`;
    }
    query += `
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
                hasAttendanceData: false,
            });
        }

        const hasAttendanceRow = row.assignment_max_points != null;
        if (!hasAttendanceRow) {
            return;
        }
        studentMap.get(studentId).hasAttendanceData = true;

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
        score: Math.min(attendanceCap, toExactNumber(student.passCount)),
        status: student.hasAttendanceData ? 'available' : 'unavailable',
        source: 'attendance_submission_fallback',
    }));
}

async function getLabsSummaryDistribution(courseId = null, policy = null) {
    const pool = getPool();
    const labsCap = getPolicyComponentCapByType(policy, 'labs', LABS_SUMMARY_CAP);
    const drops = Math.max(0, Number(policy?.rules?.labs?.drop_lowest ?? GRAPH_LAB_DROP_LOWEST) || 0);

    let rollupQuery = `
        SELECT
            st.id AS student_id,
            st.legal_name AS student_name,
            st.email AS student_email,
            s.total_score,
            s.scores_by_question
        FROM students st
        JOIN courses c ON st.course_id = c.id
        JOIN assignments a
          ON a.course_id = c.id
         AND a.assignment_id LIKE 'labs_rollup:%'
        LEFT JOIN submissions s
          ON s.student_id = st.id
         AND s.assignment_id = a.id
        WHERE 1=1
    `;
    const rollupParams = [];
    if (courseId) {
        rollupParams.push(String(courseId));
        rollupQuery += ` AND (c.gradescope_course_id::text = $${rollupParams.length} OR c.id::text = $${rollupParams.length})`;
    }
    rollupQuery += ` ORDER BY st.legal_name`;

    const rollupResult = await pool.query(rollupQuery, rollupParams);
    const rollupRows = rollupResult.rows
        .map((row) => {
            const rollupLabs = Array.isArray(row?.scores_by_question?.labs)
                ? row.scores_by_question.labs
                : [];
            const rollupSummary = rollupLabs.length > 0 ? graphSummarizeLabResults(rollupLabs, drops, labsCap) : null;
            return {
                studentName: row.student_name,
                studentEmail: row.student_email,
                score: Math.min(labsCap, graphSafeNumber(rollupSummary?.score ?? row.total_score)),
            };
        })
        .filter((row) => row.score > 0);

    let rawQuery = `
        SELECT
            st.id AS student_id,
            st.legal_name AS student_name,
            st.email AS student_email,
            a.id AS assignment_pk,
            a.assignment_id,
            a.title,
            COALESCE(a.category, 'Uncategorized') AS category,
            a.max_points AS assignment_max_points,
            s.total_score,
            s.max_points AS submission_max_points
        FROM students st
        JOIN courses c ON st.course_id = c.id
        JOIN assignments a ON a.course_id = c.id
        LEFT JOIN submissions s
          ON s.student_id = st.id
         AND s.assignment_id = a.id
        WHERE 1=1
          AND a.assignment_id NOT LIKE 'labs_rollup:%'
          AND a.assignment_id NOT LIKE 'project_rollup:%'
          AND a.assignment_id NOT LIKE 'attendance_rollup:%'
          AND (
            COALESCE(a.category, 'Uncategorized') IN ('Labs', '_labs_raw')
          )
          AND a.title !~* 'practice'
    `;
    const rawParams = [];
    if (courseId) {
        rawParams.push(String(courseId));
        rawQuery += ` AND (c.gradescope_course_id::text = $${rawParams.length} OR c.id::text = $${rawParams.length})`;
    }
    rawQuery += ` ORDER BY st.legal_name, a.title`;

    const rawResult = await pool.query(rawQuery, rawParams);
    const studentMap = new Map();
    rawResult.rows.forEach((row) => {
        const studentId = String(row.student_id);
        if (!studentMap.has(studentId)) {
            studentMap.set(studentId, {
                studentName: row.student_name,
                studentEmail: row.student_email,
                rows: [],
            });
        }
        studentMap.get(studentId).rows.push(row);
    });

    const rawRows = Array.from(studentMap.values())
        .map((student) => {
            const derived = deriveLabsRollupFromRawSubmissions(student.rows, labsCap, drops);
            return {
                studentName: student.studentName,
                studentEmail: student.studentEmail,
                score: Math.min(labsCap, graphSafeNumber(derived.score)),
            };
        })
        .filter((row) => row.score > 0);

    return rawRows.length > 0 ? rawRows : rollupRows;
}

async function getProjectsSummaryDistribution(courseId = null, policy = null) {
    const pool = getPool();
    const projectsCap = getPolicyComponentCapByType(policy, 'projects', PROJECTS_SUMMARY_CAP);
    const projectItems = policy ? getCoursePolicyProjectItems(policy) : PROJECT_POLICY_CAPS;

    let query = `
        SELECT
            st.id AS student_id,
            st.legal_name AS student_name,
            st.email AS student_email,
            a.id AS assignment_pk,
            a.assignment_id,
            a.title,
            COALESCE(a.category, 'Uncategorized') AS category,
            a.max_points AS assignment_max_points,
            s.total_score,
            s.max_points AS submission_max_points
        FROM students st
        JOIN courses c ON st.course_id = c.id
        LEFT JOIN assignments a
          ON a.course_id = c.id
         AND a.assignment_id NOT LIKE 'labs_rollup:%'
         AND a.assignment_id NOT LIKE 'project_rollup:%'
         AND a.assignment_id NOT LIKE 'attendance_rollup:%'
         AND COALESCE(a.category, 'Uncategorized') IN ('Projects', '_projects_raw')
         AND a.title !~* 'practice'
        LEFT JOIN submissions s
          ON s.student_id = st.id
         AND s.assignment_id = a.id
        WHERE 1=1
    `;

    const params = [];
    if (courseId) {
        params.push(String(courseId));
        query += ` AND (c.gradescope_course_id::text = $${params.length} OR c.id::text = $${params.length})`;
    }
    query += ` ORDER BY st.legal_name, a.title`;

    const result = await pool.query(query, params);
    const studentMap = new Map();

    result.rows.forEach((row) => {
        const studentId = String(row.student_id);
        if (!studentMap.has(studentId)) {
            studentMap.set(studentId, {
                studentName: row.student_name,
                studentEmail: row.student_email,
                byProject: new Map(),
                hasProjectData: false,
            });
        }

        if (row.assignment_pk == null) return;
        const project = detectPolicyProject(row.title || '', policy);
        if (!project) return;

        const student = studentMap.get(studentId);
        student.hasProjectData = true;
        if (!student.byProject.has(project.key)) {
            student.byProject.set(project.key, { project, bySubitem: new Map() });
        }
        const projectEntry = student.byProject.get(project.key);
        const canonical = graphProjectCanonical(row.title || '');
        if (!canonical) return;
        if (!projectEntry.bySubitem.has(canonical)) {
            projectEntry.bySubitem.set(canonical, []);
        }
        projectEntry.bySubitem.get(canonical).push(row);
    });

    return Array.from(studentMap.values()).map((student) => {
        let totalScore = 0;

        projectItems.forEach((project) => {
            const entry = student.byProject.get(project.key);
            if (!entry) return;

            let earned = 0;
            let denominator = 0;
            entry.bySubitem.forEach((rows) => {
                const maxScore = rows.reduce((best, row) => {
                    const score = graphSafeNumber(row.assignment_max_points, 0);
                    return Math.max(best, score);
                }, 0);
                if (maxScore <= 0) return;

                denominator += maxScore;
                const bestFrac = rows.reduce((best, row) => {
                    const score = graphSafeNumber(row.total_score, NaN);
                    const rowMax = graphSafeNumber(row.submission_max_points || row.assignment_max_points, NaN);
                    if (!Number.isFinite(score) || !Number.isFinite(rowMax) || rowMax <= 0) {
                        return best;
                    }
                    return Math.max(best, Math.max(0, Math.min(1, score / rowMax)));
                }, 0);
                earned += bestFrac * maxScore;
            });

            if (denominator > 0) {
                totalScore += (earned / denominator) * (Number(project.cap) || 0);
            }
        });

        return {
            studentName: student.studentName,
            studentEmail: student.studentEmail,
            score: Math.min(projectsCap, toExactNumber(totalScore)),
            status: student.hasProjectData ? 'available' : 'unavailable',
            source: 'project_policy_rollup',
        };
    });
}

async function getRawCategorySummaryDistribution(category, courseId = null, capPoints = null) {
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
          AND a.title !~* 'practice'
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

    const result = await pool.query(query, params);
    const cap = Number(capPoints);

    return result.rows.map((row) => {
        const score = toExactNumber(row.total_score);
        return {
            studentName: row.student_name,
            studentEmail: row.student_email,
            score: Number.isFinite(cap) && cap > 0 ? Math.min(cap, score) : score,
            status: 'available',
            source: `raw_category:${category}`,
        };
    });
}

/**
 * Gets score distribution for category summary (sum of all assignments in category)
 * @param {string} category - The assignment category (may not match DB, legacy parameter)
 * @returns {Promise<Array>} Array of {studentName, studentEmail, score}
 */
export async function getCategorySummaryDistribution(category, courseId = null, options = {}) {
    const policy = options.policy || await getCoursePolicy(courseId, getPool());
    const component = options.component || getPolicyComponentForSummary(category, policy);
    const summarySource = component?.summary_source || category;
    const componentCap = Number(component?.cap);
    const configuredCap = Number.isFinite(componentCap) && componentCap > 0
        ? componentCap
        : getPolicySummaryCap(category, policy);
    const normalizedCategory = normalizeSummaryCategoryName(category);
    const componentType = String(component?.type || '').trim().toLowerCase();

    if (componentType === 'projects' || normalizedCategory === 'projects') {
        return getProjectsSummaryDistribution(courseId, policy);
    }

    if (componentType === 'labs' || normalizedCategory === 'labs') {
        return getLabsSummaryDistribution(courseId, policy);
    }

    if (componentType === 'attendance' || isAttendanceSummaryCategory(normalizedCategory)) {
        return getAttendanceSummaryDistribution(summarySource, courseId, policy);
    }

    if (componentType === 'exam') {
        const examType = String(component?.exam_type || component?.examType || '').trim().toLowerCase();
        const cap = Number(configuredCap) || getSummaryCapByCategory(summarySource) || 0;
        if (examType === 'quest') {
            return getQuestSummaryDistribution(courseId, cap || QUEST_SUMMARY_CAP);
        }
        if (examType === 'midterm' || examType === 'postterm') {
            return getExamSummaryDistribution(examType, cap, courseId, {
                rawCategory: summarySource,
                includePosttermClobber: Boolean(policy?.rules?.exams?.clobber?.[component.key]?.includes?.('postterm')),
            });
        }
        return getRawCategorySummaryDistribution(summarySource, courseId, cap);
    }

    if (normalizedCategory === 'quest') {
        return getQuestSummaryDistribution(courseId, Number(configuredCap) || QUEST_SUMMARY_CAP);
    }

    if (normalizedCategory.includes('midterm')) {
        const cap = Number(configuredCap) || MIDTERM_SUMMARY_CAP;
        return getExamSummaryDistribution('midterm', cap, courseId, {
            rawCategory: category,
            includePosttermClobber: true,
        });
    }

    if (normalizedCategory.includes('postterm') || normalizedCategory.includes('posterm')) {
        const cap = Number(configuredCap) || POSTTERM_SUMMARY_CAP;
        return getExamSummaryDistribution('postterm', cap, courseId, { rawCategory: category });
    }
    
    try {
        return getRawCategorySummaryDistribution(category, courseId, configuredCap);
    } catch (err) {
        console.error('Error fetching category summary distribution:', err);
        throw err;
    }
}

export async function getAllStudentPolicySummaries(courseId = null) {
    const summaryMaps = await getCoursePolicySummaryMaps(courseId);
    const emails = new Set();
    summaryMaps.byComponent.forEach(({ rowMap }) => {
        rowMap.forEach((_score, email) => emails.add(email));
    });

    return new Map(Array.from(emails).map((email) => [
        email,
        buildPolicySummaryFromComponentMaps({
            ...summaryMaps,
            email,
        }),
    ]));
}

export async function getStudentPolicySummaries(email, courseId = null) {
    const summaryMaps = await getCoursePolicySummaryMaps(courseId);
    return buildPolicySummaryFromComponentMaps({
        ...summaryMaps,
        email,
    });
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

    const params = [];
    const courseFilter = courseId ? String(courseId) : null;
    if (courseFilter) {
        params.push(courseFilter);
    }

    const courseScopeCte = courseFilter
        ? `
        target_courses AS (
            SELECT id
            FROM courses
            WHERE gradescope_course_id::text = $1 OR id::text = $1
        ),
        student_scope AS (
            SELECT st.id, st.legal_name, st.email, st.course_id
            FROM students st
            JOIN target_courses tc ON tc.id = st.course_id
        ),
        `
        : `
        student_scope AS (
            SELECT st.id, st.legal_name, st.email, st.course_id
            FROM students st
        ),
        `;

    const query = `
        WITH
        ${courseScopeCte}
        score_sections AS (
            SELECT
                st.id AS student_id,
                st.legal_name AS student_name,
                st.email AS student_email,
                COALESCE(a.category, 'Uncategorized') AS category,
                jsonb_object_agg(a.title, s.total_score ORDER BY a.title)
                    FILTER (WHERE a.title IS NOT NULL) AS assignment_scores
            FROM student_scope st
            LEFT JOIN submissions s ON s.student_id = st.id
            LEFT JOIN assignments a
              ON a.id = s.assignment_id
             AND (st.course_id IS NULL OR a.course_id = st.course_id)
            GROUP BY st.id, st.legal_name, st.email, COALESCE(a.category, 'Uncategorized')
        )
        SELECT
            student_id,
            student_name,
            student_email,
            COALESCE(
                jsonb_object_agg(category, assignment_scores ORDER BY category)
                    FILTER (WHERE assignment_scores IS NOT NULL),
                '{}'::jsonb
            ) AS scores
        FROM score_sections
        GROUP BY student_id, student_name, student_email
        ORDER BY student_email
    `;

    try {
        const result = await pool.query(query, params);

        return result.rows.map((row) => ({
            name: row.student_name || 'Unknown',
            email: row.student_email,
            scores: row.scores || {},
        }));
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

function graphNormalize(value = '') {
    return String(value || '').trim().toLowerCase();
}

function graphSafeNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function graphFormatPoints(value, digits = 1) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '-';
    if (Math.abs(numeric - Math.round(numeric)) < 0.005) return String(Math.round(numeric));
    return numeric.toFixed(digits);
}

function graphPercentage(score, cap) {
    const s = graphSafeNumber(score);
    const c = graphSafeNumber(cap);
    if (c <= 0) return 0;
    return Math.max(0, Math.min(100, (s / c) * 100));
}

function graphComponentKey(value = '') {
    return graphNormalize(value)
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function graphCanonicalExamComponent(group, value = '', assignmentTitle = '') {
    const canonical = canonicalizeExamComponentName(group, value, assignmentTitle);
    return canonical || null;
}

function isGraphMetadataScoreKey(key = '') {
    const normalized = graphComponentKey(key);
    if (!normalized) return true;
    if (normalized.includes('survey') || normalized.startsWith('pledge')) return true;
    return normalized === 'source'
        || normalized === 'score perc'
        || normalized === 'score_perc'
        || normalized === 'component caps'
        || normalized === 'component_caps'
        || normalized === 'assessment number'
        || normalized === 'assessment label'
        || normalized === 'assessment name'
        || normalized === 'directions'
        || normalized === 'instructions'
        || normalized === 'pledge'
        || normalized === 'survey';
}

function graphComponentCapMap(assignmentMetadata = {}, scoresByQuestion = {}) {
    const capMap = new Map();
    const components = Array.isArray(assignmentMetadata?.components) ? assignmentMetadata.components : [];
    components.forEach((component) => {
        const key = graphComponentKey(component?.key || component?.name || component?.label);
        const cap = graphSafeNumber(component?.max_points, NaN);
        if (key && Number.isFinite(cap) && cap > 0) {
            capMap.set(key, cap);
        }
    });

    const embeddedCaps = scoresByQuestion?.component_caps && typeof scoresByQuestion.component_caps === 'object'
        ? scoresByQuestion.component_caps
        : {};
    Object.entries(embeddedCaps).forEach(([rawKey, rawCap]) => {
        const key = graphComponentKey(rawKey);
        const cap = graphSafeNumber(rawCap, NaN);
        if (key && Number.isFinite(cap) && cap > 0) {
            capMap.set(key, cap);
        }
    });
    return capMap;
}

function detectGraphProject(title = '', policy = null) {
    return detectPolicyProject(title, policy);
}

function graphProjectCanonical(title = '') {
    return String(title || '')
        .replace(/\bresubmission\b/gi, '')
        .replace(/[^a-z0-9]/gi, '')
        .toLowerCase();
}

const GRAPH_LAB_DROP_LOWEST = 2;
const GRAPH_LAB_FULL_CREDIT_THRESHOLD = 0.999;
const GRAPH_LAB_BASE_TITLE_RE = /\s*\((?:code|conceptual)\)\s*$/i;
const GRAPH_PRACTICE_LAB_PATTERNS = [
    /\bpractice\s+midterm\b/i,
    /\bpractice\s+postterm\b/i,
    /\blab\s+practice\b/i,
];

function graphLabBaseTitle(title = '') {
    return String(title || '').replace(GRAPH_LAB_BASE_TITLE_RE, '').trim();
}

function graphIsPracticeAssignmentTitle(title = '') {
    return /\bpractice\b/i.test(title || '');
}

function graphIsPracticeLab(title = '') {
    return graphIsPracticeAssignmentTitle(title)
        || GRAPH_PRACTICE_LAB_PATTERNS.some((pattern) => pattern.test(title || ''));
}

function graphLabRollupItemIsPractice(lab = {}) {
    if (graphIsPracticeLab(lab.lab || lab.title || '')) {
        return true;
    }
    const items = Array.isArray(lab.items) ? lab.items : [];
    return items.some((item) => graphIsPracticeLab(item?.title || item?.name || ''));
}

function graphLabRollupItemPassed(lab = {}) {
    if (typeof lab.passed === 'boolean') {
        return lab.passed;
    }

    const directScore = graphSafeNumber(lab.score, NaN);
    const directMax = graphSafeNumber(lab.maxScore ?? lab.max_points ?? lab.max, NaN);
    if (Number.isFinite(directScore) && Number.isFinite(directMax) && directMax > 0) {
        return (directScore / directMax) >= GRAPH_LAB_FULL_CREDIT_THRESHOLD;
    }

    const items = Array.isArray(lab.items) ? lab.items : [];
    if (items.length === 0) {
        return false;
    }
    return items.every((item) => {
        const score = graphSafeNumber(item?.score, NaN);
        const maxScore = graphSafeNumber(item?.maxScore ?? item?.max_points ?? item?.max, NaN);
        return Number.isFinite(score) && Number.isFinite(maxScore) && maxScore > 0
            && (score / maxScore) >= GRAPH_LAB_FULL_CREDIT_THRESHOLD;
    });
}

function graphSummarizeLabResults(labs, drops = GRAPH_LAB_DROP_LOWEST, cap = LABS_SUMMARY_CAP) {
    const filteredLabs = (Array.isArray(labs) ? labs : [])
        .filter((lab) => !graphLabRollupItemIsPractice(lab))
        .map((lab) => ({
            ...lab,
            passed: graphLabRollupItemPassed(lab),
            is_practice: false,
        }));

    const normalizedDrops = Math.max(0, graphSafeNumber(drops, GRAPH_LAB_DROP_LOWEST));
    const totalGroups = filteredLabs.length;
    if (totalGroups === 0) {
        return {
            labs: [],
            passedCount: 0,
            totalGroups: 0,
            drops: normalizedDrops,
            effectiveTotal: 0,
            passedAfterDrop: 0,
            score: 0,
        };
    }

    const passedCount = filteredLabs.filter((lab) => lab.passed).length;
    const effectiveTotal = Math.max(1, totalGroups - normalizedDrops);
    const passedAfterDrop = Math.min(passedCount, effectiveTotal);
    const score = passedAfterDrop / effectiveTotal * cap;

    return {
        labs: filteredLabs,
        passedCount,
        totalGroups,
        drops: normalizedDrops,
        effectiveTotal,
        passedAfterDrop,
        score,
    };
}

function graphIsOptionalLab(title = '') {
    return /\boptional\b/i.test(title || '');
}

function graphLooksLikeNonLab(title = '') {
    return /\bprairielearn\b/i.test(title || '');
}

function deriveLabsRollupFromRawSubmissions(submissions, cap = LABS_SUMMARY_CAP, drops = GRAPH_LAB_DROP_LOWEST) {
    const candidates = submissions.filter((row) => {
        const title = String(row.title || '');
        const assignmentId = String(row.assignment_id || '');
        const category = String(row.category || '').trim();
        if (assignmentId.startsWith('labs_rollup:') || assignmentId.startsWith('project_rollup:') || assignmentId.startsWith('attendance_rollup:')) {
            return false;
        }
        if (graphIsOptionalLab(title) || graphLooksLikeNonLab(title) || graphIsPracticeLab(title)) {
            return false;
        }
        if (category === 'Labs' || category === '_labs_raw') {
            return true;
        }
        return false;
    });

    const groups = new Map();
    candidates.forEach((row) => {
        const baseTitle = graphLabBaseTitle(row.title || '');
        if (!baseTitle) return;
        if (!groups.has(baseTitle)) groups.set(baseTitle, []);
        groups.get(baseTitle).push(row);
    });

    const labs = Array.from(groups.entries())
        .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
        .map(([lab, rows]) => {
            const passed = rows.every((row) => {
                const score = graphSafeNumber(row.total_score, NaN);
                const maxScore = graphSafeNumber(row.submission_max_points || row.assignment_max_points, NaN);
                return Number.isFinite(score) && Number.isFinite(maxScore) && maxScore > 0
                    && (score / maxScore) >= GRAPH_LAB_FULL_CREDIT_THRESHOLD;
            });
            return {
                lab,
                passed,
                is_practice: false,
                items: rows.map((row) => ({
                    id: row.assignment_pk,
                    title: row.title,
                    score: graphSafeNumber(row.total_score, null),
                    maxScore: graphSafeNumber(row.submission_max_points || row.assignment_max_points, null),
                })),
            };
        });

    if (labs.length === 0) {
        return {
            labs: [],
            passedCount: 0,
            totalGroups: 0,
            drops,
            effectiveTotal: 0,
            score: 0,
        };
    }

    const passedCount = labs.filter((lab) => lab.passed).length;
    const effectiveTotal = Math.max(1, labs.length - drops);
    const passedAfterDrop = Math.min(passedCount, effectiveTotal);
    const score = passedAfterDrop / effectiveTotal * cap;

    return {
        labs,
        passedCount,
        totalGroups: labs.length,
        drops,
        effectiveTotal,
        passedAfterDrop,
        score,
    };
}

function createGradeFlowBuilder() {
    const nodes = [];
    const edges = [];
    const nodeIds = new Set();

    const addNode = (node) => {
        const id = String(node.id);
        if (nodeIds.has(id)) {
            return id;
        }
        nodeIds.add(id);
        nodes.push({
            id,
            type: node.type,
            subtype: node.subtype || null,
            label: node.label || id,
            group: node.group || 'course',
            layer: Number(node.layer) || 0,
            score: node.score == null ? null : Number(node.score),
            maxScore: node.maxScore == null ? null : Number(node.maxScore),
            displayValue: node.displayValue || '',
            status: node.status || 'kept',
            details: node.details || {},
        });
        return id;
    };

    const addEdge = (source, target, options = {}) => {
        if (!source || !target) return;
        edges.push({
            id: options.id || `${source}->${target}`,
            source,
            target,
            kind: options.kind || 'score',
            label: options.label || '',
            active: options.active !== false,
        });
    };

    return { nodes, edges, addNode, addEdge };
}

async function resolveGraphStudent(email, courseId = null) {
    const pool = getPool();
    let query = `
        SELECT
            st.id AS student_id,
            st.legal_name AS student_name,
            st.email AS student_email,
            c.id AS course_id,
            c.gradescope_course_id,
            c.name AS course_name
        FROM students st
        JOIN courses c ON c.id = st.course_id
        WHERE LOWER(st.email) = LOWER($1)
    `;
    const params = [email];
    if (courseId) {
        query += ` AND (c.id::text = $2 OR c.gradescope_course_id::text = $2)`;
        params.push(String(courseId));
    }
    query += ` ORDER BY c.year DESC NULLS LAST, c.semester ASC NULLS LAST, c.name ASC NULLS LAST LIMIT 1`;

    const result = await pool.query(query, params);
    return result.rows[0] || null;
}

async function getGraphStudentSubmissions(studentId, courseInternalId) {
    const pool = getPool();
    const result = await pool.query(
        `
        SELECT
            a.id AS assignment_pk,
            a.assignment_id,
            a.title,
            COALESCE(a.category, 'Uncategorized') AS category,
            a.max_points AS assignment_max_points,
            a.assignment_metadata,
            e.exam_type,
            e.attempt_no,
            e.is_practice,
            s.total_score,
            s.max_points AS submission_max_points,
            s.scores_by_question,
            s.submission_time,
            s.lateness
        FROM assignments a
        JOIN courses c ON c.id = a.course_id
        LEFT JOIN exam_attempt_map e
          ON e.assignment_id = a.id
         AND e.course_id = c.id
        LEFT JOIN submissions s
          ON s.assignment_id = a.id
         AND s.student_id = $1
        WHERE c.id = $2
        ORDER BY COALESCE(a.category, 'Uncategorized'), a.title
        `,
        [studentId, courseInternalId],
    );
    return result.rows;
}

async function getGraphAttendanceRows(studentId, courseInternalId) {
    const pool = getPool();
    const result = await pool.query(
        `
        SELECT
            kind,
            total_required_sessions,
            attended_sessions,
            drops_applied,
            effective_attended,
            effective_total,
            raw_percentage,
            final_percentage,
            details
        FROM student_attendance_effective_scores
        WHERE student_id = $1
          AND course_id = $2
        ORDER BY CASE kind WHEN 'lecture' THEN 1 WHEN 'lab' THEN 2 WHEN 'discussion' THEN 3 ELSE 9 END
        `,
        [studentId, courseInternalId],
    );
    return result.rows;
}

async function getGraphExamPolicyRows(studentId, courseInternalId) {
    const pool = getPool();
    const result = await pool.query(
        `
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
            e.details
        FROM student_exam_effective_scores e
        LEFT JOIN assignments a ON a.id = e.assignment_id
        LEFT JOIN assignments src ON src.id = e.clobber_source_assignment_id
        WHERE e.student_id = $1
          AND e.course_id = $2
        ORDER BY
            CASE LOWER(e.exam_type) WHEN 'quest' THEN 1 WHEN 'midterm' THEN 2 WHEN 'postterm' THEN 3 ELSE 9 END,
            e.attempt_no
        `,
        [studentId, courseInternalId],
    );
    return result.rows;
}

async function getGraphSummaryTotals(email, courseId = null) {
    const { summaryByKey } = await getStudentPolicySummaries(email, courseId);
    return summaryByKey;
}

function addRawQuestionNodes(builder, group, assignmentRows, options = {}) {
    const groupedByQuestion = new Map();

    assignmentRows.forEach((row) => {
        const scoresByQuestion = row.scores_by_question && typeof row.scores_by_question === 'object'
            ? row.scores_by_question
            : {};
        const capMap = buildExamComponentCapMap(
            group,
            row.title,
            row.assignment_metadata || {},
            scoresByQuestion,
            row.assignment_max_points ?? row.submission_max_points,
        );
        Object.entries(scoresByQuestion).forEach(([rawKey, rawValue]) => {
            const canonicalLabel = graphCanonicalExamComponent(group, rawKey, row.title);
            if (!canonicalLabel) return;
            const key = graphComponentKey(canonicalLabel);
            if (isGraphMetadataScoreKey(key)) return;
            const score = graphSafeNumber(rawValue, NaN);
            if (!Number.isFinite(score)) return;
            const maxScore = graphSafeNumber(capMap.get(key), null);
            const rawNodeId = `${group}:raw:${row.assignment_pk}:${key}:${graphComponentKey(rawKey)}`;
            const attemptNo = graphSafeNumber(row.attempt_no, null);
            builder.addNode({
                id: rawNodeId,
                type: 'raw',
                subtype: 'question',
                label: `${row.title || 'Attempt'} · ${canonicalLabel}`,
                group,
                layer: 0,
                score,
                maxScore,
                displayValue: maxScore ? `${graphFormatPoints(score)} / ${graphFormatPoints(maxScore)}` : graphFormatPoints(score),
                status: 'kept',
                details: {
                    quality: maxScore ? 'direct' : 'estimated',
                    attemptNo,
                    questionKey: canonicalLabel,
                    sourceQuestionKey: rawKey,
                    assignmentTitle: row.title,
                    sourceAssignment: row.assignment_id,
                },
            });

            if (!groupedByQuestion.has(key)) {
                groupedByQuestion.set(key, { rawKey: canonicalLabel, maxScore, rawNodeIds: [], scores: [] });
            }
            const item = groupedByQuestion.get(key);
            item.rawNodeIds.push(rawNodeId);
            item.scores.push(score);
            if (!item.maxScore && maxScore) item.maxScore = maxScore;
        });
    });

    const maxNodeIds = [];
    groupedByQuestion.forEach((item, key) => {
        const best = item.scores.length > 0 ? Math.max(...item.scores) : 0;
        const maxNodeId = `${group}:max:${key}`;
        builder.addNode({
            id: maxNodeId,
            type: 'logical',
            subtype: options.maxSubtype || 'max',
            label: options.maxLabel ? `${options.maxLabel}: ${item.rawKey}` : `MAX ${item.rawKey}`,
            group,
            layer: 1,
            score: best,
            maxScore: item.maxScore || null,
            displayValue: item.maxScore ? `${graphFormatPoints(best)} / ${graphFormatPoints(item.maxScore)}` : `max ${graphFormatPoints(best)}`,
            status: 'selected',
            details: {
                quality: item.maxScore ? 'direct' : 'estimated',
                questionKey: item.rawKey,
                operator: 'max',
            },
        });
        item.rawNodeIds.forEach((rawNodeId) => builder.addEdge(rawNodeId, maxNodeId, { kind: 'policy', label: 'candidate' }));
        maxNodeIds.push(maxNodeId);
    });
    return maxNodeIds;
}

function addAttendanceGraph(builder, attendanceRows, summary) {
    const kindMeta = {
        lecture: { label: 'Lecture', drop: 5 },
        lab: { label: 'Lab attendance', drop: 5 },
        discussion: { label: 'Discussion', drop: 1 },
    };
    const scaleNodeIds = [];

    attendanceRows.forEach((row) => {
        const kind = String(row.kind || 'attendance');
        const meta = kindMeta[kind] || { label: kind, drop: graphSafeNumber(row.drops_applied) };
        const group = 'attendance';
        const sessions = Array.isArray(row?.details?.sessions) ? row.details.sessions : [];
        const absentRequired = sessions.filter((session) => session.required !== false && !session.attended);
        const droppedKeys = new Set(absentRequired.slice(0, graphSafeNumber(row.drops_applied)).map((session, idx) => `${session.ordinal ?? idx}:${session.date ?? ''}`));
        const rawNodeIds = [];
        sessions.forEach((session, idx) => {
            const key = `${session.ordinal ?? idx}:${session.date ?? ''}`;
            const status = session.required === false
                ? 'ignored'
                : (session.attended ? 'kept' : (droppedKeys.has(key) ? 'dropped' : 'missing'));
            const rawNodeId = `attendance:${kind}:session:${idx}`;
            builder.addNode({
                id: rawNodeId,
                type: 'raw',
                subtype: 'session',
                label: `${meta.label} ${session.ordinal ?? idx + 1}`,
                group,
                layer: 0,
                score: session.attended ? 1 : 0,
                maxScore: session.required === false ? 0 : 1,
                displayValue: session.attended ? 'attended' : (session.reason || 'absent'),
                status,
                details: {
                    quality: 'direct',
                    date: session.date,
                    status: session.status,
                    reason: session.reason,
                    dropReason: status === 'dropped' ? `lowest ${meta.drop} absence drop` : null,
                    makeupTitle: session.makeup_title,
                },
            });
            rawNodeIds.push(rawNodeId);
        });

        const dropNodeId = `attendance:${kind}:drop`;
        builder.addNode({
            id: dropNodeId,
            type: 'logical',
            subtype: 'drop',
            label: `DROP ${meta.label}`,
            group,
            layer: 1,
            score: graphSafeNumber(row.effective_attended),
            maxScore: graphSafeNumber(row.effective_total),
            displayValue: `drop ${graphSafeNumber(row.drops_applied)}`,
            status: 'selected',
            details: {
                quality: 'direct',
                operator: 'drop',
                dropsApplied: graphSafeNumber(row.drops_applied),
                totalRequiredSessions: graphSafeNumber(row.total_required_sessions),
            },
        });
        rawNodeIds.forEach((rawNodeId) => builder.addEdge(rawNodeId, dropNodeId, { kind: 'policy' }));

        const scaleNodeId = `attendance:${kind}:scale`;
        const finalPct = graphSafeNumber(row.final_percentage);
        const points = finalPct / 100 * 5;
        builder.addNode({
            id: scaleNodeId,
            type: 'logical',
            subtype: 'scale',
            label: `${meta.label} → 5 pts`,
            group,
            layer: 2,
            score: points,
            maxScore: 5,
            displayValue: `${graphFormatPoints(points)} / 5`,
            status: 'selected',
            details: {
                quality: 'direct',
                operator: 'scale',
                finalPercentage: finalPct,
            },
        });
        builder.addEdge(dropNodeId, scaleNodeId, { kind: 'policy', label: 'scale' });
        scaleNodeIds.push(scaleNodeId);
    });

    const sumNodeId = 'attendance:sum';
    builder.addNode({
        id: sumNodeId,
        type: 'logical',
        subtype: 'sum',
        label: 'SUM Attendance',
        group: 'attendance',
        layer: 3,
        score: summary.score,
        maxScore: summary.cap,
        displayValue: `${graphFormatPoints(summary.score)} / ${summary.cap}`,
        status: 'selected',
        details: { quality: 'direct', operator: 'sum' },
    });
    scaleNodeIds.forEach((nodeId) => builder.addEdge(nodeId, sumNodeId, { kind: 'score' }));
    return sumNodeId;
}

function addLabsGraph(builder, submissions, summary, policy = null) {
    const labsCap = getPolicyComponentCapByType(policy, 'labs', summary?.cap || LABS_SUMMARY_CAP);
    const configuredDrops = Math.max(0, Number(policy?.rules?.labs?.drop_lowest ?? GRAPH_LAB_DROP_LOWEST) || 0);
    const rollup = submissions.find((row) => String(row.assignment_id || '').startsWith('labs_rollup:'));
    const derived = deriveLabsRollupFromRawSubmissions(submissions, labsCap, configuredDrops);
    const derivedLabs = Array.isArray(derived?.labs) ? derived.labs : [];
    const rollupLabs = Array.isArray(rollup?.scores_by_question?.labs)
        ? rollup.scores_by_question.labs.filter((lab) => !graphLabRollupItemIsPractice(lab))
        : [];
    const rollupSummary = graphSummarizeLabResults(
        rollupLabs,
        graphSafeNumber(rollup?.scores_by_question?.drops, configuredDrops),
        labsCap,
    );
    const useDerived = derivedLabs.length > 0;
    const labs = useDerived ? derivedLabs : rollupSummary.labs;
    const drops = useDerived
        ? graphSafeNumber(derived?.drops, GRAPH_LAB_DROP_LOWEST)
        : graphSafeNumber(rollupSummary.drops, GRAPH_LAB_DROP_LOWEST);
    const passedCount = useDerived
        ? graphSafeNumber(derived?.passedCount)
        : graphSafeNumber(rollupSummary.passedCount);
    const totalGroups = useDerived
        ? graphSafeNumber(derived?.totalGroups)
        : graphSafeNumber(rollupSummary.totalGroups);
    const effectiveTotal = useDerived
        ? graphSafeNumber(derived?.effectiveTotal)
        : graphSafeNumber(rollupSummary.effectiveTotal);
    const passedAfterDrop = Math.min(passedCount, effectiveTotal || passedCount);
    const scaledScore = useDerived
        ? graphSafeNumber(derived?.score)
        : graphSafeNumber(rollupSummary.score);
    const labQuality = (!useDerived && rollup) || labs.length > 0 ? 'direct' : 'estimated';
    const failed = labs.filter((lab) => !lab.passed);
    const droppedFailures = new Set(failed.slice(0, drops).map((lab) => lab.lab));
    const rawNodeIds = [];

    labs.forEach((lab, idx) => {
        const rawNodeId = `labs:raw:${idx}`;
        const status = lab.passed ? 'kept' : (droppedFailures.has(lab.lab) ? 'dropped' : 'missing');
        builder.addNode({
            id: rawNodeId,
            type: 'raw',
            subtype: 'lab_group',
            label: lab.lab || `Lab ${idx + 1}`,
            group: 'labs',
            layer: 0,
            score: lab.passed ? 1 : 0,
            maxScore: 1,
            displayValue: lab.passed ? 'pass' : 'not passed',
            status,
            details: {
                quality: labQuality,
                isPractice: Boolean(lab.is_practice),
                itemCount: Array.isArray(lab.items) ? lab.items.length : 0,
                dropReason: status === 'dropped' ? `lowest ${drops} lab drop` : null,
                items: Array.isArray(lab.items) ? lab.items : [],
            },
        });
        rawNodeIds.push(rawNodeId);
    });

    const filterNodeId = 'labs:filter';
    builder.addNode({
        id: filterNodeId,
        type: 'logical',
        subtype: 'filter',
        label: 'FILTER Lab Completion',
        group: 'labs',
        layer: 1,
        score: passedCount,
        maxScore: totalGroups,
        displayValue: 'pass/fail',
        status: 'selected',
        details: { quality: labQuality, operator: 'filter' },
    });
    rawNodeIds.forEach((nodeId) => builder.addEdge(nodeId, filterNodeId, { kind: 'policy' }));

    const dropNodeId = 'labs:drop';
    builder.addNode({
        id: dropNodeId,
        type: 'logical',
        subtype: 'drop',
        label: 'DROP Labs',
        group: 'labs',
        layer: 2,
        score: passedAfterDrop,
        maxScore: effectiveTotal,
        displayValue: `drop ${drops}`,
        status: 'selected',
        details: { quality: labQuality, operator: 'drop', dropsApplied: drops },
    });
    builder.addEdge(filterNodeId, dropNodeId, { kind: 'policy' });

    const scaleNodeId = 'labs:scale_cap';
    builder.addNode({
        id: scaleNodeId,
        type: 'logical',
        subtype: 'cap',
        label: 'SCALE + CAP Labs',
        group: 'labs',
        layer: 3,
        score: scaledScore,
        maxScore: summary.cap,
        displayValue: `${graphFormatPoints(scaledScore)} / ${summary.cap}`,
        status: 'selected',
        details: {
            quality: labQuality,
            operator: 'scale_cap',
            authoritativeOutput: summary.score,
        },
    });
    builder.addEdge(dropNodeId, scaleNodeId, { kind: 'policy' });
    return scaleNodeId;
}

function addProjectsGraph(builder, submissions, summary, policy = null) {
    const rawProjectRows = submissions.filter((row) => {
        const category = graphNormalize(row.category);
        if (String(row.assignment_id || '').startsWith('project_rollup:')) return false;
        if (graphIsPracticeAssignmentTitle(row.title || '')) return false;
        return category === 'projects' || category === '_projects_raw';
    });

    const byProject = new Map();
    rawProjectRows.forEach((row) => {
        const project = detectGraphProject(row.title || '', policy);
        if (!project) return;
        if (!byProject.has(project.key)) {
            byProject.set(project.key, { project, bySubitem: new Map() });
        }
        const item = byProject.get(project.key);
        const canonical = graphProjectCanonical(row.title || '');
        if (!canonical) return;
        if (!item.bySubitem.has(canonical)) item.bySubitem.set(canonical, []);
        item.bySubitem.get(canonical).push(row);
    });

    const projectScaleNodeIds = [];
    byProject.forEach(({ project, bySubitem }) => {
        const maxNodeIds = [];
        const subitemBestPcts = [];
        bySubitem.forEach((rows, canonical) => {
            const rawNodeIds = [];
            let bestPct = null;
            let bestNodeId = null;
            rows.forEach((row) => {
                const score = graphSafeNumber(row.total_score);
                const maxScore = graphSafeNumber(row.submission_max_points || row.assignment_max_points);
                const rowPct = maxScore > 0 ? score / maxScore : 0;
                const rawNodeId = `projects:${project.key}:raw:${row.assignment_pk}`;
                if (bestPct == null || rowPct > bestPct) {
                    bestPct = rowPct;
                    bestNodeId = rawNodeId;
                }
                builder.addNode({
                    id: rawNodeId,
                    type: 'raw',
                    subtype: 'project_submission',
                    label: row.title || canonical,
                    group: 'projects',
                    layer: 0,
                    score,
                    maxScore,
                    displayValue: `${graphFormatPoints(score)} / ${graphFormatPoints(maxScore)}`,
                    status: 'kept',
                    details: {
                        quality: 'direct',
                        project: project.label,
                        canonicalSubitem: canonical,
                        sourceAssignment: row.assignment_id,
                    },
                });
                rawNodeIds.push(rawNodeId);
            });

            const maxNodeId = `projects:${project.key}:max:${canonical}`;
            builder.addNode({
                id: maxNodeId,
                type: 'logical',
                subtype: 'max',
                label: `BEST ${canonical}`,
                group: 'projects',
                layer: 1,
                score: bestPct == null ? 0 : bestPct * 100,
                maxScore: 100,
                displayValue: bestPct == null ? 'no score' : `${(bestPct * 100).toFixed(1)}%`,
                status: 'selected',
                details: { quality: 'direct', operator: 'max', selectedNodeId: bestNodeId },
            });
            rawNodeIds.forEach((nodeId) => builder.addEdge(nodeId, maxNodeId, {
                kind: 'policy',
                label: nodeId === bestNodeId ? 'selected' : 'candidate',
                active: nodeId === bestNodeId,
            }));
            maxNodeIds.push(maxNodeId);
            subitemBestPcts.push(bestPct == null ? 0 : bestPct);
        });

        const scaleNodeId = `projects:${project.key}:scale`;
        const projectPct = subitemBestPcts.length > 0
            ? subitemBestPcts.reduce((sum, value) => sum + value, 0) / subitemBestPcts.length
            : 0;
        const scaledScore = projectPct * project.cap;
        builder.addNode({
            id: scaleNodeId,
            type: 'logical',
            subtype: 'scale',
            label: project.label,
            group: 'projects',
            layer: 2,
            score: scaledScore,
            maxScore: project.cap,
            displayValue: `${graphFormatPoints(scaledScore)} / ${graphFormatPoints(project.cap)}`,
            status: 'selected',
            details: {
                quality: 'direct',
                operator: 'scale',
                cap: project.cap,
                sourcePercentage: projectPct * 100,
                subitemCount: subitemBestPcts.length,
            },
        });
        maxNodeIds.forEach((nodeId) => builder.addEdge(nodeId, scaleNodeId, { kind: 'policy' }));
        projectScaleNodeIds.push(scaleNodeId);
    });

    const sumNodeId = 'projects:sum';
    builder.addNode({
        id: sumNodeId,
        type: 'logical',
        subtype: 'sum',
        label: 'SUM Projects',
        group: 'projects',
        layer: 3,
        score: summary.score,
        maxScore: summary.cap,
        displayValue: `${graphFormatPoints(summary.score)} / ${summary.cap}`,
        status: 'selected',
        details: { quality: 'direct', operator: 'sum' },
    });
    projectScaleNodeIds.forEach((nodeId) => builder.addEdge(nodeId, sumNodeId, { kind: 'score' }));
    return sumNodeId;
}

function addExamGraph(builder, examType, submissions, policyRows, summary, options = {}) {
    const group = examType;
    const examSubmissions = submissions.filter((row) => graphNormalize(row.exam_type) === examType && !row.is_practice);
    const questionMaxNodeIds = addRawQuestionNodes(builder, group, examSubmissions, {
        maxLabel: options.maxLabel || 'QUESTION BEST',
        maxSubtype: 'max',
    });

    let previousNodeId = null;
    if (questionMaxNodeIds.length > 0) {
        const sumNodeId = `${group}:question_sum`;
        builder.addNode({
            id: sumNodeId,
            type: 'logical',
            subtype: 'sum',
            label: `${summary.label} Topic Sum`,
            group,
            layer: 2,
            score: null,
            maxScore: null,
            displayValue: 'sum best topics',
            status: 'selected',
            details: { quality: 'direct', operator: 'sum' },
        });
        questionMaxNodeIds.forEach((nodeId) => builder.addEdge(nodeId, sumNodeId, { kind: 'score' }));
        previousNodeId = sumNodeId;
    }

    const bestPolicyPctValue = policyRows
        .map((row) => graphSafeNumber(row.question_best_percentage ?? row.final_percentage, NaN))
        .filter(Number.isFinite)
        .reduce((best, value) => Math.max(best, value), 0);

    if (!previousNodeId) {
        previousNodeId = `${group}:policy_pct`;
        builder.addNode({
            id: previousNodeId,
            type: 'logical',
            subtype: 'max',
            label: `${summary.label} Policy Score`,
            group,
            layer: 2,
            score: bestPolicyPctValue,
            maxScore: 100,
            displayValue: bestPolicyPctValue ? `${bestPolicyPctValue.toFixed(1)}%` : 'no policy rows',
            status: 'selected',
            details: { quality: 'estimated', operator: 'policy_fallback' },
        });
    }

    if (options.clobberSourceNodeId) {
        const clobberNodeId = `${group}:clobber`;
        builder.addNode({
            id: clobberNodeId,
            type: 'logical',
            subtype: 'clobber',
            label: `${summary.label} CLOBBER`,
            group,
            layer: 3,
            score: summary.score,
            maxScore: summary.cap,
            displayValue: 'take higher pct',
            status: 'selected',
            details: { quality: 'direct', operator: 'clobber' },
        });
        builder.addEdge(previousNodeId, clobberNodeId, { kind: 'policy', label: 'primary' });
        builder.addEdge(options.clobberSourceNodeId, clobberNodeId, { kind: 'clobber', label: 'clobber source' });
        previousNodeId = clobberNodeId;
    }

    const capNodeId = `${group}:cap`;
    builder.addNode({
        id: capNodeId,
        type: 'logical',
        subtype: 'cap',
        label: `CAP ${summary.label}`,
        group,
        layer: options.clobberSourceNodeId ? 4 : 3,
        score: summary.score,
        maxScore: summary.cap,
        displayValue: `${graphFormatPoints(summary.score)} / ${summary.cap}`,
        status: 'selected',
        details: { quality: 'direct', operator: 'cap' },
    });
    builder.addEdge(previousNodeId, capNodeId, { kind: 'policy' });
    return capNodeId;
}

function addCategoryOutput(builder, summary, sourceNodeId, layer = 5) {
    const outputId = `${summary.key}:output`;
    builder.addNode({
        id: outputId,
        type: 'category_output',
        subtype: 'category_output',
        label: summary.label,
        group: summary.key,
        layer,
        score: summary.score,
        maxScore: summary.cap,
        displayValue: `${graphFormatPoints(summary.score)} / ${graphFormatPoints(summary.cap)}`,
        status: 'output',
        details: {
            quality: 'direct',
            percentage: summary.percentage,
        },
    });
    if (sourceNodeId) {
        builder.addEdge(sourceNodeId, outputId, { kind: 'score', label: 'output' });
    }
    return outputId;
}

function resolveGraphExamTypeForComponent(component = {}) {
    const explicit = String(component.exam_type || component.examType || '').trim().toLowerCase();
    if (['quest', 'midterm', 'postterm'].includes(explicit)) {
        return explicit;
    }
    const candidates = [component.key, component.label, component.summary_source, component.summarySource];
    for (const candidate of candidates) {
        const normalized = graphNormalize(candidate);
        if (normalized.includes('quest')) return 'quest';
        if (normalized.includes('midterm')) return 'midterm';
        if (normalized.includes('postterm') || normalized.includes('posterm')) return 'postterm';
    }
    return null;
}

function addSimpleSummaryGraph(builder, summary) {
    const nodeId = `${summary.key}:policy_summary`;
    builder.addNode({
        id: nodeId,
        type: 'logical',
        subtype: 'summary',
        label: summary.label,
        group: summary.key,
        layer: 3,
        score: summary.score,
        maxScore: summary.cap,
        displayValue: `${graphFormatPoints(summary.score)} / ${graphFormatPoints(summary.cap)}`,
        status: 'selected',
        details: {
            quality: 'direct',
            operator: 'configured_summary',
        },
    });
    return nodeId;
}

/**
 * Builds a read-only compute graph explaining how raw scores flow through CS10 policy.
 * The graph's category output nodes intentionally use the existing authoritative
 * summary functions, so Grade Flow totals match Profile/Admin totals.
 */
export async function getStudentGradeFlow(email, courseId = null, options = {}) {
    const resolved = await resolveGraphStudent(email, courseId);
    if (!resolved) {
        const err = new Error('Student not found');
        err.status = 404;
        throw err;
    }

    const courseQueryId = resolved.gradescope_course_id || resolved.course_id;
    const policy = await getCoursePolicy(courseQueryId, getPool());
    const policyComponents = getCoursePolicyComponents(policy);
    let policySummaryPromise;
    if (options.canonicalGrade) {
        policySummaryPromise = Promise.resolve(buildPolicySummary(options.canonicalGrade));
    } else if (options.summaryByKey) {
        policySummaryPromise = Promise.resolve(buildPolicySummary(buildCanonicalGrade({
            components: policyComponents,
            categoryScores: options.summaryByKey,
            totalCap: policy.total_points_cap,
            gradeBins: policy.grade_bins,
            roundingPolicy: policy.rounding || policy.rounding_policy,
            source: 'legacy_summary_adapter',
            asOf: options.asOf || null,
        })));
    } else {
        policySummaryPromise = getStudentPolicySummaries(resolved.student_email, courseQueryId);
    }

    const [submissions, attendanceRows, examRows, policySummary] = await Promise.all([
        getGraphStudentSubmissions(resolved.student_id, resolved.course_id),
        getGraphAttendanceRows(resolved.student_id, resolved.course_id),
        getGraphExamPolicyRows(resolved.student_id, resolved.course_id),
        policySummaryPromise,
    ]);
    const canonicalGrade = policySummary.canonicalGrade;
    const summaries = canonicalGradeToLegacySummary(canonicalGrade).summaryByKey;

    const builder = createGradeFlowBuilder();

    const outputNodeIds = policyComponents.map((component) => {
        const summary = summaries[component.key] || {
            ...component,
            score: 0,
            rawScore: 0,
            percentage: 0,
        };
        const type = String(component.type || '').trim().toLowerCase();
        let sourceNodeId = null;

        if (type === 'attendance') {
            sourceNodeId = addAttendanceGraph(builder, attendanceRows, summary);
        } else if (type === 'labs') {
            sourceNodeId = addLabsGraph(builder, submissions, summary, policy);
        } else if (type === 'projects') {
            sourceNodeId = addProjectsGraph(builder, submissions, summary, policy);
        } else if (type === 'exam') {
            const examType = resolveGraphExamTypeForComponent(component);
            if (examType) {
                const rows = examRows.filter((row) => graphNormalize(row.exam_type) === examType);
                sourceNodeId = addExamGraph(builder, examType, submissions, rows, summary, {
                    maxLabel: examType === 'quest' ? 'MAX' : 'TOPIC BEST',
                });
            } else {
                sourceNodeId = addSimpleSummaryGraph(builder, summary);
            }
        } else {
            sourceNodeId = addSimpleSummaryGraph(builder, summary);
        }

        return addCategoryOutput(builder, summary, sourceNodeId);
    });

    const finalNodeId = 'course:final_output';
    builder.addNode({
        id: finalNodeId,
        type: 'final_output',
        subtype: 'final_output',
        label: 'Final Output',
        group: 'course',
        layer: 6,
        score: canonicalGrade.exactScore,
        maxScore: canonicalGrade.cap,
        displayValue: `${canonicalGrade.displayScore} / ${graphFormatPoints(canonicalGrade.cap)}`,
        status: 'output',
        details: {
            quality: 'direct',
            percentage: canonicalGrade.percentage,
            letter: canonicalGrade.letter,
            rounding: canonicalGrade.rounding,
        },
    });
    outputNodeIds.forEach((outputId) => builder.addEdge(outputId, finalNodeId, { kind: 'score', label: 'sum' }));

    const components = policyComponents.map((component) => ({
        id: component.key,
        label: component.label,
        score: graphSafeNumber(summaries[component.key]?.score),
        cap: component.cap,
        percentage: graphSafeNumber(summaries[component.key]?.percentage),
        collapsedByDefault: true,
        nodeIds: builder.nodes.filter((nodeItem) => nodeItem.group === component.key).map((nodeItem) => nodeItem.id),
    }));

    return {
        student: {
            email: resolved.student_email,
            name: resolved.student_name,
        },
        course: {
            id: String(resolved.course_id),
            gradescopeCourseId: resolved.gradescope_course_id,
            name: resolved.course_name,
        },
        nodes: builder.nodes,
        edges: builder.edges,
        groups: policyComponents.map((component) => ({
            id: component.key,
            label: component.label,
            collapsedByDefault: true,
        })),
        components,
        canonicalGrade,
        total: canonicalGradeToGradeFlowTotal(canonicalGrade),
    };
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
