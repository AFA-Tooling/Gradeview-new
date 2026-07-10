import React, { memo, useCallback, useMemo, useState } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  FormControl,
  Grid,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import {
  ArrowForward,
  AssignmentOutlined,
  CheckCircleOutline,
  ContentCopy,
  Done,
  DownloadOutlined,
  ExpandMore,
  InsightsOutlined,
  OpenInNew,
  Print,
  Search,
  TimelineOutlined,
  TrendingUp,
} from '@mui/icons-material';
import {
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  PointElement,
  RadialLinearScale,
  Tooltip as ChartTooltip,
} from 'chart.js';
import { Radar as ChartRadar } from 'react-chartjs-2';
import GradeDataFlow from './GradeDataFlow';
import StudentProfileContent from './StudentProfileContent';
import ConceptMap from '../views/conceptMap';
import {
  CATEGORY_DEFINITIONS,
  EVIDENCE_STATUSES,
  buildCategoryPresentation,
  buildCategoryPresentations,
  buildLedgerCsv,
  buildLedgerHref,
  buildRecentSignals,
  buildTopActions,
  filterLedgerRows,
  formatAttemptCount,
  formatCourseDateTime,
  formatEvidenceScore,
  formatPoints as formatContractPoints,
  formatPercentage as formatContractPercentage,
  getActualClobberRows,
  getAssignmentEvidence,
  getBestExamRow as getContractBestExamRow,
  getCanonicalStanding,
  getEvidenceStatusMeta,
  getExamDiagnosticPercentage,
  getExamRows as getContractExamRows,
  getExamTrend as getContractExamTrend,
  getGradeSnapshot as getCanonicalGradeSnapshot,
  getLedgerGroupLabel,
  getMostImportantCategory,
  mergeExperienceQuery,
  optionalNumber,
  parseCategoryPageQuery,
  parseExamMode,
  parseExamSelection,
  parseLedgerQuery,
  percentageToPoints as contractPercentageToPoints,
  sortLedgerRows,
} from './studentExperienceModel';

ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, ChartTooltip, Legend);

const colors = {
  ink: '#111827',
  muted: '#6B7280',
  soft: '#9CA3AF',
  border: '#E5E7EB',
  borderStrong: '#D1D5DB',
  bg: '#FAFAFB',
  surface: '#FFFFFF',
  band: '#F9FAFB',
  blue: '#4788B8',
  blueDark: '#2F6F9E',
  green: '#0F766E',
  greenBg: '#ECFDF5',
  amber: '#B45309',
  amberBg: '#FFFBEB',
  red: '#BE123C',
  redBg: '#FFF1F2',
};

const panelSx = {
  backgroundColor: colors.surface,
  backgroundImage: 'none',
  border: `1px solid ${colors.border}`,
  borderRadius: 2,
  boxShadow: 'none',
};

const sectionTitleSx = {
  color: colors.ink,
  fontWeight: 750,
  letterSpacing: 0,
  lineHeight: 1.2,
};

const CATEGORY_DEFS = CATEGORY_DEFINITIONS;

const EXAM_DEFS = CATEGORY_DEFS.filter((item) => item.type === 'exam');
const CATEGORY_BY_KEY = new Map(CATEGORY_DEFS.map((item) => [item.key, item]));

function safeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function formatPoints(value, digits = 1) {
  if (value === null || value === undefined || value === '') return 'Unavailable';
  const numeric = safeNumber(value);
  if (Number.isInteger(numeric)) return String(numeric);
  return numeric.toFixed(digits);
}

function formatPercentage(value, digits = 1) {
  if (value === null || value === undefined || value === '') return 'Unavailable';
  return `${safeNumber(value).toFixed(digits)}%`;
}

function getGradeSnapshot(studentData) {
  return {
    ...getCanonicalGradeSnapshot(studentData),
    bins: Array.isArray(studentData?.gradeBins) ? studentData.gradeBins : [],
  };
}

function findCategoryDefForAssignment(assignment) {
  const haystack = `${assignment?.category || ''} ${assignment?.name || ''}`;
  return CATEGORY_DEFS.find((def) => def.match.test(haystack)) || null;
}

function getCategoryBlock(studentData, key) {
  return buildCategoryPresentation(studentData, key);
}

function getWorkspaceBlocks(studentData) {
  return buildCategoryPresentations(studentData);
}

function getCategoryAssignments(studentData, key) {
  return buildCategoryPresentation(studentData, key)?.evidenceRows || [];
}

function getRecentSignals(studentData) {
  return buildRecentSignals(studentData);
}

function getImportantCategory(blocks = []) {
  return getMostImportantCategory(blocks);
}

function getTopActions(studentData) {
  return buildTopActions(studentData);
}

function getExamRows(studentData, examKey) {
  return getContractExamRows(studentData, examKey);
}

function getExamTrend(studentData, examKey) {
  return getContractExamTrend(studentData, examKey);
}

function getBestExamRow(rows = []) {
  return getContractBestExamRow(rows);
}

function percentageToPoints(percentage, cap) {
  return contractPercentageToPoints(percentage, cap);
}

function StatusChip({ status }) {
  if (status === 'clobbered') {
    return <Chip size="small" label="Clobbered" sx={{ backgroundColor: '#EEF2FF', color: '#4338CA', fontWeight: 700 }} />;
  }
  const meta = getEvidenceStatusMeta(status);
  const tone = meta.tone === 'error'
    ? { bg: colors.redBg, color: colors.red }
    : meta.tone === 'warning'
      ? { bg: colors.amberBg, color: colors.amber }
      : meta.tone === 'success'
        ? { bg: colors.greenBg, color: colors.green }
        : { bg: colors.band, color: colors.muted };
  return <Chip size="small" label={meta.label} sx={{ backgroundColor: tone.bg, color: tone.color, fontWeight: 700 }} />;
}

function PageFrame({ title, subtitle, actions, children }) {
  return (
    <Box sx={{ maxWidth: 1240, mx: 'auto', width: '100%' }}>
      <Stack spacing={2.5}>
        <Stack spacing={1.5}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.5}
            alignItems={{ xs: 'stretch', md: 'flex-start' }}
            justifyContent="space-between"
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h5" component="h1" sx={sectionTitleSx}>
                {title}
              </Typography>
              {subtitle && (
                <Typography sx={{ mt: 0.5, color: colors.muted, fontSize: 14, lineHeight: 1.5 }}>
                  {subtitle}
                </Typography>
              )}
            </Box>
            {actions && (
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap justifyContent={{ xs: 'flex-start', md: 'flex-end' }}>
                {actions}
              </Stack>
            )}
          </Stack>
        </Stack>
        {children}
      </Stack>
    </Box>
  );
}

function SectionPanel({ title, subtitle, action, children, sx }) {
  return (
    <Paper elevation={0} sx={{ ...panelSx, p: { xs: 2, md: 2.5 }, ...sx }}>
      <Stack spacing={2}>
        {(title || subtitle || action) && (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
            <Box sx={{ minWidth: 0 }}>
              {title && <Typography variant="h6" sx={{ ...sectionTitleSx, fontSize: 17 }}>{title}</Typography>}
              {subtitle && <Typography sx={{ color: colors.muted, fontSize: 13, mt: 0.25 }}>{subtitle}</Typography>}
            </Box>
            {action}
          </Stack>
        )}
        {children}
      </Stack>
    </Paper>
  );
}

function LoadingStudentPage({ title }) {
  return (
    <PageFrame title={title} subtitle="Waiting for the selected student's canonical grade and assignment evidence.">
      <Alert severity="info">Loading student data…</Alert>
    </PageFrame>
  );
}

function MetricTile({ label, value, caption, to, icon, emphasized = false }) {
  const content = (
    <Paper
      elevation={0}
      sx={{
        ...panelSx,
        p: 2,
        height: '100%',
        color: colors.ink,
        borderColor: emphasized ? colors.borderStrong : colors.border,
        backgroundColor: emphasized ? colors.band : colors.surface,
        textDecoration: 'none',
        transition: 'border-color 140ms ease, background-color 140ms ease',
        '&:hover': to ? { borderColor: colors.borderStrong, backgroundColor: colors.band } : undefined,
      }}
    >
      <Stack direction="row" spacing={1.2} justifyContent="space-between" alignItems="flex-start">
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ color: colors.muted, fontSize: 12, fontWeight: 750 }}>{label}</Typography>
          <Typography sx={{ color: colors.ink, fontSize: emphasized ? 30 : 24, fontWeight: 800, lineHeight: 1.15, mt: 0.5 }}>
            {value}
          </Typography>
          {caption && <Typography sx={{ color: colors.muted, fontSize: 12.5, mt: 0.75 }}>{caption}</Typography>}
        </Box>
        {icon && (
          <Box sx={{ color: colors.muted, flexShrink: 0, mt: 0.25 }}>
            {icon}
          </Box>
        )}
      </Stack>
    </Paper>
  );

  if (!to) return content;
  return (
    <Box component={RouterLink} to={to} sx={{ textDecoration: 'none', display: 'block', height: '100%' }}>
      {content}
    </Box>
  );
}

