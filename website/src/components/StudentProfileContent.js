// src/components/StudentProfileContent.js
import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
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
  Chip,
  Stack,
} from '@mui/material';
import StudentCategoryBlocks from './StudentCategoryBlocks';
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

const chartColors = {
  ink: '#111827',
  muted: '#6B7280',
  softText: '#9CA3AF',
  border: '#E5E7EB',
  grid: '#E9EBEF',
  gridStrong: '#DFE3EA',
  surface: '#FFFFFF',
  band: '#F9FAFB',
  blue: '#4788B8',
  blueDark: '#2F6F9E',
  purple: '#8B6FF6',
  orange: '#F59E0B',
  teal: '#1E9A8A',
  rose: '#F43F5E',
};

const cardSx = {
  backgroundColor: chartColors.surface,
  borderRadius: 2,
  border: `1px solid ${chartColors.border}`,
  boxShadow: 'none',
};

const headingSx = {
  color: chartColors.ink,
  fontWeight: 700,
  letterSpacing: 0,
};

const blackTooltip = {
  backgroundColor: '#111111',
  titleColor: '#FFFFFF',
  bodyColor: '#FFFFFF',
  borderWidth: 0,
  cornerRadius: 6,
  padding: 10,
  displayColors: true,
};

const dashedGrid = {
  color: chartColors.grid,
  borderDash: [4, 4],
  lineWidth: 1,
};

const weightedSectorDonutPlugin = {
  id: 'weightedSectorDonut',
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
      const midRadius = (outerRadius + innerRadius) / 2;
      const separatorAngle = Math.min(0.018, Math.max(0.004, 2.2 / Math.max(midRadius, 1)), arcSpan * 0.18);
      const drawStartAngle = startAngle + separatorAngle;
      const drawEndAngle = endAngle - separatorAngle;
      const drawSpan = Math.max(0, drawEndAngle - drawStartAngle);

      const isHovered = hoveredCategory !== null && seg.category === hoveredCategory;
      const isDimmed = hoveredCategory !== null && seg.category !== hoveredCategory;
      const alphaScale = isDimmed ? 0.32 : 1.0;

      const earnedFraction = seg.cap > 0 ? Math.max(0, Math.min(1, seg.earned / seg.cap)) : 0;
      const earnedEndAngle = drawStartAngle + drawSpan * earnedFraction;

      if (drawSpan <= 0) return;

      ctx.save();
      ctx.globalAlpha = alphaScale;
      ctx.beginPath();
      ctx.arc(x, y, outerRadius, drawStartAngle, drawEndAngle);
      ctx.arc(x, y, innerRadius, drawEndAngle, drawStartAngle, true);
      ctx.closePath();
      ctx.fillStyle = seg.remainingColor;
      ctx.fill();
      ctx.restore();

      if (earnedFraction > 0) {
        ctx.save();
        ctx.globalAlpha = alphaScale;
        ctx.beginPath();
        ctx.arc(x, y, outerRadius, drawStartAngle, earnedEndAngle);
        ctx.arc(x, y, innerRadius, earnedEndAngle, drawStartAngle, true);
        ctx.closePath();
        ctx.fillStyle = seg.earnedColor;
        ctx.fill();
        ctx.restore();
      }

      if (earnedFraction > 0 && earnedFraction < 1) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(
          x + Math.cos(earnedEndAngle) * innerRadius,
          y + Math.sin(earnedEndAngle) * innerRadius
        );
        ctx.lineTo(
          x + Math.cos(earnedEndAngle) * outerRadius,
          y + Math.sin(earnedEndAngle) * outerRadius
        );
        ctx.lineWidth = isHovered ? 2 : 1.25;
        ctx.strokeStyle = '#FFFFFF';
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, outerRadius, drawStartAngle, drawEndAngle);
      ctx.arc(x, y, innerRadius, drawEndAngle, drawStartAngle, true);
      ctx.closePath();
      ctx.lineWidth = isHovered ? 1.5 : 1;
      ctx.strokeStyle = isHovered ? seg.outlineColorStrong : seg.outlineColor;
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
  weightedSectorDonutPlugin
);

const DEFAULT_BATTERY_SEGMENTS = Array.from({ length: 10 }, (_, index) => index);

function formatPolicyPoints(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0';
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2);
}

function toSafePercentage(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, numeric));
}

function formatRawScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '-';
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2);
}

