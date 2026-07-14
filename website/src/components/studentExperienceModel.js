export const GRADE_BASIS = 'policy_final';
export const EVIDENCE_BASIS = 'assignment_evidence';
export const COURSE_TIME_ZONE = 'America/Los_Angeles';

export const EVIDENCE_STATUSES = Object.freeze([
  'earned_zero',
  'submitted',
  'missing',
  'not_due',
  'due_unknown',
  'not_synced',
  'not_applicable',
  'request_error',
]);

export const CATEGORY_DEFINITIONS = Object.freeze([
  {
    key: 'attendance',
    label: 'Attendance / Participation',
    shortLabel: 'Attendance',
    route: '/profile/attendance',
    type: 'attendance',
    match: /(attendance|participation|lecture|discussion|make-?up)/i,
  },
  {
    key: 'labs',
    label: 'Labs',
    shortLabel: 'Labs',
    route: '/profile/labs',
    type: 'labs',
    match: /\blabs?\b/i,
  },
  {
    key: 'projects',
    label: 'Projects',
    shortLabel: 'Projects',
    route: '/profile/projects',
    type: 'projects',
    match: /\bprojects?\b/i,
  },
  {
    key: 'quest',
    label: 'Quest',
    shortLabel: 'Quest',
    route: '/profile/exams/quest',
    type: 'exam',
    match: /\bquests?\b/i,
  },
  {
    key: 'midterm',
    label: 'Midterm',
    shortLabel: 'Midterm',
    route: '/profile/exams/midterm',
    type: 'exam',
    match: /\bmidterms?\b/i,
  },
  {
    key: 'postterm',
    label: 'Postterm',
    shortLabel: 'Postterm',
    route: '/profile/exams/postterm',
    type: 'exam',
    match: /\bpostt?erms?\b|\bfinal\b/i,
  },
]);

export const EXAM_MODES = Object.freeze(['raw', 'question_best', 'clobber']);
export const EXAM_KEYS = Object.freeze(CATEGORY_DEFINITIONS.filter((definition) => definition.type === 'exam').map((definition) => definition.key));
export const LAB_TABS = Object.freeze(['overview', 'list', 'policy']);
export const LEDGER_GROUPS = Object.freeze(['category', 'status', 'time', 'none']);

const CATEGORY_BY_KEY = new Map(CATEGORY_DEFINITIONS.map((definition) => [definition.key, definition]));
const STATUS_SET = new Set(EVIDENCE_STATUSES);
const UNUSABLE_CANONICAL_CATEGORY_STATUSES = new Set(['unavailable', 'not_synced', 'request_error', 'error']);
const COMPLETE_CANONICAL_STANDING_STATUSES = new Set(['available', 'complete', 'legacy']);

const STATUS_META = Object.freeze({
  earned_zero: {
    label: 'Earned zero',
    reason: 'A submitted score of 0 points is recorded.',
    tone: 'error',
  },
  submitted: {
    label: 'Submitted',
    reason: 'Submission evidence and a recorded score are available.',
    tone: 'success',
  },
  missing: {
    label: 'Missing',
    reason: 'The due time passed without a usable submission.',
    tone: 'error',
  },
  not_due: {
    label: 'Not due',
    reason: 'The assignment is not due yet.',
    tone: 'default',
  },
  due_unknown: {
    label: 'Due time unknown',
    reason: 'The catalog does not include a usable due time.',
    tone: 'warning',
  },
  not_synced: {
    label: 'Not synced',
    reason: 'The assignment source has not been synced for this student.',
    tone: 'warning',
  },
  not_applicable: {
    label: 'Not applicable',
    reason: 'This assignment does not apply to this student.',
    tone: 'default',
  },
  request_error: {
    label: 'Request error',
    reason: 'Assignment evidence could not be loaded.',
    tone: 'error',
  },
});

export function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizeText(value = '') {
  return String(value || '').trim().toLowerCase();
}

