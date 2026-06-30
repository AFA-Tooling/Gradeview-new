// src/views/admin.jsx
import { Fragment, memo, useCallback, useRef, useState, useEffect, useMemo, useTransition } from 'react';
import {
  Alert,
  Button,
  Box,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Tabs,
  Tab,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  Paper,
  IconButton,
  ToggleButtonGroup,
  ToggleButton,
  Chip,
  Stack,
} from '@mui/material';
import { ArrowUpward, ArrowDownward } from '@mui/icons-material';
import Grid from '@mui/material/Grid';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import AIAnalytics from './aiAnalytics';
import GradeSyncControl from './GradeSyncControl';
import apiv2 from '../utils/apiv2';
import { cachedApiGet } from '../utils/apiCache';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

const STUDENT_SCORE_ROW_HEIGHT = 58;
const STUDENT_SCORE_OVERSCAN_ROWS = 8;
const sectionOrderCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function getTrailingSectionRank(section = '') {
  const normalized = String(section || '').trim().toLowerCase();
  if (normalized.includes('project')) return 0;
  if (normalized.includes('lab')) return 1;
  if (normalized.includes('attendance') || normalized.includes('attendence')) return 2;
  return null;
}

function compareSectionEntries([sectionA], [sectionB]) {
  const rankA = getTrailingSectionRank(sectionA);
  const rankB = getTrailingSectionRank(sectionB);

  if (rankA === null && rankB === null) {
    return sectionOrderCollator.compare(sectionA, sectionB);
  }
  if (rankA === null) return -1;
  if (rankB === null) return 1;
  if (rankA !== rankB) return rankA - rankB;
  return sectionOrderCollator.compare(sectionA, sectionB);
}

function normalizeSectionName(sectionName = '') {
  return String(sectionName || '').trim().toLowerCase();
}

function isRawOnlySection(sectionName = '') {
  const normalized = normalizeSectionName(sectionName);
  return normalized.startsWith('_') || normalized.endsWith('_raw') || normalized.includes('_raw');
}

function findPolicySummaryTotal(summarySectionTotals = {}, sectionName = '') {
  const target = normalizeSectionName(sectionName);
  if (!target) return null;
  for (const [key, value] of Object.entries(summarySectionTotals || {})) {
    if (normalizeSectionName(key) === target) {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : 0;
    }
  }
  return null;
}

function getPolicySummaryTotal(summarySectionTotals = {}) {
  return Object.entries(summarySectionTotals || {}).reduce((sum, [section, value]) => {
    if (isRawOnlySection(section) || normalizeSectionName(section) === 'uncategorized') {
      return sum;
    }
    const numeric = Number(value);
    return sum + (Number.isFinite(numeric) ? numeric : 0);
  }, 0);
}

function hasPolicySummaryTotals(summarySectionTotals = {}) {
  return Object.keys(summarySectionTotals || {}).some((section) => (
    !isRawOnlySection(section) && normalizeSectionName(section) !== 'uncategorized'
  ));
}

const AdminStudentScoreRow = memo(function AdminStudentScoreRow({
  student,
  visibleTableSections,
  totalMaxPoints,
  isLight,
  hdrBorderH,
  hdrBorderV,
  onOpenProfile,
}) {
  const finalPercentage = totalMaxPoints > 0
    ? ((student.total / totalMaxPoints) * 100).toFixed(2)
    : '0.00';

  return (
    <TableRow sx={{ height: STUDENT_SCORE_ROW_HEIGHT }}>
      <TableCell sx={{
        position: 'sticky',
        left: 0,
        zIndex: 10,
        backgroundColor: isLight ? '#FAFAFB' : 'rgba(18, 28, 55, 0.94)',
        borderRight: `2px solid ${hdrBorderH}`,
        minWidth: '200px',
        maxWidth: '250px',
      }}>
        <Box
          sx={{
            cursor: 'pointer',
            '&:hover': {
              color: '#1976d2',
              textDecoration: 'underline',
            },
          }}
          onClick={() => onOpenProfile(student)}
        >
          <strong>{student.name}</strong><br/>
          <small>{student.email}</small>
        </Box>
      </TableCell>

      <TableCell align="center" sx={{ borderRight: `1px solid ${hdrBorderV}` }}>
        {student.total.toFixed(2)}
      </TableCell>
      <TableCell align="center" sx={{ borderRight: `2px solid ${hdrBorderH}` }}>
        {finalPercentage}%
      </TableCell>

      {visibleTableSections.map(({ section, assignments: visibleInSection, showPolicyTotal }) => (
        <RowSectionCells
          key={section}
          section={section}
          assignments={visibleInSection}
          showPolicyTotal={showPolicyTotal}
          student={student}
          hdrBorderH={hdrBorderH}
          hdrBorderV={hdrBorderV}
        />
      ))}
    </TableRow>
  );
});

const RowSectionCells = memo(function RowSectionCells({
  section,
  assignments,
  showPolicyTotal,
  student,
  hdrBorderH,
  hdrBorderV,
}) {
  return (
    <>
      {showPolicyTotal && (
        <TableCell align="center" sx={{ borderRight: `1px solid ${hdrBorderV}`, borderLeft: `2px solid ${hdrBorderH}`, fontWeight: 'bold' }}>
          {student.sectionTotals[section]?.toFixed(2) || '0.00'}
        </TableCell>
      )}
      {assignments.map((assignment) => {
        const rawScore = student.scores[assignment.name];
        return (
          <TableCell key={assignment.name} align="center" sx={{ minWidth: '120px' }}>
            {(rawScore != null && rawScore !== '') ? Number(rawScore).toFixed(2) : 'N/A'}
          </TableCell>
        );
      })}
    </>
  );
});

