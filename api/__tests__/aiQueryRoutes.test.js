import express from 'express';
import request from 'supertest';
import { __mockQuery as mockQuery } from '../lib/dbHelper.mjs';
import { IAM_ROLE } from '../lib/iam.mjs';
import { buildPermissionTokenResponse } from '../lib/sessionToken.mjs';
import {
    COURSE_QUERY_PLAN_ID,
    getCourseScopedQueryPlan,
} from '../v2/Routes/admin/ai-query/courseScope.js';
import AdminRouter from '../v2/Routes/admin/index.js';

jest.mock('../lib/dbHelper.mjs', () => {
    const query = jest.fn();
    return {
        __mockQuery: query,
        getPool: () => ({ query }),
        clearPolicySummaryCache: jest.fn(),
        studentEnrolledInCourse: jest.fn().mockResolvedValue(true),
    };
});

jest.mock('../lib/googleAuthHelper.mjs', () => {
    const { verifyAccessToken } = jest.requireActual('../lib/jwtAuth.mjs');
    return {
        getEmailFromAuth: jest.fn(async (requestObject) => {
            const token = String(requestObject?.headers?.authorization || '').replace(/^Bearer\s+/i, '');
            const payload = verifyAccessToken(token);
            return payload.email || payload.sub;
        }),
    };
});

const COURSE_ID = 'course-a';
const OTHER_COURSE_ID = 'course-other';

function courseAdminToken({ demo = false } = {}) {
    return buildPermissionTokenResponse({
        email: demo ? 'public-demo@gradeview.local' : 'admin@example.edu',
        is_super: false,
        course_roles: { [COURSE_ID]: IAM_ROLE.COURSE_ADMIN },
        has_course_admin: true,
        has_instructor: false,
        has_student: false,
        is_demo: demo,
        read_only: demo,
        demo_course_id: demo ? COURSE_ID : null,
    }).token;
}

function createApp() {
    const app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    app.use('/admin', AdminRouter);
    app.use((error, _, response, next) => {
        if (error?.isControlledApiError === true) {
            return response.status(error.status).json({
                error: error.reason,
                code: error.code,
                reason: error.reason,
                recovery: error.recovery,
            });
        }
        return next(error);
    });
    return app;
}

function openAiResponse(content) {
    return {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
            choices: [{ message: { content } }],
        }),
    };
}