function CategoryNavigationCard({ block }) {
  const score = block.exactScore;
  const cap = block.cap;
  const percentage = block.percentage;
  const statusCounts = block.summary?.statusCounts || {};
  const missingItems = statusCounts.missing || 0;
  const submittedItems = (statusCounts.submitted || 0) + (statusCounts.earned_zero || 0);
  const totalItems = block.summary?.totalItems || 0;
  const incompleteItems = (statusCounts.due_unknown || 0)
    + (statusCounts.not_synced || 0)
    + (statusCounts.request_error || 0);
  const route = block.route || CATEGORY_BY_KEY.get(block.key)?.route || '/profile/assignments';
  return (
    <Paper
      component={RouterLink}
      to={route}
      elevation={0}
      sx={{
        ...panelSx,
        p: 2,
        height: '100%',
        display: 'block',
        textDecoration: 'none',
        color: colors.ink,
        '&:hover': {
          borderColor: colors.borderStrong,
          backgroundColor: colors.band,
        },
      }}
    >
      <Stack spacing={1.35} sx={{ height: '100%' }}>
        <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="flex-start">
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 800, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {block.label}
            </Typography>
            <Typography sx={{ color: colors.muted, fontSize: 12.5, mt: 0.35 }}>
              {percentage == null ? 'Final policy unavailable' : `${formatContractPercentage(percentage)} final policy`}
            </Typography>
          </Box>
          <ArrowForward sx={{ color: colors.soft, fontSize: 18, mt: 0.25 }} />
        </Stack>
        <Box>
          <LinearProgress
            variant={percentage == null ? 'indeterminate' : 'determinate'}
            value={percentage == null ? undefined : Math.max(0, Math.min(100, percentage))}
            sx={{
              height: 6,
              borderRadius: 1,
              backgroundColor: '#EEF0F4',
              '& .MuiLinearProgress-bar': {
                backgroundColor: colors.ink,
                borderRadius: 1,
              },
            }}
          />
          <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.8 }}>
            <Typography sx={{ color: colors.ink, fontSize: 13, fontWeight: 750 }}>
              {score == null || cap == null
                ? 'Unavailable'
                : `${formatContractPoints(score)} / ${formatContractPoints(cap)}`}
            </Typography>
            <Typography sx={{ color: colors.muted, fontSize: 12.5 }}>
              {totalItems > 0 ? `${submittedItems}/${totalItems} with submissions` : 'Evidence unavailable'}
            </Typography>
          </Stack>
        </Box>
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 'auto' }}>
          {missingItems > 0 && <Chip size="small" label={`${missingItems} missing`} sx={{ backgroundColor: colors.redBg, color: colors.red, fontWeight: 700 }} />}
          {incompleteItems > 0 && <Chip size="small" label={`${incompleteItems} incomplete metadata`} sx={{ backgroundColor: colors.amberBg, color: colors.amber, fontWeight: 700 }} />}
          {totalItems > 0 && missingItems === 0 && incompleteItems === 0 && (
            <Chip size="small" label="Evidence complete" sx={{ backgroundColor: colors.band, color: colors.muted, fontWeight: 700 }} />
          )}
          {totalItems === 0 && (
            <Chip size="small" label="No catalog evidence" sx={{ backgroundColor: colors.band, color: colors.muted, fontWeight: 700 }} />
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}

export function StudentWorkspaceHome({ studentData }) {
  const blocks = useMemo(() => getWorkspaceBlocks(studentData), [studentData]);
  const gradeSnapshot = useMemo(() => getGradeSnapshot(studentData), [studentData]);
  const importantCategory = useMemo(() => getImportantCategory(blocks), [blocks]);
  const actions = useMemo(() => getTopActions(studentData), [studentData]);
  const signals = useMemo(() => getRecentSignals(studentData), [studentData]);
  const evidenceRows = useMemo(() => getAssignmentEvidence(studentData), [studentData]);

  if (!studentData) return <LoadingStudentPage title="Student Workspace" />;

  return (
    <PageFrame
      active="workspace"
      title="Student Workspace"
      subtitle="Current standing, the grading area with the highest impact, and the next few things to do."
    >
      <Grid container spacing={2}>
        <Grid item xs={12} md={5}>
          <MetricTile
            emphasized
            label="Final standing"
            value={gradeSnapshot.displayScore == null || gradeSnapshot.cap == null
              ? 'Unavailable'
              : `${formatContractPoints(gradeSnapshot.displayScore)} / ${formatContractPoints(gradeSnapshot.cap)}`}
            caption={gradeSnapshot.currentGrade
              ? `Current grade: ${gradeSnapshot.currentGrade}${gradeSnapshot.currentRange ? ` (${gradeSnapshot.currentRange})` : ''}`
              : 'Canonical policy-final standing is unavailable.'}
            to="/profile/explain"
            icon={<TrendingUp fontSize="small" />}
          />
        </Grid>
        <Grid item xs={12} md={3}>
          <MetricTile
            label="Next grade gap"
            value={gradeSnapshot.pointsToNext == null ? 'Unavailable' : (gradeSnapshot.nextGrade ? `${formatContractPoints(gradeSnapshot.pointsToNext)} pts` : 'Top bin')}
            caption={gradeSnapshot.pointsToNext == null
              ? 'A canonical display score is required before calculating a gap.'
              : gradeSnapshot.nextGrade
                ? `Needed for ${gradeSnapshot.nextGrade} at ${formatContractPoints(gradeSnapshot.nextThreshold)} pts`
                : 'No higher grade bin is currently configured.'}
            to="/profile/explain"
            icon={<TimelineOutlined fontSize="small" />}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <MetricTile
            label="Most important area"
            value={importantCategory?.label || 'No category data'}
            caption={importantCategory?.importanceReason || 'Canonical category summaries are unavailable.'}
            to={importantCategory?.route || '/profile/assignments'}
            icon={<InsightsOutlined fontSize="small" />}
          />
        </Grid>
      </Grid>

      <SectionPanel title="Category Summary" subtitle="Use these cards as the main route into focused grading pages.">
        <Grid container spacing={2}>
          {blocks.map((block) => (
            <Grid key={block.key} item xs={12} sm={6} lg={4}>
              <CategoryNavigationCard block={block} />
            </Grid>
          ))}
        </Grid>
      </SectionPanel>

      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <SectionPanel title="Top Actions" subtitle="Highest-signal next steps from the current data.">
            <Stack spacing={1}>
              {actions.length === 0 ? (
                <Alert severity={evidenceRows.length === 0 ? 'warning' : 'info'}>
                  {evidenceRows.length === 0
                    ? 'No assignment catalog evidence is available, so actionable work cannot be ranked yet.'
                    : 'No concrete missing, zero, late, sync, or timing action is present in the catalog evidence.'}
                </Alert>
              ) : actions.map((action) => (
                <Paper
                  key={action.key}
                  component={RouterLink}
                  to={action.to}
                  elevation={0}
                  sx={{
                    p: 1.5,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 1.5,
                    backgroundColor: colors.surface,
                    textDecoration: 'none',
                    color: colors.ink,
                    '&:hover': { backgroundColor: colors.band, borderColor: colors.borderStrong },
                  }}
                >
                  <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="space-between">
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 750, lineHeight: 1.25 }}>{action.title}</Typography>
                      <Typography sx={{ color: colors.muted, fontSize: 13, mt: 0.25 }}>{action.detail}</Typography>
                    </Box>
                    <ArrowForward sx={{ color: colors.soft, fontSize: 18, flexShrink: 0 }} />
                  </Stack>
                </Paper>
              ))}
            </Stack>
          </SectionPanel>
        </Grid>
        <Grid item xs={12} md={6}>
          <SectionPanel title="Recent Signals" subtitle="Missing, earned-zero, timing, sync, and request-error evidence.">
            <Stack spacing={1}>
              {signals.length === 0 ? (
                <Alert severity={evidenceRows.length === 0 ? 'warning' : 'info'}>
                  {evidenceRows.length === 0
                    ? 'Risk signals are unavailable because no assignment catalog evidence was returned.'
                    : 'No missing, earned-zero, late, sync, timing, or request-error signals are present.'}
                </Alert>
              ) : signals.slice(0, 5).map((signal) => {
                const meta = getEvidenceStatusMeta(signal.evidenceStatus, signal);
                return (
                <Stack
                  key={`${signal.assignmentId}-${signal.evidenceStatus}`}
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  justifyContent="space-between"
                  sx={{ py: 1, borderBottom: `1px solid ${colors.border}` }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ color: colors.ink, fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {signal.name}
                    </Typography>
                    <Typography sx={{ color: colors.muted, fontSize: 12.5 }}>
                      {signal.category} · {meta.reason} · {formatEvidenceScore(signal)}
                    </Typography>
                  </Box>
                  <StatusChip status={signal.evidenceStatus} />
                </Stack>
                );
              })}
            </Stack>
          </SectionPanel>
        </Grid>
      </Grid>
    </PageFrame>
  );
}