function formatDate(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  if (!Number.isFinite(date.getTime())) return '-';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getSubmissionTimestamp(dateString) {
  if (!dateString) return Number.NEGATIVE_INFINITY;
  const timestamp = new Date(dateString).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function formatRadarAxisLabel(label) {
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
}

function createRadarScaleOptions({ pointLabelPadding = 14 } = {}) {
  const pointLabels = {
    display: true,
    color: chartColors.muted,
    callback: formatRadarAxisLabel,
    font: {
      size: 11,
      weight: 600,
    },
  };

  if (pointLabelPadding != null) {
    pointLabels.padding = pointLabelPadding;
  }

  return {
    min: 0,
    max: 100,
    beginAtZero: true,
    ticks: {
      stepSize: 20,
      color: chartColors.muted,
      showLabelBackdrop: false,
      backdropColor: 'transparent',
      font: {
        size: 11,
        weight: 600,
      },
      callback: (value) => `${value}%`,
    },
    grid: {
      ...dashedGrid,
    },
    angleLines: {
      color: chartColors.gridStrong,
      borderDash: [4, 4],
      lineWidth: 1,
    },
    pointLabels,
  };
}

function createExamTrendOptions(trend, fallbackCap) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    scales: {
      r: createRadarScaleOptions({ pointLabelPadding: null }),
    },
    plugins: {
      legend: {
        display: true,
        position: 'top',
        labels: {
          usePointStyle: true,
          boxWidth: 8,
          boxHeight: 8,
          color: chartColors.muted,
          font: { size: 12, weight: 600 },
        },
      },
      datalabels: { display: false },
      tooltip: {
        ...blackTooltip,
        callbacks: {
          label: function (context) {
            const pct = Number(context.parsed.r || 0);
            const topicCap = Number(trend.componentCaps?.[context.dataIndex]);
            const cap = Number.isFinite(topicCap) && topicCap > 0 ? topicCap : fallbackCap;
            const points = Math.min(cap, (pct / 100) * cap);
            return `${context.dataset.label}: ${pct.toFixed(2)}% (${formatPolicyPoints(points)}/${formatPolicyPoints(cap)})`;
          },
        },
      },
    },
  };
}

const ProgressBattery = memo(function ProgressBattery({ value, segmentCount = 10 }) {
  const safeValue = toSafePercentage(value);
  const filledSegments = Math.round((safeValue / 100) * segmentCount);
  const segmentIndexes = segmentCount === 10
    ? DEFAULT_BATTERY_SEGMENTS
    : Array.from({ length: segmentCount }, (_, index) => index);

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
        {segmentIndexes.map((index) => (
          <Box
            key={index}
            sx={{
              width: 10,
              height: 16,
              borderRadius: '2px',
              backgroundColor: index < filledSegments ? chartColors.blue : '#EEF0F4',
              border: `1px solid ${index < filledSegments ? chartColors.blue : chartColors.border}`,
            }}
          />
        ))}
      </Box>
      <Typography variant="body2" sx={{ color: chartColors.ink, fontWeight: 650, minWidth: 58, textAlign: 'left' }}>
        {safeValue.toFixed(2)}%
      </Typography>
    </Box>
  );
});

/**
 * Shared Student Profile Content Component
 * Used by both the dialog version and the page version
 */
