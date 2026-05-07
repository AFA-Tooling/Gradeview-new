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
        ctx.strokeStyle = `rgba(0, 0, 0, ${isDimmed ? 0.08 : 0.22})`;
        ctx.stroke();

        // Inner rim highlight
        ctx.beginPath();
        ctx.arc(x, y, innerRadius + 1.5, startAngle, sheenEnd);
        ctx.lineWidth = 1;
        ctx.strokeStyle = `rgba(0, 0, 0, ${isDimmed ? 0.05 : 0.14})`;
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
        ctx.strokeStyle = `rgba(0, 0, 0, ${isDimmed ? 0.18 : 0.4})`;
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
  const rawAssignmentsList = Array.isArray(studentData?.rawAssignmentsList) ? studentData.rawAssignmentsList : assignmentsList;
  const categoriesData = studentData?.categoriesData && typeof studentData.categoriesData === 'object'
    ? studentData.categoriesData
    : {};
  const radarData = Array.isArray(studentData?.radarData) ? studentData.radarData : [];
  const trendData = Array.isArray(studentData?.rawTrendData)
    ? studentData.rawTrendData
    : (Array.isArray(studentData?.trendData) ? studentData.trendData : []);

  const displayCategoriesData = useMemo(() => (
    Object.fromEntries(
      Object.entries(categoriesData || {}).filter(([category, data]) => {
        const normalized = String(category || '').trim().toLowerCase();
        if (!normalized || normalized.startsWith('_')) return false;
        return Number(data?.capPoints ?? data?.maxPoints) > 0;
      })
    )
  ), [categoriesData]);

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

  const formatRawScore = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '-';
    return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2);
  };

  const currentGrade = useMemo(() => {
    const total = Number(studentData?.totalScore);
    const bins = Array.isArray(studentData?.gradeBins) ? studentData.gradeBins : [];
    if (!Number.isFinite(total) || bins.length === 0) {
      return null;
    }

    const roundedTotal = Math.round(total);
    const parsedBins = bins
      .map((bin) => {
        const range = String(bin?.range || '');
        const match = range.match(/(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)/);
        if (!match) return null;
        const low = Number(match[1]);
        const high = Number(match[2]);
        if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
        return {
          grade: String(bin?.grade || bin?.letter || ''),
          low: Math.min(low, high),
          high: Math.max(low, high),
          range,
        };
      })
      .filter((bin) => bin && bin.grade);

    const matched = parsedBins.find((bin) => roundedTotal >= bin.low && roundedTotal <= bin.high)
      || parsedBins[parsedBins.length - 1];

    return matched
      ? { ...matched, roundedTotal }
      : null;
  }, [studentData?.gradeBins, studentData?.totalScore]);

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
                backgroundColor: index < filledSegments ? '#E76E50' : 'rgba(0, 0, 0, 0.08)',
                border: '1px solid rgba(0, 0, 0, 0.12)'
              }}
            />
          ))}
        </Box>
        <Typography variant="body2" sx={{ color: 'rgba(0, 0, 0, 0.85)', fontWeight: 600, minWidth: 58, textAlign: 'left' }}>
          {safeValue.toFixed(2)}%
        </Typography>
      </Box>
    );
  };

  // Local state for sort mode (only affects line chart and detail table)
  const [sortMode, setSortMode] = useState('assignment');
  const [hoveredDonutCategory, setHoveredDonutCategory] = useState(null);

  const formatRadarAxisLabel = (label) => {
    const text = String(label || '').trim();
    if (text.length <= 16) return text;
    return text
      .replace(/\s*\/\s*/g, ' / ')
      .split(/\s+/)
      .reduce((lines, word) => {
        const current = lines[lines.length - 1] || '';
        if (!current) return [word];
        if ((current + ' ' + word).length <= 16) {
          lines[lines.length - 1] = `${current} ${word}`;
          return lines;
        }
        return [...lines, word];
      }, []);
  };

  // Sort the trend data for line chart based on sortMode
  const sortedTrendData = useMemo(() => {
    if (trendData.length === 0) return [];
    const data = [...trendData];
    
    if (sortMode === 'time') {
      return data.sort((a, b) => {
        if (!a.submissionTime) return 1;
        if (!b.submissionTime) return -1;
        return new Date(b.submissionTime) - new Date(a.submissionTime);
      });
    }

    return data.sort((a, b) => {
      const categoryCmp = String(a.category || '').localeCompare(String(b.category || ''), undefined, {
        numeric: true,
        sensitivity: 'base',
      });
      if (categoryCmp !== 0) return categoryCmp;
      return String(a.name || '').localeCompare(String(b.name || ''), undefined, {
        numeric: true,
        sensitivity: 'base',
      });
    });
  }, [trendData, sortMode]);

  // Sort the assignments list for detail table based on sortMode
  const sortedAssignments = useMemo(() => {
    if (rawAssignmentsList.length === 0) return [];
    const data = [...rawAssignmentsList];
    
    if (sortMode === 'time') {
      // Sort by submission time - newest first (descending)
      return data.sort((a, b) => {
        if (!a.submissionTime) return 1;
        if (!b.submissionTime) return -1;
        return new Date(b.submissionTime) - new Date(a.submissionTime);
      });
    }

    return data.sort((a, b) => {
      const categoryCmp = String(a.category || '').localeCompare(String(b.category || ''), undefined, {
        numeric: true,
        sensitivity: 'base',
      });
      if (categoryCmp !== 0) return categoryCmp;
      return String(a.name || '').localeCompare(String(b.name || ''), undefined, {
        numeric: true,
        sensitivity: 'base',
      });
    });
  }, [rawAssignmentsList, sortMode]);

  const examPolicyRows = Array.isArray(studentData?.examPolicyRows) ? studentData.examPolicyRows : [];

  const radarScaleOptions = {
    min: 0,
    max: 100,
    beginAtZero: true,
    ticks: {
      stepSize: 20,
      color: 'rgba(0, 0, 0, 0.75)',
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
      color: 'rgba(0, 0, 0, 0.12)',
      lineWidth: 1.4,
    },
    angleLines: {
      color: 'rgba(0, 0, 0, 0.12)',
      lineWidth: 1.2,
    },
    pointLabels: {
      display: true,
      color: 'rgba(0, 0, 0, 0.72)',
      padding: 14,
      callback: formatRadarAxisLabel,
      font: {
        size: 11,
        weight: 600,
      },
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
      { line: '#E76E50', point: '#C8553D', fill: 'rgba(231, 110, 80, 0.18)' },
      { line: '#2A9D90', point: '#1F7A70', fill: 'rgba(42, 157, 144, 0.18)' },
      { line: '#274754', point: '#1A323C', fill: 'rgba(39, 71, 84, 0.18)' },
    ];

    // Cumulative-best per category: each series shows max(self, all previous) per axis.
    let cumulativeBest = null;

    // Render outer (later, larger) polygons first so inner polygons stay visible.
    return questComponentTrend.series.map((seriesItem, index) => {
      const raw = questComponentTrend.components.map((_, pointIndex) => {
        const v = Array.isArray(seriesItem?.data) ? seriesItem.data[pointIndex] : 0;
        return toSafePercentage(v);
      });
      const data = cumulativeBest === null
        ? raw
        : raw.map((v, i) => Math.max(v, cumulativeBest[i] || 0));
      cumulativeBest = data;

      const c = palette[index] || palette[palette.length - 1];
      return {
        label: seriesItem?.name || `After Quest-${index + 1}`,
        data,
        borderColor: c.line,
        backgroundColor: c.fill,
        borderWidth: 2.5,
        pointRadius: 4,
        pointHoverRadius: 7,
        pointBackgroundColor: c.point,
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        order: questComponentTrend.series.length - index,
      };
    });
  }, [questComponentTrend, toSafePercentage]);

  const overallCategoryDonut = useMemo(() => {
    const entries = Object.entries(displayCategoriesData || {});
    if (entries.length === 0) {
      return { labels: [], values: [], segmentMeta: [], totalCap: 0 };
    }

    // rgb values used by the plugin for gradient / glow colours
    const palette = [
      { rgb: '231, 110, 80'  },  // coral
      { rgb: '42, 157, 144'  },  // teal
      { rgb: '39, 71, 84'    },  // slate
      { rgb: '232, 196, 104' },  // amber
      { rgb: '244, 164, 98'  },  // sand
      { rgb: '136, 132, 216' },  // muted violet
      { rgb: '130, 202, 157' },  // sage
      { rgb: '255, 198, 88'  },  // gold
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

    });

    return { labels, values, segmentMeta, totalCap };
  }, [displayCategoriesData]);

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
              p: 3,
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
            <Box sx={{ height: 340, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {overallCategoryDonut.values.length === 0 ? (
                  <Typography sx={{ color: '#9ca3af', fontSize: '0.875rem' }}>No category data yet.</Typography>
                ) : (
                  <>
                    <Box sx={{ width: { xs: 260, sm: 300 }, height: { xs: 260, sm: 300 }, position: 'relative' }}>
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
                              spacing: 0,
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
                      {currentGrade && (
                        <Box
                          sx={{
                            mt: 1.2,
                            px: 1.4,
                            py: 0.45,
                            borderRadius: 999,
                            border: '1px solid rgba(30, 58, 138, 0.16)',
                            backgroundColor: 'rgba(30, 58, 138, 0.06)',
                          }}
                        >
                          <Typography variant="caption" sx={{ color: '#1e3a8a', fontWeight: 700, letterSpacing: 0.3 }}>
                            Current {currentGrade.grade}
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  </>
                )}
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
                  {Object.entries(displayCategoriesData).map(([category, data]) => {
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
                        borderColor: '#E76E50',
                        backgroundColor: 'rgba(231, 110, 80, 0.20)',
                        borderWidth: 4,
                        pointRadius: 6,
                        pointHoverRadius: 10,
                        pointBackgroundColor: '#E76E50',
                        pointBorderColor: '#FFFFFF',
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
                      display: false,
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
              <ChartRadar
                data={{
                  labels: questComponentTrend.components,
                  datasets: questTrendChartDatasets,
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
                        showLabelBackdrop: false,
                        backdropColor: 'transparent',
                        color: 'rgba(0, 0, 0, 0.55)',
                        font: { size: 11 },
                        callback: (value) => `${value}%`,
                      },
                      grid: {
                        color: 'rgba(0, 0, 0, 0.10)',
                      },
                      angleLines: {
                        color: 'rgba(0, 0, 0, 0.10)',
                      },
                      pointLabels: {
                        color: 'rgba(0, 0, 0, 0.75)',
                        font: { size: 11, weight: 500 },
                      },
                    },
                  },
                  plugins: {
                    legend: {
                      display: true,
                      position: 'top',
                      labels: { usePointStyle: true },
                    },
                    datalabels: { display: false },
                    tooltip: {
                      callbacks: {
                        label: function (context) {
                          const pct = Number(context.parsed.r || 0);
                          const points = Math.min(25, roundUpPoints((pct / 100) * 25));
                          return `${context.dataset.label}: ${pct.toFixed(2)}% (${points}/25)`;
                        },
                      },
                    },
                  },
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
                    color: 'rgba(0, 0, 0, 0.75)',
                    border: '1px solid rgba(251, 191, 36, 0.45)',
                    '&.Mui-selected': {
                      backgroundColor: '#111111',
                      color: '#fff',
                      '&:hover': {
                        backgroundColor: '#000000',
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
                    borderColor: '#2A9D90',
                    backgroundColor: 'rgba(42, 157, 144, 0.12)',
                    borderWidth: 2,
                    pointRadius: 4,
                    pointBackgroundColor: '#2A9D90',
                    pointBorderColor: '#FFFFFF',
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
                        text: sortMode === 'time' ? 'Submission Order' : 'Assignment Order',
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
                          let label = `Raw: ${formatRawScore(data.score)} / ${formatRawScore(data.maxPoints)} (${data.percentage.toFixed(2)}%)`;
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
                    <TableCell align="center">{formatRawScore(assignment.score)}</TableCell>
                    <TableCell align="center">{formatRawScore(assignment.maxPoints)}</TableCell>
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
