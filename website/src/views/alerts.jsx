// src/views/alerts.jsx
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControl,
  Grid,
  InputLabel,
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
  Typography,
} from '@mui/material';
import {
  Error as ErrorIcon,
  Insights,
  Search,
  TrendingDown,
  WarningAmber,
} from '@mui/icons-material';
import PageHeader from '../components/PageHeader';
import StudentProfile from '../components/StudentProfile';
import { cachedApiGet } from '../utils/apiCache';

const REASON_COLORS = {
  overall: '#dc2626',
  missing: '#ea580c',
  trend: '#7c3aed',
  section: '#0891b2',
  'recent-zero': '#be123c',
  'low-work': '#f59e0b',
};

const RISK_LEVELS = {
  high: { label: 'High', min: 70, color: '#dc2626', bg: '#fef2f2' },
  medium: { label: 'Medium', min: 40, color: '#f59e0b', bg: '#fffbeb' },
  watch: { label: 'Watch', min: 20, color: '#2563eb', bg: '#eff6ff' },
  ok: { label: 'OK', min: 0, color: '#16a34a', bg: '#f0fdf4' },
};

const MIN_CLASS_SIGNAL_RATE = 0.08;

function normalize(value = '') {
  return String(value || '').trim().toLowerCase();
}

function isHiddenSection(section = '') {
  const value = normalize(section);
  return !value || value === 'uncategorized' || value.startsWith('_');
}

function isRollupAssignment(section = '', assignment = '') {
  const sec = normalize(section);
  const name = normalize(assignment);
  if (!sec || sec !== name) return false;
  return sec.includes('attendance') || sec.includes('lab') || sec.includes('project');
}

function getPolicyCategory(section = '', assignment = '') {
  const combined = normalize(`${section} ${assignment}`);
  if (combined.includes('attendance') || combined.includes('participation')) return 'attendance';
  if (combined.includes('lecture quiz') || combined.includes('discussion')) return 'attendance';
  if (combined.includes('lab')) return 'labs';
  if (combined.includes('project')) return 'projects';
  if (combined.includes('quest')) return 'quest';
  if (combined.includes('midterm')) return 'midterm';
  if (combined.includes('postterm')) return 'postterm';
  return normalize(section);
}

function getSummaryForPolicyCategory(sectionSummaries, category) {
  return sectionSummaries.find((summary) => getPolicyCategory(summary.section) === category);
}

function isComponentComplete(sectionSummaries, category) {
  const summary = getSummaryForPolicyCategory(sectionSummaries, category);
  return Boolean(summary && summary.cap > 0 && summary.score >= summary.cap);
}

function isRequiredRawSignal(assignment, sectionSummaries) {
  const category = getPolicyCategory(assignment.section, assignment.name);
  const name = normalize(assignment.name);

  if (isComponentComplete(sectionSummaries, category)) return false;

  if (category === 'attendance' || category === 'labs') {
    return false;
  }

  if (category === 'quest') {
    return /quest\s*1\b/.test(name);
  }

  if (category === 'midterm') {
    return /midterm\s*1\b/.test(name);
  }

  if (category === 'postterm') {
    return /postterm\s*1\b/.test(name);
  }

  return category === 'projects';
}

function formatScore(value, digits = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '-';
  return numeric.toFixed(digits);
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
        grade: String(bin?.grade || bin?.letter || ''),
        low: Math.min(low, high),
        high: Math.max(low, high),
        range: String(bin?.range || ''),
      };
    })
    .filter((bin) => bin && bin.grade)
    .sort((a, b) => b.low - a.low);
}

function getGradeForScore(score, gradeBins = []) {
  const roundedScore = Math.round(Number(score) || 0);
  const matched = gradeBins.find((bin) => roundedScore >= bin.low && roundedScore <= bin.high);
  return matched ? matched.grade : 'N/A';
}

function buildCourseQuery(courseId, courses = []) {
  if (!courseId) return '';
  const matchedCourse = courses.find((course) => String(course.id) === String(courseId));
  const resolvedCourseId = matchedCourse?.gradescope_course_id || courseId;
  return `?course_id=${encodeURIComponent(resolvedCourseId)}`;
}

