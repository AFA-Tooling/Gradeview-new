// src/views/studentProfile.jsx
import React, { useMemo, useContext, useState, useEffect, useRef } from 'react';
import {
  Alert,
  Box,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import apiv2 from '../utils/apiv2';
import { cachedApiGet } from '../utils/apiCache';
import {
  fetchStudentGradeFlow,
  fetchStudentProfileData,
  resolveCourseQueryId,
} from '../utils/studentProfileData';
import { StudentSelectionContext } from "../components/StudentSelectionWrapper";
import {
  AssignmentLedger,
  CategoryDetailPage,
  ConceptsPage,
  ExamsOverviewPage,
  ExplainScorePage,
  PolicyReference,
  SingleExamPage,
  StudentReportContent,
  StudentWorkspaceHome,
  UnknownStudentExperienceRoute,
} from '../components/studentExperienceV2';

function normalizeCourseList(list) {
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
}

function formatCourseLabel(course) {
  if (!course) return '';
  const year = String(course?.year || '').trim();
  const semester = String(course?.semester || '').trim();
  const name = String(course?.name || '').trim();
  const pieces = [year, semester, name].filter(Boolean);
  return pieces.length ? pieces.join(' ') : String(course?.gradescope_course_id || course?.id || '').trim();
}

function resolveProfilePage(pathname, routeEmail) {
  if (routeEmail) return { kind: 'report' };
  const normalized = String(pathname || '').replace(/\/+$/, '') || '/profile';
  if (normalized === '/profile') return { kind: 'workspace' };
  if (normalized === '/profile/report') return { kind: 'report' };
  if (normalized === '/profile/attendance') return { kind: 'category', pageKey: 'attendance' };
  if (normalized === '/profile/labs') return { kind: 'category', pageKey: 'labs' };
  if (normalized === '/profile/projects') return { kind: 'category', pageKey: 'projects' };
  if (normalized === '/profile/exams') return { kind: 'exams' };
  if (normalized === '/profile/exams/quest') return { kind: 'singleExam', examKey: 'quest' };
  if (normalized === '/profile/exams/midterm') return { kind: 'singleExam', examKey: 'midterm' };
  if (normalized === '/profile/exams/postterm') return { kind: 'singleExam', examKey: 'postterm' };
  if (normalized === '/profile/assignments') return { kind: 'assignments' };
  if (normalized === '/profile/explain') return { kind: 'explain' };
  if (normalized === '/profile/concepts') return { kind: 'concepts' };
  if (normalized === '/profile/policy') return { kind: 'policy' };
  return { kind: 'unknown' };
}

function renderExperiencePage({
  page,
  studentData,
  fetchEmail,
  currentCourseLabel,
  isStaffReport,
  gradeFlowLoading,
  gradeFlowError,
}) {
  if (page.kind === 'workspace') {
    return <StudentWorkspaceHome studentData={studentData} />;
  }
  if (page.kind === 'report') {
    return (
      <StudentReportContent
        studentData={studentData}
        studentEmail={fetchEmail}
        currentCourse={currentCourseLabel}
        staffMode={isStaffReport}
      />
    );
  }
  if (page.kind === 'category') {
    return <CategoryDetailPage studentData={studentData} pageKey={page.pageKey} />;
  }
  if (page.kind === 'exams') {
    return <ExamsOverviewPage studentData={studentData} />;
  }
  if (page.kind === 'singleExam') {
    return <SingleExamPage studentData={studentData} examKey={page.examKey} />;
  }
  if (page.kind === 'assignments') {
    return <AssignmentLedger studentData={studentData} />;
  }
  if (page.kind === 'explain') {
    return (
      <ExplainScorePage
        studentData={studentData}
        gradeFlowLoading={gradeFlowLoading}
        gradeFlowError={gradeFlowError}
      />
    );
  }
  if (page.kind === 'concepts') {
    return <ConceptsPage studentData={studentData} />;
  }
  if (page.kind === 'policy') {
    return <PolicyReference studentData={studentData} />;
  }
  return <UnknownStudentExperienceRoute />;
}

/**
 * Student Profile V2
 * Route-driven student workspace and staff report experience.
 */
export default function StudentProfile() {
  const { selectedStudent, setSelectedStudent } = useContext(StudentSelectionContext);
  const { email: routeEmailParam } = useParams();
  const routeEmail = routeEmailParam ? decodeURIComponent(routeEmailParam) : '';
  const location = useLocation();
  const navigate = useNavigate();

  const [isAdmin, setIsAdmin] = useState(false);
  const [needsSelection, setNeedsSelection] = useState(false);
  const [students, setStudents] = useState([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [loading, setLoading] = useState(false);
  const [gradeFlowLoading, setGradeFlowLoading] = useState(false);
  const [gradeFlowError, setGradeFlowError] = useState(null);
  const gradeFlowRequestKeyRef = useRef('');
  const [error, setError] = useState(null);
  const [studentData, setStudentData] = useState(null);
  const [courses, setCourses] = useState([]);
  const [adminSelectedStudent, setAdminSelectedStudent] = useState(
    routeEmail || selectedStudent || localStorage.getItem('selectedStudentEmail') || '',
  );
  const [selectedCourse, setSelectedCourse] = useState(localStorage.getItem('selectedCourseId') || '');

  const page = useMemo(() => resolveProfilePage(location.pathname, routeEmail), [location.pathname, routeEmail]);

  useEffect(() => {
    if (!routeEmail) return;
    setAdminSelectedStudent(routeEmail);
    setSelectedStudent(routeEmail);
  }, [routeEmail, setSelectedStudent]);

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
    let mounted = true;
    apiv2.get('/isadmin')
      .then((res) => {
        if (!mounted) return;
        const adminStatus = res?.data?.isAdmin === true;
        setIsAdmin(adminStatus);

        const loadCourses = adminStatus
          ? Promise.allSettled([
              cachedApiGet('/admin/sync', { ttlMs: 60000 }),
              cachedApiGet('/students/courses', { ttlMs: 60000 }),
            ])
          : Promise.allSettled([cachedApiGet('/students/courses', { ttlMs: 60000 })]);

        loadCourses
          .then((results) => {
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

        setNeedsSelection(Boolean(adminStatus && !routeEmail && !selectedStudent && !localStorage.getItem('email')));
      })
      .catch(() => {
        if (mounted) setIsAdmin(false);
      });
    return () => { mounted = false; };
  }, [routeEmail, selectedCourse, selectedStudent]);

  useEffect(() => {
    if (!isAdmin || !selectedCourse) {
      return undefined;
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

        const currentStudent = routeEmail || adminSelectedStudent;
        const stillExists = studentsList.some((student) => student.email === currentStudent);
        if (!routeEmail && !stillExists) {
          const nextEmail = studentsList[0]?.email || '';
          setAdminSelectedStudent(nextEmail);
          setSelectedStudent(nextEmail);
        }

        setLoadingStudents(false);
      })
      .catch(() => {
        if (mounted) {
          setStudents([]);
          setLoadingStudents(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [isAdmin, selectedCourse, adminSelectedStudent, setSelectedStudent, courses, routeEmail]);

  useEffect(() => {
    if (!isAdmin || routeEmail || adminSelectedStudent || !selectedStudent) return;
    setAdminSelectedStudent(selectedStudent);
  }, [adminSelectedStudent, isAdmin, routeEmail, selectedStudent]);

  const fetchEmail = useMemo(() => {
    if (routeEmail) return routeEmail;
    if (isAdmin) {
      return adminSelectedStudent || selectedStudent;
    }
    return localStorage.getItem('email');
  }, [routeEmail, isAdmin, adminSelectedStudent, selectedStudent]);

  const studentName = useMemo(() => {
    if ((isAdmin || routeEmail) && students.length > 0 && fetchEmail) {
      const student = students.find(s => s.email === fetchEmail);
      return student ? student.name : fetchEmail;
    }
    return localStorage.getItem('name') || fetchEmail;
  }, [fetchEmail, isAdmin, routeEmail, students]);

  const currentCourse = useMemo(() => (
    courses.find((course) => String(course.id) === String(selectedCourse))
  ), [courses, selectedCourse]);
  const currentCourseLabel = useMemo(() => formatCourseLabel(currentCourse), [currentCourse]);
  const selectedStudentInMenu = useMemo(() => (
    students.some((student) => student.email === adminSelectedStudent)
  ), [adminSelectedStudent, students]);

  useEffect(() => {
    if (!fetchEmail) {
      setStudentData(null);
      return undefined;
    }

    if (isAdmin && !selectedCourse) {
      return undefined;
    }

    setLoading(true);
    setError(null);
    setGradeFlowError(null);
    setGradeFlowLoading(false);
    gradeFlowRequestKeyRef.current = '';

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
      page.kind !== 'explain'
      || !fetchEmail
      || !studentData
      || studentData.gradeFlow
      || gradeFlowRequestKeyRef.current === requestKey
    ) {
      return undefined;
    }

    const controller = new AbortController();
    let active = true;
    gradeFlowRequestKeyRef.current = requestKey;
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
        setGradeFlowError(null);
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
        gradeFlowRequestKeyRef.current = '';
        setGradeFlowLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
      if (gradeFlowRequestKeyRef.current === requestKey) {
        gradeFlowRequestKeyRef.current = '';
      }
    };
  }, [page.kind, fetchEmail, selectedCourse, courses, studentData]);

  const handleAdminStudentChange = (event) => {
    const newEmail = event.target.value;
    setAdminSelectedStudent(newEmail);
    setSelectedStudent(newEmail);
    if (routeEmail) {
      navigate(`/students/${encodeURIComponent(newEmail)}/report`);
    }
  };

  if (needsSelection || !fetchEmail) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="h6" color="text.secondary">
          Please select a student from the dropdown menu.
        </Typography>
      </Box>
    );
  }

  const isStaffReport = Boolean(routeEmail || (isAdmin && page.kind === 'report'));

  return (
    <Box
      className='student-profile-shell'
      sx={{
        minHeight: '100vh',
        pb: 4,
        color: '#111827',
      }}
    >
      <Box
        sx={{
          mb: 2.5,
          backgroundColor: '#FFFFFF',
          borderBottom: '1px solid #E5E7EB',
        }}
      >
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1.5}
          alignItems={{ xs: 'stretch', md: 'center' }}
          justifyContent="space-between"
          sx={{ pb: 1.25 }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="h5"
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
            <Typography sx={{ color: '#6B7280', fontSize: 13, mt: 0.35 }}>
              {fetchEmail}{currentCourseLabel ? ` · ${currentCourseLabel}` : ''}
            </Typography>
          </Box>

          {isAdmin && (
            <FormControl sx={{ minWidth: { xs: '100%', sm: 280 } }} size="small">
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
                {adminSelectedStudent && !selectedStudentInMenu && (
                  <MenuItem value={adminSelectedStudent}>
                    {studentName || adminSelectedStudent}
                  </MenuItem>
                )}
                {students.map((student) => (
                  <MenuItem key={student.email} value={student.email}>
                    {student.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
        </Stack>
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
          <CircularProgress />
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {!loading && !error && studentData && renderExperiencePage({
        page,
        studentData,
        fetchEmail,
        currentCourseLabel,
        isStaffReport,
        gradeFlowLoading,
        gradeFlowError,
      })}
    </Box>
  );
}
