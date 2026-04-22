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
    LightMode,
    DarkMode,
} from '@mui/icons-material';
import MenuIcon from '@mui/icons-material/Menu';
import apiv2 from '../utils/apiv2';
import NavBarItem from './NavBarItem';
import NavMenuItem from './NavMenuItem';
import { StudentSelectionContext } from './StudentSelectionWrapper';

export default function ButtonAppBar({ displayMode = 'dark', onToggleDisplayMode }) {
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

            // Check for admin status when user is logged in
            apiv2.get(`/isadmin?_=${new Date().getTime()}`)
                .then((res) => {
                    if (mounted) {
                        setAdminStatus(res.data.isAdmin === true);
                    }
                })
                .catch((err) => {
                    console.error("Failed to verify admin status.", err);
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

        if (isAdmin) {
            apiv2.get('/students').then((res) => {
                if (mounted) {
                    const sortedStudents = res.data.students.sort((a, b) =>
                        a[0].localeCompare(b[0])
                    );
                    if (sortedStudents.length > 0) {
                        setSelectedStudent(sortedStudents[0][1]);
                    }
                }
            });
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
            })
            .catch((err) => {
                console.error('Failed to load courses in navbar:', err);
                if (mounted) {
                    setCourses([]);
                }
            });

        return () => (mounted = false);
    }, [isAdmin, loggedIn, setSelectedStudent]);

    useEffect(() => {
        let mounted = true;
        if (loggedIn) {
            apiv2.get('/isadmin')
                .then((res) => {
                    if (mounted) {
                        setAdminStatus(res.data.isAdmin);
                    }
                })
                .catch((err) => {
                    if (mounted) {
                        console.error('Failed to check admin status:', err);
                        setAdminStatus(false);
                    }
                });
        }
        return () => (mounted = false);
    }, [loggedIn]);

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
                                    sx={{
                                        minWidth: 220,
                                        mr: 1.5,
                                        '& .MuiOutlinedInput-root': {
                                            color: displayMode === 'dark' ? 'white' : '#1f3d73',
                                            '& fieldset': {
                                                borderColor: displayMode === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(36, 70, 144, 0.4)',
                                            },
                                            '&:hover fieldset': {
                                                borderColor: displayMode === 'dark' ? 'white' : 'rgba(36, 70, 144, 0.65)',
                                            },
                                            '&.Mui-focused fieldset': {
                                                borderColor: displayMode === 'dark' ? 'white' : '#3258c7',
                                            },
                                        },
                                        '& .MuiSvgIcon-root': {
                                            color: displayMode === 'dark' ? 'white' : '#1f3d73',
                                        },
                                    }}
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
                                aria-label={displayMode === 'dark' ? 'switch to light mode' : 'switch to dark mode'}
                                onClick={onToggleDisplayMode}
                                sx={{
                                    mr: 1,
                                    color: 'inherit',
                                    border: '1px solid',
                                    borderColor: displayMode === 'dark' ? 'rgba(255,255,255,0.35)' : 'rgba(41, 73, 148, 0.35)',
                                    bgcolor: displayMode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.7)',
                                    '&:hover': {
                                        bgcolor: displayMode === 'dark' ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.9)',
                                    },
                                }}
                            >
                                {displayMode === 'dark' ? <LightMode fontSize='small' /> : <DarkMode fontSize='small' />}
                            </IconButton>
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