function buildReportSummary(studentData, studentEmail, currentCourse) {
  const blocks = getWorkspaceBlocks(studentData);
  const grade = getGradeSnapshot(studentData);
  const weak = getImportantCategory(blocks);
  return [
    `Student: ${studentData?.studentName || studentData?.name || studentEmail || 'Unknown'}`,
    currentCourse ? `Course: ${currentCourse}` : '',
    grade.displayScore == null || grade.cap == null
      ? 'Current standing: unavailable'
      : `Current standing: ${formatContractPoints(grade.displayScore)} / ${formatContractPoints(grade.cap)} (${grade.currentGrade || 'letter unavailable'})`,
    grade.nextGrade ? `Next grade gap: ${grade.pointsToNext} pts to ${grade.nextGrade}` : 'Next grade gap: top configured bin',
    weak ? `Highest-impact area: ${weak.label}` : '',
  ].filter(Boolean).join('\n');
}

export function StudentReportContent({ studentData, studentEmail, currentCourse, staffMode = false }) {
  const [reviewed, setReviewed] = useState(false);
  const [notes, setNotes] = useState('');
  const [copied, setCopied] = useState(false);
  const gradeSnapshot = useMemo(() => getGradeSnapshot(studentData), [studentData]);
  const summary = useMemo(() => buildReportSummary(studentData, studentEmail, currentCourse), [studentData, studentEmail, currentCourse]);

  const copySummary = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (err) {
      console.error('Unable to copy report summary:', err);
    }
  }, [summary]);

  if (!studentData) return <LoadingStudentPage title="Student Report" />;

  return (
    <PageFrame
      active="report"
      title="Student Report"
      subtitle={staffMode
        ? 'One-page staff review of the canonical policy-final standing and assignment evidence.'
        : 'Your canonical policy-final standing, category evidence, exam diagnostics, and assignment catalog.'}
      staffMode={staffMode}
      actions={(
        <>
          <Button variant="outlined" size="small" startIcon={<Print />} onClick={() => window.print()}>
            Print
          </Button>
          <Button variant="outlined" size="small" startIcon={copied ? <Done /> : <ContentCopy />} onClick={copySummary}>
            {copied ? 'Copied' : 'Copy summary'}
          </Button>
          {staffMode && (
            <Button
              variant={reviewed ? 'contained' : 'outlined'}
              size="small"
              startIcon={<CheckCircleOutline />}
              onClick={() => setReviewed((value) => !value)}
            >
              {reviewed ? 'Reviewed' : 'Mark reviewed'}
            </Button>
          )}
        </>
      )}
    >
      <SectionPanel>
        <Stack spacing={1.25}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="overline" sx={{ color: colors.muted, fontWeight: 800, letterSpacing: 0 }}>
              Final Policy Snapshot
            </Typography>
            <Typography sx={{ color: colors.ink, fontWeight: 850, fontSize: { xs: 28, md: 34 }, lineHeight: 1.05 }}>
              {gradeSnapshot.displayScore == null || gradeSnapshot.cap == null
                ? 'Canonical standing unavailable'
                : `${formatContractPoints(gradeSnapshot.displayScore)} / ${formatContractPoints(gradeSnapshot.cap)} · ${gradeSnapshot.currentGrade || 'Letter unavailable'}`}
            </Typography>
            <Typography sx={{ color: colors.muted, fontSize: 13, mt: 1 }}>
              {studentData?.studentName || studentData?.name || studentEmail || 'Student'}
              {studentEmail ? ` · ${studentEmail}` : ''}
              {currentCourse ? ` · ${currentCourse}` : ''}
            </Typography>
          </Box>
        </Stack>
        {staffMode && (
          <TextField
            multiline
            minRows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Staff notes"
            size="small"
            sx={{ mt: 1 }}
          />
        )}
      </SectionPanel>

      <StudentProfileContent studentData={studentData} hideTopSnapshot />
    </PageFrame>
  );
}

function CategoryFilterControls({ pageKey, status, onStatusChange, tab, onTabChange, disabled }) {
  if (pageKey === 'labs') {
    return (
      <Stack spacing={1.5}>
        <ToggleButtonGroup size="small" exclusive value={tab} onChange={(_event, value) => value && onTabChange(value)}>
          <ToggleButton value="overview">Overview</ToggleButton>
          <ToggleButton value="list">Lab List</ToggleButton>
          <ToggleButton value="policy">Policy</ToggleButton>
        </ToggleButtonGroup>
        {tab === 'list' && (
          <ToggleButtonGroup disabled={disabled} size="small" exclusive value={status} onChange={(_event, value) => value && onStatusChange(value)} sx={{ flexWrap: 'wrap' }}>
            <ToggleButton value="all">All</ToggleButton>
            {EVIDENCE_STATUSES.map((item) => <ToggleButton key={item} value={item}>{getEvidenceStatusMeta(item).label}</ToggleButton>)}
          </ToggleButtonGroup>
        )}
      </Stack>
    );
  }

  return (
    <ToggleButtonGroup disabled={disabled} size="small" exclusive value={status} onChange={(_event, value) => value && onStatusChange(value)} sx={{ flexWrap: 'wrap' }}>
      <ToggleButton value="all">All</ToggleButton>
      {EVIDENCE_STATUSES.map((item) => <ToggleButton key={item} value={item}>{getEvidenceStatusMeta(item).label}</ToggleButton>)}
    </ToggleButtonGroup>
  );
}

function assignmentMatchesFilter(assignment, status) {
  return status === 'all' || !status || assignment.evidenceStatus === status;
}

