import express from 'express';
import request from 'supertest';
import { __mockQuery as mockQuery } from '../lib/dbHelper.mjs';
import { IAM_ROLE } from '../lib/iam.mjs';
import { buildPermissionTokenResponse } from '../lib/sessionToken.mjs';
import { compileSemanticQuery } from '../v2/Routes/admin/ai-query/semanticQuery.js';
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

function openAiResponse(spec) {
    return {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
            output: [{ content: [{ type: 'output_text', text: JSON.stringify(spec) }] }],
        }),
    };
}

describe('course-scoped AI analytics routes', () => {
    let app;
    let originalApiKey;

    beforeEach(() => {
        app = createApp();
        mockQuery.mockReset();
        mockQuery.mockImplementation(async (text) => {
            if (text.includes('FROM information_schema.columns')) {
                return { rows: [{ table_name: 'assignments', column_name: 'id', data_type: 'integer' }] };
            }
            if (text.includes('SELECT c.id, c.gradescope_course_id')) {
                return { rows: [{ id: 1, gradescope_course_id: COURSE_ID, name: 'Test Course' }] };
            }
            return {
                rows: [{
                    total_students: 32,
                    total_assignments: 24,
                    total_submissions: 512,
                    average_score: '88.50',
                }],
            };
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
            querySpec: { view: 'course_summary' },
            source: { type: 'live_course', course_id: COURSE_ID },
        });
        expect(mockQuery).toHaveBeenCalledTimes(1);
        expect(mockQuery.mock.calls[0][0]).toContain('WITH analytics AS');
        expect(mockQuery.mock.calls[0][1]).toEqual([COURSE_ID]);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('Demo readonly session may load schema without a database write or AI call', async () => {
        const response = await request(app)
            .get(`/admin/ai-query/schema?course_id=${COURSE_ID}`)
            .set('Authorization', courseAdminToken({ demo: true }))
            .expect(200);

        expect(response.body.source).toEqual({ type: 'live_course', course_id: COURSE_ID });
        expect(response.body.course).toMatchObject({ gradescope_course_id: COURSE_ID });
        expect(response.body.catalog.views.students.fields).not.toHaveProperty('email');
        expect(mockQuery).toHaveBeenCalledTimes(2);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('generated path executes only a validated semantic spec with the authorized $1 bind', async () => {
        process.env.OPENAI_API_KEY = 'test-key';
        const spec = { view: 'course_summary', select: [], filters: [], order_by: [], limit: 50 };
        global.fetch.mockResolvedValueOnce(openAiResponse(spec));

        const response = await request(app)
            .post(`/admin/ai-query?course_id=${COURSE_ID}`)
            .set('Authorization', courseAdminToken())
            .send({ query: 'Give me a course overview', useAI: true })
            .expect(200);

        expect(response.body).toMatchObject({
            type: 'ai_generated',
            querySpec: { view: 'course_summary' },
            source: { type: 'live_course', course_id: COURSE_ID },
        });
        expect(mockQuery).toHaveBeenCalledTimes(1);
        expect(mockQuery.mock.calls[0][0]).toContain('WITH analytics AS');
        expect(mockQuery.mock.calls[0][1]).toEqual([COURSE_ID]);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toMatchObject({
            text: { format: { type: 'json_schema', strict: true } },
        });
    });

    test.each([
        ['unknown view', { view: 'users', select: [], filters: [], order_by: [], limit: 10 }],
        ['private field', { view: 'students', select: ['email'], filters: [], order_by: [], limit: 10 }],
        ['select injection', { view: 'students', select: ['student_name; DROP TABLE students'], filters: [], order_by: [], limit: 10 }],
        ['filter injection', { view: 'students', select: ['student_name'], filters: [{ field: 'average_score OR TRUE', operator: 'gt', value: 0 }], order_by: [], limit: 10 }],
        ['operator injection', { view: 'students', select: ['student_name'], filters: [{ field: 'average_score', operator: '> 0; DROP TABLE students', value: 0 }], order_by: [], limit: 10 }],
    ])('rejects generated %s bypass before pool.query', async (_, generatedSpec) => {
        process.env.OPENAI_API_KEY = 'test-key';
        global.fetch.mockResolvedValueOnce(openAiResponse(generatedSpec));

        const response = await request(app)
            .post(`/admin/ai-query?course_id=${COURSE_ID}`)
            .set('Authorization', courseAdminToken())
            .send({ query: 'run generated analysis', useAI: true })
            .expect(422);

        expect(response.body).toMatchObject({
            code: 'SEMANTIC_QUERY_INVALID',
        });
        expect(mockQuery).not.toHaveBeenCalled();
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('structured endpoint compiles client specs and binds course scope', async () => {
        const spec = {
            view: 'students',
            select: ['student_name', 'average_score'],
            filters: [{ field: 'average_score', operator: 'lt', value: 60 }],
            order_by: [{ field: 'average_score', direction: 'asc' }],
            limit: 10,
        };
        const response = await request(app)
            .post(`/admin/ai-query/execute?course_id=${COURSE_ID}`)
            .set('Authorization', courseAdminToken())
            .send(spec)
            .expect(200);

        expect(response.body).toMatchObject({
            type: 'semantic_query',
            querySpec: spec,
            source: { type: 'live_course', course_id: COURSE_ID },
        });
        expect(mockQuery.mock.calls[0]).toEqual([
            compileSemanticQuery(spec, COURSE_ID).text,
            [COURSE_ID, 60],
        ]);
        expect(global.fetch).not.toHaveBeenCalled();
    });
});
