import { Router } from 'express';
import http from 'http';
import crypto from 'crypto';
import { canManageCourse, IAM_ROLE } from '../../../../lib/iam.mjs';

const router = Router({ mergeParams: true });
// Use service name "gradesync" which is resolvable in the shared docker network
const GRADESYNC_URL = process.env.GRADESYNC_URL || 'http://gradesync:8000';
const COURSES_PROXY_TIMEOUT_MS = Number(process.env.GRADESYNC_COURSES_TIMEOUT_MS || 60000);
const SYNC_PROXY_TIMEOUT_MS = Number(process.env.GRADESYNC_SYNC_TIMEOUT_MS || 3600000);
const SYNC_JOB_TTL_MS = Number(process.env.GRADESYNC_SYNC_JOB_TTL_MS || 12 * 60 * 60 * 1000);
const SYNC_JOB_MAX_EVENTS = Number(process.env.GRADESYNC_SYNC_JOB_MAX_EVENTS || 300);

const syncJobs = new Map();

function isTimeoutError(err) {
    return err?.name === 'TimeoutError' || /timed out/i.test(err?.message || '');
}

function requestJson(url, { method = 'GET', timeoutMs = 60000, headers = {}, body = null } = {}) {
    const parsedUrl = new URL(url);
    const requestBody = body ? JSON.stringify(body) : null;

    const requestHeaders = {
        ...headers,
    };

    if (requestBody) {
        requestHeaders['Content-Type'] = requestHeaders['Content-Type'] || 'application/json';
        requestHeaders['Content-Length'] = Buffer.byteLength(requestBody);
    }

    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || 80,
                path: `${parsedUrl.pathname}${parsedUrl.search}`,
                method,
                headers: requestHeaders,
            },
            (response) => {
                const chunks = [];

                response.on('data', (chunk) => chunks.push(chunk));
                response.on('end', () => {
                    const responseText = Buffer.concat(chunks).toString('utf8');
                    const statusCode = response.statusCode || 500;

                    if (statusCode < 200 || statusCode >= 300) {
                        return reject(new Error(`GradeSync service returned ${statusCode}: ${responseText}`));
                    }

                    try {
                        const json = responseText ? JSON.parse(responseText) : {};
                        resolve(json);
                    } catch (parseError) {
                        reject(new Error(`Invalid JSON from GradeSync: ${parseError.message}`));
                    }
                });
            }
        );

        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
        });

        req.on('error', (error) => reject(error));

        if (requestBody) {
            req.write(requestBody);
        }

        req.end();
    });
}

function requestSyncWithProgress(courseId, onProgress) {
    const parsedUrl = new URL(`${GRADESYNC_URL}/api/sync/${courseId}/stream`);

    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || 80,
                path: `${parsedUrl.pathname}${parsedUrl.search}`,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            },
            (response) => {
                const statusCode = response.statusCode || 500;
                if (statusCode < 200 || statusCode >= 300) {
                    const chunks = [];
                    response.on('data', (chunk) => chunks.push(chunk));
                    response.on('end', () => {
                        reject(new Error(`GradeSync service returned ${statusCode}: ${Buffer.concat(chunks).toString('utf8')}`));
                    });
                    return;
                }

                let buffer = '';
                let finalResult = null;

                response.on('data', (chunk) => {
                    buffer += chunk.toString('utf8');
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed) continue;

                        let event;
                        try {
                            event = JSON.parse(trimmed);
                        } catch {
                            continue;
                        }

                        if (event.event === 'heartbeat') {
                            continue;
                        }

                        if (event.event === 'error') {
                            reject(new Error(event.error || event.message || 'Unknown sync error'));
                            req.destroy();
                            return;
                        }

                        if (event.event === 'final') {
                            finalResult = event.result || null;
                        }

                        if (onProgress && event.event === 'progress') {
                            onProgress(event);
                        }
                    }
                });

                response.on('end', () => {
                    resolve(finalResult || {});
                });
            }
        );

        req.setTimeout(SYNC_PROXY_TIMEOUT_MS, () => {
            req.destroy(new Error(`Request timed out after ${SYNC_PROXY_TIMEOUT_MS}ms`));
        });

        req.on('error', (error) => reject(error));
        req.end();
    });
}

