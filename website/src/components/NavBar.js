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
    Link,
    ListSubheader,
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
    getStudentReviewContext,
    isNavigationItemActive,
    normalizeCourseList,
    parseStoredPermissions,
    permissionStateReducer,
    resolveCourseQueryId,
} from '../utils/personaNavigation';
import {
    getStudentRouteCourseId,
    resolveCourseSelection,
} from '../utils/studentRoutes';
import NavMenuItem from './NavMenuItem';
import Footer from './Footer';
import { StudentSelectionContext } from './StudentSelectionWrapper';

const SIDEBAR_WIDTH = 244;
const TOPBAR_HEIGHT = 42;

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
    students: <SchoolOutlined />,
    'ai-analytics': <AdminPanelSettingsOutlined />,
    'grade-sync': <SyncOutlined />,
    alerts: <WarningAmberOutlined />,
    settings: <SettingsIcon />,
    'select-student': <SchoolOutlined />,
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
            startIcon={navIcon(item, item.indent ? 15 : 17)}
            aria-current={active ? 'page' : undefined}
            sx={{
                justifyContent: 'flex-start',
                minHeight: item.indent ? 30 : 34,
                px: 1,
                pl: item.indent ? 1.5 : 1,
                borderRadius: 1,
                color: active ? '#111827' : '#737780',
                backgroundColor: active ? '#E6E7E9' : 'transparent',
                fontSize: item.indent ? 12.5 : 13,
                fontWeight: active ? 700 : 600,
                lineHeight: 1.25,
                '& .MuiButton-startIcon': {
                    mr: 0.9,
                    color: active ? '#111827' : '#8B9099',
                },
                '&:hover': {
                    backgroundColor: active ? '#E1E3E6' : '#F0F1F3',
                    color: '#111827',
                    '& .MuiButton-startIcon': { color: '#111827' },
                },
                '&:focus-visible': {
                    outline: '3px solid #2563EB',
                    outlineOffset: 1,
                },
            }}
        >
            <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.name}
            </Box>
        </Button>
    );
}

