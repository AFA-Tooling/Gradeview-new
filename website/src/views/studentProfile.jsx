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
  Paper,
  CircularProgress,
  Alert
} from '@mui/material';
import apiv2 from '../utils/apiv2';
import {
  processStudentData,
  applyExamPolicyToProcessedData,
  buildQuestComponentTrendFallback,
  buildQuestComponentTrendFromAssignments,
} from '../utils/studentDataProcessor';
import StudentProfileContent from '../components/StudentProfileContent';
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
  const [error, setError] = useState(null);
  const [studentData, setStudentData] = useState(null);
  const [courses, setCourses] = useState([]);
  const [adminSelectedStudent, setAdminSelectedStudent] = useState('');
  const [selectedCourse, setSelectedCourse] = useState(localStorage.getItem('selectedCourseId') || '');

  const resolveCourseQueryId = (courseId) => {
    if (!courseId) return '';
    const matchedCourse = courses.find((course) => String(course.id) === String(courseId));
    return matchedCourse?.gradescope_course_id || courseId;
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
            ? Promise.allSettled([apiv2.get('/admin/sync'), apiv2.get('/students/courses')])
            : Promise.allSettled([apiv2.get('/students/courses')]);

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
    const queryCourseId = resolveCourseQueryId(selectedCourse);

    apiv2.get(`/students?course_id=${encodeURIComponent(queryCourseId)}`)
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

  // Load student data and class averages
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
    const queryCourseId = resolveCourseQueryId(selectedCourse);
    
    const courseQuery = queryCourseId ? `?course_id=${encodeURIComponent(queryCourseId)}` : '';

    // Fetch both student grades and class category averages
    Promise.all([
      apiv2.get(`/students/${encodeURIComponent(fetchEmail)}/grades?format=db${queryCourseId ? `&course_id=${encodeURIComponent(queryCourseId)}` : ''}`),
      apiv2.get(`/students/category-stats${courseQuery}`),
      apiv2.get(`/bins${courseQuery}`),
      apiv2.get(`/students/${encodeURIComponent(fetchEmail)}/exam-policy${courseQuery}`),
    ])
      .then(([gradesRes, statsRes, binsRes, policyRes]) => {
        const data = gradesRes.data;
        const classAverages = statsRes.data;
        const policyRows = Array.isArray(policyRes?.data?.rows) ? policyRes.data.rows : [];
        const gradingConfig = {
          assignmentPoints: binsRes?.data?.assignment_points || {},
          totalCoursePoints:
            Number(binsRes?.data?.overall_cap_points)
            || Number(binsRes?.data?.total_points_cap)
            || Number(binsRes?.data?.total_course_points)
            || 0,
        };

        const processedBase = processStudentData(data, fetchEmail, studentName, undefined, classAverages, gradingConfig);
        const processed = applyExamPolicyToProcessedData(processedBase, policyRows, gradingConfig);

        const trendFromApi = policyRes?.data?.questComponentTrend;
        const trendFromPolicy = buildQuestComponentTrendFallback(policyRows);
        const trendFromAssignments = buildQuestComponentTrendFromAssignments(processed?.assignmentsList || []);
        const hasTrendSeries = (trend) => Array.isArray(trend?.series) && trend.series.length > 0;
        const questComponentTrend = hasTrendSeries(trendFromApi)
          ? trendFromApi
          : (hasTrendSeries(trendFromPolicy) ? trendFromPolicy : trendFromAssignments);

        setStudentData({
          ...processed,
          examPolicyRows: policyRows,
          questComponentTrend,
        });
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load student profile:', err);
        setError('Failed to load student data. Please try again.');
        setStudentData(null);
        setLoading(false);
      });
  }, [fetchEmail, studentName, selectedCourse, isAdmin, courses]);

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

  return (
    <Box sx={{ bgcolor: '#f5f7fa', minHeight: '100vh', pb: 4 }}>
      {/* Page Header with Student Name and Admin Student Selector */}
      <Paper 
        elevation={0} 
        sx={{ 
          p: 3, 
          mb: 3,
          backgroundColor: 'white',
          borderRadius: 0,
          borderBottom: '1px solid #e5e7eb'
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h4" component="h1" sx={{ color: '#1e3a8a', fontWeight: 600 }}>
            {studentData?.studentName || studentName || 'Loading...'}
          </Typography>
          
          {/* Admin Student Selector */}
          {isAdmin && (
            <Box sx={{ display: 'flex', gap: 2 }}>
              <FormControl sx={{ minWidth: 240 }} size="small">
                <InputLabel>Select Student</InputLabel>
                <Select
                  value={adminSelectedStudent}
                  label="Select Student"
                  onChange={handleAdminStudentChange}
                  disabled={loadingStudents}
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
      </Paper>

      <Box sx={{ px: 4 }}>
        {/* Tabs */}
        <Tabs 
          value={tab} 
          onChange={(e, newValue) => setTab(newValue)}
          sx={{ 
            mb: 3,
            '& .MuiTab-root': {
              textTransform: 'none',
              fontSize: '0.95rem',
              fontWeight: 500
            }
          }}
        >
          <Tab label="Performance Analytics" />
          <Tab label="Buckets" />
          <Tab label="Concept Map" />
      </Tabs>

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

      {/* Concept Map Tab */}
      {tab === 2 && (
        <Box sx={{ p: 0 }}>
          <ConceptMap embedded />
        </Box>
      )}
      </Box>
    </Box>
  );
}
