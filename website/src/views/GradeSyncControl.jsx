import React, { useState, useEffect, useRef } from 'react';
import { 
    Box, 
    Typography, 
    Button, 
    Paper, 
    FormControl, 
    InputLabel, 
    Select, 
    MenuItem, 
    Alert, 
    CircularProgress,
    LinearProgress,
    Divider,
    Chip,
    Stack
} from '@mui/material';
import { Refresh, Sync as SyncIcon } from '@mui/icons-material';
import apiv2 from '../utils/apiv2';
import { cachedApiGet, clearApiGetCache } from '../utils/apiCache';

export default function GradeSyncControl() {
    const [courses, setCourses] = useState([]);
    const [loadingCourses, setLoadingCourses] = useState(false);
    const [selectedCourse, setSelectedCourse] = useState(localStorage.getItem('selectedCourseId') || '');
    const [syncing, setSyncing] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const [syncJobId, setSyncJobId] = useState(null);
    const [syncStatus, setSyncStatus] = useState(null);
    const [syncMessage, setSyncMessage] = useState('');
    const [syncElapsedSeconds, setSyncElapsedSeconds] = useState(0);
    const [syncProgress, setSyncProgress] = useState(0);
    const [syncCurrentStep, setSyncCurrentStep] = useState(0);
    const [syncTotalSteps, setSyncTotalSteps] = useState(0);
    const [syncSource, setSyncSource] = useState('');
    const [syncSubCurrent, setSyncSubCurrent] = useState(0);
    const [syncSubTotal, setSyncSubTotal] = useState(0);
    const [syncSubLabel, setSyncSubLabel] = useState('');
    const [syncEvents, setSyncEvents] = useState([]);
    const logContainerRef = useRef(null);

    const formatSourceLabel = (value) => {
        if (!value) return '';
        if (value === 'prairielearn') return 'PrairieLearn';
        if (value === 'gradescope') return 'Gradescope';
        if (value === 'iclicker') return 'iClicker';
        if (value === 'database') return 'Database';
        return value;
    };

    const normalizeCourseId = (course) => String(course?.gradescope_course_id || course?.id || '').trim();

    const normalizeCourseList = (list) => {
        const merged = new Map();
        (Array.isArray(list) ? list : []).forEach((course) => {
            const key = normalizeCourseId(course);
            if (!key) return;
            const existing = merged.get(key) || {};
            merged.set(key, {
                ...existing,
                ...course,
                id: key,
                gradescope_course_id: course?.gradescope_course_id || existing.gradescope_course_id || key,
                year: course?.year || existing.year || '',
                semester: course?.semester || existing.semester || '',
                name: course?.name || existing.name || '',
            });
        });
        return Array.from(merged.values());
    };

    const formatCourseLabel = (course) => {
        const year = String(course?.year || '').trim();
        const semester = String(course?.semester || '').trim();
        const name = String(course?.name || '').trim();
        const id = normalizeCourseId(course);
        const title = [year, semester, name].filter(Boolean).join(' ');
        return title || id || 'Course';
    };

    const formatCourseSubLabel = (course) => {
        const id = normalizeCourseId(course);
        return id ? `Gradescope ${id}` : '';
    };

    const sourceResults = Array.isArray(result?.results) ? result.results : [];

    const fetchCourses = () => {
        setLoadingCourses(true);
        setError(null);
        Promise.allSettled([
            cachedApiGet('/admin/sync', { ttlMs: 60000 }),
            cachedApiGet('/students/courses', { ttlMs: 60000 }),
        ])
            .then(([syncResult, courseResult]) => {
                const syncCourses = syncResult.status === 'fulfilled'
                    ? (syncResult.value?.data?.courses || [])
                    : [];
                const enrolledCourses = courseResult.status === 'fulfilled'
                    ? (courseResult.value?.data?.courses || [])
                    : [];
                const fetchedCourses = normalizeCourseList([...syncCourses, ...enrolledCourses]);
                setCourses(fetchedCourses);

                if (fetchedCourses.length > 0) {
                    const rememberedCourse = localStorage.getItem('selectedCourseId') || selectedCourse;
                    const hasSelected = fetchedCourses.some((course) => normalizeCourseId(course) === String(rememberedCourse));
                    const nextCourse = hasSelected ? String(rememberedCourse) : normalizeCourseId(fetchedCourses[0]);
                    setSelectedCourse(nextCourse);
                    localStorage.setItem('selectedCourseId', nextCourse);
                }

                if (syncResult.status === 'rejected' && courseResult.status === 'rejected') {
                    throw syncResult.reason || courseResult.reason;
                }
            })
            .catch(err => {
                console.error("Failed to fetch courses", err);
                setError("Failed to load courses from GradeSync service. Is the service running?");
            })
            .finally(() => setLoadingCourses(false));
    };

    useEffect(() => {
        fetchCourses();
    }, []);

    useEffect(() => {
        const handleSelectedCourseChanged = (event) => {
            const nextCourse = event?.detail?.courseId || localStorage.getItem('selectedCourseId') || '';
            setSelectedCourse(nextCourse);
        };

        window.addEventListener('selectedCourseChanged', handleSelectedCourseChanged);
        return () => {
            window.removeEventListener('selectedCourseChanged', handleSelectedCourseChanged);
        };
    }, []);

    useEffect(() => {
        if (!syncJobId || !syncing) {
            return undefined;
        }

        let mounted = true;
        const poll = () => {
            apiv2.get(`/admin/sync/jobs/${encodeURIComponent(syncJobId)}`)
                .then((res) => {
                    if (!mounted) return;
                    const job = res?.data || {};
                    setSyncStatus(job.status || null);
                    setSyncMessage(job.message || 'Sync in progress');
                    setSyncElapsedSeconds(job.elapsedSeconds || 0);
                    setSyncProgress(Number.isFinite(job.progress) ? job.progress : 0);
                    setSyncCurrentStep(Number.isFinite(job.currentStep) ? job.currentStep : 0);
                    setSyncTotalSteps(Number.isFinite(job.totalSteps) ? job.totalSteps : 0);
                    setSyncSource(job.source || '');
                    setSyncSubCurrent(Number.isFinite(job.subCurrent) ? job.subCurrent : 0);
                    setSyncSubTotal(Number.isFinite(job.subTotal) ? job.subTotal : 0);
                    setSyncSubLabel(job.subLabel || '');
                    setSyncEvents(Array.isArray(job.events) ? job.events : []);

                    if (job.status === 'completed') {
                        setResult(job.result || null);
                        setSyncing(false);
                        setSyncJobId(null);
                        clearApiGetCache();
                    } else if (job.status === 'failed') {
                        setError(job.error || job.message || 'Sync failed');
                        setSyncing(false);
                        setSyncJobId(null);
                    }
                })
                .catch((pollErr) => {
                    if (!mounted) return;
                    console.error('Failed to fetch sync job status', pollErr);
                    setError(pollErr.response?.data?.error || pollErr.message || 'Failed to fetch sync progress');
                    setSyncing(false);
                    setSyncJobId(null);
                });
        };

        poll();
        const intervalId = setInterval(poll, 2000);

        return () => {
            mounted = false;
            clearInterval(intervalId);
        };
    }, [syncJobId, syncing]);

    const handleSync = () => {
        if (!selectedCourse) return;
        
        setSyncing(true);
        setSyncStatus('queued');
        setSyncMessage('Sync job queued');
        setSyncElapsedSeconds(0);
        setSyncProgress(0);
        setSyncCurrentStep(0);
        setSyncTotalSteps(0);
        setSyncSource('');
        setSyncSubCurrent(0);
        setSyncSubTotal(0);
        setSyncSubLabel('');
        setSyncEvents([]);
        setResult(null);
        setError(null);
        clearApiGetCache();
        
        apiv2.post(`/admin/sync/${selectedCourse}/start`)
            .then(res => {
                const job = res?.data || {};
                setSyncJobId(job.id || null);
                setSyncStatus(job.status || 'queued');
                setSyncMessage(job.message || 'Sync job queued');
                setSyncElapsedSeconds(job.elapsedSeconds || 0);
                setSyncProgress(Number.isFinite(job.progress) ? job.progress : 0);
                setSyncCurrentStep(Number.isFinite(job.currentStep) ? job.currentStep : 0);
                setSyncTotalSteps(Number.isFinite(job.totalSteps) ? job.totalSteps : 0);
                setSyncSource(job.source || '');
                setSyncSubCurrent(Number.isFinite(job.subCurrent) ? job.subCurrent : 0);
                setSyncSubTotal(Number.isFinite(job.subTotal) ? job.subTotal : 0);
                setSyncSubLabel(job.subLabel || '');
                setSyncEvents(Array.isArray(job.events) ? job.events : []);
            })
            .catch(err => {
                console.error("Sync failed", err);
                setError(
                    err.response?.data?.details
                    || err.response?.data?.detail
                    || err.response?.data?.error
                    || err.message
                    || "Sync failed"
                );
                setSyncing(false);
            })
            .finally(() => {
                // Keep syncing=true while polling active job status.
            });
    };

    useEffect(() => {
        if (!logContainerRef.current) return;
        logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }, [syncEvents]);

    const handleCourseChange = (event) => {
        const nextCourse = event.target.value;
        setSelectedCourse(nextCourse);
        localStorage.setItem('selectedCourseId', nextCourse);
        window.dispatchEvent(new CustomEvent('selectedCourseChanged', { detail: { courseId: nextCourse } }));
    };

    return (
        <Box px={4} py={4}>
            <Paper elevation={0} className='glass-section' sx={{ p: 4, borderRadius: 2, maxWidth: 800 }}>
                <Box mb={3} display="flex" justifyContent="space-between" alignItems="center">
                    <Typography variant="h6" sx={{ fontWeight: 600 }}>
                        GradeSync Control
                    </Typography>
                    <Button 
                        startIcon={<Refresh />} 
                        onClick={fetchCourses} 
                        disabled={loadingCourses || syncing}
                        size="small"
                    >
                        Refresh Courses
                    </Button>
                </Box>

                <Box mb={4}>
                    <Typography variant="body2" color="textSecondary" paragraph>
                        Select a course to synchronize grades from Gradescope, PrairieLearn, and iClicker.
                        This process may take several minutes.
                    </Typography>
                    
                    <Box display="flex" gap={2} alignItems="center">
                        <FormControl size="small" sx={{ minWidth: 520, maxWidth: 760 }}>
                            <InputLabel>Course</InputLabel>
                            <Select
                                value={selectedCourse}
                                label="Course"
                                onChange={handleCourseChange}
                                disabled={loadingCourses || syncing || courses.length === 0}
                                renderValue={(value) => {
                                    const course = courses.find((item) => normalizeCourseId(item) === String(value));
                                    return formatCourseLabel(course || { id: value });
                                }}
                            >
                                {courses.map(c => (
                                    <MenuItem key={normalizeCourseId(c)} value={normalizeCourseId(c)}>
                                        <Box>
                                            <Typography variant="body1">
                                                {formatCourseLabel(c)}
                                            </Typography>
                                            {formatCourseSubLabel(c) && (
                                                <Typography variant="caption" color="textSecondary">
                                                    {formatCourseSubLabel(c)}
                                                </Typography>
                                            )}
                                        </Box>
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        
                        <Button 
                            variant="contained" 
                            color="primary" 
                            startIcon={syncing ? <CircularProgress size={20} color="inherit" /> : <SyncIcon />}
                            onClick={handleSync}
                            disabled={!selectedCourse || syncing}
                        >
                            {syncing ? 'Syncing...' : 'Start Sync'}
                        </Button>
                    </Box>
                </Box>
                
                {loadingCourses && (
                     <Typography variant="body2" sx={{ fontStyle: 'italic', color: 'gray' }}>Loading courses...</Typography>
                )}

                {syncing && (
                    <Alert severity="info" sx={{ mb: 3 }}>
                        <Box>
                            <Typography variant="body2" sx={{ mb: 1 }}>
                                {syncMessage || 'Sync in progress'} {syncStatus ? `(${syncStatus})` : ''} · {syncElapsedSeconds}s
                            </Typography>
                            <LinearProgress variant="determinate" value={Math.max(0, Math.min(100, syncProgress || 0))} sx={{ mb: 1 }} />
                            <Typography variant="caption" color="textSecondary">
                                {syncTotalSteps > 0
                                    ? `Step ${Math.max(0, syncCurrentStep)}/${syncTotalSteps}${syncSource ? ` · ${formatSourceLabel(syncSource)}` : ''} · ${Math.round(syncProgress || 0)}%`
                                    : `${Math.round(syncProgress || 0)}%`}
                            </Typography>
                            {syncSubTotal > 0 && (
                                <Typography variant="caption" display="block" color="textSecondary" sx={{ mt: 0.5 }}>
                                    {`Assignment ${Math.max(0, syncSubCurrent)}/${syncSubTotal}${syncSubLabel ? ` · ${syncSubLabel}` : ''}`}
                                </Typography>
                            )}
                            <Paper
                                variant="outlined"
                                sx={{ mt: 1.5, p: 1.25, maxHeight: 180, overflowY: 'auto', bgcolor: 'rgba(8, 13, 30, 0.72)', color: '#e5e7eb', borderColor: 'rgba(159, 187, 255, 0.22)' }}
                                ref={logContainerRef}
                            >
                                {(syncEvents || []).length === 0 ? (
                                    <Typography variant="caption" sx={{ color: '#9ca3af' }}>
                                        Waiting for progress events...
                                    </Typography>
                                ) : (
                                    (syncEvents || []).map((evt, index) => (
                                        <Typography
                                            key={`${evt.at || 'evt'}-${index}`}
                                            variant="caption"
                                            sx={{ display: 'block', fontFamily: 'monospace', lineHeight: 1.5 }}
                                        >
                                            [{evt.at ? new Date(evt.at).toLocaleTimeString() : '--:--:--'}]
                                            {evt.source ? ` [${formatSourceLabel(evt.source)}]` : ''}
                                            {evt.stage ? ` [${evt.stage}]` : ''}
                                            {` ${evt.message || ''}`}
                                            {Number.isFinite(evt.progress) ? ` (${Math.round(evt.progress)}%)` : ''}
                                            {Number.isFinite(evt.subCurrent) && Number.isFinite(evt.subTotal) && evt.subTotal > 0
                                                ? ` · ${evt.subCurrent}/${evt.subTotal}${evt.subLabel ? ` ${evt.subLabel}` : ''}`
                                                : ''}
                                        </Typography>
                                    ))
                                )}
                            </Paper>
                        </Box>
                    </Alert>
                )}

                {error && (
                    <Alert severity="error" sx={{ mb: 3 }}>
                        {error}
                    </Alert>
                )}

                {result && (
                    <Box mt={3}>
                        <Divider sx={{ mb: 3 }} />
                        <Box display="flex" alignItems="center" justifyContent="space-between" gap={2} mb={1}>
                            <Typography variant="subtitle1" fontWeight={600}>
                                Last Sync Result
                            </Typography>
                            <Chip
                                size="small"
                                color={result.overall_success ? 'success' : 'warning'}
                                label={result.overall_success ? 'All sources healthy' : 'Partial sync'}
                                sx={{ fontWeight: 700 }}
                            />
                        </Box>
                        
                        <Alert severity={result.overall_success ? "success" : "warning"} sx={{ mb: 2 }}>
                            External source failures do not erase existing grades. Database refresh can still update derived policy scores from the latest stored raw data.
                        </Alert>

                        {sourceResults.length > 0 && (
                            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
                                {sourceResults.map((item) => (
                                    <Paper
                                        key={`${item.source}-${item.timestamp || item.message}`}
                                        variant="outlined"
                                        sx={{
                                            p: 1.5,
                                            flex: 1,
                                            borderColor: item.success ? 'rgba(22, 163, 74, 0.32)' : 'rgba(220, 38, 38, 0.28)',
                                            backgroundColor: item.success ? 'rgba(22, 163, 74, 0.04)' : 'rgba(220, 38, 38, 0.04)',
                                        }}
                                    >
                                        <Box display="flex" alignItems="center" justifyContent="space-between" gap={1}>
                                            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                                                {formatSourceLabel(item.source)}
                                            </Typography>
                                            <Chip
                                                size="small"
                                                color={item.success ? 'success' : 'error'}
                                                label={item.success ? 'OK' : 'Needs attention'}
                                                sx={{ fontWeight: 700 }}
                                            />
                                        </Box>
                                        <Typography variant="caption" sx={{ display: 'block', mt: 0.8, color: 'text.secondary' }}>
                                            {item.message || (item.success ? 'Completed' : 'Failed')}
                                        </Typography>
                                    </Paper>
                                ))}
                            </Stack>
                        )}
                        
                        <Paper variant="outlined" sx={{ p: 2, bgcolor: '#f8f9fa', maxHeight: 400, overflow: 'auto' }}>
                            <pre style={{ margin: 0, fontSize: '0.85rem', fontFamily: 'monospace' }}>
                                {JSON.stringify(result, null, 2)}
                            </pre>
                        </Paper>
                    </Box>
                )}
            </Paper>
        </Box>
    );
}
