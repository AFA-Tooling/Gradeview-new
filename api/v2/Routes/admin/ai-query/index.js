import { Router } from 'express';
import { getPool } from '../../../../lib/dbHelper.mjs';
import {
    ACCESS_ERROR_CODE,
    createAccessPolicyError,
} from '../../../../lib/iam.mjs';
import {
    COURSE_QUERY_PLAN_ID,
    addLiveCourseSource,
    buildCourseScopedExecution,
    buildGeneratedCourseScopedExecution,
    listCourseScopedQueryPlans,
    normalizeCourseId,
} from './courseScope.js';

const router = Router({ mergeParams: true });

// Use shared pool
const getDbPool = () => getPool();

/**
 * Database Schema Information
 * Database structure information provided to AI
 */
const DATABASE_SCHEMA = {
    tables: {
        students: {
            description: "Student information table",
            columns: {
                id: "Integer, primary key",
                course_id: "Integer, enrolled course ID (foreign key)",
                sid: "String, student ID",
                email: "String, email address",
                legal_name: "String, full name"
            }
        },
        assignments: {
            description: "Assignment/Exam table",
            columns: {
                id: "Integer, primary key",
                assignment_id: "String, assignment ID",
                course_id: "Integer, course ID (foreign key)",
                title: "String, assignment title",
                category: "String, category (e.g., Projects, Labs, Exams)",
                max_points: "Numeric, maximum score"
            }
        },
        submissions: {
            description: "Submission records table",
            columns: {
                id: "Integer, primary key",
                assignment_id: "Integer, assignment ID (foreign key)",
                student_id: "Integer, student ID (foreign key)",
                total_score: "Numeric, score earned",
                max_points: "Numeric, maximum score",
                status: "String, submission status",
                submission_time: "Timestamp, submission time"
            }
        },
        courses: {
            description: "Course information table",
            columns: {
                id: "Integer, primary key",
                name: "String, course name",
                semester: "String, semester",
                year: "String, year"
            }
        }
    },
    relationships: {
        "submissions.student_id -> students.id": "Submission record linked to student",
        "submissions.assignment_id -> assignments.id": "Submission record linked to assignment",
        "assignments.course_id -> courses.id": "Assignment linked to course",
        "students.course_id -> courses.id": "Student enrollment linked to course"
    },
    common_patterns: [
        "Calculate average score: AVG(total_score / NULLIF(max_points, 0) * 100)",
        "Calculate standard deviation: STDDEV(total_score / NULLIF(max_points, 0) * 100)",
        "Calculate error rate: 100 - AVG(total_score / NULLIF(max_points, 0) * 100)",
        "Group statistics: GROUP BY student_id or assignment_id",
        "Time analysis: DATE_TRUNC('day', submission_time) or DATE_TRUNC('week', submission_time)"
    ]
};

/**
 * AI Query Endpoint - Dynamic SQL Generation
 * POST /admin/ai-query
 */
router.post('/', async (req, res, next) => {
    try {
        const { query, useAI = true } = req.body || {};
        const courseId = normalizeCourseId(req.query?.course_id);
        
        if (!String(query || '').trim()) {
            return res.status(400).json({ 
                error: 'Missing required field: query' 
            });
        }
        if (!courseId) {
            return next(createAccessPolicyError(ACCESS_ERROR_CODE.COURSE_SCOPE_REQUIRED));
        }

        console.log(`[AI Agent] Query: "${query}"`);

        let result;
        
        if (useAI && process.env.OPENAI_API_KEY) {
            // 使用AI生成SQL并执行
            result = await processWithAI(query, courseId);
        } else {
            // Fall back to rule-based queries
            result = await processWithRules(query, courseId);
        }

        res.json(addLiveCourseSource(result, courseId));

    } catch (error) {
        if (error?.isControlledApiError === true) {
            return next(error);
        }
        console.error('[AI Agent Error]', error);
        res.status(500).json({ 
            error: 'Internal server error',
            message: error.message 
        });
    }
});

