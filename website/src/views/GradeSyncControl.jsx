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
    Divider
} from '@mui/material';
import { Refresh, Sync as SyncIcon } from '@mui/icons-material';
import apiv2 from '../utils/apiv2';

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

    const fetchCourses = () => {
        setLoadingCourses(true);
        setError(null);
        apiv2.get('/admin/sync')
            .then(res => {
                if (res.data && res.data.courses) {
                    setCourses(res.data.courses);
                    if (res.data.courses.length > 0) {
                        const hasSelected = res.data.courses.some((course) => course.id === selectedCourse);
                        const nextCourse = hasSelected ? selectedCourse : res.data.courses[0].id;
                        setSelectedCourse(nextCourse);
                        localStorage.setItem('selectedCourseId', nextCourse);
                    }
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
                        <FormControl size="small" sx={{ minWidth: 200 }}>
                            <InputLabel>Course</InputLabel>
                            <Select
                                value={selectedCourse}
                                label="Course"
                                onChange={handleCourseChange}
                                disabled={loadingCourses || syncing || courses.length === 0}
                            >
                                {courses.map(c => (
                                    <MenuItem key={c.id} value={c.id}>
                                        {c.name} ({c.id})
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
                        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                            Last Sync Result
                        </Typography>
                        
                        <Alert severity={result.success !== false ? "success" : "warning"} sx={{ mb: 2 }}>
                            Sync completed.
                        </Alert>
                        
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