function normalizeCourseList(list) {
  const merged = new Map();
  (Array.isArray(list) ? list : []).forEach((course) => {
    const key = String(course?.gradescope_course_id || course?.id || '').trim();
    if (!key) return;
    if (!merged.has(key)) {
      merged.set(key, { ...course, id: String(course.id) });
    }
  });
  return Array.from(merged.values());
}

function getPublishedAssignments(students, assignments) {
  const activeStudents = students.filter((student) => student.email !== 'MAX POINTS' && student.name !== 'MAX POINTS');
  const minSignalCount = Math.max(1, Math.ceil(activeStudents.length * MIN_CLASS_SIGNAL_RATE));

  return assignments
    .filter((assignment) => {
      if (isHiddenSection(assignment.section)) return false;
      if (isRollupAssignment(assignment.section, assignment.name)) return false;

      let observedCount = 0;
      activeStudents.forEach((student) => {
        const value = student?.scores?.[assignment.section]?.[assignment.name];
        if (value !== null && value !== undefined && value !== '') {
          observedCount += 1;
        }
      });

      return observedCount >= minSignalCount;
    })
    .map((assignment, index) => ({ ...assignment, order: index }));
}

function getRiskLevel(score) {
  if (score >= RISK_LEVELS.high.min) return 'high';
  if (score >= RISK_LEVELS.medium.min) return 'medium';
  if (score >= RISK_LEVELS.watch.min) return 'watch';
  return 'ok';
}

