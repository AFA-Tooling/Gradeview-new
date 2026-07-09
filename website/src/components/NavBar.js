import React, {
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useReducer,
    useRef,
    useState,
} from 'react';
import {
    AppBar,
    Avatar,
    Box,
    Button,
    Chip,
    Divider,
    FormControl,
    IconButton,
    InputLabel,
    Link,
    Menu,
    MenuItem,
    Select,
    Skeleton,
    Stack,
    Toolbar,
    Tooltip,
    Typography,
    useMediaQuery,
} from '@mui/material';
import {
    AccountTree,
    AdminPanelSettingsOutlined,
    ArrowBack,
    ArticleOutlined,
    AssignmentOutlined,
    DashboardOutlined,
    EventAvailableOutlined,
    HelpOutlineOutlined,
    KeyboardArrowDown,
    LockOutlined,
    LoginOutlined,
    Logout,
    PolicyOutlined,
    QuizOutlined,
    SchoolOutlined,
    ScienceOutlined,
    SettingsOutlined as SettingsIcon,
    SyncOutlined,
    WarningAmberOutlined,
    WorkOutlineOutlined,
} from '@mui/icons-material';
import { jwtDecode } from 'jwt-decode';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { cachedApiGet } from '../utils/apiCache';
import {
    SHELL_PERMISSION_STATUS,
    SHELL_UI_CAPABILITIES_STORAGE_KEY,
    buildShellRenderModel,
    clearShellSession,
    createInitialPermissionState,
    decodePermissionToken,
    formatCourseLabel,
    getCourseControlModel,
    isNavigationItemActive,
    normalizeCourseList,
    parseStoredPermissions,
    permissionStateReducer,
    resolveCourseQueryId,
} from '../utils/personaNavigation';
import NavMenuItem from './NavMenuItem';
import { StudentSelectionContext } from './StudentSelectionWrapper';

const SIDEBAR_WIDTH = 260;
const TOPBAR_HEIGHT = 56;

const NAV_ICONS = Object.freeze({
    workspace: <DashboardOutlined />,
    report: <ArticleOutlined />,
    attendance: <EventAvailableOutlined />,
    labs: <ScienceOutlined />,
    projects: <WorkOutlineOutlined />,
    exams: <QuizOutlined />,
    assignments: <AssignmentOutlined />,
    explain: <HelpOutlineOutlined />,
    concepts: <SchoolOutlined />,
    policy: <PolicyOutlined />,
    'class-health': <AdminPanelSettingsOutlined />,
    'grade-sync': <SyncOutlined />,
    alerts: <WarningAmberOutlined />,
    settings: <SettingsIcon />,
});

function getInitialPermissionState() {
    const token = localStorage.getItem('token') || '';
    return createInitialPermissionState({
        token,
        storedPermissions: parseStoredPermissions(localStorage.getItem('permissions')),
        storedUiCapabilities: parseStoredPermissions(localStorage.getItem(SHELL_UI_CAPABILITIES_STORAGE_KEY)),
        tokenClaims: decodePermissionToken(token, jwtDecode),
    });
}

async function requestPermissionSnapshot(courseId = '', courseList = []) {
    const queryCourseId = courseId ? resolveCourseQueryId(courseId, courseList) : '';
    const suffix = queryCourseId ? `?course_id=${encodeURIComponent(queryCourseId)}` : '';
    const response = await cachedApiGet(`/me/permissions${suffix}`, { ttlMs: 30000 });
    return response?.data || {};
}

async function requestCourses(isStaff) {
    if (!isStaff) {
        const response = await cachedApiGet('/students/courses', { ttlMs: 60000 });
        return normalizeCourseList(response?.data?.courses || []);
    }

    const [adminResult, studentResult] = await Promise.allSettled([
        cachedApiGet('/admin/sync', { ttlMs: 60000 }),
        cachedApiGet('/students/courses', { ttlMs: 60000 }),
    ]);
    const adminCourses = adminResult.status === 'fulfilled'
        ? (adminResult.value?.data?.courses || [])
        : [];
    const studentCourses = studentResult.status === 'fulfilled'
        ? (studentResult.value?.data?.courses || [])
        : [];
    return normalizeCourseList([...adminCourses, ...studentCourses]);
}