export default function Admin() {
  const navigate = useNavigate();
  const isLight = true;

  // Adaptive palette — use once, ref everywhere
  const hdrBg1        = '#EDEEF1';
  const hdrBg1s       = '#E5E7EA';
  const hdrBg2        = '#F4F5F7';
  const hdrBg2s       = '#EDEEF1';
  const hdrColor      = '#111111';
  const hdrBorderH    = 'rgba(0, 0, 0, 0.18)';
  const hdrBorderV    = 'rgba(0, 0, 0, 0.18)';
  const chartTick     = 'rgba(0, 0, 0, 0.75)';
  const chartTitle    = 'rgba(0, 0, 0, 0.85)';
  const chartGrid     = 'rgba(0, 0, 0, 0.08)';
  // TAB STATE
  const [tab, setTab] = useState(0);
  const [courses, setCourses] = useState([]);
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState(localStorage.getItem('selectedCourseId') || '');
  const studentsTableRef = useRef(null);
  const [studentsScrollTop, setStudentsScrollTop] = useState(0);
  const [studentsViewportHeight, setStudentsViewportHeight] = useState(640);
  
  // Performance optimization for Select All
  const [isPending, startTransition] = useTransition();

  // --- ASSIGNMENTS UI & STATS ---
  const [searchQuery, setSearchQuery] = useState('');
  const [assignments, setAssignments] = useState([]); // {section,name}[]
  const [filtered, setFiltered]       = useState([]);
  const [loadingA, setLoadingA]       = useState(true);
  const [errorA, setErrorA]           = useState();

  // selected assignment + stats
  const [selected, setSelected]         = useState(null);
  const [stats, setStats]               = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError]     = useState();
  const [distribution, setDistribution] = useState(null);

  // --- STUDENT-SCORES + SORT STATE ---
  const [studentScores, setStudentScores] = useState([]); // [{name,email,scores}]
  const [loadingSS, setLoadingSS]         = useState(false);
  const [errorSS, setErrorSS]             = useState();

  // --- SECTION CAPS (from /bins assignment_points) ---
  const [sectionCaps, setSectionCaps] = useState({}); // { "Labs": 80, "Quest": 25, ... }
  const [overallCap, setOverallCap] = useState(0); // Authoritative total (e.g., 400) from /bins

  // score details
  const [scoreDetailOpen, setScoreDetailOpen]     = useState(false);
  const [scoreSelected, setScoreSelected]         = useState([]); // Array of selected score ranges
  const [studentsByScore, setStudentsByScore]     = useState([]); // Array of {range, students} objects
  const [studentsByScoreLoading, setStudentsByScoreLoading] = useState(false);
  const [studentsByScoreError, setStudentsByScoreError] = useState(null);

  const [sortBy, setSortBy]   = useState(null); // 'Quest','Midterm','Labs','total' or assignment.name
  const [sortAsc, setSortAsc] = useState(true);
  
  // --- STUDENT PAGE CUSTOMIZATION ---
  const [visibleAssignments, setVisibleAssignments] = useState({}); // {assignmentName: boolean}
  const [selectorDialogOpen, setSelectorDialogOpen] = useState(null); // Section name or null
  const [scoreDisplayMode, setScoreDisplayMode] = useState('both'); // policy | raw | both

  const buildCourseQuery = (courseId) => {
    if (!courseId) return '';
    const matchedCourse = courses.find((course) => String(course.id) === String(courseId));
    const resolvedCourseId = matchedCourse?.gradescope_course_id || courseId;
    return `?course_id=${encodeURIComponent(resolvedCourseId)}`;
  };

  const normalizeCourseList = (list) => {
    const items = Array.isArray(list) ? list : [];
    const merged = new Map();
    items.forEach((course) => {
      const key = String(course?.gradescope_course_id || course?.id || '').trim();
      if (!key) return;
      if (!merged.has(key)) {
        merged.set(key, { ...course, id: String(course.id) });
      }
    });
    return Array.from(merged.values());
  };

  // Load courses for multi-course support
  useEffect(() => {
    setLoadingCourses(true);
    Promise.allSettled([
      cachedApiGet('/admin/sync', { ttlMs: 60000 }),
      cachedApiGet('/students/courses', { ttlMs: 60000 }),
    ])
      .then(([adminResult, studentResult]) => {
        const adminCourses = adminResult.status === 'fulfilled' ? (adminResult.value?.data?.courses || []) : [];
        const studentCourses = studentResult.status === 'fulfilled' ? (studentResult.value?.data?.courses || []) : [];
        const fetchedCourses = normalizeCourseList([...adminCourses, ...studentCourses]);
        setCourses(fetchedCourses);

        if (fetchedCourses.length === 0) {
          return;
        }

        const rememberedCourse = localStorage.getItem('selectedCourseId') || selectedCourse;
        const hasSelected = fetchedCourses.some((course) => String(course.id) === String(rememberedCourse));
        const nextCourse = hasSelected ? String(rememberedCourse) : String(fetchedCourses[0].id);

        setSelectedCourse(nextCourse);
        localStorage.setItem('selectedCourseId', nextCourse);
      })
      .catch((err) => {
        console.error('Failed to fetch courses for admin page:', err);
      })
      .finally(() => setLoadingCourses(false));
  }, []);

  useEffect(() => {
    const handleSelectedCourseChanged = (event) => {
      const nextCourse = event?.detail?.courseId || localStorage.getItem('selectedCourseId') || '';
      setSelectedCourse(nextCourse);
    };

    window.addEventListener('selectedCourseChanged', handleSelectedCourseChanged);
    return () => {
      window.removeEventListener('selectedCourseChanged', handleSelectedCourseChanged);
    };
  }, []);
  const handleSort = col => {
    if (sortBy === col) setSortAsc(!sortAsc);
    else {
      setSortBy(col);
      setSortAsc(true);
    }
  };

  /** 1) Load assignment categories with max points from DATABASE **/
  useEffect(() => {
    if (!selectedCourse) return;

    setLoadingA(true);
    setErrorA(null);

    // Get assignments directly from database
    cachedApiGet(`/admin/assignments${buildCourseQuery(selectedCourse)}`, { ttlMs: 60000 })
      .then(res => {
        const categoriesData = res.data; // { "Projects": { "Project 1": 100, ... }, "Labs": { ... }, ... }
        const items = Object.entries(categoriesData)
          .filter(([section]) => section !== 'Uncategorized' && section !== 'uncategorized') // Filter out Uncategorized
          .flatMap(([section, assignmentsObj]) =>
            Object.entries(assignmentsObj).map(([name, maxPoints]) => ({ 
              section, 
              name,
              maxPoints: Number(maxPoints) || 0
            }))
          );
        setAssignments(items);
        setFiltered(items);
        console.log(`[INFO] Loaded ${items.length} assignments from database (excluding Uncategorized)`);
        
        // Initialize with NO columns visible for better initial performance
        // User can click "Select All" or select specific sections
        setVisibleAssignments({});
      })
      .catch(err => setErrorA(err.message || 'Failed to load assignments'))
      .finally(() => setLoadingA(false));
  }, [selectedCourse, courses]);

  /** 2) Filter assignments **/
  useEffect(() => {
    setFiltered(
      assignments.filter(a =>
        a.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    );
  }, [searchQuery, assignments]);

  /** 3) Fetch stats + distribution when an assignment is clicked **/
  useEffect(() => {
    if (!selected) {
      setStats(null);
      setDistribution(null);
      return;
    }
    setStatsLoading(true);
    setStatsError(null);

    const { section, name } = selected;
    const query = buildCourseQuery(selectedCourse);
    Promise.all([
      apiv2.get(`/admin/stats/${encodeURIComponent(section)}/${encodeURIComponent(name)}${query}`),
      apiv2.get(`/admin/distribution/${encodeURIComponent(section)}/${encodeURIComponent(name)}${query}`)
    ])
      .then(([statsRes, distRes]) => {
        setStats(statsRes.data);
        setDistribution(distRes.data);
      })
      .catch(err => setStatsError(err.message || 'Failed to load stats'))
      .finally(() => setStatsLoading(false));
  }, [selected, selectedCourse, courses]);

  /** 4) Load student-scores when Students tab is activated **/
  useEffect(() => {
    if (tab !== 1) return;
    if (!selectedCourse) return;
    setLoadingSS(true);
    setErrorSS(null);

    cachedApiGet(`/admin/studentScores${buildCourseQuery(selectedCourse)}`, { ttlMs: 30000 })
      .then(res => setStudentScores(res.data.students))
      .catch(err => setErrorSS(err.message || 'Failed to load student scores'))
      .finally(() => setLoadingSS(false));
  }, [tab, selectedCourse, courses]);

  /** 4b) Load section caps from grading config (used to enforce per-section caps like Labs=80) **/
  useEffect(() => {
    if (!selectedCourse) return;
    cachedApiGet(`/bins${buildCourseQuery(selectedCourse)}`, { ttlMs: 60000 })
      .then(res => {
        const points = res?.data?.assignment_points || {};
        setSectionCaps(points);
        const cap = Number(res?.data?.overall_cap_points)
          || Number(res?.data?.total_points_cap)
          || Number(res?.data?.total_course_points)
          || 0;
        setOverallCap(cap);
      })
      .catch(() => {
        setSectionCaps({});
        setOverallCap(0);
      });
  }, [selectedCourse, courses]);

  useEffect(() => {
    setSelected(null);
    setStats(null);
    setDistribution(null);
    setScoreSelected([]);
    setStudentsByScore([]);
  }, [selectedCourse]);

  // Group assignments by section with max points
  const assignmentsBySection = useMemo(() => {
    const grouped = {};
    assignments.forEach(a => {
      if (!grouped[a.section]) {
        grouped[a.section] = [];
      }
      grouped[a.section].push(a);
    });
    return grouped;
  }, [assignments]);

  const orderedAssignmentSections = useMemo(
    () => Object.entries(assignmentsBySection).sort(compareSectionEntries),
    [assignmentsBySection]
  );

  const normalizedSectionCaps = useMemo(() => (
    Object.entries(sectionCaps || {}).reduce((acc, [key, value]) => {
      const normalized = String(key || '').trim().toLowerCase();
      if (normalized) acc[normalized] = Number(value) || 0;
      return acc;
    }, {})
  ), [sectionCaps]);

  const assignmentNamesBySection = useMemo(() => (
    Object.entries(assignmentsBySection).reduce((acc, [section, sectionAssignments]) => {
      acc[section] = sectionAssignments.map((assignment) => assignment.name);
      return acc;
    }, {})
  ), [assignmentsBySection]);

  // Calculate display max points per section (configured cap > raw assignment sum)
  const sectionMaxPoints = useMemo(() => {
    const maxPoints = {};
    Object.entries(assignmentsBySection).forEach(([section, sectionAssignments]) => {
      const rawSum = sectionAssignments.reduce((sum, a) => sum + (a.maxPoints || 0), 0);
      const cap = normalizedSectionCaps[normalizeSectionName(section)] || 0;
      maxPoints[section] = cap > 0 ? cap : rawSum;
    });
    return maxPoints;
  }, [assignmentsBySection, normalizedSectionCaps]);

  const totalMaxPoints = useMemo(() => {
    // Prefer authoritative total from /bins (e.g., syllabus says 400);
    // fall back to summing per-section maxes when no config is loaded yet.
    if (overallCap > 0) return overallCap;
    return Object.values(sectionMaxPoints).reduce((sum, v) => sum + v, 0);
  }, [sectionMaxPoints, overallCap]);

  /** 5) Compute section totals + overall total per student (capped per syllabus) **/
  const studentWithTotals = useMemo(() => {
    return studentScores.map(stu => {
      // First, flatten the scores from { section: { assignment: score } } to { assignment: score }
      const flatScores = {};
      Object.values(stu.scores || {}).forEach(sectionScores => {
        Object.assign(flatScores, sectionScores);
      });

      const sectionTotals = {};
      Object.entries(assignmentNamesBySection).forEach(([sec, assignmentNames]) => {
        const rawSum = assignmentNames.reduce((sum, assignmentName) => (
          sum + Number(flatScores[assignmentName] || 0)
        ), 0);
        const cap = normalizedSectionCaps[normalizeSectionName(sec)] || 0;
        const rawTotal = cap > 0 ? Math.min(rawSum, cap) : rawSum;
        const policyTotal = isRawOnlySection(sec)
          ? null
          : findPolicySummaryTotal(stu.summarySectionTotals, sec);
        sectionTotals[sec] = policyTotal != null ? policyTotal : rawTotal;
      });

      const policyTotal = getPolicySummaryTotal(stu.summarySectionTotals);
      const fallbackTotal = Object.entries(sectionTotals).reduce(
        (sum, [section, value]) => sum + (isRawOnlySection(section) ? 0 : (Number(value) || 0)),
        0
      );
      const total = hasPolicySummaryTotals(stu.summarySectionTotals) ? policyTotal : fallbackTotal;
      return { ...stu, scores: flatScores, sectionTotals, total };
    });
  }, [studentScores, assignmentNamesBySection, normalizedSectionCaps]);

  /** 6) Sort students **/
  const sortedStudents = useMemo(() => {
    const arr = [...studentWithTotals];
    if (!sortBy) return arr;
    arr.sort((a, b) => {
      let aVal, bVal;
      if (sortBy === 'total') {
        aVal = a.total; bVal = b.total;
      } else if (a.sectionTotals?.hasOwnProperty(sortBy)) {
        aVal = a.sectionTotals[sortBy];
        bVal = b.sectionTotals[sortBy];
      } else {
        aVal = a.scores[sortBy] ?? 0;
        bVal = b.scores[sortBy] ?? 0;
      }
      return sortAsc ? aVal - bVal : bVal - aVal;
    });
    return arr;
  }, [studentWithTotals, sortBy, sortAsc]);

  const visibleTableSections = useMemo(() => (
    orderedAssignmentSections
      .map(([section, sectionAssignments]) => {
        const assignmentsForSection = scoreDisplayMode === 'policy'
          ? []
          : sectionAssignments.filter((assignment) => visibleAssignments[assignment.name]);
        const showPolicyTotal = scoreDisplayMode !== 'raw';
        return {
          section,
          assignments: assignmentsForSection,
          showPolicyTotal,
          colSpan: (showPolicyTotal ? 1 : 0) + assignmentsForSection.length,
        };
      })
      .filter((item) => item.colSpan > 0)
  ), [orderedAssignmentSections, scoreDisplayMode, visibleAssignments]);

  const totalStudentScoreColumns = useMemo(() => (
    3 + visibleTableSections.reduce((sum, section) => sum + section.colSpan, 0)
  ), [visibleTableSections]);

  const virtualStudentWindow = useMemo(() => {
    const totalRows = sortedStudents.length;
    if (totalRows === 0) {
      return {
        rows: [],
        topPadding: 0,
        bottomPadding: 0,
      };
    }

    const viewportHeight = Math.max(STUDENT_SCORE_ROW_HEIGHT, studentsViewportHeight || 640);
    const startIndex = Math.max(
      0,
      Math.floor(studentsScrollTop / STUDENT_SCORE_ROW_HEIGHT) - STUDENT_SCORE_OVERSCAN_ROWS,
    );
    const visibleCount = Math.ceil(viewportHeight / STUDENT_SCORE_ROW_HEIGHT) + (STUDENT_SCORE_OVERSCAN_ROWS * 2);
    const endIndex = Math.min(totalRows, startIndex + visibleCount);

    return {
      rows: sortedStudents.slice(startIndex, endIndex),
      topPadding: startIndex * STUDENT_SCORE_ROW_HEIGHT,
      bottomPadding: (totalRows - endIndex) * STUDENT_SCORE_ROW_HEIGHT,
    };
  }, [sortedStudents, studentsScrollTop, studentsViewportHeight]);

  const handleStudentsTableScroll = useCallback((event) => {
    setStudentsScrollTop(event.currentTarget.scrollTop);
  }, []);

  useEffect(() => {
    const tableEl = studentsTableRef.current;
    if (!tableEl || tab !== 1) return undefined;

    const updateViewportHeight = () => {
      setStudentsViewportHeight(tableEl.clientHeight || 640);
    };

    updateViewportHeight();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateViewportHeight);
      return () => window.removeEventListener('resize', updateViewportHeight);
    }

    const observer = new ResizeObserver(updateViewportHeight);
    observer.observe(tableEl);
    return () => observer.disconnect();
  }, [tab]);

  useEffect(() => {
    setStudentsScrollTop(0);
    if (studentsTableRef.current) {
      studentsTableRef.current.scrollTop = 0;
    }
  }, [sortBy, sortAsc, scoreDisplayMode, visibleAssignments, selectedCourse, sortedStudents.length]);

  const handleOpenStudentProfile = useCallback((student) => {
    navigate(`/students/${encodeURIComponent(student.email)}/report`);
  }, [navigate]);

  // Handlers
  const handleTabChange = (_, newTab) => {
    setTab(newTab);
    if (newTab !== 0) {
      setSelected(null);
      setStats(null);
      setDistribution(null);
      setStatsError(null);
    }
  };

  const handleAssignClick = item => {
    setSelected(item);
    setScoreSelected([]);  // Clear previous selection
  };

  /** Export currently visible student-scores table to CSV **/
  const handleExportCSV = () => {
    if (!sortedStudents.length) {
      alert('No student data to export.');
      return;
    }

    const escape = (val) => {
      if (val === null || val === undefined) return '';
      const s = String(val);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const header = ['Student Name', 'Email', 'Total (final policy)', 'Final %'];
    visibleTableSections.forEach(({ section, assignments: list, showPolicyTotal }) => {
      if (showPolicyTotal) header.push(`${section} Total (policy)`);
      list.forEach(a => header.push(`${a.name} (raw)`));
    });

    const rows = sortedStudents.map(stu => {
      const finalPct = totalMaxPoints > 0 ? ((stu.total / totalMaxPoints) * 100).toFixed(2) : '0.00';
      const row = [stu.name, stu.email, stu.total.toFixed(2), finalPct];
      visibleTableSections.forEach(({ section, assignments: list, showPolicyTotal }) => {
        if (showPolicyTotal) {
          row.push(stu.sectionTotals[section] != null ? stu.sectionTotals[section].toFixed(2) : '0.00');
        }
        list.forEach(a => {
          const raw = stu.scores[a.name];
          row.push(raw != null && raw !== '' ? Number(raw).toFixed(2) : '');
        });
      });
      return row;
    });

    const csv = [header, ...rows].map(r => r.map(escape).join(',')).join('\r\n');
    // BOM so Excel detects UTF-8 correctly
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const courseLabel = selectedCourse && selectedCourse !== 'all'
      ? `_${String(selectedCourse).replace(/[^\w\-]+/g, '_')}`
      : '';
    const ts = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `student_scores${courseLabel}_${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  const handleCloseDialog  = () => {
    setSelected(null);
    setStats(null);
    setDistribution(null);
    setStatsError(null);
    setScoreSelected([]);  // Clear selection when closing
  };

  const handleScoreClick = (data, index) => {
    // 'data' here is the bar data clicked: {range: "50-74", count: N, students: [...], ...}
    if (!selected || !data.students) return;

    const clickedRange = data.range;
    
    // Check if this score range is already selected
    const isAlreadySelected = scoreSelected.includes(clickedRange);
    
    let newSelectedScores;
    let newStudentsByScore;
    
    if (isAlreadySelected) {
      // Remove this score range
      newSelectedScores = scoreSelected.filter(r => r !== clickedRange);
      newStudentsByScore = studentsByScore.filter(group => group.range !== clickedRange);
    } else {
      // Add this score range
      newSelectedScores = [...scoreSelected, clickedRange];
      newStudentsByScore = [...studentsByScore, { range: clickedRange, students: data.students }];
    }
    
    setScoreSelected(newSelectedScores);
    setStudentsByScore(newStudentsByScore);
  };

  /** Close the student list dialog **/
  const handleCloseScoreDialog = () => {
    setScoreDetailOpen(false);
    setScoreSelected([]);
    setStudentsByScore([]); // Clear previous data
    setStudentsByScoreError(null);
  };

  // Generate email with empty fields
  const handleGenerateEmail = () => {
      if (!studentsByScore || !studentsByScore.length || !selected || scoreSelected.length === 0) {
          alert('Student list, assignment name, or score data is missing.');
          return;
      }

      const assignmentName = selected.name;
      
      // Build content for each score range
      const scoreGroupsText = studentsByScore
          .map(group => {
              const studentListText = group.students
                  .map(stu => `  - ${stu.name} (${stu.email})`)
                  .join('\n');
              return `Score: ${group.range}\n${studentListText}`;
          })
          .join('\n\n');

      const emailBodyContent = `---\n` +
                              `Assignment: ${assignmentName}\n` +
                              `---\n\n` +
                              `Students by score:\n\n${scoreGroupsText}`;

      const subject = `Score List for ${assignmentName}`;

      const mailto = `mailto:` + 
                    `?subject=${encodeURIComponent(subject)}` + 
                    `&body=${encodeURIComponent(emailBodyContent)}`;
      
      const link = document.createElement('a');
      link.href = mailto;
      link.target = '_blank'; 
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  // Generate text and copy to clipboard
  const handleGenerateTxt = async () => {
      if (!studentsByScore || !studentsByScore.length || !selected || scoreSelected.length === 0) {
          alert('Student list, assignment name, or score data is missing.');
          return;
      }

      const assignmentName = selected.name;
      
      // Build content for each score range
      const scoreGroupsText = studentsByScore
          .map(group => {
              const studentListText = group.students
                  .map(stu => `  - ${stu.name} (${stu.email})`)
                  .join('\n');
              return `Score: ${group.range}\n${studentListText}`;
          })
          .join('\n\n');

      const textContent = `---\n` +
                         `Assignment: ${assignmentName}\n` +
                         `---\n\n` +
                         `Students by score:\n\n${scoreGroupsText}`;

      try {
          await navigator.clipboard.writeText(textContent);
          alert('Text copied to clipboard!');
      } catch (err) {
          console.error('Failed to copy text:', err);
          alert('Failed to copy to clipboard');
      }
  };

  return (
    <Box className='admin-shell' sx={{ minHeight: '100vh' }}>
      {/* Tabs */}
      <Box className='glass-section' sx={{ px: 4, py: 1, mb: 2, borderRadius: 2 }}>
        <Tabs 
          value={tab} 
          onChange={handleTabChange}
          sx={{
            '& .MuiTab-root': {
              textTransform: 'none',
              fontSize: '0.95rem',
              fontWeight: 500,
              minHeight: 48,
            }
          }}
        >
          <Tab label="Assignments" />
          <Tab label="Students" />
          <Tab label="AI Analytics" />
        </Tabs>
      </Box>

      {/* ASSIGNMENTS TAB */}
    {tab === 0 && (
    <Box px={4} py={4}>
        {/* Search Field */}
        <Box mb={3}>
          <Paper elevation={0} className='glass-section' sx={{ p: 2 }}>
            <TextField
              placeholder="Search assignments…"
              size="small"
              fullWidth
              sx={{ maxWidth: 400 }}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </Paper>
        </Box>

        {/* Loading / Error */}
        {loadingA && <Typography>Loading assignments…</Typography>}
        {errorA   && <Alert severity="error">{errorA}</Alert>}

        {/* Assignment Buttons */}
        {!loadingA && !errorA && (
        <>
            {orderedAssignmentSections.map(([section, sectionAssignments]) => (
              <Box key={section} mb={4}>
                <Paper elevation={0} className='glass-section' sx={{ p: 3, borderRadius: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                    <Typography variant="h6" sx={{ fontWeight: 600, flex: 1 }}>
                      {section}
                    </Typography>
                    <Button
                      variant="contained"
                      size="small"
                      sx={{ 
                        bgcolor: '#111111',
                        '&:hover': { bgcolor: '#000000' },
                        textTransform: 'none',
                        fontWeight: 500
                      }}
                      onClick={() => handleAssignClick({ section, name: `${section} Summary` })}
                    >
                      View Summary
                    </Button>
                  </Box>
                  <Grid container spacing={2}>
                    {sectionAssignments
                      .filter(item =>
                        item.name.toLowerCase().includes(searchQuery.toLowerCase())
                      )
                      .map((item, i) => (
                        <Grid key={i} item>
                          <Button
                            variant="outlined"
                            sx={{ 
                              minWidth: 140, 
                              height: 56, 
                              fontSize: '0.95rem',
                              borderColor: isLight ? 'rgba(0, 0, 0, 0.28)' : 'rgba(191, 211, 255, 0.4)',
                              color: isLight ? '#111111' : 'rgba(232, 241, 255, 0.9)',
                              textTransform: 'none',
                              fontWeight: 500,
                              '&:hover': {
                                borderColor: isLight ? '#111111' : '#444444',
                                color: isLight ? '#000000' : '#f7fbff',
                                bgcolor: isLight ? 'rgba(0, 0, 0, 0.05)' : 'rgba(104, 144, 255, 0.18)'
                              }
                            }}
                            onClick={() => handleAssignClick(item)}
                          >
                          {item.name}
                        </Button>
                      </Grid>
                    ))}
                </Grid>
                </Paper>
              </Box>
            ))}
        </>
        )}

        {/* Stats & Histogram Dialog */}
        <Dialog
        open={Boolean(selected)}
        onClose={handleCloseDialog}
        fullWidth
        maxWidth="md"
        >
        <DialogTitle>{selected?.name} Statistics</DialogTitle>
        <DialogContent>
            {statsLoading && <Typography>Loading stats…</Typography>}
            {statsError   && <Alert severity="error">{statsError}</Alert>}

            {stats && (
            <>
                <Typography>
                <strong>Section:</strong> {selected.section}
                </Typography>
                <Typography>
                <strong>Max:</strong> {stats.max ?? 'N/A'}
                </Typography>
                <Typography>
                <strong>Min:</strong> {stats.min ?? 'N/A'}
                </Typography>
                {distribution && (() => {
                  const numBins = distribution.distribution?.length || 0;
                  const maxScore = distribution.maxScore || 10;
                  const useLineChart = numBins > 40; // Switch to line chart for >40 bins
                  
                  // Prepare data for Chart.js
                  const chartData = {
                    labels: (distribution.distribution || []).map(d => d.range),
                    datasets: [{
                      label: 'Count',
                      data: (distribution.distribution || []).map(d => d.count),
                      backgroundColor: (distribution.distribution || []).map(d =>
                        scoreSelected.includes(d.range) ? '#2A9D90' : 'rgba(0, 0, 0, 0.12)'
                      ),
                      borderColor: useLineChart ? '#2A9D90' : undefined,
                      borderWidth: useLineChart ? 3 : 0,
                      pointRadius: useLineChart ? (distribution.distribution || []).map(d =>
                        scoreSelected.includes(d.range) ? 6 : 0  // Show small dot only when selected
                      ) : 0,
                      pointHoverRadius: useLineChart ? 8 : 0,  // Show hover dot
                      pointBackgroundColor: useLineChart ? (distribution.distribution || []).map(d =>
                        scoreSelected.includes(d.range) ? '#2A9D90' : 'rgba(0, 0, 0, 0.12)'
                      ) : undefined,
                      pointBorderColor: useLineChart ? '#FFFFFF' : undefined,
                      pointBorderWidth: useLineChart ? 2 : 0,
                      tension: 0.1, // Slight curve for line chart
                    }]
                  };

                  // Chart.js options
                  const chartOptions = {
                    responsive: true,
                    maintainAspectRatio: false,
                    onClick: (event, elements) => {
                      if (elements.length > 0) {
                        const index = elements[0].index;
                        const clickedData = distribution.distribution[index];
                        handleScoreClick(clickedData, index);
                      }
                    },
                    plugins: {
                      legend: {
                        display: false
                      },
                      tooltip: {
                        callbacks: {
                          label: function(context) {
                            return `Count: ${context.parsed.y}`;
                          }
                        }
                      },
                      datalabels: {
                        display: false  // Hide labels, only show on hover via tooltip
                      }
                    },
                    scales: {
                      x: {
                        title: {
                          display: true,
                          text: 'Score',
                          color: chartTitle
                        },
                        min: 0,
                        max: maxScore,
                        ticks: {
                          stepSize: 1,
                          autoSkip: numBins > 20,
                          maxRotation: 45,
                          minRotation: 45,
                          color: chartTick,
                          font: {
                            size: numBins > 50 ? 10 : 12
                          }
                        },
                        grid: {
                          color: chartGrid
                        }
                      },
                      y: {
                        title: {
                          display: true,
                          text: 'Count',
                          color: chartTitle
                        },
                        beginAtZero: true,
                        ticks: {
                          stepSize: 1,
                          precision: 0,
                          color: chartTick
                        },
                        grid: {
                          color: chartGrid
                        }
                      }
                    },
                    interaction: {
                      mode: useLineChart ? 'index' : 'nearest',  // 'index' for line chart makes it easier to hover
                      intersect: false,
                      axis: 'x'  // Trigger tooltip when hovering near x-axis position
                    }
                  };
                  
                  return (
                <Box mt={4}>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                      <Typography variant="body2" sx={{ color: isLight ? 'rgba(0, 0, 0, 0.7)' : 'rgba(224, 236, 255, 0.92)' }}>
                        💡 Click on {useLineChart ? 'points' : 'bars'} to select/deselect score ranges. Selected ranges will turn green.
                      </Typography>
                      {scoreSelected.length > 0 && (
                        <Button 
                          variant="contained" 
                          sx={{ bgcolor: '#111111', '&:hover': { bgcolor: '#000000' }, color: '#fff' }}
                          size="small"
                          onClick={() => setScoreDetailOpen(true)}
                        >
                          View Selected ({scoreSelected.length})
                        </Button>
                      )}
                    </Box>
                    {useLineChart && (
                      <Typography variant="caption" sx={{ display: 'block', mb: 1, color: isLight ? '#444444' : '#666666', fontStyle: 'italic' }}>
                        📈 Switched to line chart for better readability with {numBins} data points
                      </Typography>
                    )}
                    <Box sx={{ height: 350, cursor: 'pointer' }}>
                      {useLineChart ? (
                        <Line data={chartData} options={chartOptions} />
                      ) : (
                        <Bar data={chartData} options={chartOptions} />
                      )}
                    </Box>
                </Box>
                  );
                })()}
            </>
            )}

            {!statsLoading && !stats && !statsError && (
            <Typography>No data available.</Typography>
            )}
        </DialogContent>
        <DialogActions>
            <Button onClick={handleCloseDialog}>Close</Button>
        </DialogActions>
        </Dialog>
        {/* Score Detail Dialog (Students for a specific score)*/}
        <Dialog
        open={scoreDetailOpen}
        onClose={handleCloseScoreDialog}
        fullWidth
        maxWidth="sm"
        >
        <DialogTitle>
            Students with Selected Scores on **{selected?.name}**
            {scoreSelected.length > 0 && (
              <Typography variant="subtitle2" color="textSecondary">
                Selected ranges: {scoreSelected.join(', ')}
              </Typography>
            )}
        </DialogTitle>


        <DialogContent>
            {studentsByScore.length === 0 ? (
                <Typography>No students found with the selected scores.</Typography>
            ) : (
                studentsByScore
                  .sort((a, b) => {
                    // Extract the lower bound of the range for sorting
                    const getMinScore = (range) => {
                      const match = range.match(/^(\d+)/);
                      return match ? parseInt(match[1]) : 0;
                    };
                    return getMinScore(a.range) - getMinScore(b.range);
                  })
                  .map((group, groupIndex) => (
                  <Box key={groupIndex} mb={3}>
                    <Typography variant="h6" gutterBottom color="primary" sx={{ mt: groupIndex > 0 ? 2 : 0 }}>
                      Score Range: {group.range}
                    </Typography>
                    <TableContainer component={Paper} sx={{ mb: 2 }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell><strong>Name</strong></TableCell>
                            <TableCell><strong>Email</strong></TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {group.students.map((stu, i) => (
                            <TableRow key={i}>
                              <TableCell>{stu.name}</TableCell>
                              <TableCell>{stu.email}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Box>
                ))
            )}

            <Box mt={4} sx={{ borderTop: 1, borderColor: 'divider', pt: 3 }}>
                <Typography variant="h6" gutterBottom>
                    📧 Email Student List
                </Typography>
              
                <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                    Generate an email draft or copy the text content to clipboard
                </Typography>
                
                <Box mt={2} display="flex" justifyContent="flex-end" gap={2}>
                    <Button
                        variant="contained"
                        color="primary"
                        onClick={handleGenerateEmail}
                        disabled={!studentsByScore.length}
                    >
                        Generate Email
                    </Button>
                    <Button
                        variant="outlined"
                        color="primary"
                        onClick={handleGenerateTxt}
                        disabled={!studentsByScore.length}
                    >
                        Copy to Clipboard
                    </Button>
                </Box>
        </Box>
        

        </DialogContent>
        <DialogActions>
            <Button onClick={handleCloseScoreDialog}>Close</Button>
        </DialogActions>
        </Dialog>

{/* ... end of tab === 0 && (Box) */}
    </Box>
    )}


      {/* STUDENTS × ASSIGNMENTS TAB */}
        {tab === 1 && (
        <Box px={4} py={4}>
            {loadingSS && (
              <Box display="flex" justifyContent="center" p={4}>
                <Typography>Loading student scores…</Typography>
              </Box>
            )}
            {errorSS && <Alert severity="error" sx={{ mb: 3 }}>{errorSS}</Alert>}

            {!loadingSS && !errorSS && (
            <Paper elevation={0} className='glass-section' sx={{ borderRadius: 2, overflow: 'hidden' }}>
                <Box sx={{ p: 3, borderBottom: '1px solid rgba(255,255,255,0.14)' }}>
                  <Typography variant="h6" sx={{ fontWeight: 600 }}>
                    Student Scores Overview
                  </Typography>
                  <Typography variant="body2" color="textSecondary" sx={{ mt: 0.5 }}>
                    Click on column headers to sort, click on student names to view details. 
                    Use the buttons below to select which assignment columns to display.
                  </Typography>
                  <Typography variant="caption" sx={{ display: 'block', mt: 1, color: '#1976d2', fontWeight: 500 }}>
                    Totals are final policy scores. Assignment columns are raw per-assignment scores.
                  </Typography>
                </Box>
                
                {/* Assignment Selector - Buttons for each section */}
                <Box sx={{ p: 3, bgcolor: isLight ? 'rgba(240, 246, 255, 0.6)' : 'rgba(255,255,255,0.03)' }}>
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'flex-start', md: 'center' }} sx={{ mb: 2 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        Score View:
                    </Typography>
                    <ToggleButtonGroup
                      size="small"
                      exclusive
                      value={scoreDisplayMode}
                      onChange={(_, mode) => mode && setScoreDisplayMode(mode)}
                    >
                      <ToggleButton value="policy">Policy totals</ToggleButton>
                      <ToggleButton value="raw">Raw assignments</ToggleButton>
                      <ToggleButton value="both">Both</ToggleButton>
                    </ToggleButtonGroup>
                    <Chip size="small" label="Total = policy final" sx={{ fontWeight: 700 }} />
                    <Chip size="small" label="Assignment cells = raw" sx={{ fontWeight: 700 }} />
                  </Stack>
                  <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        Raw Columns:
                    </Typography>
                    {isPending && (
                        <Typography variant="caption" sx={{ color: '#6366f1', fontStyle: 'italic' }}>
                            Updating table (this may take a moment for large tables)...
                        </Typography>
                    )}
                    <Button
                        size="small"
                        variant="outlined"
                        sx={{ textTransform: 'none', fontWeight: 500 }}
                        disabled={isPending}
                        onClick={() => {
                            startTransition(() => {
                                const allAssignments = {};
                                Object.values(assignmentsBySection).forEach(assignments => {
                                    assignments.forEach(a => {
                                        allAssignments[a.name] = true;
                                    });
                                });
                                setVisibleAssignments(allAssignments);
                            });
                        }}
                    >
                        {isPending ? 'Selecting...' : 'Select All'}
                    </Button>
                    <Button
                        size="small"
                        variant="outlined"
                        sx={{ textTransform: 'none', fontWeight: 500 }}
                        disabled={isPending}
                        onClick={() => {
                            startTransition(() => {
                                const allAssignments = {};
                                Object.values(assignmentsBySection).forEach(assignments => {
                                    assignments.forEach(a => {
                                        allAssignments[a.name] = false;
                                    });
                                });
                                setVisibleAssignments(allAssignments);
                            });
                        }}
                    >
                        {isPending ? 'Deselecting...' : 'Deselect All'}
                    </Button>
                    <Button
                        size="small"
                        variant="contained"
                        sx={{
                            textTransform: 'none',
                            fontWeight: 500,
                            backgroundColor: '#10b981',
                            '&:hover': { backgroundColor: '#059669' },
                        }}
                        disabled={!sortedStudents.length}
                        onClick={handleExportCSV}
                    >
                        Export CSV
                    </Button>

                    {/* Section Buttons */}
                    {orderedAssignmentSections.map(([section, sectionAssignments]) => {
                        const visibleCount = sectionAssignments.filter(a => visibleAssignments[a.name]).length;
                        const total = sectionAssignments.length;
                        const allVisible = visibleCount === total && total > 0;
                        const someVisible = visibleCount > 0 && visibleCount < total;
                        
                        return (
                            <Box key={section}>
                                <Button
                                    size="small"
                                    variant={allVisible ? "contained" : "outlined"}
                                    sx={{
                                        backgroundColor: allVisible ? '#111111' : 'transparent',
                                        color: allVisible ? 'white' : (isLight ? '#111111' : 'rgba(232,241,255,0.9)'),
                                        borderColor: allVisible ? '#111111' : (isLight ? 'rgba(0, 0, 0, 0.28)' : 'rgba(191,211,255,0.35)'),
                                        textTransform: 'none',
                                        fontWeight: 500,
                                        '&:hover': {
                                          backgroundColor: allVisible ? '#000000' : (isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(104, 144, 255, 0.14)'),
                                          borderColor: '#111111'
                                        }
                                    }}
                                    onClick={() => setSelectorDialogOpen(section)}
                                >
                                    {section} ({visibleCount}/{total})
                                </Button>
                                
                                {/* Popup Dialog for this section */}
                                <Dialog
                                    open={selectorDialogOpen === section}
                                    onClose={() => setSelectorDialogOpen(null)}
                                    maxWidth="sm"
                                    fullWidth
                                    PaperProps={{
                                        sx: {
                                            borderRadius: 2,
                                            border: '1px solid #E5E7EB',
                                            boxShadow: '0 18px 45px rgba(17, 24, 39, 0.18)',
                                            backgroundImage: 'none',
                                        }
                                    }}
                                >
                                    <DialogTitle
                                        sx={{
                                            px: 3,
                                            pt: 3,
                                            pb: 1.25,
                                            color: '#111827',
                                            fontSize: 24,
                                            fontWeight: 750,
                                            letterSpacing: 0,
                                        }}
                                    >
                                        {section} - Select Assignments
                                    </DialogTitle>
                                    <DialogContent sx={{ px: 3, pt: '8px !important', pb: 2 }}>
                                        <Stack
                                            direction={{ xs: 'column', sm: 'row' }}
                                            alignItems={{ xs: 'stretch', sm: 'center' }}
                                            justifyContent="space-between"
                                            spacing={1.25}
                                            sx={{ mb: 2 }}
                                        >
                                            <Typography variant="body2" sx={{ color: '#6B7280', fontWeight: 600 }}>
                                                {visibleCount} of {total} selected
                                            </Typography>
                                            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                            <Button
                                                size="small"
                                                variant="outlined"
                                                sx={{
                                                    minHeight: 34,
                                                    borderRadius: 1,
                                                    borderColor: '#D1D5DB',
                                                    color: '#111827',
                                                    fontWeight: 650,
                                                    textTransform: 'none',
                                                    '&:hover': {
                                                        borderColor: '#9CA3AF',
                                                        backgroundColor: '#F9FAFB',
                                                    },
                                                }}
                                                onClick={() => {
                                                    const updated = { ...visibleAssignments };
                                                    sectionAssignments.forEach(a => {
                                                        updated[a.name] = true;
                                                    });
                                                    setVisibleAssignments(updated);
                                                }}
                                            >
                                                Select All
                                            </Button>
                                            <Button
                                                size="small"
                                                variant="outlined"
                                                sx={{
                                                    minHeight: 34,
                                                    borderRadius: 1,
                                                    borderColor: '#D1D5DB',
                                                    color: '#111827',
                                                    fontWeight: 650,
                                                    textTransform: 'none',
                                                    '&:hover': {
                                                        borderColor: '#9CA3AF',
                                                        backgroundColor: '#F9FAFB',
                                                    },
                                                }}
                                                onClick={() => {
                                                    const updated = { ...visibleAssignments };
                                                    sectionAssignments.forEach(a => {
                                                        updated[a.name] = false;
                                                    });
                                                    setVisibleAssignments(updated);
                                                }}
                                            >
                                                Deselect All
                                            </Button>
                                            </Box>
                                        </Stack>
                                        <Box
                                            sx={{
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: 0.75,
                                                maxHeight: 'min(58vh, 520px)',
                                                overflowY: 'auto',
                                                pr: 0.5,
                                            }}
                                        >
                                            {sectionAssignments.map(a => {
                                                const isAssignmentVisible = visibleAssignments[a.name] || false;
                                                return (
                                                    <Box
                                                        key={a.name}
                                                        sx={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: 1.25,
                                                            minHeight: 44,
                                                            px: 1.5,
                                                            py: 1,
                                                            border: `1px solid ${isAssignmentVisible ? '#BFD0FF' : '#E5E7EB'}`,
                                                            borderRadius: 1,
                                                            cursor: 'pointer',
                                                            color: '#111827',
                                                            backgroundColor: isAssignmentVisible ? '#E8F0FF' : '#FFFFFF',
                                                            transition: 'background-color 120ms ease, border-color 120ms ease',
                                                            '&:hover': {
                                                                backgroundColor: isAssignmentVisible ? '#DDE8FF' : '#F9FAFB',
                                                                borderColor: isAssignmentVisible ? '#9CB7FF' : '#D1D5DB',
                                                            },
                                                        }}
                                                        onClick={() => {
                                                            setVisibleAssignments(prev => ({
                                                                ...prev,
                                                                [a.name]: !prev[a.name]
                                                            }));
                                                        }}
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={isAssignmentVisible}
                                                            onChange={() => {}}
                                                            style={{
                                                                width: 16,
                                                                height: 16,
                                                                margin: 0,
                                                                cursor: 'pointer',
                                                                accentColor: '#4788B8',
                                                                flex: '0 0 auto',
                                                            }}
                                                        />
                                                        <Typography
                                                            component="span"
                                                            sx={{
                                                                color: '#111827',
                                                                fontSize: 15,
                                                                fontWeight: isAssignmentVisible ? 650 : 500,
                                                                lineHeight: 1.35,
                                                                overflowWrap: 'anywhere',
                                                            }}
                                                        >
                                                            {a.name}
                                                        </Typography>
                                                    </Box>
                                                );
                                            })}
                                        </Box>
                                    </DialogContent>
                                    <DialogActions sx={{ px: 3, py: 2, borderTop: '1px solid #E5E7EB' }}>
                                        <Button
                                            onClick={() => setSelectorDialogOpen(null)}
                                            sx={{
                                                color: '#111827',
                                                fontWeight: 650,
                                                textTransform: 'none',
                                            }}
                                        >
                                            Close
                                        </Button>
                                    </DialogActions>
                                </Dialog>
                            </Box>
                        );
                    })}
                </Box>
                </Box>

                {/* Main Table with Tree Structure Headers */}
                <TableContainer 
                    ref={studentsTableRef}
                    onScroll={handleStudentsTableScroll}
                    sx={{ 
                    bgcolor: isLight ? '#FAFAFB' : 'rgba(8, 14, 30, 0.74)',
                    overflowX: 'auto',
                    overflowY: 'auto',
                    maxHeight: { xs: '70vh', md: 'calc(100vh - 360px)' },
                    minHeight: sortedStudents.length ? 420 : 'auto',
                        position: 'relative',
                        '&::-webkit-scrollbar': {
                            height: '14px',
                            width: '14px'
                        },
                        '&::-webkit-scrollbar-track': {
                          backgroundColor: isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255,255,255,0.12)',
                            borderRadius: '8px'
                        },
                        '&::-webkit-scrollbar-thumb': {
                          backgroundColor: 'rgba(0, 0, 0, 0.35)',
                            borderRadius: '8px',
                          border: '2px solid rgba(0, 0, 0, 0.08)',
                            '&:hover': {
                            backgroundColor: 'rgba(0, 0, 0, 0.55)'
                            }
                        },
                        '&::-webkit-scrollbar-corner': {
                          backgroundColor: isLight ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255,255,255,0.12)'
                        }
                    }}
                >
                    <Table 
                        size="small" 
                        stickyHeader
                        sx={{ 
                            minWidth: 'max-content', // Allow table to exceed container
                            '& .MuiTableCell-root': { 
                                fontSize: '0.875rem',
                                minWidth: '100px', // Increase minimum width for more spacious layout
                                padding: '10px 16px', // Increase padding
                                whiteSpace: 'nowrap'
                            },
                            '& .MuiTableCell-head': {
                              backgroundColor: hdrBg1,
                              color: hdrColor,
                                position: 'sticky',
                                top: 0,
                                zIndex: 100,
                                fontWeight: 600
                            }
                        }}
                    >
                        <TableHead>
                            {/* FIRST HEADER ROW */}
                            <TableRow sx={{ backgroundColor: hdrBg1 }}>
                                <TableCell sx={{ 
                                    position: 'sticky', 
                                    left: 0, 
                                    zIndex: 101, 
                                    backgroundColor: hdrBg1s,
                                    color: hdrColor,
                                    borderRight: `2px solid ${hdrBorderH}`,
                                    minWidth: '200px',
                                    maxWidth: '250px'
                                }}>
                                    <strong>Student</strong>
                                </TableCell>
                              <TableCell align="center" colSpan={2} sx={{ borderRight: `2px solid ${hdrBorderH}`, backgroundColor: hdrBg1s, color: hdrColor }}>
                                    <strong>Summary</strong>
                                </TableCell>
                                
                                {/* Section Headers */}
                                {visibleTableSections.map(({ section, colSpan }) => (
                                        <TableCell key={section} colSpan={colSpan} align="center" sx={{ borderLeft: `2px solid ${hdrBorderH}`, backgroundColor: hdrBg1s, color: hdrColor }}>
                                            <strong>{section}</strong> (Max: {sectionMaxPoints[section] || 0})
                                        </TableCell>
                                ))}
                            </TableRow>
                            
                            {/* SECOND HEADER ROW */}
                                  <TableRow sx={{ backgroundColor: hdrBg2 }}>
                                <TableCell sx={{
                                    position: 'sticky',
                                    left: 0,
                                    zIndex: 101,
                                    backgroundColor: hdrBg2s,
                                    color: hdrColor,
                                    borderRight: `2px solid ${hdrBorderH}`
                                }} />
                                      <TableCell align="center" sx={{ borderRight: `1px solid ${hdrBorderV}`, backgroundColor: hdrBg2s, color: hdrColor }}>
                                    <Box display="flex" alignItems="center" justifyContent="center">
                                        <strong>Total</strong>
                                        <IconButton size="small" onClick={() => handleSort('total')}>
                                            {sortBy === 'total' ? (sortAsc ? <ArrowUpward fontSize="inherit"/> : <ArrowDownward fontSize="inherit"/>) : <ArrowUpward fontSize="inherit" style={{ opacity: 0.3 }}/>}
                                        </IconButton>
                                    </Box>
                                </TableCell>
                                    <TableCell align="center" sx={{ borderRight: `2px solid ${hdrBorderH}`, backgroundColor: hdrBg2s, color: hdrColor }}>
                                    <strong>Final %</strong>
                                </TableCell>
                                
                                {/* Section Total + Assignment Sub-headers */}
                                {visibleTableSections.map(({ section, assignments: visibleInSection, showPolicyTotal }) => (
                                        <Fragment key={section}>
                                            {showPolicyTotal && (
                                            <TableCell align="center" sx={{ borderRight: `1px solid ${hdrBorderV}`, borderLeft: `2px solid ${hdrBorderH}`, backgroundColor: hdrBg2s, color: hdrColor }}>
                                                <Box display="flex" alignItems="center" justifyContent="center">
                                                    <strong>{section} Policy</strong>
                                                    <IconButton size="small" onClick={() => handleSort(section)}>
                                                        {sortBy === section ? (sortAsc ? <ArrowUpward fontSize="inherit"/> : <ArrowDownward fontSize="inherit"/>) : <ArrowUpward fontSize="inherit" style={{ opacity: 0.3 }}/>}
                                                    </IconButton>
                                                </Box>
                                            </TableCell>
                                            )}
                                            {visibleInSection.map(a => (
                                              <TableCell key={a.name} align="center" sx={{ minWidth: '120px', backgroundColor: hdrBg2s, color: hdrColor }}>
                                                    <Box display="flex" alignItems="center" justifyContent="center">
                                                        <strong style={{ fontSize: '11px' }}>{a.name}</strong>
                                                        <IconButton size="small" onClick={() => handleSort(a.name)}>
                                                            {sortBy === a.name ? (sortAsc ? <ArrowUpward fontSize="inherit"/> : <ArrowDownward fontSize="inherit"/>) : <ArrowUpward fontSize="inherit" style={{ opacity: 0.3 }}/>}
                                                        </IconButton>
                                                    </Box>
                                                </TableCell>
                                            ))}
                                        </Fragment>
                                ))}
                            </TableRow>
                        </TableHead>
                        
                        <TableBody>
                            {virtualStudentWindow.topPadding > 0 && (
                                <TableRow aria-hidden="true">
                                    <TableCell
                                      colSpan={totalStudentScoreColumns}
                                      sx={{
                                        height: virtualStudentWindow.topPadding,
                                        p: 0,
                                        border: 0,
                                      }}
                                    />
                                </TableRow>
                            )}
                            {virtualStudentWindow.rows.map(stu => (
                                <AdminStudentScoreRow
                                  key={stu.email}
                                  student={stu}
                                  visibleTableSections={visibleTableSections}
                                  totalMaxPoints={totalMaxPoints}
                                  isLight={isLight}
                                  hdrBorderH={hdrBorderH}
                                  hdrBorderV={hdrBorderV}
                                  onOpenProfile={handleOpenStudentProfile}
                                />
                            ))}
                            {virtualStudentWindow.bottomPadding > 0 && (
                                <TableRow aria-hidden="true">
                                    <TableCell
                                      colSpan={totalStudentScoreColumns}
                                      sx={{
                                        height: virtualStudentWindow.bottomPadding,
                                        p: 0,
                                        border: 0,
                                      }}
                                    />
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </TableContainer>
            </Paper>
            )}
        </Box>
        )}

        {/* AI ANALYTICS TAB */}
        {tab === 2 && (
          <AIAnalytics />
        )}

    </Box>
  );
}
