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
import { applyCanonicalSummaryTotals, fetchStudentProfileData } from '../utils/studentProfileData';
import { StudentReportContent } from './studentExperienceV2';

export { applyCanonicalSummaryTotals };

/**
 * StudentProfile Component - Dialog Version
 * Displays the student report in a dialog.
 */
export default function StudentProfile({ open, onClose, studentEmail, studentName, selectedCourse, courses = [] }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [studentData, setStudentData] = useState(null);

  // Load student detailed data
  useEffect(() => {
    if (!open || !studentEmail) {
      setStudentData(null);
      return;
    }

    setLoading(true);
    setError(null);

    const controller = new AbortController();
    let active = true;

    fetchStudentProfileData({
      studentEmail,
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
        setError(err.response?.data?.message || err.response?.data?.error || 'Failed to load student data');
        setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [open, studentEmail, studentName, selectedCourse, courses]);

  return (
    <Dialog 
      open={open} 
      onClose={onClose} 
      aria-labelledby="student-report-dialog-title"
      maxWidth="xl"
      fullWidth
      PaperProps={{
        sx: {
          minHeight: '80vh',
          width: 'calc(100% - 32px)',
          m: 2,
        }
      }}
    >
      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2.5, py: 1.75 }}>
        <DialogTitle id="student-report-dialog-title" sx={{ p: 0, fontWeight: 600 }}>
          Student Report
        </DialogTitle>
          {studentName && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {studentName} ({studentEmail})
            </Typography>
          )}
      </Box>

      <DialogContent
        dividers
        sx={{ p: { xs: 1.5, md: 2 } }}
      >
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
          <StudentReportContent
            studentData={studentData}
            studentEmail={studentEmail}
            currentCourse=""
            staffMode
          />
        )}
      </DialogContent>

      <DialogActions sx={{ borderTop: 1, borderColor: 'divider', px: 2, py: 1.25 }}>
        <Button onClick={onClose} variant="contained">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
