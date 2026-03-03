// src/components/StudentProfile.js
import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  CircularProgress,
  Alert,
} from '@mui/material';
import apiv2 from '../utils/apiv2';
import {
  processStudentData,
  applyExamPolicyToProcessedData,
  buildQuestComponentTrendFallback,
  buildQuestComponentTrendFromAssignments,
  getGradeLevel,
} from '../utils/studentDataProcessor';
import StudentProfileContent from './StudentProfileContent';

/**
 * StudentProfile Component - Dialog Version
 * Displays detailed student profile in a dialog
 */
export default function StudentProfile({ open, onClose, studentEmail, studentName, selectedCourse, courses = [] }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [studentData, setStudentData] = useState(null);

  const resolveCourseQueryId = (courseId) => {
    if (!courseId) return '';
    const matchedCourse = courses.find((course) => course.id === courseId);
    return matchedCourse?.gradescope_course_id || courseId;
  };

  // Load student detailed data
  useEffect(() => {
    if (!open || !studentEmail) {
      setStudentData(null);
      return;
    }

    setLoading(true);
    setError(null);

    const queryCourseId = resolveCourseQueryId(selectedCourse);
    const courseQuery = queryCourseId ? `?course_id=${encodeURIComponent(queryCourseId)}` : '';
    const gradesQuery = queryCourseId
      ? `/students/${encodeURIComponent(studentEmail)}/grades?format=db&course_id=${encodeURIComponent(queryCourseId)}`
      : `/students/${encodeURIComponent(studentEmail)}/grades?format=db`;

    // Fetch both student grades and class category averages
    Promise.all([
      apiv2.get(gradesQuery),
      apiv2.get(`/students/category-stats${courseQuery}`),
      apiv2.get(`/bins${courseQuery}`),
      apiv2.get(`/students/${encodeURIComponent(studentEmail)}/exam-policy${courseQuery}`),
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
        const processedBase = processStudentData(data, studentEmail, studentName, undefined, classAverages, gradingConfig);
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
        setError(err.response?.data?.message || err.response?.data?.error || 'Failed to load student data');
        setLoading(false);
      });
  }, [open, studentEmail, studentName, selectedCourse, courses]);

  return (
    <Dialog 
      open={open} 
      onClose={onClose} 
      maxWidth="lg" 
      fullWidth
      PaperProps={{
        sx: { minHeight: '80vh' }
      }}
    >
      <DialogTitle sx={{ backgroundColor: '#1976d2', color: 'white' }}>
        <Box>
          <Typography variant="h5" sx={{ color: 'white' }}>Student Profile</Typography>
          {studentName && (
            <Typography variant="subtitle2" sx={{ mt: 1, color: 'rgba(255,255,255,0.9)' }}>
              {studentName} ({studentEmail})
            </Typography>
          )}
        </Box>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 3 }}>
        {loading && (
          <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
            <CircularProgress />
          </Box>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {!loading && !error && studentData && (
          <StudentProfileContent 
            studentData={studentData} 
            getGradeLevel={getGradeLevel}
          />
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} variant="contained">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