function StudentProfileContent({ studentData, hideTopSnapshot = false }) {
  const hasStudentData = Boolean(studentData);

  const assignmentsList = Array.isArray(studentData?.assignmentsList) ? studentData.assignmentsList : [];
  const rawAssignmentsList = Array.isArray(studentData?.rawAssignmentsList) ? studentData.rawAssignmentsList : assignmentsList;
  const categoryBlocks = Array.isArray(studentData?.categoryBlocks) ? studentData.categoryBlocks : [];
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

  const currentGrade = useMemo(() => {
    const canonicalGrade = studentData?.canonicalGrade;
    if (!canonicalGrade?.letter) {
      return null;
    }
    return {
      grade: canonicalGrade.letter,
      range: canonicalGrade.bin?.range || '',
      low: canonicalGrade.bin?.minScore ?? null,
      high: canonicalGrade.bin?.maxScore ?? null,
      roundedTotal: canonicalGrade.displayScore,
    };
  }, [studentData?.canonicalGrade]);

  const categorySnapshot = useMemo(() => {
    const get = (categoryName) => {
      const category = displayCategoriesData?.[categoryName];
      const score = Number(category?.total);
      const cap = Number(category?.capPoints ?? category?.maxPoints);
      if (!Number.isFinite(score) || !Number.isFinite(cap) || cap <= 0) {
        return null;
      }
      const clampedScore = Math.max(0, Math.min(score, cap));
      return {
        score: clampedScore,
        cap,
        percentage: (clampedScore / cap) * 100,
      };
    };

    return {
      Quest: get('Quest'),
      Midterm: get('Midterm'),
      Postterm: get('Postterm'),
      Attendance: get('Attendance / Participation'),
      Labs: get('Labs'),
      Projects: get('Projects'),
    };
  }, [displayCategoriesData]);

  const hoveredDonutCategoryRef = useRef(null);

  // Score trend is always chronological by submission time.
  const sortedTrendData = useMemo(() => {
    if (trendData.length === 0) return [];
    return trendData
      .map((item, index) => ({
        item,
        index,
        timestamp: getSubmissionTimestamp(item.submissionTime),
      }))
      .sort((a, b) => (a.timestamp - b.timestamp) || (a.index - b.index))
      .map(({ item }) => item);
  }, [trendData]);

  // Keep the detail table in the same chronological order as the trend.
  const sortedAssignments = useMemo(() => {
    if (rawAssignmentsList.length === 0) return [];
    return rawAssignmentsList
      .map((assignment, index) => ({
        item: {
          ...assignment,
          formattedSubmissionTime: formatDate(assignment.submissionTime),
        },
        index,
        timestamp: getSubmissionTimestamp(assignment.submissionTime),
      }))
      .sort((a, b) => (a.timestamp - b.timestamp) || (a.index - b.index))
      .map(({ item }) => item);
  }, [rawAssignmentsList]);

  const examComponentTrends = useMemo(() => {
    const trends = studentData?.examComponentTrends || {};
    const normalizeTrend = (trend) => ({
      components: Array.isArray(trend?.components) ? trend.components : [],
      componentCaps: Array.isArray(trend?.componentCaps) ? trend.componentCaps : [],
      series: Array.isArray(trend?.series) ? trend.series : [],
    });
    return {
      quest: normalizeTrend(trends.quest || studentData?.questComponentTrend),
      midterm: normalizeTrend(trends.midterm),
      postterm: normalizeTrend(trends.postterm),
    };
  }, [studentData?.examComponentTrends, studentData?.questComponentTrend]);

  const examTrendCards = useMemo(() => {
    const palette = [
      { line: '#B8A9FF', point: '#8B6FF6', fill: 'rgba(139, 111, 246, 0.13)', inner: 'rgba(139, 111, 246, 0.20)', outer: 'rgba(139, 111, 246, 0.04)' },
      { line: '#7F8CFF', point: '#5D6BF0', fill: 'rgba(93, 107, 240, 0.15)', inner: 'rgba(93, 107, 240, 0.24)', outer: 'rgba(93, 107, 240, 0.05)' },
      { line: chartColors.blue, point: chartColors.blueDark, fill: 'rgba(71, 136, 184, 0.18)', inner: 'rgba(71, 136, 184, 0.28)', outer: 'rgba(71, 136, 184, 0.06)' },
      { line: chartColors.orange, point: '#D97706', fill: 'rgba(245, 158, 11, 0.13)', inner: 'rgba(245, 158, 11, 0.20)', outer: 'rgba(245, 158, 11, 0.04)' },
      { line: chartColors.teal, point: '#0F766E', fill: 'rgba(30, 154, 138, 0.13)', inner: 'rgba(30, 154, 138, 0.20)', outer: 'rgba(30, 154, 138, 0.04)' },
    ];

    const buildDatasets = (trend, fallbackLabel) => {
      if (trend.components.length === 0 || trend.series.length === 0) {
        return [];
      }
      return trend.series.map((seriesItem, index) => {
        const data = trend.components.map((_, pointIndex) => {
          const v = Array.isArray(seriesItem?.data) ? seriesItem.data[pointIndex] : 0;
          return toSafePercentage(v);
        });
        const c = palette[index] || palette[palette.length - 1];
        return {
          label: seriesItem?.name || `${fallbackLabel} ${index + 1}`,
          data,
          borderColor: c.line,
          backgroundColor: c.fill,
          borderWidth: index === trend.series.length - 1 ? 2.5 : 1.8,
          pointRadius: index === trend.series.length - 1 ? 4 : 3,
          pointHoverRadius: 6,
          pointBackgroundColor: c.point,
          pointBorderColor: '#fff',
          pointBorderWidth: 1.5,
          order: trend.series.length - index,
        };
      });
    };

    return [
      { key: 'quest', title: 'Quest Topic Mastery', category: 'Quest', cap: 25, empty: 'Quest topic progression is not available yet.' },
      { key: 'midterm', title: 'Midterm Topic Diagnosis', category: 'Midterm', cap: 50, empty: 'Midterm topic progression is not available yet.' },
      { key: 'postterm', title: 'Postterm Topic Diagnosis', category: 'Postterm', cap: 75, empty: 'Postterm topic progression is not available yet.' },
    ].map((config) => {
      const trend = examComponentTrends[config.key] || { components: [], series: [] };
      const lastSeries = trend.series?.[trend.series.length - 1] || {};
      const topicScore = (trend.components || []).reduce((sum, _component, index) => {
        const pct = toSafePercentage(Array.isArray(lastSeries.data) ? lastSeries.data[index] : 0);
        const cap = Number(trend.componentCaps?.[index]);
        return sum + (Number.isFinite(cap) && cap > 0 ? (pct / 100) * cap : 0);
      }, 0);
      const topicCap = (trend.componentCaps || []).reduce(
        (sum, cap) => sum + (Number.isFinite(Number(cap)) ? Number(cap) : 0),
        0,
      );
      const datasets = buildDatasets(trend, config.title);
      return {
        ...config,
        trend,
        topicScore,
        topicCap,
        finalSnapshot: categorySnapshot[config.category],
        datasets,
        chartData: {
          labels: trend.components,
          datasets,
        },
        chartOptions: createExamTrendOptions(trend, config.cap),
      };
    });
  }, [categorySnapshot, examComponentTrends]);

  const overallCategoryDonut = useMemo(() => {
    const entries = Object.entries(displayCategoriesData || {});
    if (entries.length === 0) {
      return { labels: [], values: [], segmentMeta: [], totalCap: 0 };
    }

    const palette = [
      { earned: '#2563EB', outline: '#BFD3F8', outlineStrong: '#2563EB' },
      { earned: '#0F766E', outline: '#B8DED8', outlineStrong: '#0F766E' },
      { earned: '#D97706', outline: '#F2D9A7', outlineStrong: '#B45309' },
      { earned: '#16A34A', outline: '#B8E4C5', outlineStrong: '#15803D' },
      { earned: '#E11D48', outline: '#F1C4CE', outlineStrong: '#BE123C' },
      { earned: '#475569', outline: '#CBD5E1', outlineStrong: '#334155' },
      { earned: '#0284C7', outline: '#BAE6FD', outlineStrong: '#0369A1' },
      { earned: '#7C3AED', outline: '#DDD6FE', outlineStrong: '#6D28D9' },
    ];

    const values = [];
    const labels = [];
    const segmentMeta = [];

    const validEntries = entries.filter(
      ([, data]) => Math.max(0, Number(data?.capPoints ?? data?.maxPoints ?? 0)) > 0
    );
    const totalCap = validEntries.reduce((sum, [, data]) => (
      sum + Math.max(0, Number(data?.capPoints ?? data?.maxPoints ?? 0))
    ), 0);

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
        weightPercentage: totalCap > 0 ? (cap / totalCap) * 100 : 0,
        earnedColor: selected.earned,
        remainingColor: '#F1F3F5',
        outlineColor: selected.outline,
        outlineColorStrong: selected.outlineStrong,
      });
    });

    return { labels, values, segmentMeta, totalCap };
  }, [displayCategoriesData]);

  const donutAppearance = useMemo(() => {
    // The weightedSectorDonutPlugin handles all visual rendering.
    // Chart.js base layer uses transparent fills so only hit-testing geometry is active.
    const backgroundColor = overallCategoryDonut.segmentMeta.map((segment) =>
      segment.type === 'gap' ? 'rgba(0, 0, 0, 0)' : 'rgba(0, 0, 0, 0)'
    );
    const borderColor   = overallCategoryDonut.segmentMeta.map(() => 'rgba(0, 0, 0, 0)');
    const borderWidth   = overallCategoryDonut.segmentMeta.map(() => 0);
    return { backgroundColor, borderColor, borderWidth };
  }, [overallCategoryDonut.segmentMeta]);

  useEffect(() => {
    hoveredDonutCategoryRef.current = null;
  }, [overallCategoryDonut.segmentMeta]);

  const handleDonutHover = useCallback((_event, elements, chart) => {
    const hoverIndex = elements?.[0]?.index;
    const hoveredSeg = Number.isInteger(hoverIndex)
      ? overallCategoryDonut.segmentMeta[hoverIndex]
      : null;
    const nextCategory = hoveredSeg && hoveredSeg.type !== 'gap' ? hoveredSeg.category : null;

    if (hoveredDonutCategoryRef.current === nextCategory) return;
    hoveredDonutCategoryRef.current = nextCategory;

    const dataset = chart?.data?.datasets?.[0];
    if (dataset) dataset.hoveredCategory = nextCategory;
    chart?.draw();
  }, [overallCategoryDonut.segmentMeta]);

  const overallDonutData = useMemo(() => ({
    labels: overallCategoryDonut.labels,
    datasets: [
      {
        data: overallCategoryDonut.values,
        backgroundColor: donutAppearance.backgroundColor,
        borderColor: donutAppearance.borderColor,
        borderWidth: donutAppearance.borderWidth,
        hoverOffset: 0,
        spacing: 0,
        segmentMeta: overallCategoryDonut.segmentMeta,
        hoveredCategory: null,
      },
    ],
  }), [donutAppearance, overallCategoryDonut]);

  const overallDonutOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    cutout: '68%',
    animation: false,
    onHover: handleDonutHover,
    plugins: {
      legend: { display: false },
      datalabels: { display: false },
      tooltip: {
        ...blackTooltip,
        filter: function(context) {
          const idx = context?.dataIndex ?? -1;
          const meta = overallCategoryDonut.segmentMeta[idx];
          return meta?.type === 'category';
        },
        callbacks: {
          title: function(context) {
            const idx = context?.[0]?.dataIndex ?? -1;
            const meta = overallCategoryDonut.segmentMeta[idx];
            return meta?.category || '';
          },
          label: function(context) {
            const idx = context?.dataIndex ?? -1;
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
  }), [handleDonutHover, overallCategoryDonut.segmentMeta]);

  const categoryRadarData = useMemo(() => ({
    labels: radarData.map((d) => d.category),
    datasets: [
      {
        label: 'Score %',
        data: radarData.map((d) => d.percentage),
        borderColor: chartColors.blue,
        backgroundColor: 'rgba(71, 136, 184, 0.15)',
        borderWidth: 2.5,
        pointRadius: 4,
        pointHoverRadius: 7,
        pointBackgroundColor: chartColors.blueDark,
        pointBorderColor: '#FFFFFF',
        pointBorderWidth: 1.5,
      },
    ],
  }), [radarData]);

  const categoryRadarOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    scales: {
      r: createRadarScaleOptions(),
    },
    interaction: {
      mode: 'point',
      intersect: false,
    },
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        ...blackTooltip,
        enabled: true,
        mode: 'nearest',
        titleFont: {
          size: 14,
          weight: 'bold',
        },
        bodyFont: {
          size: 13,
        },
        callbacks: {
          title: function(context) {
            return radarData[context[0].dataIndex]?.category || '';
          },
          label: function(context) {
            const dataIndex = context.dataIndex;
            const data = radarData[dataIndex] || {};
            return `Score: ${context.parsed.r.toFixed(1)}% (${Math.round(data.score)}/${Math.round(data.maxPoints)})`;
          },
        },
      },
      datalabels: {
        display: false,
      },
    },
  }), [radarData]);

  const lineChartData = useMemo(() => ({
    labels: sortedTrendData.map((_d, idx) => idx + 1),
    datasets: [{
      label: 'Percentage',
      data: sortedTrendData.map((d) => d.percentage),
      borderColor: chartColors.blue,
      backgroundColor: 'rgba(71, 136, 184, 0.12)',
      borderWidth: 2,
      pointRadius: 4,
      pointBackgroundColor: chartColors.blueDark,
      pointBorderColor: '#FFFFFF',
      pointBorderWidth: 1.5,
      tension: 0.1,
      fill: true,
    }],
  }), [sortedTrendData]);

  const lineChartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    scales: {
      y: {
        min: 0,
        max: 100,
        beginAtZero: true,
        grid: {
          ...dashedGrid,
        },
        ticks: {
          stepSize: 20,
          color: chartColors.muted,
          font: { size: 11 },
        },
        title: {
          display: true,
          text: 'Percentage (%)',
          color: chartColors.muted,
          font: {
            size: 12,
          },
        },
      },
      x: {
        grid: {
          ...dashedGrid,
          color: '#EEF0F4',
        },
        ticks: {
          color: chartColors.muted,
          font: { size: 11 },
        },
        title: {
          display: true,
          text: 'Submission Order',
          color: chartColors.muted,
          font: {
            size: 12,
          },
        },
      },
    },
    plugins: {
      legend: {
        display: false,
      },
      datalabels: {
        display: false,
      },
      tooltip: {
        ...blackTooltip,
        callbacks: {
          title: function(context) {
            const index = context[0].dataIndex;
            return sortedTrendData[index]?.name || '';
          },
          label: function(context) {
            const index = context.dataIndex;
            const data = sortedTrendData[index];
            if (!data) return '';
            let label = `Raw: ${formatRawScore(data.score)} / ${formatRawScore(data.maxPoints)} (${Number(data.percentage || 0).toFixed(2)}%)`;
            if (data.submissionTime) {
              label += `\nSubmitted: ${formatDate(data.submissionTime)}`;
            }
            return label;
          },
        },
      },
    },
    interaction: {
      mode: 'index',
      intersect: false,
      axis: 'x',
    },
  }), [sortedTrendData]);

  if (!hasStudentData) return null;

  return (
    <Box>
      {!hideTopSnapshot && (
        <Paper
          elevation={0}
          sx={{
            ...cardSx,
            p: 2.5,
            mb: 3,
          }}
        >
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'flex-start', md: 'center' }} justifyContent="space-between">
            <Box>
              <Typography variant="overline" sx={{ color: chartColors.muted, fontWeight: 800, letterSpacing: 0 }}>
                Final Policy Snapshot
              </Typography>
              <Typography variant="h5" sx={{ color: chartColors.ink, fontWeight: 750, lineHeight: 1.15 }}>
                {formatPolicyPoints(studentData.policyFinalDisplayScore ?? studentData.displayScore ?? studentData.totalScore)} / {formatPolicyPoints(studentData.policyFinalCap ?? (overallCategoryDonut.totalCap || (studentData.totalCapPoints ?? studentData.totalMaxPoints)))}
                {currentGrade ? ` · ${currentGrade.grade}` : ''}
              </Typography>
              <Typography variant="caption" sx={{ color: chartColors.muted, display: 'block', mt: 0.5 }}>
                Final totals use CS10 policy: question/topic best, drops, clobber, scale, cap, then course rounding.
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {['Quest', 'Midterm', 'Postterm'].map((category) => {
                const item = categorySnapshot[category];
                return (
                  <Chip
                    key={category}
                    size="small"
                    label={`${category}: ${item ? `${formatPolicyPoints(item.score)}/${formatPolicyPoints(item.cap)}` : '-'}`}
                    sx={{ fontWeight: 700, backgroundColor: '#EFF6FB', color: chartColors.blueDark }}
                  />
                );
              })}
            </Stack>
          </Stack>
        </Paper>
      )}

      <StudentCategoryBlocks blocks={categoryBlocks} />

      <Grid container spacing={3} sx={{ mb: 3, alignItems: 'stretch' }}>
        {/* Overall Summary */}
        <Grid item xs={12} md={6} sx={{ display: 'flex', minWidth: 0 }}>
          <Paper 
            elevation={0} 
            sx={{ 
              ...cardSx,
              p: 3,
              flex: 1,
              minWidth: 0,
            }}
          >
            <Typography variant="h6" gutterBottom sx={{ ...headingSx, mb: 3 }}>
              Overall Summary
            </Typography>
            <Box sx={{ height: { xs: 340, sm: 400 }, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {overallCategoryDonut.values.length === 0 ? (
                  <Typography sx={{ color: chartColors.softText, fontSize: '0.875rem' }}>No category data yet.</Typography>
                ) : (
                  <>
                    <Box sx={{ width: { xs: 260, sm: 340, lg: 380 }, height: { xs: 260, sm: 340, lg: 380 }, position: 'relative' }}>
                      <ChartDoughnut
                        data={overallDonutData}
                        options={overallDonutOptions}
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
                      <Typography variant="caption" sx={{ color: chartColors.muted, fontWeight: 700, letterSpacing: 0 }}>
                        TOTAL
                      </Typography>
                      <Typography
                        variant="h5"
                        sx={{
                          color: chartColors.ink,
                          fontSize: { xs: 32, sm: 36 },
                          fontWeight: 800,
                          lineHeight: 1,
                          mt: 0.4,
                        }}
                      >
                        {formatPolicyPoints(studentData.policyFinalDisplayScore ?? studentData.displayScore ?? studentData.totalScore)}
                      </Typography>
                      <Typography variant="body2" sx={{ color: chartColors.softText, fontSize: 17, mt: 0.6 }}>
                        / {formatPolicyPoints(studentData.policyFinalCap ?? (overallCategoryDonut.totalCap || (studentData.totalCapPoints ?? studentData.totalMaxPoints)))}
                      </Typography>
                      {currentGrade && (
                        <Box
                          sx={{
                            mt: 1.2,
                            px: 1.4,
                            py: 0.45,
                            borderRadius: 999,
                            border: `1px solid ${chartColors.border}`,
                            backgroundColor: chartColors.band,
                          }}
                        >
                          <Typography variant="caption" sx={{ color: chartColors.ink, fontWeight: 700, letterSpacing: 0 }}>
                            Current {currentGrade.grade}
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  </>
                )}
              </Box>
            </Box>
            {overallCategoryDonut.segmentMeta.length > 0 && (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                  gap: 1,
                  mt: 1,
                }}
              >
                {overallCategoryDonut.segmentMeta.map((segment) => (
                  <Box
                    key={segment.category}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      minWidth: 0,
                      py: 0.5,
                      borderTop: `1px solid ${chartColors.border}`,
                    }}
                  >
                    <Box
                      sx={{
                        width: 10,
                        height: 10,
                        borderRadius: '2px',
                        backgroundColor: segment.earnedColor,
                        flexShrink: 0,
                      }}
                    />
                    <Typography
                      variant="caption"
                      sx={{
                        color: chartColors.ink,
                        fontWeight: 700,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                      }}
                    >
                      {segment.category}
                    </Typography>
                    <Typography variant="caption" sx={{ color: chartColors.muted, fontWeight: 650, whiteSpace: 'nowrap' }}>
                      {formatPolicyPoints(segment.earned)}/{formatPolicyPoints(segment.cap)} · {Math.round(segment.weightPercentage)}%
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}

          </Paper>
        </Grid>

        {/* Performance by Category */}
        <Grid item xs={12} md={6} sx={{ display: 'flex', minWidth: 0 }}>
          <Paper 
            elevation={0} 
            sx={{ 
              ...cardSx,
              p: 4,
              flex: 1,
              minWidth: 0,
            }}
          >
            <Typography variant="h6" gutterBottom sx={{ ...headingSx, mb: 0.5 }}>
              Performance by Category
            </Typography>
            <Typography variant="caption" sx={{ color: chartColors.muted, display: 'block', mb: 2 }}>
              Final policy score after drops, clobber, scaling, caps, and course rounding.
            </Typography>
            <TableContainer sx={{ mt: 2, borderRadius: 2, overflowX: 'auto', overflowY: 'hidden' }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ backgroundColor: chartColors.band }}>
                    <TableCell><strong>Category</strong></TableCell>
                    <TableCell align="center"><strong>Score</strong></TableCell>
                    <TableCell align="center"><strong>Cap</strong></TableCell>
                    <TableCell align="center"><strong>%</strong></TableCell>
                    <TableCell align="center"><strong>Level</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Object.entries(displayCategoriesData).map(([category, data]) => {
                    return (
                      <TableRow key={category} hover>
                        <TableCell><strong>{category}</strong></TableCell>
                        <TableCell align="center">{formatPolicyPoints(data.exactScore ?? data.total)}</TableCell>
                        <TableCell align="center">{formatPolicyPoints(data.capPoints ?? data.maxPoints)}</TableCell>
                        <TableCell align="center"><ProgressBattery value={data.percentage} /></TableCell>
                        <TableCell align="center">
                          <Chip size="small" label="Final policy" sx={{ fontWeight: 700, color: chartColors.muted }} />
                        </TableCell>
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
              ...cardSx,
              p: 3,
              flex: 1,
              minWidth: 0,
            }}
          >
            <Typography variant="h6" gutterBottom sx={headingSx}>
              Category Performance Radar
            </Typography>
            <Box sx={{ height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Box sx={{ width: '100%', maxWidth: 420, aspectRatio: '1 / 1', position: 'relative' }}>
                <ChartRadar 
                  data={categoryRadarData}
                  options={categoryRadarOptions}
                />
              </Box>
            </Box>
          </Paper>
        </Grid>

        {examTrendCards.map((card) => (
          <Grid key={card.key} item xs={12} md={6} sx={{ display: 'flex', minWidth: 0 }}>
            <Paper
              elevation={0}
              sx={{
                ...cardSx,
                p: 3,
                flex: 1,
                minWidth: 0,
              }}
            >
              <Box sx={{ mb: 2 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between">
                  <Box>
                    <Typography variant="h6" sx={headingSx}>
                      {card.title}
                    </Typography>
                    <Typography variant="caption" sx={{ color: chartColors.muted, display: 'block', mt: 0.25 }}>
                      Diagnostic topic/question-best view. Final category score may include cross-exam clobber.
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                    <Chip
                      size="small"
                      label={`Topic best ${formatPolicyPoints(card.topicScore)} / ${formatPolicyPoints(card.topicCap || card.cap)}`}
                      sx={{ fontWeight: 700, color: '#0F766E', backgroundColor: '#ECFDF5' }}
                    />
                    <Chip
                      size="small"
                      label={`Final ${card.finalSnapshot ? `${formatPolicyPoints(card.finalSnapshot.score)} / ${formatPolicyPoints(card.finalSnapshot.cap)}` : '-'}`}
                      sx={{ fontWeight: 700, color: chartColors.ink, backgroundColor: chartColors.band }}
                    />
                  </Stack>
                </Stack>
              </Box>
              <Box sx={{ height: 400, position: 'relative' }}>
                {card.trend.components.length === 0 || card.trend.series.length === 0 ? (
                  <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', px: 2, textAlign: 'center' }}>
                    <Typography sx={{ color: chartColors.muted }}>{card.empty}</Typography>
                  </Box>
                ) : (
                  <ChartRadar
                    data={card.chartData}
                    options={card.chartOptions}
                  />
                )}
              </Box>
            </Paper>
          </Grid>
        ))}

        {/* Line Chart */}
        <Grid item xs={12}>
          <Paper 
            elevation={0} 
            sx={{ 
              ...cardSx,
              p: 3,
            }}
          >
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="h6" sx={headingSx}>
                Score Trend
              </Typography>
            </Box>
            <Box sx={{ height: 300, position: 'relative' }}>
              <ChartLine
                data={lineChartData}
                options={lineChartOptions}
              />
            </Box>
          </Paper>
        </Grid>
      </Grid>

      {/* Detailed Assignment Scores */}
      <Paper 
        elevation={0} 
        sx={{ 
          ...cardSx,
          p: 4,
        }}
      >
        <Typography variant="h6" gutterBottom sx={{ ...headingSx, mb: 3 }}>
          Detailed Assignment Scores
        </Typography>
        <TableContainer sx={{ mt: 2, borderRadius: 2, overflowX: 'auto', overflowY: 'visible' }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ backgroundColor: chartColors.band, fontWeight: 600 }}>#</TableCell>
                <TableCell sx={{ backgroundColor: chartColors.band, fontWeight: 600 }}>Category</TableCell>
                <TableCell sx={{ backgroundColor: chartColors.band, fontWeight: 600 }}>Assignment</TableCell>
                <TableCell align="center" sx={{ backgroundColor: chartColors.band, fontWeight: 600 }}>Score</TableCell>
                <TableCell align="center" sx={{ backgroundColor: chartColors.band, fontWeight: 600 }}>Max</TableCell>
                <TableCell align="center" sx={{ backgroundColor: chartColors.band, fontWeight: 600 }}>%</TableCell>
                <TableCell align="center" sx={{ backgroundColor: chartColors.band, fontWeight: 600 }}>Submitted</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedAssignments.map((assignment, idx) => {
                return (
                  <TableRow key={`${assignment.category}-${assignment.name}-${assignment.submissionTime || idx}`} hover>
                    <TableCell>{idx + 1}</TableCell>
                    <TableCell>{assignment.category}</TableCell>
                    <TableCell>{assignment.name}</TableCell>
                    <TableCell align="center">{formatRawScore(assignment.score)}</TableCell>
                    <TableCell align="center">{formatRawScore(assignment.maxPoints)}</TableCell>
                    <TableCell align="center"><ProgressBattery value={assignment.percentage} /></TableCell>
                    <TableCell align="center" sx={{ fontSize: '0.875rem' }}>
                      {assignment.formattedSubmissionTime}
                      {assignment.lateness && assignment.lateness !== '00:00:00' && (
                        <Box component="span" sx={{ display: 'block', color: chartColors.rose, fontSize: '0.75rem', mt: 0.5 }}>
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

export default memo(StudentProfileContent);
