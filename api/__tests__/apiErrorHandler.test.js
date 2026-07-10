import express from 'express';
import request from 'supertest';
import { apiErrorHandler } from '../Router.js';

jest.mock('../v2/index.js', () => {
    const expressModule = jest.requireActual('express');
    return {
        __esModule: true,
        default: expressModule.Router(),
    };
});

function createErrorApp(errorFactory) {
    const app = express();
    app.get('/failure', () => {
        throw errorFactory();
    });
    app.use(apiErrorHandler);
    return app;
}

describe('production API error serialization', () => {
    test('serializes only a complete controlled API error contract', async () => {
        const response = await request(createErrorApp(() => Object.assign(new Error('readonly'), {
            isControlledApiError: true,
            status: 403,
            code: 'DEMO_READ_ONLY',
            reason: 'Demo sessions are read-only.',
            recovery: 'Sign in with a staff account.',
        }))).get('/failure').expect(403);

        expect(response.body).toEqual({
            error: 'Demo sessions are read-only.',
            code: 'DEMO_READ_ONLY',
            reason: 'Demo sessions are read-only.',
            recovery: 'Sign in with a staff account.',
        });
    });

    test('keeps the existing unexpected 500 text behavior', async () => {
        const response = await request(createErrorApp(() => new Error('unexpected failure')))
            .get('/failure')
            .expect(500);

        expect(response.text).toBe('unexpected failure');
        expect(response.body).toEqual({});
    });

    test('does not rewrite existing non-authorization status errors', async () => {
        const response = await request(createErrorApp(() => Object.assign(new Error('invalid payload'), {
            status: 422,
        }))).get('/failure').expect(422);

        expect(response.text).toBe('invalid payload');
        expect(response.body).toEqual({});
    });

    test('does not trust an incomplete object that only claims to be controlled', async () => {
        const response = await request(createErrorApp(() => Object.assign(new Error('incomplete'), {
            isControlledApiError: true,
            status: 403,
            code: 'SPOOFED',
            reason: 'missing recovery',
        }))).get('/failure').expect(403);

        expect(response.text).toBe('incomplete');
        expect(response.body).toEqual({});
    });
});
