import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    AlertTitle,
    Box,
    Button,
    Chip,
    CircularProgress,
    Divider,
    LinearProgress,
    Paper,
    Stack,
    Typography,
} from '@mui/material';
import { Refresh, Sync as SyncIcon } from '@mui/icons-material';
import apiv2 from '../utils/apiv2';
import { clearApiGetCache } from '../utils/apiCache';
import {
    SHELL_UI_CAPABILITIES_STORAGE_KEY,
    deriveShellCapabilities,
    formatCourseLabel,
    normalizeCourseList,
    parseStoredPermissions,
    resolveCourseQueryId,
} from '../utils/personaNavigation';

const REQUEST_TIMEOUT_MS = 15000;

function readCapabilities() {
    return deriveShellCapabilities(
        parseStoredPermissions(localStorage.getItem('permissions')),
        parseStoredPermissions(localStorage.getItem(SHELL_UI_CAPABILITIES_STORAGE_KEY)),
    );
}

function normalizeRequestError(error, fallback, { timedOut = false } = {}) {
    const payload = error?.response?.data || {};
    const status = Number(error?.response?.status || 0);
    const timeout = timedOut || error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT';
    if (timeout) {
        return {
            code: 'SYNC_TIMEOUT',
            reason: 'GradeSync did not respond before the request timed out.',
            recovery: 'Check the GradeSync service and retry for the current course.',
        };
    }
    return {
        code: payload.code || (status === 403 ? 'COURSE_SCOPE_FORBIDDEN' : status >= 500 ? 'SYNC_SERVICE_UNAVAILABLE' : 'SYNC_REQUEST_FAILED'),
        reason: payload.reason || payload.details || payload.detail || payload.error || error?.message || fallback,
        recovery: payload.recovery || (status === 403
            ? 'Confirm the current course and your staff access, then retry.'
            : 'Retry the request. If it continues to fail, contact the GradeView administrator.'),
    };
}