function AssignmentEvidenceTable({ assignments, onOpenAssignment, emptyMessage = 'No catalog rows match the current filter.' }) {
  if (assignments.length === 0) {
    return <Alert severity="info">{emptyMessage}</Alert>;
  }

  return (
    <TableContainer sx={{ borderRadius: 1.5, border: `1px solid ${colors.border}` }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Assignment</TableCell>
            <TableCell>Category</TableCell>
            <TableCell>Evidence</TableCell>
            <TableCell align="center">Status</TableCell>
            <TableCell>Due</TableCell>
            <TableCell>Submitted</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {assignments.map((assignment) => (
            <TableRow
              key={assignment.assignmentId}
              data-assignment-id={assignment.assignmentId}
              hover
              onClick={() => onOpenAssignment(assignment)}
              sx={{ cursor: 'pointer' }}
            >
              <TableCell sx={{ fontWeight: 700 }}>{assignment.name}</TableCell>
              <TableCell>{assignment.category}</TableCell>
              <TableCell>{formatEvidenceScore(assignment)}</TableCell>
              <TableCell align="center"><StatusChip status={assignment.evidenceStatus} /></TableCell>
              <TableCell>{formatCourseDateTime(assignment.dueAt)}</TableCell>
              <TableCell>{formatCourseDateTime(assignment.submissionTime)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function ProjectsEvidence({ assignments, onOpenAssignment }) {
  if (assignments.length === 0) {
    return <Alert severity="info">No project catalog rows match the current filter.</Alert>;
  }

  return (
    <Stack spacing={1}>
      {assignments.map((assignment) => (
        <Accordion key={assignment.assignmentId} disableGutters elevation={0} sx={{ border: `1px solid ${colors.border}`, borderRadius: 1.5, '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between" sx={{ width: '100%', pr: 1 }}>
              <Typography sx={{ fontWeight: 750 }}>{assignment.name}</Typography>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography sx={{ color: colors.muted, fontSize: 13 }}>{formatEvidenceScore(assignment)}</Typography>
                <StatusChip status={assignment.evidenceStatus} />
              </Stack>
            </Stack>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={1.5}>
              <Grid item xs={12} md={4}><MetricTile label="Assignment evidence" value={formatEvidenceScore(assignment)} caption={assignment.percentage == null ? 'No scored percentage' : formatContractPercentage(assignment.percentage)} /></Grid>
              <Grid item xs={12} md={4}><MetricTile label="Due" value={formatCourseDateTime(assignment.dueAt)} caption={assignment.releaseAt ? `Released ${formatCourseDateTime(assignment.releaseAt)}` : 'Release time unavailable'} /></Grid>
              <Grid item xs={12} md={4}><MetricTile label="Evidence status" value={getEvidenceStatusMeta(assignment.evidenceStatus, assignment).label} caption={getEvidenceStatusMeta(assignment.evidenceStatus, assignment).reason} /></Grid>
              <Grid item xs={12} md={4}><MetricTile label="Submission record" value={assignment.submissionStatus || 'Unavailable'} caption="Upstream submission/extension state when supplied." /></Grid>
              <Grid item xs={12} md={4}><MetricTile label="Submission attempts" value={assignment.submissionCount == null ? 'Unavailable' : formatAttemptCount(assignment.submissionCount)} caption="Resubmission count from assignment evidence." /></Grid>
              <Grid item xs={12} md={4}><MetricTile label="Lateness" value={assignment.isLate ? assignment.lateness : 'No recorded lateness'} caption="Final category value remains canonical policy-final." /></Grid>
            </Grid>
            <Button sx={{ mt: 1.5 }} size="small" variant="outlined" onClick={() => onOpenAssignment(assignment)} endIcon={<OpenInNew />}>
              Open evidence
            </Button>
          </AccordionDetails>
        </Accordion>
      ))}
    </Stack>
  );
}

function CategoryDomainOverview({ pageKey, block }) {
  const counts = block.summary?.statusCounts || {};
  const domainMessage = pageKey === 'attendance'
    ? 'Attendance evidence represents cataloged lecture, discussion, lab, and make-up participation items; unavailable timing or sync states remain explicit.'
    : pageKey === 'labs'
      ? 'Lab Overview summarizes the catalog. Lab List shows row evidence, while Policy explains the separate scoring path.'
      : 'Project evidence keeps submission, resubmission/lateness metadata, missing work, and sync states attached to each catalog row.';
  return (
    <Stack spacing={2}>
      <Alert severity={block.summary?.status === 'partial' ? 'warning' : 'info'}>{domainMessage}</Alert>
      <Grid container spacing={1.5}>
        {EVIDENCE_STATUSES.map((status) => (
          <Grid key={status} item xs={6} sm={4} md={3}>
            <MetricTile
              label={getEvidenceStatusMeta(status).label}
              value={String(counts[status] || 0)}
              caption={getEvidenceStatusMeta(status).reason}
            />
          </Grid>
        ))}
      </Grid>
    </Stack>
  );
}

export function CategoryDetailPage({ studentData, pageKey }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const block = useMemo(() => getCategoryBlock(studentData, pageKey), [studentData, pageKey]);
  const allAssignments = useMemo(() => getCategoryAssignments(studentData, pageKey), [studentData, pageKey]);
  const queryState = useMemo(() => parseCategoryPageQuery(location.search, pageKey), [location.search, pageKey]);
  const assignments = useMemo(() => allAssignments.filter((assignment) => assignmentMatchesFilter(assignment, queryState.status)), [allAssignments, queryState.status]);
  const statusCounts = block?.summary?.statusCounts || {};
  const missingCount = statusCounts.missing || 0;
  const incompleteCount = (statusCounts.due_unknown || 0) + (statusCounts.not_synced || 0) + (statusCounts.request_error || 0);
  const def = CATEGORY_BY_KEY.get(pageKey) || CATEGORY_BY_KEY.get('assignments');
  const isProjects = pageKey === 'projects';
  const relatedHref = buildLedgerHref({
    category: block?.label || def?.label,
    status: queryState.status,
  });
  const topAction = useMemo(() => buildTopActions({ assignmentEvidence: allAssignments }, 1)[0] || null, [allAssignments]);

  const updateQuery = useCallback((updates) => {
    navigate({
      pathname: location.pathname,
      search: mergeExperienceQuery(location.search, updates),
      hash: location.hash,
    });
  }, [location.hash, location.pathname, location.search, navigate]);

  const policyFlow = pageKey === 'labs'
    ? ['Raw lab points', 'Completion check', 'Drop lowest', 'Scale to cap', 'Final']
    : pageKey === 'attendance'
      ? ['Raw sessions', 'Group attendance', 'Make-ups', 'Forgiven absences', 'Final']
      : ['Raw project score', 'Late/extension state', 'Resubmission state', 'Configured cap', 'Final'];

  if (!studentData) return <LoadingStudentPage title={def?.label || 'Category'} />;

  return (
    <PageFrame
      active={pageKey === 'quest' || pageKey === 'midterm' || pageKey === 'postterm' ? 'exams' : pageKey}
      title={block?.label || def?.label || 'Category'}
      subtitle="Summary, evidence, policy applied, impact, and action for this grading area."
      actions={<Button component={RouterLink} to={relatedHref} size="small" variant="outlined" startIcon={<AssignmentOutlined />}>Open catalog rows</Button>}
    >
      <CategoryFilterControls
        pageKey={pageKey}
        status={queryState.status}
        onStatusChange={(status) => updateQuery({ status })}
        tab={queryState.tab}
        onTabChange={(tab) => updateQuery({ tab })}
        disabled={allAssignments.length === 0}
      />

      {allAssignments.length === 0 && (
        <Alert severity="warning">
          No authoritative catalog evidence is available for this category. Filters are disabled; this is not a zero score and may indicate sync or course-scope coverage.
        </Alert>
      )}

      <Grid container spacing={2}>
        <Grid item xs={12} md={3}>
          <MetricTile label="Final policy score" value={block?.exactScore == null || block?.cap == null ? 'Unavailable' : `${formatContractPoints(block.exactScore)} / ${formatContractPoints(block.cap)}`} caption={formatContractPercentage(block?.percentage)} />
        </Grid>
        <Grid item xs={12} md={3}>
          <MetricTile label="Due-work progress" value={block?.summary?.dueMax > 0 ? `${formatContractPoints(block.summary.dueScore)} / ${formatContractPoints(block.summary.dueMax)}` : 'Unavailable'} caption={block?.summary?.dueMax > 0 ? `${formatContractPercentage(block.summary.duePercentage)} across ${block.summary.dueItemCount} due rows` : 'Unknown, unsynced, error, not-due, and N/A rows are excluded.'} />
        </Grid>
        <Grid item xs={12} md={3}>
          <MetricTile label="Catalog status" value={`${allAssignments.length} rows`} caption={`${missingCount} missing · ${incompleteCount} incomplete metadata`} />
        </Grid>
        <Grid item xs={12} md={3}>
          <MetricTile label="Contract state" value={block?.canonicalStatus || 'unavailable'} caption={block?.source ? `Source: ${block.source}` : 'Canonical category source unavailable.'} />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid item xs={12} md={8}>
          <SectionPanel title={pageKey === 'labs' ? `Labs · ${queryState.tab.replace(/^\w/, (char) => char.toUpperCase())}` : `${block?.label || 'Category'} Evidence`} subtitle="Every row retains its A2 catalog/evidence status; unavailable values are not rendered as zero.">
            {pageKey === 'labs' && queryState.tab === 'policy' ? (
              <PolicyFlow steps={policyFlow} />
            ) : pageKey === 'labs' && queryState.tab === 'overview' ? (
              <CategoryDomainOverview pageKey={pageKey} block={block} />
            ) : isProjects ? (
              <ProjectsEvidence assignments={assignments} onOpenAssignment={setSelectedAssignment} />
            ) : (
              <AssignmentEvidenceTable
                assignments={assignments}
                onOpenAssignment={setSelectedAssignment}
                emptyMessage={`0 of ${allAssignments.length} catalog rows match this status filter. The category score remains the canonical policy-final value.`}
              />
            )}
          </SectionPanel>
        </Grid>
        <Grid item xs={12} md={4}>
          <Stack spacing={2}>
            {!(pageKey === 'labs' && queryState.tab === 'policy') && (
              <SectionPanel title="Policy Applied">
                <PolicyFlow steps={policyFlow} compact />
              </SectionPanel>
            )}
            <SectionPanel title="Action">
              <Stack spacing={1.25}>
                <Typography sx={{ color: colors.muted, fontSize: 14 }}>
                  {topAction
                    ? `${topAction.title}. ${topAction.detail}`
                    : allAssignments.length === 0
                      ? 'No concrete action can be generated until catalog evidence is available.'
                      : 'No concrete missing, zero, late, sync, timing, or request-error action is present.'}
                </Typography>
                <Button component={RouterLink} to={topAction?.to || relatedHref} variant="contained" size="small" endIcon={<ArrowForward />}>
                  Open related catalog rows
                </Button>
              </Stack>
            </SectionPanel>
          </Stack>
        </Grid>
      </Grid>
      <AssignmentDrawer assignment={selectedAssignment} onClose={() => setSelectedAssignment(null)} />
    </PageFrame>
  );
}

function PolicyFlow({ steps = [], compact = false }) {
  return (
    <Stack spacing={compact ? 0.8 : 1}>
      {steps.map((step, index) => (
        <Stack key={step} direction="row" spacing={1} alignItems="center">
          <Box
            sx={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              border: `1px solid ${colors.border}`,
              backgroundColor: index === steps.length - 1 ? colors.ink : colors.surface,
              color: index === steps.length - 1 ? colors.surface : colors.muted,
              display: 'grid',
              placeItems: 'center',
              fontSize: 12,
              fontWeight: 800,
              flexShrink: 0,
            }}
          >
            {index + 1}
          </Box>
          <Typography sx={{ color: colors.ink, fontSize: compact ? 13 : 14, fontWeight: index === steps.length - 1 ? 750 : 600 }}>
            {step}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

function ExamScoreSummary({ studentData, mode, selectedExam, onSelectExam }) {
  return (
    <Grid container spacing={2}>
      {EXAM_DEFS.map((def) => {
        const rows = getExamRows(studentData, def.key);
        const row = getBestExamRow(rows);
        const block = getCategoryBlock(studentData, def.key);
        const diagnosticPercentage = getExamDiagnosticPercentage(row, mode);
        const active = selectedExam === def.key;
        const value = mode === 'clobber'
          ? (block?.exactScore == null || block?.cap == null
            ? 'Canonical final unavailable'
            : `${formatContractPoints(block.exactScore)} / ${formatContractPoints(block.cap)}`)
          : formatContractPercentage(diagnosticPercentage);
        const caption = mode === 'raw'
          ? 'Latest raw-attempt diagnostic; not the final category score.'
          : mode === 'question_best'
            ? 'Latest question-best diagnostic; not the final category score.'
            : 'Canonical policy-final category score.';
        return (
          <Grid key={def.key} item xs={12} md={4}>
            <Paper
              component="button"
              type="button"
              elevation={0}
              onClick={() => onSelectExam(def.key)}
              sx={{
                ...panelSx,
                p: 2,
                height: '100%',
                width: '100%',
                textAlign: 'left',
                font: 'inherit',
                cursor: 'pointer',
                borderColor: active ? colors.ink : colors.border,
                backgroundColor: active ? colors.band : colors.surface,
              }}
            >
              <Stack spacing={1.25}>
                <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                  <Typography sx={{ fontWeight: 800 }}>{def.label}</Typography>
                  <ArrowForward sx={{ color: colors.soft, fontSize: 18 }} />
                </Stack>
                <Typography sx={{ fontSize: 25, fontWeight: 850, color: colors.ink, lineHeight: 1.05 }}>
                  {value}
                </Typography>
                <Typography sx={{ color: colors.muted, fontSize: 13 }}>
                  {caption}
                </Typography>
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                  <Chip size="small" label={formatAttemptCount(rows.length)} sx={{ fontWeight: 700 }} />
                  {getActualClobberRows(rows).length > 0 && <Chip size="small" label="Positive clobber gain" sx={{ fontWeight: 700, backgroundColor: '#EEF2FF', color: '#4338CA' }} />}
                </Stack>
              </Stack>
            </Paper>
          </Grid>
        );
      })}
    </Grid>
  );
}

export function ExamsOverviewPage({ studentData }) {
  const location = useLocation();
  const navigate = useNavigate();
  const mode = useMemo(() => parseExamMode(location.search), [location.search]);
  const selectedExam = useMemo(() => parseExamSelection(location.search), [location.search]);
  const selectedDef = CATEGORY_BY_KEY.get(selectedExam);
  const selectedRows = useMemo(() => getExamRows(studentData, selectedExam), [studentData, selectedExam]);
  const actualClobberRows = useMemo(() => getActualClobberRows(selectedRows), [selectedRows]);
  const canonicalGrade = getCanonicalStanding(studentData);
  const canonicalExamSubtotal = studentData?.canonicalGrade?.subtotals?.exams?.basis === 'policy_final'
    ? studentData.canonicalGrade.subtotals.exams
    : null;

  const setMode = useCallback((nextMode) => {
    navigate({
      pathname: location.pathname,
      search: mergeExperienceQuery(location.search, { mode: nextMode }),
      hash: location.hash,
    });
  }, [location.hash, location.pathname, location.search, navigate]);
  const setSelectedExam = useCallback((nextExam) => {
    navigate({
      pathname: location.pathname,
      search: mergeExperienceQuery(location.search, { exam: nextExam }),
      hash: location.hash,
    });
  }, [location.hash, location.pathname, location.search, navigate]);

  if (!studentData) return <LoadingStudentPage title="Exams And Clobber" />;

  return (
    <PageFrame
      active="exams"
      title="Exams And Clobber"
      subtitle="Choose one evidence mode. Diagnostic attempt data stays separate from canonical policy-final exam scores."
      actions={(
        <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_event, value) => value && setMode(value)}>
          <ToggleButton value="raw">Raw</ToggleButton>
          <ToggleButton value="question_best">Question Best</ToggleButton>
          <ToggleButton value="clobber">After Clobber</ToggleButton>
        </ToggleButtonGroup>
      )}
    >
      {mode === 'clobber' && (
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <MetricTile
              label="Canonical exam subtotal"
              value={canonicalExamSubtotal?.exactScore == null || canonicalExamSubtotal?.cap == null
                ? 'Unavailable'
                : `${formatContractPoints(canonicalExamSubtotal.exactScore)} / ${formatContractPoints(canonicalExamSubtotal.cap)}`}
              caption="Policy-final Quest, Midterm, and Postterm subtotal from the canonical grade contract."
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <MetricTile
              label="Canonical course standing"
              value={canonicalGrade.displayScore == null || canonicalGrade.cap == null
                ? 'Unavailable'
                : `${formatContractPoints(canonicalGrade.displayScore)} / ${formatContractPoints(canonicalGrade.cap)}`}
              caption="Shown for context; it is never recomputed from diagnostic exam rows."
            />
          </Grid>
        </Grid>
      )}

      <ExamScoreSummary
        studentData={studentData}
        mode={mode}
        selectedExam={selectedExam}
        onSelectExam={setSelectedExam}
      />

      {mode === 'raw' && (
        <SectionPanel title={`${selectedDef?.label || 'Exam'} Raw Attempts`} subtitle="Raw percentages are diagnostic attempt evidence and do not replace the canonical final category score.">
          <ExamAttemptTable rows={selectedRows} percentageField="rawPercentage" label="Raw percentage" />
        </SectionPanel>
      )}

      {mode === 'question_best' && (
        <Grid container spacing={2}>
          <Grid item xs={12} lg={6}>
            <SectionPanel title={`${selectedDef?.label || 'Exam'} Topic Mastery Radar`} subtitle="Question-level diagnostic shape across attempts.">
              <TopicMasteryRadar trend={getExamTrend(studentData, selectedExam)} />
            </SectionPanel>
          </Grid>
          <Grid item xs={12} lg={6}>
            <SectionPanel title="Question Best Matrix" subtitle="Only question-best diagnostic evidence is shown in this mode.">
              <QuestionBestMatrix trend={getExamTrend(studentData, selectedExam)} compact />
            </SectionPanel>
          </Grid>
        </Grid>
      )}

      {mode === 'clobber' && (
        <SectionPanel title={`${selectedDef?.label || 'Exam'} Clobber Outcome`} subtitle="A ladder appears only when a later exam produced a positive score change.">
          {actualClobberRows.length === 0 ? (
            <Alert severity="info">
              {selectedRows.length <= 1
                ? `${selectedDef?.label || 'This exam'} has ${formatAttemptCount(selectedRows.length)}; no positive clobber transformation is available.`
                : 'No positive clobber gain is recorded for these attempts. The canonical final score remains authoritative.'}
            </Alert>
          ) : actualClobberRows.map((row) => (
            <ClobberLadder key={row.assignmentId || `${row.examType}-${row.attemptNo}`} studentData={studentData} examKey={selectedExam} row={row} />
          ))}
        </SectionPanel>
      )}

      <Button component={RouterLink} to={selectedDef?.route || '/profile/exams/quest'} variant="outlined" sx={{ alignSelf: 'flex-start' }} endIcon={<ArrowForward />}>
        Open {selectedDef?.label || 'exam'} detail
      </Button>
    </PageFrame>
  );
}

export function SingleExamPage({ studentData, examKey }) {
  const location = useLocation();
  const navigate = useNavigate();
  const def = CATEGORY_BY_KEY.get(examKey) || CATEGORY_BY_KEY.get('quest');
  const block = getCategoryBlock(studentData, def.key);
  const rows = getExamRows(studentData, def.key);
  const actualClobberRows = getActualClobberRows(rows);
  const mode = parseExamMode(location.search);
  const setMode = (nextMode) => navigate({
    pathname: location.pathname,
    search: mergeExperienceQuery(location.search, { mode: nextMode }),
    hash: location.hash,
  });

  if (!studentData) return <LoadingStudentPage title={def.label} />;

  return (
    <PageFrame
      active="exams"
      title={`${def.label} ${block?.exactScore == null || block?.cap == null ? 'Unavailable' : `${formatContractPoints(block.exactScore)} / ${formatContractPoints(block.cap)}`}`}
      subtitle="The title always uses the canonical policy-final category value. Choose one diagnostic structure below."
      actions={(
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_event, value) => value && setMode(value)}>
            <ToggleButton value="raw">Raw</ToggleButton>
            <ToggleButton value="question_best">Question Best</ToggleButton>
            <ToggleButton value="clobber">After Clobber</ToggleButton>
          </ToggleButtonGroup>
          <Button component={RouterLink} to={`/profile/exams?mode=${mode}`} size="small" variant="outlined">All exams</Button>
        </Stack>
      )}
    >
      <Alert severity="info">{formatAttemptCount(rows.length)} · canonical final {block?.exactScore == null || block?.cap == null ? 'unavailable' : `${formatContractPoints(block.exactScore)} / ${formatContractPoints(block.cap)}`}.</Alert>
      {mode === 'raw' && (
        <SectionPanel title="Raw Attempts" subtitle="Attempt evidence only; no question-best matrix or clobber ladder is shown.">
          <ExamAttemptTable rows={rows} percentageField="rawPercentage" label="Raw percentage" />
        </SectionPanel>
      )}
      {mode === 'question_best' && (
        <Grid container spacing={2}>
          <Grid item xs={12} lg={6}><SectionPanel title="Topic Mastery Radar"><TopicMasteryRadar trend={getExamTrend(studentData, def.key)} height={430} /></SectionPanel></Grid>
          <Grid item xs={12} lg={6}><SectionPanel title="Question Best Matrix"><QuestionBestMatrix trend={getExamTrend(studentData, def.key)} /></SectionPanel></Grid>
        </Grid>
      )}
      {mode === 'clobber' && (
        <SectionPanel title="Clobber Outcome" subtitle="Only positive, recorded cross-exam gains receive a transformation ladder.">
          {actualClobberRows.length === 0 ? (
            <Alert severity="info">{rows.length <= 1 ? `${formatAttemptCount(rows.length)}; no clobber ladder is applicable.` : 'No positive clobber gain is recorded.'}</Alert>
          ) : actualClobberRows.map((row) => (
            <ClobberLadder key={row.assignmentId || `${row.examType}-${row.attemptNo}`} studentData={studentData} examKey={def.key} row={row} roomy />
          ))}
        </SectionPanel>
      )}
    </PageFrame>
  );
}

function ExamAttemptTable({ rows, percentageField, label }) {
  if (rows.length === 0) return <Alert severity="info">No exam attempt evidence is available.</Alert>;
  return (
    <TableContainer sx={{ border: `1px solid ${colors.border}`, borderRadius: 1.5 }}>
      <Table size="small">
        <TableHead><TableRow><TableCell>Attempt</TableCell><TableCell>Assignment</TableCell><TableCell align="right">{label}</TableCell></TableRow></TableHead>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={row.assignmentId || `${row.examType}-${row.attemptNo}-${index}`}>
              <TableCell>{row.attemptNo || index + 1}</TableCell>
              <TableCell>{row.assignmentTitle || 'Exam attempt'}</TableCell>
              <TableCell align="right">{formatContractPercentage(row[percentageField])}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function TopicMasteryRadar({ trend, height = 360 }) {
  const chartData = useMemo(() => {
    const palette = [
      { border: '#111827', fill: 'rgba(17, 24, 39, 0.08)' },
      { border: colors.blueDark, fill: 'rgba(71, 136, 184, 0.12)' },
      { border: colors.green, fill: 'rgba(15, 118, 110, 0.10)' },
      { border: colors.amber, fill: 'rgba(180, 83, 9, 0.10)' },
    ];
    return {
      labels: trend.components,
      datasets: trend.series.map((series, index) => {
        const tone = palette[index % palette.length];
        return {
          label: series.name || `Attempt ${index + 1}`,
          data: Array.isArray(series.data) ? series.data.map((value) => optionalNumber(value)) : [],
          borderColor: tone.border,
          backgroundColor: tone.fill,
          borderWidth: index === trend.series.length - 1 ? 2.25 : 1.4,
          pointRadius: index === trend.series.length - 1 ? 3.5 : 2.5,
          pointBackgroundColor: tone.border,
          pointBorderColor: '#FFFFFF',
          pointBorderWidth: 1,
        };
      }),
    };
  }, [trend]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    scales: {
      r: {
        min: 0,
        max: 100,
        ticks: {
          stepSize: 20,
          color: colors.muted,
          backdropColor: 'transparent',
          callback: (value) => `${value}%`,
          font: { size: 11 },
        },
        grid: { color: colors.border },
        angleLines: { color: colors.border },
        pointLabels: {
          color: colors.muted,
          font: { size: 11, weight: 600 },
        },
      },
    },
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          usePointStyle: true,
          boxWidth: 8,
          boxHeight: 8,
          color: colors.muted,
        },
      },
      datalabels: {
        display: false,
      },
      tooltip: {
        backgroundColor: '#111111',
        titleColor: '#FFFFFF',
        bodyColor: '#FFFFFF',
        cornerRadius: 6,
        callbacks: {
          label: (context) => `${context.dataset.label}: ${formatContractPercentage(context.parsed.r)}`,
        },
      },
    },
  }), []);

  if (!trend.components.length || !trend.series.length) {
    return (
      <Box sx={{ height, display: 'grid', placeItems: 'center', textAlign: 'center', px: 2 }}>
        <Typography sx={{ color: colors.muted }}>Topic mastery data is not available yet for this exam.</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ height, position: 'relative' }}>
      <ChartRadar data={chartData} options={chartOptions} />
    </Box>
  );
}

function ClobberLadder({ studentData, examKey, row: requestedRow = null, roomy = false }) {
  const rows = getExamRows(studentData, examKey);
  const row = requestedRow || getActualClobberRows(rows)[0] || null;
  const block = getCategoryBlock(studentData, examKey);
  const cap = block?.cap;

  if (!row) {
    return <Typography sx={{ color: colors.muted, fontSize: 14 }}>No positive clobber transformation is recorded.</Typography>;
  }

  const steps = [
    { label: row.questionBestPercentage == null ? `${block?.label || 'Exam'} raw` : 'Question best before clobber', value: row.questionBestPercentage ?? row.rawPercentage },
    { label: row.clobberSourceTitle ? `Clobbered by ${row.clobberSourceTitle}` : 'Clobber check', value: row.clobberedPercentage },
    { label: 'Final used', value: row.finalPercentage },
  ].filter((step) => step.value !== null && step.value !== undefined);

  const beforePercentage = row.questionBestPercentage ?? row.rawPercentage;
  const beforePoints = percentageToPoints(beforePercentage, cap);
  const finalPoints = percentageToPoints(row.finalPercentage ?? row.clobberedPercentage, cap);
  const gain = beforePoints == null || finalPoints == null ? null : Math.max(0, finalPoints - beforePoints);

  return (
    <Stack spacing={roomy ? 1.5 : 1}>
      {steps.map((step, index) => {
        const points = percentageToPoints(step.value, cap);
        const finalStep = index === steps.length - 1;
        return (
          <Stack key={`${step.label}-${index}`} direction="row" spacing={1.2} alignItems="center">
            <Box sx={{ width: 9, height: 9, borderRadius: '50%', backgroundColor: finalStep ? colors.ink : colors.borderStrong, flexShrink: 0 }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ color: colors.ink, fontWeight: finalStep ? 800 : 650, fontSize: 14 }}>{step.label}</Typography>
              <Typography sx={{ color: colors.muted, fontSize: 12.5 }}>
                {points == null || cap == null ? 'Diagnostic points unavailable' : `${formatContractPoints(points)} / ${formatContractPoints(cap)}`} · {formatContractPercentage(step.value)}
              </Typography>
            </Box>
          </Stack>
        );
      })}
      <Divider />
      <Chip label={gain == null ? 'Net gain unavailable' : `Net gain +${formatContractPoints(gain)}`} sx={{ alignSelf: 'flex-start', backgroundColor: colors.greenBg, color: colors.green, fontWeight: 800 }} />
    </Stack>
  );
}

function QuestionBestMatrix({ trend, compact = false }) {
  if (!trend.components.length || !trend.series.length) {
    return <Typography sx={{ color: colors.muted, fontSize: 14 }}>Question-best component rows are not available yet.</Typography>;
  }

  const series = compact ? trend.series.slice(-3) : trend.series;
  const rows = trend.components.map((component, componentIndex) => {
    const values = series.map((item) => optionalNumber(item.data?.[componentIndex]));
    const availableValues = values.filter((value) => value != null);
    return {
      component,
      values,
      best: availableValues.length ? Math.max(...availableValues) : null,
    };
  });

  return (
    <Stack spacing={1.25} sx={{ maxHeight: compact ? 360 : 'none', overflowY: compact ? 'auto' : 'visible', pr: compact ? 0.5 : 0 }}>
      {rows.map((row) => (
        <Box
          key={row.component}
          sx={{
            border: `1px solid ${colors.border}`,
            borderRadius: 1.5,
            backgroundColor: colors.surface,
            p: 1.25,
          }}
        >
          <Stack spacing={1}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
              <Typography sx={{ color: colors.ink, fontWeight: 750, fontSize: 14, minWidth: 0 }}>
                {row.component}
              </Typography>
              <Typography sx={{ color: colors.ink, fontWeight: 850, fontSize: 14, flexShrink: 0 }}>
                {formatContractPercentage(row.best, 0)}
              </Typography>
            </Stack>

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: `repeat(${Math.min(series.length, 3)}, minmax(0, 1fr))` },
                gap: 0.75,
              }}
            >
              {row.values.map((value, index) => (
                <Box
                  key={`${row.component}-${index}`}
                  sx={{
                    minWidth: 0,
                    borderRadius: 1,
                    backgroundColor: colors.band,
                    px: 1,
                    py: 0.75,
                  }}
                >
                  <Typography sx={{ color: colors.muted, fontSize: 11.5, fontWeight: 700, lineHeight: 1.25 }}>
                    {series[index]?.name || `Attempt ${index + 1}`}
                  </Typography>
                  <Typography sx={{ color: colors.ink, fontSize: 15, fontWeight: 750, lineHeight: 1.3 }}>
                    {formatContractPercentage(value, 0)}
                  </Typography>
                </Box>
              ))}
            </Box>

            <Box>
              <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: 0.5 }}>
                <Typography sx={{ color: colors.muted, fontSize: 12, fontWeight: 750 }}>Best Used</Typography>
                <Typography sx={{ color: colors.muted, fontSize: 12, fontWeight: 750 }}>{formatContractPercentage(row.best, 0)}</Typography>
              </Stack>
              <LinearProgress
                variant={row.best == null ? 'indeterminate' : 'determinate'}
                value={row.best == null ? undefined : Math.max(0, Math.min(100, row.best))}
                sx={{
                  height: 10,
                  borderRadius: 999,
                  backgroundColor: colors.border,
                  '& .MuiLinearProgress-bar': {
                    borderRadius: 999,
                    backgroundColor: colors.ink,
                  },
                }}
              />
            </Box>
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}

export function AssignmentLedger({ studentData }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const rows = useMemo(() => getAssignmentEvidence(studentData), [studentData]);
  const categories = useMemo(() => Array.from(new Set(rows.map((row) => row.category).filter(Boolean))).sort(), [rows]);
  const queryState = useMemo(() => parseLedgerQuery(location.search, rows), [location.search, rows]);
  const visibleRows = useMemo(() => sortLedgerRows(filterLedgerRows(rows, queryState), queryState.group), [queryState, rows]);
  const controlsDisabled = rows.length === 0;

  const updateQuery = useCallback((updates, { replace = false } = {}) => {
    navigate({
      pathname: location.pathname,
      search: mergeExperienceQuery(location.search, updates),
      hash: location.hash,
    }, { replace });
  }, [location.hash, location.pathname, location.search, navigate]);

  const exportRows = useCallback((exportScope) => {
    const exportData = exportScope === 'all' ? rows : visibleRows;
    const csv = buildLedgerCsv(exportData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = exportScope === 'all' ? 'assignment-ledger-all.csv' : 'assignment-ledger-current-filter.csv';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [rows, visibleRows]);

  if (!studentData) return <LoadingStudentPage title="Assignment Ledger" />;

  return (
    <PageFrame
      active="assignments"
      title="Assignment Ledger"
      subtitle="Authoritative assignment catalog joined with per-student evidence. Unknown, unsynced, and error states remain distinct from a true zero."
      actions={(
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button disabled={controlsDisabled || visibleRows.length === 0} variant="outlined" size="small" startIcon={<DownloadOutlined />} onClick={() => exportRows('current')}>
            Export current filtered CSV
          </Button>
          <Button disabled={controlsDisabled} variant="outlined" size="small" startIcon={<DownloadOutlined />} onClick={() => exportRows('all')}>
            Export all catalog CSV
          </Button>
        </Stack>
      )}
    >
      <SectionPanel>
        <Grid container spacing={1.5} alignItems="center">
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              size="small"
              value={queryState.search}
              disabled={controlsDisabled}
              onChange={(event) => updateQuery({ search: event.target.value }, { replace: true })}
              placeholder="Search assignment name or ID"
              InputProps={{ startAdornment: <Search sx={{ color: colors.soft, fontSize: 18, mr: 1 }} /> }}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth size="small">
              <InputLabel>Category</InputLabel>
              <Select disabled={controlsDisabled} value={queryState.category} label="Category" onChange={(event) => updateQuery({ category: event.target.value })}>
                <MenuItem value="all">All categories</MenuItem>
                {categories.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth size="small">
              <InputLabel>Sort/group label</InputLabel>
              <Select disabled={controlsDisabled} value={queryState.group} label="Sort/group label" onChange={(event) => updateQuery({ group: event.target.value })}>
                <MenuItem value="category">Category</MenuItem>
                <MenuItem value="status">Evidence status</MenuItem>
                <MenuItem value="time">Due month</MenuItem>
                <MenuItem value="none">No group label</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={2}>
            <Typography sx={{ color: colors.muted, fontSize: 13, textAlign: { xs: 'left', md: 'right' } }}>
              Showing {visibleRows.length} of {rows.length} catalog rows
            </Typography>
          </Grid>
        </Grid>
        <ToggleButtonGroup disabled={controlsDisabled} size="small" exclusive value={queryState.status} onChange={(_event, value) => value && updateQuery({ status: value })} sx={{ mt: 1.5, flexWrap: 'wrap' }}>
          <ToggleButton value="all">All</ToggleButton>
          {EVIDENCE_STATUSES.map((status) => (
            <ToggleButton key={status} value={status}>{getEvidenceStatusMeta(status).label}</ToggleButton>
          ))}
        </ToggleButtonGroup>
      </SectionPanel>

      {rows.length === 0 ? (
        <Alert severity="warning">No authoritative assignment catalog was returned. This is an unavailable/scope state, not a zero score.</Alert>
      ) : visibleRows.length === 0 ? (
        <Alert severity="info">0 of {rows.length} catalog rows match the URL-restorable category, status, and search filters. Clear a filter to return to the full catalog.</Alert>
      ) : (
        <SectionPanel title="Catalog evidence" subtitle={`Showing ${visibleRows.length} of ${rows.length} catalog rows in one table. Dates use America/Los_Angeles with year and timezone.`}>
          <LedgerEvidenceTable rows={visibleRows} group={queryState.group} onOpenAssignment={setSelectedAssignment} />
        </SectionPanel>
      )}
      <AssignmentDrawer assignment={selectedAssignment} onClose={() => setSelectedAssignment(null)} />
    </PageFrame>
  );
}

function LedgerEvidenceTable({ rows, group, onOpenAssignment }) {
  return (
    <TableContainer sx={{ borderRadius: 1.5, border: `1px solid ${colors.border}` }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            {group !== 'none' && <TableCell>Group</TableCell>}
            <TableCell>Assignment ID</TableCell>
            <TableCell>Assignment</TableCell>
            <TableCell>Category</TableCell>
            <TableCell>Evidence</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Due (America/Los_Angeles)</TableCell>
            <TableCell>Submitted (America/Los_Angeles)</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.assignmentId} data-assignment-id={row.assignmentId} hover onClick={() => onOpenAssignment(row)} sx={{ cursor: 'pointer' }}>
              {group !== 'none' && <TableCell>{getLedgerGroupLabel(row, group)}</TableCell>}
              <TableCell>{row.assignmentId}</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>{row.name}</TableCell>
              <TableCell>{row.category}</TableCell>
              <TableCell>{formatEvidenceScore(row)}</TableCell>
              <TableCell><StatusChip status={row.evidenceStatus} /></TableCell>
              <TableCell>{formatCourseDateTime(row.dueAt)}</TableCell>
              <TableCell>{formatCourseDateTime(row.submissionTime)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function AssignmentDrawer({ assignment, onClose }) {
  const open = Boolean(assignment);
  const related = assignment ? findCategoryDefForAssignment(assignment) : null;
  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Box sx={{ width: { xs: 320, sm: 430 }, p: 2.5 }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="h6" sx={sectionTitleSx}>{assignment?.name || 'Assignment'}</Typography>
            <Typography sx={{ color: colors.muted, fontSize: 13, mt: 0.5 }}>{assignment?.category || 'Category'}</Typography>
          </Box>
          <Divider />
          <Grid container spacing={1.5}>
            <Grid item xs={6}><MetricTile label="Evidence" value={formatEvidenceScore(assignment)} caption={formatContractPercentage(assignment?.percentage)} /></Grid>
            <Grid item xs={6}><MetricTile label="Evidence status" value={assignment ? getEvidenceStatusMeta(assignment.evidenceStatus, assignment).label : 'Unavailable'} caption={assignment ? getEvidenceStatusMeta(assignment.evidenceStatus, assignment).reason : 'No row selected.'} /></Grid>
            <Grid item xs={6}><MetricTile label="Due" value={formatCourseDateTime(assignment?.dueAt)} caption="America/Los_Angeles" /></Grid>
            <Grid item xs={6}><MetricTile label="Submitted" value={formatCourseDateTime(assignment?.submissionTime)} caption={assignment?.isLate ? `Late: ${assignment.lateness}` : 'No recorded lateness flag'} /></Grid>
          </Grid>
          <SectionPanel title="Related Topic" sx={{ p: 2 }}>
            <Typography sx={{ color: colors.muted, fontSize: 14 }}>
              {related?.type === 'exam'
                ? `${related.label} topic evidence can be reviewed on the exam page.`
                : related
                  ? `${related.label} policy evidence can be reviewed on its category page.`
                  : 'No related concept is attached to this row yet.'}
            </Typography>
            {related && (
              <Button component={RouterLink} to={related.route} size="small" variant="outlined" sx={{ mt: 1 }} endIcon={<ArrowForward />}>
                Open {related.shortLabel || related.label}
              </Button>
            )}
          </SectionPanel>
          <SectionPanel title="Suggested Action" sx={{ p: 2 }}>
            <Typography sx={{ color: colors.muted, fontSize: 14 }}>
              {assignment?.evidenceStatus === 'missing'
                ? 'Confirm whether the work can still be submitted or whether a make-up/extension policy applies.'
                : assignment?.evidenceStatus === 'earned_zero'
                  ? 'Review the recorded zero and the assignment policy before taking action.'
                  : assignment?.evidenceStatus === 'not_synced' || assignment?.evidenceStatus === 'request_error'
                    ? 'Retry or verify the upstream sync before interpreting this assignment.'
                    : assignment?.evidenceStatus === 'due_unknown'
                      ? 'Confirm the due time before treating this work as due or missing.'
                      : 'Use this catalog row as evidence alongside the canonical category result.'}
            </Typography>
          </SectionPanel>
        </Stack>
      </Box>
    </Drawer>
  );
}

export function ExplainScorePage({ studentData, gradeFlowLoading, gradeFlowError }) {
  const steps = ['Raw scores', 'Policy transformations', 'Category final', 'Course total', 'Rounding', 'Grade bin'];
  const hasGradeFlow = Boolean(studentData?.gradeFlow);
  return (
    <PageFrame
      active="explain"
      title="Explain Score"
      subtitle="A student-facing policy flow from raw scores to the current grade bin."
    >
      <SectionPanel title="Default Flow">
        <PolicyFlow steps={steps} />
      </SectionPanel>
      {gradeFlowError && <Alert severity="error">{gradeFlowError}</Alert>}
      {gradeFlowLoading && <Alert severity="info">Loading detailed grade flow...</Alert>}
      {hasGradeFlow ? (
        <Paper elevation={0} sx={{ ...panelSx, height: { xs: 640, md: 760 }, overflow: 'hidden' }}>
          <GradeDataFlow studentData={studentData} />
        </Paper>
      ) : !gradeFlowLoading && (
        <SectionPanel title="Policy Nodes" subtitle="Detailed graph data is not available yet, so this page shows the canonical scoring path.">
          <Grid container spacing={1.5}>
            {['raw', 'best', 'drop', 'filter', 'scale', 'cap', 'clobber', 'final output'].map((node) => (
              <Grid key={node} item xs={12} sm={6} md={3}>
                <Paper elevation={0} sx={{ border: `1px solid ${colors.border}`, borderRadius: 1.5, p: 1.5 }}>
                  <Typography sx={{ fontWeight: 750, color: colors.ink }}>{node}</Typography>
                  <Typography sx={{ color: colors.muted, fontSize: 12.5, mt: 0.4 }}>Click-to-focus will attach when graph data is loaded.</Typography>
                </Paper>
              </Grid>
            ))}
          </Grid>
        </SectionPanel>
      )}
    </PageFrame>
  );
}

export function ConceptsPage({ studentData }) {
  const weakBlocks = useMemo(() => (
    getWorkspaceBlocks(studentData)
      .filter((block) => safeNumber(block.percentage) < 75)
      .sort((a, b) => safeNumber(a.percentage) - safeNumber(b.percentage))
      .slice(0, 3)
  ), [studentData]);

  return (
    <PageFrame
      active="concepts"
      title="Concept Diagnosis"
      subtitle="Connect grade outcomes to learning topics, related exams, and related assignments."
    >
      <SectionPanel title="Weak Topics Summary" subtitle="Mapped from low-scoring grade areas until concept-level evidence is available.">
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {weakBlocks.length === 0 ? (
            <Typography sx={{ color: colors.muted, fontSize: 14 }}>No weak category signal is visible in the current data.</Typography>
          ) : weakBlocks.map((block) => (
            <Chip key={block.key} label={`${block.label}: ${formatPercentage(block.percentage)}`} sx={{ fontWeight: 750 }} />
          ))}
        </Stack>
      </SectionPanel>
      <SectionPanel title="Concept Map">
        <ConceptMap embedded />
      </SectionPanel>
    </PageFrame>
  );
}

export function PolicyReference({ studentData }) {
  const blocks = useMemo(() => getWorkspaceBlocks(studentData), [studentData]);
  const grade = useMemo(() => getGradeSnapshot(studentData), [studentData]);
  return (
    <PageFrame
      active="policy"
      title="Policy Reference"
      subtitle="Course policy stays separate from personal assignment analysis."
    >
      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <SectionPanel title="Grading Breakdown">
            <TableContainer sx={{ borderRadius: 1.5, border: `1px solid ${colors.border}` }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Category</TableCell>
                    <TableCell align="right">Cap</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {blocks.map((block) => (
                    <TableRow key={block.key}>
                      <TableCell sx={{ fontWeight: 700 }}>{block.label}</TableCell>
                      <TableCell align="right">{formatPoints(block.cap)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </SectionPanel>
        </Grid>
        <Grid item xs={12} md={6}>
          <SectionPanel title="Grade Bins">
            <Stack spacing={0.8}>
              {grade.bins.length === 0 ? (
                <Typography sx={{ color: colors.muted, fontSize: 14 }}>Grade bins are not configured for this course.</Typography>
              ) : grade.bins.slice().reverse().map((bin) => (
                <Stack key={`${bin.grade}-${bin.range}`} direction="row" justifyContent="space-between" sx={{ borderBottom: `1px solid ${colors.border}`, py: 0.75 }}>
                  <Typography sx={{ fontWeight: 750 }}>{bin.grade}</Typography>
                  <Typography sx={{ color: colors.muted }}>{bin.range}</Typography>
                </Stack>
              ))}
            </Stack>
          </SectionPanel>
        </Grid>
        <Grid item xs={12}>
          <SectionPanel title="Exam, Lab, Project, And Attendance Policy">
            <Grid container spacing={1.5}>
              {[
                ['Exam clobber', 'Later exam performance can replace earlier exam outcomes when policy rules allow it.'],
                ['Question best', 'Exam component scores can use the strongest available topic/question evidence.'],
                ['Labs', 'Raw lab points pass through completion checks, drops, scaling, and the lab cap.'],
                ['Projects', 'Project scores reflect artifact status, lateness/extension state, resubmissions, and configured caps.'],
                ['Attendance', 'Participation credit comes from lecture, discussion, lab, make-up, and forgiveness rules.'],
                ['Rounding', studentData?.roundingPolicy || 'Final course total is rounded before grade-bin lookup.'],
              ].map(([title, body]) => (
                <Grid key={title} item xs={12} md={4}>
                  <Paper elevation={0} sx={{ border: `1px solid ${colors.border}`, borderRadius: 1.5, p: 1.5, height: '100%' }}>
                    <Typography sx={{ fontWeight: 800 }}>{title}</Typography>
                    <Typography sx={{ color: colors.muted, fontSize: 13, mt: 0.5 }}>{body}</Typography>
                  </Paper>
                </Grid>
              ))}
            </Grid>
          </SectionPanel>
        </Grid>
      </Grid>
    </PageFrame>
  );
}

export function UnknownStudentExperienceRoute() {
  return (
    <PageFrame active="workspace" title="Page Not Found" subtitle="This student workspace route is not available.">
      <Button component={RouterLink} to="/profile" variant="contained">Back to workspace</Button>
    </PageFrame>
  );
}

export default memo(StudentWorkspaceHome);
