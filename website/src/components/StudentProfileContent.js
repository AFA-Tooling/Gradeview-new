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
import { Line as ChartLine, Radar as ChartRadar, Doughnut as ChartDoughnut } from 'react-chartjs-2';
import ChartDataLabels from 'chartjs-plugin-datalabels';

const liquidGlassDonutPlugin = {
  id: 'liquidGlassDonut',
  afterDatasetsDraw(chart) {
    const dataset = chart?.data?.datasets?.[0];
    const segmentMeta = Array.isArray(dataset?.segmentMeta) ? dataset.segmentMeta : [];
    if (segmentMeta.length === 0) return;

    const meta = chart.getDatasetMeta(0);
    const arcs = meta?.data || [];
    if (arcs.length === 0) return;

    const ctx = chart.ctx;
    const hoveredCategory = dataset?.hoveredCategory ?? null;
    ctx.save();

    arcs.forEach((arc, i) => {
      const seg = segmentMeta[i];
      if (!seg || seg.type === 'gap') return;

      const { x, y } = arc;
      const outerRadius = arc.outerRadius;
      const innerRadius = arc.innerRadius;
      const startAngle = arc.startAngle;
      const endAngle = arc.endAngle;
      const arcSpan = endAngle - startAngle;

      const isHovered = hoveredCategory !== null && seg.category === hoveredCategory;
      const isDimmed = hoveredCategory !== null && seg.category !== hoveredCategory;
      const alphaScale = isDimmed ? 0.35 : isHovered ? 1.15 : 1.0;

      const earnedFraction = seg.cap > 0 ? Math.max(0, Math.min(1, seg.earned / seg.cap)) : 0;
      const earnedEndAngle = startAngle + arcSpan * earnedFraction;

      // ── 1. Remaining (light shell) ──────────────────────────────────────────
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, outerRadius, startAngle, endAngle);
      ctx.arc(x, y, innerRadius, endAngle, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = seg.remainingColor.replace(/,[^,]+\)$/, `, ${0.18 * alphaScale})`);
      ctx.fill();
      ctx.restore();

      // ── 2. Earned (saturated fill with radial gradient) ───────────────────
      if (earnedFraction > 0) {
        ctx.save();
        ctx.shadowColor = seg.glowColor;
        ctx.shadowBlur = isHovered ? 18 : 10;
        ctx.beginPath();
        ctx.arc(x, y, outerRadius, startAngle, earnedEndAngle);
        ctx.arc(x, y, innerRadius, earnedEndAngle, startAngle, true);
        ctx.closePath();

        const gradient = ctx.createRadialGradient(x, y, innerRadius, x, y, outerRadius);
        gradient.addColorStop(0, seg.earnedColorInner.replace(/,[^,]+\)$/, `, ${0.95 * Math.min(alphaScale, 1)})`) );
        gradient.addColorStop(1, seg.earnedColorOuter.replace(/,[^,]+\)$/, `, ${0.72 * Math.min(alphaScale, 1)})`) );
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.restore();
      }

      // ── 3. Specular highlight (glass sheen on top edge of earned arc) ─────
      if (earnedFraction > 0) {
        ctx.save();
        ctx.shadowBlur = 0;
        const sheenEnd = Math.min(earnedEndAngle, startAngle + arcSpan * Math.min(earnedFraction, 0.38));
        ctx.beginPath();
        ctx.arc(x, y, outerRadius - 1.5, startAngle, sheenEnd);
        ctx.lineWidth = isHovered ? 2.5 : 1.8;
        ctx.strokeStyle = `rgba(255, 255, 255, ${isDimmed ? 0.18 : 0.52})`;
        ctx.stroke();

        // Inner rim highlight
        ctx.beginPath();
        ctx.arc(x, y, innerRadius + 1.5, startAngle, sheenEnd);
        ctx.lineWidth = 1;
        ctx.strokeStyle = `rgba(255, 255, 255, ${isDimmed ? 0.1 : 0.28})`;
        ctx.stroke();
        ctx.restore();
      }

      // ── 4. Earned / remaining boundary notch ─────────────────────────────
      if (earnedFraction > 0 && earnedFraction < 1) {
        ctx.save();
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.moveTo(
          x + Math.cos(earnedEndAngle) * (innerRadius - 1),
          y + Math.sin(earnedEndAngle) * (innerRadius - 1)
        );
        ctx.lineTo(
          x + Math.cos(earnedEndAngle) * (outerRadius + 1),
          y + Math.sin(earnedEndAngle) * (outerRadius + 1)
        );
        ctx.lineWidth = isDimmed ? 1.5 : 2.5;
        ctx.strokeStyle = `rgba(255, 255, 255, ${isDimmed ? 0.35 : 0.72})`;
        ctx.stroke();
        ctx.restore();
      }

      // ── 5. Outer border ring of entire segment ────────────────────────────
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(x, y, outerRadius, startAngle, endAngle);
      ctx.arc(x, y, innerRadius, endAngle, startAngle, true);
      ctx.closePath();
      ctx.lineWidth = isDimmed ? 1 : 1.8;
      ctx.strokeStyle = seg.outlineColor.replace(/,[^,]+\)$/, `, ${isDimmed ? 0.2 : isHovered ? 0.85 : 0.55})`);
      ctx.stroke();
      ctx.restore();
    });

    ctx.restore();
  },
};

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
  ChartLegend,
  liquidGlassDonutPlugin
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
                backgroundColor: index < filledSegments ? '#f59e0b' : 'rgba(226, 232, 240, 0.28)',
                border: '1px solid rgba(196, 210, 238, 0.26)'
              }}
            />
          ))}
        </Box>
        <Typography variant="body2" sx={{ color: 'rgba(231, 241, 255, 0.94)', fontWeight: 600, minWidth: 58, textAlign: 'left' }}>
          {safeValue.toFixed(2)}%
        </Typography>
      </Box>
    );
  };

  // Local state for sort mode (only affects line chart and detail table)
  const [sortMode, setSortMode] = useState('assignment');
  const [hoveredDonutCategory, setHoveredDonutCategory] = useState(null);

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

  const radarScaleOptions = {
    min: 0,
    max: 100,
    beginAtZero: true,
    ticks: {
      stepSize: 20,
      color: 'rgba(214, 228, 255, 0.9)',
      showLabelBackdrop: false,
      backdropColor: 'transparent',
      font: {
        size: 13,
        weight: 600,
      },
      callback: function(value) {
        return value + '%';
      }
    },
    grid: {
      color: 'rgba(176, 197, 240, 0.3)',
      lineWidth: 1.4,
    },
    angleLines: {
      color: 'rgba(176, 197, 240, 0.28)',
      lineWidth: 1.2,
    },
    pointLabels: {
      display: false,
    }
  };

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
        line: '#f59e0b',
        point: '#d97706',
        baseArea: 'rgba(245, 158, 11, 0.10)',
        diffArea: 'rgba(245, 158, 11, 0.14)',
      },
      {
        line: '#10b981',
        point: '#059669',
        baseArea: 'rgba(16, 185, 129, 0.08)',
        diffArea: 'rgba(16, 185, 129, 0.16)',
      },
      {
        line: '#ef4444',
        point: '#dc2626',
        baseArea: 'rgba(239, 68, 68, 0.08)',
        diffArea: 'rgba(239, 68, 68, 0.16)',
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

  const overallCategoryDonut = useMemo(() => {
    const entries = Object.entries(categoriesData || {});
    if (entries.length === 0) {
      return { labels: [], values: [], segmentMeta: [], totalCap: 0 };
    }

    // rgb values used by the plugin for gradient / glow colours
    const palette = [
      { rgb: '37, 99, 235'   },  // blue
      { rgb: '217, 119, 6'  },  // amber
      { rgb: '5, 150, 105'  },  // emerald
      { rgb: '124, 58, 237' },  // violet
      { rgb: '220, 38, 38'  },  // red
      { rgb: '8, 145, 178'  },  // cyan
      { rgb: '79, 70, 229'  },  // indigo
      { rgb: '180, 83, 9'   },  // orange
    ];

    const values = [];
    const labels = [];
    const segmentMeta = [];
    let totalCap = 0;

    const validEntries = entries.filter(
      ([, data]) => Math.max(0, Number(data?.capPoints ?? data?.maxPoints ?? 0)) > 0
    );
    const sumCap = validEntries.reduce(
      (s, [, data]) => s + Math.max(0, Number(data?.capPoints ?? data?.maxPoints ?? 0)), 0
    );
    // Small gap proportional to total cap so it looks consistent regardless of scale
    const gapValue = Math.max(0.12, sumCap * 0.008);

    validEntries.forEach(([category, data], index) => {
      const cap     = Math.max(0, Number(data?.capPoints ?? data?.maxPoints ?? 0));
      const earned  = Math.max(0, Math.min(cap, Number(data?.total ?? 0)));
      const selected = palette[index % palette.length];

      if (cap <= 0) return;

      // ONE segment per category – size = cap (full arc represents max points)
      values.push(cap);
      labels.push(category);
      segmentMeta.push({
        category,
        cap,
        earned,
        remaining: Math.max(0, cap - earned),
        type: 'category',
        earnedFraction: cap > 0 ? earned / cap : 0,
        // colours used by liquidGlassDonutPlugin
        earnedColorInner: `rgba(${selected.rgb}, 0.95)`,
        earnedColorOuter:  `rgba(${selected.rgb}, 0.70)`,
        remainingColor:    `rgba(${selected.rgb}, 0.18)`,
        glowColor:         `rgba(${selected.rgb}, 0.75)`,
        outlineColor:      `rgba(${selected.rgb}, 0.60)`,
      });

      totalCap += cap;

      const isLast = index === validEntries.length - 1;
      if (!isLast) {
        values.push(gapValue);
        labels.push(`${category}-gap`);
        segmentMeta.push({ category: null, type: 'gap' });
      }
    });

    return { labels, values, segmentMeta, totalCap };
  }, [categoriesData]);

  const donutAppearance = useMemo(() => {
    // The liquidGlassDonutPlugin handles all visual rendering.
    // Chart.js base layer uses transparent fills so only hit-testing geometry is active.
    const backgroundColor = overallCategoryDonut.segmentMeta.map((segment) =>
      segment.type === 'gap' ? 'rgba(0, 0, 0, 0)' : 'rgba(0, 0, 0, 0)'
    );
    const borderColor   = overallCategoryDonut.segmentMeta.map(() => 'rgba(0, 0, 0, 0)');
    const borderWidth   = overallCategoryDonut.segmentMeta.map(() => 0);
    return { backgroundColor, borderColor, borderWidth };
  }, [overallCategoryDonut.segmentMeta]);

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
        <Grid item xs={12} md={6} sx={{ display: 'flex', minWidth: 0 }}>
          <Paper 
            elevation={0} 
            sx={{ 
              p: 4,
              flex: 1,
              minWidth: 0,
              backgroundColor: 'white',
              borderRadius: 3,
              border: '1px solid #e5e7eb',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)'
            }}
          >
            <Typography variant="h6" gutterBottom sx={{ color: '#1e3a8a', fontWeight: 600, mb: 3 }}>
              Overall Summary
            </Typography>
            <Box sx={{ height: 380, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
              <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {overallCategoryDonut.values.length === 0 ? (
                  <Typography sx={{ color: '#9ca3af', fontSize: '0.875rem' }}>No category data yet.</Typography>
                ) : (
                  <>
                    <Box sx={{ width: 260, height: 260, position: 'relative' }}>
                      <ChartDoughnut
                        data={{
                          labels: overallCategoryDonut.labels,
                          datasets: [
                            {
                              data: overallCategoryDonut.values,
                              backgroundColor: donutAppearance.backgroundColor,
                              borderColor: donutAppearance.borderColor,
                              borderWidth: donutAppearance.borderWidth,
                              hoverOffset: 0,
                              spacing: 4,
                              // Custom props read by liquidGlassDonutPlugin
                              segmentMeta: overallCategoryDonut.segmentMeta,
                              hoveredCategory: hoveredDonutCategory,
                            }
                          ]
                        }}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          cutout: '68%',
                          animation: { duration: 600 },
                          onHover: (_event, elements) => {
                            if (!elements || elements.length === 0) {
                              setHoveredDonutCategory(null);
                              return;
                            }
                            const hoverIndex = elements[0].index;
                            const hoveredSeg = overallCategoryDonut.segmentMeta[hoverIndex];
                            if (!hoveredSeg || hoveredSeg.type === 'gap') {
                              setHoveredDonutCategory(null);
                              return;
                            }
                            setHoveredDonutCategory(hoveredSeg.category);
                          },
                          plugins: {
                            legend:     { display: false },
                            datalabels: { display: false },
                            tooltip: {
                              filter: function(context) {
                                const idx  = context?.dataIndex ?? -1;
                                const meta = overallCategoryDonut.segmentMeta[idx];
                                return meta?.type === 'category';
                              },
                              callbacks: {
                                title: function(context) {
                                  const idx  = context?.[0]?.dataIndex ?? -1;
                                  const meta = overallCategoryDonut.segmentMeta[idx];
                                  return meta?.category || '';
                                },
                                label: function(context) {
                                  const idx  = context?.dataIndex ?? -1;
                                  const meta = overallCategoryDonut.segmentMeta[idx];
                                  if (!meta) return '';
                                  const pct = meta.cap > 0 ? (meta.earned / meta.cap) * 100 : 0;
                                  return [
                                    `Earned : ${Math.round(meta.earned)} / ${Math.round(meta.cap)}`,
                                    `Score  : ${pct.toFixed(2)}%`,
                                  ];
                                },
                              },
                            },
                          },
                        }}
                      />
                    </Box>

                    <Box
                      sx={{
                        position: 'absolute',
                        left: '50%',
                        top: '50%',
                        transform: 'translate(-50%, -50%)',
                        textAlign: 'center',
                        pointerEvents: 'none',
                      }}
                    >
                      <Typography variant="caption" sx={{ color: '#6b7280', letterSpacing: 0.5 }}>
                        TOTAL
                      </Typography>
                      <Typography variant="h5" sx={{ color: '#1e3a8a', fontWeight: 700, lineHeight: 1.2 }}>
                        {roundUpPoints(studentData.totalScore)}
                      </Typography>
                      <Typography variant="body2" sx={{ color: '#9ca3af' }}>
                        / {roundUpPoints(overallCategoryDonut.totalCap || (studentData.totalCapPoints ?? studentData.totalMaxPoints))}
                      </Typography>
                    </Box>
                  </>
                )}
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Box sx={{ width: '100%', maxWidth: 320, aspectRatio: '1 / 1', position: 'relative' }}>
                  <ChartRadar
                    data={{
                      labels: radarData.map(d => d.category),
                      datasets: [
                        {
                          label: 'Score %',
                          data: radarData.map(d => d.percentage),
                          borderColor: '#f59e0b',
                          backgroundColor: 'rgba(245, 158, 11, 0.30)',
                          borderWidth: 4,
                          pointRadius: 5,
                          pointHoverRadius: 8,
                          pointBackgroundColor: '#f59e0b',
                          pointBorderColor: '#0b1022',
                          pointBorderWidth: 2,
                        }
                      ]
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      scales: {
                        r: radarScaleOptions
                      },
                      plugins: {
                        legend: {
                          position: 'bottom',
                          labels: {
                            usePointStyle: true,
                            color: 'rgba(231, 241, 255, 0.92)',
                          }
                        },
                        datalabels: {
                          display: false
                        },
                        tooltip: {
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
                        }
                      }
                    }}
                  />
                </Box>
              </Box>
            </Box>

          </Paper>
        </Grid>

        {/* Performance by Category */}
        <Grid item xs={12} md={6} sx={{ display: 'flex', minWidth: 0 }}>
          <Paper 
            elevation={0} 
            sx={{ 
              p: 4,
              flex: 1,
              minWidth: 0,
              backgroundColor: 'white',
              borderRadius: 3,
              border: '1px solid #e5e7eb',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)'
            }}
          >
            <Typography variant="h6" gutterBottom sx={{ color: '#1e3a8a', fontWeight: 600, mb: 3 }}>
              Performance by Category
            </Typography>
            <TableContainer sx={{ mt: 2, borderRadius: 2, overflowX: 'auto', overflowY: 'hidden' }}>
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
        <Grid item xs={12} md={6} sx={{ display: 'flex', minWidth: 0 }}>
          <Paper 
            elevation={0} 
            sx={{ 
              p: 3,
              flex: 1,
              minWidth: 0,
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
                        borderColor: '#f59e0b',
                        backgroundColor: 'rgba(245, 158, 11, 0.34)',
                        borderWidth: 4,
                        pointRadius: 6,
                        pointHoverRadius: 10,
                        pointBackgroundColor: '#f59e0b',
                        pointBorderColor: '#0b1022',
                        pointBorderWidth: 2,
                      }
                    ]
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                  scales: {
                    r: radarScaleOptions
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
                        color: 'rgba(231, 241, 255, 0.92)',
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
                      display: false
                    }
                    }
                  }}
                />
              </Box>
            </Box>
          </Paper>
        </Grid>

        {/* Quest Progress Trend */}
        <Grid item xs={12} md={6} sx={{ display: 'flex', minWidth: 0 }}>
          <Paper 
            elevation={0} 
            sx={{ 
              p: 3,
              flex: 1,
              minWidth: 0,
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
                    color: '#fbbf24',
                    border: '1px solid rgba(251, 191, 36, 0.45)',
                    '&.Mui-selected': {
                      backgroundColor: '#d97706',
                      color: '#fff',
                      '&:hover': {
                        backgroundColor: '#b45309',
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
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.14)',
                    borderWidth: 2,
                    pointRadius: 4,
                    pointBackgroundColor: '#f59e0b',
                    pointBorderColor: '#0b1022',
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
        <TableContainer sx={{ mt: 2, borderRadius: 2, overflowX: 'auto', overflowY: 'visible' }}>
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