function nowIso() {
    return new Date().toISOString();
}

function toElapsedSeconds(startedAt) {
    if (!startedAt) return 0;
    return Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
}

function createSyncJob(courseId) {
    const id = crypto.randomUUID();
    const timestamp = nowIso();
    const job = {
        id,
        courseId,
        status: 'queued',
        message: 'Sync job queued',
        progress: 0,
        currentStep: 0,
        totalSteps: 0,
        source: null,
        stage: 'queued',
        subCurrent: 0,
        subTotal: 0,
        subLabel: '',
        createdAt: timestamp,
        startedAt: null,
        finishedAt: null,
        updatedAt: timestamp,
        elapsedSeconds: 0,
        result: null,
        error: null,
        events: [],
    };
    syncJobs.set(id, job);
    return job;
}

function appendSyncJobEvent(id, eventPatch = {}) {
    const existing = syncJobs.get(id);
    if (!existing) return null;

    const nextEvent = {
        at: nowIso(),
        status: eventPatch.status || existing.status || 'running',
        source: eventPatch.source ?? existing.source ?? null,
        stage: eventPatch.stage || existing.stage || 'running',
        message: eventPatch.message || existing.message || '',
        progress: Number.isFinite(eventPatch.progress) ? eventPatch.progress : (Number.isFinite(existing.progress) ? existing.progress : 0),
        currentStep: Number.isFinite(eventPatch.currentStep) ? eventPatch.currentStep : existing.currentStep,
        totalSteps: Number.isFinite(eventPatch.totalSteps) ? eventPatch.totalSteps : existing.totalSteps,
        subCurrent: Number.isFinite(eventPatch.subCurrent) ? eventPatch.subCurrent : existing.subCurrent,
        subTotal: Number.isFinite(eventPatch.subTotal) ? eventPatch.subTotal : existing.subTotal,
        subLabel: eventPatch.subLabel ?? existing.subLabel ?? '',
    };

    const previous = Array.isArray(existing.events) ? existing.events : [];
    const nextEvents = [...previous, nextEvent];
    if (nextEvents.length > SYNC_JOB_MAX_EVENTS) {
        nextEvents.splice(0, nextEvents.length - SYNC_JOB_MAX_EVENTS);
    }

    const updated = {
        ...existing,
        events: nextEvents,
        updatedAt: nowIso(),
    };
    updated.elapsedSeconds = toElapsedSeconds(updated.startedAt);
    syncJobs.set(id, updated);
    return updated;
}

function updateSyncJob(id, patch) {
    const existing = syncJobs.get(id);
    if (!existing) return null;
    const updated = {
        ...existing,
        ...patch,
        updatedAt: nowIso(),
    };
    updated.elapsedSeconds = toElapsedSeconds(updated.startedAt);
    syncJobs.set(id, updated);
    return updated;
}

function getSyncJob(id) {
    const job = syncJobs.get(id);
    if (!job) return null;
    if (job.status === 'running' || job.status === 'queued') {
        return {
            ...job,
            elapsedSeconds: toElapsedSeconds(job.startedAt),
        };
    }
    return job;
}

function pruneExpiredSyncJobs() {
    const now = Date.now();
    for (const [id, job] of syncJobs.entries()) {
        const terminal = job.status === 'completed' || job.status === 'failed';
        const referenceTime = new Date(job.finishedAt || job.updatedAt || job.createdAt).getTime();
        if (terminal && Number.isFinite(referenceTime) && now - referenceTime > SYNC_JOB_TTL_MS) {
            syncJobs.delete(id);
        }
    }
}