export function formatPoints(value, digits = 2) {
  const numeric = optionalNumber(value);
  if (numeric == null) return 'Unavailable';
  if (Number.isInteger(numeric)) return String(numeric);
  return numeric.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatPercentage(value, digits = 1) {
  const numeric = optionalNumber(value);
  return numeric == null ? 'Unavailable' : `${numeric.toFixed(digits)}%`;
}

export function formatCourseDateTime(value) {
  if (!value) return 'Time unavailable';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Time unavailable';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: COURSE_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.month} ${values.day}, ${values.year}, ${values.hour}:${values.minute} ${values.dayPeriod} ${values.timeZoneName}`;
}

export function getEvidenceStatusMeta(status, row = null) {
  const normalizedStatus = STATUS_SET.has(status) ? status : 'request_error';
  const base = STATUS_META[normalizedStatus];
  return {
    ...base,
    status: normalizedStatus,
    reason: normalizedStatus === 'request_error' && row?.requestError
      ? String(row.requestError)
      : base.reason,
  };
}

export function getCanonicalGrade(studentData) {
  const grade = studentData?.canonicalGrade;
  return grade?.basis === GRADE_BASIS ? grade : null;
}

export function getCanonicalStanding(studentData) {
  const grade = getCanonicalGrade(studentData);
  if (!grade) {
    return {
      status: 'unavailable',
      exactScore: null,
      displayScore: null,
      cap: null,
      percentage: null,
      letter: null,
      bin: null,
      source: null,
      asOf: null,
    };
  }
  return {
    status: grade.status || 'partial',
    exactScore: optionalNumber(grade.exactScore),
    displayScore: optionalNumber(grade.displayScore),
    cap: optionalNumber(grade.cap),
    percentage: optionalNumber(grade.percentage),
    letter: grade.letter || null,
    bin: grade.bin || null,
    source: grade.source || null,
    asOf: grade.asOf || null,
  };
}

export function getCanonicalCategory(studentData, categoryKey) {
  const grade = getCanonicalGrade(studentData);
  const category = grade?.categories?.[categoryKey];
  if (!category || category.basis !== GRADE_BASIS) return null;
  const status = String(category.status || 'legacy').trim().toLowerCase();
  const hasUsablePolicyValue = !UNUSABLE_CANONICAL_CATEGORY_STATUSES.has(status);
  return {
    ...category,
    status,
    exactScore: hasUsablePolicyValue ? optionalNumber(category.exactScore) : null,
    cap: optionalNumber(category.cap),
    percentage: hasUsablePolicyValue ? optionalNumber(category.percentage) : null,
  };
}

export function getCanonicalContractState(studentData) {
  const grade = getCanonicalGrade(studentData);
  const standing = getCanonicalStanding(studentData);
  const standingStatus = String(standing.status || 'partial').trim().toLowerCase();
  if (!grade) {
    return {
      partial: true,
      standingStatus,
      unavailableCategories: [],
      message: 'Partial data · canonical standing unavailable; total/letter may be incomplete',
    };
  }

  const unavailableCategories = CATEGORY_DEFINITIONS.flatMap((definition) => {
    const category = getCanonicalCategory(studentData, definition.key);
    return !category || UNUSABLE_CANONICAL_CATEGORY_STATUSES.has(category.status)
      ? [category?.label || definition.label]
      : [];
  });
  const partial = !COMPLETE_CANONICAL_STANDING_STATUSES.has(standingStatus)
    || unavailableCategories.length > 0;
  const reason = unavailableCategories.length > 0
    ? `${unavailableCategories.join(', ')} unavailable`
    : `canonical standing is ${standingStatus.replace(/_/g, ' ')}`;

  return {
    partial,
    standingStatus,
    unavailableCategories,
    message: partial ? `Partial data · ${reason}; total/letter may be incomplete` : '',
  };
}

export function getAssignmentEvidence(studentData) {
  const rows = Array.isArray(studentData?.assignmentEvidence)
    ? studentData.assignmentEvidence
    : [];
  return rows.map((row, index) => decorateEvidenceRow(row, index));
}

export function getCategoryDefinitionForEvidence(row) {
  const text = `${row?.category || ''} ${row?.rawCategory || ''} ${row?.name || ''}`;
  return CATEGORY_DEFINITIONS.find((definition) => definition.match.test(text)) || null;
}

export function decorateEvidenceRow(row = {}, index = 0) {
  const status = STATUS_SET.has(row.evidenceStatus) ? row.evidenceStatus : 'request_error';
  const score = optionalNumber(row.score);
  const maxPoints = optionalNumber(row.maxPoints);
  const recordedScore = optionalNumber(row.recordedScore);
  const percentage = optionalNumber(row.percentage)
    ?? (['earned_zero', 'submitted'].includes(status) && score != null && maxPoints != null && maxPoints > 0
      ? (score / maxPoints) * 100
      : null);
  const definition = getCategoryDefinitionForEvidence(row);
  const lateness = String(row.lateness || '').trim();
  return {
    ...row,
    assignmentId: String(row.assignmentId || row.externalAssignmentId || `missing-id-${index}`),
    category: row.category || definition?.label || 'Uncategorized',
    evidenceStatus: status,
    score,
    recordedScore,
    maxPoints,
    percentage,
    submitted: ['earned_zero', 'submitted'].includes(status),
    isLate: Boolean(lateness && !['0', '00:00:00', 'none'].includes(normalizeText(lateness))),
    categoryKey: definition?.key || null,
    categoryRoute: definition?.route || '/profile/assignments',
  };
}

export function formatEvidenceScore(row) {
  if (!row) return 'Unavailable';
  const status = STATUS_SET.has(row.evidenceStatus) ? row.evidenceStatus : 'request_error';
  if (!['earned_zero', 'submitted'].includes(status)) {
    if (status === 'missing') {
      return row.maxPoints == null
        ? 'No submission'
        : `No submission · ${formatPoints(row.maxPoints)} pts possible`;
    }
    return getEvidenceStatusMeta(status, row).label;
  }
  if (row.score == null) return 'Recorded score unavailable';
  return row.maxPoints == null
    ? `${formatPoints(row.score)} pts`
    : `${formatPoints(row.score)} / ${formatPoints(row.maxPoints)}`;
}

export function isDueWorkStatus(status) {
  return ['earned_zero', 'submitted', 'missing'].includes(status);
}

export function evidenceMatchesCategory(row, categoryKey) {
  return getCategoryDefinitionForEvidence(row)?.key === categoryKey;
}

export function summarizeEvidence(rows = []) {
  const statusCounts = Object.fromEntries(EVIDENCE_STATUSES.map((status) => [status, 0]));
  rows.forEach((row) => {
    const status = STATUS_SET.has(row.evidenceStatus) ? row.evidenceStatus : 'request_error';
    statusCounts[status] += 1;
  });
  const scoredRows = rows.filter((row) => ['earned_zero', 'submitted'].includes(row.evidenceStatus));
  const dueRows = rows.filter((row) => isDueWorkStatus(row.evidenceStatus));
  const rawScore = scoredRows.reduce((sum, row) => sum + (row.score ?? 0), 0);
  const rawMax = scoredRows.reduce((sum, row) => sum + (row.maxPoints ?? 0), 0);
  const dueScore = dueRows.reduce((sum, row) => (
    sum + (['earned_zero', 'submitted'].includes(row.evidenceStatus) ? (row.score ?? 0) : 0)
  ), 0);
  const dueMax = dueRows.reduce((sum, row) => sum + (row.maxPoints ?? 0), 0);
  const incompleteCount = statusCounts.due_unknown + statusCounts.not_synced + statusCounts.request_error;
  return {
    status: rows.length === 0 ? 'unavailable' : (incompleteCount > 0 ? 'partial' : 'complete'),
    totalItems: rows.length,
    submittedItems: statusCounts.earned_zero + statusCounts.submitted,
    missingItems: statusCounts.missing,
    lateItems: rows.filter((row) => row.isLate).length,
    statusCounts,
    rawScore,
    rawMax,
    rawPercentage: rawMax > 0 ? (rawScore / rawMax) * 100 : null,
    dueItemCount: dueRows.length,
    dueScore,
    dueMax,
    duePercentage: dueMax > 0 ? (dueScore / dueMax) * 100 : null,
  };
}

export function buildCategoryPresentation(studentData, categoryKey) {
  const definition = CATEGORY_BY_KEY.get(categoryKey);
  if (!definition) return null;
  const canonical = getCanonicalCategory(studentData, categoryKey);
  const rows = getAssignmentEvidence(studentData).filter((row) => evidenceMatchesCategory(row, categoryKey));
  return {
    key: categoryKey,
    label: canonical?.label || definition.label,
    shortLabel: definition.shortLabel,
    route: definition.route,
    type: canonical?.type || definition.type,
    basis: canonical?.basis || null,
    exactScore: canonical?.exactScore ?? null,
    score: canonical?.exactScore ?? null,
    cap: canonical?.cap ?? null,
    percentage: canonical?.percentage ?? null,
    canonicalStatus: canonical?.status || 'unavailable',
    source: canonical?.source || null,
    evidenceRows: rows,
    summary: summarizeEvidence(rows),
  };
}

export function buildCategoryPresentations(studentData) {
  return CATEGORY_DEFINITIONS.map((definition) => (
    buildCategoryPresentation(studentData, definition.key)
  ));
}

function parseGradeBins(rawBins = []) {
  return (Array.isArray(rawBins) ? rawBins : [])
    .map((bin) => {
      const minimum = optionalNumber(bin?.minScore ?? bin?.minimum);
      const rangeMatch = String(bin?.range || '').match(/^\s*(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\s*$/);
      const low = minimum ?? optionalNumber(rangeMatch?.[1]);
      return low == null || !(bin?.grade || bin?.letter)
        ? null
        : { grade: String(bin.grade || bin.letter), low };
    })
    .filter(Boolean)
    .sort((left, right) => left.low - right.low);
}

export function getGradeSnapshot(studentData) {
  const standing = getCanonicalStanding(studentData);
  if (standing.displayScore == null || !standing.letter) {
    return {
      ...standing,
      currentGrade: null,
      currentRange: '',
      nextGrade: null,
      nextThreshold: null,
      pointsToNext: null,
    };
  }
  const next = parseGradeBins(studentData?.gradeBins)
    .find((bin) => bin.low > standing.displayScore) || null;
  return {
    ...standing,
    currentGrade: standing.letter,
    currentRange: standing.bin?.range || '',
    nextGrade: next?.grade || null,
    nextThreshold: next?.low ?? null,
    pointsToNext: next ? Math.max(0, next.low - standing.displayScore) : 0,
  };
}

export function getMostImportantCategory(blocks = []) {
  const candidates = blocks
    .filter((block) => block?.percentage != null)
    .map((block) => {
      const counts = block.summary?.statusCounts || {};
      const missing = counts.missing || 0;
      const zero = counts.earned_zero || 0;
      const late = block.summary?.lateItems || 0;
      const riskScore = (missing * 100) + (zero * 70) + (late * 40) + Math.max(0, 100 - block.percentage);
      const reason = missing > 0
        ? `${missing} missing assignment${missing === 1 ? '' : 's'}`
        : zero > 0
          ? `${zero} recorded zero${zero === 1 ? '' : 'es'}`
          : late > 0
            ? `${late} late submission${late === 1 ? '' : 's'}`
            : `${formatPercentage(block.percentage)} final policy performance`;
      return { ...block, riskScore, importanceReason: reason };
    });
  return candidates.sort((left, right) => (
    right.riskScore - left.riskScore
    || String(left.label).localeCompare(String(right.label))
  ))[0] || null;
}

export function buildLedgerHref({ category, status, search, group = 'category' } = {}) {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (status && status !== 'all') params.set('status', status);
  if (search) params.set('search', search);
  if (group && group !== 'category') params.set('group', group);
  const query = params.toString();
  return query ? `/profile/assignments?${query}` : '/profile/assignments';
}

function actionPriority(row) {
  if (row.evidenceStatus === 'request_error') return 0;
  if (row.evidenceStatus === 'missing') return 1;
  if (row.evidenceStatus === 'earned_zero') return 2;
  if (row.isLate) return 3;
  if (row.evidenceStatus === 'not_synced') return 4;
  if (row.evidenceStatus === 'due_unknown') return 5;
  return 99;
}

function actionTitle(row) {
  if (row.evidenceStatus === 'request_error') return `Retry evidence for ${row.name}`;
  if (row.evidenceStatus === 'missing') return `Resolve ${row.name}`;
  if (row.evidenceStatus === 'earned_zero') return `Review zero on ${row.name}`;
  if (row.isLate) return `Review lateness on ${row.name}`;
  if (row.evidenceStatus === 'not_synced') return `Sync ${row.name}`;
  return `Confirm due time for ${row.name}`;
}

export function buildTopActions(studentData, limit = 3) {
  return getAssignmentEvidence(studentData)
    .filter((row) => actionPriority(row) < 99)
    .sort((left, right) => {
      const priority = actionPriority(left) - actionPriority(right);
      if (priority !== 0) return priority;
      const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      if (leftDue !== rightDue) return leftDue - rightDue;
      return String(left.assignmentId).localeCompare(String(right.assignmentId));
    })
    .slice(0, Math.max(0, limit))
    .map((row) => {
      const meta = getEvidenceStatusMeta(row.evidenceStatus, row);
      const due = row.dueAt ? `Due ${formatCourseDateTime(row.dueAt)}` : 'Due time unavailable';
      const impact = row.maxPoints == null
        ? 'Point impact unavailable'
        : `Up to ${formatPoints(row.maxPoints)} points`;
      return {
        key: `${row.assignmentId}-${row.evidenceStatus}`,
        assignmentId: row.assignmentId,
        title: actionTitle(row),
        detail: `${meta.reason} ${due}. ${impact}.`,
        to: buildLedgerHref({
          category: row.category,
          status: row.evidenceStatus,
          search: row.name,
        }),
        evidence: row,
      };
    });
}

export function buildRecentSignals(studentData, limit = 8) {
  return getAssignmentEvidence(studentData)
    .filter((row) => ['missing', 'earned_zero', 'request_error', 'not_synced', 'due_unknown'].includes(row.evidenceStatus) || row.isLate)
    .sort((left, right) => (
      actionPriority(left) - actionPriority(right)
      || String(left.assignmentId).localeCompare(String(right.assignmentId))
    ))
    .slice(0, Math.max(0, limit));
}

export function mergeExperienceQuery(search = '', updates = {}) {
  const params = new URLSearchParams(search);
  Object.entries(updates).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '' || value === 'all') {
      params.delete(key);
    } else {
      params.set(key, String(value));
    }
  });
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function parseCategoryPageQuery(search = '', pageKey = '') {
  const params = new URLSearchParams(search);
  const requestedStatus = params.get('status');
  const requestedTab = params.get('tab');
  return {
    status: STATUS_SET.has(requestedStatus) ? requestedStatus : 'all',
    tab: pageKey === 'labs' && LAB_TABS.includes(requestedTab) ? requestedTab : 'overview',
  };
}