function navIcon(item, size = 18) {
    return React.cloneElement(NAV_ICONS[item.icon] || <DashboardOutlined />, {
        'aria-hidden': true,
        sx: { fontSize: size },
    });
}

function SidebarNavItem({ item, active }) {
    return (
        <Button
            component={NavLink}
            to={item.href}
            fullWidth
            startIcon={navIcon(item)}
            aria-current={active ? 'page' : undefined}
            sx={{
                justifyContent: 'flex-start',
                minHeight: 44,
                px: 1.25,
                borderRadius: 1.25,
                color: active ? '#111827' : '#555B66',
                backgroundColor: active ? '#E6E7E9' : 'transparent',
                fontSize: 13.5,
                fontWeight: active ? 750 : 650,
                lineHeight: 1.35,
                '& .MuiButton-startIcon': {
                    mr: 1,
                    color: active ? '#111827' : '#6B7280',
                },
                '&:hover': {
                    backgroundColor: active ? '#DEE0E3' : '#ECEEF1',
                    color: '#111827',
                },
                '&:focus-visible': {
                    outline: '3px solid #2563EB',
                    outlineOffset: 1,
                },
            }}
        >
            <Box component="span" sx={{ textAlign: 'left', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                {item.name}
            </Box>
        </Button>
    );
}

function SidebarSection({ section, pathname }) {
    return (
        <Box>
            <Typography
                component="h2"
                sx={{ px: 1, mb: 0.5, color: '#6B7280', fontSize: 11, fontWeight: 800, letterSpacing: '0.08em' }}
            >
                {section.title}
            </Typography>
            <Stack spacing={0.5}>
                {section.items.map((item) => (
                    <SidebarNavItem
                        key={item.name}
                        item={item}
                        active={isNavigationItemActive(item, pathname)}
                    />
                ))}
            </Stack>
        </Box>
    );
}

function ReadOnlyStatusChip({ isDemo }) {
    const visibleLabel = isDemo ? 'Demo · Read-only' : 'Read-only';
    const fullLabel = isDemo
        ? 'Demo mode, read-only interface. This label does not confirm server-side write protection.'
        : 'Read-only interface';
    return (
        <Tooltip title={fullLabel} arrow>
            <Chip
                icon={<LockOutlined aria-hidden="true" />}
                label={visibleLabel}
                aria-label={fullLabel}
                size="small"
                sx={{
                    flexShrink: 0,
                    bgcolor: '#FEF3C7',
                    color: '#713F12',
                    border: '1px solid #D97706',
                    fontWeight: 800,
                    '& .MuiChip-icon': { color: '#92400E' },
                }}
            />
        </Tooltip>
    );
}

function ReadOnlyNotice({ isDemo, compact = false }) {
    return (
        <Box
            role="status"
            aria-label={isDemo ? 'Demo mode read-only notice' : 'Read-only notice'}
            sx={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 1,
                p: compact ? 1.25 : 1.5,
                bgcolor: '#FFFBEB',
                color: '#713F12',
                border: '1px solid #D97706',
                borderRadius: 1.5,
            }}
        >
            <LockOutlined aria-hidden="true" sx={{ fontSize: 20, mt: 0.1, flexShrink: 0 }} />
            <Typography sx={{ fontSize: 13, lineHeight: 1.45, overflowWrap: 'anywhere' }}>
                <Box component="strong" sx={{ display: 'block', fontWeight: 800 }}>
                    {isDemo ? 'Demo mode · View-only experience' : 'Read-only experience'}
                </Box>
                This interface notice does not confirm server-side write protection.
            </Typography>
        </Box>
    );
}

function ReviewContext({ context, compact = false }) {
    if (!context) return null;
    return (
        <Box
            component="section"
            aria-label="Student review context"
            sx={{
                p: compact ? 1.25 : 1.5,
                border: '1px solid #93C5FD',
                bgcolor: '#EFF6FF',
                borderRadius: 1.5,
            }}
        >
            <Typography component="h2" sx={{ color: '#1E3A8A', fontSize: 14, fontWeight: 800 }}>
                Student review
            </Typography>
            <Typography sx={{ mt: 0.25, color: '#1E3A8A', fontSize: 12.5, lineHeight: 1.4, overflowWrap: 'anywhere' }}>
                Reviewing: {context.identifier}
            </Typography>
            <Button
                component={NavLink}
                to="/admin"
                fullWidth
                startIcon={<ArrowBack aria-hidden="true" />}
                sx={{
                    mt: 1,
                    minHeight: 44,
                    justifyContent: 'flex-start',
                    color: '#1E3A8A',
                    '&:focus-visible': { outline: '3px solid #2563EB', outlineOffset: 1 },
                }}
            >
                Return to Class Health
            </Button>
        </Box>
    );
}

function CourseControl({ model, onChange, controlId }) {
    if (model.kind === 'none') return null;

    if (model.kind === 'static') {
        return (
            <Tooltip title={model.label} placement="right" arrow>
                <Box
                    role="status"
                    aria-label={model.accessibleName}
                    sx={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 1,
                        minHeight: 48,
                        p: 1.25,
                        border: '1px solid #D8DCE3',
                        borderRadius: 1.25,
                        bgcolor: '#FFFFFF',
                    }}
                >
                    <SchoolOutlined aria-hidden="true" sx={{ mt: 0.1, fontSize: 20, color: '#4B5563', flexShrink: 0 }} />
                    <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ color: '#6B7280', fontSize: 11, fontWeight: 750, lineHeight: 1.2 }}>
                            Current course
                        </Typography>
                        <Typography sx={{ mt: 0.25, color: '#111827', fontSize: 13.5, fontWeight: 750, lineHeight: 1.35, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                            {model.label}
                        </Typography>
                    </Box>
                </Box>
            </Tooltip>
        );
    }

    const labelId = `${controlId}-label`;
    return (
        <FormControl size="small" fullWidth>
            <InputLabel id={labelId}>Current course</InputLabel>
            <Select
                id={controlId}
                labelId={labelId}
                label="Current course"
                value={model.value}
                onChange={onChange}
                IconComponent={KeyboardArrowDown}
                renderValue={() => (
                    <Typography sx={{ fontSize: 13.5, fontWeight: 750, lineHeight: 1.35, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                        {model.label}
                    </Typography>
                )}
                sx={{
                    minHeight: 52,
                    bgcolor: '#FFFFFF',
                    color: '#111827',
                    '& .MuiSelect-select': {
                        display: 'block',
                        minHeight: '0 !important',
                        whiteSpace: 'normal !important',
                        pr: '36px !important',
                    },
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                        borderColor: '#2563EB',
                        borderWidth: 2,
                    },
                }}
                MenuProps={{ MenuListProps: { 'aria-label': 'Available courses' } }}
            >
                {model.courses.map((course) => (
                    <MenuItem
                        key={course.id}
                        value={course.id}
                        sx={{ minHeight: 44, maxWidth: 420, whiteSpace: 'normal', overflowWrap: 'anywhere' }}
                    >
                        {formatCourseLabel(course)}
                    </MenuItem>
                ))}
            </Select>
        </FormControl>
    );
}

function PermissionLoadingState() {
    return (
        <Box role="status" aria-label="Loading navigation" sx={{ px: 0.5 }}>
            <Skeleton variant="rounded" height={44} sx={{ mb: 1 }} />
            <Skeleton variant="rounded" height={44} sx={{ mb: 1 }} />
            <Skeleton variant="rounded" height={44} />
        </Box>
    );
}

export default function ButtonAppBar() {
    const mobileView = useMediaQuery('(max-width:900px)');
    const location = useLocation();
    const navigate = useNavigate();
    const { setSelectedStudent } = useContext(StudentSelectionContext);
    const [loggedIn, setLoginStatus] = useState(() => Boolean(localStorage.getItem('token')));
    const [permissionState, dispatchPermissions] = useReducer(
        permissionStateReducer,
        undefined,
        getInitialPermissionState,
    );
    const [profilePicture] = useState(() => localStorage.getItem('profilepicture') || '');
    const [anchorEl, setAnchorEl] = useState(null);
    const [courses, setCourses] = useState([]);
    const [coursesLoading, setCoursesLoading] = useState(false);
    const [selectedCourse, setSelectedCourse] = useState(
        () => localStorage.getItem('selectedCourseId') || '',
    );
    const permissionRequestId = useRef(0);

    const refreshPermissions = useCallback(async (courseId = '', courseList = []) => {
        const requestId = permissionRequestId.current + 1;
        permissionRequestId.current = requestId;
        try {
            const data = await requestPermissionSnapshot(courseId, courseList);
            if (requestId !== permissionRequestId.current) return null;

            if (data.token) localStorage.setItem('token', data.token);
            localStorage.setItem('permissions', JSON.stringify(data.permissions || {}));
            const token = data.token || localStorage.getItem('token') || '';
            dispatchPermissions({
                type: 'permissions-resolved',
                permissions: data,
                tokenClaims: decodePermissionToken(token, jwtDecode),
            });
            return data;
        } catch (error) {
            if (requestId === permissionRequestId.current) {
                dispatchPermissions({
                    type: 'permissions-failed',
                    error: error?.message || 'Permissions could not be loaded.',
                });
            }
            return null;
        }
    }, []);

    useEffect(() => {
        if (!loggedIn) return undefined;
        refreshPermissions();
        return undefined;
    }, [loggedIn, refreshPermissions]);

    const isStaff = permissionState.capabilities.isStaff;
    const selectFirstStudentForCourse = useCallback(async (courseId, courseList) => {
        if (!isStaff || !courseId) return;
        const queryCourseId = resolveCourseQueryId(courseId, courseList);
        if (!queryCourseId) return;
        const response = await cachedApiGet(
            `/students?course_id=${encodeURIComponent(queryCourseId)}`,
            { ttlMs: 60000 },
        ).catch(() => ({ data: { students: [] } }));
        const firstStudent = (response?.data?.students || [])
            .filter((student) => Array.isArray(student) && student[1])
            .sort((a, b) => String(a[0] || '').localeCompare(String(b[0] || '')))[0];
        if (firstStudent) setSelectedStudent(firstStudent[1]);
    }, [isStaff, setSelectedStudent]);

    useEffect(() => {
        if (!loggedIn || !permissionState.capabilities.hasKnownRole) return undefined;
        let mounted = true;
        setCoursesLoading(true);
        requestCourses(isStaff)
            .then((fetchedCourses) => {
                if (!mounted) return;
                setCourses(fetchedCourses);
                if (fetchedCourses.length === 0) {
                    setSelectedCourse('');
                    localStorage.removeItem('selectedCourseId');
                    window.dispatchEvent(new CustomEvent('selectedCourseChanged', { detail: { courseId: '' } }));
                    return;
                }

                const rememberedCourse = localStorage.getItem('selectedCourseId') || '';
                const hasRemembered = fetchedCourses.some(
                    (course) => String(course.id) === String(rememberedCourse),
                );
                const nextCourse = hasRemembered
                    ? String(rememberedCourse)
                    : String(fetchedCourses[0].id);
                setSelectedCourse(nextCourse);
                localStorage.setItem('selectedCourseId', nextCourse);
                window.dispatchEvent(new CustomEvent('selectedCourseChanged', { detail: { courseId: nextCourse } }));
                refreshPermissions(nextCourse, fetchedCourses);
                selectFirstStudentForCourse(nextCourse, fetchedCourses);
            })
            .catch((error) => {
                if (mounted) console.error('Failed to load courses in navigation:', error);
            })
            .finally(() => {
                if (mounted) setCoursesLoading(false);
            });
        return () => { mounted = false; };
    }, [
        isStaff,
        loggedIn,
        permissionState.capabilities.hasKnownRole,
        refreshPermissions,
        selectFirstStudentForCourse,
    ]);

    const handleCourseChange = useCallback((event) => {
        const nextCourse = String(event.target.value || '');
        setSelectedCourse(nextCourse);
        localStorage.setItem('selectedCourseId', nextCourse);
        window.dispatchEvent(new CustomEvent('selectedCourseChanged', { detail: { courseId: nextCourse } }));
        refreshPermissions(nextCourse, courses);
        selectFirstStudentForCourse(nextCourse, courses);
    }, [courses, refreshPermissions, selectFirstStudentForCourse]);

    const handleMenu = (event) => setAnchorEl(event.currentTarget);
    const handleClose = () => setAnchorEl(null);
    const navigateFromMenu = (href) => {
        handleClose();
        navigate(href);
    };
    const doLogout = () => {
        clearShellSession(localStorage);
        setLoginStatus(false);
        window.location.href = '/login';
    };

    const shellModel = useMemo(() => buildShellRenderModel({
        loggedIn,
        permissionState,
        pathname: location.pathname,
    }), [location.pathname, loggedIn, permissionState]);
    const courseControl = useMemo(
        () => getCourseControlModel(courses, selectedCourse),
        [courses, selectedCourse],
    );
    const navigationItems = useMemo(
        () => shellModel.navigation.sections.flatMap((section) => section.items),
        [shellModel.navigation.sections],
    );
    const userLabel = localStorage.getItem('name') || localStorage.getItem('email') || 'GradeView user';
    const permissionReady = permissionState.status === SHELL_PERMISSION_STATUS.READY;

    const accountMenu = (
        <Menu
            id="account-navigation-menu"
            anchorEl={anchorEl}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            open={Boolean(anchorEl)}
            onClose={handleClose}
            MenuListProps={{ 'aria-label': `${shellModel.navigation.personaLabel} navigation and account` }}
        >
            {mobileView && (
                <Box sx={{ px: 2, py: 1, maxWidth: 320 }}>
                    <Typography sx={{ color: '#6B7280', fontSize: 12 }}>Signed in as</Typography>
                    <Typography sx={{ color: '#111827', fontSize: 13.5, fontWeight: 750, overflowWrap: 'anywhere' }}>
                        {userLabel}
                    </Typography>
                    <Typography sx={{ mt: 0.5, color: '#4B5563', fontSize: 12.5 }}>
                        {shellModel.navigation.personaLabel}
                    </Typography>
                </Box>
            )}
            {mobileView && shellModel.navigation.reviewContext && (
                <NavMenuItem
                    icon={<ArrowBack />}
                    text="Return to Class Health"
                    onClick={() => navigateFromMenu('/admin')}
                />
            )}
            {mobileView && navigationItems.map((item) => (
                <NavMenuItem
                    key={item.name}
                    icon={navIcon(item, 20)}
                    text={item.name}
                    selected={isNavigationItemActive(item, location.pathname)}
                    onClick={() => navigateFromMenu(item.href)}
                />
            ))}
            {mobileView && navigationItems.length > 0 && <Divider />}
            {!mobileView && isStaff && (
                <NavMenuItem
                    icon={<SettingsIcon />}
                    text="Settings"
                    onClick={() => navigateFromMenu('/settings')}
                />
            )}
            <NavMenuItem icon={<Logout />} text="Logout" onClick={doLogout} />
        </Menu>
    );

    if (!mobileView) {
        return (
            <Box className="app-shell app-shell--desktop">
                <AppBar
                    component="header"
                    position="fixed"
                    className="app-shell-topbar"
                    sx={{
                        height: TOPBAR_HEIGHT,
                        bgcolor: '#FFFFFF',
                        borderBottom: '1px solid #DDE1E7',
                        zIndex: (theme) => theme.zIndex.drawer + 2,
                    }}
                >
                    <Toolbar disableGutters sx={{ minHeight: `${TOPBAR_HEIGHT}px !important`, px: 1.5, gap: 1.5 }}>
                        <Link
                            component={NavLink}
                            to="/"
                            color="inherit"
                            underline="none"
                            aria-label="GradeView home"
                            sx={{
                                width: loggedIn ? SIDEBAR_WIDTH - 20 : 'auto',
                                minHeight: 44,
                                display: 'inline-flex',
                                alignItems: 'center',
                                borderRadius: 1,
                                '&:focus-visible': { outline: '3px solid #2563EB', outlineOffset: 1 },
                            }}
                        >
                            <AccountTree aria-hidden="true" sx={{ mr: 1, fontSize: 20, color: '#4B5563' }} />
                            <Typography sx={{ color: '#374151', fontSize: 14, fontWeight: 800 }}>
                                GradeView
                            </Typography>
                        </Link>
                        <Box sx={{ flex: 1, minWidth: 0 }} />
                        {shellModel.showReadOnlyBanner && (
                            <ReadOnlyStatusChip isDemo={shellModel.showDemoBanner} />
                        )}
                        {loggedIn ? (
                            <>
                                <Button
                                    aria-label={`Open account menu for ${userLabel}`}
                                    aria-haspopup="menu"
                                    aria-expanded={Boolean(anchorEl) ? 'true' : undefined}
                                    onClick={handleMenu}
                                    sx={{
                                        minHeight: 44,
                                        maxWidth: 280,
                                        px: 1,
                                        gap: 1,
                                        color: '#374151',
                                        '&:focus-visible': { outline: '3px solid #2563EB', outlineOffset: 1 },
                                    }}
                                >
                                    <Avatar
                                        src={profilePicture}
                                        alt=""
                                        imgProps={{ referrerPolicy: 'no-referrer' }}
                                        sx={{ width: 28, height: 28 }}
                                    />
                                    <Typography noWrap title={userLabel} sx={{ minWidth: 0, maxWidth: 190, fontSize: 13.5, fontWeight: 700 }}>
                                        {userLabel}
                                    </Typography>
                                    <KeyboardArrowDown aria-hidden="true" sx={{ fontSize: 18 }} />
                                </Button>
                                {accountMenu}
                            </>
                        ) : (
                            <Button
                                component={NavLink}
                                to="/login"
                                variant="outlined"
                                startIcon={<LoginOutlined aria-hidden="true" />}
                                sx={{ minHeight: 44, '&:focus-visible': { outline: '3px solid #2563EB', outlineOffset: 1 } }}
                            >
                                Login
                            </Button>
                        )}
                    </Toolbar>
                </AppBar>

                {loggedIn && (
                    <AppBar
                        component="aside"
                        aria-label={`${shellModel.navigation.personaLabel} sidebar`}
                        position="fixed"
                        className="app-shell-sidebar"
                        sx={{
                            top: TOPBAR_HEIGHT,
                            left: 0,
                            right: 'auto',
                            width: SIDEBAR_WIDTH,
                            height: `calc(100dvh - ${TOPBAR_HEIGHT}px)`,
                            bgcolor: '#F8F9FA',
                            borderRight: '1px solid #DDE1E7',
                            borderBottom: 0,
                            zIndex: (theme) => theme.zIndex.drawer + 1,
                        }}
                    >
                        <Toolbar
                            disableGutters
                            sx={{
                                minHeight: '0 !important',
                                height: '100%',
                                flexDirection: 'column',
                                alignItems: 'stretch',
                                gap: 1.25,
                                px: 1.5,
                                py: 1.5,
                                overflowY: 'auto',
                                overflowX: 'hidden',
                            }}
                        >
                            {coursesLoading ? (
                                <Skeleton variant="rounded" height={52} />
                            ) : (
                                <CourseControl
                                    model={courseControl}
                                    onChange={handleCourseChange}
                                    controlId="desktop-course-selector"
                                />
                            )}
                            {shellModel.showReadOnlyBanner && (
                                <ReadOnlyNotice isDemo={shellModel.showDemoBanner} />
                            )}
                            <ReviewContext context={shellModel.navigation.reviewContext} />
                            {permissionState.status === SHELL_PERMISSION_STATUS.RESOLVING && (
                                <PermissionLoadingState />
                            )}
                            {permissionState.status === SHELL_PERMISSION_STATUS.ERROR && (
                                <Box role="alert" sx={{ p: 1.5, border: '1px solid #DC2626', borderRadius: 1.5, bgcolor: '#FEF2F2' }}>
                                    <Typography sx={{ color: '#7F1D1D', fontSize: 13, lineHeight: 1.45 }}>
                                        Navigation permissions are unavailable. Refresh the page to retry.
                                    </Typography>
                                </Box>
                            )}
                            {permissionReady && (
                                <Stack component="nav" aria-label={shellModel.navigation.personaLabel} spacing={1}>
                                    {shellModel.navigation.sections.map((section, index) => (
                                        <React.Fragment key={section.title}>
                                            {index > 0 && <Divider />}
                                            <SidebarSection section={section} pathname={location.pathname} />
                                        </React.Fragment>
                                    ))}
                                </Stack>
                            )}
                        </Toolbar>
                    </AppBar>
                )}
            </Box>
        );
    }

    return (
        <Box className="app-shell app-shell--mobile">
            <AppBar component="header" position="static" sx={{ bgcolor: '#FFFFFF', borderBottom: '1px solid #DDE1E7' }}>
                <Toolbar sx={{ minHeight: 64, gap: 1 }}>
                    <Link
                        component={NavLink}
                        to="/"
                        aria-label="GradeView home"
                        color="inherit"
                        underline="none"
                        sx={{
                            minWidth: 0,
                            minHeight: 44,
                            display: 'inline-flex',
                            alignItems: 'center',
                            flex: '1 1 auto',
                            borderRadius: 1,
                            '&:focus-visible': { outline: '3px solid #2563EB', outlineOffset: 1 },
                        }}
                    >
                        <AccountTree aria-hidden="true" sx={{ mr: 0.75, fontSize: 20, color: '#4B5563', flexShrink: 0 }} />
                        <Typography noWrap sx={{ color: '#374151', fontSize: 16, fontWeight: 800 }}>
                            GradeView
                        </Typography>
                    </Link>
                    {shellModel.showReadOnlyBanner && (
                        <ReadOnlyStatusChip isDemo={shellModel.showDemoBanner} />
                    )}
                    {loggedIn ? (
                        <>
                            <IconButton
                                aria-label={`Open navigation and account menu for ${userLabel}`}
                                aria-haspopup="menu"
                                aria-expanded={Boolean(anchorEl) ? 'true' : undefined}
                                onClick={handleMenu}
                                sx={{
                                    width: 44,
                                    height: 44,
                                    flexShrink: 0,
                                    '&:focus-visible': { outline: '3px solid #2563EB', outlineOffset: 1 },
                                }}
                            >
                                <Avatar src={profilePicture} alt="" sx={{ width: 30, height: 30 }} />
                            </IconButton>
                            {accountMenu}
                        </>
                    ) : (
                        <Button
                            component={NavLink}
                            to="/login"
                            startIcon={<LoginOutlined aria-hidden="true" />}
                            sx={{ minHeight: 44, flexShrink: 0 }}
                        >
                            Login
                        </Button>
                    )}
                </Toolbar>
                {loggedIn && (
                    <Stack spacing={1} sx={{ px: 2, pb: 1.5 }}>
                        {coursesLoading ? (
                            <Skeleton variant="rounded" height={52} />
                        ) : (
                            <CourseControl
                                model={courseControl}
                                onChange={handleCourseChange}
                                controlId="mobile-course-selector"
                            />
                        )}
                        {shellModel.showReadOnlyBanner && (
                            <ReadOnlyNotice isDemo={shellModel.showDemoBanner} compact />
                        )}
                        <ReviewContext context={shellModel.navigation.reviewContext} compact />
                        {permissionState.status === SHELL_PERMISSION_STATUS.RESOLVING && (
                            <PermissionLoadingState />
                        )}
                    </Stack>
                )}
            </AppBar>
        </Box>
    );
}
