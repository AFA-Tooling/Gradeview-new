// src/components/StudentProfileContent.js
import React, { useState, useMemo } from 'react';
import {
  Box,
  Typography,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  Paper,
  Grid,
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material';
import CategoryIcon from '@mui/icons-material/Category';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  RadialLinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Filler,
  Title,
  Tooltip as ChartTooltip,
  Legend as ChartLegend,
} from 'chart.js';
import { Line as ChartLine, Radar as ChartRadar } from 'react-chartjs-2';
import ChartDataLabels from 'chartjs-plugin-datalabels';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  RadialLinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Filler,
  Title,
  ChartDataLabels,
  ChartTooltip,
  ChartLegend
);

/**
 * Shared Student Profile Content Component
 * Used by both the dialog version and the page version
 */
export default function StudentProfileContent({ studentData }) {
  if (!studentData) return null;

  const roundUpPoints = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.ceil(numeric);
  };

  const toSafePercentage = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(100, numeric));
  };

  const renderProgressBattery = (value, segmentCount = 10) => {
    const safeValue = toSafePercentage(value);
    const filledSegments = Math.round((safeValue / 100) * segmentCount);

    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
          {Array.from({ length: segmentCount }, (_, index) => (
            <Box
              key={index}
              sx={{
                width: 10,
                height: 16,
                borderRadius: '2px',
                backgroundColor: index < filledSegments ? '#1e3a8a' : '#e5e7eb',
                border: '1px solid #d1d5db'
              }}
            />
          ))}
        </Box>
        <Typography variant="body2" sx={{ color: '#374151', fontWeight: 600, minWidth: 58, textAlign: 'left' }}>
          {safeValue.toFixed(2)}%
        </Typography>
      </Box>
    );
  };

  // Local state for sort mode (only affects line chart and detail table)
  const [sortMode, setSortMode] = useState('assignment');

  // Sort the trend data for line chart based on sortMode
  const sortedTrendData = useMemo(() => {
    if (!studentData.trendData) return [];
    const data = [...studentData.trendData];
    
    console.log('Sorting trend data, mode:', sortMode);
    console.log('First item submissionTime:', data[0]?.submissionTime);
    
    if (sortMode === 'time') {
      // Sort by submission time - newest first (descending)
      const sorted = data.sort((a, b) => {
        if (!a.submissionTime) return 1;
        if (!b.submissionTime) return -1;
        return new Date(b.submissionTime) - new Date(a.submissionTime);
      });
      console.log('Sorted by time, first item:', sorted[0]?.name, sorted[0]?.submissionTime);
      return sorted;
    } else {
      // Keep assignment order (already sorted by category and name)
      console.log('Using assignment order');
      return data;
    }
  }, [studentData.trendData, sortMode]);

  // Sort the assignments list for detail table based on sortMode
  const sortedAssignments = useMemo(() => {
    if (!studentData.assignmentsList) return [];
    const data = [...studentData.assignmentsList];
    
    if (sortMode === 'time') {
      // Sort by submission time - newest first (descending)
      return data.sort((a, b) => {
        if (!a.submissionTime) return 1;
        if (!b.submissionTime) return -1;
        return new Date(b.submissionTime) - new Date(a.submissionTime);
      });
    } else {
      // Keep assignment order (already sorted by category and name)
      return data;
    }
  }, [studentData.assignmentsList, sortMode]);

  const examPolicyRows = Array.isArray(studentData?.examPolicyRows) ? studentData.examPolicyRows : [];

  const questComponentTrend = useMemo(() => {
    const trend = studentData?.questComponentTrend;
    const components = Array.isArray(trend?.components) ? trend.components : [];
    const series = Array.isArray(trend?.series) ? trend.series : [];
    return { components, series };
  }, [studentData?.questComponentTrend]);

  // Format date for display
  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <Box>
      {/* Overall Summary */}
      <Paper 
        elevation={0} 
        sx={{ 
          p: 4, 
          mb: 3, 
          backgroundColor: 'white',
          borderRadius: 3,
          border: '1px solid #e5e7eb',
          boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)'
        }}
      >
        <Typography variant="h6" gutterBottom sx={{ color: '#1e3a8a', fontWeight: 600, mb: 3 }}>
          Overall Summary
        </Typography>
        <Grid container spacing={3}>
          <Grid item xs={12} sm={4}>
            <Box textAlign="center" sx={{ p: 2 }}>
              <Typography variant="body2" sx={{ color: '#6b7280', fontSize: '0.875rem', mb: 1 }}>Total Score</Typography>
              <Typography variant="h4" sx={{ color: '#1e3a8a', fontWeight: 600, mb: 0.5 }}>
                {roundUpPoints(studentData.totalScore)}
              </Typography>
              <Typography variant="body2" sx={{ color: '#9ca3af' }}>
                / {roundUpPoints(studentData.totalCapPoints ?? studentData.totalMaxPoints)}
              </Typography>
            </Box>
          </Grid>
          <Grid item xs={12} sm={4}>
            <Box textAlign="center" sx={{ p: 2 }}>
              <Typography variant="body2" sx={{ color: '#6b7280', fontSize: '0.875rem', mb: 1 }}>Progress</Typography>
              {renderProgressBattery(studentData.overallPercentage)}
            </Box>
          </Grid>
          <Grid item xs={12} sm={4}>
            <Box textAlign="center" sx={{ p: 2 }}>
              <Typography variant="body2" sx={{ color: '#6b7280', fontSize: '0.875rem', mb: 1 }}>Total Assignments</Typography>
              <Typography variant="h4" sx={{ color: '#1e3a8a', fontWeight: 600 }}>
                {studentData.assignmentsList.length}
              </Typography>
            </Box>
          </Grid>
        </Grid>
      </Paper>

      {/* Performance by Category */}
      <Paper 
        elevation={0} 
        sx={{ 
          p: 4, 
          mb: 3,
          backgroundColor: 'white',
          borderRadius: 3,
          border: '1px solid #e5e7eb',
          boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)'
        }}
      >
        <Typography variant="h6" gutterBottom sx={{ color: '#1e3a8a', fontWeight: 600, mb: 3 }}>
          Performance by Category
        </Typography>
        <TableContainer sx={{ mt: 2, borderRadius: 2, overflow: 'hidden' }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ backgroundColor: '#f9fafb' }}>
                <TableCell><strong>Category</strong></TableCell>
                <TableCell align="center"><strong>Score</strong></TableCell>
                <TableCell align="center"><strong>Cap</strong></TableCell>
                <TableCell align="center"><strong>%</strong></TableCell>
                <TableCell align="center"><strong>Count</strong></TableCell>
                <TableCell align="center"><strong>Avg</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {Object.entries(studentData.categoriesData).map(([category, data]) => {
                return (
                  <TableRow key={category} hover>
                    <TableCell><strong>{category}</strong></TableCell>
                    <TableCell align="center">{roundUpPoints(data.total)}</TableCell>
                    <TableCell align="center">{roundUpPoints(data.capPoints ?? data.maxPoints)}</TableCell>
                    <TableCell align="center">{renderProgressBattery(data.percentage)}</TableCell>
                    <TableCell align="center">{data.count}</TableCell>
                    <TableCell align="center">{data.average.toFixed(2)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Charts */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        {/* Radar Chart */}
        <Grid item xs={12} md={6}>
          <Paper 
            elevation={0} 
            sx={{ 
              p: 3,
              backgroundColor: 'white',
              borderRadius: 3,
              border: '1px solid #e5e7eb',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)'
            }}
          >
            <Typography variant="h6" gutterBottom sx={{ color: '#1e3a8a', fontWeight: 600 }}>
              Category Performance Radar
            </Typography>
            <Box sx={{ height: 400, position: 'relative' }}>
              <ChartRadar 
                data={{
                  labels: studentData.radarData.map(d => d.category),
                  datasets: [
                    {
                      label: 'Score %',
                      data: studentData.radarData.map(d => d.percentage),
                      borderColor: '#1565c0',
                      backgroundColor: 'rgba(25, 118, 210, 0.4)',
                      borderWidth: 3,
                      pointRadius: 6,
                      pointHoverRadius: 10,
                      pointBackgroundColor: '#1565c0',
                      pointBorderColor: '#fff',
                      pointBorderWidth: 2,
                    }
                  ]
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  scales: {
                    r: {
                      min: 0,
                      max: 100,
                      beginAtZero: true,
                      ticks: {
                        stepSize: 20,
                        backdropColor: 'transparent',
                        font: {
                          size: 13
                        },
                        callback: function(value) {
                          return value + '%';
                        }
                      },
                      grid: {
                        color: 'rgba(0, 0, 0, 0.1)'
                      },
                      angleLines: {
                        color: 'rgba(0, 0, 0, 0.1)'
                      },
                      pointLabels: {
                        display: false  // Hide category labels around the radar
                      }
                    }
                  },
                  interaction: {
                    mode: 'point',
                    intersect: false
                  },
                  plugins: {
                    legend: {
                      position: 'bottom',
                      labels: {
                        padding: 15,
                        usePointStyle: true,
                        font: {
                          size: 13
                        }
                      }
                    },
                    tooltip: {
                      enabled: true,
                      mode: 'nearest',
                      backgroundColor: 'rgba(0, 0, 0, 0.8)',
                      padding: 12,
                      titleFont: {
                        size: 14,
                        weight: 'bold'
                      },
                      bodyFont: {
                        size: 13
                      },
                      callbacks: {
                        title: function(context) {
                          return studentData.radarData[context[0].dataIndex].category;
                        },
                        label: function(context) {
                          const dataIndex = context.dataIndex;
                          const data = studentData.radarData[dataIndex];
                          return `Score: ${context.parsed.r.toFixed(1)}% (${Math.round(data.score)}/${Math.round(data.maxPoints)})`;
                        }
                      }
                    },
                    datalabels: {
                      display: false  // Hide labels on chart, show only on hover via tooltip
                    }
                  }
                }}
              />
            </Box>
          </Paper>
        </Grid>

        {/* Quest Progress Trend */}
        <Grid item xs={12}>
          <Paper 
            elevation={0} 
            sx={{ 
              p: 3,
              backgroundColor: 'white',
              borderRadius: 3,
              border: '1px solid #e5e7eb',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)'
            }}
          >
            <Typography variant="h6" gutterBottom sx={{ color: '#1e3a8a', fontWeight: 600 }}>
              Quest Progress Trend
            </Typography>
            <Box sx={{ height: 300, position: 'relative' }}>
              {questComponentTrend.components.length === 0 || questComponentTrend.series.length === 0 ? (
                <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Typography sx={{ color: '#6b7280' }}>Quest component progression is not available yet.</Typography>
                </Box>
              ) : (
              <ChartLine
                data={{
                  labels: questComponentTrend.components,
                  datasets: questComponentTrend.series.map((seriesItem, index) => {
                    const colors = [
                      { border: '#90caf9', background: 'rgba(144, 202, 249, 0.10)' },
                      { border: '#42a5f5', background: 'rgba(66, 165, 245, 0.10)' },
                      { border: '#1565c0', background: 'rgba(21, 101, 192, 0.12)' },
                    ];
                    const selectedColor = colors[index] || colors[colors.length - 1];
                    return {
                      label: seriesItem.name,
                      data: (seriesItem.data || []).map((value) => toSafePercentage(value)),
                      borderColor: selectedColor.border,
                      backgroundColor: selectedColor.background,
                      borderWidth: 3,
                      pointRadius: 4,
                      pointHoverRadius: 7,
                      pointBackgroundColor: selectedColor.border,
                      tension: 0.2,
                      fill: false,
                    };
                  }),
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  scales: {
                    y: {
                      min: 0,
                      max: 100,
                      beginAtZero: true,
                      grid: {
                        color: 'rgba(0, 0, 0, 0.1)'
                      },
                      ticks: {
                        stepSize: 20
                      },
                      title: {
                        display: true,
                        text: 'Percentage (%)',
                        font: {
                          size: 12
                        }
                      }
                    },
                    x: {
                      grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                      },
                      title: {
                        display: true,
                        text: 'Quest Attempts',
                        font: {
                          size: 12
                        }
                      }
                    }
                  },
                  plugins: {
                    legend: {
                      display: true,
                      position: 'top'
                    },
                    datalabels: {
                      display: false  // Hide labels, show only on hover
                    },
                    tooltip: {
                      callbacks: {
                        label: function(context) {
                          const pct = Number(context.parsed.y || 0);
                          const points = Math.min(25, roundUpPoints((pct / 100) * 25));
                          return `${pct.toFixed(2)}% (${points}/25)`;
                        }
                      }
                    }
                  }
                }}
              />
              )}
            </Box>
          </Paper>
        </Grid>

        {/* Line Chart */}
        <Grid item xs={12}>
          <Paper 
            elevation={0} 
            sx={{ 
              p: 3,
              backgroundColor: 'white',
              borderRadius: 3,
              border: '1px solid #e5e7eb',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)'
            }}
          >
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="h6" sx={{ color: '#1e3a8a', fontWeight: 600 }}>
                Score Trend
              </Typography>
              <ToggleButtonGroup
                value={sortMode}
                exclusive
                onChange={(e, newMode) => newMode && setSortMode(newMode)}
                size="small"
                sx={{ 
                  '& .MuiToggleButton-root': {
                    px: 2,
                    py: 0.5,
                    fontSize: '0.875rem',
                    textTransform: 'none',
                    color: '#1976d2',
                    border: '1px solid rgba(25, 118, 210, 0.5)',
                    '&.Mui-selected': {
                      backgroundColor: '#1976d2',
                      color: 'white',
                      '&:hover': {
                        backgroundColor: '#1565c0',
                      }
                    }
                  }
                }}
              >
                <ToggleButton value="assignment">
                  <CategoryIcon sx={{ mr: 0.5, fontSize: 16 }} />
                  By Assignment
                </ToggleButton>
                <ToggleButton value="time">
                  <AccessTimeIcon sx={{ mr: 0.5, fontSize: 16 }} />
                  By Time
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>
            <Box sx={{ height: 300, position: 'relative' }} key={sortMode}>
              <ChartLine
                key={`line-chart-${sortMode}`}
                data={{
                  labels: sortedTrendData.map((d, idx) => idx + 1),
                  datasets: [{
                    label: 'Percentage',
                    data: sortedTrendData.map(d => d.percentage),
                    borderColor: '#1976d2',
                    backgroundColor: 'rgba(25, 118, 210, 0.1)',
                    borderWidth: 2,
                    pointRadius: 4,
                    pointBackgroundColor: '#1976d2',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    tension: 0.1,
                    fill: true,
                  }]
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  scales: {
                    y: {
                      min: 0,
                      max: 100,
                      beginAtZero: true,
                      grid: {
                        color: 'rgba(0, 0, 0, 0.1)'
                      },
                      ticks: {
                        stepSize: 20
                      },
                      title: {
                        display: true,
                        text: 'Percentage (%)',
                        font: {
                          size: 12
                        }
                      }
                    },
                    x: {
                      grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                      },
                      title: {
                        display: true,
                        text: 'Assignment Order',
                        font: {
                          size: 12
                        }
                      }
                    }
                  },
                  plugins: {
                    legend: {
                      display: false
                    },
                    datalabels: {
                      display: false  // Hide labels, show only on hover
                    },
                    tooltip: {
                      callbacks: {
                        title: function(context) {
                          const index = context[0].dataIndex;
                          return sortedTrendData[index].name;
                        },
                        label: function(context) {
                          const index = context.dataIndex;
                          const data = sortedTrendData[index];
                          let label = `Score: ${data.percentage.toFixed(2)}%`;
                          if (data.submissionTime) {
                            label += `\nSubmitted: ${formatDate(data.submissionTime)}`;
                          }
                          return label;
                        }
                      }
                    }
                  },
                  interaction: {
                    mode: 'index',  // Show tooltip when hovering near any x-position
                    intersect: false,
                    axis: 'x'  // Trigger based on x-axis proximity
                  }
                }}
              />
            </Box>
          </Paper>
        </Grid>
      </Grid>

      {/* Exam Policy Effective Scores */}
      <Paper
        elevation={0}
        sx={{
          p: 4,
          mb: 3,
          backgroundColor: 'white',
          borderRadius: 3,
          border: '1px solid #e5e7eb',
          boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)'
        }}
      >
        <Typography variant="h6" gutterBottom sx={{ color: '#1e3a8a', fontWeight: 600, mb: 3 }}>
          Exam Policy Scores
        </Typography>
        {examPolicyRows.length === 0 ? (
          <Typography sx={{ color: '#6b7280' }}>No computed exam-policy rows yet.</Typography>
        ) : (
          <TableContainer sx={{ mt: 2, borderRadius: 2, overflow: 'hidden' }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ backgroundColor: '#f9fafb' }}>
                  <TableCell><strong>Exam</strong></TableCell>
                  <TableCell align="center"><strong>Attempt</strong></TableCell>
                  <TableCell align="center"><strong>Raw %</strong></TableCell>
                  <TableCell align="center"><strong>Question-best %</strong></TableCell>
                  <TableCell align="center"><strong>Clobbered %</strong></TableCell>
                  <TableCell align="center"><strong>Final %</strong></TableCell>
                  <TableCell><strong>Source</strong></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {examPolicyRows.map((row, idx) => {
                  const examLabel = `${String(row.examType || '').toUpperCase()} ${row.attemptNo || '-'}`;
                  const raw = row.rawPercentage == null ? '-' : `${Number(row.rawPercentage).toFixed(2)}%`;
                  const qbest = row.questionBestPercentage == null ? '-' : `${Number(row.questionBestPercentage).toFixed(2)}%`;
                  const clob = row.clobberedPercentage == null ? '-' : `${Number(row.clobberedPercentage).toFixed(2)}%`;
                  const finalPct = row.finalPercentage == null ? '-' : `${Number(row.finalPercentage).toFixed(2)}%`;
                  const sourceText = row.clobberSourceTitle || row.assignmentTitle || '-';

                  return (
                    <TableRow key={`${row.examType}-${row.attemptNo}-${idx}`} hover>
                      <TableCell>{examLabel}</TableCell>
                      <TableCell align="center">{row.attemptNo}</TableCell>
                      <TableCell align="center">{raw}</TableCell>
                      <TableCell align="center">{qbest}</TableCell>
                      <TableCell align="center">{clob}</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 700 }}>{finalPct}</TableCell>
                      <TableCell>{sourceText}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      {/* Detailed Assignment Scores */}
      <Paper 
        elevation={0} 
        sx={{ 
          p: 4,
          backgroundColor: 'white',
          borderRadius: 3,
          border: '1px solid #e5e7eb',
          boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)'
        }}
      >
        <Typography variant="h6" gutterBottom sx={{ color: '#1e3a8a', fontWeight: 600, mb: 3 }}>
          Detailed Assignment Scores
        </Typography>
        <TableContainer sx={{ mt: 2, maxHeight: 600, borderRadius: 2, overflow: 'auto' }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ backgroundColor: '#f9fafb', fontWeight: 600 }}>#</TableCell>
                <TableCell sx={{ backgroundColor: '#f9fafb', fontWeight: 600 }}>Category</TableCell>
                <TableCell sx={{ backgroundColor: '#f9fafb', fontWeight: 600 }}>Assignment</TableCell>
                <TableCell align="center" sx={{ backgroundColor: '#f9fafb', fontWeight: 600 }}>Score</TableCell>
                <TableCell align="center" sx={{ backgroundColor: '#f9fafb', fontWeight: 600 }}>Max</TableCell>
                <TableCell align="center" sx={{ backgroundColor: '#f9fafb', fontWeight: 600 }}>%</TableCell>
                <TableCell align="center" sx={{ backgroundColor: '#f9fafb', fontWeight: 600 }}>Submitted</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedAssignments.map((assignment, idx) => {
                return (
                  <TableRow key={idx} hover>
                    <TableCell>{idx + 1}</TableCell>
                    <TableCell>{assignment.category}</TableCell>
                    <TableCell>{assignment.name}</TableCell>
                    <TableCell align="center">{Math.round(assignment.score)}</TableCell>
                    <TableCell align="center">{Math.round(assignment.maxPoints)}</TableCell>
                    <TableCell align="center">{renderProgressBattery(assignment.percentage)}</TableCell>
                    <TableCell align="center" sx={{ fontSize: '0.875rem' }}>
                      {formatDate(assignment.submissionTime)}
                      {assignment.lateness && assignment.lateness !== '00:00:00' && (
                        <Box component="span" sx={{ display: 'block', color: '#f44336', fontSize: '0.75rem', mt: 0.5 }}>
                          Late: {assignment.lateness}
                        </Box>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
}
