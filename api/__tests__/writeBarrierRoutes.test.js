import { EventEmitter } from 'events';
import express from 'express';
import http from 'http';
import request from 'supertest';
import {
    __mockClearPolicyCache as mockClearPolicyCache,
    __mockGetStaffCourses as mockGetStaffCourses,
    __mockGetStudentCourses as mockGetStudentCourses,
    __mockQuery as mockQuery,
} from '../lib/dbHelper.mjs';
import { IAM_ROLE } from '../lib/iam.mjs';
import { buildPermissionTokenResponse } from '../lib/sessionToken.mjs';
import AdminRouter from '../v2/Routes/admin/index.js';
import ConfigRouter from '../v2/Routes/config/index.js';
import StudentsRouter from '../v2/Routes/students/index.js';

jest.mock('../lib/dbHelper.mjs', () => {
    const query = jest.fn();
    const clearPolicySummaryCache = jest.fn();
    const getStudentCourses = jest.fn();
    const getStaffCourses = jest.fn();
    return {
        __mockQuery: query,
        __mockClearPolicyCache: clearPolicySummaryCache,
        __mockGetStudentCourses: getStudentCourses,
        __mockGetStaffCourses: getStaffCourses,
        getPool: () => ({ query }),
        clearPolicySummaryCache,
        getStudentCourses,
        getStaffCourses,
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

function demoToken() {
    return buildPermissionTokenResponse({
        email: 'public-demo@gradeview.local',
        is_super: false,
        course_roles: { [COURSE_ID]: IAM_ROLE.COURSE_ADMIN },
        has_course_admin: true,
        has_instructor: false,
        has_student: false,
        is_demo: true,
        read_only: true,
        demo_course_id: COURSE_ID,
    }).token;
}

function courseAdminToken() {
    return buildPermissionTokenResponse({
        email: 'admin@example.edu',
        is_super: false,
        course_roles: { [COURSE_ID]: IAM_ROLE.COURSE_ADMIN },
        has_course_admin: true,
        has_instructor: false,
        has_student: false,
    }).token;
}

function controlledErrorHandler(error, _, response, next) {
    if (error?.isControlledApiError === true) {
        return response.status(error.status).json({
            error: error.reason,
            code: error.code,
            reason: error.reason,
            recovery: error.recovery,
        });
    }
    return next(error);
}

function createApp() {
    const app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    app.use('/admin', AdminRouter);
    app.use('/config', ConfigRouter);
    app.use('/students', StudentsRouter);
    app.use(controlledErrorHandler);
    return app;
}

function createJsonHttpRequest(onResponse, payload, statusCode = 200) {
    const outgoing = new EventEmitter();
    outgoing.setTimeout = jest.fn();
    outgoing.write = jest.fn();
    outgoing.end = jest.fn(() => {
        const incoming = new EventEmitter();
        incoming.statusCode = statusCode;
        onResponse(incoming);
        queueMicrotask(() => {
            incoming.emit('data', Buffer.from(JSON.stringify(payload)));
            incoming.emit('end');
        });
    });
    outgoing.destroy = jest.fn();
    return outgoing;
}

describe('server-enforced Demo write barrier', () => {
    let app;
    let httpRequestSpy;
    let gradeSyncRequestSpy;
    let gradeSyncResponse;

    beforeEach(() => {
        app = createApp();
        mockQuery.mockReset();
        mockClearPolicyCache.mockReset();
        mockGetStudentCourses.mockReset().mockResolvedValue([]);
        mockGetStaffCourses.mockReset().mockResolvedValue([
            { id: COURSE_ID, name: 'Authorized demo course' },
        ]);
        gradeSyncRequestSpy = jest.fn();
        gradeSyncResponse = null;
        const originalHttpRequest = http.request;
        httpRequestSpy = jest.spyOn(http, 'request').mockImplementation((options, onResponse) => {
            const isGradeSyncRequest = String(options?.path || '').startsWith('/api/');
            if (!isGradeSyncRequest) {
                return originalHttpRequest.call(http, options, onResponse);
            }

            gradeSyncRequestSpy(options);
            if (!gradeSyncResponse) {
                throw new Error('Unexpected GradeSync side effect in test');
            }
            return createJsonHttpRequest(
                onResponse,
                gradeSyncResponse.payload,
                gradeSyncResponse.statusCode,
            );
        });
    });

    afterEach(() => {
        httpRequestSpy.mockRestore();
    });

    test.each([
        ['PUT', '/config', { googleconfig: { oauth: { clientid: 'changed' } } }],
        ['PUT', `/config/sync`, { courses: [] }],
        ['PUT', `/config/courses/${COURSE_ID}`, { name: 'changed' }],
        ['PUT', `/config/courses/${COURSE_ID}/permissions`, { email: 'new@example.edu', iam_role: 'instructor' }],
        ['DELETE', `/config/courses/${COURSE_ID}/permissions/old%40example.edu`, null],
        ['POST', '/config/permissions/normalize-legacy', { course_id: COURSE_ID }],
    ])('%s %s returns the same readonly contract before any database side effect', async (method, path, body) => {
        let call = request(app)[method.toLowerCase()](path).set('Authorization', demoToken());
        if (body) call = call.send(body);
        const response = await call.expect(403);

        expect(response.body).toMatchObject({
            code: 'DEMO_READ_ONLY',
            reason: 'Demo sessions are read-only and cannot change GradeView data.',
            recovery: 'Sign in with an authorized staff account to make changes.',
        });
        expect(mockQuery).not.toHaveBeenCalled();
        expect(gradeSyncRequestSpy).not.toHaveBeenCalled();
    });

    test.each([
        `/admin/sync/${COURSE_ID}`,
        `/admin/sync/${COURSE_ID}/start`,
    ])('POST %s is rejected before sync/network/job side effects', async (path) => {
        const response = await request(app)
            .post(path)
            .set('Authorization', demoToken())
            .expect(403);

        expect(response.body).toMatchObject({ code: 'DEMO_READ_ONLY' });
        expect(gradeSyncRequestSpy).not.toHaveBeenCalled();
        expect(mockClearPolicyCache).not.toHaveBeenCalled();
        expect(mockQuery).not.toHaveBeenCalled();
    });

    test.each([
        ['POST', '/admin/sync/course-other', null],
        ['PUT', '/config/courses/course-other', { name: 'cross-course write' }],
    ])('%s %s rejects a normal admin cross-course write before side effects', async (method, path, body) => {
        let call = request(app)[method.toLowerCase()](path).set('Authorization', courseAdminToken());
        if (body) call = call.send(body);
        const response = await call.expect(403);

        expect(response.body).toMatchObject({ code: 'COURSE_SCOPE_FORBIDDEN' });
        expect(mockQuery).not.toHaveBeenCalled();
        expect(gradeSyncRequestSpy).not.toHaveBeenCalled();
        expect(mockClearPolicyCache).not.toHaveBeenCalled();
    });

    test('Demo can still discover its readable sync course without course_id bootstrap deadlock', async () => {
        gradeSyncResponse = {
            payload: {
                courses: [
                    { id: COURSE_ID, name: 'Authorized demo course' },
                    { id: 'course-other', name: 'Other course' },
                ],
            },
            statusCode: 200,
        };

        const response = await request(app)
            .get('/admin/sync')
            .set('Authorization', demoToken())
            .expect(200);

        expect(response.body.courses).toEqual([
            { id: COURSE_ID, name: 'Authorized demo course' },
        ]);
        expect(gradeSyncRequestSpy).toHaveBeenCalledTimes(1);
        expect(mockQuery).not.toHaveBeenCalled();
    });

    test('student/staff course bootstrap remains readable without a preselected course_id', async () => {
        const response = await request(app)
            .get('/students/courses')
            .set('Authorization', demoToken())
            .expect(200);

        expect(response.body.courses).toEqual([
            { id: COURSE_ID, name: 'Authorized demo course' },
        ]);
        expect(mockGetStudentCourses).toHaveBeenCalledWith('public-demo@gradeview.local');
        expect(mockGetStaffCourses).toHaveBeenCalledWith('public-demo@gradeview.local');
        expect(mockQuery).not.toHaveBeenCalled();
        expect(gradeSyncRequestSpy).not.toHaveBeenCalled();
    });
});
