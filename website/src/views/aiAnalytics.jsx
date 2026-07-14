import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  Grid,
  IconButton,
  LinearProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Assessment,
  AutoAwesome,
  InfoOutlined,
  Psychology,
  Search,
  Send,
  Settings,
  Warning,
} from '@mui/icons-material';
import aiAgent from '../services/aiAgent';
import AIAgentSettings from '../components/AIAgentSettings';
import {
  AI_QUERY_STATUS,
  aiQueryReducer,
  createInitialAIQueryState,
  createLiveCourseSource,
  getAIQueryFailurePresentation,
  getAnalyticsSourceLabel,
  resolveAIAnalyticsCourse,
} from '../utils/aiAnalytics';

const SUGGESTED_QUERIES = aiAgent.getSuggestions();

const LIVE_COURSE_ALERT_SX = {
  mb: 3,
  minWidth: 0,
  maxWidth: '100%',
};

const SECTION_SX = {
  p: { xs: 2, sm: 3 },
  borderRadius: '8px',
  boxShadow: 'none',
};

const MODULE_ICON_SX = {
  width: 36,
  height: 36,
  display: 'grid',
  placeItems: 'center',
  flexShrink: 0,
  color: 'text.primary',
  bgcolor: '#F3F4F6',
  borderRadius: '8px',
};

const STATUS_NOTICE_SX = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 1.25,
  px: 2,
  py: 1.5,
  color: 'text.secondary',
  bgcolor: '#F9FAFB',
  border: '1px solid',
  borderColor: 'divider',
  borderRadius: '8px',
};

const LIVE_COURSE_ALERT_SLOT_PROPS = {
  message: {
    style: {
      minWidth: 0,
      overflow: 'visible',
      overflowWrap: 'anywhere',
      wordBreak: 'break-word',
    },
  },
};

const LIVE_COURSE_ID_SX = {
  whiteSpace: 'normal',
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
};

const LIVE_TABLE_CONTAINER_SX = {
  mt: 2,
  width: '100%',
  maxWidth: '100%',
  minWidth: 0,
  overflowX: 'auto',
};

const FAILURE_TITLES = Object.freeze({
  AUTH_REQUIRED: 'Your session could not be verified',
  SESSION_REQUIRED: 'Your session could not be verified',
  COURSE_SCOPE_REQUIRED: 'Select a course before querying',
  COURSE_REQUIRED: 'Select a course before querying',
  COURSE_SCOPE_FORBIDDEN: 'This course query is not permitted',
  DEMO_READ_ONLY: 'This action is unavailable in the read-only demo',
  REQUEST_TIMEOUT: 'The live course query timed out',
  NETWORK_ERROR: 'GradeView could not be reached',
});

function presentQueryFailure(error) {
  const fallback = getAIQueryFailurePresentation(error);
  const code = String(error?.code || 'QUERY_FAILED');
  return {
    ...fallback,
    code,
    title: FAILURE_TITLES[code] || fallback.title,
    message: error?.reason || fallback.message,
    recovery: error?.recovery || fallback.recovery,
  };
}

function formatLiveValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function LiveResultTable({ rows }) {
  if (rows && !Array.isArray(rows) && typeof rows === 'object') {
    const entries = Object.entries(rows);
    if (entries.length === 0) return null;
    return (
      <TableContainer component={Paper} variant="outlined" sx={LIVE_TABLE_CONTAINER_SX}>
        <Table size="small" aria-label="Live AI Analytics result fields">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }}>Metric</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Value</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {entries.map(([key, value]) => (
              <TableRow key={key}>
                <TableCell>{key}</TableCell>
                <TableCell>{formatLiveValue(value)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    );
  }
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const columns = Object.keys(rows[0] || {});

  return (
    <TableContainer component={Paper} variant="outlined" sx={LIVE_TABLE_CONTAINER_SX}>
      <Table size="small" aria-label="Live AI Analytics query rows">
        <TableHead>
          <TableRow>
            {columns.map((column) => (
              <TableCell key={column} sx={{ fontWeight: 700 }}>{column}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, rowIndex) => (
            <TableRow key={row.id || row.email || rowIndex}>
              {columns.map((column) => (
                <TableCell key={column}>{formatLiveValue(row[column])}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function UnavailableLiveModule({ description }) {
  return (
    <Box role="status" sx={STATUS_NOTICE_SX}>
      <InfoOutlined aria-hidden="true" sx={{ fontSize: 20, mt: '1px', flexShrink: 0 }} />
      <Typography variant="body2">
        {description} This page will not substitute sample students or cross-course records for live data.
      </Typography>
    </Box>
  );
}

function ModuleHeader({ id, icon, title, description, headingLevel = 'h2', action = null }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 2,
        mb: 2.5,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, minWidth: 0 }}>
        <Box sx={MODULE_ICON_SX}>{icon}</Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography id={id} component={headingLevel} variant="h6" sx={{ fontWeight: 650, lineHeight: 1.3 }}>
            {title}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {description}
          </Typography>
        </Box>
      </Box>
      {action}
    </Box>
  );
}

export default function AIAnalytics({ selectedCourseId = '', courses = [] }) {
  const courseContext = resolveAIAnalyticsCourse(selectedCourseId, courses);
  const instanceKey = courseContext.courseId || 'no-course';

  return <AIAnalyticsCourse key={instanceKey} courseContext={courseContext} />;
}

function AIAnalyticsCourse({ courseContext }) {
  const { courseId, courseLabel } = courseContext;
  const [queryInput, setQueryInput] = useState('');
  const [queryState, dispatchQuery] = useReducer(
    aiQueryReducer,
    undefined,
    createInitialAIQueryState,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const requestControllerRef = useRef(null);
  const requestIdRef = useRef(0);
  const queryLoading = queryState.status === AI_QUERY_STATUS.LOADING;
  const queryResult = queryState.status === AI_QUERY_STATUS.SUCCESS ? queryState.result : null;

  useEffect(() => {
    if (!courseId) return undefined;
    const schemaController = new AbortController();
    aiAgent.initialize({ courseId, signal: schemaController.signal });
    return () => schemaController.abort();
  }, [courseId]);

  useEffect(() => () => {
    requestIdRef.current += 1;
    requestControllerRef.current?.abort();
  }, []);

  const handleQuery = useCallback(async () => {
    const query = queryInput.trim();
    if (!query || !courseId) return;

    requestControllerRef.current?.abort();
    const controller = new AbortController();
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    requestControllerRef.current = controller;
    dispatchQuery({ type: 'query-started', requestId, query });

    try {
      const result = await aiAgent.processQuery(query, {
        courseId,
        signal: controller.signal,
      });
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;
      dispatchQuery({
        type: 'query-succeeded',
        requestId,
        result,
        source: {
          ...createLiveCourseSource(courseId, courseLabel),
          ...result.source,
          label: courseLabel,
        },
      });
    } catch (error) {
      if (error?.name === 'AbortError' || controller.signal.aborted) return;
      dispatchQuery({
        type: 'query-failed',
        requestId,
        error: presentQueryFailure(error),
      });
    }
  }, [courseId, courseLabel, queryInput]);

  return (
    <Box sx={{ minHeight: '100%', px: { xs: 1.5, sm: 4 }, pt: { xs: 2, sm: 4 }, pb: { xs: 8, sm: 6 } }}>
      <AIAgentSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <Paper
        component="section"
        aria-labelledby="semantic-data-heading"
        elevation={0}
        className="glass-section"
        sx={{
          ...SECTION_SX,
          mb: 3,
        }}
      >
        <ModuleHeader
          id="semantic-data-heading"
          headingLevel="h1"
          icon={<Search aria-hidden="true" sx={{ fontSize: 21 }} />}
          title="Semantic Data Detective"
          description="Natural Language Query Engine - Query live grade data for the current course"
          action={(
            <Tooltip title="AI Agent Settings">
              <IconButton
                aria-label="Open AI Agent settings"
                onClick={() => setSettingsOpen(true)}
                size="small"
                sx={{
                  flexShrink: 0,
                  color: 'text.secondary',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: '6px',
                  '&:hover': { color: 'text.primary', bgcolor: '#F9FAFB' },
                }}
              >
                <Settings fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        />

        {courseId ? (
          <Alert
            severity="info"
            role="status"
            slotProps={LIVE_COURSE_ALERT_SLOT_PROPS}
            sx={LIVE_COURSE_ALERT_SX}
          >
            <AlertTitle>Current live course</AlertTitle>
            <strong>{courseLabel}</strong>. Schema and query requests are scoped to course ID{' '}
            <Box component="code" sx={LIVE_COURSE_ID_SX}>{courseId}</Box>.
          </Alert>
        ) : (
          <Alert severity="info" role="status" sx={{ mb: 3 }}>
            <AlertTitle>No course selected</AlertTitle>
            Choose a course with the global course control to enable live AI Analytics. No sample
            result is shown in place of course data.
          </Alert>
        )}

        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2, mb: 3 }}>
          <TextField
            fullWidth
            label="Ask about the selected course"
            placeholder="Enter your question, e.g., Which assignments are the hardest?"
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleQuery();
            }}
            disabled={queryLoading || !courseId}
          />
          <Button
            variant="contained"
            onClick={handleQuery}
            disabled={queryLoading || !courseId || !queryInput.trim()}
            startIcon={<Send />}
            sx={{
              minWidth: 120,
              minHeight: 44,
            }}
          >
            Run query
          </Button>
        </Box>

        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Try these questions:
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {SUGGESTED_QUERIES.map((query) => (
              <Chip
                key={query}
                label={query}
                disabled={!courseId || queryLoading}
                onClick={() => setQueryInput(query)}
                clickable={Boolean(courseId && !queryLoading)}
                sx={{
                  height: 'auto',
                  maxWidth: '100%',
                  '& .MuiChip-label': {
                    display: 'block',
                    py: { xs: 0.75, sm: 0 },
                    whiteSpace: { xs: 'normal', sm: 'nowrap' },
                  },
                  '&:hover': { bgcolor: '#E5E7EB' },
                }}
              />
            ))}
          </Box>
        </Box>

        {queryState.status === AI_QUERY_STATUS.IDLE && courseId && (
          <Box role="status" sx={STATUS_NOTICE_SX}>
            <InfoOutlined aria-hidden="true" sx={{ fontSize: 20, mt: '1px', flexShrink: 0 }} />
            <Typography variant="body2">
              No live query has run for this course yet. Enter a question or choose an example.
            </Typography>
          </Box>
        )}

        {queryLoading && (
          <Box role="status" aria-live="polite">
            <Typography variant="body2" sx={{ mb: 1 }}>
              Querying live data for {courseLabel}…
            </Typography>
            <LinearProgress aria-label={`Querying ${courseLabel}`} />
          </Box>
        )}

        {queryState.status === AI_QUERY_STATUS.ERROR && (
          <Alert
            severity="error"
            role="alert"
            action={(
              <Button color="inherit" size="small" onClick={handleQuery} disabled={!courseId}>
                Retry query
              </Button>
            )}
          >
            <AlertTitle>{queryState.error.title}</AlertTitle>
            <Typography component="div" variant="body2">
              Code: <strong>{queryState.error.code}</strong>
            </Typography>
            <Typography component="div" variant="body2">
              Reason: {queryState.error.message}
            </Typography>
            <Typography component="div" variant="body2">
              Recovery: {queryState.error.recovery}
            </Typography>
          </Alert>
        )}

        {queryResult && (
          <Paper
            component="section"
            aria-labelledby="live-result-heading"
            elevation={0}
            sx={{
              p: { xs: 2, md: 3 },
              bgcolor: '#F9FAFB',
              borderRadius: '8px',
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 2 }}>
              <AutoAwesome aria-hidden="true" sx={{ color: 'text.primary' }} />
              <Typography id="live-result-heading" component="h2" variant="subtitle1" sx={{ fontWeight: 600 }}>
                Live analysis result
              </Typography>
              <Chip
                size="small"
                color="success"
                variant="outlined"
                label={getAnalyticsSourceLabel(queryState.source)}
              />
            </Box>
            <Typography variant="body1" sx={{ fontWeight: 500 }}>
              {queryResult.answer || 'The live query completed.'}
            </Typography>
            <LiveResultTable rows={queryResult.data} />
            {Array.isArray(queryResult.data) && queryResult.data.length === 0 && (
              <Alert severity="info" role="status" sx={{ mt: 2 }}>
                The live query succeeded but returned no tabular rows.
              </Alert>
            )}
          </Paper>
        )}
      </Paper>

      <Paper
        component="section"
        aria-labelledby="knowledge-gap-heading"
        elevation={0}
        className="glass-section"
        sx={{ ...SECTION_SX, mb: 3 }}
      >
        <ModuleHeader
          id="knowledge-gap-heading"
          icon={<Psychology aria-hidden="true" sx={{ fontSize: 21 }} />}
          title="Knowledge Gap Diagnosis"
          description="Automated Knowledge Gap Discovery - Identify teaching weak points from live evidence"
        />
        <UnavailableLiveModule description="The live API does not currently provide a knowledge-gap dataset." />
      </Paper>

      <Grid container spacing={3}>
        <Grid item xs={12} lg={6}>
          <Paper
            component="section"
            aria-labelledby="student-success-heading"
            elevation={0}
            className="glass-section"
            sx={{ ...SECTION_SX, height: '100%' }}
          >
            <ModuleHeader
              id="student-success-heading"
              icon={<Warning aria-hidden="true" sx={{ fontSize: 21 }} />}
              title="Student Success Alert"
              description="Early identification of at-risk students from live course evidence"
            />
            <UnavailableLiveModule description="The live API does not currently provide a student-risk dataset for this module." />
          </Paper>
        </Grid>

        <Grid item xs={12} lg={6}>
          <Paper
            component="section"
            aria-labelledby="question-quality-heading"
            elevation={0}
            className="glass-section"
            sx={{ ...SECTION_SX, height: '100%' }}
          >
            <ModuleHeader
              id="question-quality-heading"
              icon={<Assessment aria-hidden="true" sx={{ fontSize: 21 }} />}
              title="Question Quality Analysis"
              description="Item Analysis & Exam Audit - Evaluate exam quality using live evidence"
            />
            <UnavailableLiveModule description="The live API does not currently provide item-analysis evidence for this module." />
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
