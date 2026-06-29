// src/views/studentProfile.jsx
import React, { useMemo, useContext, useState, useEffect } from 'react';
import {
  Box,
  Tabs,
  Tab,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  CircularProgress,
  Alert
} from '@mui/material';
import apiv2 from '../utils/apiv2';
import { cachedApiGet } from '../utils/apiCache';
import {
  fetchStudentGradeFlow,
  fetchStudentProfileData,
  resolveCourseQueryId,
} from '../utils/studentProfileData';
import StudentProfileContent from '../components/StudentProfileContent';
import GradeDataFlow from '../components/GradeDataFlow';
import { StudentSelectionContext } from "../components/StudentSelectionWrapper";
import Buckets from './buckets';
import ConceptMap from './conceptMap';

/**
 * Unified Student Profile Page
 * Combines detailed student analytics, Buckets, and Concept Map into tabs
 */
export default function StudentProfile() {
  const [tab, setTab] = useState(0);
  const { selectedStudent, setSelectedStudent } = useContext(StudentSelectionContext);
  const [isAdmin, setIsAdmin] = useState(false);
  const [needsSelection, setNeedsSelection] = useState(false);
  const [students, setStudents] = useState([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [loading, setLoading] = useState(false);
  const [gradeFlowLoading, setGradeFlowLoading] = useState(false);
  const [gradeFlowError, setGradeFlowError] = useState(null);
  const [gradeFlowRequestedFor, setGradeFlowRequestedFor] = useState('');
  const [error, setError] = useState(null);
  const [studentData, setStudentData] = useState(null);
  const [courses, setCourses] = useState([]);
  const [adminSelectedStudent, setAdminSelectedStudent] = useState(
    selectedStudent || localStorage.getItem('selectedStudentEmail') || '',
  );
  const [selectedCourse, setSelectedCourse] = useState(localStorage.getItem('selectedCourseId') || '');

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

  // Check if user is admin and load student list
  useEffect(() => {
    let mounted = true;
    apiv2.get('/isadmin')
      .then((res) => {
        if (mounted) {
          const adminStatus = res?.data?.isAdmin === true;
          setIsAdmin(adminStatus);

          const loadCourses = adminStatus
            ? Promise.allSettled([
                cachedApiGet('/admin/sync', { ttlMs: 60000 }),
                cachedApiGet('/students/courses', { ttlMs: 60000 }),
              ])
            : Promise.allSettled([cachedApiGet('/students/courses', { ttlMs: 60000 })]);

          loadCourses.then((results) => {
              if (!mounted) return;

              const fetchedCourses = adminStatus
                ? normalizeCourseList([
                    ...(results[0]?.status === 'fulfilled' ? (results[0].value?.data?.courses || []) : []),
                    ...(results[1]?.status === 'fulfilled' ? (results[1].value?.data?.courses || []) : []),
                  ])
                : normalizeCourseList([
                    ...(results[0]?.status === 'fulfilled' ? (results[0].value?.data?.courses || []) : []),
                  ]);

              setCourses(fetchedCourses);

              if (fetchedCourses.length === 0) {
                setSelectedCourse('');
                localStorage.removeItem('selectedCourseId');
                return;
              }

              const rememberedCourse = localStorage.getItem('selectedCourseId') || selectedCourse;
              const hasSelected = fetchedCourses.some((course) => String(course.id) === String(rememberedCourse));
              const nextCourse = hasSelected ? String(rememberedCourse) : String(fetchedCourses[0].id);
              setSelectedCourse(nextCourse);
              localStorage.setItem('selectedCourseId', nextCourse);
            })
            .catch((err) => {
              console.error('Failed to load courses:', err);
            });
          
          // Check if admin needs to select a student
          if (adminStatus && !selectedStudent && !localStorage.getItem('email')) {
            setNeedsSelection(true);
          } else {
            setNeedsSelection(false);
          }
        }
      })
      .catch(() => {
        if (mounted) setIsAdmin(false);
      });
    return () => { mounted = false; };
  }, [selectedStudent, setSelectedStudent]);

  useEffect(() => {
    if (!isAdmin || !selectedCourse) {
      return;
    }

    let mounted = true;
    setLoadingStudents(true);
    const queryCourseId = resolveCourseQueryId(selectedCourse, courses);

    cachedApiGet(`/students?course_id=${encodeURIComponent(queryCourseId)}`, { ttlMs: 60000 })
      .then((studentsRes) => {
        if (!mounted) return;

        const studentsList = (studentsRes?.data?.students || [])
          .map(s => ({
            name: s[0],
            email: s[1]
          }))
          .sort((a, b) => a.name.localeCompare(b.name));

        setStudents(studentsList);

        const stillExists = studentsList.some((student) => student.email === adminSelectedStudent);
        if (!stillExists) {
          const nextEmail = studentsList[0]?.email || '';
          setAdminSelectedStudent(nextEmail);
          setSelectedStudent(nextEmail);
        }

        setLoadingStudents(false);
      })
      .catch((err) => {
        console.error('Failed to load students:', err);
        if (mounted) setLoadingStudents(false);
      });

    return () => {
      mounted = false;
    };
  }, [isAdmin, selectedCourse, adminSelectedStudent, setSelectedStudent, courses]);

  useEffect(() => {
    if (!isAdmin || adminSelectedStudent || !selectedStudent) return;
    setAdminSelectedStudent(selectedStudent);
  }, [adminSelectedStudent, isAdmin, selectedStudent]);

  const fetchEmail = useMemo(() => {
    if (isAdmin) {
      return adminSelectedStudent || selectedStudent;
    }
    return localStorage.getItem('email');
  }, [isAdmin, adminSelectedStudent, selectedStudent]);

  const studentName = useMemo(() => {
    if (isAdmin && students.length > 0 && fetchEmail) {
      const student = students.find(s => s.email === fetchEmail);
      return student ? student.name : fetchEmail;
    }
    return localStorage.getItem('name') || fetchEmail;
  }, [fetchEmail, isAdmin, students]);

  // Load profile analytics. Grade Flow is loaded lazily when its tab is opened.
  useEffect(() => {
    if (!fetchEmail) {
      setStudentData(null);
      return;
    }

    if (isAdmin && !selectedCourse) {
      return;
    }

    setLoading(true);
    setError(null);
    setGradeFlowError(null);
    setGradeFlowRequestedFor('');

    const controller = new AbortController();
    let active = true;

    fetchStudentProfileData({
      studentEmail: fetchEmail,
      studentName,
      selectedCourse,
      courses,
      signal: controller.signal,
    })
      .then((profileData) => {
        if (!active) return;
        setStudentData(profileData);
        setLoading(false);
      })
      .catch(err => {
        if (!active) return;
        if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') {
          return;
        }
        console.error('Failed to load student profile:', err);
        setError('Failed to load student data. Please try again.');
        setStudentData(null);
        setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [fetchEmail, studentName, selectedCourse, isAdmin, courses]);

  useEffect(() => {
    const requestKey = `${fetchEmail || ''}:${selectedCourse || ''}`;
    if (
      tab !== 2
      || !fetchEmail
      || !studentData
      || studentData.gradeFlow
      || gradeFlowLoading
      || gradeFlowRequestedFor === requestKey
    ) {
      return undefined;
    }

    const controller = new AbortController();
    let active = true;
    setGradeFlowRequestedFor(requestKey);
    setGradeFlowLoading(true);
    setGradeFlowError(null);

    fetchStudentGradeFlow({
      studentEmail: fetchEmail,
      selectedCourse,
      courses,
      signal: controller.signal,
    })
      .then((gradeFlow) => {
        if (!active) return;
        setStudentData((prev) => (prev ? { ...prev, gradeFlow } : prev));
        setGradeFlowLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') {
          setGradeFlowLoading(false);
          return;
        }
        console.error('Failed to load grade flow graph:', err);
        setGradeFlowError('Failed to load grade flow graph. Please try again.');
        setGradeFlowLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [tab, fetchEmail, selectedCourse, courses, studentData, gradeFlowLoading, gradeFlowRequestedFor]);

  const handleAdminStudentChange = (event) => {
    const newEmail = event.target.value;
    setAdminSelectedStudent(newEmail);
    setSelectedStudent(newEmail);
  };

  // Show message if admin needs to select a student
  if (needsSelection || !fetchEmail) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="h6" color="text.secondary">
          Please select a student from the dropdown menu.
        </Typography>
      </Box>
    );
  }

  const gradeFlowMode = tab === 2;

  return (
    <Box
      className='student-profile-shell'
      sx={{
        height: gradeFlowMode ? '100%' : 'auto',
        minHeight: gradeFlowMode ? 0 : '100vh',
        pb: gradeFlowMode ? 0 : 4,
        overflow: gradeFlowMode ? 'hidden' : 'visible',
        color: '#111827',
        display: gradeFlowMode ? 'flex' : 'block',
        flexDirection: gradeFlowMode ? 'column' : 'initial',
      }}
    >
      <Box
        sx={{ 
          mb: gradeFlowMode ? 1 : 2.5,
          flexShrink: 0,
          backgroundColor: '#FFFFFF',
          borderBottom: '1px solid #E5E7EB',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: { xs: 'stretch', sm: 'center' },
            flexDirection: { xs: 'column', sm: 'row' },
            gap: 1.5,
            pt: gradeFlowMode ? 0.25 : 0,
            pb: gradeFlowMode ? 0.75 : 1.25,
          }}
        >
          <Typography
            variant={gradeFlowMode ? 'h6' : 'h5'}
            component="h1"
            sx={{
              fontWeight: 750,
              letterSpacing: 0,
              lineHeight: 1.2,
              color: '#111827',
              minWidth: 0,
            }}
          >
            {studentData?.studentName || studentName || 'Loading...'}
          </Typography>
          
          {isAdmin && (
            <Box sx={{ display: 'flex', gap: 1, justifyContent: { xs: 'stretch', sm: 'flex-end' } }}>
              <FormControl sx={{ minWidth: { xs: '100%', sm: 260 } }} size="small">
                <InputLabel>Select Student</InputLabel>
                <Select
                  value={adminSelectedStudent}
                  label="Select Student"
                  onChange={handleAdminStudentChange}
                  disabled={loadingStudents}
                  sx={{
                    borderRadius: 1,
                    fontSize: 13,
                    fontWeight: 600,
                    backgroundColor: '#FFFFFF',
                    '& .MuiSelect-select': {
                      py: 0.85,
                    },
                  }}
                >
                  {students.map((student) => (
                    <MenuItem key={student.email} value={student.email}>
                      {student.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
          )}
        </Box>

        <Tabs 
          value={tab} 
          onChange={(e, newValue) => setTab(newValue)}
          sx={{ 
            flexShrink: 0,
            minHeight: 34,
            '& .MuiTab-root': {
              textTransform: 'none',
              fontSize: 13,
              fontWeight: 650,
              minHeight: 34,
              px: 1.6,
              mr: 1,
              color: '#6B7280',
            },
            '& .Mui-selected': {
              color: '#111827',
            },
            '& .MuiTabs-indicator': {
              height: 2,
              backgroundColor: '#111827',
            },
          }}
        >
          <Tab label="Performance Analytics" />
          <Tab label="Buckets" />
          <Tab label="Grade Flow" />
          <Tab label="Concept Map" />
        </Tabs>
      </Box>

      <Box
        sx={{
          px: 0,
          width: '100%',
          height: gradeFlowMode ? 'auto' : 'auto',
          flex: gradeFlowMode ? 1 : 'initial',
          minHeight: 0,
          overflow: gradeFlowMode ? 'hidden' : 'visible',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
      {/* Performance Analytics Tab */}
      {tab === 0 && loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
          <CircularProgress />
        </Box>
      )}

      {tab === 0 && error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {tab === 0 && studentData && (
        <StudentProfileContent 
          studentData={studentData}
        />
      )}

      {/* Buckets Tab */}
      {tab === 1 && (
        <Box sx={{ p: 0 }}>
          <Buckets embedded />
        </Box>
      )}

      {/* Grade Flow Tab */}
      {tab === 2 && (
        (loading || gradeFlowLoading) ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
            <CircularProgress />
          </Box>
        ) : (error || gradeFlowError) ? (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error || gradeFlowError}
          </Alert>
        ) : studentData ? (
          <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <GradeDataFlow studentData={studentData} />
          </Box>
        ) : (
          <Typography sx={{ color: 'text.secondary' }}>No grade data available yet.</Typography>
        )
      )}

      {/* Concept Map Tab */}
      {tab === 3 && (
        <Box sx={{ p: 0 }}>
          <ConceptMap embedded />
        </Box>
      )}
      </Box>
    </Box>
  );
}
