import React, { useState, useEffect } from 'react';
import {
    Box,
    Paper,
    Typography,
    TextField,
    Button,
    Divider,
    Alert,
    Snackbar,
    Chip,
    IconButton,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    FormHelperText,
    Switch,
    FormControlLabel,
    Accordion,
    AccordionSummary,
    AccordionDetails,
    Stack,
    Tab,
    Tabs,
} from '@mui/material';
import {
    Settings as SettingsIcon,
    Save,
    Refresh,
    Delete,
    Add,
    ExpandMore,
    School,
    Sync as SyncIcon,
} from '@mui/icons-material';
import PageHeader from '../components/PageHeader';
import apiv2 from '../utils/apiv2';

export default function Settings() {
    const [config, setConfig] = useState(null);
    const [originalConfig, setOriginalConfig] = useState(null);
    const [syncConfig, setSyncConfig] = useState(null);
    const [originalSyncConfig, setOriginalSyncConfig] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
    const [newAdmin, setNewAdmin] = useState('');
    const [tabValue, setTabValue] = useState(0);
    const [expandedCourse, setExpandedCourse] = useState(0);
    const [syncEndpointAvailable, setSyncEndpointAvailable] = useState(true);

    const normalizeSyncConfig = (rawConfig) => {
        const sourceConfig = rawConfig || {};
        const globalSettings = sourceConfig.global_settings || {
            csv_output_dir: 'data/exports',
            log_level: 'INFO',
            retry_attempts: 3,
            retry_delay_seconds: 5,
        };

        const courses = Array.isArray(sourceConfig.courses) ? sourceConfig.courses : [];
        const normalizedCourses = courses.map((course) => {
            const general = course.general || {};
            const gradesyncSection = course.gradesync || {};
            const sourceContainer = gradesyncSection.sources || course.sources || {};
            const legacySources = {
                gradescope: gradesyncSection.gradescope || course.gradescope,
                prairielearn: gradesyncSection.prairielearn || course.prairielearn,
                iclicker: gradesyncSection.iclicker || course.iclicker,
            };

            const sources = {
                gradescope: {
                    enabled: sourceContainer?.gradescope?.enabled ?? legacySources.gradescope?.enabled ?? false,
                    course_id: sourceContainer?.gradescope?.course_id ?? legacySources.gradescope?.course_id ?? '',
                    sync_interval_hours: sourceContainer?.gradescope?.sync_interval_hours ?? legacySources.gradescope?.sync_interval_hours ?? 24,
                },
                prairielearn: {
                    enabled: sourceContainer?.prairielearn?.enabled ?? legacySources.prairielearn?.enabled ?? false,
                    course_id: sourceContainer?.prairielearn?.course_id ?? legacySources.prairielearn?.course_id ?? '',
                },
                iclicker: {
                    enabled: sourceContainer?.iclicker?.enabled ?? legacySources.iclicker?.enabled ?? false,
                    course_names: sourceContainer?.iclicker?.course_names ?? legacySources.iclicker?.course_names ?? [],
                },
            };

            return {
                id: general.id || course.id || sources.gradescope.course_id || `course_${Date.now()}`,
                name: general.name || course.name || '',
                department: general.department || course.department || '',
                course_number: general.course_number || course.course_number || '',
                semester: general.semester || course.semester || 'Fall',
                year: general.year || course.year || new Date().getFullYear(),
                instructor: general.instructor || course.instructor || '',
                sources,
                database: {
                    enabled: gradesyncSection.database?.enabled ?? course.database?.enabled ?? true,
                    use_as_primary: gradesyncSection.database?.use_as_primary ?? course.database?.use_as_primary ?? true,
                },
                buckets: {
                    total_points_cap: gradesyncSection.buckets?.total_points_cap ?? course.buckets?.total_points_cap ?? '',
                    rounding_policy: gradesyncSection.buckets?.rounding_policy ?? course.buckets?.rounding_policy ?? '',
                    component_percentages: gradesyncSection.buckets?.component_percentages || course.buckets?.component_percentages || [],
                    grade_bins: gradesyncSection.buckets?.grade_bins || course.buckets?.grade_bins || [],
                    grading_breakdown: gradesyncSection.buckets?.grading_breakdown || course.buckets?.grading_breakdown || [],
                },
                assignment_categories: gradesyncSection.assignment_categories || course.assignment_categories || [],
            };
        });

        return {
            ...sourceConfig,
            global_settings: globalSettings,
            courses: normalizedCourses,
        };
    };

    useEffect(() => {
        loadConfig();
    }, []);

    const getErrorMessage = (error, fallbackMessage) => {
        const serverError = error?.response?.data?.error || error?.response?.data?.message;
        const status = error?.response?.status;
        if (serverError && status) {
            return `${fallbackMessage} (${status}: ${serverError})`;
        }
        if (serverError) {
            return `${fallbackMessage} (${serverError})`;
        }
        return fallbackMessage;
    };

    const loadConfig = async () => {
        try {
            setLoading(true);
            const [viewResult, syncResult] = await Promise.allSettled([
                apiv2.get('/config'),
                apiv2.get('/config/sync'),
            ]);

            if (viewResult.status === 'fulfilled') {
                setConfig(viewResult.value.data);
                setOriginalConfig(JSON.parse(JSON.stringify(viewResult.value.data)));
            } else {
                throw viewResult.reason;
            }

            if (syncResult.status === 'fulfilled') {
                const normalizedSync = normalizeSyncConfig(syncResult.value.data);
                setSyncConfig(normalizedSync);
                setOriginalSyncConfig(JSON.parse(JSON.stringify(normalizedSync)));
                setSyncEndpointAvailable(true);
            } else {
                const fallbackSync = normalizeSyncConfig({ global_settings: {}, courses: [] });
                setSyncConfig(fallbackSync);
                setOriginalSyncConfig(JSON.parse(JSON.stringify(fallbackSync)));
                setSyncEndpointAvailable(false);
                showSnackbar(getErrorMessage(syncResult.reason, 'GradeSync configuration endpoint unavailable, loaded fallback view'), 'warning');
            }
        } catch (error) {
            showSnackbar(getErrorMessage(error, 'Failed to load GradeView configuration'), 'error');
            console.error('Error loading config:', error);
        } finally {
            setLoading(false);
        }
    };

    const saveConfig = async () => {
        try {
            setSaving(true);
            await apiv2.put('/config', config);
            if (syncEndpointAvailable) {
                await apiv2.put('/config/sync', syncConfig);
            }
            setOriginalConfig(JSON.parse(JSON.stringify(config)));
            setOriginalSyncConfig(JSON.parse(JSON.stringify(syncConfig)));
            if (syncEndpointAvailable) {
                showSnackbar('Configuration saved successfully', 'success');
            } else {
                showSnackbar('GradeView saved. GradeSync endpoint unavailable, skipped sync config save', 'warning');
            }
        } catch (error) {
            showSnackbar(getErrorMessage(error, 'Failed to save configuration'), 'error');
            console.error('Error saving config:', error);
        } finally {
            setSaving(false);
        }
    };

    const resetConfig = () => {
        setConfig(JSON.parse(JSON.stringify(originalConfig)));
        setSyncConfig(JSON.parse(JSON.stringify(originalSyncConfig)));
        showSnackbar('Configuration reset to last saved state', 'info');
    };

    const showSnackbar = (message, severity) => {
        setSnackbar({ open: true, message, severity });
    };

    const handleCloseSnackbar = () => {
        setSnackbar({ ...snackbar, open: false });
    };

    const addAdmin = () => {
        if (newAdmin && newAdmin.includes('@')) {
            if (!config.admins.includes(newAdmin)) {
                setConfig({
                    ...config,
                    admins: [...config.admins, newAdmin],
                });
                setNewAdmin('');
                showSnackbar('Admin added', 'success');
            } else {
                showSnackbar('Admin already exists', 'warning');
            }
        } else {
            showSnackbar('Please enter a valid email address', 'error');
        }
    };

    const removeAdmin = (email) => {
        setConfig({
            ...config,
            admins: config.admins.filter((admin) => admin !== email),
        });
        showSnackbar('Admin removed', 'info');
    };

    const hasChanges = () => {
        return JSON.stringify(config) !== JSON.stringify(originalConfig) ||
               JSON.stringify(syncConfig) !== JSON.stringify(originalSyncConfig);
    };

    // GradeSync specific handlers
    const updateCourse = (index, field, value) => {
        const updatedCourses = [...syncConfig.courses];
        updatedCourses[index] = { ...updatedCourses[index], [field]: value };
        setSyncConfig({ ...syncConfig, courses: updatedCourses });
    };

    const updateCourseSection = (courseIndex, section, field, value) => {
        const updatedCourses = [...syncConfig.courses];
        updatedCourses[courseIndex] = {
            ...updatedCourses[courseIndex],
            [section]: { ...updatedCourses[courseIndex][section], [field]: value }
        };
        setSyncConfig({ ...syncConfig, courses: updatedCourses });
    };

    const updateCourseNestedSection = (courseIndex, section, subSection, field, value) => {
        const updatedCourses = [...syncConfig.courses];
        updatedCourses[courseIndex] = {
            ...updatedCourses[courseIndex],
            [section]: {
                ...updatedCourses[courseIndex][section],
                [subSection]: {
                    ...updatedCourses[courseIndex][section]?.[subSection],
                    [field]: value,
                },
            },
        };
        setSyncConfig({ ...syncConfig, courses: updatedCourses });
    };

    const updateBucketListItem = (courseIndex, bucketKey, itemIndex, field, value) => {
        const updatedCourses = [...syncConfig.courses];
        const list = [...(updatedCourses[courseIndex].buckets?.[bucketKey] || [])];
        list[itemIndex] = { ...list[itemIndex], [field]: value };
        updatedCourses[courseIndex] = {
            ...updatedCourses[courseIndex],
            buckets: {
                ...updatedCourses[courseIndex].buckets,
                [bucketKey]: list,
            },
        };
        setSyncConfig({ ...syncConfig, courses: updatedCourses });
    };

    const addBucketListItem = (courseIndex, bucketKey, template) => {
        const updatedCourses = [...syncConfig.courses];
        const list = [...(updatedCourses[courseIndex].buckets?.[bucketKey] || [])];
        list.push(template);
        updatedCourses[courseIndex] = {
            ...updatedCourses[courseIndex],
            buckets: {
                ...updatedCourses[courseIndex].buckets,
                [bucketKey]: list,
            },
        };
        setSyncConfig({ ...syncConfig, courses: updatedCourses });
    };

    const removeBucketListItem = (courseIndex, bucketKey, itemIndex) => {
        const updatedCourses = [...syncConfig.courses];
        const list = [...(updatedCourses[courseIndex].buckets?.[bucketKey] || [])].filter((_, i) => i !== itemIndex);
        updatedCourses[courseIndex] = {
            ...updatedCourses[courseIndex],
            buckets: {
                ...updatedCourses[courseIndex].buckets,
                [bucketKey]: list,
            },
        };
        setSyncConfig({ ...syncConfig, courses: updatedCourses });
    };

    const addCourse = () => {
        const newCourse = {
            id: `new_course_${Date.now()}`,
            name: 'New Course',
            department: 'COMPSCI',
            course_number: '0',
            semester: 'Fall',
            year: new Date().getFullYear(),
            instructor: '',
            sources: {
                gradescope: { enabled: false, course_id: '', sync_interval_hours: 24 },
                prairielearn: { enabled: false, course_id: '' },
                iclicker: { enabled: false, course_names: [] },
            },
            database: { enabled: true, use_as_primary: true },
            buckets: {
                total_points_cap: '',
                rounding_policy: '',
                component_percentages: [],
                grade_bins: [],
                grading_breakdown: [],
            },
            assignment_categories: []
        };
        setSyncConfig({ ...syncConfig, courses: [...syncConfig.courses, newCourse] });
        setExpandedCourse(syncConfig.courses.length);
    };

    const removeCourse = (index) => {
        const updatedCourses = syncConfig.courses.filter((_, i) => i !== index);
        setSyncConfig({ ...syncConfig, courses: updatedCourses });
        showSnackbar('Course removed', 'info');
    };

    const addCategory = (courseIndex) => {
        const updatedCourses = [...syncConfig.courses];
        updatedCourses[courseIndex].assignment_categories.push({
            name: 'New Category',
            patterns: []
        });
        setSyncConfig({ ...syncConfig, courses: updatedCourses });
    };

    const updateCategory = (courseIndex, catIndex, field, value) => {
        const updatedCourses = [...syncConfig.courses];
        updatedCourses[courseIndex].assignment_categories[catIndex][field] = value;
        setSyncConfig({ ...syncConfig, courses: updatedCourses });
    };

    const removeCategory = (courseIndex, catIndex) => {
        const updatedCourses = [...syncConfig.courses];
        updatedCourses[courseIndex].assignment_categories = 
            updatedCourses[courseIndex].assignment_categories.filter((_, i) => i !== catIndex);
        setSyncConfig({ ...syncConfig, courses: updatedCourses });
    };

    const addPattern = (courseIndex, catIndex, pattern) => {
        if (pattern.trim()) {
            const updatedCourses = [...syncConfig.courses];
            updatedCourses[courseIndex].assignment_categories[catIndex].patterns.push(pattern.trim());
            setSyncConfig({ ...syncConfig, courses: updatedCourses });
        }
    };

    const removePattern = (courseIndex, catIndex, patternIndex) => {
        const updatedCourses = [...syncConfig.courses];
        updatedCourses[courseIndex].assignment_categories[catIndex].patterns = 
            updatedCourses[courseIndex].assignment_categories[catIndex].patterns.filter((_, i) => i !== patternIndex);
        setSyncConfig({ ...syncConfig, courses: updatedCourses });
    };

    if (loading) {
        return (
            <Box sx={{ p: 3, textAlign: 'center' }}>
                <Typography>Loading configuration...</Typography>
            </Box>
        );
    }

    if (!config) {
        return (
            <Box sx={{ p: 3 }}>
                <Alert severity="error">Failed to load GradeView configuration</Alert>
            </Box>
        );
    }

    return (
        <Box sx={{ p: 3 }}>
            <PageHeader>Settings</PageHeader>
            
            <Alert severity="info" sx={{ mb: 3 }}>
                配置按层级组织：系统级设置 → 课程级设置 → 数据源 / 评分规则 / 分类映射。保存后对所有用户生效。
            </Alert>

            <Box className='glass-section' sx={{ borderBottom: 1, borderColor: 'divider', mb: 3, px: 2, py: 1, borderRadius: 2 }}>
                <Tabs value={tabValue} onChange={(e, newValue) => setTabValue(newValue)}>
                    <Tab label="GradeView Configuration" />
                    <Tab label="GradeSync Configuration" icon={<SyncIcon />} iconPosition="start" />
                </Tabs>
            </Box>

            {/* GradeView Configuration Tab */}
            <Box role="tabpanel" hidden={tabValue !== 0}>

            {/* Admin Users */}
            <Paper elevation={2} className='glass-section' sx={{ p: 3, mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <SettingsIcon sx={{ mr: 1 }} />
                    <Typography variant="h6">Administrator Users</Typography>
                </Box>
                <Divider sx={{ mb: 2 }} />

                <Alert severity="warning" sx={{ mb: 2 }}>
                    Admins have full access to all features including the admin panel and alerts system.
                </Alert>

                <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                    <TextField
                        fullWidth
                        label="Add New Admin"
                        value={newAdmin}
                        onChange={(e) => setNewAdmin(e.target.value)}
                        placeholder="admin@berkeley.edu"
                        helperText="Enter an email address and click Add"
                        onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                                addAdmin();
                            }
                        }}
                    />
                    <Button
                        variant="contained"
                        startIcon={<Add />}
                        onClick={addAdmin}
                        sx={{ minWidth: '100px' }}
                    >
                        Add
                    </Button>
                </Box>

                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {config.admins?.map((admin, index) => (
                        <Chip
                            key={index}
                            label={admin}
                            onDelete={() => removeAdmin(admin)}
                            color="primary"
                            variant="outlined"
                        />
                    ))}
                </Box>
            </Paper>

            {/* Google OAuth */}
            <Paper elevation={2} className='glass-section' sx={{ p: 3, mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <SettingsIcon sx={{ mr: 1 }} />
                    <Typography variant="h6">Google OAuth Configuration</Typography>
                </Box>
                <Divider sx={{ mb: 2 }} />

                <TextField
                    fullWidth
                    label="Client ID"
                    value={config.googleconfig?.oauth?.clientid || ''}
                    onChange={(e) => setConfig({
                        ...config,
                        googleconfig: {
                            ...config.googleconfig,
                            oauth: { ...config.googleconfig?.oauth, clientid: e.target.value }
                        }
                    })}
                    helperText="Google OAuth 2.0 Client ID for authentication"
                />
            </Paper>
            </Box>

            {/* GradeSync Configuration Tab */}
            <Box role="tabpanel" hidden={tabValue !== 1}>
                {syncConfig && (
                    <>
                        {/* Global Settings */}
                        <Paper elevation={2} className='glass-section' sx={{ p: 3, mb: 3 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                                <SyncIcon sx={{ mr: 1 }} />
                                <Typography variant="h6">Global Sync Settings</Typography>
                            </Box>
                            <Divider sx={{ mb: 2 }} />

                            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                                <TextField
                                    label="CSV Output Directory"
                                    value={syncConfig.global_settings?.csv_output_dir || ''}
                                    onChange={(e) => setSyncConfig({
                                        ...syncConfig,
                                        global_settings: { ...syncConfig.global_settings, csv_output_dir: e.target.value }
                                    })}
                                    helperText="Directory for exported CSV files"
                                    sx={{ flex: 1, minWidth: '200px' }}
                                />
                                <FormControl sx={{ minWidth: '150px' }}>
                                    <InputLabel>Log Level</InputLabel>
                                    <Select
                                        value={syncConfig.global_settings?.log_level || 'INFO'}
                                        onChange={(e) => setSyncConfig({
                                            ...syncConfig,
                                            global_settings: { ...syncConfig.global_settings, log_level: e.target.value }
                                        })}
                                        label="Log Level"
                                    >
                                        <MenuItem value="DEBUG">DEBUG</MenuItem>
                                        <MenuItem value="INFO">INFO</MenuItem>
                                        <MenuItem value="WARNING">WARNING</MenuItem>
                                        <MenuItem value="ERROR">ERROR</MenuItem>
                                    </Select>
                                    <FormHelperText>Logging verbosity</FormHelperText>
                                </FormControl>
                                <TextField
                                    label="Retry Attempts"
                                    type="number"
                                    value={syncConfig.global_settings?.retry_attempts || 3}
                                    onChange={(e) => setSyncConfig({
                                        ...syncConfig,
                                        global_settings: { ...syncConfig.global_settings, retry_attempts: parseInt(e.target.value || 0, 10) }
                                    })}
                                    helperText="Max retry attempts"
                                    sx={{ width: '150px' }}
                                />
                                <TextField
                                    label="Retry Delay (seconds)"
                                    type="number"
                                    value={syncConfig.global_settings?.retry_delay_seconds || 5}
                                    onChange={(e) => setSyncConfig({
                                        ...syncConfig,
                                        global_settings: { ...syncConfig.global_settings, retry_delay_seconds: parseInt(e.target.value || 0, 10) }
                                    })}
                                    helperText="Delay between retries"
                                    sx={{ width: '180px' }}
                                />
                            </Box>
                        </Paper>

                        {/* Courses */}
                        <Paper elevation={2} className='glass-section' sx={{ p: 3, mb: 3 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                    <School sx={{ mr: 1 }} />
                                    <Typography variant="h6">Courses</Typography>
                                </Box>
                                <Button startIcon={<Add />} onClick={addCourse} variant="outlined">
                                    Add Course
                                </Button>
                            </Box>
                            <Divider sx={{ mb: 2 }} />

                            {syncConfig.courses?.map((course, courseIndex) => (
                                <Accordion 
                                    key={courseIndex}
                                    expanded={expandedCourse === courseIndex}
                                    onChange={() => setExpandedCourse(expandedCourse === courseIndex ? -1 : courseIndex)}
                                    sx={{ mb: 1 }}
                                >
                                    <AccordionSummary expandIcon={<ExpandMore />}>
                                        <Typography sx={{ fontWeight: 'bold' }}>
                                            {course.name} ({course.department} {course.course_number})
                                        </Typography>
                                    </AccordionSummary>
                                    <AccordionDetails>
                                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                            {/* Basic Info */}
                                            <Typography variant="subtitle2" color="primary">Basic Information</Typography>
                                            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                                                <TextField
                                                    label="Course ID"
                                                    value={course.id}
                                                    onChange={(e) => updateCourse(courseIndex, 'id', e.target.value)}
                                                    helperText="Unique identifier"
                                                    sx={{ flex: 1, minWidth: '150px' }}
                                                />
                                                <TextField
                                                    label="Course Name"
                                                    value={course.name}
                                                    onChange={(e) => updateCourse(courseIndex, 'name', e.target.value)}
                                                    sx={{ flex: 2, minWidth: '200px' }}
                                                />
                                                <TextField
                                                    label="Department"
                                                    value={course.department}
                                                    onChange={(e) => updateCourse(courseIndex, 'department', e.target.value)}
                                                    sx={{ width: '120px' }}
                                                />
                                                <TextField
                                                    label="Course #"
                                                    value={course.course_number}
                                                    onChange={(e) => updateCourse(courseIndex, 'course_number', e.target.value)}
                                                    sx={{ width: '100px' }}
                                                />
                                            </Box>
                                            <Box sx={{ display: 'flex', gap: 2 }}>
                                                <FormControl sx={{ minWidth: '120px' }}>
                                                    <InputLabel>Semester</InputLabel>
                                                    <Select
                                                        value={course.semester}
                                                        onChange={(e) => updateCourse(courseIndex, 'semester', e.target.value)}
                                                        label="Semester"
                                                    >
                                                        <MenuItem value="Spring">Spring</MenuItem>
                                                        <MenuItem value="Summer">Summer</MenuItem>
                                                        <MenuItem value="Fall">Fall</MenuItem>
                                                        <MenuItem value="Winter">Winter</MenuItem>
                                                    </Select>
                                                </FormControl>
                                                <TextField
                                                    label="Year"
                                                    type="number"
                                                    value={course.year}
                                                    onChange={(e) => updateCourse(courseIndex, 'year', parseInt(e.target.value))}
                                                    sx={{ width: '100px' }}
                                                />
                                                <TextField
                                                    label="Instructor"
                                                    value={course.instructor}
                                                    onChange={(e) => updateCourse(courseIndex, 'instructor', e.target.value)}
                                                    sx={{ flex: 1 }}
                                                />
                                            </Box>

                                            <Divider sx={{ my: 1 }} />

                                            {/* Source Integrations */}
                                            <Typography variant="subtitle2" color="primary">Source Integrations</Typography>
                                            
                                            {/* Gradescope */}
                                            <Box sx={{ pl: 2, border: '1px solid #e0e0e0', borderRadius: 1, p: 2 }}>
                                                <FormControlLabel
                                                    control={
                                                        <Switch
                                                            checked={course.sources?.gradescope?.enabled || false}
                                                            onChange={(e) => updateCourseNestedSection(courseIndex, 'sources', 'gradescope', 'enabled', e.target.checked)}
                                                        />
                                                    }
                                                    label="Gradescope Enabled"
                                                />
                                                {course.sources?.gradescope?.enabled && (
                                                    <Box sx={{ mt: 1, display: 'flex', gap: 2 }}>
                                                        <TextField
                                                            label="Course ID"
                                                            value={course.sources?.gradescope?.course_id || ''}
                                                            onChange={(e) => updateCourseNestedSection(courseIndex, 'sources', 'gradescope', 'course_id', e.target.value)}
                                                            sx={{ flex: 1 }}
                                                        />
                                                        <TextField
                                                            label="Sync Interval (hours)"
                                                            type="number"
                                                            value={course.sources?.gradescope?.sync_interval_hours || 24}
                                                            onChange={(e) => updateCourseNestedSection(courseIndex, 'sources', 'gradescope', 'sync_interval_hours', parseInt(e.target.value || 0, 10))}
                                                            sx={{ width: '180px' }}
                                                        />
                                                    </Box>
                                                )}
                                            </Box>

                                            {/* PrairieLearn */}
                                            <Box sx={{ pl: 2, border: '1px solid #e0e0e0', borderRadius: 1, p: 2 }}>
                                                <FormControlLabel
                                                    control={
                                                        <Switch
                                                            checked={course.sources?.prairielearn?.enabled || false}
                                                            onChange={(e) => updateCourseNestedSection(courseIndex, 'sources', 'prairielearn', 'enabled', e.target.checked)}
                                                        />
                                                    }
                                                    label="PrairieLearn Enabled"
                                                />
                                                {course.sources?.prairielearn?.enabled && (
                                                    <TextField
                                                        label="Course ID"
                                                        value={course.sources?.prairielearn?.course_id || ''}
                                                        onChange={(e) => updateCourseNestedSection(courseIndex, 'sources', 'prairielearn', 'course_id', e.target.value)}
                                                        fullWidth
                                                        sx={{ mt: 1 }}
                                                    />
                                                )}
                                            </Box>

                                            {/* iClicker */}
                                            <Box sx={{ pl: 2, border: '1px solid #e0e0e0', borderRadius: 1, p: 2 }}>
                                                <FormControlLabel
                                                    control={
                                                        <Switch
                                                            checked={course.sources?.iclicker?.enabled || false}
                                                            onChange={(e) => updateCourseNestedSection(courseIndex, 'sources', 'iclicker', 'enabled', e.target.checked)}
                                                        />
                                                    }
                                                    label="iClicker Enabled"
                                                />
                                                {course.sources?.iclicker?.enabled && (
                                                    <Box sx={{ mt: 1 }}>
                                                        <Typography variant="caption">Course Names (one per line)</Typography>
                                                        <TextField
                                                            multiline
                                                            rows={3}
                                                            value={course.sources?.iclicker?.course_names?.join('\n') || ''}
                                                            onChange={(e) => updateCourseNestedSection(courseIndex, 'sources', 'iclicker', 'course_names', e.target.value.split('\n').map((v) => v.trim()).filter(Boolean))}
                                                            fullWidth
                                                        />
                                                    </Box>
                                                )}
                                            </Box>

                                            {/* Database */}
                                            <Box sx={{ pl: 2, border: '1px solid #e0e0e0', borderRadius: 1, p: 2 }}>
                                                <FormControlLabel
                                                    control={
                                                        <Switch
                                                            checked={course.database?.enabled || false}
                                                            onChange={(e) => updateCourseSection(courseIndex, 'database', 'enabled', e.target.checked)}
                                                        />
                                                    }
                                                    label="Database Enabled"
                                                />
                                                <FormControlLabel
                                                    control={
                                                        <Switch
                                                            checked={course.database?.use_as_primary || false}
                                                            onChange={(e) => updateCourseSection(courseIndex, 'database', 'use_as_primary', e.target.checked)}
                                                        />
                                                    }
                                                    label="Use as Primary"
                                                    sx={{ ml: 2 }}
                                                />
                                            </Box>

                                            <Divider sx={{ my: 1 }} />

                                            <Typography variant="subtitle2" color="primary">Buckets / Grading Rules</Typography>
                                            <Paper variant="outlined" sx={{ p: 2 }}>
                                                <Stack spacing={2}>
                                                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                                                        <TextField
                                                            label="Total Points Cap"
                                                            type="number"
                                                            value={course.buckets?.total_points_cap ?? ''}
                                                            onChange={(e) => updateCourseSection(courseIndex, 'buckets', 'total_points_cap', parseInt(e.target.value || 0, 10))}
                                                            sx={{ width: '220px' }}
                                                        />
                                                        <TextField
                                                            label="Rounding Policy"
                                                            value={course.buckets?.rounding_policy || ''}
                                                            onChange={(e) => updateCourseSection(courseIndex, 'buckets', 'rounding_policy', e.target.value)}
                                                            sx={{ flex: 1, minWidth: '260px' }}
                                                        />
                                                    </Box>

                                                    <Box>
                                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                                            <Typography variant="subtitle2">Component Percentages</Typography>
                                                            <Button size="small" startIcon={<Add />} onClick={() => addBucketListItem(courseIndex, 'component_percentages', { component: '', percentage: 0 })}>
                                                                Add
                                                            </Button>
                                                        </Box>
                                                        {(course.buckets?.component_percentages || []).map((item, itemIndex) => (
                                                            <Box key={itemIndex} sx={{ display: 'flex', gap: 1, mb: 1 }}>
                                                                <TextField
                                                                    label="Component"
                                                                    value={item.component || ''}
                                                                    onChange={(e) => updateBucketListItem(courseIndex, 'component_percentages', itemIndex, 'component', e.target.value)}
                                                                    sx={{ flex: 1 }}
                                                                    size="small"
                                                                />
                                                                <TextField
                                                                    label="%"
                                                                    type="number"
                                                                    value={item.percentage ?? 0}
                                                                    onChange={(e) => updateBucketListItem(courseIndex, 'component_percentages', itemIndex, 'percentage', parseFloat(e.target.value || 0))}
                                                                    sx={{ width: '120px' }}
                                                                    size="small"
                                                                />
                                                                <IconButton color="error" size="small" onClick={() => removeBucketListItem(courseIndex, 'component_percentages', itemIndex)}>
                                                                    <Delete />
                                                                </IconButton>
                                                            </Box>
                                                        ))}
                                                    </Box>

                                                    <Box>
                                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                                            <Typography variant="subtitle2">Grade Bins</Typography>
                                                            <Button size="small" startIcon={<Add />} onClick={() => addBucketListItem(courseIndex, 'grade_bins', { grade: '', range: '' })}>
                                                                Add
                                                            </Button>
                                                        </Box>
                                                        {(course.buckets?.grade_bins || []).map((item, itemIndex) => (
                                                            <Box key={itemIndex} sx={{ display: 'flex', gap: 1, mb: 1 }}>
                                                                <TextField
                                                                    label="Grade"
                                                                    value={item.grade || ''}
                                                                    onChange={(e) => updateBucketListItem(courseIndex, 'grade_bins', itemIndex, 'grade', e.target.value)}
                                                                    sx={{ width: '120px' }}
                                                                    size="small"
                                                                />
                                                                <TextField
                                                                    label="Range"
                                                                    value={item.range || ''}
                                                                    onChange={(e) => updateBucketListItem(courseIndex, 'grade_bins', itemIndex, 'range', e.target.value)}
                                                                    sx={{ flex: 1 }}
                                                                    size="small"
                                                                />
                                                                <IconButton color="error" size="small" onClick={() => removeBucketListItem(courseIndex, 'grade_bins', itemIndex)}>
                                                                    <Delete />
                                                                </IconButton>
                                                            </Box>
                                                        ))}
                                                    </Box>

                                                    <Box>
                                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                                            <Typography variant="subtitle2">Grading Breakdown</Typography>
                                                            <Button size="small" startIcon={<Add />} onClick={() => addBucketListItem(courseIndex, 'grading_breakdown', { assignment: '', points: 0 })}>
                                                                Add
                                                            </Button>
                                                        </Box>
                                                        {(course.buckets?.grading_breakdown || []).map((item, itemIndex) => (
                                                            <Box key={itemIndex} sx={{ display: 'flex', gap: 1, mb: 1 }}>
                                                                <TextField
                                                                    label="Assignment"
                                                                    value={item.assignment || ''}
                                                                    onChange={(e) => updateBucketListItem(courseIndex, 'grading_breakdown', itemIndex, 'assignment', e.target.value)}
                                                                    sx={{ flex: 1 }}
                                                                    size="small"
                                                                />
                                                                <TextField
                                                                    label="Points"
                                                                    type="number"
                                                                    value={item.points ?? 0}
                                                                    onChange={(e) => updateBucketListItem(courseIndex, 'grading_breakdown', itemIndex, 'points', parseFloat(e.target.value || 0))}
                                                                    sx={{ width: '140px' }}
                                                                    size="small"
                                                                />
                                                                <IconButton color="error" size="small" onClick={() => removeBucketListItem(courseIndex, 'grading_breakdown', itemIndex)}>
                                                                    <Delete />
                                                                </IconButton>
                                                            </Box>
                                                        ))}
                                                    </Box>
                                                </Stack>
                                            </Paper>

                                            <Divider sx={{ my: 1 }} />

                                            {/* Assignment Categories */}
                                            <Box>
                                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                                    <Typography variant="subtitle2" color="primary">Assignment Categories</Typography>
                                                    <Button size="small" startIcon={<Add />} onClick={() => addCategory(courseIndex)}>
                                                        Add Category
                                                    </Button>
                                                </Box>
                                                {course.assignment_categories?.map((category, catIndex) => (
                                                    <Paper key={catIndex} variant="outlined" sx={{ p: 2, mb: 1 }}>
                                                        <Box sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'center' }}>
                                                            <TextField
                                                                label="Category Name"
                                                                value={category.name}
                                                                onChange={(e) => updateCategory(courseIndex, catIndex, 'name', e.target.value)}
                                                                size="small"
                                                                sx={{ flex: 1 }}
                                                            />
                                                            <IconButton 
                                                                size="small" 
                                                                onClick={() => removeCategory(courseIndex, catIndex)}
                                                                color="error"
                                                            >
                                                                <Delete />
                                                            </IconButton>
                                                        </Box>
                                                        <Typography variant="caption" sx={{ display: 'block', mb: 0.5 }}>Patterns:</Typography>
                                                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
                                                            {category.patterns?.map((pattern, pIndex) => (
                                                                <Chip
                                                                    key={pIndex}
                                                                    label={pattern}
                                                                    onDelete={() => removePattern(courseIndex, catIndex, pIndex)}
                                                                    size="small"
                                                                />
                                                            ))}
                                                        </Box>
                                                        <TextField
                                                            placeholder="Add pattern (press Enter)"
                                                            size="small"
                                                            fullWidth
                                                            onKeyPress={(e) => {
                                                                if (e.key === 'Enter') {
                                                                    addPattern(courseIndex, catIndex, e.target.value);
                                                                    e.target.value = '';
                                                                }
                                                            }}
                                                        />
                                                    </Paper>
                                                ))}
                                            </Box>

                                            <Button
                                                variant="outlined"
                                                color="error"
                                                startIcon={<Delete />}
                                                onClick={() => removeCourse(courseIndex)}
                                                sx={{ mt: 2 }}
                                            >
                                                Remove Course
                                            </Button>
                                        </Box>
                                    </AccordionDetails>
                                </Accordion>
                            ))}
                        </Paper>
                    </>
                )}
            </Box>

            {/* Action Buttons */}
            <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end', mt: 3 }}>
                <Button
                    variant="outlined"
                    startIcon={<Refresh />}
                    onClick={resetConfig}
                    disabled={!hasChanges()}
                >
                    Reset Changes
                </Button>
                <Button
                    variant="contained"
                    startIcon={<Save />}
                    onClick={saveConfig}
                    disabled={!hasChanges() || saving}
                >
                    {saving ? 'Saving...' : 'Save Configuration'}
                </Button>
            </Box>

            <Snackbar
                open={snackbar.open}
                autoHideDuration={4000}
                onClose={handleCloseSnackbar}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} sx={{ width: '100%' }}>
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
}
