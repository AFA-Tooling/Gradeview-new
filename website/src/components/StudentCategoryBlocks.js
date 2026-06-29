import { memo, useMemo } from 'react';
import {
  Box,
  Chip,
  Grid,
  Paper,
  Stack,
  Typography,
} from '@mui/material';

const blockColors = {
  attendance: { ink: '#0F766E', bg: '#ECFDF5', border: '#99F6E4' },
  labs: { ink: '#1D4ED8', bg: '#EFF6FF', border: '#BFDBFE' },
  projects: { ink: '#7C2D12', bg: '#FFF7ED', border: '#FED7AA' },
  exam: { ink: '#5B21B6', bg: '#F5F3FF', border: '#DDD6FE' },
  default: { ink: '#374151', bg: '#F9FAFB', border: '#E5E7EB' },
};

function safeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function formatPoints(value) {
  const numeric = safeNumber(value);
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2);
}

function formatPercentage(value) {
  return `${safeNumber(value).toFixed(1)}%`;
}

function getTone(type = 'default') {
  return blockColors[type] || blockColors.default;
}

const ScoreBar = memo(function ScoreBar({ value, tone }) {
  const percentage = Math.max(0, Math.min(100, safeNumber(value)));
  return (
    <Box sx={{ mt: 1.4 }}>
      <Box sx={{ height: 8, borderRadius: 999, backgroundColor: '#EEF0F4', overflow: 'hidden' }}>
        <Box
          sx={{
            width: `${percentage}%`,
            height: '100%',
            borderRadius: 999,
            backgroundColor: tone.ink,
          }}
        />
      </Box>
    </Box>
  );
});

const RecentItems = memo(function RecentItems({ items = [] }) {
  if (!items.length) {
    return (
      <Typography variant="caption" sx={{ color: '#6B7280' }}>
        No recent raw submissions in this category.
      </Typography>
    );
  }

  return (
    <Stack spacing={0.75}>
      {items.slice(0, 3).map((item, index) => (
        <Stack
          key={`${item.name || 'item'}-${item.submissionTime || index}`}
          direction="row"
          spacing={1}
          alignItems="center"
          justifyContent="space-between"
        >
          <Typography
            variant="caption"
            sx={{
              color: '#374151',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.name || 'Assignment'}
          </Typography>
          <Typography variant="caption" sx={{ color: '#111827', fontWeight: 700, flexShrink: 0 }}>
            {formatPoints(item.score)} / {formatPoints(item.maxPoints)}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
});

const AttendanceDetail = memo(function AttendanceDetail({ block }) {
  const summary = block.summary || {};
  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      <Chip size="small" label={`${summary.submittedItems || 0}/${summary.totalItems || 0} sessions`} />
      <Chip size="small" label={`${summary.missingItems || 0} open/missing`} />
      <Chip size="small" label={`Raw ${formatPercentage(summary.rawPercentage)}`} />
    </Stack>
  );
});

const CourseworkDetail = memo(function CourseworkDetail({ block }) {
  const summary = block.summary || {};
  return (
    <Stack spacing={1.25}>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Chip size="small" label={`${summary.submittedItems || 0}/${summary.totalItems || 0} submitted`} />
        <Chip size="small" label={`Raw ${formatPoints(summary.rawScore)} / ${formatPoints(summary.rawMax)}`} />
      </Stack>
      <RecentItems items={summary.recentItems || []} />
    </Stack>
  );
});

const ExamDetail = memo(function ExamDetail({ block }) {
  const exam = block.exam || {};
  return (
    <Stack spacing={1.25}>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Chip size="small" label={`${exam.attempts || 0} policy attempts`} />
        <Chip size="small" label={`Latest ${exam.latestFinalPercentage == null ? '-' : formatPercentage(exam.latestFinalPercentage)}`} />
        {block.componentTrendAvailable && <Chip size="small" label="Topic trend ready" />}
        {(exam.clobberedAttempts || 0) > 0 && <Chip size="small" label={`${exam.clobberedAttempts} clobbered`} />}
      </Stack>
      <RecentItems items={block.summary?.recentItems || []} />
    </Stack>
  );
});

const DefaultDetail = memo(function DefaultDetail({ block }) {
  return <CourseworkDetail block={block} />;
});

const detailRenderers = {
  attendance: AttendanceDetail,
  labs: CourseworkDetail,
  projects: CourseworkDetail,
  exam: ExamDetail,
  default: DefaultDetail,
};

const CategoryBlockCard = memo(function CategoryBlockCard({ block }) {
  const tone = getTone(block.type);
  const Detail = detailRenderers[block.type] || detailRenderers.default;

  return (
    <Paper
      elevation={0}
      sx={{
        height: '100%',
        borderRadius: 2,
        border: `1px solid ${tone.border}`,
        backgroundColor: '#FFFFFF',
        p: 2,
      }}
    >
      <Stack spacing={1.5} sx={{ height: '100%' }}>
        <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between">
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="subtitle2"
              sx={{
                color: '#111827',
                fontWeight: 800,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {block.label}
            </Typography>
            <Typography variant="caption" sx={{ color: '#6B7280' }}>
              {formatPercentage(block.percentage)} final policy
            </Typography>
          </Box>
          <Chip
            size="small"
            label={`${formatPoints(block.score)} / ${formatPoints(block.cap)}`}
            sx={{ fontWeight: 800, color: tone.ink, backgroundColor: tone.bg, flexShrink: 0 }}
          />
        </Stack>

        <ScoreBar value={block.percentage} tone={tone} />

        <Box sx={{ mt: 'auto' }}>
          <Detail block={block} />
        </Box>
      </Stack>
    </Paper>
  );
});

function sortBlocks(blocks = []) {
  const order = new Map([
    ['attendance', 0],
    ['labs', 1],
    ['projects', 2],
    ['quest', 3],
    ['midterm', 4],
    ['postterm', 5],
  ]);

  return [...blocks].sort((a, b) => (
    (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99)
    || String(a.label || '').localeCompare(String(b.label || ''))
  ));
}

export default memo(function StudentCategoryBlocks({ blocks = [] }) {
  const sortedBlocks = useMemo(() => sortBlocks(blocks), [blocks]);

  if (sortedBlocks.length === 0) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between" sx={{ mb: 1.5 }}>
        <Box>
          <Typography variant="h6" sx={{ color: '#111827', fontWeight: 800 }}>
            Category Summary
          </Typography>
          <Typography variant="caption" sx={{ color: '#6B7280' }}>
            Policy-adjusted status by grading area.
          </Typography>
        </Box>
      </Stack>

      <Grid container spacing={2}>
        {sortedBlocks.map((block) => (
          <Grid key={block.key || block.label} item xs={12} sm={6} lg={4}>
            <CategoryBlockCard block={block} />
          </Grid>
        ))}
      </Grid>
    </Box>
  );
});