async function runSyncJob(jobId) {
    const current = syncJobs.get(jobId);
    if (!current) return;

    updateSyncJob(jobId, {
        status: 'running',
        message: 'Sync in progress',
        progress: 1,
        currentStep: 0,
        totalSteps: 0,
        source: null,
        stage: 'start',
        subCurrent: 0,
        subTotal: 0,
        subLabel: '',
        startedAt: nowIso(),
        error: null,
        result: null,
    });
    appendSyncJobEvent(jobId, {
        status: 'running',
        source: null,
        stage: 'start',
        message: 'Sync in progress',
        progress: 1,
        currentStep: 0,
        totalSteps: 0,
    });

    try {
        let data = null;
        try {
            data = await requestSyncWithProgress(current.courseId, (event) => {
                const patch = {
                    status: 'running',
                    message: event.message || 'Sync in progress',
                    progress: Number.isFinite(event.progress) ? event.progress : 1,
                    currentStep: Number.isFinite(event.currentStep) ? event.currentStep : 0,
                    totalSteps: Number.isFinite(event.totalSteps) ? event.totalSteps : 0,
                    source: event.source || null,
                    stage: event.stage || 'running',
                    subCurrent: Number.isFinite(event.subCurrent) ? event.subCurrent : 0,
                    subTotal: Number.isFinite(event.subTotal) ? event.subTotal : 0,
                    subLabel: event.subLabel || '',
                    error: null,
                };
                updateSyncJob(jobId, patch);
                appendSyncJobEvent(jobId, patch);
            });
        } catch (streamErr) {
            const streamUnavailable = /returned 404/i.test(streamErr?.message || '');
            if (!streamUnavailable) {
                throw streamErr;
            }

            updateSyncJob(jobId, {
                status: 'running',
                message: 'Realtime progress not available, running sync in compatibility mode...',
                progress: 20,
                currentStep: 1,
                totalSteps: 1,
                source: 'gradescope',
                stage: 'fallback',
                subCurrent: 0,
                subTotal: 0,
                subLabel: '',
                error: null,
            });
            appendSyncJobEvent(jobId, {
                status: 'running',
                source: 'gradescope',
                stage: 'fallback',
                message: 'Realtime progress not available, running sync in compatibility mode...',
                progress: 20,
                currentStep: 1,
                totalSteps: 1,
            });

            data = await requestJson(`${GRADESYNC_URL}/api/sync/${current.courseId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                timeoutMs: SYNC_PROXY_TIMEOUT_MS,
            });
        }

        updateSyncJob(jobId, {
            status: 'completed',
            message: 'Sync completed',
            progress: 100,
            currentStep: null,
            totalSteps: null,
            source: null,
            stage: 'completed',
            subCurrent: null,
            subTotal: null,
            subLabel: '',
            finishedAt: nowIso(),
            result: data,
            error: null,
        });
        appendSyncJobEvent(jobId, {
            status: 'completed',
            source: null,
            stage: 'completed',
            message: 'Sync completed',
            progress: 100,
        });
    } catch (err) {
        updateSyncJob(jobId, {
            status: 'failed',
            message: isTimeoutError(err)
                ? 'Grade sync timed out while waiting for GradeSync response'
                : 'Failed to sync grades',
            progress: 100,
            stage: 'failed',
            finishedAt: nowIso(),
            error: err?.message || 'Unknown sync error',
            result: null,
        });
        appendSyncJobEvent(jobId, {
            status: 'failed',
            source: null,
            stage: 'failed',
            message: isTimeoutError(err)
                ? 'Grade sync timed out while waiting for GradeSync response'
                : 'Failed to sync grades',
            progress: 100,
        });
    } finally {
        pruneExpiredSyncJobs();
    }
}

// GET /api/v2/admin/sync - List courses
router.get('/', async (req, res) => {
    try {
        console.log(`[Proxy] Fetching courses from ${GRADESYNC_URL}/api/courses`);
        const data = await requestJson(`${GRADESYNC_URL}/api/courses`, {
            method: 'GET',
            timeoutMs: COURSES_PROXY_TIMEOUT_MS,
        });

        const requesterEmail = req?.auth?.email;
        const requesterRole = req?.auth?.role;

        if (requesterRole === IAM_ROLE.SUPER_ADMIN) {
            return res.json(data);
        }

        const courses = Array.isArray(data?.courses) ? data.courses : [];
        const allowedCourses = [];
        for (const course of courses) {
            const courseId = String(course?.id || '').trim();
            if (!courseId) {
                continue;
            }
            const allowed = await canManageCourse({
                requesterEmail,
                courseId,
                snapshot: req?.auth?.snapshot || null,
            });
            if (allowed) {
                allowedCourses.push(course);
            }
        }

        return res.json({ ...data, courses: allowedCourses });
    } catch (err) {
        console.error('GradeSync proxy error:', err);
        if (isTimeoutError(err)) {
            return res.status(504).json({ error: 'Fetching courses from GradeSync timed out', details: err.message });
        }
        res.status(502).json({ error: 'Failed to fetch courses from GradeSync', details: err.message });
    }
});

// POST /api/v2/admin/sync/:courseId - Trigger sync
router.post('/:courseId', async (req, res) => {
    const { courseId } = req.params;
    try {
        const allowed = await canManageCourse({
            requesterEmail: req?.auth?.email,
            courseId,
            snapshot: req?.auth?.snapshot || null,
        });
        if (!allowed) {
            return res.status(403).json({ error: 'Course admin permission required' });
        }

        console.log(`[Proxy] Triggering sync for ${courseId} at ${GRADESYNC_URL}/api/sync/${courseId}`);
        const data = await requestJson(`${GRADESYNC_URL}/api/sync/${courseId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            timeoutMs: SYNC_PROXY_TIMEOUT_MS,
        });
        res.json(data);
    } catch (err) {
        console.error('GradeSync proxy error:', err);
        if (isTimeoutError(err)) {
            return res.status(504).json({ error: 'Grade sync timed out while waiting for GradeSync response', details: err.message });
        }
        res.status(502).json({ error: 'Failed to sync grades', details: err.message });
    }
});

