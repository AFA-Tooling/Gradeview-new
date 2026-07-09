// src/views/aiAnalytics.jsx
import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  TextField,
  Button,
  Grid,
  Card,
  CardContent,
  CardActions,
  Chip,
  Alert,
  AlertTitle,
  List,
  ListItem,
  ListItemText,
  LinearProgress,
  Divider,
  IconButton,
  Tooltip,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
} from '@mui/material';
import {
  Search,
  Psychology,
  Warning,
  Assessment,
  Send,
  TrendingUp,
  TrendingDown,
  Help,
  AutoAwesome,
  Lightbulb,
  Settings,
} from '@mui/icons-material';
import aiAgent from '../services/aiAgent';
import AIAgentSettings from '../components/AIAgentSettings';
import {
  AI_QUERY_STATUS,
  SAMPLE_ANALYTICS_SOURCE,
  aiQueryReducer,
  createInitialAIQueryState,
  createLiveCourseSource,
  getAIQueryFailurePresentation,
  getAnalyticsSourceLabel,
  resolveAIAnalyticsCourse,
} from '../utils/aiAnalytics';

const SAMPLE_KNOWLEDGE_GAPS = [
  {
    topic: 'Recursive Functions',
    errorRate: 65,
    affectedStudents: 28,
    commonMistakes: ['Base condition undefined', 'Recursion depth too large', 'Return value error'],
    severity: 'high',
  },
  {
    topic: 'Memory Management',
    errorRate: 48,
    affectedStudents: 21,
    commonMistakes: ['Memory leak', 'Pointer usage error'],
    severity: 'medium',
  },
  {
    topic: 'Algorithm Complexity',
    errorRate: 32,
    affectedStudents: 14,
    commonMistakes: ['Time complexity calculation error'],
    severity: 'low',
  },
];

const SAMPLE_RISK_STUDENTS = [
  {
    name: 'Zhang San',
    email: 'zhang@example.com',
    riskLevel: 'high',
    reasons: ['3 consecutive late submissions', 'Score continuously dropped 15%', 'Did not attend recent Office Hours'],
    currentGrade: 72,
    trend: -8,
  },
  {
    name: 'Li Si',
    email: 'li@example.com',
    riskLevel: 'medium',
    reasons: ['Submission time concentrated 2 hours before deadline', 'Abnormally high code modification frequency'],
    currentGrade: 85,
    trend: -3,
  },
];

const SAMPLE_EXAM_ANALYSIS = [
  {
    questionNumber: 8,
    title: 'Binary Tree Traversal',
    avgTime: 40,
    points: 5,
    discrimination: 0.28,
    difficulty: 0.72,
    issue: 'Time allocation unreasonable',
    recommendation: 'Suggest increasing points to 10 or reducing difficulty',
  },
  {
    questionNumber: 3,
    title: 'Basic Syntax',
    avgTime: 5,
    points: 10,
    discrimination: 0.12,
    difficulty: 0.95,
    issue: 'Discrimination too low',
    recommendation: 'Question too easy, cannot distinguish student abilities',
  },
];

const SUGGESTED_QUERIES = aiAgent.getSuggestions();