function SidebarSection({ section, pathname, search }) {
    return (
        <Box>
            <Typography
                component="h2"
                sx={{ px: 0.75, mb: 0.45, color: '#A0A4AC', fontSize: 10, fontWeight: 800 }}
            >
                {section.title}
            </Typography>
            {section.description && (
                <Typography
                    sx={{ px: 0.75, mb: 0.65, color: '#737780', fontSize: 11.5, lineHeight: 1.35 }}
                >
                    {section.description}
                </Typography>
            )}
            <Stack spacing={0.15}>
                {section.items.map((item) => (
                    <SidebarNavItem
                        key={item.name}
                        item={{ ...item, indent: section.title === 'STUDENT' }}
                        active={isNavigationItemActive(item, pathname, search)}
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
                    height: 24,
                    bgcolor: '#FEF3C7',
                    color: '#713F12',
                    border: '1px solid #D97706',
                    fontSize: 11.5,
                    fontWeight: 750,
                    '& .MuiChip-icon': { color: '#92400E' },
                }}
            />
        </Tooltip>
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
                        alignItems: 'center',
                        gap: 0.9,
                        minHeight: 34,
                        px: 1,
                        py: 0.5,
                        border: '1px solid #EDEFF3',
                        borderRadius: 1,
                        bgcolor: '#FFFFFF',
                    }}
                >
                    <SchoolOutlined aria-hidden="true" sx={{ fontSize: 17, color: '#8B9099', flexShrink: 0 }} />
                    <Typography
                        title={model.label}
                        sx={{ minWidth: 0, color: '#111827', fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                        {model.label}
                    </Typography>
                </Box>
            </Tooltip>
        );
    }

    return (
        <FormControl size="small" fullWidth>
            <Select
                id={controlId}
                inputProps={{ 'aria-label': 'Current course' }}
                value={model.value}
                onChange={onChange}
                IconComponent={KeyboardArrowDown}
                renderValue={() => (
                    <Typography noWrap title={model.label} sx={{ fontSize: 13, fontWeight: 700, lineHeight: 1.25 }}>
                        {model.label}
                    </Typography>
                )}
                sx={{
                    minHeight: 34,
                    bgcolor: '#FFFFFF',
                    color: '#111827',
                    '& .MuiSelect-select': {
                        minHeight: '0 !important',
                        py: '7px',
                        pl: 1.25,
                        pr: '32px !important',
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
                        sx={{ minHeight: 40, maxWidth: 420, whiteSpace: 'normal', overflowWrap: 'anywhere' }}
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
            <Skeleton variant="rounded" height={30} sx={{ mb: 0.5 }} />
            <Skeleton variant="rounded" height={30} sx={{ mb: 0.5 }} />
            <Skeleton variant="rounded" height={30} />
        </Box>
    );
}

export default function ButtonAppBar() {
    const mobileView = useMediaQuery('(max-width:900px)');
    const location = useLocation();
    const navigate = useNavigate();
    const reviewRouteContext = useMemo(
        () => getStudentReviewContext(location.pathname),
        [location.pathname],
    );
    const reviewRouteStudentIdentifier = reviewRouteContext?.identifier || '';
    const reviewRouteCourseId = reviewRouteContext
        ? getStudentRouteCourseId(location.search)
        : '';
    const { selectedStudent, setSelectedStudent } = useContext(StudentSelectionContext);
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
        if (!isStaff || !courseId || reviewRouteStudentIdentifier) return;
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
    }, [isStaff, reviewRouteStudentIdentifier, setSelectedStudent]);

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
                const routeCourse = reviewRouteCourseId
                    ? resolveCourseSelection(reviewRouteCourseId, fetchedCourses)
                    : '';
                const hasRemembered = fetchedCourses.some(
                    (course) => String(course.id) === String(rememberedCourse),
                );
                const nextCourse = reviewRouteCourseId
                    ? routeCourse
                    : hasRemembered
                        ? String(rememberedCourse)
                        : String(fetchedCourses[0].id);
                if (!nextCourse) {
                    setSelectedCourse('');
                    localStorage.removeItem('selectedCourseId');
                    return;
                }
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
        reviewRouteCourseId,
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
        navigate('/login', { replace: true });
    };

    const navigationCourseId = reviewRouteCourseId
        || resolveCourseQueryId(selectedCourse, courses);
    const shellModel = useMemo(() => buildShellRenderModel({
        loggedIn,
        permissionState,
        pathname: location.pathname,
        selectedStudentIdentifier: selectedStudent,
        courseId: navigationCourseId,
    }), [
        location.pathname,
        loggedIn,
        navigationCourseId,
        permissionState,
        selectedStudent,
    ]);
    const courseControl = useMemo(
        () => getCourseControlModel(courses, selectedCourse),
        [courses, selectedCourse],
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
            {mobileView && shellModel.navigation.sections.map((section, index) => (
                <React.Fragment key={section.title}>
                    {index > 0 && <Divider />}
                    <ListSubheader
                        disableSticky
                        component="li"
                        role="presentation"
                        sx={{ px: 2, pt: 1, pb: section.description ? 0.75 : 0.4, lineHeight: 1.35, bgcolor: '#FFFFFF' }}
                    >
                        <Typography sx={{ color: '#A0A4AC', fontSize: 10, fontWeight: 800 }}>
                            {section.title}
                        </Typography>
                        {section.description && (
                            <Typography sx={{ mt: 0.4, maxWidth: 280, color: '#737780', fontSize: 11.5, lineHeight: 1.35, whiteSpace: 'normal' }}>
                                {section.description}
                            </Typography>
                        )}
                    </ListSubheader>
                    {section.items.map((item) => (
                        <NavMenuItem
                            key={`${section.title}-${item.name}`}
                            icon={navIcon(item, 20)}
                            text={item.name}
                            selected={isNavigationItemActive(item, location.pathname, location.search)}
                            onClick={() => navigateFromMenu(item.href)}
                        />
                    ))}
                </React.Fragment>
            ))}
            {mobileView && shellModel.navigation.sections.length > 0 && <Divider />}
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
                        borderBottom: '1px solid #ECEEF2',
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
                                width: loggedIn ? SIDEBAR_WIDTH - 18 : 'auto',
                                height: TOPBAR_HEIGHT,
                                display: 'inline-flex',
                                alignItems: 'center',
                                borderRadius: 1,
                                '&:focus-visible': { outline: '3px solid #2563EB', outlineOffset: 1 },
                            }}
                        >
                            <AccountTree aria-hidden="true" sx={{ mr: 0.9, fontSize: 17, color: '#777B84' }} />
                            <Typography sx={{ color: '#5F636B', fontSize: 13, fontWeight: 750 }}>
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
                                        minHeight: 30,
                                        maxWidth: 280,
                                        px: 0.75,
                                        py: 0.35,
                                        gap: 0.8,
                                        borderRadius: 1,
                                        color: '#5F636B',
                                        '&:hover': { bgcolor: '#F4F5F7' },
                                        '&:focus-visible': { outline: '3px solid #2563EB', outlineOffset: 1 },
                                    }}
                                >
                                    <Avatar
                                        src={profilePicture}
                                        alt=""
                                        imgProps={{ referrerPolicy: 'no-referrer' }}
                                        sx={{ width: 22, height: 22 }}
                                    />
                                    <Typography noWrap title={userLabel} sx={{ minWidth: 0, maxWidth: 180, fontSize: 13, fontWeight: 650, color: '#5F636B' }}>
                                        {userLabel}
                                    </Typography>
                                    <KeyboardArrowDown aria-hidden="true" sx={{ fontSize: 16, color: '#9CA3AF' }} />
                                </Button>
                                {accountMenu}
                            </>
                        ) : (
                            <Button
                                component={NavLink}
                                to="/login"
                                variant="outlined"
                                startIcon={<LoginOutlined aria-hidden="true" />}
                                sx={{ minHeight: 30, px: 1.25, py: 0.35, fontSize: 13, '&:focus-visible': { outline: '3px solid #2563EB', outlineOffset: 1 } }}
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
                            bgcolor: '#FBFBFC',
                            borderRight: '1px solid #ECEEF2',
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
                                px: 1.25,
                                py: 1,
                                overflowY: 'auto',
                                overflowX: 'hidden',
                            }}
                        >
                            <Box sx={{ mb: 1.25 }}>
                                {coursesLoading ? (
                                    <Skeleton variant="rounded" height={34} />
                                ) : (
                                    <CourseControl
                                        model={courseControl}
                                        onChange={handleCourseChange}
                                        controlId="desktop-course-selector"
                                    />
                                )}
                            </Box>
                            {permissionState.status === SHELL_PERMISSION_STATUS.RESOLVING && (
                                <PermissionLoadingState />
                            )}
                            {permissionState.status === SHELL_PERMISSION_STATUS.ERROR && (
                                <Box role="alert" sx={{ p: 1, border: '1px solid #DC2626', borderRadius: 1, bgcolor: '#FEF2F2' }}>
                                    <Typography sx={{ color: '#7F1D1D', fontSize: 12, lineHeight: 1.4 }}>
                                        Navigation permissions are unavailable. Refresh the page to retry.
                                    </Typography>
                                </Box>
                            )}
                            {permissionReady && (
                                <Stack component="nav" aria-label={shellModel.navigation.personaLabel} spacing={0.25}>
                                    {shellModel.navigation.sections.map((section, index) => (
                                        <React.Fragment key={section.title}>
                                            {index > 0 && <Divider sx={{ my: 1.05, borderColor: '#ECEEF2' }} />}
                                            <SidebarSection
                                                section={section}
                                                pathname={location.pathname}
                                                search={location.search}
                                            />
                                        </React.Fragment>
                                    ))}
                                </Stack>
                            )}
                            <Footer />
                        </Toolbar>
                    </AppBar>
                )}
            </Box>
        );
    }

    return (
        <Box className="app-shell app-shell--mobile">
            <AppBar component="header" position="static" sx={{ bgcolor: '#FFFFFF', borderBottom: '1px solid #ECEEF2' }}>
                <Toolbar sx={{ minHeight: 58, gap: 1 }}>
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
                        <AccountTree aria-hidden="true" sx={{ mr: 0.75, fontSize: 18, color: '#777B84', flexShrink: 0 }} />
                        <Typography noWrap sx={{ color: '#5F636B', fontSize: 15, fontWeight: 750 }}>
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
                    <Stack spacing={0.75} sx={{ px: 2, pb: 1 }}>
                        {coursesLoading ? (
                            <Skeleton variant="rounded" height={34} />
                        ) : (
                            <CourseControl
                                model={courseControl}
                                onChange={handleCourseChange}
                                controlId="mobile-course-selector"
                            />
                        )}
                        {permissionState.status === SHELL_PERMISSION_STATUS.RESOLVING && (
                            <PermissionLoadingState />
                        )}
                    </Stack>
                )}
            </AppBar>
        </Box>
    );
}
