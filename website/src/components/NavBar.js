import React, { useContext, useEffect, useMemo, useState } from 'react';
import {
    AppBar,
    Avatar,
    Box,
    Button,
    Divider,
    FormControl,
    IconButton,
    Link,
    Menu,
    MenuItem,
    Select,
    Stack,
    Toolbar,
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
import MenuIcon from '@mui/icons-material/Menu';
import { NavLink, useLocation } from 'react-router-dom';
import { cachedApiGet } from '../utils/apiCache';
import NavMenuItem from './NavMenuItem';
import { StudentSelectionContext } from './StudentSelectionWrapper';

const SIDEBAR_WIDTH = 244;
const TOPBAR_HEIGHT = 42;

function SidebarNavItem({ href, icon, text, active, indent = false }) {
    return (
        <Link component={NavLink} to={href} color="inherit" underline="none">
            <Button
                fullWidth
                startIcon={React.cloneElement(icon, { sx: { fontSize: indent ? 15 : 17 } })}
                sx={{
                    justifyContent: 'flex-start',
                    minHeight: indent ? 30 : 34,
                    px: 1,
                    pl: indent ? 1.5 : 1,
                    borderRadius: 1,
                    color: active ? '#111827' : '#737780',
                    backgroundColor: active ? '#E6E7E9' : 'transparent',
                    fontSize: indent ? 12.5 : 13,
                    fontWeight: active ? 700 : 600,
                    lineHeight: 1.25,
                    '& .MuiButton-startIcon': {
                        mr: 0.9,
                        color: active ? '#111827' : '#8B9099',
                    },
                    '&:hover': {
                        backgroundColor: active ? '#E1E3E6' : '#F0F1F3',
                        color: '#111827',
                        '& .MuiButton-startIcon': {
                            color: '#111827',
                        },
                    },
                }}
            >
                <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {text}
                </Box>
            </Button>
        </Link>
    );
}

function SidebarSection({ title, items, isRouteActive }) {
    if (!items.length) return null;

    return (
        <Box>
            <Typography sx={{ px: 0.75, mb: 0.45, color: '#A0A4AC', fontSize: 10, fontWeight: 800 }}>
                {title}
            </Typography>
            <Stack spacing={0.15}>
                {items.map((item) => (
                    <SidebarNavItem
                        key={item.name}
                        href={item.href}
                        icon={item.icon}
                        text={item.name}
                        active={isRouteActive(item)}
                        indent={item.indent}
                    />
                ))}
            </Stack>
        </Box>
    );
}

export default function ButtonAppBar() {
    const mobileView = useMediaQuery('(max-width:900px)');
    const location = useLocation();
    const [loggedIn, setLoginStatus] = useState(
        !!localStorage.getItem('token'),
    );
    const { setSelectedStudent } = useContext(StudentSelectionContext);
    const [isAdmin, setAdminStatus] = useState(false);
    const [profilePicture, updateProfilePicture] = useState('');
    const [anchorEl, setAnchorEl] = useState(null);

    const navSections = useMemo(() => {
        const studentItems = loggedIn ? [
            { name: 'Workspace', href: '/profile', icon: <DashboardOutlined />, exact: true, indent: true },
            {
                name: 'Report',
                href: '/profile/report',
                icon: <ArticleOutlined />,
                indent: true,
                match: (pathname) => pathname === '/profile/report' || /^\/students\/[^/]+\/report$/.test(pathname),
            },
            { name: 'Attendance', href: '/profile/attendance', icon: <EventAvailableOutlined />, exact: true, indent: true },
            { name: 'Labs', href: '/profile/labs', icon: <ScienceOutlined />, exact: true, indent: true },
            { name: 'Projects', href: '/profile/projects', icon: <WorkOutlineOutlined />, exact: true, indent: true },
            { name: 'Exams', href: '/profile/exams', icon: <QuizOutlined />, indent: true },
            { name: 'Assignments', href: '/profile/assignments', icon: <AssignmentOutlined />, exact: true, indent: true },
            { name: 'Explain Score', href: '/profile/explain', icon: <HelpOutlineOutlined />, exact: true, indent: true },
            { name: 'Concepts', href: '/profile/concepts', icon: <SchoolOutlined />, exact: true, indent: true },
            { name: 'Policy', href: '/profile/policy', icon: <PolicyOutlined />, exact: true, indent: true },
        ] : [];

        const adminItems = isAdmin ? [
            { name: 'Class Health', href: '/admin', icon: <AdminPanelSettingsOutlined /> },
            { name: 'Grade Sync', href: '/gradesync', icon: <SyncOutlined /> },
            { name: 'Alerts', href: '/alerts', icon: <WarningAmberOutlined /> },
            { name: 'Settings', href: '/settings', icon: <SettingsIcon /> },
        ] : [];

        return [
            { title: 'STUDENT', items: studentItems },
            { title: 'ADMIN', items: adminItems },
        ].filter((section) => section.items.length > 0);
    }, [isAdmin, loggedIn]);

    const navigationItems = useMemo(() => (
        navSections.flatMap((section) => section.items)
    ), [navSections]);

    const isRouteActive = (item) => {
        if (typeof item.match === 'function') return item.match(location.pathname);
        if (item.href === '/') return location.pathname === '/';
        if (item.exact) return location.pathname === item.href;
        return location.pathname === item.href || location.pathname.startsWith(`${item.href}/`);
    };

    function renderMenuItems() {
        return navigationItems.map((tab) => (
            <NavMenuItem
                key={tab.name}
                icon={tab.icon}
                text={tab.name}
                onClick={() => {
                    window.location.href = tab.href;
                }}
            />
        ));
    }

    useEffect(() => {
        let mounted = true;
        if (loggedIn) {
            updateProfilePicture(localStorage.getItem('profilepicture'));

            refreshPermissions()
                .then((res) => {
                    if (mounted) {
                        const role = res?.role || res?.data?.role;
                        const permissions = res?.permissions || res?.data?.permissions || {};
                        setAdminStatus(
                            ['super_admin', 'course_admin', 'instructor'].includes(role)
                                || permissions.is_super === true
                                || permissions.has_course_admin === true
                                || permissions.has_instructor === true,
                        );
                    }
                })
                .catch((err) => {
                    console.error("Failed to refresh permissions.", err);
                    if (mounted) {
                        setAdminStatus(false);
                    }
                });
        } else {
            setAdminStatus(false);
        }
        return () => { mounted = false; };
    }, [loggedIn]);

    function handleMenu(e) {
        setAnchorEl(e.currentTarget);
    }
    function handleClose() {
        setAnchorEl(null);
    }
    function doLogout() {
        localStorage.setItem('token', '');
        localStorage.setItem('email', '');
        setLoginStatus(false);
        window.location.reload(false);
    }

    const [courses, setCourses] = useState([]);
    const [selectedCourse, setSelectedCourse] = useState(
        localStorage.getItem('selectedCourseId') || '',
    );

    const formatCourseLabel = (course) => {
        const year = String(course?.year || '').trim();
        const semester = String(course?.semester || '').trim();
        const name = String(course?.name || '').trim();
        const pieces = [year, semester, name].filter(Boolean);
        if (pieces.length > 0) {
            return pieces.join(' ');
        }
        return String(course?.id || course?.gradescope_course_id || 'Course').trim();
    };

    const normalizeCourseList = (list) => {
        const items = Array.isArray(list) ? list : [];
        const merged = new Map();
        items.forEach((course) => {
            const key = String(course?.gradescope_course_id || course?.id || '').trim();
            if (!key) return;
            if (!merged.has(key)) {
                merged.set(key, { ...course, id: String(course.id) });
            }
        });
        return Array.from(merged.values());
    };

    const resolveCourseQueryId = (courseId, courseList = courses) => {
        const matchedCourse = courseList.find((course) => String(course.id) === String(courseId));
        return matchedCourse?.gradescope_course_id || courseId;
    };

    const refreshPermissions = async (courseId = '', courseList = courses) => {
        const queryCourseId = courseId ? resolveCourseQueryId(courseId, courseList) : '';
        const suffix = queryCourseId ? `?course_id=${encodeURIComponent(queryCourseId)}` : '';
        const res = await cachedApiGet(`/me/permissions${suffix}`, { ttlMs: 30000 });
        const token = res?.data?.token;
        if (token) {
            localStorage.setItem('token', token);
        }
        return res?.data || {};
    };

    const selectFirstStudentForCourse = async (courseId, courseList = courses) => {
        if (!isAdmin || !courseId) return;
        const queryCourseId = resolveCourseQueryId(courseId, courseList);
        if (!queryCourseId) return;

        const studentsRes = await cachedApiGet(`/students?course_id=${encodeURIComponent(queryCourseId)}`, { ttlMs: 60000 }).catch(() => ({
            data: { students: [] },
        }));
        const sortedStudents = (studentsRes?.data?.students || [])
            .filter((student) => Array.isArray(student) && student[1])
            .sort((a, b) => String(a[0] || '').localeCompare(String(b[0] || '')));

        if (sortedStudents.length > 0) {
            setSelectedStudent(sortedStudents[0][1]);
        }
    };

    const fetchCourses = async () => {
        if (!isAdmin) {
            const studentRes = await cachedApiGet('/students/courses', { ttlMs: 60000 }).catch(() => ({
                data: { courses: [] },
            }));
            return normalizeCourseList(studentRes?.data?.courses || []);
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
    };

    useEffect(() => {
        let mounted = true;
        if (!loggedIn) {
            setCourses([]);
            return () => (mounted = false);
        }

        fetchCourses()
            .then((fetchedCourses) => {
                if (!mounted) return;

                setCourses(fetchedCourses);

                if (fetchedCourses.length === 0) {
                    setSelectedCourse('');
                    localStorage.removeItem('selectedCourseId');
                    window.dispatchEvent(new CustomEvent('selectedCourseChanged', {
                        detail: { courseId: '' },
                    }));
                    return;
                }

                const rememberedCourse = localStorage.getItem('selectedCourseId') || selectedCourse;
                const hasSelected = fetchedCourses.some((course) => String(course.id) === String(rememberedCourse));
                const nextCourse = hasSelected ? String(rememberedCourse) : String(fetchedCourses[0].id);

                setSelectedCourse(nextCourse);
                localStorage.setItem('selectedCourseId', nextCourse);
                window.dispatchEvent(new CustomEvent('selectedCourseChanged', {
                    detail: { courseId: nextCourse },
                }));

                refreshPermissions(nextCourse, fetchedCourses).catch((err) => {
                    console.error('Failed to refresh permissions for selected course:', err);
                });
                selectFirstStudentForCourse(nextCourse, fetchedCourses);
            })
            .catch((err) => {
                console.error('Failed to load courses in navbar:', err);
                if (mounted) {
                    setCourses([]);
                }
            });

        return () => (mounted = false);
    }, [isAdmin, loggedIn, setSelectedStudent]);

    const handleCourseChange = (event) => {
        const nextCourse = event.target.value;
        setSelectedCourse(nextCourse);
        localStorage.setItem('selectedCourseId', nextCourse);
        window.dispatchEvent(new CustomEvent('selectedCourseChanged', {
            detail: { courseId: nextCourse },
        }));
        refreshPermissions(nextCourse).catch((err) => {
            console.error('Failed to refresh permissions for selected course:', err);
        });
        selectFirstStudentForCourse(nextCourse);
    };

    const courseSelect = courses.length > 0 && (
        <FormControl size="small" fullWidth>
            <Select
                value={selectedCourse}
                displayEmpty
                onChange={handleCourseChange}
                IconComponent={KeyboardArrowDown}
                sx={{
                    borderRadius: 1,
                    backgroundColor: '#FFFFFF',
                    fontSize: 14,
                    fontWeight: 700,
                    color: '#111827',
                    '& .MuiSelect-select': {
                        py: 1,
                        pl: 1.25,
                        pr: '32px !important',
                    },
                    '& .MuiOutlinedInput-notchedOutline': {
                        borderColor: '#EDEFF3',
                    },
                    '&:hover .MuiOutlinedInput-notchedOutline': {
                        borderColor: '#D8DCE3',
                    },
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                        borderColor: '#D1D5DB',
                    },
                }}
            >
                {courses.map((course) => (
                    <MenuItem key={course.id} value={course.id}>
                        {formatCourseLabel(course)}
                    </MenuItem>
                ))}
            </Select>
        </FormControl>
    );

    const userLabel = localStorage.getItem('name') || localStorage.getItem('email') || 'Personal';

    if (!mobileView) {
        return (
            <>
                <AppBar
                    component="header"
                    position="fixed"
                    sx={{
                        top: 0,
                        left: 0,
                        right: 0,
                        height: TOPBAR_HEIGHT,
                        backgroundColor: '#FFFFFF',
                        borderBottom: '1px solid #ECEEF2',
                        zIndex: (theme) => theme.zIndex.drawer + 2,
                    }}
                >
                    <Toolbar
                        disableGutters
                        sx={{
                            minHeight: `${TOPBAR_HEIGHT}px !important`,
                            height: TOPBAR_HEIGHT,
                            px: 1.5,
                            gap: 1.5,
                        }}
                    >
                        <Link href="/" color="inherit" underline="none">
                            <Stack
                                direction="row"
                                alignItems="center"
                                spacing={0.9}
                                sx={{
                                    width: SIDEBAR_WIDTH - 18,
                                    height: TOPBAR_HEIGHT,
                                    color: '#5F636B',
                                }}
                            >
                                <AccountTree sx={{ fontSize: 17, color: '#777B84' }} />
                                <Typography sx={{ fontSize: 13, fontWeight: 750, color: '#5F636B', letterSpacing: 0 }}>
                                    GradeView
                                </Typography>
                            </Stack>
                        </Link>

                        <Box sx={{ flex: 1 }} />

                        {loggedIn ? (
                            <>
                                <Button
                                    onClick={handleMenu}
                                    sx={{
                                        minHeight: 30,
                                        px: 0.75,
                                        py: 0.35,
                                        gap: 0.8,
                                        borderRadius: 1,
                                        color: '#5F636B',
                                        fontSize: 13,
                                        fontWeight: 650,
                                        '&:hover': { backgroundColor: '#F4F5F7' },
                                    }}
                                >
                                    <Avatar
                                        src={profilePicture}
                                        imgProps={{ referrerPolicy: 'no-referrer' }}
                                        sx={{ width: 22, height: 22 }}
                                    />
                                    <Typography noWrap sx={{ maxWidth: 180, fontSize: 13, fontWeight: 650, color: '#5F636B' }}>
                                        {userLabel}
                                    </Typography>
                                    <KeyboardArrowDown sx={{ fontSize: 16, color: '#9CA3AF' }} />
                                </Button>
                                <Menu
                                    id="loggedInMenu"
                                    anchorEl={anchorEl}
                                    anchorOrigin={{
                                        vertical: 'bottom',
                                        horizontal: 'right',
                                    }}
                                    keepMounted
                                    transformOrigin={{
                                        vertical: 'top',
                                        horizontal: 'right',
                                    }}
                                    open={Boolean(anchorEl)}
                                    onClose={handleClose}
                                >
                                    {isAdmin && (
                                        <NavMenuItem
                                            icon={<SettingsIcon />}
                                            text="Settings"
                                            onClick={() => {
                                                window.location.href = '/settings';
                                            }}
                                        />
                                    )}
                                    <NavMenuItem
                                        icon={<Logout />}
                                        text="Logout"
                                        onClick={doLogout}
                                    />
                                </Menu>
                            </>
                        ) : (
                            <Link href="/login" color="inherit" underline="none">
                                <Button
                                    variant="outlined"
                                    startIcon={<LoginOutlined />}
                                    sx={{ minHeight: 30, px: 1.25, py: 0.35, fontSize: 13 }}
                                >
                                    Login
                                </Button>
                            </Link>
                        )}
                    </Toolbar>
                </AppBar>

                <AppBar
                    component="aside"
                    position="fixed"
                    sx={{
                        top: TOPBAR_HEIGHT,
                        left: 0,
                        right: 'auto',
                        width: SIDEBAR_WIDTH,
                        height: `calc(100vh - ${TOPBAR_HEIGHT}px)`,
                        backgroundColor: '#FBFBFC',
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
                        {loggedIn && courseSelect && (
                            <Box sx={{ mb: 1.25 }}>
                                {courseSelect}
                            </Box>
                        )}

                        <Stack component="nav" spacing={0.25} sx={{ mt: loggedIn && courseSelect ? 0 : 0.5 }}>
                            {navSections.map((section, index) => (
                                <React.Fragment key={section.title}>
                                    {index > 0 && <Divider sx={{ my: 1.05, borderColor: '#ECEEF2' }} />}
                                    <SidebarSection
                                        title={section.title}
                                        items={section.items}
                                        isRouteActive={isRouteActive}
                                    />
                                </React.Fragment>
                            ))}
                        </Stack>
                    </Toolbar>
                </AppBar>
            </>
        );
    }

    return (
        <Box sx={{ flexGrow: 1 }}>
            <AppBar position="static">
                <Toolbar sx={{ minHeight: 58 }}>
                    <Box sx={{ flexGrow: 1, gap: 1.5 }} display="flex" alignItems="center">
                        <Typography
                            variant="h6"
                            component="div"
                            display="inline-block"
                            sx={{ fontSize: 17, fontWeight: 750, color: '#5F636B' }}
                        >
                            <a
                                href="/"
                                style={{
                                    textDecoration: 'none',
                                    color: 'inherit',
                                }}
                            >
                                GradeView
                            </a>
                        </Typography>
                    </Box>
                    {loggedIn ? (
                        <>
                            {courseSelect && (
                                <Box sx={{ minWidth: { xs: 150, sm: 220 }, mr: 1 }}>
                                    {courseSelect}
                                </Box>
                            )}
                            <IconButton
                                aria-label="user profile"
                                onClick={handleMenu}
                            >
                                <Avatar
                                    src={profilePicture}
                                    imgProps={{ referrerPolicy: 'no-referrer' }}
                                />
                            </IconButton>
                            <Menu
                                id="loggedInMenu"
                                anchorEl={anchorEl}
                                anchorOrigin={{
                                    vertical: 'top',
                                    horizontal: 'right',
                                }}
                                keepMounted
                                transformOrigin={{
                                    vertical: 'top',
                                    horizontal: 'right',
                                }}
                                open={Boolean(anchorEl)}
                                onClose={handleClose}
                            >
                                {renderMenuItems()}
                                {isAdmin && (
                                    <NavMenuItem
                                        icon={<SettingsIcon />}
                                        text="Settings"
                                        onClick={() => {
                                            window.location.href = '/settings';
                                        }}
                                    />
                                )}
                                <NavMenuItem
                                    icon={<Logout />}
                                    text="Logout"
                                    onClick={doLogout}
                                />
                            </Menu>
                        </>
                    ) : (
                        <>
                            <IconButton
                                onClick={handleMenu}
                                color="inherit"
                            >
                                <MenuIcon />
                            </IconButton>
                            <Menu
                                id="loggedInMenuMobile"
                                anchorEl={anchorEl}
                                anchorOrigin={{
                                    vertical: 'top',
                                    horizontal: 'right',
                                }}
                                keepMounted
                                transformOrigin={{
                                    vertical: 'top',
                                    horizontal: 'right',
                                }}
                                open={Boolean(anchorEl)}
                                onClose={handleClose}
                            >
                                <NavMenuItem
                                    icon={<LoginOutlined />}
                                    text="Login"
                                    onClick={() => {
                                        window.location.href = '/login';
                                    }}
                                />
                                {renderMenuItems()}
                            </Menu>
                        </>
                    )}
                </Toolbar>
            </AppBar>
        </Box>
    );
}