function buildStudentAlert(student, context) {
  const {
    assignmentCatalog,
    assignmentPoints,
    gradeBins,
    sectionCaps,
    totalCap,
  } = context;

  const email = String(student.email || '').trim();
  const summaryTotals = student.summarySectionTotals || {};

  const cleanSummaryEntries = Object.entries(summaryTotals)
    .filter(([section]) => !isHiddenSection(section));

  const totalScore = cleanSummaryEntries.reduce((sum, [, value]) => sum + (Number(value) || 0), 0);
  const currentGrade = getGradeForScore(totalScore, gradeBins);
  const overallPct = totalCap > 0 ? (totalScore / totalCap) * 100 : 0;

  const sectionSummaries = cleanSummaryEntries.map(([section, value]) => {
    const cap = Number(sectionCaps[normalize(section)]) || 0;
    const score = Number(value) || 0;
    return {
      section,
      score,
      cap,
      pct: cap > 0 ? (score / cap) * 100 : null,
      remaining: cap > 0 ? Math.max(0, cap - score) : null,
    };
  });

  const weakSections = sectionSummaries
    .filter((item) => Number.isFinite(item.pct) && item.pct < 70)
    .sort((a, b) => a.pct - b.pct);

  const assignmentRows = assignmentCatalog.map((assignment) => {
    const raw = student?.scores?.[assignment.section]?.[assignment.name];
    const maxFromCatalog = Number(assignment.maxPoints) || 0;
    const configuredCap = Number(assignmentPoints[assignment.name]) || maxFromCatalog;
    const rawScore = raw === null || raw === undefined || raw === '' ? null : Number(raw);
    const score = Number.isFinite(rawScore) ? rawScore : null;
    const pct = maxFromCatalog > 0 && score !== null ? (score / maxFromCatalog) * 100 : null;
    const requiredRawSignal = isRequiredRawSignal(assignment, sectionSummaries);

    return {
      ...assignment,
      score,
      maxPoints: maxFromCatalog,
      configuredCap,
      pct,
      rawSignalCategory: getPolicyCategory(assignment.section, assignment.name),
      requiredRawSignal,
      missing: requiredRawSignal && (score === null || score === 0),
    };
  });

  const signalRows = assignmentRows.filter((row) => row.requiredRawSignal);
  const gradedRows = signalRows.filter((row) => Number.isFinite(row.pct));
  const missingRows = assignmentRows.filter((row) => row.missing);
  const lowRows = gradedRows.filter((row) => row.pct < 60);

  const recentRows = gradedRows.slice(-Math.min(8, gradedRows.length));
  const earlyRows = gradedRows.slice(0, Math.min(8, gradedRows.length));
  const recentAvg = recentRows.length
    ? recentRows.reduce((sum, row) => sum + row.pct, 0) / recentRows.length
    : null;
  const earlyAvg = earlyRows.length
    ? earlyRows.reduce((sum, row) => sum + row.pct, 0) / earlyRows.length
    : null;
  const trendDelta = Number.isFinite(recentAvg) && Number.isFinite(earlyAvg)
    ? recentAvg - earlyAvg
    : null;

  const recentZeros = recentRows.filter((row) => row.score === 0).length;
  const missingRawPoints = missingRows.reduce((sum, row) => sum + (Number(row.configuredCap) || 0), 0);
  const missingPointsBySection = missingRows.reduce((acc, row) => {
    const key = normalize(row.section);
    acc[key] = (acc[key] || 0) + (Number(row.configuredCap) || 0);
    return acc;
  }, {});
  const missingWeightedPoints = Object.entries(missingPointsBySection).reduce((sum, [section, points]) => {
    const sectionSummary = sectionSummaries.find((item) => normalize(item.section) === section);
    if (sectionSummary && Number.isFinite(sectionSummary.remaining)) {
      return sum + Math.min(points, sectionSummary.remaining);
    }
    return sum + points;
  }, 0);
  const lowWeightedPoints = lowRows.reduce((sum, row) => sum + (Number(row.configuredCap) || 0), 0);

  const reasons = [];
  let riskScore = 0;

  if (overallPct < 60) {
    const points = overallPct < 50 ? 34 : 24;
    riskScore += points;
    reasons.push({
      type: 'overall',
      label: `Current score is ${formatScore(overallPct)}% (${currentGrade})`,
      weight: points,
    });
  }

  if (missingRows.length >= 2 || missingWeightedPoints >= 20) {
    const points = Math.min(28, 8 + missingRows.length * 4 + missingWeightedPoints * 0.25);
    riskScore += points;
    reasons.push({
      type: 'missing',
      label: `${missingRows.length} missing/zero required assignments (up to ${formatScore(missingWeightedPoints, 0)} capped pts)`,
      weight: points,
    });
  }

  if (trendDelta !== null && trendDelta <= -12 && recentRows.length >= 4) {
    const points = Math.min(24, Math.abs(trendDelta) * 0.9);
    riskScore += points;
    reasons.push({
      type: 'trend',
      label: `Recent average dropped ${formatScore(Math.abs(trendDelta))} pts (${formatScore(earlyAvg)}% to ${formatScore(recentAvg)}%)`,
      weight: points,
    });
  }

  if (weakSections.length > 0) {
    const primaryWeak = weakSections[0];
    const points = primaryWeak.pct < 50 ? 18 : 10;
    riskScore += points;
    reasons.push({
      type: 'section',
      label: `${primaryWeak.section} is low at ${formatScore(primaryWeak.pct)}%`,
      weight: points,
    });
  }

  if (recentZeros >= 2) {
    const points = Math.min(16, recentZeros * 5);
    riskScore += points;
    reasons.push({
      type: 'recent-zero',
      label: `${recentZeros} zero scores in the latest graded work`,
      weight: points,
    });
  }

  if (lowRows.length >= 3) {
    const points = Math.min(14, 4 + lowRows.length * 2 + lowWeightedPoints * 0.08);
    riskScore += points;
    reasons.push({
      type: 'low-work',
      label: `${lowRows.length} low-score assignments below 60%`,
      weight: points,
    });
  }

  riskScore = Math.max(0, Math.min(100, Math.round(riskScore)));
  const riskLevel = getRiskLevel(riskScore);

  return {
    name: student.name,
    email,
    riskScore,
    riskLevel,
    currentGrade,
    totalScore,
    totalCap,
    overallPct,
    missingCount: missingRows.length,
    missingWeightedPoints,
    missingRawPoints,
    lowCount: lowRows.length,
    trendDelta,
    recentAvg,
    earlyAvg,
    weakSections,
    reasons: reasons.sort((a, b) => b.weight - a.weight).slice(0, 4),
    topMissing: missingRows.slice(0, 5),
    topLow: lowRows.sort((a, b) => a.pct - b.pct).slice(0, 5),
  };
}

function compactReasonText(alert) {
  if (!alert?.reasons?.length) return 'No major risk signal. Keep monitoring.';
  return alert.reasons.map((reason) => reason.label).join(' · ');
}

