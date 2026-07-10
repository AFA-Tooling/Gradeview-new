import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { __mockQuery as mockQuery } from '../lib/dbHelper.mjs';
import { IAM_ROLE } from '../lib/iam.mjs';
import { verifyAccessToken } from '../lib/jwtAuth.mjs';
import {
    buildPermissionTokenResponse,
    inheritSessionCapabilities,
} from '../lib/sessionToken.mjs';
import LoginRouter from '../v2/Routes/login/index.js';
import MeRouter from '../v2/Routes/me/index.js';

jest.mock('../lib/dbHelper.mjs', () => {
    const query = jest.fn();
    return {
        __mockQuery: query,
        getPool: () => ({ query }),
        studentEnrolledInCourse: jest.fn().mockResolvedValue(true),
    };
});

jest.mock('../lib/googleAuthHelper.mjs', () => {
    const { verifyAccessToken: verify } = jest.requireActual('../lib/jwtAuth.mjs');
    return {
        getEmailFromAuth: jest.fn(async (requestObject) => {
            const token = String(requestObject?.headers?.authorization || '').replace(/^Bearer\s+/i, '');
            try {
                const payload = verify(token);
                return payload.email || payload.sub;
            } catch {
                const error = new Error('Session token is invalid or expired. Please sign in again.');
                error.name = 'AuthorizationError';
                error.status = 401;
                throw error;
            }
        }),
    };
});

const COURSE_ID = 'course-a';
const STAFF_EMAIL = 'staff@example.edu';
const DEMO_EMAIL = 'public-demo@gradeview.local';

function snapshot(email = STAFF_EMAIL, overrides = {}) {
    return {
        email,
        is_super: false,
        generated_at: '2026-07-09T12:00:00.000Z',
        course_roles: { [COURSE_ID]: IAM_ROLE.COURSE_ADMIN },
        has_course_admin: true,
        has_instructor: false,
        has_student: false,
        ...overrides,
    };
}

function bearerPayload(response) {
    return verifyAccessToken(String(response.token).replace(/^Bearer\s+/i, ''));
}

