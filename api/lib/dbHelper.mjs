import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') }); // Relative to api/lib/ is ../../

let pool = null;

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

/**
 * Gets score distribution for category summary (sum of all assignments in category)
 * @param {string} category - The assignment category (may not match DB, legacy parameter)
 * @returns {Promise<Array>} Array of {studentName, studentEmail, score}
 */
export async function getCategorySummaryDistribution(category, courseId = null) {
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
            score: parseFloat(row.total_score) || 0,
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
