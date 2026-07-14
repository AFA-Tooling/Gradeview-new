#!/usr/bin/env node

import readline from 'node:readline';

const SERVER_INFO = { name: 'gradeview-course-analytics', version: '0.1.0' };
const API_BASE_URL = String(process.env.GRADEVIEW_API_BASE_URL || 'http://localhost').replace(/\/$/, '');

function courseIdFrom(args) {
    const courseId = String(args?.course_id || process.env.GRADEVIEW_DEFAULT_COURSE_ID || '').trim();
    if (!courseId) throw new Error('course_id is required (or set GRADEVIEW_DEFAULT_COURSE_ID).');
    return courseId;
}

function authorizationHeader() {
    const token = String(process.env.GRADEVIEW_API_TOKEN || '').trim();
    if (!token) throw new Error('GRADEVIEW_API_TOKEN is required. Copy a valid GradeView session token into the MCP environment.');
    return token;
}

async function gradeViewRequest(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        method,
        headers: {
            Authorization: authorizationHeader(),
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        const reason = payload?.reason || payload?.message || payload?.error || `GradeView request failed (${response.status}).`;
        const error = new Error(reason);
        error.code = payload?.code || `HTTP_${response.status}`;
        throw error;
    }
    return payload;
}

const tools = [
    {
        name: 'describe_course_analytics',
        description: 'Read the live database shape and safe semantic analytics catalog for one authorized GradeView course.',
        inputSchema: {
            type: 'object',
            properties: { course_id: { type: 'string', description: 'Internal or Gradescope course ID.' } },
            additionalProperties: false,
        },
    },
    {
        name: 'query_course_analytics',
        description: 'Run a read-only, course-scoped semantic query. Call describe_course_analytics first and use only fields from one returned view.',
        inputSchema: {
            type: 'object',
            properties: {
                course_id: { type: 'string', description: 'Internal or Gradescope course ID.' },
                view: { type: 'string' },
                select: { type: 'array', items: { type: 'string' } },
                filters: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            field: { type: 'string' },
                            operator: { type: 'string' },
                            value: {},
                        },
                        required: ['field', 'operator', 'value'],
                        additionalProperties: false,
                    },
                },
                order_by: {
                    type: 'array',
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
            required: ['view'],
            additionalProperties: false,
        },
    },
];

async function callTool(name, args) {
    const courseId = courseIdFrom(args);
    if (name === 'describe_course_analytics') {
        return gradeViewRequest(`/api/v2/admin/ai-query/schema?course_id=${encodeURIComponent(courseId)}`);
    }
    if (name === 'query_course_analytics') {
        const { course_id: ignored, ...spec } = args || {};
        return gradeViewRequest(`/api/v2/admin/ai-query/execute?course_id=${encodeURIComponent(courseId)}`, {
            method: 'POST',
            body: spec,
        });
    }
    throw new Error(`Unknown tool: ${name}`);
}

function send(message) {
    process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(message) {
    if (message.method === 'notifications/initialized') return;
    if (message.method === 'initialize') {
        return send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: SERVER_INFO } });
    }
    if (message.method === 'ping') return send({ jsonrpc: '2.0', id: message.id, result: {} });
    if (message.method === 'tools/list') return send({ jsonrpc: '2.0', id: message.id, result: { tools } });
    if (message.method === 'tools/call') {
        try {
            const result = await callTool(message.params?.name, message.params?.arguments || {});
            return send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } });
        } catch (error) {
            return send({ jsonrpc: '2.0', id: message.id, result: { isError: true, content: [{ type: 'text', text: `${error.code ? `${error.code}: ` : ''}${error.message}` }] } });
        }
    }
    if (message.id !== undefined) {
        send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
    }
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
    if (!line.trim()) return;
    try {
        void handle(JSON.parse(line));
    } catch (error) {
        send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: error.message } });
    }
});