/**
 * AI Analytics - 4 Intelligent Analysis Modules
 * 1. Semantic Data Detective
 * 2. Knowledge Gap Diagnosis
 * 3. Student Success Alert
 * 4. Question Quality Analysis
 */
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
        error: getAIQueryFailurePresentation(error),
      });
    }
  }, [courseId, courseLabel, queryInput]);

  // Render data table
  const renderDataTable = (data) => {
    if (!data || data.length === 0) return null;

    const columns = Object.keys(data[0]);

    return (
      <TableContainer component={Paper} sx={{ mt: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              {columns.map((col) => (
                <TableCell key={col} sx={{ fontWeight: 600 }}>
                  {col}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {data.map((row, idx) => (
              <TableRow key={idx}>
                {columns.map((col) => (
                  <TableCell key={col}>
                    {col === 'trend' ? (
                      row[col] === 'up' ? (
                        <TrendingUp sx={{ color: '#10b981', fontSize: 20 }} />
                      ) : (
                        <TrendingDown sx={{ color: '#ef4444', fontSize: 20 }} />
                      )
                    ) : (
                      row[col]
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    );
  };

  return (
    <Box sx={{ minHeight: '100vh', p: 4 }}>
      {/* AI Agent Settings Dialog */}
      <AIAgentSettings 
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      {/* Module 1: Semantic Data Detective */}
      <Paper
        elevation={0}
        className='glass-section'
        sx={{
          p: 4,
          mb: 3,
          borderRadius: 3,
          boxShadow: '0 14px 34px rgba(3, 8, 24, 0.32)'
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 3, justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Search sx={{ fontSize: 32, color: '#4f46e5', mr: 2 }} />
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 600 }}>
                Semantic Data Detective
              </Typography>
              <Typography variant="body2" color="textSecondary">
                Natural Language Query Engine - Query grade data in natural language
              </Typography>
            </Box>
          </Box>
          <Tooltip title="AI Agent Settings">
            <IconButton 
              aria-label="Open AI Agent settings"
              onClick={() => setSettingsOpen(true)}
              sx={{ 
                bgcolor: 'rgba(104, 145, 255, 0.16)',
                '&:hover': { bgcolor: 'rgba(104, 145, 255, 0.26)' }
              }}
            >
              <Settings sx={{ color: '#4f46e5' }} />
            </IconButton>
          </Tooltip>
        </Box>

        {courseId ? (
          <Alert severity="info" sx={{ mb: 3 }}>
            <AlertTitle>Live course query</AlertTitle>
            Results below come from a new query scoped to <strong>{courseLabel}</strong>. Sample
            analytics are hidden while a course is selected.
          </Alert>
        ) : (
          <Alert severity="warning" role="status" aria-live="polite" sx={{ mb: 3 }}>
            <AlertTitle>Select a course to query live data</AlertTitle>
            The query controls are unavailable until a course is selected. Any content in the
            sample section below is demonstration data and is not a course result.
          </Alert>
        )}

        {/* Query input */}
        <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
          <TextField
            fullWidth
            label="Ask about the selected course"
            placeholder="Enter your question, e.g., Find students with the highest grade fluctuation..."
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleQuery()}
            disabled={queryLoading || !courseId}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: 2,
              }
            }}
          />
          <Button
            variant="contained"
            onClick={handleQuery}
            disabled={queryLoading || !courseId || !queryInput.trim()}
            startIcon={<Send />}
            sx={{
              bgcolor: '#4f46e5',
              '&:hover': { bgcolor: '#4338ca' },
              textTransform: 'none',
              minWidth: 120
            }}
          >
            Query
          </Button>
        </Box>

        {/* Suggested queries */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
            Live course query examples:
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {SUGGESTED_QUERIES.map((query) => (
              <Chip
                key={query}
                label={query}
                disabled={!courseId || queryLoading}
                onClick={courseId ? () => setQueryInput(query) : undefined}
                sx={{
                  cursor: 'pointer',
                  '&:hover': { bgcolor: 'rgba(103, 148, 255, 0.24)' }
                }}
              />
            ))}
          </Box>
        </Box>

        {/* Loading */}
        {queryLoading && (
          <Box role="status" aria-live="polite" sx={{ mb: 2 }}>
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
            aria-live="assertive"
            sx={{ mb: 2 }}
            action={(
              <Button color="inherit" size="small" onClick={handleQuery} disabled={!courseId}>
                Retry
              </Button>
            )}
          >
            <AlertTitle>{queryState.error.title}</AlertTitle>
            {queryState.error.message}
            <Typography component="div" variant="body2" sx={{ mt: 1 }}>
              Recovery: {queryState.error.recovery}
            </Typography>
          </Alert>
        )}

        {/* Query results */}
        {queryResult && (
          <Paper 
            elevation={2}
            sx={{ 
              p: 3, 
              bgcolor: 'rgba(79, 118, 255, 0.14)', 
              borderRadius: 2,
              border: '1px solid rgba(122, 214, 255, 0.5)'
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'flex-start', mb: 2 }}>
              <AutoAwesome sx={{ color: '#0ea5e9', mr: 1, mt: 0.5 }} />
              <Box sx={{ flex: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 1 }}>
                  <Typography variant="subtitle2" color="textSecondary">
                    AI Analysis Result
                  </Typography>
                  <Chip
                    size="small"
                    color="success"
                    variant="outlined"
                    label={getAnalyticsSourceLabel(queryState.source)}
                  />
                </Box>
                <Typography variant="body1" sx={{ mb: 2, fontWeight: 500 }}>
                  {queryResult.answer}
                </Typography>

                {/* Render data */}
                {queryResult.data && Array.isArray(queryResult.data) && (
                  renderDataTable(queryResult.data)
                )}

                {/* Render comparison data */}
                {queryResult.data && queryResult.type === 'comparison' && (
                  <Box sx={{ mt: 2 }}>
                    <Grid container spacing={2}>
                      <Grid item xs={6}>
                        <Paper className='glass-section' sx={{ p: 2 }}>
                          <Typography variant="h6" color="primary">
                            {queryResult.data.groupA.name}
                          </Typography>
                          <Typography variant="h4">
                            {queryResult.data.groupA.avgScore}
                          </Typography>
                          <Typography variant="body2" color="textSecondary">
                            Average • {queryResult.data.groupA.studentCount} students
                          </Typography>
                        </Paper>
                      </Grid>
                      <Grid item xs={6}>
                        <Paper className='glass-section' sx={{ p: 2 }}>
                          <Typography variant="h6" color="secondary">
                            {queryResult.data.groupB.name}
                          </Typography>
                          <Typography variant="h4">
                            {queryResult.data.groupB.avgScore}
                          </Typography>
                          <Typography variant="body2" color="textSecondary">
                            Average • {queryResult.data.groupB.studentCount} students
                          </Typography>
                        </Paper>
                      </Grid>
                    </Grid>
                  </Box>
                )}

                {/* Render statistics data */}
                {queryResult.data && queryResult.type === 'statistics' && (
                  <Grid container spacing={2} sx={{ mt: 1 }}>
                    <Grid item xs={4}>
                      <Paper className='glass-section' sx={{ p: 2, textAlign: 'center' }}>
                        <Typography variant="body2" color="textSecondary">Average</Typography>
                        <Typography variant="h5">{queryResult.data.mean}</Typography>
                      </Paper>
                    </Grid>
                    <Grid item xs={4}>
                      <Paper className='glass-section' sx={{ p: 2, textAlign: 'center' }}>
                        <Typography variant="body2" color="textSecondary">Median</Typography>
                        <Typography variant="h5">{queryResult.data.median}</Typography>
                      </Paper>
                    </Grid>
                    <Grid item xs={4}>
                      <Paper className='glass-section' sx={{ p: 2, textAlign: 'center' }}>
                        <Typography variant="body2" color="textSecondary">Std Dev</Typography>
                        <Typography variant="h5">{queryResult.data.stdDev ?? queryResult.data.std_dev}</Typography>
                      </Paper>
                    </Grid>
                  </Grid>
                )}

                {/* AI Suggestions */}
                {queryResult.suggestions && queryResult.suggestions.length > 0 && (
                  <Box sx={{ mt: 3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                      <Lightbulb sx={{ color: '#f59e0b', fontSize: 20, mr: 1 }} />
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        Suggestions
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      {queryResult.suggestions.map((suggestion, idx) => (
                        <Chip
                          key={idx}
                          label={suggestion}
                          size="small"
                          sx={{
                            bgcolor: 'rgba(96, 132, 255, 0.18)',
                            border: '1px solid rgba(122, 214, 255, 0.42)',
                            '&:hover': { bgcolor: 'rgba(96, 132, 255, 0.28)', cursor: 'pointer' }
                          }}
                        />
                      ))}
                    </Box>
                  </Box>
                )}
              </Box>
            </Box>
          </Paper>
        )}
      </Paper>

      {!courseId && (
      <Box component="section" aria-labelledby="sample-data-heading">
      <Paper
        elevation={0}
        className="glass-section"
        sx={{ p: 3, mb: 3, border: '2px dashed rgba(245, 158, 11, 0.55)', borderRadius: 3 }}
      >
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography id="sample-data-heading" variant="h5" sx={{ fontWeight: 700 }}>
            Sample data
          </Typography>
          <Chip
            color="warning"
            variant="outlined"
            label={getAnalyticsSourceLabel(SAMPLE_ANALYTICS_SOURCE)}
          />
        </Box>
        <Typography variant="body2">
          The demonstrations in this section are static examples. They are not generated from a
          selected course and never appear alongside live course results.
        </Typography>
      </Paper>

      {/* Module 2: Sample Knowledge Gap Diagnosis */}
      <Paper
        elevation={0}
        className='glass-section'
        sx={{
          p: 4,
          mb: 3,
          borderRadius: 3,
          boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
          <Psychology sx={{ fontSize: 32, color: '#ec4899', mr: 2 }} />
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 600 }}>
              Knowledge Gap Diagnosis
            </Typography>
            <Typography variant="body2" color="textSecondary">
              Automated Knowledge Gap Discovery - Automatically identify teaching weak points
            </Typography>
          </Box>
        </Box>

        <Grid container spacing={3}>
          {SAMPLE_KNOWLEDGE_GAPS.map((gap) => (
            <Grid item xs={12} md={4} key={gap.topic}>
              <Card
                elevation={0}
                sx={{
                  border: '1px solid rgba(255,255,255,0.16)',
                  borderRadius: 2,
                  height: '100%',
                  borderLeft: `4px solid ${
                    gap.severity === 'high' ? '#ef4444' :
                    gap.severity === 'medium' ? '#f59e0b' : '#10b981'
                  }`
                }}
              >
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                    <Typography variant="h6" sx={{ fontWeight: 600 }}>
                      {gap.topic}
                    </Typography>
                    <Chip
                      label={`${gap.errorRate}%`}
                      size="small"
                      sx={{
                        bgcolor: `${
                          gap.severity === 'high' ? '#ef444420' :
                          gap.severity === 'medium' ? '#f59e0b20' : '#10b98120'
                        }`,
                        color: gap.severity === 'high' ? '#ef4444' :
                               gap.severity === 'medium' ? '#f59e0b' : '#10b981',
                        fontWeight: 600
                      }}
                    />
                  </Box>
                  <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                    {gap.affectedStudents} students affected
                  </Typography>
                  <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                    Common mistakes:
                  </Typography>
                  <List dense>
                    {gap.commonMistakes.map((mistake, i) => (
                      <ListItem key={i} sx={{ py: 0.5 }}>
                        <ListItemText
                          primary={`• ${mistake}`}
                          primaryTypographyProps={{ variant: 'body2' }}
                        />
                      </ListItem>
                    ))}
                  </List>
                </CardContent>
                <CardActions>
                  <Button size="small" disabled sx={{ textTransform: 'none' }}>
                    View Details
                  </Button>
                  <Button size="small" disabled sx={{ textTransform: 'none' }}>
                    Generate Teaching Recommendations
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Paper>

      <Grid container spacing={3}>
        {/* Module 3: Student Success Alert */}
        <Grid item xs={12} lg={6}>
          <Paper
            elevation={0}
            className='glass-section'
            sx={{
              p: 4,
              borderRadius: 3,
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
              height: '100%'
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
              <Warning sx={{ fontSize: 32, color: '#f59e0b', mr: 2 }} />
              <Box>
                <Typography variant="h5" sx={{ fontWeight: 600 }}>
                  Student Success Alert
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  Predictive Student Success Plan - Early identification of at-risk students
                </Typography>
              </Box>
            </Box>

            {SAMPLE_RISK_STUDENTS.map((student) => (
              <Paper
                key={student.email}
                sx={{
                  p: 3,
                  mb: 2,
                  bgcolor: 'rgba(245, 158, 11, 0.14)',
                  border: '1px solid rgba(251, 191, 36, 0.45)',
                  borderRadius: 2
                }}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                  <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                      {student.name}
                    </Typography>
                    <Typography variant="body2" color="textSecondary">
                      {student.email}
                    </Typography>
                  </Box>
                  <Box sx={{ textAlign: 'right' }}>
                    <Chip
                      label={student.riskLevel === 'high' ? 'High Risk' : 'Medium Risk'}
                      size="small"
                      sx={{
                        bgcolor: student.riskLevel === 'high' ? '#ef4444' : '#f59e0b',
                        color: 'white',
                        fontWeight: 600,
                        mb: 0.5
                      }}
                    />
                    <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center' }}>
                      Current: {student.currentGrade}
                      {student.trend < 0 ? (
                        <TrendingDown sx={{ color: '#ef4444', fontSize: 18, ml: 0.5 }} />
                      ) : (
                        <TrendingUp sx={{ color: '#10b981', fontSize: 18, ml: 0.5 }} />
                      )}
                      <span style={{ color: student.trend < 0 ? '#ef4444' : '#10b981' }}>
                        {student.trend > 0 ? '+' : ''}{student.trend}
                      </span>
                    </Typography>
                  </Box>
                </Box>

                <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                  Risk factors:
                </Typography>
                <List dense>
                  {student.reasons.map((reason, i) => (
                    <ListItem key={i} sx={{ py: 0 }}>
                      <ListItemText
                        primary={`• ${reason}`}
                        primaryTypographyProps={{ variant: 'body2' }}
                      />
                    </ListItem>
                  ))}
                </List>

                <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
                  <Button
                    size="small"
                    variant="contained"
                    disabled
                    startIcon={<AutoAwesome />}
                    sx={{
                      bgcolor: '#4f46e5',
                      '&:hover': { bgcolor: '#4338ca' },
                      textTransform: 'none'
                    }}
                  >
                    Generate Intervention Email
                  </Button>
                  <Button size="small" variant="outlined" disabled sx={{ textTransform: 'none' }}>
                    View Details
                  </Button>
                </Box>
              </Paper>
            ))}

            <Alert severity="info" sx={{ mt: 2 }}>
              Sample includes {SAMPLE_RISK_STUDENTS.length} fictional students
            </Alert>
          </Paper>
        </Grid>

        {/* Module 4: Question Quality Analysis */}
        <Grid item xs={12} lg={6}>
          <Paper
            elevation={0}
            className='glass-section'
            sx={{
              p: 4,
              borderRadius: 3,
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
              height: '100%'
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
              <Assessment sx={{ fontSize: 32, color: '#06b6d4', mr: 2 }} />
              <Box>
                <Typography variant="h5" sx={{ fontWeight: 600 }}>
                  Question Quality Analysis
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  Item Analysis & Exam Audit - Scientifically evaluate exam quality
                </Typography>
              </Box>
            </Box>

            {SAMPLE_EXAM_ANALYSIS.map((item) => (
              <Paper
                key={item.questionNumber}
                sx={{
                  p: 3,
                  mb: 2,
                  bgcolor: 'rgba(20, 184, 219, 0.12)',
                  border: '1px solid rgba(34, 211, 238, 0.42)',
                  borderRadius: 2
                }}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    Question {item.questionNumber}: {item.title}
                  </Typography>
                  <Chip
                    icon={<Help />}
                    label={item.issue}
                    size="small"
                    sx={{
                      bgcolor: 'rgba(245, 158, 11, 0.18)',
                      color: '#ffd27d',
                      fontWeight: 600
                    }}
                  />
                </Box>

                <Grid container spacing={2} sx={{ mb: 2 }}>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="textSecondary">
                      Avg Time
                    </Typography>
                    <Typography variant="h6">{item.avgTime} min</Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="textSecondary">
                      Points
                    </Typography>
                    <Typography variant="h6">{item.points} pts</Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="textSecondary">
                      Discrimination
                    </Typography>
                    <Typography variant="h6">{item.discrimination}</Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="textSecondary">
                      Difficulty
                    </Typography>
                    <Typography variant="h6">{item.difficulty}</Typography>
                  </Grid>
                </Grid>

                <Divider sx={{ my: 2 }} />

                <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600, color: '#0ea5e9' }}>
                  💡 Optimization Suggestion:
                </Typography>
                <Typography variant="body2">
                  {item.recommendation}
                </Typography>
              </Paper>
            ))}

            <Button
              fullWidth
              variant="outlined"
              disabled
              sx={{
                mt: 2,
                textTransform: 'none',
                borderColor: '#06b6d4',
                color: '#06b6d4',
                '&:hover': {
                  borderColor: '#0891b2',
                  bgcolor: 'rgba(20, 184, 219, 0.14)'
                }
              }}
            >
              View Complete Exam Analysis Report
            </Button>
          </Paper>
        </Grid>
      </Grid>
      </Box>
      )}
    </Box>
  );
}
