import React, { memo, useMemo } from 'react';
import {
  Alert,
  Box,
  Chip,
  Grid,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import StudentCategoryBlocks from './StudentCategoryBlocks';
import {
  buildCategoryPresentations,
  formatAttemptCount,
  formatCourseDateTime,
  formatEvidenceScore,
  formatPercentage,
  formatPoints,
  getActualClobberRows,
  getAssignmentEvidence,
  getCanonicalStanding,
  getEvidenceStatusMeta,
  getExamRows,
  sortLedgerRows,
} from './studentExperienceModel';

const colors = {
  ink: '#111827',
  muted: '#6B7280',
  border: '#E5E7EB',
  surface: '#FFFFFF',
  band: '#F9FAFB',
  green: '#0F766E',
  greenBg: '#ECFDF5',
  amber: '#B45309',
  amberBg: '#FFFBEB',
  red: '#BE123C',
  redBg: '#FFF1F2',
};

const cardSx = {
  backgroundColor: colors.surface,
  borderRadius: 2,
  border: `1px solid ${colors.border}`,
  boxShadow: 'none',
};

function statusTone(status) {
  const tone = getEvidenceStatusMeta(status).tone;
  if (tone === 'success') return { color: colors.green, backgroundColor: colors.greenBg };
  if (tone === 'warning') return { color: colors.amber, backgroundColor: colors.amberBg };
  if (tone === 'error') return { color: colors.red, backgroundColor: colors.redBg };
  return { color: colors.muted, backgroundColor: colors.band };
}

function EvidenceStatusChip({ row }) {
  const meta = getEvidenceStatusMeta(row.evidenceStatus, row);
  return <Chip size="small" label={meta.label} sx={{ ...statusTone(row.evidenceStatus), fontWeight: 700 }} />;
}

function CanonicalSnapshot({ standing }) {
  const available = standing.displayScore != null && standing.cap != null;
  return (
    <Paper elevation={0} sx={{ ...cardSx, p: { xs: 2.5, md: 3 } }}>
      <Grid container spacing={2} alignItems="center">
        <Grid item xs={12} md={7}>
          <Typography variant="overline" sx={{ color: colors.muted, fontWeight: 800 }}>Canonical policy-final standing</Typography>
          <Typography sx={{ color: colors.ink, fontWeight: 850, fontSize: { xs: 28, md: 36 }, lineHeight: 1.1 }}>
            {available ? `${formatPoints(standing.displayScore)} / ${formatPoints(standing.cap)}` : 'Unavailable'}
          </Typography>
          <Typography sx={{ color: colors.muted, fontSize: 13, mt: 0.75 }}>
            {available ? `Exact ${formatPoints(standing.exactScore)} · ${formatPercentage(standing.percentage)} · source ${standing.source || 'unavailable'}` : 'No valid policy_final contract was returned.'}
          </Typography>
        </Grid>
        <Grid item xs={12} md={5}>
          <Stack direction="row" spacing={1} justifyContent={{ xs: 'flex-start', md: 'flex-end' }} flexWrap="wrap" useFlexGap>
            <Chip label={standing.letter || 'Letter unavailable'} sx={{ fontWeight: 800 }} />
            <Chip label={standing.bin?.range || 'Grade bin unavailable'} sx={{ fontWeight: 700, color: colors.muted }} />
          </Stack>
        </Grid>
      </Grid>
    </Paper>
  );
}

function CategoryPolicyTable({ blocks }) {
  return (
    <Paper elevation={0} sx={{ ...cardSx, p: { xs: 2, md: 3 } }}>
      <Typography variant="h6" sx={{ color: colors.ink, fontWeight: 800 }}>Performance by Category</Typography>
      <Typography sx={{ color: colors.muted, fontSize: 13, mt: 0.35, mb: 2 }}>Every value below comes from canonicalGrade.categories with basis policy_final.</Typography>
      <TableContainer sx={{ border: `1px solid ${colors.border}`, borderRadius: 1.5 }}>
        <Table size="small">
          <TableHead><TableRow><TableCell>Category</TableCell><TableCell align="right">Exact score</TableCell><TableCell align="right">Cap</TableCell><TableCell align="right">Final %</TableCell><TableCell>Contract state</TableCell></TableRow></TableHead>
          <TableBody>
            {blocks.map((block) => (
              <TableRow key={block.key}>
                <TableCell sx={{ fontWeight: 700 }}>{block.label}</TableCell>
                <TableCell align="right">{formatPoints(block.exactScore)}</TableCell>
                <TableCell align="right">{formatPoints(block.cap)}</TableCell>
                <TableCell align="right">{formatPercentage(block.percentage)}</TableCell>
                <TableCell><Chip size="small" label={block.canonicalStatus || 'unavailable'} sx={{ fontWeight: 700 }} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}

function ExamPolicySummary({ blocks }) {
  const examBlocks = blocks.filter((block) => block.type === 'exam');
  return (
    <Paper elevation={0} sx={{ ...cardSx, p: { xs: 2, md: 3 } }}>
      <Typography variant="h6" sx={{ color: colors.ink, fontWeight: 800 }}>Exam Policy Summary</Typography>
      <Typography sx={{ color: colors.muted, fontSize: 13, mt: 0.35, mb: 2 }}>Canonical final category values are separated from attempt diagnostics.</Typography>
      <Grid container spacing={1.5}>
        {examBlocks.map((block) => (
          <Grid key={block.key} item xs={12} md={4}>
            <Paper elevation={0} sx={{ border: `1px solid ${colors.border}`, borderRadius: 1.5, p: 2, height: '100%' }}>
              <Typography sx={{ color: colors.ink, fontWeight: 800 }}>{block.label}</Typography>
              <Typography sx={{ color: colors.ink, fontSize: 24, fontWeight: 850, mt: 0.5 }}>
                {block.exactScore == null || block.cap == null ? 'Unavailable' : `${formatPoints(block.exactScore)} / ${formatPoints(block.cap)}`}
              </Typography>
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1.25 }}>
                <Chip size="small" label={formatAttemptCount(block.exam?.attempts)} />
                {block.exam?.questionBestAvailable && <Chip size="small" label="Question-best available" />}
                {block.exam?.positiveClobberCount > 0 && <Chip size="small" label={`${block.exam.positiveClobberCount} positive clobber`} />}
              </Stack>
            </Paper>
          </Grid>
        ))}
      </Grid>
    </Paper>
  );
}

function AssignmentCatalogTable({ rows }) {
  return (
    <Paper elevation={0} sx={{ ...cardSx, p: { xs: 2, md: 3 } }}>
      <Typography variant="h6" sx={{ color: colors.ink, fontWeight: 800 }}>Assignment Catalog Evidence</Typography>
      <Typography sx={{ color: colors.muted, fontSize: 13, mt: 0.35, mb: 2 }}>All {rows.length} authoritative catalog rows; duplicate titles remain distinct by assignment ID. Dates use America/Los_Angeles.</Typography>
      {rows.length === 0 ? (
        <Alert severity="warning">No assignment catalog evidence is available. This is not a zero score.</Alert>
      ) : (
        <TableContainer sx={{ border: `1px solid ${colors.border}`, borderRadius: 1.5 }}>
          <Table size="small">
            <TableHead><TableRow><TableCell>Assignment ID</TableCell><TableCell>Category</TableCell><TableCell>Assignment</TableCell><TableCell>Evidence</TableCell><TableCell>Status</TableCell><TableCell>Due</TableCell><TableCell>Submitted</TableCell></TableRow></TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.assignmentId} data-assignment-id={row.assignmentId}>
                  <TableCell>{row.assignmentId}</TableCell>
                  <TableCell>{row.category}</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>{row.name}</TableCell>
                  <TableCell>{formatEvidenceScore(row)}</TableCell>
                  <TableCell><EvidenceStatusChip row={row} /></TableCell>
                  <TableCell>{formatCourseDateTime(row.dueAt)}</TableCell>
                  <TableCell>{formatCourseDateTime(row.submissionTime)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Paper>
  );
}

function StudentProfileContent({ studentData, hideTopSnapshot = false }) {
  const standing = useMemo(() => getCanonicalStanding(studentData), [studentData]);
  const rows = useMemo(() => sortLedgerRows(getAssignmentEvidence(studentData), 'category'), [studentData]);
  const blocks = useMemo(() => buildCategoryPresentations(studentData).map((block) => {
    if (block.type !== 'exam') return block;
    const examRows = getExamRows(studentData, block.key);
    return {
      ...block,
      exam: {
        attempts: examRows.length,
        questionBestAvailable: examRows.some((row) => row.questionBestPercentage != null),
        positiveClobberCount: getActualClobberRows(examRows).length,
      },
    };
  }), [studentData]);

  if (!studentData) return <Alert severity="info">Loading student report…</Alert>;

  return (
    <Box sx={{ width: '100%' }}>
      <Stack spacing={3}>
        {!hideTopSnapshot && <CanonicalSnapshot standing={standing} />}
        {standing.status === 'unavailable' && <Alert severity="warning">Canonical policy-final grade data is unavailable. Legacy totals are intentionally not substituted.</Alert>}
        <StudentCategoryBlocks blocks={blocks} />
        <CategoryPolicyTable blocks={blocks} />
        <ExamPolicySummary blocks={blocks} />
        <AssignmentCatalogTable rows={rows} />
      </Stack>
    </Box>
  );
}

export default memo(StudentProfileContent);
