import { memo, useMemo } from 'react';
import {
  Box,
  Chip,
  Grid,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import {
  formatAttemptCount,
  formatEvidenceScore,
  formatPercentage,
  formatPoints,
  getEvidenceStatusMeta,
} from './studentExperienceModel';

const blockColors = {
  attendance: { ink: '#0F766E', bg: '#ECFDF5', border: '#99F6E4' },
  labs: { ink: '#1D4ED8', bg: '#EFF6FF', border: '#BFDBFE' },
  projects: { ink: '#7C2D12', bg: '#FFF7ED', border: '#FED7AA' },
  exam: { ink: '#5B21B6', bg: '#F5F3FF', border: '#DDD6FE' },
  default: { ink: '#374151', bg: '#F9FAFB', border: '#E5E7EB' },
};

function getTone(type = 'default') {
  return blockColors[type] || blockColors.default;
}

const ScoreBar = memo(function ScoreBar({ value, tone }) {
  const numeric = value == null ? null : Number(value);
  const percentage = Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric)) : null;
  return (
    <Box sx={{ mt: 1.4 }}>
      <Box sx={{ height: 8, borderRadius: 999, backgroundColor: '#EEF0F4', overflow: 'hidden' }}>
        {percentage != null && (
          <Box sx={{ width: `${percentage}%`, height: '100%', borderRadius: 999, backgroundColor: tone.ink }} />
        )}
      </Box>
    </Box>
  );
});

const EvidenceItems = memo(function EvidenceItems({ items = [] }) {
  if (!items.length) {
    return <Typography variant="caption" sx={{ color: '#6B7280' }}>No authoritative catalog evidence in this category.</Typography>;
  }
  return (
    <Stack spacing={0.75}>
      {items.slice(0, 3).map((item) => (
        <Stack key={item.assignmentId} direction="row" spacing={1} alignItems="center" justifyContent="space-between">
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="caption" sx={{ color: '#374151', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.name || 'Assignment'}
            </Typography>
            <Typography variant="caption" sx={{ color: '#6B7280' }}>{getEvidenceStatusMeta(item.evidenceStatus, item).label}</Typography>
          </Box>
          <Typography variant="caption" sx={{ color: '#111827', fontWeight: 700, flexShrink: 0 }}>{formatEvidenceScore(item)}</Typography>
        </Stack>
      ))}
    </Stack>
  );
});

function StatusCountChip({ block, status }) {
  const count = block.summary?.statusCounts?.[status] || 0;
  return <Chip size="small" label={`${count} ${getEvidenceStatusMeta(status).label.toLowerCase()}`} />;
}

const AttendanceDetail = memo(function AttendanceDetail({ block }) {
  const summary = block.summary || {};
  return (
    <Stack spacing={1.1}>
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
        <Chip size="small" label={`${summary.totalItems || 0} catalog sessions`} />
        <StatusCountChip block={block} status="submitted" />
        <StatusCountChip block={block} status="missing" />
        <StatusCountChip block={block} status="due_unknown" />
      </Stack>
      <Typography variant="caption" sx={{ color: '#6B7280' }}>
        Due-work progress: {summary.dueMax > 0 ? `${formatPoints(summary.dueScore)} / ${formatPoints(summary.dueMax)}` : 'Unavailable'}
      </Typography>
    </Stack>
  );
});

const LabsDetail = memo(function LabsDetail({ block }) {
  const summary = block.summary || {};
  return (
    <Stack spacing={1.1}>
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
        <Chip size="small" label={`${summary.totalItems || 0} catalog labs`} />
        <StatusCountChip block={block} status="earned_zero" />
        <StatusCountChip block={block} status="not_synced" />
        <StatusCountChip block={block} status="not_due" />
      </Stack>
      <EvidenceItems items={block.evidenceRows} />
    </Stack>
  );
});

const ProjectsDetail = memo(function ProjectsDetail({ block }) {
  const summary = block.summary || {};
  return (
    <Stack spacing={1.1}>
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
        <Chip size="small" label={`${summary.totalItems || 0} catalog projects`} />
        <StatusCountChip block={block} status="submitted" />
        <StatusCountChip block={block} status="missing" />
        <Chip size="small" label={`${summary.lateItems || 0} late`} />
      </Stack>
      <EvidenceItems items={block.evidenceRows} />
    </Stack>
  );
});

const ExamDetail = memo(function ExamDetail({ block }) {
  const exam = block.exam || {};
  return (
    <Stack spacing={1.1}>
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
        <Chip size="small" label={formatAttemptCount(exam.attempts)} />
        {exam.questionBestAvailable && <Chip size="small" label="Question-best diagnostic available" />}
        {exam.positiveClobberCount > 0 && <Chip size="small" label={`${exam.positiveClobberCount} positive clobber`} />}
      </Stack>
      <Typography variant="caption" sx={{ color: '#6B7280' }}>Final score above is canonical; attempt diagnostics do not replace it.</Typography>
    </Stack>
  );
});

const detailRenderers = {
  attendance: AttendanceDetail,
  labs: LabsDetail,
  projects: ProjectsDetail,
  exam: ExamDetail,
};

const CategoryBlockCard = memo(function CategoryBlockCard({ block }) {
  const tone = getTone(block.type);
  const Detail = detailRenderers[block.type] || LabsDetail;
  const hasCanonicalScore = block.exactScore != null && block.cap != null;
  return (
    <Paper elevation={0} sx={{ height: '100%', borderRadius: 2, border: `1px solid ${tone.border}`, backgroundColor: '#FFFFFF', p: 2 }}>
      <Stack spacing={1.5} sx={{ height: '100%' }}>
        <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between">
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ color: '#111827', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{block.label}</Typography>
            <Typography variant="caption" sx={{ color: '#6B7280' }}>
              {block.percentage == null ? 'Canonical final unavailable' : `${formatPercentage(block.percentage)} final policy`}
            </Typography>
          </Box>
          <Chip
            size="small"
            label={hasCanonicalScore ? `${formatPoints(block.exactScore)} / ${formatPoints(block.cap)}` : 'Unavailable'}
            sx={{ fontWeight: 800, color: tone.ink, backgroundColor: tone.bg, flexShrink: 0 }}
          />
        </Stack>
        <ScoreBar value={block.percentage} tone={tone} />
        <Box sx={{ mt: 'auto' }}><Detail block={block} /></Box>
      </Stack>
    </Paper>
  );
});

function sortBlocks(blocks = []) {
  const order = new Map([['attendance', 0], ['labs', 1], ['projects', 2], ['quest', 3], ['midterm', 4], ['postterm', 5]]);
  return [...blocks].sort((left, right) => (
    (order.get(left.key) ?? 99) - (order.get(right.key) ?? 99)
    || String(left.label || '').localeCompare(String(right.label || ''))
  ));
}

export default memo(function StudentCategoryBlocks({ blocks = [] }) {
  const sortedBlocks = useMemo(() => sortBlocks(blocks), [blocks]);
  if (sortedBlocks.length === 0) return null;
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ mb: 1.5 }}>
        <Typography variant="h6" sx={{ color: '#111827', fontWeight: 800 }}>Category Summary</Typography>
        <Typography variant="caption" sx={{ color: '#6B7280' }}>Canonical policy-final scores with domain-specific catalog evidence.</Typography>
      </Box>
      <Grid container spacing={2}>
        {sortedBlocks.map((block) => <Grid key={block.key} item xs={12} sm={6} lg={4}><CategoryBlockCard block={block} /></Grid>)}
      </Grid>
    </Box>
  );
});