export function parseExamMode(search = '') {
  const requested = new URLSearchParams(search).get('mode');
  const normalized = requested === 'question-best' ? 'question_best' : requested;
  return EXAM_MODES.includes(normalized) ? normalized : 'clobber';
}

export function parseExamSelection(search = '') {
  const requested = new URLSearchParams(search).get('exam');
  return EXAM_KEYS.includes(requested) ? requested : 'quest';
}

export function parseLedgerQuery(search = '', rows = []) {
  const params = new URLSearchParams(search);
  const requestedCategory = params.get('category');
  const categories = new Set(rows.map((row) => row.category).filter(Boolean));
  const requestedStatus = params.get('status');
  const requestedGroup = params.get('group');
  return {
    category: requestedCategory && categories.has(requestedCategory) ? requestedCategory : 'all',
    status: STATUS_SET.has(requestedStatus) ? requestedStatus : 'all',
    search: params.get('search') || '',
    group: LEDGER_GROUPS.includes(requestedGroup) ? requestedGroup : 'category',
  };
}

export function filterLedgerRows(rows = [], queryState = {}) {
  const query = normalizeText(queryState.search);
  return rows.filter((row) => (
    (queryState.category === 'all' || !queryState.category || row.category === queryState.category)
    && (queryState.status === 'all' || !queryState.status || row.evidenceStatus === queryState.status)
    && (!query || normalizeText(`${row.assignmentId} ${row.category} ${row.name}`).includes(query))
  ));
}

