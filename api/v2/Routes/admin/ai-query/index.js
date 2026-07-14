import { Router } from 'express';
import { getPool } from '../../../../lib/dbHelper.mjs';
import {
    ACCESS_ERROR_CODE,
    createAccessPolicyError,
} from '../../../../lib/iam.mjs';
import {
    addLiveCourseSource,
    normalizeCourseId,
} from './courseScope.js';
import {
    compileSemanticQuery,
    describeLiveCourseAnalytics,
    getSemanticCatalog,
    planNaturalLanguageQuery,
    summarizeSemanticResult,
} from './semanticQuery.js';

const router = Router({ mergeParams: true });

// Use shared pool
const getDbPool = () => getPool();

/** Natural-language entry point used by the GradeView web client. */
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
            result = await processWithAI(query, courseId);
        } else {
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

/** Structured entry point used by the MCP server and other trusted clients. */
router.post('/execute', async (req, res, next) => {
    try {
        const courseId = normalizeCourseId(req.query?.course_id);
        if (!courseId) {
            return next(createAccessPolicyError(ACCESS_ERROR_CODE.COURSE_SCOPE_REQUIRED));
        }
        const execution = compileSemanticQuery(req.body, courseId);
        const result = await executeCourseScopedQuery(execution);
        return res.json(addLiveCourseSource({
            type: 'semantic_query',
            answer: summarizeSemanticResult(execution.spec, result.rows),
            data: result.rows,
            querySpec: execution.spec,
            visualizationType: inferVisualizationType(result.rows),
        }, courseId));
    } catch (error) {
        if (error?.isControlledApiError === true) return next(error);
        return next(error);
    }
});

async function processWithAI(userQuery, courseId) {
    const apiKey = process.env.OPENAI_API_KEY;
    const querySpec = await generateSemanticSpecWithAI(userQuery, apiKey);
    const execution = compileSemanticQuery(querySpec, courseId);
    const queryResult = await executeCourseScopedQuery(execution);

    return {
        type: 'ai_generated',
        answer: summarizeSemanticResult(execution.spec, queryResult.rows),
        data: queryResult.rows,
        querySpec: execution.spec,
        suggestions: generateSuggestions(userQuery, queryResult.rows),
        visualizationType: inferVisualizationType(queryResult.rows)
    };
}

const QUERY_SPEC_SCHEMA = Object.freeze({
    type: 'object',
    properties: {
        view: { type: 'string', enum: Object.keys(getSemanticCatalog().views) },
        select: { type: 'array', items: { type: 'string' }, maxItems: 12 },
        filters: {
            type: 'array',
            maxItems: 8,
            items: {
                type: 'object',
                properties: {
                    field: { type: 'string' },
                    operator: { type: 'string', enum: [...getSemanticCatalog().operators, 'in'] },
                    value: {
                        anyOf: [
                            { type: 'string' },
                            { type: 'number' },
                            { type: 'array', items: { type: 'string' }, maxItems: 50 },
                        ],
                    },
                },
                required: ['field', 'operator', 'value'],
                additionalProperties: false,
            },
        },
        order_by: {
            type: 'array',
            maxItems: 4,
            items: {
                type: 'object',
                properties: {
                    field: { type: 'string' },
                    direction: { type: 'string', enum: ['asc', 'desc'] },
                },
                required: ['field', 'direction'],
                additionalProperties: false,
            },
        },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
    required: ['view', 'select', 'filters', 'order_by', 'limit'],
    additionalProperties: false,
});

function extractResponseText(data) {
    if (typeof data?.output_text === 'string') return data.output_text;
    for (const item of Array.isArray(data?.output) ? data.output : []) {
        for (const content of Array.isArray(item?.content) ? item.content : []) {
            if (content?.type === 'output_text' && typeof content.text === 'string') return content.text;
        }
    }
    throw new Error('OpenAI response did not contain a query specification.');
}

async function generateSemanticSpecWithAI(userQuery, apiKey) {
    const catalog = getSemanticCatalog();
    const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: process.env.OPENAI_QUERY_MODEL || 'gpt-5.6-luna',
            input: [
                {
                    role: 'system',
                    content: `Map the user's course analytics question to the supplied semantic catalog. Never produce SQL. Use only fields that belong to the selected view. Catalog: ${JSON.stringify(catalog)}`,
                },
                { role: 'user', content: userQuery },
            ],
            max_output_tokens: 800,
            text: {
                format: {
                    type: 'json_schema',
                    name: 'gradeview_semantic_query',
                    strict: true,
                    schema: QUERY_SPEC_SCHEMA,
                },
            },
        })
    });

    if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
    }
    const data = await response.json();
    return JSON.parse(extractResponseText(data));
}

async function executeCourseScopedQuery(execution) {
    return getDbPool().query(execution.text, execution.values);
}

async function processWithRules(userQuery, courseId) {
    const execution = compileSemanticQuery(planNaturalLanguageQuery(userQuery), courseId);
    const result = await executeCourseScopedQuery(execution);
    return {
        type: 'rule_based',
        answer: summarizeSemanticResult(execution.spec, result.rows),
        data: result.rows,
        querySpec: execution.spec,
        suggestions: generateSuggestions(userQuery, result.rows),
        visualizationType: inferVisualizationType(result.rows),
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
        if ('student_name' in firstRow) {
            suggestions.push('查看这些学生的具体作业表现');
        }
        if ('assignment_title' in firstRow) {
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
    if (keys.includes('total_students') || keys.includes('minimum_score') || keys.includes('maximum_score')) {
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

router.get('/schema', async (req, res, next) => {
    try {
        const courseId = normalizeCourseId(req.query?.course_id);
        if (!courseId) {
            return next(createAccessPolicyError(ACCESS_ERROR_CODE.COURSE_SCOPE_REQUIRED));
        }
        const description = await describeLiveCourseAnalytics(getDbPool(), courseId);
        return res.json({
            ...description,
            schema: description.catalog,
            note: 'Live database shape plus the safe semantic analytics catalog.',
            source: {
                type: 'live_course',
                course_id: courseId,
            },
        });
    } catch (error) {
        if (error?.isControlledApiError === true) return next(error);
        return next(error);
    }
});

export default router;
