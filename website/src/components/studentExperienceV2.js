import React, { memo, useCallback, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
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
  ReportOutlined,
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

const CATEGORY_DEFS = [
  {
    key: 'attendance',
    label: 'Attendance / Participation',
    shortLabel: 'Attendance',
    route: '/profile/attendance',
    type: 'attendance',
    match: /(attendance|participation|lecture|discussion|make-?up)/i,
  },
  {
    key: 'labs',
    label: 'Labs',
    shortLabel: 'Labs',
    route: '/profile/labs',
    type: 'labs',
    match: /\blab\b|labs/i,
  },
  {
    key: 'projects',
    label: 'Projects',
    shortLabel: 'Projects',
    route: '/profile/projects',
    type: 'projects',
    match: /project/i,
  },
  {
    key: 'quest',
    label: 'Quest',
    shortLabel: 'Quest',
    route: '/profile/exams/quest',
    type: 'exam',
    match: /quest/i,
  },
  {
    key: 'midterm',
    label: 'Midterm',
    shortLabel: 'Midterm',
    route: '/profile/exams/midterm',
    type: 'exam',
    match: /midterm/i,
  },
  {
    key: 'postterm',
    label: 'Postterm',
    shortLabel: 'Postterm',
    route: '/profile/exams/postterm',
    type: 'exam',
    match: /postterm|posterm|final/i,
  },
];

const EXAM_DEFS = CATEGORY_DEFS.filter((item) => item.type === 'exam');
const CATEGORY_BY_KEY = new Map(CATEGORY_DEFS.map((item) => [item.key, item]));

function safeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function formatPoints(value, digits = 1) {
  const numeric = safeNumber(value);
  if (Number.isInteger(numeric)) return String(numeric);
  return numeric.toFixed(digits);
}

function formatPercentage(value, digits = 1) {
  return `${safeNumber(value).toFixed(digits)}%`;
}

function formatPolicyPoints(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0';
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2);
}

function normalizeText(value = '') {
  return String(value || '').trim().toLowerCase();
}

