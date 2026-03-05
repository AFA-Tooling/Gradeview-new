// src/views/admin.jsx
import { useState, useEffect, useMemo, useTransition } from 'react';
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
} from '@mui/material';
import { ArrowUpward, ArrowDownward } from '@mui/icons-material';
import Grid from '@mui/material/Grid';
import PageHeader from '../components/PageHeader';
import StudentProfile from '../components/StudentProfile';
import AIAnalytics from './aiAnalytics';
import GradeSyncControl from './GradeSyncControl';
import apiv2 from '../utils/apiv2';
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



export default function Admin() {
  // TAB STATE
  const [tab, setTab] = useState(0);
  const [courses, setCourses] = useState([]);
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState(localStorage.getItem('selectedCourseId') || '');
  
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

  // score details
  const [scoreDetailOpen, setScoreDetailOpen]     = useState(false);
  const [scoreSelected, setScoreSelected]         = useState([]); // Array of selected score ranges
  const [studentsByScore, setStudentsByScore]     = useState([]); // Array of {range, students} objects
  const [studentsByScoreLoading, setStudentsByScoreLoading] = useState(false);
  const [studentsByScoreError, setStudentsByScoreError] = useState(null);

  const [sortBy, setSortBy]   = useState(null); // 'Quest','Midterm','Labs','total' or assignment.name
  const [sortAsc, setSortAsc] = useState(true);
  
  // --- STUDENT PROFILE DIALOG ---
  const [profileOpen, setProfileOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null); // {email, name}
  
  // --- STUDENT PAGE CUSTOMIZATION ---
  const [visibleAssignments, setVisibleAssignments] = useState({}); // {assignmentName: boolean}
  const [selectorDialogOpen, setSelectorDialogOpen] = useState(null); // Section name or null

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
      apiv2.get('/admin/sync'),
      apiv2.get('/students/courses'),
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
    apiv2.get(`/admin/assignments${buildCourseQuery(selectedCourse)}`)
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

    apiv2.get(`/admin/studentScores${buildCourseQuery(selectedCourse)}`)
      .then(res => setStudentScores(res.data.students))
      .catch(err => setErrorSS(err.message || 'Failed to load student scores'))
      .finally(() => setLoadingSS(false));
  }, [tab, selectedCourse, courses]);

  useEffect(() => {
    setSelected(null);
    setStats(null);
    setDistribution(null);
    setScoreSelected([]);
    setStudentsByScore([]);
  }, [selectedCourse]);

  // Flattened assignment list (for columns)
  const allAssignments = useMemo(() => assignments, [assignments]);

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

  // Calculate max points per section
  const sectionMaxPoints = useMemo(() => {
    const maxPoints = {};
    Object.entries(assignmentsBySection).forEach(([section, sectionAssignments]) => {
      maxPoints[section] = sectionAssignments.reduce((sum, a) => sum + (a.maxPoints || 0), 0);
    });
    return maxPoints;
  }, [assignmentsBySection]);

  const totalMaxPoints = useMemo(() => {
    return Object.values(sectionMaxPoints).reduce((sum, v) => sum + v, 0);
  }, [sectionMaxPoints]);

  /** 5) Compute section totals + overall total per student **/
  const studentWithTotals = useMemo(() => {
    return studentScores.map(stu => {
      // First, flatten the scores from { section: { assignment: score } } to { assignment: score }
      const flatScores = {};
      Object.values(stu.scores || {}).forEach(sectionScores => {
        Object.assign(flatScores, sectionScores);
      });

      const sectionTotals = {};
      Object.keys(assignmentsBySection).forEach(sec => {
        sectionTotals[sec] = allAssignments
          .filter(a => a.section === sec)
          .reduce((sum, a) => sum + Number(flatScores[a.name] || 0), 0);
      });
      
      const total = Object.values(sectionTotals).reduce((s, v) => s + v, 0);
      return { ...stu, scores: flatScores, sectionTotals, total };
    });
  }, [studentScores, allAssignments, assignmentsBySection]);

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
            {Object.entries(assignmentsBySection).map(([section, sectionAssignments]) => (
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
                        bgcolor: '#4f46e5', 
                        '&:hover': { bgcolor: '#4338ca' },
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
                              borderColor: 'rgba(191, 211, 255, 0.4)',
                              color: 'rgba(232, 241, 255, 0.9)',
                              textTransform: 'none',
                              fontWeight: 500,
                              '&:hover': {
                                borderColor: '#6a8cff',
                                color: '#f7fbff',
                                bgcolor: 'rgba(104, 144, 255, 0.18)'
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
                        scoreSelected.includes(d.range) ? '#4caf50' : '#f59e0b'
                      ),
                      borderColor: useLineChart ? '#f59e0b' : undefined,
                      borderWidth: useLineChart ? 3 : 0,
                      pointRadius: useLineChart ? (distribution.distribution || []).map(d =>
                        scoreSelected.includes(d.range) ? 6 : 0  // Show small dot only when selected
                      ) : 0,
                      pointHoverRadius: useLineChart ? 8 : 0,  // Show hover dot
                      pointBackgroundColor: useLineChart ? (distribution.distribution || []).map(d =>
                        scoreSelected.includes(d.range) ? '#4caf50' : '#f59e0b'
                      ) : undefined,
                      pointBorderColor: useLineChart ? '#0b1022' : undefined,
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
                          color: 'rgba(224, 236, 255, 0.95)'
                        },
                        min: 0,
                        max: maxScore,
                        ticks: {
                          stepSize: 1,
                          autoSkip: numBins > 20,
                          maxRotation: 45,
                          minRotation: 45,
                          color: 'rgba(210, 226, 255, 0.92)',
                          font: {
                            size: numBins > 50 ? 10 : 12
                          }
                        },
                        grid: {
                          color: 'rgba(255, 255, 255, 0.12)'
                        }
                      },
                      y: {
                        title: {
                          display: true,
                          text: 'Count',
                          color: 'rgba(224, 236, 255, 0.95)'
                        },
                        beginAtZero: true,
                        ticks: {
                          stepSize: 1,
                          precision: 0,
                          color: 'rgba(210, 226, 255, 0.92)'
                        },
                        grid: {
                          color: 'rgba(255, 255, 255, 0.12)'
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
                      <Typography variant="body2" sx={{ color: 'rgba(224, 236, 255, 0.92)' }}>
                        💡 Click on {useLineChart ? 'points' : 'bars'} to select/deselect score ranges. Selected ranges will turn green.
                      </Typography>
                      {scoreSelected.length > 0 && (
                        <Button 
                          variant="contained" 
                          sx={{ bgcolor: '#d97706', '&:hover': { bgcolor: '#b45309' }, color: '#fff' }}
                          size="small"
                          onClick={() => setScoreDetailOpen(true)}
                        >
                          View Selected ({scoreSelected.length})
                        </Button>
                      )}
                    </Box>
                    {useLineChart && (
                      <Typography variant="caption" sx={{ display: 'block', mb: 1, color: '#fbbf24', fontStyle: 'italic' }}>
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
                    💡 Tip: Table scrolls horizontally - use your mouse or trackpad to scroll left/right to see all columns
                  </Typography>
                </Box>
                
                {/* Assignment Selector - Buttons for each section */}
                <Box sx={{ p: 3, bgcolor: 'rgba(255,255,255,0.03)' }}>
                  <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        Show Columns:
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
                    
                    {/* Section Buttons */}
                    {Object.entries(assignmentsBySection).map(([section, sectionAssignments]) => {
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
                                        backgroundColor: allVisible ? '#4f46e5' : 'transparent',
                                      color: allVisible ? 'white' : 'rgba(232,241,255,0.9)',
                                      borderColor: allVisible ? '#4f46e5' : 'rgba(191,211,255,0.35)',
                                        textTransform: 'none',
                                        fontWeight: 500,
                                        '&:hover': {
                                          backgroundColor: allVisible ? '#4338ca' : 'rgba(104, 144, 255, 0.14)',
                                          borderColor: '#4f46e5'
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
                                >
                                    <DialogTitle>{section} - Select Assignments</DialogTitle>
                                    <DialogContent sx={{ pt: 2 }}>
                                        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                                            <Button
                                                size="small"
                                                variant="outlined"
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
                                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                            {sectionAssignments.map(a => (
                                                <Box
                                                    key={a.name}
                                                    sx={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        padding: '8px',
                                                border: '1px solid rgba(168, 194, 255, 0.35)',
                                                        borderRadius: '4px',
                                                        cursor: 'pointer',
                                                color: 'rgba(231, 241, 255, 0.96)',
                                                backgroundColor: visibleAssignments[a.name] ? 'rgba(88, 132, 255, 0.28)' : 'rgba(20, 32, 66, 0.86)',
                                                '&:hover': {
                                                  backgroundColor: visibleAssignments[a.name] ? 'rgba(98, 146, 255, 0.34)' : 'rgba(30, 44, 86, 0.9)'
                                                }
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
                                                        checked={visibleAssignments[a.name] || false}
                                                        onChange={() => {}}
                                                      style={{ marginRight: '8px', cursor: 'pointer', accentColor: '#66b2ff' }}
                                                    />
                                                    <span style={{ color: 'rgba(231, 241, 255, 0.96)' }}>{a.name}</span>
                                                </Box>
                                            ))}
                                        </Box>
                                    </DialogContent>
                                    <DialogActions>
                                        <Button onClick={() => setSelectorDialogOpen(null)}>Close</Button>
                                    </DialogActions>
                                </Dialog>
                            </Box>
                        );
                    })}
                </Box>
                </Box>

                {/* Main Table with Tree Structure Headers */}
                <TableContainer 
                    sx={{ 
                    bgcolor: 'rgba(8, 14, 30, 0.74)',
                    overflowX: 'auto',
                    overflowY: 'visible',
                        position: 'relative',
                        '&::-webkit-scrollbar': {
                            height: '14px',
                            width: '14px'
                        },
                        '&::-webkit-scrollbar-track': {
                          backgroundColor: 'rgba(255,255,255,0.12)',
                            borderRadius: '8px'
                        },
                        '&::-webkit-scrollbar-thumb': {
                          backgroundColor: 'rgba(102, 175, 255, 0.9)',
                            borderRadius: '8px',
                          border: '2px solid rgba(255,255,255,0.12)',
                            '&:hover': {
                            backgroundColor: 'rgba(102, 175, 255, 1)'
                            }
                        },
                        '&::-webkit-scrollbar-corner': {
                          backgroundColor: 'rgba(255,255,255,0.12)'
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
                              backgroundColor: 'rgba(53, 77, 154, 0.9)',
                              color: 'rgba(242, 247, 255, 0.98)',
                                position: 'sticky',
                                top: 0,
                                zIndex: 100,
                                fontWeight: 600
                            }
                        }}
                    >
                        <TableHead>
                            {/* FIRST HEADER ROW */}
                            <TableRow sx={{ backgroundColor: 'rgba(53, 77, 154, 0.9)' }}>
                                <TableCell sx={{ 
                                    position: 'sticky', 
                                    left: 0, 
                                    zIndex: 101, 
                                backgroundColor: 'rgba(53, 77, 154, 0.94)',
                                color: 'rgba(242, 247, 255, 0.98)',
                                    borderRight: '2px solid #999',
                                    minWidth: '200px', // Student name column wider
                                    maxWidth: '250px'
                                }}>
                                    <strong>Student</strong>
                                </TableCell>
                              <TableCell align="center" colSpan={2} sx={{ borderRight: '2px solid #999', backgroundColor: 'rgba(53, 77, 154, 0.94)', color: 'rgba(242, 247, 255, 0.98)' }}>
                                    <strong>Summary</strong>
                                </TableCell>
                                
                                {/* Section Headers */}
                                {Object.entries(assignmentsBySection).map(([section, sectionAssignments]) => {
                                    const visibleInSection = sectionAssignments.filter(a => visibleAssignments[a.name]);
                                    if (visibleInSection.length === 0) return null;
                                    
                                    return (
                                        <TableCell key={section} colSpan={visibleInSection.length + 1} align="center" sx={{ borderLeft: '2px solid #999', backgroundColor: 'rgba(53, 77, 154, 0.94)', color: 'rgba(242, 247, 255, 0.98)' }}>
                                            <strong>{section}</strong> (Max: {sectionMaxPoints[section] || 0})
                                        </TableCell>
                                    );
                                })}
                            </TableRow>
                            
                            {/* SECOND HEADER ROW */}
                                  <TableRow sx={{ backgroundColor: 'rgba(60, 88, 175, 0.88)' }}>
                                <TableCell sx={{
                                    position: 'sticky',
                                    left: 0,
                                    zIndex: 101,
                                      backgroundColor: 'rgba(60, 88, 175, 0.92)',
                                      color: 'rgba(242, 247, 255, 0.98)',
                                    borderRight: '2px solid #999'
                                }} />
                                      <TableCell align="center" sx={{ borderRight: '1px solid #ccc', backgroundColor: 'rgba(60, 88, 175, 0.92)', color: 'rgba(242, 247, 255, 0.98)' }}>
                                    <Box display="flex" alignItems="center" justifyContent="center">
                                        <strong>Total</strong>
                                        <IconButton size="small" onClick={() => handleSort('total')}>
                                            {sortBy === 'total' ? (sortAsc ? <ArrowUpward fontSize="inherit"/> : <ArrowDownward fontSize="inherit"/>) : <ArrowUpward fontSize="inherit" style={{ opacity: 0.3 }}/>}
                                        </IconButton>
                                    </Box>
                                </TableCell>
                                    <TableCell align="center" sx={{ borderRight: '2px solid #999', backgroundColor: 'rgba(60, 88, 175, 0.92)', color: 'rgba(242, 247, 255, 0.98)' }}>
                                    <strong>Final %</strong>
                                </TableCell>
                                
                                {/* Section Total + Assignment Sub-headers */}
                                {Object.entries(assignmentsBySection).map(([section, sectionAssignments]) => {
                                    const visibleInSection = sectionAssignments.filter(a => visibleAssignments[a.name]);
                                    if (visibleInSection.length === 0) return null;
                                    
                                    return (
                                        <>
                                            <TableCell align="center" sx={{ borderRight: '1px solid #ccc', borderLeft: '2px solid #999', backgroundColor: 'rgba(60, 88, 175, 0.92)', color: 'rgba(242, 247, 255, 0.98)' }}>
                                                <Box display="flex" alignItems="center" justifyContent="center">
                                                    <strong>{section} Total</strong>
                                                    <IconButton size="small" onClick={() => handleSort(section)}>
                                                        {sortBy === section ? (sortAsc ? <ArrowUpward fontSize="inherit"/> : <ArrowDownward fontSize="inherit"/>) : <ArrowUpward fontSize="inherit" style={{ opacity: 0.3 }}/>}
                                                    </IconButton>
                                                </Box>
                                            </TableCell>
                                            {visibleInSection.map(a => (
                                              <TableCell key={a.name} align="center" sx={{ minWidth: '120px', backgroundColor: 'rgba(60, 88, 175, 0.92)', color: 'rgba(242, 247, 255, 0.98)' }}>
                                                    <Box display="flex" alignItems="center" justifyContent="center">
                                                        <strong style={{ fontSize: '11px' }}>{a.name}</strong>
                                                        <IconButton size="small" onClick={() => handleSort(a.name)}>
                                                            {sortBy === a.name ? (sortAsc ? <ArrowUpward fontSize="inherit"/> : <ArrowDownward fontSize="inherit"/>) : <ArrowUpward fontSize="inherit" style={{ opacity: 0.3 }}/>}
                                                        </IconButton>
                                                    </Box>
                                                </TableCell>
                                            ))}
                                        </>
                                    );
                                })}
                            </TableRow>
                        </TableHead>
                        
                        <TableBody>
                            {sortedStudents.map(stu => (
                                <TableRow key={stu.email}>
                                    {/* Student Info */}
                                    <TableCell sx={{
                                        position: 'sticky',
                                        left: 0,
                                        zIndex: 10,
                                        backgroundColor: 'rgba(18, 28, 55, 0.94)',
                                        borderRight: '2px solid #999',
                                        minWidth: '200px', // Student name column wider
                                        maxWidth: '250px'
                                    }}>
                                        <Box
                                            sx={{
                                                cursor: 'pointer',
                                                '&:hover': {
                                                    color: '#1976d2',
                                                    textDecoration: 'underline',
                                                }
                                            }}
                                            onClick={() => {
                                                setSelectedStudent({ email: stu.email, name: stu.name });
                                                setProfileOpen(true);
                                            }}
                                        >
                                            <strong>{stu.name}</strong><br/>
                                            <small>{stu.email}</small>
                                        </Box>
                                    </TableCell>
                                    
                                    {/* Summary Scores */}
                                    <TableCell align="center" sx={{ borderRight: '1px solid #ccc' }}>
                                        {stu.total.toFixed(2)}
                                    </TableCell>
                                    <TableCell align="center" sx={{ borderRight: '2px solid #999' }}>
                                        {totalMaxPoints > 0 ? ((stu.total / totalMaxPoints) * 100).toFixed(2) : '0.00'}%
                                    </TableCell>
                                    
                                    {/* Section + Assignment Scores */}
                                    {Object.entries(assignmentsBySection).map(([section, sectionAssignments]) => {
                                        const visibleInSection = sectionAssignments.filter(a => visibleAssignments[a.name]);
                                        if (visibleInSection.length === 0) return null;
                                        
                                        return (
                                            <>
                                                <TableCell align="center" sx={{ borderRight: '1px solid #ccc', borderLeft: '2px solid #999', fontWeight: 'bold' }}>
                                                    {stu.sectionTotals[section]?.toFixed(2) || '0.00'}
                                                </TableCell>
                                                {visibleInSection.map(a => {
                                                    const rawScore = stu.scores[a.name];
                                                    return (
                                                        <TableCell key={a.name} align="center" sx={{ minWidth: '120px' }}>
                                                            {(rawScore != null && rawScore !== '') ? Number(rawScore).toFixed(2) : 'N/A'}
                                                        </TableCell>
                                                    );
                                                })}
                                            </>
                                        );
                                    })}
                                </TableRow>
                            ))}
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

        {/* Student Profile Dialog */}
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

    </Box>
  );
}