/**
 * Generate SQL with AI and execute
 */
async function processWithAI(userQuery, courseId) {
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
        throw new Error('OpenAI API key not configured');
    }

    // 1. Generate SQL using AI
    const sqlQuery = await generateSQLWithAI(userQuery, apiKey);
    
    console.log(`[AI Agent] Generated SQL:`, sqlQuery);

    // 2. Resolve the generated text to a server-owned plan, then bind course scope.
    const execution = buildGeneratedCourseScopedExecution(sqlQuery, courseId);

    // 3. Execute only the server-owned SQL with the authorized course as $1.
    const queryResult = await executeCourseScopedQuery(execution);

    // 4. Explain results using AI
    const explanation = await explainResultsWithAI(userQuery, queryResult.rows, apiKey);

    return {
        type: 'ai_generated',
        answer: explanation,
        data: queryResult.rows,
        sqlQuery: execution.text,
        queryPlan: execution.planId,
        suggestions: generateSuggestions(userQuery, queryResult.rows),
        visualizationType: inferVisualizationType(queryResult.rows)
    };
}

/**
 * Generate SQL query using OpenAI
 */
async function generateSQLWithAI(userQuery, apiKey) {
    const approvedPlans = listCourseScopedQueryPlans();
    const prompt = `You are a PostgreSQL database expert. Generate SQL queries based on user questions.

Database Structure:
${JSON.stringify(DATABASE_SCHEMA, null, 2)}

User Question: ${userQuery}

Requirements:
1. Return exactly one SQL statement from the approved plans below, with no explanations.
2. Do not add, remove, reorder, or rewrite any clause.
3. Pick the plan that best matches the user's question.

Approved plans:
${JSON.stringify(approvedPlans, null, 2)}

SQL Query:`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'gpt-4',
            messages: [
                { 
                    role: 'system', 
                    content: 'You are a PostgreSQL expert. Generate only SQL queries, no explanations.' 
                },
                { role: 'user', content: prompt }
            ],
            temperature: 0.3,
            max_tokens: 500
        })
    });

    if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    let sqlQuery = data.choices[0].message.content.trim();

    // Clean SQL (remove markdown code block markers)
    sqlQuery = sqlQuery.replace(/```sql\n?/g, '').replace(/```\n?/g, '').trim();
    
    // Remove trailing semicolon
    sqlQuery = sqlQuery.replace(/;$/, '');

    return sqlQuery;
}

/**
 * Explain query results using AI
 */