function createApp(path, router) {
    const app = express();
    app.use(express.json());
    app.use(path, router);
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

describe('signed session capabilities', () => {
    let querySpy;

    beforeAll(() => {
        querySpy = mockQuery.mockImplementation(async (sql, params = []) => {
            const text = String(sql);
            if (text.includes('FROM courses c') && text.includes('JOIN course_permissions cp') && params.length === 2) {
                return {
                    rows: [{
                        id: 1,
                        gradescope_course_id: COURSE_ID,
                        name: 'Demo Course',
                        department: 'CS',
                        course_number: '10',
                        semester: 'Spring',
                        year: 2026,
                    }],
                };
            }
            if (text.includes('FROM users u') && text.includes('JOIN course_permissions cp')) {
                return {
                    rows: [{
                        course_id: '1',
                        gradescope_course_id: COURSE_ID,
                        permission_level: 'owner',
                        user_role: 'admin',
                    }],
                };
            }
            if (text.includes('FROM students st')) {
                return { rows: [] };
            }
            throw new Error(`Unexpected test query: ${text}`);
        });
    });

    afterAll(() => {
        querySpy.mockReset();
    });

    test('demo issuance signs an immutable read-only capability while normal issuance does not', () => {
        const demoResponse = buildPermissionTokenResponse(snapshot(DEMO_EMAIL, {
            is_demo: true,
            read_only: true,
            demo_course_id: COURSE_ID,
        }));
        const demoPayload = bearerPayload(demoResponse);

        expect(demoPayload).toMatchObject({
            is_demo: true,
            demo: true,
            read_only: true,
            demo_course_id: COURSE_ID,
            capabilities: {
                is_demo: true,
                read_only: true,
                demo_course_id: COURSE_ID,
            },
        });
        expect(demoResponse.permissions.read_only).toBe(true);

        const normalResponse = buildPermissionTokenResponse(snapshot());
        expect(bearerPayload(normalResponse)).toMatchObject({
            is_demo: false,
            demo: false,
            read_only: false,
            demo_course_id: null,
        });
    });

    test('capabilities are inherited only from the already verified auth snapshot', () => {
        const refreshed = inheritSessionCapabilities(snapshot(), {
            is_demo: true,
            read_only: true,
            demo_course_id: COURSE_ID,
        });
        expect(refreshed).toMatchObject({
            is_demo: true,
            read_only: true,
            demo_course_id: COURSE_ID,
        });

        const untrustedFieldsAreNotInputs = inheritSessionCapabilities(snapshot(), {});
        expect(untrustedFieldsAreNotInputs).toMatchObject({
            is_demo: false,
            read_only: false,
            demo_course_id: null,
        });
    });

    test('Demo refresh cannot broaden its signed course roles or become super admin from DB drift', () => {
        const refreshed = inheritSessionCapabilities(
            snapshot(DEMO_EMAIL, {
                is_super: true,
                course_roles: {
                    [COURSE_ID]: IAM_ROLE.COURSE_ADMIN,
                    'course-other': IAM_ROLE.COURSE_ADMIN,
                },
            }),
            snapshot(DEMO_EMAIL, {
                is_demo: true,
                read_only: true,
                demo_course_id: COURSE_ID,
                course_roles: { [COURSE_ID]: IAM_ROLE.COURSE_ADMIN },
            }),
        );

        expect(refreshed).toMatchObject({
            is_super: false,
            is_demo: true,
            read_only: true,
            course_roles: { [COURSE_ID]: IAM_ROLE.COURSE_ADMIN },
        });
        expect(refreshed.course_roles).not.toHaveProperty('course-other');
    });

    test('demo login signs read-only and both refresh endpoints preserve it without requiring course_id', async () => {
        const loginApp = createApp('/login', LoginRouter);
        const demoLogin = await request(loginApp).post('/login/demo').expect(200);
        const issuedPayload = bearerPayload(demoLogin.body);
        expect(issuedPayload).toMatchObject({
            is_demo: true,
            read_only: true,
            demo_course_id: COURSE_ID,
        });

        const loginRefresh = await request(loginApp)
            .get('/login')
            .set('Authorization', demoLogin.body.token)
            .expect(200);
        expect(bearerPayload(loginRefresh.body)).toMatchObject({
            is_demo: true,
            read_only: true,
            demo_course_id: COURSE_ID,
        });

        const meApp = createApp('/me', MeRouter);
        const permissionsRefresh = await request(meApp)
            .get('/me/permissions')
            .set('Authorization', loginRefresh.body.token)
            .expect(200);
        expect(bearerPayload(permissionsRefresh.body)).toMatchObject({
            is_demo: true,
            read_only: true,
            demo_course_id: COURSE_ID,
        });
        expect(permissionsRefresh.body.permissions).toMatchObject({
            is_demo: true,
            read_only: true,
        });
    });

    test('ordinary login and permissions bootstrap ignore untrusted demo query/body fields', async () => {
        const normal = buildPermissionTokenResponse(snapshot());
        const loginApp = createApp('/login', LoginRouter);
        const loginRefresh = await request(loginApp)
            .get('/login?is_demo=true&read_only=true')
            .set('Authorization', normal.token)
            .expect(200);
        expect(bearerPayload(loginRefresh.body)).toMatchObject({
            is_demo: false,
            read_only: false,
        });

        const meApp = createApp('/me', MeRouter);
        const permissionsRefresh = await request(meApp)
            .get('/me/permissions?is_demo=true&read_only=true')
            .set('Authorization', normal.token)
            .expect(200);
        expect(bearerPayload(permissionsRefresh.body)).toMatchObject({
            is_demo: false,
            read_only: false,
        });
    });

    test.each([
        ['invalid', 'Bearer not-a-valid-session-token'],
        ['expired', `Bearer ${jwt.sign(
            { sub: STAFF_EMAIL, email: STAFF_EMAIL },
            process.env.JWT_SECRET || 'gradeview-dev-secret-change-me',
            { issuer: 'gradeview-api', expiresIn: -1 },
        )}`],
    ])('%s refresh token forwards a stable 401 AUTH_REQUIRED contract', async (_, token) => {
        const queryCount = querySpy.mock.calls.length;
        const loginApp = createApp('/login', LoginRouter);
        const response = await request(loginApp)
            .get('/login')
            .set('Authorization', token)
            .expect(401);

        expect(response.body).toMatchObject({
            code: 'AUTH_REQUIRED',
            reason: 'Authentication is required for this request.',
            recovery: 'Sign in again, then retry the request.',
        });
        expect(querySpy).toHaveBeenCalledTimes(queryCount);
    });
});