describe('course-scoped AI analytics routes', () => {
    let app;
    let originalApiKey;

    beforeEach(() => {
        app = createApp();
        mockQuery.mockReset();
        mockQuery.mockResolvedValue({
            rows: [{
                total_students: '32',
                total_assignments: '24',
                total_submissions: '512',
                overall_avg: '88.50',
            }],
        });
        originalApiKey = process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_API_KEY;
        global.fetch = jest.fn();
    });

    afterEach(() => {
        if (originalApiKey === undefined) {
            delete process.env.OPENAI_API_KEY;
        } else {
            process.env.OPENAI_API_KEY = originalApiKey;
        }
        delete global.fetch;
    });

    test.each([
        ['/admin/ai-query', 'COURSE_SCOPE_REQUIRED', 400],
        ['/admin/ai-query?course_id=course-a&course_id=course-other', 'COURSE_SCOPE_REQUIRED', 400],
        [`/admin/ai-query?course_id=${OTHER_COURSE_ID}`, 'COURSE_SCOPE_FORBIDDEN', 403],
    ])('rejects invalid course context at %s before querying', async (path, code, status) => {
        const response = await request(app)
            .post(path)
            .set('Authorization', courseAdminToken())
            .send({ query: 'overview', useAI: false })
            .expect(status);

        expect(response.body).toMatchObject({ code });
        expect(mockQuery).not.toHaveBeenCalled();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('Demo readonly session may run rule-based analysis with one authorized course bind', async () => {
        const response = await request(app)
            .post(`/admin/ai-query?course_id=${COURSE_ID}`)
            .set('Authorization', courseAdminToken({ demo: true }))
            .send({ query: 'overview', useAI: false })
            .expect(200);

        expect(response.body).toMatchObject({
            type: 'rule_based',
            source: { type: 'live_course', course_id: COURSE_ID },
        });
        expect(mockQuery).toHaveBeenCalledTimes(1);
        expect(mockQuery.mock.calls[0][0]).toBe(
            getCourseScopedQueryPlan(COURSE_QUERY_PLAN_ID.COURSE_OVERVIEW).sql,
        );
        expect(mockQuery.mock.calls[0][1]).toEqual([COURSE_ID]);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('Demo readonly session may load schema without a database write or AI call', async () => {
        const response = await request(app)
            .get(`/admin/ai-query/schema?course_id=${COURSE_ID}`)
            .set('Authorization', courseAdminToken({ demo: true }))
            .expect(200);

        expect(response.body.source).toEqual({ type: 'live_course', course_id: COURSE_ID });
        expect(mockQuery).not.toHaveBeenCalled();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('generated path executes only a re-resolved trusted plan with the authorized $1 bind', async () => {
        process.env.OPENAI_API_KEY = 'test-key';
        const approvedSql = getCourseScopedQueryPlan(COURSE_QUERY_PLAN_ID.COURSE_OVERVIEW).sql.trim();
        global.fetch
            .mockResolvedValueOnce(openAiResponse(approvedSql))
            .mockResolvedValueOnce(openAiResponse('Authorized course overview.'));

        const response = await request(app)
            .post(`/admin/ai-query?course_id=${COURSE_ID}`)
            .set('Authorization', courseAdminToken())
            .send({ query: 'Give me a course overview', useAI: true })
            .expect(200);

        expect(response.body).toMatchObject({
            type: 'ai_generated',
            queryPlan: COURSE_QUERY_PLAN_ID.COURSE_OVERVIEW,
            source: { type: 'live_course', course_id: COURSE_ID },
        });
        expect(mockQuery).toHaveBeenCalledTimes(1);
        expect(mockQuery.mock.calls[0]).toEqual([
            getCourseScopedQueryPlan(COURSE_QUERY_PLAN_ID.COURSE_OVERVIEW).sql,
            [COURSE_ID],
        ]);
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    const approved = getCourseScopedQueryPlan(COURSE_QUERY_PLAN_ID.COURSE_OVERVIEW).sql.trim();
    test.each([
        ['comment', `${approved} -- pretend scoped`],
        ['UNION', `${approved} UNION SELECT * FROM students`],
        ['OR tautology', approved.replace('WHERE (c.id::text = $1 OR c.gradescope_course_id::text = $1)', 'WHERE (c.id::text = $1 OR c.gradescope_course_id::text = $1 OR TRUE)')],
        ['unused CTE', `WITH scoped AS (SELECT 1 FROM courses c WHERE (c.id::text = $1 OR c.gradescope_course_id::text = $1)) SELECT * FROM students`],
        ['subquery', `SELECT * FROM (${approved}) scoped CROSS JOIN students`],
        ['second statement', `${approved}; SELECT * FROM students`],
        ['$2 course', approved.replace(/\$1/g, '$2')],
        ['multiple course params', approved.replace('c.gradescope_course_id::text = $1', 'c.gradescope_course_id::text = $2')],
    ])('rejects generated %s bypass before pool.query', async (_, generatedSql) => {
        process.env.OPENAI_API_KEY = 'test-key';
        global.fetch.mockResolvedValueOnce(openAiResponse(generatedSql));

        const response = await request(app)
            .post(`/admin/ai-query?course_id=${COURSE_ID}`)
            .set('Authorization', courseAdminToken())
            .send({ query: 'run generated analysis', useAI: true })
            .expect(422);

        expect(response.body).toMatchObject({
            code: 'AI_QUERY_SCOPE_REJECTED',
        });
        expect(mockQuery).not.toHaveBeenCalled();
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });
});
