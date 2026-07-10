// src/views/studentProfile.jsx
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import { cachedApiGet } from '../utils/apiCache';
import {
  fetchStudentGradeFlow,
  fetchStudentProfileData,
  resolveCourseQueryId,
} from '../utils/studentProfileData';
import {
  STUDENT_PERSONA,
  buildStudentExperiencePath,
  getStableCourseIdentifier,
  getStudentRouteCourseId,
  isValidStudentIdentifier,
  mergeStudentRouteQuery,
  normalizeStudentOptions,
  parseStudentExperiencePath,
  resolveCourseSelection,
} from '../utils/studentRoutes';
import { createRequestCoordinator, isCanceledRequest } from '../utils/requestCoordinator';
import { StudentSelectionContext } from '../components/StudentSelectionWrapper';
import StudentReviewHeader from '../components/StudentReviewHeader';
import {
  StudentExperienceLoading,
  StudentExperienceMessage,
} from '../components/StudentExperienceState';
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
  const merged = new Map();
  (Array.isArray(list) ? list : []).forEach((course) => {
    const key = String(course?.gradescope_course_id || course?.id || '').trim();
    if (!key || merged.has(key)) return;
    merged.set(key, { ...course, id: String(course.id) });
  });
  return Array.from(merged.values());
}

function formatCourseLabel(course) {
  if (!course) return '';
  const pieces = [course?.year, course?.semester, course?.name]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return pieces.length
    ? pieces.join(' ')
    : String(course?.gradescope_course_id || course?.id || '').trim();
}

