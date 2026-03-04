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
import { Line as ChartLine, Radar as ChartRadar, Bar as ChartBar } from 'react-chartjs-2';
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

  const assignmentsList = Array.isArray(studentData?.assignmentsList) ? studentData.assignmentsList : [];
  const categoriesData = studentData?.categoriesData && typeof studentData.categoriesData === 'object'
    ? studentData.categoriesData
    : {};
  const radarData = Array.isArray(studentData?.radarData) ? studentData.radarData : [];
  const trendData = Array.isArray(studentData?.trendData) ? studentData.trendData : [];

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
    if (trendData.length === 0) return [];
    const data = [...trendData];
    
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
  }, [trendData, sortMode]);

  // Sort the assignments list for detail table based on sortMode
  const sortedAssignments = useMemo(() => {
    if (assignmentsList.length === 0) return [];
    const data = [...assignmentsList];
    
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
  }, [assignmentsList, sortMode]);

  const examPolicyRows = Array.isArray(studentData?.examPolicyRows) ? studentData.examPolicyRows : [];

  const questComponentTrend = useMemo(() => {
    const trend = studentData?.questComponentTrend;
    const components = Array.isArray(trend?.components) ? trend.components : [];
    const series = Array.isArray(trend?.series) ? trend.series : [];
    return { components, series };
  }, [studentData?.questComponentTrend]);

  const questTrendChartDatasets = useMemo(() => {
    if (questComponentTrend.components.length === 0 || questComponentTrend.series.length === 0) {
      return [];
    }

    const palette = [
      {
        line: '#3b82f6',
        point: '#2563eb',
        baseArea: 'rgba(59, 130, 246, 0.10)',
        diffArea: 'rgba(59, 130, 246, 0.14)',
      },
      {
        line: '#f59e0b',
        point: '#d97706',
        baseArea: 'rgba(245, 158, 11, 0.08)',
        diffArea: 'rgba(245, 158, 11, 0.16)',
      },
      {
        line: '#10b981',
        point: '#059669',
        baseArea: 'rgba(16, 185, 129, 0.08)',
        diffArea: 'rgba(16, 185, 129, 0.16)',
      },
    ];

    const datasets = [];
    const lineDatasetIndexes = [];

    questComponentTrend.series.forEach((seriesItem, index) => {
      const selectedColor = palette[index] || palette[palette.length - 1];
      const lineData = questComponentTrend.components.map((_, pointIndex) => {
        const value = Array.isArray(seriesItem?.data) ? seriesItem.data[pointIndex] : 0;
        return toSafePercentage(value);
      });

      datasets.push({
        label: seriesItem?.name || `After Quest-${index + 1}`,
        data: lineData,
        borderColor: selectedColor.line,
        backgroundColor: selectedColor.baseArea,
        borderWidth: 3,
        pointRadius: 4,
        pointHoverRadius: 7,
        pointBackgroundColor: selectedColor.point,
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        tension: 0.28,
        fill: index === 0,
        order: 2,
      });

      lineDatasetIndexes[index] = datasets.length - 1;

      if (index > 0) {
        const prevLineData = datasets[lineDatasetIndexes[index - 1]]?.data || [];
        const overlayData = lineData.map((value, pointIndex) => Math.max(value, prevLineData[pointIndex] || 0));

        datasets.push({
          label: `${seriesItem?.name || `After Quest-${index + 1}`} (Area)`,
          data: overlayData,
          borderColor: 'rgba(0, 0, 0, 0)',
          backgroundColor: selectedColor.diffArea,
          borderWidth: 0,
          pointRadius: 0,
          pointHoverRadius: 0,
          tension: 0.28,
          fill: {
            target: lineDatasetIndexes[index - 1],
          },
          order: 1,
          areaOverlay: true,
        });
      }
    });

    return datasets;
  }, [questComponentTrend, toSafePercentage]);

  const overallCategoryBar = useMemo(() => {
    const entries = Object.entries(categoriesData || {});
    if (entries.length === 0) {
      return { labels: [], values: [] };
    }

    const sorted = entries
      .map(([category, data]) => ({
        category,
        percentage: toSafePercentage(data?.percentage),
      }))
      .sort((a, b) => b.percentage - a.percentage)
      .slice(0, 6);

    return {
      labels: sorted.map((item) => item.category),
      values: sorted.map((item) => Number(item.percentage.toFixed(2))),
    };
  }, [categoriesData]);

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
      <Grid container spacing={3} sx={{ mb: 3, alignItems: 'stretch' }}>
        {/* Overall Summary */}
        <Grid item xs={12} md={6} sx={{ display: 'flex' }}>
          <Paper 
            elevation={0} 
            sx={{ 
              p: 4,
              flex: 1,
              backgroundColor: 'white',
              borderRadius: 3,
              border: '1px solid #e5e7eb',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)'
            }}
          >
            <Typography variant="h6" gutterBottom sx={{ color: '#1e3a8a', fontWeight: 600, mb: 3 }}>
              Overall Summary
            </Typography>
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 2,
                alignItems: 'stretch',
              }}
            >
              <Box sx={{ flex: '1 1 220px', minWidth: 0, p: 2, textAlign: 'center' }}>
                <Typography variant="body2" sx={{ color: '#6b7280', fontSize: '0.875rem', mb: 1 }}>Total Score</Typography>
                <Typography variant="h4" sx={{ color: '#1e3a8a', fontWeight: 600, mb: 0.5 }}>
                  {roundUpPoints(studentData.totalScore)}
                </Typography>
                <Typography variant="body2" sx={{ color: '#9ca3af' }}>
                  / {roundUpPoints(studentData.totalCapPoints ?? studentData.totalMaxPoints)}
                </Typography>
              </Box>

              <Box sx={{ flex: '1 1 220px', minWidth: 0, p: 2, textAlign: 'center' }}>
                <Typography variant="body2" sx={{ color: '#6b7280', fontSize: '0.875rem', mb: 1 }}>Progress</Typography>
                {renderProgressBattery(studentData.overallPercentage)}
              </Box>

              <Box sx={{ flex: '1 1 220px', minWidth: 0, p: 2, textAlign: 'center' }}>
                <Typography variant="body2" sx={{ color: '#6b7280', fontSize: '0.875rem', mb: 1 }}>Total Assignments</Typography>
                <Typography variant="h4" sx={{ color: '#1e3a8a', fontWeight: 600 }}>
                  {assignmentsList.length}
                </Typography>
              </Box>
            </Box>

            <Box sx={{ mt: 2.5, pt: 2.5, borderTop: '1px solid #e5e7eb' }}>
              <Typography variant="subtitle2" sx={{ color: '#4b5563', mb: 1.5, fontWeight: 600 }}>
                Category Completion Snapshot
              </Typography>
              <Box sx={{ height: 180, position: 'relative' }}>
                {overallCategoryBar.labels.length === 0 ? (
                  <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Typography sx={{ color: '#9ca3af', fontSize: '0.875rem' }}>No category data yet.</Typography>
                  </Box>
                ) : (
                  <ChartBar
                    data={{
                      labels: overallCategoryBar.labels,
                      datasets: [
                        {
                          label: 'Completion %',
                          data: overallCategoryBar.values,
                          backgroundColor: 'rgba(25, 118, 210, 0.22)',
                          borderColor: '#1976d2',
                          borderWidth: 1,
                          borderRadius: 6,
                        }
                      ]
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      scales: {
                        y: {
                          min: 0,
                          max: 100,
                          ticks: {
                            stepSize: 25,
                          },
                          grid: {
                            color: 'rgba(0, 0, 0, 0.08)',
                          },
                        },
                        x: {
                          grid: {
                            display: false,
                          },
                          ticks: {
                            maxRotation: 0,
                            minRotation: 0,
                          }
                        }
                      },
                      plugins: {
                        legend: {
                          display: false,
                        },
                        datalabels: {
                          display: false,
                        },
                        tooltip: {
                          callbacks: {
                            label: function(context) {
                              return `${Number(context.parsed.y || 0).toFixed(2)}%`;
                            }
                          }
                        }
                      }
                    }}
                  />
                )}
              </Box>
            </Box>
          </Paper>
        </Grid>

        {/* Performance by Category */}
        <Grid item xs={12} md={6} sx={{ display: 'flex' }}>
          <Paper 
            elevation={0} 
            sx={{ 
              p: 4,
              flex: 1,
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
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Object.entries(categoriesData).map(([category, data]) => {
                    return (
                      <TableRow key={category} hover>
                        <TableCell><strong>{category}</strong></TableCell>
                        <TableCell align="center">{roundUpPoints(data.total)}</TableCell>
                        <TableCell align="center">{roundUpPoints(data.capPoints ?? data.maxPoints)}</TableCell>
                        <TableCell align="center">{renderProgressBattery(data.percentage)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>
      </Grid>

      {/* Charts */}
      <Grid container spacing={3} sx={{ mb: 3, alignItems: 'stretch' }}>
        {/* Radar Chart */}
        <Grid item xs={12} md={6} sx={{ display: 'flex' }}>
          <Paper 
            elevation={0} 
            sx={{ 
              p: 3,
              flex: 1,
              backgroundColor: 'white',
              borderRadius: 3,
              border: '1px solid #e5e7eb',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)'
            }}
          >
            <Typography variant="h6" gutterBottom sx={{ color: '#1e3a8a', fontWeight: 600 }}>
              Category Performance Radar
            </Typography>
            <Box sx={{ height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Box sx={{ width: '100%', maxWidth: 420, aspectRatio: '1 / 1', position: 'relative' }}>
                <ChartRadar 
                  data={{
                    labels: radarData.map(d => d.category),
                    datasets: [
                      {
                        label: 'Score %',
                        data: radarData.map(d => d.percentage),
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
                          return radarData[context[0].dataIndex]?.category || '';
                        },
                        label: function(context) {
                          const dataIndex = context.dataIndex;
                          const data = radarData[dataIndex] || {};
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
            </Box>
          </Paper>
        </Grid>

        {/* Quest Progress Trend */}
        <Grid item xs={12} md={6} sx={{ display: 'flex' }}>
          <Paper 
            elevation={0} 
            sx={{ 
              p: 3,
              flex: 1,
              backgroundColor: 'white',
              borderRadius: 3,
              border: '1px solid #e5e7eb',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)'
            }}
          >
            <Typography variant="h6" gutterBottom sx={{ color: '#1e3a8a', fontWeight: 600 }}>
              Quest Progress Trend
            </Typography>
            <Box sx={{ height: 400, position: 'relative' }}>
              {questComponentTrend.components.length === 0 || questComponentTrend.series.length === 0 ? (
                <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Typography sx={{ color: '#6b7280' }}>Quest component progression is not available yet.</Typography>
                </Box>
              ) : (
              <ChartLine
                data={{
                  labels: questComponentTrend.components,
                  datasets: questTrendChartDatasets,
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
                      position: 'top',
                      labels: {
                        usePointStyle: true,
                        filter: (legendItem, chartData) => {
                          const dataset = chartData.datasets?.[legendItem.datasetIndex];
                          return !dataset?.areaOverlay;
                        }
                      }
                    },
                    datalabels: {
                      display: false  // Hide labels, show only on hover
                    },
                    tooltip: {
                      filter: (tooltipItem) => {
                        const dataset = tooltipItem?.dataset || {};
                        return !dataset.areaOverlay;
                      },
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
