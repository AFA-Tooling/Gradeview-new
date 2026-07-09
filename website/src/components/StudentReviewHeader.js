import React, { useMemo } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { ArrowBack } from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import { STUDENT_PERSONA, getClassHealthStudentsPath } from '../utils/studentRoutes';

function optionLabel(option) {
  if (!option) return '';
  const name = String(option.name || '').trim();
  const email = String(option.email || '').trim();
  const section = String(option.section || '').trim();
  return [name, email, section].filter(Boolean).join(' — ');
}

export default function StudentReviewHeader({
  persona,
  courseContext = false,
  status = 'loading',
  student = null,
  requestedIdentifier = '',
  currentCourseLabel = '',
  students = [],
  studentsLoading = false,
  studentsError = '',
  onStudentChange,
}) {
  const isStaff = persona === STUDENT_PERSONA.STAFF;
  const selectedOption = useMemo(() => (
    students.find((option) => option.email === requestedIdentifier) || null
  ), [requestedIdentifier, students]);

  return (
    <Box
      sx={{
        mb: 2.5,
        pb: 1.5,
        backgroundColor: '#FFFFFF',
        borderBottom: '1px solid #E5E7EB',
      }}
      data-persona={persona}
    >
      {isStaff && (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.25 }}>
          <Button
            component={RouterLink}
            to={getClassHealthStudentsPath()}
            size="small"
            startIcon={<ArrowBack />}
          >
            Back to Class Health / Students
          </Button>
          <Chip size="small" label="Staff student review" color="primary" variant="outlined" />
        </Stack>
      )}

      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        alignItems={{ xs: 'stretch', md: 'center' }}
        justifyContent="space-between"
      >
        <Box sx={{ minWidth: 0 }} aria-live="polite">
          {courseContext ? (
            <>
              <Typography component="div" variant="h5" sx={{ fontWeight: 750, lineHeight: 1.2 }}>
                Course policy
              </Typography>
              <Typography sx={{ color: '#6B7280', fontSize: 13, mt: 0.35 }}>
                {currentCourseLabel || 'Selected course'}
              </Typography>
            </>
          ) : status === 'loading' ? (
            <Stack spacing={0.75} data-testid="student-identity-skeleton">
              <Skeleton variant="text" width={220} height={32} />
              <Skeleton variant="text" width={310} height={20} />
            </Stack>
          ) : (
            <>
              <Typography
                variant="h5"
                component="div"
                sx={{
                  fontWeight: 750,
                  letterSpacing: 0,
                  lineHeight: 1.2,
                  color: '#111827',
                  overflowWrap: 'anywhere',
                }}
              >
                {student?.name || student?.studentName || 'Student'}
              </Typography>
              <Typography sx={{ color: '#6B7280', fontSize: 13, mt: 0.35, overflowWrap: 'anywhere' }}>
                {student?.email || requestedIdentifier}
                {currentCourseLabel ? ` · ${currentCourseLabel}` : ''}
              </Typography>
            </>
          )}
        </Box>

        {isStaff && !courseContext && (
          <Stack spacing={0.5} sx={{ minWidth: { xs: '100%', sm: 340 } }}>
            <Autocomplete
              value={selectedOption}
              options={students}
              loading={studentsLoading}
              disabled={studentsLoading || students.length === 0}
              onChange={(_event, option) => {
                if (option?.email) onStudentChange?.(option.email);
              }}
              getOptionLabel={optionLabel}
              isOptionEqualToValue={(option, value) => option.email === value.email}
              noOptionsText="No matching students"
              loadingText="Loading students…"
              renderOption={(props, option) => (
                <Box component="li" {...props} key={option.email}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 700, fontSize: 14 }}>{option.name || 'Unnamed student'}</Typography>
                    <Typography sx={{ color: 'text.secondary', fontSize: 12.5, overflowWrap: 'anywhere' }}>
                      {option.email}{option.section ? ` · ${option.section}` : ''}
                    </Typography>
                  </Box>
                </Box>
              )}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Review student"
                  size="small"
                  inputProps={{
                    ...params.inputProps,
                    'aria-label': 'Search students by name or email',
                  }}
                />
              )}
            />
            {studentsError && (
              <Typography role="alert" sx={{ color: 'error.main', fontSize: 12 }}>
                {studentsError}
              </Typography>
            )}
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