async function withRequestTimeout(requestFactory) {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, REQUEST_TIMEOUT_MS);
    try {
        return await requestFactory(controller.signal);
    } catch (error) {
        if (timedOut) error.platformTimedOut = true;
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

function formatSourceLabel(value) {
    if (!value) return '';
    if (value === 'prairielearn') return 'PrairieLearn';
    if (value === 'gradescope') return 'Gradescope';
    if (value === 'iclicker') return 'iClicker';
    if (value === 'database') return 'Database';
    return value;
}

export default function GradeSyncControl() {
    const capabilities = useMemo(readCapabilities, []);
    const isReadOnly = capabilities.isReadOnly;
    const [globalCourseId, setGlobalCourseId] = useState(
        () => localStorage.getItem('selectedCourseId') || '',
    );
    const [courseResource, setCourseResource] = useState({
        status: 'loading',
        course: null,
        apiCourseId: '',
        error: null,
    });
    const [syncState, setSyncState] = useState({ status: 'idle', error: null, result: null });
    const [syncJobId, setSyncJobId] = useState(null);
    const [syncProgress, setSyncProgress] = useState({
        status: null,
        message: '',
        elapsedSeconds: 0,
        progress: 0,
        currentStep: 0,
        totalSteps: 0,
        source: '',
        subCurrent: 0,
        subTotal: 0,
        subLabel: '',
        events: [],
    });
    const courseRequestIdRef = useRef(0);
    const logContainerRef = useRef(null);

    const loadCourseContext = useCallback(async () => {
        const requestId = courseRequestIdRef.current + 1;
        courseRequestIdRef.current = requestId;
        const selectedId = String(localStorage.getItem('selectedCourseId') || globalCourseId || '').trim();
        setCourseResource({ status: 'loading', course: null, apiCourseId: '', error: null });
        setSyncState({ status: 'idle', error: null, result: null });
        setSyncJobId(null);

        if (!selectedId) {
            setCourseResource({ status: 'empty', course: null, apiCourseId: '', error: null });
            return;
        }

        try {
            const response = await withRequestTimeout((signal) => apiv2.get('/students/courses', { signal }));
            if (requestId !== courseRequestIdRef.current) return;
            const courses = normalizeCourseList(response?.data?.courses || []);
            const course = courses.find((candidate) => (
                String(candidate.id) === selectedId
                || String(candidate.gradescope_course_id || '') === selectedId
            ));
            if (!course) {
                setCourseResource({ status: 'empty', course: null, apiCourseId: '', error: null });
                return;
            }
            setCourseResource({
                status: 'success',
                course,
                apiCourseId: resolveCourseQueryId(selectedId, courses),
                error: null,
            });
        } catch (error) {
            if (requestId !== courseRequestIdRef.current) return;
            setCourseResource({
                status: 'error',
                course: null,
                apiCourseId: '',
                error: normalizeRequestError(error, 'The current course could not be loaded.', {
                    timedOut: error?.platformTimedOut,
                }),
            });
        }
    }, [globalCourseId]);

    useEffect(() => {
        loadCourseContext();
    }, [loadCourseContext]);

    useEffect(() => {
        const handleSelectedCourseChanged = (event) => {
            setGlobalCourseId(
                String(event?.detail?.courseId || localStorage.getItem('selectedCourseId') || ''),
            );
        };
        window.addEventListener('selectedCourseChanged', handleSelectedCourseChanged);
        return () => window.removeEventListener('selectedCourseChanged', handleSelectedCourseChanged);
    }, []);

    useEffect(() => {
        if (!syncJobId || syncState.status !== 'loading') return undefined;
        let mounted = true;

        const poll = async () => {
            try {
                const response = await withRequestTimeout((signal) => (
                    apiv2.get(`/admin/sync/jobs/${encodeURIComponent(syncJobId)}`, { signal })
                ));
                if (!mounted) return;
                const job = response?.data || {};
                setSyncProgress({
                    status: job.status || null,
                    message: job.message || 'Sync in progress',
                    elapsedSeconds: job.elapsedSeconds || 0,
                    progress: Number.isFinite(job.progress) ? job.progress : 0,
                    currentStep: Number.isFinite(job.currentStep) ? job.currentStep : 0,
                    totalSteps: Number.isFinite(job.totalSteps) ? job.totalSteps : 0,
                    source: job.source || '',
                    subCurrent: Number.isFinite(job.subCurrent) ? job.subCurrent : 0,
                    subTotal: Number.isFinite(job.subTotal) ? job.subTotal : 0,
                    subLabel: job.subLabel || '',
                    events: Array.isArray(job.events) ? job.events : [],
                });

                if (job.status === 'completed') {
                    setSyncState({
                        status: 'success',
                        error: null,
                        result: job.result || { overall_success: true, results: [] },
                    });
                    setSyncJobId(null);
                    clearApiGetCache();
                } else if (job.status === 'failed') {
                    setSyncState({
                        status: 'error',
                        result: null,
                        error: normalizeRequestError(
                            { response: { data: job.error || job } },
                            job.message || 'GradeSync reported a failed job.',
                        ),
                    });
                    setSyncJobId(null);
                }
            } catch (error) {
                if (!mounted) return;
                setSyncState({
                    status: 'error',
                    result: null,
                    error: normalizeRequestError(error, 'Sync progress could not be loaded.', {
                        timedOut: error?.platformTimedOut,
                    }),
                });
                setSyncJobId(null);
            }
        };

        poll();
        const intervalId = setInterval(poll, 2000);
        return () => {
            mounted = false;
            clearInterval(intervalId);
        };
    }, [syncJobId, syncState.status]);

    useEffect(() => {
        if (!logContainerRef.current) return;
        logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }, [syncProgress.events]);

    const handleSync = useCallback(async () => {
        const courseId = courseResource.apiCourseId;
        if (!courseId || isReadOnly || syncState.status === 'loading') return;

        setSyncState({ status: 'loading', error: null, result: null });
        setSyncJobId(null);
        setSyncProgress({
            status: 'queued',
            message: 'Sync job queued',
            elapsedSeconds: 0,
            progress: 0,
            currentStep: 0,
            totalSteps: 0,
            source: '',
            subCurrent: 0,
            subTotal: 0,
            subLabel: '',
            events: [],
        });
        clearApiGetCache();

        try {
            const response = await withRequestTimeout((signal) => (
                apiv2.post(`/admin/sync/${encodeURIComponent(courseId)}/start`, undefined, { signal })
            ));
            const job = response?.data || {};
            if (job.id) {
                setSyncJobId(job.id);
                setSyncProgress((current) => ({
                    ...current,
                    status: job.status || 'queued',
                    message: job.message || 'Sync job queued',
                }));
            } else if (job.status === 'completed' || job.result || typeof job.overall_success === 'boolean') {
                setSyncState({
                    status: 'success',
                    error: null,
                    result: job.result || job,
                });
            } else {
                setSyncState({
                    status: 'error',
                    result: null,
                    error: {
                        code: 'SYNC_RESPONSE_INVALID',
                        reason: 'GradeSync accepted the request but did not return a job or result.',
                        recovery: 'Retry the sync. If this repeats, contact the GradeView administrator.',
                    },
                });
            }
        } catch (error) {
            setSyncState({
                status: 'error',
                result: null,
                error: normalizeRequestError(error, 'The sync could not be started.', {
                    timedOut: error?.platformTimedOut,
                }),
            });
        }
    }, [courseResource.apiCourseId, isReadOnly, syncState.status]);

    const result = syncState.status === 'success' ? syncState.result : null;
    const sourceResults = Array.isArray(result?.results) ? result.results : [];
    const syncing = syncState.status === 'loading';

    return (
        <Box px={{ xs: 2, md: 4 }} py={{ xs: 2, md: 4 }}>
            <Paper
                component="section"
                aria-labelledby="gradesync-heading"
                elevation={0}
                className="glass-section"
                sx={{ p: { xs: 2.5, md: 4 }, borderRadius: 2, maxWidth: 900 }}
            >
                <Typography id="gradesync-heading" component="h1" variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
                    GradeSync Control
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    Synchronize the course selected in the global GradeView course control.
                </Typography>

                {isReadOnly && (
                    <Alert severity="warning" role="status" sx={{ mb: 3 }}>
                        <AlertTitle>Read-only Demo</AlertTitle>
                        Sync mutations are disabled in this page, and the GradeView API independently
                        rejects Demo writes with <strong>DEMO_READ_ONLY</strong>. Sign in with an authorized
                        staff account to start a sync.
                    </Alert>
                )}

                {courseResource.status === 'loading' && (
                    <Box role="status" aria-live="polite" sx={{ mb: 3 }}>
                        <Typography variant="body2" sx={{ mb: 1 }}>Loading current course…</Typography>
                        <LinearProgress aria-label="Loading current GradeSync course" />
                    </Box>
                )}

                {courseResource.status === 'error' && (
                    <Alert
                        severity="error"
                        role="alert"
                        sx={{ mb: 3 }}
                        action={<Button color="inherit" onClick={loadCourseContext}>Retry course</Button>}
                    >
                        <AlertTitle>Current course unavailable</AlertTitle>
                        <Typography variant="body2">Code: <strong>{courseResource.error.code}</strong></Typography>
                        <Typography variant="body2">Reason: {courseResource.error.reason}</Typography>
                        <Typography variant="body2">Recovery: {courseResource.error.recovery}</Typography>
                    </Alert>
                )}

                {courseResource.status === 'empty' && (
                    <Alert severity="info" role="status" sx={{ mb: 3 }}>
                        <AlertTitle>No current course</AlertTitle>
                        Choose a course with the global course control. This is an empty selection, not a failed sync.
                    </Alert>
                )}

                {courseResource.status === 'success' && (
                    <>
                        <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
                            <Typography variant="overline" color="text.secondary">Current course</Typography>
                            <Typography variant="h6">{formatCourseLabel(courseResource.course)}</Typography>
                            <Typography variant="caption" color="text.secondary">
                                Course ID: {courseResource.apiCourseId}. Change courses with the global course control.
                            </Typography>
                        </Paper>

                        <Button
                            variant="contained"
                            startIcon={syncing ? <CircularProgress size={20} color="inherit" /> : <SyncIcon />}
                            onClick={handleSync}
                            disabled={isReadOnly || syncing}
                            aria-label={isReadOnly ? 'Start Sync unavailable in read-only Demo' : 'Start Sync for current course'}
                            sx={{ mb: 3 }}
                        >
                            {syncing ? 'Syncing…' : 'Start Sync'}
                        </Button>
                    </>
                )}

                {syncing && (
                    <Alert severity="info" role="status" aria-live="polite" sx={{ mb: 3 }}>
                        <AlertTitle>Sync in progress</AlertTitle>
                        <Typography variant="body2" sx={{ mb: 1 }}>
                            {syncProgress.message || 'Sync in progress'}
                            {syncProgress.status ? ` (${syncProgress.status})` : ''} · {syncProgress.elapsedSeconds}s
                        </Typography>
                        <LinearProgress
                            variant="determinate"
                            value={Math.max(0, Math.min(100, syncProgress.progress || 0))}
                            aria-label="GradeSync progress"
                        />
                        <Typography variant="caption" color="text.secondary">
                            {syncProgress.totalSteps > 0
                                ? `Step ${Math.max(0, syncProgress.currentStep)}/${syncProgress.totalSteps}${syncProgress.source ? ` · ${formatSourceLabel(syncProgress.source)}` : ''} · ${Math.round(syncProgress.progress || 0)}%`
                                : `${Math.round(syncProgress.progress || 0)}%`}
                        </Typography>
                        {syncProgress.subTotal > 0 && (
                            <Typography variant="caption" display="block" color="text.secondary">
                                {`Assignment ${Math.max(0, syncProgress.subCurrent)}/${syncProgress.subTotal}${syncProgress.subLabel ? ` · ${syncProgress.subLabel}` : ''}`}
                            </Typography>
                        )}
                        <Paper
                            variant="outlined"
                            ref={logContainerRef}
                            sx={{ mt: 1.5, p: 1.25, maxHeight: 180, overflowY: 'auto' }}
                        >
                            {syncProgress.events.length === 0 ? (
                                <Typography variant="caption">Waiting for progress events…</Typography>
                            ) : syncProgress.events.map((event, index) => (
                                <Typography
                                    key={`${event.at || 'event'}-${index}`}
                                    variant="caption"
                                    sx={{ display: 'block', fontFamily: 'monospace' }}
                                >
                                    {event.source ? `[${formatSourceLabel(event.source)}] ` : ''}
                                    {event.message || ''}
                                </Typography>
                            ))}
                        </Paper>
                    </Alert>
                )}

                {syncState.status === 'error' && (
                    <Alert
                        severity="error"
                        role="alert"
                        sx={{ mb: 3 }}
                        action={(
                            <Button
                                color="inherit"
                                onClick={handleSync}
                                disabled={isReadOnly || courseResource.status !== 'success'}
                            >
                                Retry sync
                            </Button>
                        )}
                    >
                        <AlertTitle>Sync did not complete</AlertTitle>
                        <Typography variant="body2">Code: <strong>{syncState.error.code}</strong></Typography>
                        <Typography variant="body2">Reason: {syncState.error.reason}</Typography>
                        <Typography variant="body2">Recovery: {syncState.error.recovery}</Typography>
                    </Alert>
                )}

                {result && (
                    <Box mt={2}>
                        <Divider sx={{ mb: 3 }} />
                        <Box display="flex" alignItems="center" justifyContent="space-between" gap={2} mb={1}>
                            <Typography component="h2" variant="subtitle1" fontWeight={700}>Last Sync Result</Typography>
                            <Chip
                                size="small"
                                color={result.overall_success ? 'success' : 'warning'}
                                label={result.overall_success ? 'All sources healthy' : 'Partial sync'}
                            />
                        </Box>
                        <Alert severity={result.overall_success ? 'success' : 'warning'} role="status" sx={{ mb: 2 }}>
                            {result.overall_success
                                ? 'The sync completed successfully for the current course.'
                                : 'The sync completed with source warnings. Existing grades were not erased.'}
                        </Alert>
                        {sourceResults.length === 0 ? (
                            <Alert severity="info" role="status">
                                The sync returned no per-source detail. This is a successful empty detail set, not a failed request.
                            </Alert>
                        ) : (
                            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                                {sourceResults.map((item) => (
                                    <Paper key={`${item.source}-${item.timestamp || item.message}`} variant="outlined" sx={{ p: 1.5, flex: 1 }}>
                                        <Typography variant="subtitle2" fontWeight={700}>{formatSourceLabel(item.source)}</Typography>
                                        <Chip
                                            size="small"
                                            color={item.success ? 'success' : 'error'}
                                            label={item.success ? 'Completed' : 'Needs attention'}
                                        />
                                        <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                                            {item.message || (item.success ? 'Completed' : 'Failed')}
                                        </Typography>
                                    </Paper>
                                ))}
                            </Stack>
                        )}
                    </Box>
                )}
            </Paper>
        </Box>
    );
}
