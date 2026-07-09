import React from 'react';
import { Alert, Box, Grid, Paper, Skeleton, Stack, Typography } from '@mui/material';

export function StudentExperienceLoading({ pageLabel = 'student page' }) {
  return (
    <Box role="status" aria-live="polite" aria-busy="true" sx={{ maxWidth: 1240, mx: 'auto' }}>
      <Typography component="h1" variant="h5" sx={{ fontWeight: 750, mb: 2 }}>
        Loading {pageLabel}
      </Typography>
      <Grid container spacing={2}>
        {[0, 1, 2].map((item) => (
          <Grid item xs={12} md={4} key={item}>
            <Paper sx={{ p: 2, minHeight: 128 }}>
              <Stack spacing={1.25}>
                <Skeleton variant="text" width="45%" />
                <Skeleton variant="text" width="70%" height={38} />
                <Skeleton variant="text" width="85%" />
              </Stack>
            </Paper>
          </Grid>
        ))}
      </Grid>
      <Paper sx={{ p: 2.5, mt: 2, minHeight: 240 }}>
        <Stack spacing={1.5}>
          <Skeleton variant="text" width="28%" height={28} />
          <Skeleton variant="rectangular" height={150} />
        </Stack>
      </Paper>
    </Box>
  );
}

export function StudentExperienceMessage({ title, message, severity = 'info' }) {
  return (
    <Box sx={{ maxWidth: 860, mx: 'auto', py: 3 }}>
      <Typography component="h1" variant="h5" sx={{ fontWeight: 750, mb: 2 }}>
        {title}
      </Typography>
      <Alert severity={severity}>{message}</Alert>
    </Box>
  );
}
