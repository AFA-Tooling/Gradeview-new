import React from 'react';
import { useContext, useEffect, useState } from 'react';
import {
    AppBar,
    Box,
    Toolbar,
    Typography,
    Button,
    Link,
    Avatar,
    Menu,
    MenuItem,
    IconButton,
    useMediaQuery,
    FormControl,
    Select,
} from '@mui/material';
import {
    LoginOutlined,
    StorageOutlined,
    AccountCircleOutlined,
    AccountTree,
    Warning,
    Logout,
    Settings as SettingsIcon,
} from '@mui/icons-material';
import MenuIcon from '@mui/icons-material/Menu';
import apiv2 from '../utils/apiv2';
import NavBarItem from './NavBarItem';
import NavMenuItem from './NavMenuItem';
import { StudentSelectionContext } from './StudentSelectionWrapper';

export default function ButtonAppBar() {
    const mobileView = useMediaQuery('(max-width:600px)');
    const [loggedIn, setLoginStatus] = useState(
        !!localStorage.getItem('token'),
    );
    const { setSelectedStudent } = useContext(StudentSelectionContext);
    const [isAdmin, setAdminStatus] = useState(false);
    const [profilePicture, updateProfilePicture] = useState('');
    const tabList = [
        {
            name: 'Profile',
            href: '/profile',
            icon: <AccountCircleOutlined />,
        },
    ];
    const [tabs, updateTabs] = useState(tabList.slice(1));
    const [anchorEl, setAnchorEl] = useState(null);

    useEffect(() => {
        let mounted = true;
        if (loggedIn) {
            updateTabs(tabList);
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
            // Ensure user is not admin if not logged in
            setAdminStatus(false);
        }
        return () => { mounted = false; };
    }, [loggedIn]);

    function renderMenuItems() {
        // Start with base tabs for all logged-in users
        const menuItems = [...tabs];
        
        // If admin, add admin-specific tabs
        if (isAdmin) {
            menuItems.push(
                { name: 'Grade Sync', href: '/gradesync', icon: <StorageOutlined /> },
                { name: 'Admin', href: '/admin', icon: <AccountTree /> },
                { name: 'Alerts', href: '/alerts', icon: <Warning /> }
            );
        }

        return menuItems.map((tab) => (
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

    // Set up handlers for user menu
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
        const res = await apiv2.get(`/me/permissions${suffix}`);
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

        const studentsRes = await apiv2.get(`/students?course_id=${encodeURIComponent(queryCourseId)}`);
        const sortedStudents = (studentsRes?.data?.students || [])
            .filter((student) => Array.isArray(student) && student[1])
            .sort((a, b) => String(a[0] || '').localeCompare(String(b[0] || '')));

        if (sortedStudents.length > 0) {
            setSelectedStudent(sortedStudents[0][1]);
        }
    };

    const fetchCourses = async () => {
        if (!isAdmin) {
            const studentRes = await apiv2.get('/students/courses');
            return normalizeCourseList(studentRes?.data?.courses || []);
        }

        const [adminResult, studentResult] = await Promise.allSettled([
            apiv2.get('/admin/sync'),
            apiv2.get('/students/courses'),
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
                selectFirstStudentForCourse(nextCourse, fetchedCourses).catch((err) => {
                    console.error('Failed to load students for selected course:', err);
                });
            })
            .catch((err) => {
                console.error('Failed to load courses in navbar:', err);
                if (mounted) {
                    setCourses([]);
                }
            });

        return () => (mounted = false);
    }, [isAdmin, loggedIn, setSelectedStudent]);

    return (
        <Box sx={{ flexGrow: 1 }}>
            <AppBar position='static'>
                <Toolbar>
                    <Box sx={{ flexGrow: 1, gap: '20px' }} display='flex'>
                        <Typography
                            variant='h6'
                            component='div'
                            display='inline-block'
                        >
                            <a
                                href='/'
                                style={{
                                    textDecoration: 'none',
                                    color: 'inherit',
                                }}
                            >
                                GradeView
                            </a>
                        </Typography>
                        {!mobileView && (
                            <>
                                {loggedIn && (
                                    <NavBarItem href='/profile'>Profile</NavBarItem>
                                )}
                                {isAdmin && (
                                    <>
                                    <NavBarItem href='/gradesync'>Grade Sync</NavBarItem>
                                    <NavBarItem href='/admin'>Admin</NavBarItem>
                                    <NavBarItem href='/alerts'>Alerts</NavBarItem>
                                    </>
                                )}
                            </>
                        )}
                    </Box>
                    {loggedIn ? (
                        <>
                            {courses.length > 0 && (
                                <FormControl
                                    size='small'
                                    sx={{ minWidth: 220, mr: 1.5 }}
                                >
                                    <Select
                                        value={selectedCourse}
                                        displayEmpty
                                        onChange={(e) => {
                                            const nextCourse = e.target.value;
                                            setSelectedCourse(nextCourse);
                                            localStorage.setItem('selectedCourseId', nextCourse);
                                            window.dispatchEvent(new CustomEvent('selectedCourseChanged', {
                                                detail: { courseId: nextCourse },
                                            }));
                                            refreshPermissions(nextCourse).catch((err) => {
                                                console.error('Failed to refresh permissions for selected course:', err);
                                            });
                                            selectFirstStudentForCourse(nextCourse).catch((err) => {
                                                console.error('Failed to load students for selected course:', err);
                                            });
                                        }}
                                    >
                                        {courses.map((course) => (
                                            <MenuItem key={course.id} value={course.id}>
                                                {formatCourseLabel(course)}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
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
                                id='loggedInMenu'
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
                                {mobileView && renderMenuItems()}
                                {isAdmin && (
                                    <NavMenuItem
                                        icon={<SettingsIcon />}
                                        text={'Settings'}
                                        onClick={() => {
                                            window.location.href = '/settings';
                                        }}
                                    />
                                )}
                                <NavMenuItem
                                    icon={<Logout />}
                                    text={'Logout'}
                                    onClick={doLogout}
                                />
                            </Menu>
                        </>
                    ) : (
                        <>
                            {mobileView ? (
                                <>
                                    <IconButton
                                        onClick={handleMenu}
                                        color='inherit'
                                    >
                                        <MenuIcon />
                                    </IconButton>
                                    <Menu
                                        id='loggedInMenuMobile'
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
                                            text={'Login'}
                                            onClick={() => {
                                                window.location.href = '/login';
                                            }}
                                        />
                                        {renderMenuItems()}
                                    </Menu>
                                </>
                            ) : (
                                <Link
                                    href='/login'
                                    color='inherit'
                                    underline='none'
                                >
                                    <Button variant='outlined' color='inherit'>
                                        Login
                                    </Button>
                                </Link>
                            )}
                        </>
                    )}
                </Toolbar>
            </AppBar>
        </Box>
    );
}