// POST /api/v2/admin/sync/:courseId/start - Start sync job asynchronously
router.post('/:courseId/start', async (req, res) => {
    const { courseId } = req.params;

    try {
        const allowed = await canManageCourse({
            requesterEmail: req?.auth?.email,
            courseId,
            snapshot: req?.auth?.snapshot || null,
        });
        if (!allowed) {
            return res.status(403).json({ error: 'Course admin permission required' });
        }

        const existingRunningJob = Array.from(syncJobs.values()).find(
            (job) => job.courseId === courseId && (job.status === 'queued' || job.status === 'running')
        );

        if (existingRunningJob) {
            return res.status(202).json(getSyncJob(existingRunningJob.id));
        }

        const job = createSyncJob(courseId);
        runSyncJob(job.id).catch((err) => {
            updateSyncJob(job.id, {
                status: 'failed',
                message: 'Failed to sync grades',
                progress: 100,
                finishedAt: nowIso(),
                error: err?.message || 'Unknown sync error',
                result: null,
            });
        });

        return res.status(202).json(getSyncJob(job.id));
    } catch (err) {
        console.error('GradeSync async start error:', err);
        return res.status(500).json({ error: 'Failed to start sync job', details: err.message });
    }
});

// GET /api/v2/admin/sync/jobs/:jobId - Get sync job status
router.get('/jobs/:jobId', async (req, res) => {
    const { jobId } = req.params;
    const job = getSyncJob(jobId);

    if (!job) {
        return res.status(404).json({ error: 'Sync job not found' });
    }

    const allowed = await canManageCourse({
        requesterEmail: req?.auth?.email,
        courseId: job.courseId,
        snapshot: req?.auth?.snapshot || null,
    });
    if (!allowed) {
        return res.status(403).json({ error: 'Course admin permission required' });
    }

    return res.status(200).json(job);
});

export default router;