export default function Alerts() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [students, setStudents] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [bins, setBins] = useState(null);
  const [courses, setCourses] = useState([]);
  const [selectedCourse, setSelectedCourse] = useState(localStorage.getItem('selectedCourseId') || '');
  const [selectedLevel, setSelectedLevel] = useState('actionable');
  const [selectedSection, setSelectedSection] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);

  useEffect(() => {
    Promise.allSettled([
      cachedApiGet('/admin/sync', { ttlMs: 60000 }),
      cachedApiGet('/students/courses', { ttlMs: 60000 }),
    ]).then(([adminResult, studentResult]) => {
      const adminCourses = adminResult.status === 'fulfilled' ? (adminResult.value?.data?.courses || []) : [];
      const studentCourses = studentResult.status === 'fulfilled' ? (studentResult.value?.data?.courses || []) : [];
      const fetchedCourses = normalizeCourseList([...adminCourses, ...studentCourses]);
      setCourses(fetchedCourses);

      if (fetchedCourses.length > 0) {
        const remembered = localStorage.getItem('selectedCourseId') || selectedCourse;
        const next = fetchedCourses.some((course) => String(course.id) === String(remembered))
          ? String(remembered)
          : String(fetchedCourses[0].id);
        setSelectedCourse(next);
        localStorage.setItem('selectedCourseId', next);
      }
    }).catch((err) => {
      console.error('Failed to load courses for alerts:', err);
    });
  }, []);

  useEffect(() => {
    const handleSelectedCourseChanged = (event) => {
      setSelectedCourse(event?.detail?.courseId || localStorage.getItem('selectedCourseId') || '');
    };
    window.addEventListener('selectedCourseChanged', handleSelectedCourseChanged);
    return () => window.removeEventListener('selectedCourseChanged', handleSelectedCourseChanged);
  }, []);

  useEffect(() => {
    if (!selectedCourse) return;

    setLoading(true);
    setError(null);
    const query = buildCourseQuery(selectedCourse, courses);

    Promise.all([
      cachedApiGet(`/admin/studentScores${query}`, { ttlMs: 30000 }),
      cachedApiGet(`/admin/assignments${query}`, { ttlMs: 60000 }),
      cachedApiGet(`/bins${query}`, { ttlMs: 60000 }),
    ])
      .then(([studentRes, assignmentRes, binsRes]) => {
        setStudents(studentRes?.data?.students || []);
        const flattenedAssignments = Object.entries(assignmentRes?.data || {})
          .flatMap(([section, sectionAssignments]) => (
            Object.entries(sectionAssignments || {}).map(([name, maxPoints]) => ({
              section,
              name,
              maxPoints: Number(maxPoints) || 0,
            }))
          ));
        setAssignments(flattenedAssignments);
        setBins(binsRes?.data || null);
      })
      .catch((err) => {
        console.error('Failed to load alert data:', err);
        setError(err?.response?.data?.error || err?.message || 'Failed to load alert data');
      })
      .finally(() => setLoading(false));
  }, [selectedCourse, courses]);

  const analysis = useMemo(() => {
    const activeStudents = students.filter((student) => student.email !== 'MAX POINTS' && student.name !== 'MAX POINTS');
    const assignmentCatalog = getPublishedAssignments(activeStudents, assignments);
    const assignmentPoints = bins?.assignment_points || {};
    const gradeBins = parseGradeBins(bins?.bins || []);
    const totalCap = Number(bins?.overall_cap_points) || Number(bins?.total_points_cap) || 400;
    const sectionCaps = Object.entries(assignmentPoints).reduce((acc, [name, value]) => {
      acc[normalize(name)] = Number(value) || 0;
      return acc;
    }, {});

    const alerts = activeStudents.map((student) => buildStudentAlert(student, {
      assignmentCatalog,
      assignmentPoints,
      gradeBins,
      sectionCaps,
      totalCap,
    }));

    return {
      assignmentCatalog,
      alerts: alerts.sort((a, b) => b.riskScore - a.riskScore),
      gradeBins,
      totalCap,
    };
  }, [students, assignments, bins]);

  const sectionOptions = useMemo(() => {
    const values = new Set();
    analysis.assignmentCatalog.forEach((assignment) => values.add(assignment.section));
    return Array.from(values).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  }, [analysis.assignmentCatalog]);

  const filteredAlerts = useMemo(() => {
    const query = normalize(searchQuery);
    return analysis.alerts.filter((item) => {
      if (selectedLevel === 'actionable' && item.riskLevel === 'ok') return false;
      if (selectedLevel !== 'all' && selectedLevel !== 'actionable' && item.riskLevel !== selectedLevel) return false;
      if (selectedSection !== 'all') {
        const hasSectionReason = item.weakSections.some((section) => section.section === selectedSection)
          || item.topMissing.some((assignment) => assignment.section === selectedSection)
          || item.topLow.some((assignment) => assignment.section === selectedSection);
        if (!hasSectionReason) return false;
      }
      if (query && !normalize(`${item.name} ${item.email}`).includes(query)) return false;
      return true;
    });
  }, [analysis.alerts, searchQuery, selectedLevel, selectedSection]);

  const counts = useMemo(() => ({
    high: analysis.alerts.filter((item) => item.riskLevel === 'high').length,
    medium: analysis.alerts.filter((item) => item.riskLevel === 'medium').length,
    watch: analysis.alerts.filter((item) => item.riskLevel === 'watch').length,
    ok: analysis.alerts.filter((item) => item.riskLevel === 'ok').length,
    actionable: analysis.alerts.filter((item) => item.riskLevel !== 'ok').length,
  }), [analysis.alerts]);

  const handleStudentClick = (student) => {
    setSelectedStudent({ email: student.email, name: student.name });
    setProfileOpen(true);
  };

  const currentCourse = courses.find((course) => String(course.id) === String(selectedCourse));

  return (
    <>
      <PageHeader>Alerts</PageHeader>

      <Box px={{ xs: 3, md: 8 }} py={4}>
        {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

        <Stack spacing={3}>
          <Paper elevation={0} className="glass-section" sx={{ p: 3, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', alignItems: { xs: 'stretch', md: 'center' }, justifyContent: 'space-between', gap: 2, flexDirection: { xs: 'column', md: 'row' } }}>
              <Box>
                <Typography variant="h5" sx={{ fontWeight: 700 }}>Early Alert Dashboard</Typography>
                <Typography sx={{ color: 'text.secondary', mt: 0.5 }}>
                  {currentCourse?.name || 'Selected course'} · {analysis.assignmentCatalog.length} published signals · {analysis.alerts.length} students
                </Typography>
              </Box>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                <TextField
                  size="small"
                  placeholder="Search students"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  InputProps={{ startAdornment: <Search sx={{ mr: 1, color: 'text.secondary' }} /> }}
                />
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel>Risk</InputLabel>
                  <Select value={selectedLevel} label="Risk" onChange={(event) => setSelectedLevel(event.target.value)}>
                    <MenuItem value="actionable">Actionable</MenuItem>
                    <MenuItem value="high">High</MenuItem>
                    <MenuItem value="medium">Medium</MenuItem>
                    <MenuItem value="watch">Watch</MenuItem>
                    <MenuItem value="ok">OK</MenuItem>
                    <MenuItem value="all">All</MenuItem>
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 180 }}>
                  <InputLabel>Section</InputLabel>
                  <Select value={selectedSection} label="Section" onChange={(event) => setSelectedSection(event.target.value)}>
                    <MenuItem value="all">All sections</MenuItem>
                    {sectionOptions.map((section) => (
                      <MenuItem key={section} value={section}>{section}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>
            </Box>
          </Paper>

          <Grid container spacing={2}>
            {[
              { key: 'high', filter: 'high', title: 'High Risk', icon: <ErrorIcon />, subtitle: 'Needs instructor attention' },
              { key: 'medium', filter: 'medium', title: 'Medium Risk', icon: <WarningAmber />, subtitle: 'Likely needs support' },
              { key: 'watch', filter: 'watch', title: 'Watch', icon: <Insights />, subtitle: 'Monitor this week' },
              { key: 'ok', filter: 'ok', title: 'Stable', icon: <TrendingDown />, subtitle: 'No major signal' },
            ].map((card) => {
              const level = RISK_LEVELS[card.key];
              const isSelected = selectedLevel === card.filter;
              return (
                <Grid key={card.key} item xs={12} sm={6} md={3}>
                  <Card
                    elevation={0}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedLevel(card.filter)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedLevel(card.filter);
                      }
                    }}
                    sx={{
                      borderRadius: 2,
                      border: `1px solid ${isSelected ? level.color : `${level.color}22`}`,
                      backgroundColor: level.bg,
                      boxShadow: isSelected ? `0 0 0 2px ${level.color}22` : 'none',
                      cursor: 'pointer',
                      transition: 'border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease',
                      '&:hover': {
                        borderColor: level.color,
                        transform: 'translateY(-1px)',
                      },
                      '&:focus-visible': {
                        outline: `2px solid ${level.color}`,
                        outlineOffset: 2,
                      },
                    }}
                  >
                    <CardContent>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Box sx={{ color: level.color }}>{card.icon}</Box>
                        <Typography variant="h4" sx={{ color: level.color, fontWeight: 800 }}>{counts[card.key]}</Typography>
                      </Box>
                      <Typography sx={{ fontWeight: 700, mt: 1 }}>{card.title}</Typography>
                      <Typography variant="body2" sx={{ color: 'text.secondary' }}>{card.subtitle}</Typography>
                    </CardContent>
                  </Card>
                </Grid>
              );
            })}
          </Grid>

          <Paper elevation={0} sx={{ borderRadius: 2, overflow: 'hidden', border: '1px solid #e5e7eb' }}>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ backgroundColor: '#f8fafc' }}>
                    <TableCell><strong>Student</strong></TableCell>
                    <TableCell align="center"><strong>Risk</strong></TableCell>
                    <TableCell align="center"><strong>Grade</strong></TableCell>
                    <TableCell align="center"><strong>Total</strong></TableCell>
                    <TableCell><strong>Primary Signals</strong></TableCell>
                    <TableCell><strong>Suggested Action</strong></TableCell>
                    <TableCell align="center"><strong>Profile</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={7}>
                        <Typography sx={{ py: 3, color: 'text.secondary' }}>Loading alert data...</Typography>
                      </TableCell>
                    </TableRow>
                  ) : filteredAlerts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7}>
                        <Typography sx={{ py: 3, color: 'text.secondary' }}>No students match these filters.</Typography>
                      </TableCell>
                    </TableRow>
                  ) : filteredAlerts.map((student) => {
                    const level = RISK_LEVELS[student.riskLevel];
                    return (
                      <TableRow key={student.email} hover>
                        <TableCell>
                          <Typography sx={{ fontWeight: 700 }}>{student.name}</Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{student.email}</Typography>
                        </TableCell>
                        <TableCell align="center">
                          <Chip
                            label={`${level.label} · ${student.riskScore}`}
                            size="small"
                            sx={{ backgroundColor: level.color, color: 'white', fontWeight: 700 }}
                          />
                        </TableCell>
                        <TableCell align="center">
                          <Typography sx={{ fontWeight: 700 }}>{student.currentGrade}</Typography>
                        </TableCell>
                        <TableCell align="center">
                          <Typography>{formatScore(student.totalScore, 0)} / {formatScore(student.totalCap, 0)}</Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{formatScore(student.overallPct)}%</Typography>
                        </TableCell>
                        <TableCell sx={{ maxWidth: 420 }}>
                          <Stack direction="row" gap={0.75} flexWrap="wrap">
                            {student.reasons.length === 0 ? (
                              <Chip size="small" label="No major signal" />
                            ) : student.reasons.map((reason) => (
                              <Chip
                                key={`${student.email}-${reason.type}`}
                                size="small"
                                label={reason.label}
                                sx={{
                                  backgroundColor: `${REASON_COLORS[reason.type] || level.color}14`,
                                  color: '#111827',
                                  maxWidth: 360,
                                }}
                              />
                            ))}
                          </Stack>
                        </TableCell>
                        <TableCell sx={{ maxWidth: 300 }}>
                          <Typography variant="body2">
                            {student.riskLevel === 'high'
                              ? 'Reach out directly and review recent work before next deadline.'
                              : student.riskLevel === 'medium'
                                ? 'Send a targeted check-in with the most relevant missing/low items.'
                                : student.riskLevel === 'watch'
                                  ? 'Monitor next submission and compare against recent trend.'
                                  : 'No action needed.'}
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            {compactReasonText(student)}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">
                          <Button size="small" variant="outlined" onClick={() => handleStudentClick(student)}>
                            Open
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Stack>
      </Box>

      <StudentProfile
        open={profileOpen}
        onClose={() => {
          setProfileOpen(false);
          setSelectedStudent(null);
        }}
        studentEmail={selectedStudent?.email}
        studentName={selectedStudent?.name}
        selectedCourse={selectedCourse}
        courses={courses}
      />
    </>
  );
}