export function getLedgerGroupLabel(row, group) {
  if (group === 'status') return getEvidenceStatusMeta(row.evidenceStatus, row).label;
  if (group === 'time') {
    const dateValue = row.dueAt || row.submissionTime;
    if (!dateValue) return 'Time unavailable';
    const formatted = formatCourseDateTime(dateValue);
    return formatted.split(', ').slice(0, 2).join(', ');
  }
  if (group === 'none') return 'All catalog assignments';
  return row.category || 'Uncategorized';
}

export function sortLedgerRows(rows = [], group = 'category') {
  return [...rows].sort((left, right) => {
    const groupCompare = getLedgerGroupLabel(left, group).localeCompare(
      getLedgerGroupLabel(right, group),
      undefined,
      { numeric: true, sensitivity: 'base' },
    );
    if (groupCompare !== 0) return groupCompare;
    const nameCompare = String(left.name || '').localeCompare(String(right.name || ''), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
    if (nameCompare !== 0) return nameCompare;
    return String(left.assignmentId).localeCompare(String(right.assignmentId));
  });
}

function escapeCsv(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildLedgerCsv(rows = []) {
  const headers = [
    'Assignment ID',
    'Category',
    'Assignment',
    'Evidence Status',
    'Score',
    'Recorded Score',
    'Max Points',
    `Due (${COURSE_TIME_ZONE})`,
    `Submitted (${COURSE_TIME_ZONE})`,
    'Source Sync',
    'Request Error',
  ];
  const lines = rows.map((row) => [
    row.assignmentId,
    row.category,
    row.name,
    row.evidenceStatus,
    row.score,
    row.recordedScore,
    row.maxPoints,
    row.dueAt ? formatCourseDateTime(row.dueAt) : '',
    row.submissionTime ? formatCourseDateTime(row.submissionTime) : '',
    row.sourceSyncStatus || '',
    row.requestError || '',
  ].map(escapeCsv).join(','));
  return [headers.map(escapeCsv).join(','), ...lines].join('\r\n');
}

export function getExamRows(studentData, examKey) {
  return (Array.isArray(studentData?.examPolicyRows) ? studentData.examPolicyRows : [])
    .filter((row) => normalizeText(row?.examType) === examKey)
    .sort((left, right) => (optionalNumber(left?.attemptNo) ?? 0) - (optionalNumber(right?.attemptNo) ?? 0));
}

export function getExamTrend(studentData, examKey) {
  const trends = studentData?.examComponentTrends || {};
  const trend = trends[examKey] || (examKey === 'quest' ? studentData?.questComponentTrend : null) || {};
  return {
    components: Array.isArray(trend.components) ? trend.components : [],
    componentCaps: Array.isArray(trend.componentCaps) ? trend.componentCaps : [],
    series: Array.isArray(trend.series) ? trend.series : [],
  };
}

export function getBestExamRow(rows = []) {
  if (rows.length === 0) return null;
  return [...rows].sort((left, right) => (
    (optionalNumber(right?.finalPercentage) ?? -1) - (optionalNumber(left?.finalPercentage) ?? -1)
  ))[0];
}

export function getExamDiagnosticPercentage(row, mode) {
  if (!row) return null;
  if (mode === 'raw') return optionalNumber(row.rawPercentage);
  if (mode === 'question_best') return optionalNumber(row.questionBestPercentage);
  return optionalNumber(row.finalPercentage ?? row.clobberedPercentage);
}

export function percentageToPoints(percentage, cap) {
  const numericPercentage = optionalNumber(percentage);
  const numericCap = optionalNumber(cap);
  if (numericPercentage == null || numericCap == null || numericCap <= 0) return null;
  return (Math.max(0, Math.min(100, numericPercentage)) / 100) * numericCap;
}

export function getActualClobberRows(rows = []) {
  return rows.filter((row) => {
    if (!row?.clobberSourceTitle) return false;
    const before = optionalNumber(row.questionBestPercentage ?? row.rawPercentage);
    const after = optionalNumber(row.finalPercentage ?? row.clobberedPercentage);
    return before != null && after != null && after - before > 0.01;
  });
}

export function formatAttemptCount(count) {
  const numeric = Number(count) || 0;
  return `${numeric} attempt${numeric === 1 ? '' : 's'}`;
}