function renderExperiencePage({
  page,
  studentData,
  fetchEmail,
  currentCourseLabel,
  isStaffReview,
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
        staffMode={isStaffReview}
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

function getInitialCoursePreference(search) {
  return getStudentRouteCourseId(search) || localStorage.getItem('selectedCourseId') || '';
}

/**
 * Route-driven student workspace and staff student-review experience.
 * The URL is authoritative for staff student, course, and page identity.
 */
export default function StudentProfile() {
  const location = useLocation();
  const navigate = useNavigate();
  const { setSelectedStudent } = useContext(StudentSelectionContext);
  const route = useMemo(
    () => parseStudentExperiencePath(location.pathname),
    [location.pathname],
  );
  const isStaffReview = route.persona === STUDENT_PERSONA.STAFF;
  const fetchEmail = isStaffReview
    ? route.identifier
    : String(localStorage.getItem('email') || '').trim().toLowerCase();

  const [coursePreference, setCoursePreference] = useState(
    () => getInitialCoursePreference(location.search),
  );
  const [coursesResource, setCoursesResource] = useState({
    status: 'loading',
    courses: [],
    error: '',
  });
  const [studentsResource, setStudentsResource] = useState({
    key: '',
    status: 'idle',
    students: [],
    error: '',
  });
  const [profileResource, setProfileResource] = useState({
    key: '',
    status: 'idle',
    data: null,
    error: '',
  });
  const [gradeFlowResource, setGradeFlowResource] = useState({
    key: '',
    status: 'idle',
    data: null,
    error: '',
  });

  const coursesCoordinatorRef = useRef(null);
  const studentsCoordinatorRef = useRef(null);
  const profileCoordinatorRef = useRef(null);
  const gradeFlowCoordinatorRef = useRef(null);
  if (!coursesCoordinatorRef.current) coursesCoordinatorRef.current = createRequestCoordinator();
  if (!studentsCoordinatorRef.current) studentsCoordinatorRef.current = createRequestCoordinator();
  if (!profileCoordinatorRef.current) profileCoordinatorRef.current = createRequestCoordinator();
  if (!gradeFlowCoordinatorRef.current) gradeFlowCoordinatorRef.current = createRequestCoordinator();

  const requestedCourseId = getStudentRouteCourseId(location.search);
  const courseCandidate = requestedCourseId
    || coursePreference
    || coursesResource.courses[0]?.id
    || '';
  const selectedCourse = useMemo(
    () => (
      resolveCourseSelection(courseCandidate, coursesResource.courses)
      || (!requestedCourseId ? String(coursesResource.courses[0]?.id || '') : '')
    ),
    [courseCandidate, coursesResource.courses, requestedCourseId],
  );
  const currentCourse = useMemo(() => (
    coursesResource.courses.find((course) => String(course.id) === String(selectedCourse)) || null
  ), [coursesResource.courses, selectedCourse]);
  const stableCourseId = getStableCourseIdentifier(currentCourse, selectedCourse);
  const currentCourseLabel = formatCourseLabel(currentCourse);

  useEffect(() => {
    const request = coursesCoordinatorRef.current.begin();
    setCoursesResource({ status: 'loading', courses: [], error: '' });

    const courseRequests = isStaffReview
      ? [
          cachedApiGet('/admin/sync', { ttlMs: 60000, config: { signal: request.signal } }),
          cachedApiGet('/students/courses', { ttlMs: 60000, config: { signal: request.signal } }),
        ]
      : [cachedApiGet('/students/courses', { ttlMs: 60000, config: { signal: request.signal } })];

    Promise.allSettled(courseRequests)
      .then((results) => {
        if (!request.isCurrent()) return;
        const fetchedCourses = normalizeCourseList(results.flatMap((result) => (
          result.status === 'fulfilled' ? (result.value?.data?.courses || []) : []
        )));

        if (fetchedCourses.length === 0 && results.every((result) => result.status === 'rejected')) {
          setCoursesResource({ status: 'error', courses: [], error: 'Unable to load course access.' });
          return;
        }

        setCoursesResource({
          status: fetchedCourses.length ? 'ready' : 'empty',
          courses: fetchedCourses,
          error: '',
        });
      });

    return () => request.abort();
  }, [isStaffReview]);

  useEffect(() => {
    if (coursesResource.status !== 'ready' || requestedCourseId) return;
    const remembered = coursePreference || localStorage.getItem('selectedCourseId') || '';
    const nextCourse = resolveCourseSelection(remembered, coursesResource.courses)
      || String(coursesResource.courses[0]?.id || '');
    if (!nextCourse) return;
    if (nextCourse !== coursePreference) setCoursePreference(nextCourse);
    localStorage.setItem('selectedCourseId', nextCourse);
  }, [coursePreference, coursesResource.courses, coursesResource.status, requestedCourseId]);

  useEffect(() => {
    if (!isStaffReview || !route.identifierValid) return;
    setSelectedStudent(route.identifier);
  }, [isStaffReview, route.identifier, route.identifierValid, setSelectedStudent]);

  useEffect(() => {
    if (
      !isStaffReview
      || !route.identifierValid
      || route.page.kind === 'unknown'
      || coursesResource.status !== 'ready'
      || !stableCourseId
    ) {
      return;
    }

    const nextSearch = mergeStudentRouteQuery(location.search, { course_id: stableCourseId });
    const canonicalPath = buildStudentExperiencePath({
      persona: STUDENT_PERSONA.STAFF,
      identifier: route.identifier,
      page: route.page,
      search: nextSearch,
    });
    const currentPath = `${location.pathname}${location.search}`;
    if (canonicalPath && canonicalPath !== currentPath) {
      navigate(canonicalPath, { replace: true });
    }
  }, [
    coursesResource.status,
    isStaffReview,
    location.pathname,
    location.search,
    navigate,
    route.identifier,
    route.identifierValid,
    route.page,
    stableCourseId,
  ]);

  useEffect(() => {
    const handleSelectedCourseChanged = (event) => {
      const nextCourse = String(
        event?.detail?.courseId || localStorage.getItem('selectedCourseId') || '',
      ).trim();
      if (!nextCourse) return;

      setCoursePreference(nextCourse);
      if (!isStaffReview || !route.identifierValid || route.page.kind === 'unknown') return;

      const matchedCourse = coursesResource.courses.find((course) => String(course.id) === nextCourse);
      const nextStableCourseId = getStableCourseIdentifier(matchedCourse, nextCourse);
      const nextPath = buildStudentExperiencePath({
        persona: STUDENT_PERSONA.STAFF,
        identifier: route.identifier,
        page: route.page,
        search: mergeStudentRouteQuery(location.search, { course_id: nextStableCourseId }),
      });
      if (nextPath) navigate(nextPath);
    };

    window.addEventListener('selectedCourseChanged', handleSelectedCourseChanged);
    return () => window.removeEventListener('selectedCourseChanged', handleSelectedCourseChanged);
  }, [
    coursesResource.courses,
    isStaffReview,
    location.search,
    navigate,
    route.identifier,
    route.identifierValid,
    route.page,
  ]);

  const studentListKey = isStaffReview && selectedCourse
    ? String(stableCourseId || selectedCourse)
    : '';

  useEffect(() => {
    if (!studentListKey || coursesResource.status !== 'ready') {
      studentsCoordinatorRef.current.cancel();
      setStudentsResource({ key: '', status: 'idle', students: [], error: '' });
      return undefined;
    }

    const request = studentsCoordinatorRef.current.begin();
    setStudentsResource({ key: studentListKey, status: 'loading', students: [], error: '' });
    const queryCourseId = resolveCourseQueryId(selectedCourse, coursesResource.courses);

    cachedApiGet(`/students?course_id=${encodeURIComponent(queryCourseId)}`, {
      ttlMs: 60000,
      config: { signal: request.signal },
    })
      .then((response) => {
        if (!request.isCurrent()) return;
        setStudentsResource({
          key: studentListKey,
          status: 'ready',
          students: normalizeStudentOptions(response?.data?.students || []),
          error: '',
        });
      })
      .catch((error) => {
        if (!request.isCurrent() || isCanceledRequest(error)) return;
        setStudentsResource({
          key: studentListKey,
          status: 'error',
          students: [],
          error: 'Unable to load the student list for this course.',
        });
      });

    return () => request.abort();
  }, [coursesResource.courses, coursesResource.status, selectedCourse, studentListKey]);

  const currentStudentOption = useMemo(() => (
    studentsResource.students.find((student) => student.email === fetchEmail) || null
  ), [fetchEmail, studentsResource.students]);
  const selfIdentifierValid = isValidStudentIdentifier(fetchEmail);
  const staffListMatchesCourse = studentsResource.key === studentListKey;
  const canLoadProfile = (
    route.page.kind !== 'unknown'
    && coursesResource.status === 'ready'
    && Boolean(selectedCourse)
    && (isStaffReview ? route.identifierValid : selfIdentifierValid)
  );
  const studentName = isStaffReview
    ? fetchEmail
    : String(localStorage.getItem('name') || '').trim();
  const profileRequestKey = canLoadProfile
    ? `${fetchEmail}:${stableCourseId || selectedCourse}`
    : '';

  useEffect(() => {
    if (!profileRequestKey) {
      profileCoordinatorRef.current.cancel();
      return undefined;
    }

    const request = profileCoordinatorRef.current.begin();
    setProfileResource({ key: profileRequestKey, status: 'loading', data: null, error: '' });

    fetchStudentProfileData({
      studentEmail: fetchEmail,
      studentName,
      selectedCourse,
      courses: coursesResource.courses,
      signal: request.signal,
    })
      .then((profileData) => {
        if (!request.isCurrent()) return;
        setProfileResource({
          key: profileRequestKey,
          status: profileData ? 'ready' : 'empty',
          data: profileData || null,
          error: '',
        });
      })
      .catch((error) => {
        if (!request.isCurrent() || isCanceledRequest(error)) return;
        setProfileResource({
          key: profileRequestKey,
          status: 'error',
          data: null,
          error: 'Failed to load student data. Please try again.',
        });
      });

    return () => request.abort();
  }, [
    coursesResource.courses,
    fetchEmail,
    profileRequestKey,
    selectedCourse,
    studentName,
  ]);

  const profileMatchesRequest = profileResource.key === profileRequestKey;
  const profileStatus = profileMatchesRequest ? profileResource.status : 'loading';
  const profileData = profileMatchesRequest && profileResource.status === 'ready'
    ? profileResource.data
    : null;
  const gradeFlowRequestKey = `${profileRequestKey}:grade-flow`;

  useEffect(() => {
    if (route.page.kind !== 'explain' || !profileData || profileData.gradeFlow) {
      gradeFlowCoordinatorRef.current.cancel();
      return undefined;
    }

    const request = gradeFlowCoordinatorRef.current.begin();
    setGradeFlowResource({ key: gradeFlowRequestKey, status: 'loading', data: null, error: '' });

    fetchStudentGradeFlow({
      studentEmail: fetchEmail,
      selectedCourse,
      courses: coursesResource.courses,
      signal: request.signal,
    })
      .then((gradeFlow) => {
        if (!request.isCurrent()) return;
        setGradeFlowResource({ key: gradeFlowRequestKey, status: 'ready', data: gradeFlow, error: '' });
      })
      .catch((error) => {
        if (!request.isCurrent() || isCanceledRequest(error)) return;
        setGradeFlowResource({
          key: gradeFlowRequestKey,
          status: 'error',
          data: null,
          error: 'Failed to load grade flow graph. Please try again.',
        });
      });

    return () => request.abort();
  }, [
    coursesResource.courses,
    fetchEmail,
    gradeFlowRequestKey,
    profileData,
    route.page.kind,
    selectedCourse,
  ]);

  const gradeFlowMatchesRequest = gradeFlowResource.key === gradeFlowRequestKey;
  const studentData = useMemo(() => {
    if (!profileData) return null;
    let nextData = profileData;
    if (gradeFlowMatchesRequest && gradeFlowResource.status === 'ready') {
      nextData = { ...nextData, gradeFlow: gradeFlowResource.data };
    }
    if (isStaffReview && currentStudentOption?.name) {
      nextData = {
        ...nextData,
        name: currentStudentOption.name,
        studentName: currentStudentOption.name,
      };
    }
    return nextData;
  }, [
    currentStudentOption?.name,
    gradeFlowMatchesRequest,
    gradeFlowResource.data,
    gradeFlowResource.status,
    isStaffReview,
    profileData,
  ]);

  const handleStudentChange = useCallback((nextEmail) => {
    const nextPath = buildStudentExperiencePath({
      persona: STUDENT_PERSONA.STAFF,
      identifier: nextEmail,
      page: route.page,
      search: mergeStudentRouteQuery(location.search, {
        course_id: stableCourseId || selectedCourse,
      }),
    });
    if (nextPath) navigate(nextPath);
  }, [location.search, navigate, route.page, selectedCourse, stableCourseId]);

  const identityStudent = studentData
    ? {
        name: studentData.studentName || studentData.name || studentName,
        email: fetchEmail,
      }
    : null;
  const headerStatus = studentData ? 'ready' : 'loading';
  const pageLabel = route.page.label || 'student page';

  let content;
  if (route.page.kind === 'unknown') {
    content = (
      <StudentExperienceMessage
        title="Student page not found"
        message="This student page URL is not recognized. Use the student navigation to open a valid page."
        severity="warning"
      />
    );
  } else if (isStaffReview && !route.identifierValid) {
    content = (
      <StudentExperienceMessage
        title="Invalid student link"
        message="The student identifier in this URL is invalid. Return to Class Health and choose a student."
        severity="error"
      />
    );
  } else if (!isStaffReview && !selfIdentifierValid) {
    content = (
      <StudentExperienceMessage
        title="Student identity unavailable"
        message="Your authenticated student identity is unavailable. Sign in again before opening Student Workspace."
        severity="error"
      />
    );
  } else if (coursesResource.status === 'loading') {
    content = <StudentExperienceLoading pageLabel={pageLabel} />;
  } else if (coursesResource.status === 'error') {
    content = (
      <StudentExperienceMessage
        title="Course access unavailable"
        message={coursesResource.error}
        severity="error"
      />
    );
  } else if (coursesResource.status === 'empty' || !selectedCourse) {
    content = (
      <StudentExperienceMessage
        title="No course selected"
        message="No accessible course is available for this student page."
        severity="info"
      />
    );
  } else if (!profileMatchesRequest || profileStatus === 'loading' || profileStatus === 'idle') {
    content = <StudentExperienceLoading pageLabel={pageLabel} />;
  } else if (profileStatus === 'error') {
    content = (
      <StudentExperienceMessage
        title={`Unable to load ${pageLabel}`}
        message={profileResource.error}
        severity="error"
      />
    );
  } else if (profileStatus === 'empty' || !studentData) {
    content = (
      <StudentExperienceMessage
        title="No student data available"
        message="The selected course returned no student profile data. This is not being treated as a zero score."
        severity="info"
      />
    );
  } else {
    content = renderExperiencePage({
      page: route.page,
      studentData,
      fetchEmail,
      currentCourseLabel,
      isStaffReview,
      gradeFlowLoading: (
        route.page.kind === 'explain'
        && !studentData.gradeFlow
        && (!gradeFlowMatchesRequest || gradeFlowResource.status === 'loading')
      ),
      gradeFlowError: gradeFlowMatchesRequest ? gradeFlowResource.error : '',
    });
  }

  return (
    <Box
      className="student-profile-shell"
      sx={{ minHeight: '100%', pb: 4, color: '#111827' }}
      data-persona={route.persona || 'unknown'}
    >
      <StudentReviewHeader
        persona={route.persona}
        courseContext={route.page.courseContext}
        status={headerStatus}
        student={identityStudent}
        requestedIdentifier={fetchEmail}
        currentCourseLabel={currentCourseLabel}
        students={studentsResource.students}
        studentsLoading={!staffListMatchesCourse || studentsResource.status === 'loading'}
        studentsError={staffListMatchesCourse ? studentsResource.error : ''}
        onStudentChange={handleStudentChange}
      />
      {content}
    </Box>
  );
}
