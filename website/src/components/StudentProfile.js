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
import { getGradeLevel } from '../utils/studentDataProcessor';
import { applyCanonicalSummaryTotals, fetchStudentProfileData } from '../utils/studentProfileData';
import StudentProfileContent from './StudentProfileContent';

export { applyCanonicalSummaryTotals };

/**
 * StudentProfile Component - Dialog Version
 * Displays detailed student profile in a dialog
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
      maxWidth="lg" 
      fullWidth
      PaperProps={{
        sx: {
          minHeight: '80vh',
        }
      }}
    >
      <DialogTitle sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>Student Profile</Typography>
          {studentName && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {studentName} ({studentEmail})
            </Typography>
          )}
        </Box>
      </DialogTitle>

      <DialogContent
        dividers
        sx={{ p: 3 }}
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
          <StudentProfileContent 
            studentData={studentData} 
            getGradeLevel={getGradeLevel}
          />
        )}
      </DialogContent>

      <DialogActions sx={{ borderTop: 1, borderColor: 'divider' }}>
        <Button onClick={onClose} variant="contained">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