async function explainResultsWithAI(userQuery, results, apiKey) {
    if (!results || results.length === 0) {
        return 'Query completed, but no matching data was found.';
    }

    const prompt = `User Question: ${userQuery}

Query returned ${results.length} records.

Data Sample (first 3):
${JSON.stringify(results.slice(0, 3), null, 2)}

Please summarize this query result in 1-2 concise sentences, in English.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'gpt-4',
            messages: [
                { 
                    role: 'system', 
                    content: 'You are a helpful data analyst. Provide concise summaries in English.' 
                },
                { role: 'user', content: prompt }
            ],
            temperature: 0.7,
            max_tokens: 200
        })
    });

    if (!response.ok) {
        return `Query returned ${results.length} records.`;
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
}

async function executeCourseScopedQuery(execution) {
    return getDbPool().query(execution.text, execution.values);
}

async function executeCourseScopedPlan(planId, courseId) {
    return executeCourseScopedQuery(buildCourseScopedExecution(planId, courseId));
}

/**
 * Rule-based query processing (fallback mode)
 */
async function processWithRules(userQuery, courseId) {
    const queryLower = userQuery.toLowerCase();
    
    // Simple keyword matching
    if (queryLower.includes('学生') || queryLower.includes('student') || queryLower.includes('波动') || queryLower.includes('variance')) {
        return await getStudentAnalysis(courseId);
    } else if (queryLower.includes('作业') || queryLower.includes('assignment') || queryLower.includes('题目')) {
        return await getAssignmentAnalysis(courseId);
    } else if (queryLower.includes('统计') || queryLower.includes('平均') || queryLower.includes('average') || queryLower.includes('statistics')) {
        return await getStatistics(courseId);
    } else {
        return await getGeneralOverview(courseId);
    }
}

/**
 * Student analysis (fallback mode)
 */
async function getStudentAnalysis(courseId) {
    const result = await executeCourseScopedPlan(COURSE_QUERY_PLAN_ID.STUDENT_VARIANCE, courseId);

    return {
        type: 'rule_based',
        answer: 'Based on rule matching, here are the student performance analysis results:',
        data: result.rows,
        suggestions: ['Try more specific questions', 'View detailed student performance'],
        visualizationType: 'table'
    };
}

/**
 * Assignment analysis (fallback mode)
 */
async function getAssignmentAnalysis(courseId) {
    const result = await executeCourseScopedPlan(COURSE_QUERY_PLAN_ID.ASSIGNMENT_DIFFICULTY, courseId);

    return {
        type: 'rule_based',
        answer: 'Here are the assignment difficulty analysis results:',
        data: result.rows,
        suggestions: ['View specific assignment details', 'Analyze error patterns'],
        visualizationType: 'table'
    };
}

/**
 * Statistical analysis (fallback mode)
 */
async function getStatistics(courseId) {
    const result = await executeCourseScopedPlan(COURSE_QUERY_PLAN_ID.SCORE_STATISTICS, courseId);

    return {
        type: 'rule_based',
        answer: 'Overall statistics are as follows:',
        data: result.rows[0],
        suggestions: ['View detailed distribution', 'Compare different categories'],
        visualizationType: 'statistics'
    };
}

/**
 * General overview (fallback mode)
 */
async function getGeneralOverview(courseId) {
    const result = await executeCourseScopedPlan(COURSE_QUERY_PLAN_ID.COURSE_OVERVIEW, courseId);

    return {
        type: 'rule_based',
        answer: 'Course overview:',
        data: result.rows[0],
        suggestions: ['View student performance', 'Analyze assignment difficulty', 'View submission trends'],
        visualizationType: 'statistics'
    };
}

/**
 * Generate intelligent suggestions
 */
function generateSuggestions(query, results) {
    const suggestions = [
        'View more detailed data',
        'Export these results',
        'Compare with other data'
    ];

    if (results && results.length > 0) {
        const firstRow = results[0];
        if ('name' in firstRow || 'legal_name' in firstRow) {
            suggestions.push('查看这些学生的具体作业表现');
        }
        if ('title' in firstRow || 'assignment' in firstRow) {
            suggestions.push('分析这些作业的错误模式');
        }
    }

    return suggestions;
}

/**
 * 推断可视化类型
 */
function inferVisualizationType(results) {
    if (!results || results.length === 0) {
        return 'text';
    }

    const firstRow = results[0];
    const keys = Object.keys(firstRow);

    // 统计数据（mean, median等）
    if (keys.includes('mean') || keys.includes('median') || keys.includes('avg')) {
        return 'statistics';
    }

    // 时间序列
    if (keys.some(k => k.includes('date') || k.includes('time') || k.includes('week'))) {
        return 'line';
    }

    // 对比数据
    if (keys.includes('category') || keys.includes('group')) {
        return 'comparison';
    }

    // 默认表格
    return 'table';
}

/**
 * GET /admin/ai-query/schema
 * 返回数据库schema信息
 */
router.get('/schema', async (req, res, next) => {
    const courseId = normalizeCourseId(req.query?.course_id);
    if (!courseId) {
        return next(createAccessPolicyError(ACCESS_ERROR_CODE.COURSE_SCOPE_REQUIRED));
    }
    res.json({
        schema: DATABASE_SCHEMA,
        note: 'Use this schema to understand the database structure',
        source: {
            type: 'live_course',
            course_id: courseId,
        },
    });
});

export default router;