function formatDate(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  if (!Number.isFinite(date.getTime())) return '-';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getTimestamp(dateString) {
  if (!dateString) return Number.NEGATIVE_INFINITY;
  const timestamp = new Date(dateString).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function isLate(lateness) {
  const value = normalizeText(lateness);
  return Boolean(value && value !== '00:00:00' && value !== '0' && value !== 'none');
}

function parseGradeBins(rawBins = []) {
  return (Array.isArray(rawBins) ? rawBins : [])
    .map((bin) => {
      const match = String(bin?.range || '').match(/(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)/);
      if (!match) return null;
      const low = Number(match[1]);
      const high = Number(match[2]);
      if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
      return {
        grade: String(bin?.grade || bin?.letter || '').trim(),
        low: Math.min(low, high),
        high: Math.max(low, high),
        range: String(bin?.range || ''),
      };
    })
    .filter((bin) => bin && bin.grade)
    .sort((a, b) => a.low - b.low);
}

function getGradeSnapshot(studentData) {
  const canonicalGrade = studentData?.canonicalGrade;
  const displayScore = safeNumber(canonicalGrade?.displayScore, Number.NaN);
  const bins = parseGradeBins(studentData?.gradeBins);
  if (!canonicalGrade?.letter || !Number.isFinite(displayScore)) {
    return {
      currentGrade: 'N/A',
      currentRange: '',
      nextGrade: '',
      pointsToNext: 0,
      nextThreshold: null,
      bins,
    };
  }
  const current = canonicalGrade.bin || null;
  const next = bins.find((bin) => bin.low > displayScore) || null;
  return {
    currentGrade: canonicalGrade.letter,
    currentRange: current?.range || '',
    nextGrade: next?.grade || '',
    pointsToNext: next ? Math.max(0, next.low - displayScore) : 0,
    nextThreshold: next?.low || null,
    bins,
  };
}

function getTotalCap(studentData, blocks = []) {
  const blockCap = blocks.reduce((sum, block) => sum + safeNumber(block.cap), 0);
  if (blockCap > 0) return blockCap;
  return safeNumber(studentData?.totalCapPoints || studentData?.totalMaxPoints);
}

function getRawAssignments(studentData) {
  const raw = Array.isArray(studentData?.rawAssignmentsList) ? studentData.rawAssignmentsList : [];
  if (raw.length > 0) return raw;
  return Array.isArray(studentData?.assignmentsList) ? studentData.assignmentsList : [];
}

function findCategoryDefForAssignment(assignment) {
  const haystack = `${assignment?.category || ''} ${assignment?.name || ''}`;
  return CATEGORY_DEFS.find((def) => def.match.test(haystack)) || null;
}

function getCategoryBlock(studentData, key) {
  const def = CATEGORY_BY_KEY.get(key);
  if (!def) return null;

  const blocks = Array.isArray(studentData?.categoryBlocks) ? studentData.categoryBlocks : [];
  const direct = blocks.find((block) => normalizeText(block?.key) === key)
    || blocks.find((block) => def.match.test(`${block?.label || ''} ${block?.key || ''}`));
  if (direct) {
    return {
      ...direct,
      key: def.key,
      label: direct.label || def.label,
      route: def.route,
      type: direct.type || def.type,
      score: safeNumber(direct.score),
      cap: safeNumber(direct.cap),
      percentage: safeNumber(direct.percentage),
    };
  }

  const categoryEntry = Object.entries(studentData?.categoriesData || {}).find(([category]) => (
    def.match.test(category)
  ));
  if (!categoryEntry) {
    return {
      key: def.key,
      label: def.label,
      shortLabel: def.shortLabel,
      route: def.route,
      type: def.type,
      score: 0,
      cap: 0,
      percentage: 0,
      summary: {},
      exam: null,
    };
  }

  const [, data] = categoryEntry;
  const score = safeNumber(data?.total);
  const cap = safeNumber(data?.capPoints ?? data?.maxPoints);
  return {
    key: def.key,
    label: def.label,
    shortLabel: def.shortLabel,
    route: def.route,
    type: def.type,
    score,
    cap,
    percentage: cap > 0 ? (score / cap) * 100 : 0,
    summary: {},
    exam: null,
  };
}

function getWorkspaceBlocks(studentData) {
  return CATEGORY_DEFS.map((def) => getCategoryBlock(studentData, def.key)).filter(Boolean);
}

function getCategoryAssignments(studentData, key) {
  const def = CATEGORY_BY_KEY.get(key);
  if (!def) return [];
  return getRawAssignments(studentData)
    .filter((assignment) => def.match.test(`${assignment?.category || ''} ${assignment?.name || ''}`))
    .map((assignment) => decorateAssignment(assignment));
}

function getAssignmentPolicyStatus(assignment) {
  const score = safeNumber(assignment?.score, NaN);
  const maxPoints = safeNumber(assignment?.maxPoints, NaN);
  const name = normalizeText(assignment?.name);
  const category = normalizeText(assignment?.category);
  if (name.includes('dropped') || category.includes('dropped')) return 'dropped';
  if (category.includes('clobber') || name.includes('clobber')) return 'clobbered';
  if (Number.isFinite(score) && Number.isFinite(maxPoints) && maxPoints > 0 && score <= 0 && !assignment?.submissionTime) {
    return 'missing';
  }
  if (isLate(assignment?.lateness)) return 'late';
  if (Number.isFinite(score) && Number.isFinite(maxPoints) && maxPoints > 0 && score <= 0) return 'zero';
  return 'used';
}

function decorateAssignment(assignment) {
  const score = safeNumber(assignment?.score);
  const maxPoints = safeNumber(assignment?.maxPoints);
  const percentage = maxPoints > 0 ? (score / maxPoints) * 100 : safeNumber(assignment?.percentage);
  const def = findCategoryDefForAssignment(assignment);
  return {
    ...assignment,
    score,
    maxPoints,
    percentage,
    route: def?.route || '/profile/assignments',
    policyStatus: getAssignmentPolicyStatus(assignment),
    categoryKey: def?.key || normalizeText(assignment?.category || 'other'),
    formattedSubmissionTime: formatDate(assignment?.submissionTime),
    timestamp: getTimestamp(assignment?.submissionTime),
  };
}

function getRecentSignals(studentData) {
  const assignmentSignals = getRawAssignments(studentData)
    .map((assignment) => decorateAssignment(assignment))
    .filter((assignment) => ['missing', 'late', 'zero', 'dropped', 'clobbered'].includes(assignment.policyStatus))
    .map((assignment) => ({
      id: `${assignment.category}-${assignment.name}-${assignment.policyStatus}`,
      type: assignment.policyStatus,
      label: assignment.name || 'Assignment',
      detail: `${assignment.category || 'Coursework'} · ${formatPoints(assignment.score)} / ${formatPoints(assignment.maxPoints)}`,
      route: assignment.route,
      timestamp: assignment.timestamp,
      assignment,
    }));

  const examSignals = (Array.isArray(studentData?.examPolicyRows) ? studentData.examPolicyRows : [])
    .filter((row) => row?.clobberSourceTitle)
    .map((row) => ({
      id: `clobber-${row.examType}-${row.attemptNo}`,
      type: 'clobber',
      label: `${String(row.examType || 'Exam').replace(/^\w/, (char) => char.toUpperCase())} clobber applied`,
      detail: `Source: ${row.clobberSourceTitle}`,
      route: `/profile/exams/${normalizeText(row.examType) || 'quest'}`,
      timestamp: getTimestamp(row.computedAt),
      row,
    }));

  return [...assignmentSignals, ...examSignals]
    .sort((a, b) => (b.timestamp - a.timestamp) || String(a.label).localeCompare(String(b.label)))
    .slice(0, 8);
}

function getImportantCategory(blocks = []) {
  return [...blocks]
    .filter((block) => safeNumber(block.cap) > 0)
    .map((block) => {
      const remaining = Math.max(0, safeNumber(block.cap) - safeNumber(block.score));
      const weakness = Math.max(0, 100 - safeNumber(block.percentage));
      return {
        ...block,
        remaining,
        impactScore: remaining + (weakness / 100) * safeNumber(block.cap),
      };
    })
    .sort((a, b) => b.impactScore - a.impactScore)[0] || null;
}

function getTopActions(studentData, blocks, gradeSnapshot) {
  const actions = [];
  const signals = getRecentSignals(studentData);
  const missingLike = signals.find((signal) => ['missing', 'zero'].includes(signal.type));
  if (missingLike) {
    actions.push({
      key: 'missing',
      title: `Review ${missingLike.label}`,
      detail: missingLike.detail,
      to: missingLike.route || '/profile/assignments',
      tone: 'attention',
    });
  }

  const late = signals.find((signal) => signal.type === 'late');
  if (late) {
    actions.push({
      key: 'late',
      title: `Check lateness on ${late.label}`,
      detail: late.detail,
      to: late.route || '/profile/assignments',
      tone: 'watch',
    });
  }

  const important = getImportantCategory(blocks);
  if (important) {
    actions.push({
      key: `category-${important.key}`,
      title: `Focus on ${important.label}`,
      detail: `${formatPoints(important.remaining)} points remain before the category cap.`,
      to: important.route,
      tone: 'default',
    });
  }

  if (gradeSnapshot.nextGrade && gradeSnapshot.pointsToNext > 0) {
    actions.push({
      key: 'next-grade',
      title: `Close ${gradeSnapshot.pointsToNext} pt gap to ${gradeSnapshot.nextGrade}`,
      detail: 'Open the score explanation to see where those points can come from.',
      to: '/profile/explain',
      tone: 'default',
    });
  }

  const seen = new Set();
  return actions
    .filter((action) => {
      const key = `${action.title}-${action.to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

function getExamRows(studentData, examKey) {
  return (Array.isArray(studentData?.examPolicyRows) ? studentData.examPolicyRows : [])
    .filter((row) => normalizeText(row?.examType) === examKey)
    .sort((a, b) => safeNumber(a?.attemptNo) - safeNumber(b?.attemptNo));
}

function getExamTrend(studentData, examKey) {
  const trends = studentData?.examComponentTrends || {};
  const trend = trends[examKey] || (examKey === 'quest' ? studentData?.questComponentTrend : null) || {};
  return {
    components: Array.isArray(trend.components) ? trend.components : [],
    componentCaps: Array.isArray(trend.componentCaps) ? trend.componentCaps : [],
    series: Array.isArray(trend.series) ? trend.series : [],
  };
}

function getBestExamRow(rows = []) {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => safeNumber(b?.finalPercentage, -1) - safeNumber(a?.finalPercentage, -1))[0];
}

function getExamPercent(row, mode = 'final') {
  if (!row) return null;
  if (mode === 'raw') return row.rawPercentage ?? null;
  if (mode === 'questionBest') return row.questionBestPercentage ?? row.rawPercentage ?? null;
  if (mode === 'clobber') return row.clobberedPercentage ?? row.finalPercentage ?? row.questionBestPercentage ?? row.rawPercentage ?? null;
  return row.finalPercentage ?? row.clobberedPercentage ?? row.questionBestPercentage ?? row.rawPercentage ?? null;
}

function percentageToPoints(percentage, cap) {
  const pct = Number(percentage);
  const numericCap = Number(cap);
  if (!Number.isFinite(pct) || !Number.isFinite(numericCap) || numericCap <= 0) return null;
  return (Math.max(0, Math.min(100, pct)) / 100) * numericCap;
}

function StatusChip({ status }) {
  const tone = {
    missing: { bg: colors.redBg, color: colors.red, label: 'Missing' },
    zero: { bg: colors.redBg, color: colors.red, label: 'Zero' },
    late: { bg: colors.amberBg, color: colors.amber, label: 'Late' },
    dropped: { bg: colors.band, color: colors.muted, label: 'Dropped' },
    clobbered: { bg: '#EEF2FF', color: '#4338CA', label: 'Clobbered' },
    used: { bg: colors.greenBg, color: colors.green, label: 'Used' },
  }[status] || { bg: colors.band, color: colors.muted, label: status || 'Raw only' };
  return <Chip size="small" label={tone.label} sx={{ backgroundColor: tone.bg, color: tone.color, fontWeight: 700 }} />;
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

function MetricTile({ label, value, caption, to, icon }) {
  const content = (
    <Paper
      elevation={0}
      sx={{
        ...panelSx,
        p: 2,
        height: '100%',
        color: colors.ink,
        textDecoration: 'none',
        transition: 'border-color 140ms ease, background-color 140ms ease',
        '&:hover': to ? { borderColor: colors.borderStrong, backgroundColor: colors.band } : undefined,
      }}
    >
      <Stack direction="row" spacing={1.2} justifyContent="space-between" alignItems="flex-start">
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ color: colors.muted, fontSize: 12, fontWeight: 750 }}>{label}</Typography>
          <Typography sx={{ color: colors.ink, fontSize: 24, fontWeight: 800, lineHeight: 1.15, mt: 0.5 }}>
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
  const score = safeNumber(block.score);
  const cap = safeNumber(block.cap);
  const percentage = cap > 0 ? (score / cap) * 100 : safeNumber(block.percentage);
  const missingItems = safeNumber(block.summary?.missingItems);
  const submittedItems = safeNumber(block.summary?.submittedItems);
  const totalItems = safeNumber(block.summary?.totalItems);
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
              {formatPercentage(percentage)} final policy
            </Typography>
          </Box>
          <ArrowForward sx={{ color: colors.soft, fontSize: 18, mt: 0.25 }} />
        </Stack>
        <Box>
          <LinearProgress
            variant="determinate"
            value={Math.max(0, Math.min(100, percentage))}
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
              {formatPoints(score)} / {formatPoints(cap)}
            </Typography>
            <Typography sx={{ color: colors.muted, fontSize: 12.5 }}>
              {totalItems > 0 ? `${submittedItems}/${totalItems} submitted` : 'Policy score'}
            </Typography>
          </Stack>
        </Box>
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 'auto' }}>
          {missingItems > 0 && <Chip size="small" label={`${missingItems} missing`} sx={{ backgroundColor: colors.redBg, color: colors.red, fontWeight: 700 }} />}
          {block.exam?.clobberedAttempts > 0 && <Chip size="small" label={`${block.exam.clobberedAttempts} clobbered`} sx={{ fontWeight: 700 }} />}
          {missingItems === 0 && block.exam?.clobberedAttempts <= 0 && (
            <Chip size="small" label="Current" sx={{ backgroundColor: colors.band, color: colors.muted, fontWeight: 700 }} />
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}

export function StudentWorkspaceHome({ studentData }) {
  const blocks = useMemo(() => getWorkspaceBlocks(studentData), [studentData]);
  const gradeSnapshot = useMemo(() => getGradeSnapshot(studentData), [studentData]);
  const totalCap = useMemo(() => getTotalCap(studentData, blocks), [studentData, blocks]);
  const importantCategory = useMemo(() => getImportantCategory(blocks), [blocks]);
  const actions = useMemo(() => getTopActions(studentData, blocks, gradeSnapshot), [studentData, blocks, gradeSnapshot]);
  const signals = useMemo(() => getRecentSignals(studentData), [studentData]);

  return (
    <PageFrame
      active="workspace"
      title="Student Workspace"
      subtitle="Current standing, the grading area with the highest impact, and the next few things to do."
      actions={(
        <Button component={RouterLink} to="/profile/report" variant="outlined" size="small" startIcon={<ReportOutlined />}>
          Open report
        </Button>
      )}
    >
      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <MetricTile
            label="Final standing"
            value={`${formatPolicyPoints(studentData?.policyFinalDisplayScore ?? studentData?.displayScore)} / ${formatPolicyPoints(studentData?.policyFinalCap ?? totalCap)}`}
            caption={`Current grade: ${gradeSnapshot.currentGrade}${gradeSnapshot.currentRange ? ` (${gradeSnapshot.currentRange})` : ''}`}
            to="/profile/explain"
            icon={<TrendingUp fontSize="small" />}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <MetricTile
            label="Next grade gap"
            value={gradeSnapshot.nextGrade ? `${gradeSnapshot.pointsToNext} pts` : 'Top bin'}
            caption={gradeSnapshot.nextGrade ? `Needed for ${gradeSnapshot.nextGrade} at ${formatPoints(gradeSnapshot.nextThreshold, 0)} pts` : 'No higher grade bin is currently configured.'}
            to="/profile/explain"
            icon={<TimelineOutlined fontSize="small" />}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <MetricTile
            label="Most important area"
            value={importantCategory?.label || 'No category data'}
            caption={importantCategory ? `${formatPoints(importantCategory.remaining)} pts remain in this cap.` : 'Category summaries will appear after sync.'}
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
                <Typography sx={{ color: colors.muted, fontSize: 14 }}>No immediate actions are visible in the current profile data.</Typography>
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
          <SectionPanel title="Recent Signals" subtitle="Missing, late, zero, dropped, and clobber events.">
            <Stack spacing={1}>
              {signals.length === 0 ? (
                <Typography sx={{ color: colors.muted, fontSize: 14 }}>No recent risk signals found.</Typography>
              ) : signals.slice(0, 5).map((signal) => (
                <Stack
                  key={signal.id}
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  justifyContent="space-between"
                  sx={{ py: 1, borderBottom: `1px solid ${colors.border}` }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ color: colors.ink, fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {signal.label}
                    </Typography>
                    <Typography sx={{ color: colors.muted, fontSize: 12.5 }}>{signal.detail}</Typography>
                  </Box>
                  <StatusChip status={signal.type === 'clobber' ? 'clobbered' : signal.type} />
                </Stack>
              ))}
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
  const cap = getTotalCap(studentData, blocks);
  const weak = getImportantCategory(blocks);
  return [
    `Student: ${studentData?.studentName || studentData?.name || studentEmail || 'Unknown'}`,
    currentCourse ? `Course: ${currentCourse}` : '',
    `Current standing: ${formatPolicyPoints(studentData?.policyFinalDisplayScore ?? studentData?.displayScore)} / ${formatPolicyPoints(studentData?.policyFinalCap ?? cap)} (${grade.currentGrade})`,
    grade.nextGrade ? `Next grade gap: ${grade.pointsToNext} pts to ${grade.nextGrade}` : 'Next grade gap: top configured bin',
    weak ? `Highest-impact area: ${weak.label}` : '',
  ].filter(Boolean).join('\n');
}

export function StudentReportContent({ studentData, studentEmail, currentCourse, staffMode = false }) {
  const [reviewed, setReviewed] = useState(false);
  const [notes, setNotes] = useState('');
  const [copied, setCopied] = useState(false);
  const blocks = useMemo(() => getWorkspaceBlocks(studentData), [studentData]);
  const gradeSnapshot = useMemo(() => getGradeSnapshot(studentData), [studentData]);
  const totalCap = useMemo(() => getTotalCap(studentData, blocks), [studentData, blocks]);
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

  return (
    <PageFrame
      active="report"
      title="Student Report"
      subtitle="One-page staff review with final policy snapshot, category evidence, exam policy, trends, assignment ledger, and diagnosis."
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
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} justifyContent="space-between">
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="overline" sx={{ color: colors.muted, fontWeight: 800, letterSpacing: 0 }}>
              Final Policy Snapshot
            </Typography>
            <Typography sx={{ color: colors.ink, fontWeight: 850, fontSize: { xs: 28, md: 34 }, lineHeight: 1.05 }}>
              {formatPolicyPoints(studentData?.policyFinalDisplayScore ?? studentData?.displayScore)} / {formatPolicyPoints(studentData?.policyFinalCap ?? totalCap)} · {gradeSnapshot.currentGrade}
            </Typography>
            <Typography sx={{ color: colors.muted, fontSize: 13, mt: 1 }}>
              {studentData?.studentName || studentData?.name || studentEmail || 'Student'}
              {studentEmail ? ` · ${studentEmail}` : ''}
              {currentCourse ? ` · ${currentCourse}` : ''}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="flex-start">
            {EXAM_DEFS.map((def) => {
              const block = blocks.find((item) => item.key === def.key);
              return (
                <Chip
                  key={def.key}
                  label={`${def.shortLabel}: ${block ? `${formatPoints(block.score)} / ${formatPoints(block.cap)}` : '-'}`}
                  sx={{ fontWeight: 750, backgroundColor: colors.band, color: colors.ink }}
                />
              );
            })}
            <Chip
              label={gradeSnapshot.nextGrade ? `${gradeSnapshot.pointsToNext} pts to ${gradeSnapshot.nextGrade}` : 'Top grade bin'}
              sx={{ fontWeight: 750, backgroundColor: colors.greenBg, color: colors.green }}
            />
          </Stack>
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

function CategoryFilterControls({ pageKey, filter, setFilter, tab, setTab }) {
  if (pageKey === 'labs') {
    return (
      <Stack spacing={1.5}>
        <ToggleButtonGroup size="small" exclusive value={tab} onChange={(_event, value) => value && setTab(value)}>
          <ToggleButton value="overview">Overview</ToggleButton>
          <ToggleButton value="list">Lab List</ToggleButton>
          <ToggleButton value="policy">Policy</ToggleButton>
        </ToggleButtonGroup>
        <ToggleButtonGroup size="small" exclusive value={filter} onChange={(_event, value) => value && setFilter(value)}>
          {['all', 'missing', 'dropped', 'kept'].map((item) => <ToggleButton key={item} value={item}>{item.replace(/^\w/, (c) => c.toUpperCase())}</ToggleButton>)}
        </ToggleButtonGroup>
      </Stack>
    );
  }

  const filters = pageKey === 'attendance'
    ? ['all', 'lecture', 'discussion', 'lab', 'missing', 'make-up']
    : ['all', 'submitted', 'missing', 'resubmission', 'late'];

  return (
    <ToggleButtonGroup size="small" exclusive value={filter} onChange={(_event, value) => value && setFilter(value)}>
      {filters.map((item) => <ToggleButton key={item} value={item}>{item.replace(/^\w/, (c) => c.toUpperCase())}</ToggleButton>)}
    </ToggleButtonGroup>
  );
}

function assignmentMatchesFilter(assignment, filter) {
  const text = normalizeText(`${assignment.category || ''} ${assignment.name || ''}`);
  if (filter === 'all' || !filter) return true;
  if (filter === 'submitted') return assignment.policyStatus !== 'missing';
  if (filter === 'missing') return assignment.policyStatus === 'missing' || assignment.policyStatus === 'zero';
  if (filter === 'late') return assignment.policyStatus === 'late';
  if (filter === 'dropped') return assignment.policyStatus === 'dropped' || text.includes('drop');
  if (filter === 'kept') return assignment.policyStatus !== 'dropped';
  if (filter === 'make-up') return /make-?up/.test(text);
  if (filter === 'resubmission') return /resubmission|revision|retry/.test(text);
  return text.includes(filter);
}

function AssignmentEvidenceTable({ assignments, onOpenAssignment }) {
  if (assignments.length === 0) {
    return <Typography sx={{ color: colors.muted, fontSize: 14 }}>No raw evidence rows match the current filter.</Typography>;
  }

  return (
    <TableContainer sx={{ borderRadius: 1.5, border: `1px solid ${colors.border}` }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Assignment</TableCell>
            <TableCell>Category</TableCell>
            <TableCell align="center">Score</TableCell>
            <TableCell align="center">Status</TableCell>
            <TableCell align="right">Submitted</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {assignments.map((assignment, index) => (
            <TableRow
              key={`${assignment.category}-${assignment.name}-${index}`}
              hover
              onClick={() => onOpenAssignment(assignment)}
              sx={{ cursor: 'pointer' }}
            >
              <TableCell sx={{ fontWeight: 700 }}>{assignment.name}</TableCell>
              <TableCell>{assignment.category}</TableCell>
              <TableCell align="center">{formatPoints(assignment.score)} / {formatPoints(assignment.maxPoints)}</TableCell>
              <TableCell align="center"><StatusChip status={assignment.policyStatus} /></TableCell>
              <TableCell align="right">{assignment.formattedSubmissionTime}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function ProjectsEvidence({ assignments, onOpenAssignment }) {
  if (assignments.length === 0) {
    return <Typography sx={{ color: colors.muted, fontSize: 14 }}>No project evidence rows match the current filter.</Typography>;
  }

  return (
    <Stack spacing={1}>
      {assignments.map((assignment, index) => (
        <Accordion key={`${assignment.name}-${index}`} disableGutters elevation={0} sx={{ border: `1px solid ${colors.border}`, borderRadius: 1.5, '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between" sx={{ width: '100%', pr: 1 }}>
              <Typography sx={{ fontWeight: 750 }}>{assignment.name}</Typography>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography sx={{ color: colors.muted, fontSize: 13 }}>{formatPoints(assignment.score)} / {formatPoints(assignment.maxPoints)}</Typography>
                <StatusChip status={assignment.policyStatus} />
              </Stack>
            </Stack>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={1.5}>
              <Grid item xs={12} md={4}><MetricTile label="Raw score" value={`${formatPoints(assignment.score)} / ${formatPoints(assignment.maxPoints)}`} caption={formatPercentage(assignment.percentage)} /></Grid>
              <Grid item xs={12} md={4}><MetricTile label="Submitted" value={assignment.formattedSubmissionTime} caption={isLate(assignment.lateness) ? `Late: ${assignment.lateness}` : 'No late flag'} /></Grid>
              <Grid item xs={12} md={4}><MetricTile label="Policy status" value={assignment.policyStatus} caption="Click through for full row details." /></Grid>
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

export function CategoryDetailPage({ studentData, pageKey }) {
  const [filter, setFilter] = useState('all');
  const [tab, setTab] = useState('overview');
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const block = useMemo(() => getCategoryBlock(studentData, pageKey), [studentData, pageKey]);
  const allAssignments = useMemo(() => getCategoryAssignments(studentData, pageKey), [studentData, pageKey]);
  const assignments = useMemo(() => allAssignments.filter((assignment) => assignmentMatchesFilter(assignment, filter)), [allAssignments, filter]);
  const missingCount = allAssignments.filter((assignment) => ['missing', 'zero'].includes(assignment.policyStatus)).length;
  const lateCount = allAssignments.filter((assignment) => assignment.policyStatus === 'late').length;
  const remaining = Math.max(0, safeNumber(block?.cap) - safeNumber(block?.score));
  const def = CATEGORY_BY_KEY.get(pageKey) || CATEGORY_BY_KEY.get('assignments');
  const isProjects = pageKey === 'projects';

  const policyFlow = pageKey === 'labs'
    ? ['Raw lab points', 'Completion check', 'Drop lowest', 'Scale to cap', 'Final']
    : pageKey === 'attendance'
      ? ['Raw sessions', 'Group attendance', 'Make-ups', 'Forgiven absences', 'Final']
      : ['Raw project score', 'Late/extension state', 'Resubmission state', 'Configured cap', 'Final'];

  return (
    <PageFrame
      active={pageKey === 'quest' || pageKey === 'midterm' || pageKey === 'postterm' ? 'exams' : pageKey}
      title={block?.label || def?.label || 'Category'}
      subtitle="Summary, evidence, policy applied, impact, and action for this grading area."
      actions={<Button component={RouterLink} to="/profile/assignments" size="small" variant="outlined" startIcon={<AssignmentOutlined />}>Full ledger</Button>}
    >
      <CategoryFilterControls pageKey={pageKey} filter={filter} setFilter={setFilter} tab={tab} setTab={setTab} />

      <Grid container spacing={2}>
        <Grid item xs={12} md={3}>
          <MetricTile label="Final score" value={`${formatPoints(block?.score)} / ${formatPoints(block?.cap)}`} caption={formatPercentage(block?.percentage)} />
        </Grid>
        <Grid item xs={12} md={3}>
          <MetricTile label="Raw evidence" value={`${formatPoints(block?.summary?.rawScore)} / ${formatPoints(block?.summary?.rawMax)}`} caption={block?.summary?.rawMax ? formatPercentage(block?.summary?.rawPercentage) : 'No raw max'} />
        </Grid>
        <Grid item xs={12} md={3}>
          <MetricTile label="Open signals" value={`${missingCount} missing`} caption={`${lateCount} late rows`} />
        </Grid>
        <Grid item xs={12} md={3}>
          <MetricTile label="Impact" value={`${formatPoints(remaining)} pts`} caption="Remaining before the category cap." />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid item xs={12} md={8}>
          <SectionPanel title="Evidence" subtitle={pageKey === 'labs' && tab !== 'list' ? 'Switch to Lab List for row-level lab evidence.' : 'Click a row to inspect the raw assignment evidence.'}>
            {pageKey === 'labs' && tab === 'policy' ? (
              <PolicyFlow steps={policyFlow} />
            ) : isProjects ? (
              <ProjectsEvidence assignments={assignments} onOpenAssignment={setSelectedAssignment} />
            ) : (
              <AssignmentEvidenceTable assignments={assignments} onOpenAssignment={setSelectedAssignment} />
            )}
          </SectionPanel>
        </Grid>
        <Grid item xs={12} md={4}>
          <Stack spacing={2}>
            <SectionPanel title="Policy Applied">
              <PolicyFlow steps={policyFlow} compact />
            </SectionPanel>
            <SectionPanel title="Action">
              <Stack spacing={1.25}>
                <Typography sx={{ color: colors.muted, fontSize: 14 }}>
                  {missingCount > 0
                    ? `Start with the ${missingCount} missing or zero row${missingCount === 1 ? '' : 's'} before chasing smaller gains.`
                    : `This category is currently at ${formatPercentage(block?.percentage)}. Review the ledger if the score looks unexpected.`}
                </Typography>
                <Button component={RouterLink} to={pageKey === 'attendance' ? '/profile/explain' : '/profile/assignments'} variant="contained" size="small" endIcon={<ArrowForward />}>
                  {pageKey === 'attendance' ? 'Explain attendance score' : 'Open related rows'}
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

function ExamScoreSummary({ studentData, mode, selectedExam, setSelectedExam, onOpenClobber }) {
  return (
    <Grid container spacing={2}>
      {EXAM_DEFS.map((def) => {
        const rows = getExamRows(studentData, def.key);
        const row = getBestExamRow(rows);
        const block = getCategoryBlock(studentData, def.key);
        const cap = safeNumber(block?.cap);
        const pct = getExamPercent(row, mode);
        const points = percentageToPoints(pct, cap);
        const active = selectedExam === def.key;
        return (
          <Grid key={def.key} item xs={12} md={4}>
            <Paper
              elevation={0}
              onClick={() => setSelectedExam(def.key)}
              sx={{
                ...panelSx,
                p: 2,
                height: '100%',
                cursor: 'pointer',
                borderColor: active ? colors.ink : colors.border,
                backgroundColor: active ? colors.band : colors.surface,
              }}
            >
              <Stack spacing={1.25}>
                <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                  <Typography sx={{ fontWeight: 800 }}>{def.label}</Typography>
                  <Button component={RouterLink} to={def.route} size="small" endIcon={<ArrowForward />} onClick={(event) => event.stopPropagation()}>
                    Open
                  </Button>
                </Stack>
                <Typography sx={{ fontSize: 25, fontWeight: 850, color: colors.ink, lineHeight: 1.05 }}>
                  {points == null ? '-' : formatPoints(points)} / {formatPoints(cap)}
                </Typography>
                <Typography sx={{ color: colors.muted, fontSize: 13 }}>
                  {pct == null ? 'No policy row yet' : `${formatPercentage(pct)} in ${mode === 'raw' ? 'raw' : mode === 'questionBest' ? 'question-best' : 'after-clobber'} view`}
                </Typography>
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                  <Chip size="small" label={`${rows.length} attempts`} sx={{ fontWeight: 700 }} />
                  {row?.clobberSourceTitle && (
                    <Chip
                      size="small"
                      label="Clobber applied"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenClobber(row);
                      }}
                      sx={{ fontWeight: 700, backgroundColor: '#EEF2FF', color: '#4338CA' }}
                    />
                  )}
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
  const [mode, setMode] = useState('clobber');
  const [selectedExam, setSelectedExam] = useState('quest');
  const [clobberRow, setClobberRow] = useState(null);
  const totalMetrics = useMemo(() => {
    return EXAM_DEFS.reduce((acc, def) => {
      const block = getCategoryBlock(studentData, def.key);
      const row = getBestExamRow(getExamRows(studentData, def.key));
      const cap = safeNumber(block?.cap);
      acc.raw += percentageToPoints(getExamPercent(row, 'raw'), cap) || 0;
      acc.questionBest += percentageToPoints(getExamPercent(row, 'questionBest'), cap) || 0;
      acc.clobber += percentageToPoints(getExamPercent(row, 'clobber'), cap) || 0;
      acc.final += safeNumber(block?.score);
      return acc;
    }, { raw: 0, questionBest: 0, clobber: 0, final: 0 });
  }, [studentData]);
  const selectedDef = CATEGORY_BY_KEY.get(selectedExam);

  return (
    <PageFrame
      active="exams"
      title="Exams And Clobber"
      subtitle="Raw, question-best, and clobber outcomes shown through coordinated exam views."
      actions={(
        <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_event, value) => value && setMode(value)}>
          <ToggleButton value="raw">Raw</ToggleButton>
          <ToggleButton value="questionBest">Question Best</ToggleButton>
          <ToggleButton value="clobber">After Clobber</ToggleButton>
        </ToggleButtonGroup>
      )}
    >
      <Grid container spacing={2}>
        <Grid item xs={12} md={3}><MetricTile label="Raw exam total" value={formatPoints(totalMetrics.raw)} caption="Before question-best and clobber." /></Grid>
        <Grid item xs={12} md={3}><MetricTile label="Question-best total" value={formatPoints(totalMetrics.questionBest)} caption="Best component/topic logic." /></Grid>
        <Grid item xs={12} md={3}><MetricTile label="After clobber" value={formatPoints(totalMetrics.clobber)} caption="Later-exam replacement logic." /></Grid>
        <Grid item xs={12} md={3}><MetricTile label="Net clobber gain" value={`+${formatPoints(Math.max(0, totalMetrics.clobber - totalMetrics.raw))}`} caption="Estimated gain over raw exam total." /></Grid>
      </Grid>

      <ExamScoreSummary
        studentData={studentData}
        mode={mode}
        selectedExam={selectedExam}
        setSelectedExam={setSelectedExam}
        onOpenClobber={setClobberRow}
      />

      <Grid container spacing={2}>
        <Grid item xs={12} lg={5}>
          <SectionPanel title={`${selectedDef?.label || 'Exam'} Topic Mastery Radar`} subtitle="Mastery shape and growth over attempts.">
            <TopicMasteryRadar trend={getExamTrend(studentData, selectedExam)} />
          </SectionPanel>
        </Grid>
        <Grid item xs={12} lg={3.5}>
          <SectionPanel title="Clobber Ladder" subtitle="Score transformation from raw to final.">
            <ClobberLadder studentData={studentData} examKey={selectedExam} />
          </SectionPanel>
        </Grid>
        <Grid item xs={12} lg={3.5}>
          <SectionPanel title="Question Best Matrix" subtitle="Which attempt score was selected.">
            <QuestionBestMatrix trend={getExamTrend(studentData, selectedExam)} compact />
          </SectionPanel>
        </Grid>
      </Grid>

      <Drawer anchor="right" open={Boolean(clobberRow)} onClose={() => setClobberRow(null)}>
        <Box sx={{ width: { xs: 320, sm: 420 }, p: 2.5 }}>
          <Typography variant="h6" sx={sectionTitleSx}>Clobber Explanation</Typography>
          <Typography sx={{ color: colors.muted, fontSize: 14, mt: 1 }}>
            {clobberRow?.assignmentTitle || 'This attempt'} was affected by {clobberRow?.clobberSourceTitle || 'a later exam'}.
          </Typography>
          <Divider sx={{ my: 2 }} />
          <ClobberLadder studentData={studentData} examKey={normalizeText(clobberRow?.examType)} />
        </Box>
      </Drawer>
    </PageFrame>
  );
}

export function SingleExamPage({ studentData, examKey }) {
  const def = CATEGORY_BY_KEY.get(examKey) || CATEGORY_BY_KEY.get('quest');
  const block = getCategoryBlock(studentData, def.key);

  return (
    <PageFrame
      active="exams"
      title={`${def.label} ${formatPoints(block?.score)} / ${formatPoints(block?.cap)}`}
      subtitle="Radar shows mastery shape, ladder shows score transformation, and matrix shows why the best score was used."
      actions={<Button component={RouterLink} to="/profile/exams" size="small" variant="outlined">All exams</Button>}
    >
      <Grid container spacing={2}>
        <Grid item xs={12} lg={6}>
          <SectionPanel title="Topic Mastery Radar">
            <TopicMasteryRadar trend={getExamTrend(studentData, def.key)} height={430} />
          </SectionPanel>
        </Grid>
        <Grid item xs={12} lg={6}>
          <SectionPanel title="Clobber Ladder">
            <ClobberLadder studentData={studentData} examKey={def.key} roomy />
          </SectionPanel>
        </Grid>
        <Grid item xs={12}>
          <SectionPanel title="Question Best Matrix" subtitle="Attempt columns show cumulative best by topic; Best Used is the selected topic score.">
            <QuestionBestMatrix trend={getExamTrend(studentData, def.key)} />
          </SectionPanel>
        </Grid>
      </Grid>
    </PageFrame>
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
          data: Array.isArray(series.data) ? series.data.map((value) => safeNumber(value)) : [],
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
          label: (context) => `${context.dataset.label}: ${formatPercentage(context.parsed.r)}`,
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

function ClobberLadder({ studentData, examKey, roomy = false }) {
  const rows = getExamRows(studentData, examKey);
  const row = getBestExamRow(rows);
  const block = getCategoryBlock(studentData, examKey);
  const cap = safeNumber(block?.cap);

  if (!row) {
    return <Typography sx={{ color: colors.muted, fontSize: 14 }}>No exam policy row is available yet.</Typography>;
  }

  const steps = [
    { label: `${block?.label || 'Exam'} raw`, value: row.rawPercentage },
    { label: 'Question best', value: row.questionBestPercentage },
    { label: row.clobberSourceTitle ? `Clobbered by ${row.clobberSourceTitle}` : 'Clobber check', value: row.clobberedPercentage },
    { label: 'Final used', value: row.finalPercentage },
  ].filter((step) => step.value !== null && step.value !== undefined);

  const rawPoints = percentageToPoints(row.rawPercentage, cap) || 0;
  const finalPoints = percentageToPoints(row.finalPercentage, cap) || percentageToPoints(row.clobberedPercentage, cap) || rawPoints;
  const gain = Math.max(0, finalPoints - rawPoints);

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
                {points == null ? '-' : `${formatPoints(points)} / ${formatPoints(cap)}`} · {formatPercentage(step.value)}
              </Typography>
            </Box>
          </Stack>
        );
      })}
      <Divider />
      <Chip label={`Net gain +${formatPoints(gain)}`} sx={{ alignSelf: 'flex-start', backgroundColor: colors.greenBg, color: colors.green, fontWeight: 800 }} />
    </Stack>
  );
}

function QuestionBestMatrix({ trend, compact = false }) {
  if (!trend.components.length || !trend.series.length) {
    return <Typography sx={{ color: colors.muted, fontSize: 14 }}>Question-best component rows are not available yet.</Typography>;
  }

  const series = compact ? trend.series.slice(-3) : trend.series;
  const rows = trend.components.map((component, componentIndex) => {
    const values = series.map((item) => safeNumber(item.data?.[componentIndex]));
    return {
      component,
      values,
      best: values.length ? Math.max(...values) : 0,
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
                {formatPercentage(row.best, 0)}
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
                    {formatPercentage(value, 0)}
                  </Typography>
                </Box>
              ))}
            </Box>

            <Box>
              <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: 0.5 }}>
                <Typography sx={{ color: colors.muted, fontSize: 12, fontWeight: 750 }}>Best Used</Typography>
                <Typography sx={{ color: colors.muted, fontSize: 12, fontWeight: 750 }}>{formatPercentage(row.best, 0)}</Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={Math.max(0, Math.min(100, row.best))}
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

function groupAssignments(rows, groupBy) {
  if (groupBy === 'none') return [['All assignments', rows]];
  const groups = new Map();
  rows.forEach((row) => {
    let key = row.category || 'Uncategorized';
    if (groupBy === 'time') {
      const date = row.submissionTime ? new Date(row.submissionTime) : null;
      key = date && Number.isFinite(date.getTime())
        ? date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
        : 'No submission time';
    } else if (groupBy === 'policy') {
      key = row.policyStatus;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  return Array.from(groups.entries());
}

export function AssignmentLedger({ studentData }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [category, setCategory] = useState('all');
  const [groupBy, setGroupBy] = useState('category');
  const [selectedAssignment, setSelectedAssignment] = useState(null);

  const rows = useMemo(() => getRawAssignments(studentData).map((assignment) => decorateAssignment(assignment)), [studentData]);
  const categories = useMemo(() => Array.from(new Set(rows.map((row) => row.category).filter(Boolean))).sort(), [rows]);
  const visibleRows = useMemo(() => {
    const query = normalizeText(search);
    return rows
      .filter((row) => category === 'all' || row.category === category)
      .filter((row) => filter === 'all' || row.policyStatus === filter)
      .filter((row) => !query || normalizeText(`${row.category} ${row.name}`).includes(query))
      .sort((a, b) => (b.timestamp - a.timestamp) || String(a.category).localeCompare(String(b.category)) || String(a.name).localeCompare(String(b.name)));
  }, [category, filter, rows, search]);
  const groups = useMemo(() => groupAssignments(visibleRows, groupBy), [visibleRows, groupBy]);

  return (
    <PageFrame
      active="assignments"
      title="Assignment Ledger"
      subtitle="The complete raw assignment table has moved out of the workspace and into this focused ledger."
      actions={<Button variant="outlined" size="small" startIcon={<DownloadOutlined />}>Export</Button>}
    >
      <SectionPanel>
        <Grid container spacing={1.5} alignItems="center">
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              size="small"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search assignments"
              InputProps={{ startAdornment: <Search sx={{ color: colors.soft, fontSize: 18, mr: 1 }} /> }}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth size="small">
              <InputLabel>Category</InputLabel>
              <Select value={category} label="Category" onChange={(event) => setCategory(event.target.value)}>
                <MenuItem value="all">All categories</MenuItem>
                {categories.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth size="small">
              <InputLabel>Group by</InputLabel>
              <Select value={groupBy} label="Group by" onChange={(event) => setGroupBy(event.target.value)}>
                <MenuItem value="category">Category</MenuItem>
                <MenuItem value="time">Time</MenuItem>
                <MenuItem value="policy">Policy Status</MenuItem>
                <MenuItem value="none">None</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={2}>
            <Typography sx={{ color: colors.muted, fontSize: 13, textAlign: { xs: 'left', md: 'right' } }}>
              {visibleRows.length} rows
            </Typography>
          </Grid>
        </Grid>
        <ToggleButtonGroup size="small" exclusive value={filter} onChange={(_event, value) => value && setFilter(value)} sx={{ mt: 1.5, flexWrap: 'wrap' }}>
          {['all', 'missing', 'late', 'zero', 'dropped', 'clobbered', 'used'].map((item) => (
            <ToggleButton key={item} value={item}>
              {item.replace(/^\w/, (char) => char.toUpperCase())}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </SectionPanel>

      <Stack spacing={2}>
        {groups.map(([group, groupRows]) => (
          <SectionPanel key={group} title={group} subtitle={`${groupRows.length} assignment rows`}>
            <AssignmentEvidenceTable assignments={groupRows} onOpenAssignment={setSelectedAssignment} />
          </SectionPanel>
        ))}
      </Stack>
      <AssignmentDrawer assignment={selectedAssignment} onClose={() => setSelectedAssignment(null)} />
    </PageFrame>
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
            <Grid item xs={6}><MetricTile label="Score" value={`${formatPoints(assignment?.score)} / ${formatPoints(assignment?.maxPoints)}`} caption={formatPercentage(assignment?.percentage)} /></Grid>
            <Grid item xs={6}><MetricTile label="Policy status" value={assignment?.policyStatus || '-'} caption="How this row is treated." /></Grid>
            <Grid item xs={12}><MetricTile label="Submission time" value={assignment?.formattedSubmissionTime || '-'} caption={isLate(assignment?.lateness) ? `Late: ${assignment.lateness}` : 'No late flag'} /></Grid>
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
              {assignment?.policyStatus === 'missing'
                ? 'Confirm whether the work can still be submitted or whether a make-up/extension policy applies.'
                : assignment?.policyStatus === 'late'
                  ? 'Check the lateness rule and verify whether the final score already reflects the penalty.'
                  : 'Use this row as raw evidence when checking the category calculation.'}
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
