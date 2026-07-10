import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
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
  AutoAwesome,
  Search,
  Send,
  Settings,
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

function LiveResultTable({ rows }) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const columns = Object.keys(rows[0] || {});

  return (
    <TableContainer component={Paper} variant="outlined" sx={{ mt: 2 }}>
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
                <TableCell key={column}>{String(row[column] ?? '')}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
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
    <Box sx={{ minHeight: '100%', p: { xs: 2, md: 4 } }}>
      <AIAgentSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <Paper
        component="section"
        aria-labelledby="ai-analytics-heading"
        elevation={0}
        className="glass-section"
        sx={{ p: { xs: 2.5, md: 4 }, borderRadius: 3 }}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Search aria-hidden="true" sx={{ fontSize: 32, color: '#4f46e5' }} />
            <Box>
              <Typography id="ai-analytics-heading" component="h1" variant="h5" sx={{ fontWeight: 700 }}>
                AI Analytics
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Run a course-scoped natural-language query. Only a new successful request is shown as live data.
              </Typography>
            </Box>
          </Box>
          <Tooltip title="AI Agent Settings">
            <IconButton aria-label="Open AI Agent settings" onClick={() => setSettingsOpen(true)}>
              <Settings />
            </IconButton>
          </Tooltip>
        </Box>

        {courseId ? (
          <Alert severity="info" role="status" sx={{ mb: 3 }}>
            <AlertTitle>Current live course</AlertTitle>
            <strong>{courseLabel}</strong>. Schema and query requests are scoped to course ID{' '}
            <code>{courseId}</code>.
          </Alert>
        ) : (
          <Alert severity="info" role="status" sx={{ mb: 3 }}>
            <AlertTitle>No course selected</AlertTitle>
            Choose a course with the global course control to enable live AI Analytics. No sample
            result is shown in place of course data.
          </Alert>
        )}

        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2, mb: 2 }}>
          <TextField
            fullWidth
            label="Ask about the selected course"
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
            sx={{ minWidth: 120 }}
          >
            Run query
          </Button>
        </Box>

        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Course query examples
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {SUGGESTED_QUERIES.map((query) => (
              <Chip
                key={query}
                label={query}
                disabled={!courseId || queryLoading}
                onClick={() => setQueryInput(query)}
                clickable={Boolean(courseId && !queryLoading)}
              />
            ))}
          </Box>
        </Box>

        {queryState.status === AI_QUERY_STATUS.IDLE && courseId && (
          <Alert severity="info" role="status">
            No live query has run for this course yet. Enter a question or choose an example.
          </Alert>
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
            variant="outlined"
            sx={{ p: 3, borderColor: 'success.main' }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 2 }}>
              <AutoAwesome aria-hidden="true" color="success" />
              <Typography id="live-result-heading" component="h2" variant="h6">
                Live analysis result
              </Typography>
              <Chip
                size="small"
                color="success"
                variant="outlined"
                label={getAnalyticsSourceLabel(queryState.source)}
              />
            </Box>
            <Typography variant="body1">{queryResult.answer || 'The live query completed.'}</Typography>
            <LiveResultTable rows={queryResult.data} />
            {Array.isArray(queryResult.data) && queryResult.data.length === 0 && (
              <Alert severity="info" role="status" sx={{ mt: 2 }}>
                The live query succeeded but returned no tabular rows.
              </Alert>
            )}
          </Paper>
        )}
      </Paper>
    </Box>
  );
}
