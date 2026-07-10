import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { __mockVerifyIdToken as mockVerifyIdToken } from 'google-auth-library';
import { apiErrorHandler } from '../Router.js';
import { validateAuthenticatedMiddleware } from '../lib/authlib.mjs';
import { IAM_ROLE } from '../lib/iam.mjs';
import { buildPermissionTokenResponse } from '../lib/sessionToken.mjs';

jest.mock('google-auth-library', () => {
    const verifyIdToken = jest.fn();
    return {
        __mockVerifyIdToken: verifyIdToken,
        OAuth2Client: class MockOAuth2Client {
            verifyIdToken(options) {
                return verifyIdToken(options);
            }
        },
    };
});

jest.mock('../lib/dbHelper.mjs', () => ({
    getPool: () => ({
        query: jest.fn().mockResolvedValue({
            rows: [{ value: 'google-client-id-for-tests' }],
        }),
    }),
    studentEnrolledInCourse: jest.fn().mockResolvedValue(true),
}));

jest.mock('../lib/unifiedConfig.mjs', () => ({
    getGoogleOauthClientId: jest.fn(() => 'google-client-id-for-tests'),
    isAdmin: jest.fn(() => false),
}));

jest.mock('../v2/index.js', () => {
    const expressModule = jest.requireActual('express');
    return {
        __esModule: true,
        default: expressModule.Router(),
    };
});

const COURSE_ID = 'course-a';
const AUTH_REQUIRED_PAYLOAD = Object.freeze({
    error: 'Authentication is required for this request.',
    code: 'AUTH_REQUIRED',
    reason: 'Authentication is required for this request.',
    recovery: 'Sign in again, then retry the request.',
});

function createProtectedApp() {
    const app = express();
    app.get('/protected', validateAuthenticatedMiddleware, (req, res) => {
        res.status(200).json(req.auth);
    });
    app.use(apiErrorHandler);
    return app;
}

function forgedGoogleToken(label) {
    return jwt.sign(
        {
            iss: 'https://accounts.google.com',
            aud: 'google-client-id-for-tests',
            email: `${label}@example.invalid`,
        },
        `forged-${label}-secret`,
        { expiresIn: '1h' },
    );
}

describe('production authentication error normalization', () => {
    let app;
    let consoleErrorSpy;

    beforeEach(() => {
        app = createProtectedApp();
        mockVerifyIdToken.mockReset();
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    test('three distinct Google/JWT parser failures produce one identical safe contract', async () => {
        const attempts = [
            {
                token: 'malformed-sensitive-token',
                error: new Error('Wrong number of segments: malformed-sensitive-token'),
            },
            {
                token: forgedGoogleToken('signature'),
                error: Object.assign(
                    new Error('Invalid token signature; raw token was signature-sensitive-token'),
                    { code: 'ERR_JWT_SIGNATURE' },
                ),
            },
            {
                token: forgedGoogleToken('certificate'),
                error: Object.assign(
                    new Error('Certificate parser exposed certificate-sensitive-token'),
                    { name: 'CertificateParserError', code: 'CERT_PARSE' },
                ),
            },
        ];

        const payloads = [];
        for (const attempt of attempts) {
            mockVerifyIdToken.mockRejectedValueOnce(attempt.error);
            const response = await request(app)
                .get('/protected')
                .set('Authorization', `Bearer ${attempt.token}`)
                .expect(401);

            payloads.push(response.body);
            expect(response.body).toEqual(AUTH_REQUIRED_PAYLOAD);
            expect(JSON.stringify(response.body)).not.toContain(attempt.token);
            expect(JSON.stringify(response.body)).not.toContain(attempt.error.message);
        }

        expect(payloads).toEqual([
            AUTH_REQUIRED_PAYLOAD,
            AUTH_REQUIRED_PAYLOAD,
            AUTH_REQUIRED_PAYLOAD,
        ]);

        const serializedLogs = JSON.stringify(consoleErrorSpy.mock.calls);
        for (const attempt of attempts) {
            expect(serializedLogs).not.toContain(attempt.token);
            expect(serializedLogs).not.toContain(attempt.error.message);
        }
        expect(serializedLogs).toContain('Google authorization failed.');
    });

    test('missing and expired GradeView credentials both remain stable 401 AUTH_REQUIRED responses', async () => {
        const missing = await request(app).get('/protected').expect(401);

        const expiredToken = jwt.sign(
            { sub: 'expired@example.edu', email: 'expired@example.edu' },
            process.env.JWT_SECRET || 'gradeview-dev-secret-change-me',
            { issuer: 'gradeview-api', expiresIn: -1 },
        );
        const expired = await request(app)
            .get('/protected')
            .set('Authorization', `Bearer ${expiredToken}`)
            .expect(401);

        expect(missing.body).toEqual(AUTH_REQUIRED_PAYLOAD);
        expect(expired.body).toEqual(AUTH_REQUIRED_PAYLOAD);
        expect(JSON.stringify(expired.body)).not.toContain(expiredToken);
        expect(mockVerifyIdToken).not.toHaveBeenCalled();
    });

    test('a verified Demo session keeps its signed role, course, and readonly claims', async () => {
        const tokenResponse = buildPermissionTokenResponse({
            email: 'public-demo@gradeview.local',
            is_super: false,
            course_roles: { [COURSE_ID]: IAM_ROLE.COURSE_ADMIN },
            has_course_admin: true,
            has_instructor: false,
            has_student: false,
            is_demo: true,
            read_only: true,
            demo_course_id: COURSE_ID,
        });

        const response = await request(app)
            .get(`/protected?course_id=${COURSE_ID}`)
            .set('Authorization', tokenResponse.token)
            .expect(200);

        expect(response.body).toMatchObject({
            email: 'public-demo@gradeview.local',
            role: IAM_ROLE.COURSE_ADMIN,
            courseId: COURSE_ID,
            isDemo: true,
            readOnly: true,
            snapshotFromToken: true,
            snapshot: {
                is_demo: true,
                read_only: true,
                demo_course_id: COURSE_ID,
                course_roles: { [COURSE_ID]: IAM_ROLE.COURSE_ADMIN },
            },
        });
        expect(mockVerifyIdToken).not.toHaveBeenCalled();
    });
});
