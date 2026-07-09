import apiv2 from './apiv2';
import { cachedApiGet } from './apiCache';
import {
  processStudentData,
  applyExamPolicyToProcessedData,
  buildQuestComponentTrendFallback,
  buildQuestComponentTrendFromAssignments,
} from './studentDataProcessor';
import { isAssignmentDue } from './assignmentDue';

export function resolveCourseQueryId(courseId, courses = []) {
  if (!courseId) return '';
  const matchedCourse = courses.find((course) => String(course.id) === String(courseId));
  return matchedCourse?.gradescope_course_id || courseId;
}

export function applyCanonicalSummaryTotals(processedData, summarySectionTotals = {}) {
  if (!processedData || typeof processedData !== 'object') {
    return processedData;
  }

  const next = {
    ...processedData,
    categoriesData: { ...(processedData.categoriesData || {}) },
  };
  const hasDueScopedAssignments = Array.isArray(next.assignmentsList);

  Object.entries(summarySectionTotals || {}).forEach(([rawSectionName, rawScore]) => {
    if (!rawSectionName) return;
    const sectionName = String(rawSectionName).replace(/\s*\([^)]*\)\s*$/, '').trim() || rawSectionName;
    if (sectionName.startsWith('_')) return;
    const score = Number(rawScore);
    if (!Number.isFinite(score)) return;

    const existing = next.categoriesData[sectionName] || {};
    const cap = Number(existing.capPoints ?? existing.maxPoints) || 0;
    if (cap <= 0 && !next.categoriesData[sectionName]) return;
    const canonicalScore = cap > 0 ? Math.min(score, cap) : score;
    const dueScopedScore = Number(existing.total);
    const cappedScore = hasDueScopedAssignments && Number.isFinite(dueScopedScore)
      ? Math.min(canonicalScore, Math.max(0, dueScopedScore))
      : canonicalScore;

    next.categoriesData[sectionName] = {
      ...existing,
      total: cappedScore,
      rawTotal: score,
      percentage: cap > 0 ? (cappedScore / cap) * 100 : 0,
    };
  });

  const categoryEntries = Object.entries(next.categoriesData);
  const totalScore = categoryEntries.reduce((sum, [, category]) => sum + (Number(category.total) || 0), 0);

  next.totalScore = totalScore;
  if (!(Number(next.totalCapPoints) > 0)) {
    next.totalCapPoints = categoryEntries.reduce((sum, [, category]) => {
      const cap = Number(category.capPoints ?? category.maxPoints) || 0;
      return sum + cap;
    }, 0);
  }
  next.overallPercentage = next.totalCapPoints > 0 ? (next.totalScore / next.totalCapPoints) * 100 : 0;

  next.radarData = categoryEntries.map(([category, categoryData]) => {
    const categoryScore = Number(categoryData.total) || 0;
    const cap = Number(categoryData.capPoints ?? categoryData.maxPoints) || 0;
    return {
      category,
      percentage: cap > 0 ? Number(((categoryScore / cap) * 100).toFixed(2)) : 0,
      score: Number(categoryScore.toFixed(2)),
      maxPoints: Number(cap.toFixed(2)),
      average: 0,
      fullMark: 100,
    };
  });

  return next;
}

function buildCourseQuery(courseId) {
  return courseId ? `?course_id=${encodeURIComponent(courseId)}` : '';
}

function appendQuery(path, params = {}) {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return query ? `${path}?${query}` : path;
}

function isRollupSubmission(submission) {
  const category = String(submission?.category || '').trim().toLowerCase();
  const name = String(submission?.name || '').trim().toLowerCase();
  if (!category || !name || category !== name) return false;
  return (
    category.includes('attendance')
    || category.includes('lab')
    || category.includes('project')
  );
}

function buildRawAssignments(rawSubmissions = []) {
  return rawSubmissions
    .filter((submission) => {
      const category = String(submission?.category || '').trim();
      const normalizedCategory = category.toLowerCase();
      const name = String(submission?.name || '').trim();
      if (!name || !category || normalizedCategory === 'uncategorized' || normalizedCategory.startsWith('_')) return false;
      if (isRollupSubmission(submission)) return false;
      if (!isAssignmentDue(submission)) return false;
      return Number(submission?.maxPoints) > 0;
    })
    .map((submission) => {
      const score = Number(submission.score) || 0;
      const maxPoints = Number(submission.maxPoints) || 0;
      return {
        category: submission.category,
        name: submission.name,
        score,
        maxPoints,
        capPoints: maxPoints,
        percentage: maxPoints > 0 ? (score / maxPoints) * 100 : 0,
        submissionTime: submission.submissionTime,
        lateness: submission.lateness,
        dueAt: submission.dueAt,
        releaseAt: submission.releaseAt,
      };
    });
}

function normalizeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function inferCategoryBlockType(key = '', label = '') {
  const text = `${key} ${label}`.toLowerCase();
  if (text.includes('attendance') || text.includes('participation') || text.includes('attendence')) return 'attendance';
  if (text.includes('lab')) return 'labs';
  if (text.includes('project')) return 'projects';
  if (text.includes('quest') || text.includes('midterm') || text.includes('postterm') || text.includes('posterm')) return 'exam';
  return 'default';
}

function normalizeCategoryBlocks(payloadBlocks = [], processedData = null) {
  if (Array.isArray(payloadBlocks) && payloadBlocks.length > 0) {
    return payloadBlocks.map((block) => {
      const score = normalizeNumber(block?.score);
      const cap = normalizeNumber(block?.cap);
      const percentage = cap > 0
        ? normalizeNumber(block?.percentage, (score / cap) * 100)
        : normalizeNumber(block?.percentage);

      return {
        key: String(block?.key || block?.label || '').trim(),
        type: block?.type || inferCategoryBlockType(block?.key, block?.label),
        label: String(block?.label || block?.key || 'Category').trim(),
        score,
        cap,
        rawScore: normalizeNumber(block?.rawScore, score),
        percentage,
        status: block?.status || 'default',
        summary: {
          totalItems: normalizeNumber(block?.summary?.totalItems),
          submittedItems: normalizeNumber(block?.summary?.submittedItems),
          missingItems: normalizeNumber(block?.summary?.missingItems),
          rawScore: normalizeNumber(block?.summary?.rawScore),
          rawMax: normalizeNumber(block?.summary?.rawMax),
          rawPercentage: normalizeNumber(block?.summary?.rawPercentage),
          recentItems: Array.isArray(block?.summary?.recentItems) ? block.summary.recentItems : [],
        },
        exam: block?.exam || null,
        componentTrendAvailable: Boolean(block?.componentTrendAvailable),
      };
    });
  }

  return Object.entries(processedData?.categoriesData || {})
    .filter(([category, data]) => {
      const normalized = String(category || '').trim().toLowerCase();
      return normalized && !normalized.startsWith('_') && normalizeNumber(data?.capPoints ?? data?.maxPoints) > 0;
    })
    .map(([category, data]) => {
      const score = normalizeNumber(data?.total);
      const cap = normalizeNumber(data?.capPoints ?? data?.maxPoints);
      return {
        key: category.toLowerCase().replace(/\s+/g, '-'),
        type: inferCategoryBlockType(category, category),
        label: category,
        score,
        cap,
        rawScore: score,
        percentage: cap > 0 ? (score / cap) * 100 : 0,
        status: 'default',
        summary: {
          totalItems: 0,
          submittedItems: 0,
          missingItems: 0,
          rawScore: 0,
          rawMax: 0,
          rawPercentage: 0,
          recentItems: [],
        },
        exam: null,
        componentTrendAvailable: false,
      };
    });
}

export function buildStudentProfileData(payload, studentEmail, studentName) {
  const data = payload?.grades || {};
  const rawSubmissions = Array.isArray(payload?.rawGrades?.submissions)
    ? payload.rawGrades.submissions
    : [];
  const classAverages = payload?.categoryStats || {};
  const policyRows = Array.isArray(payload?.examPolicy?.rows) ? payload.examPolicy.rows : [];
  const summarySectionTotals = payload?.summary?.summarySectionTotals || {};
  const binsData = payload?.bins || {};
  const gradingConfig = {
    assignmentPoints: binsData.assignment_points || {},
    totalCoursePoints:
      Number(binsData.overall_cap_points)
      || Number(binsData.total_points_cap)
      || Number(binsData.total_course_points)
      || 0,
    gradeBins: Array.isArray(binsData.bins) ? binsData.bins : [],
    roundingPolicy: binsData.rounding_policy || '',
  };

  const processedBase = processStudentData(data, studentEmail, studentName, undefined, classAverages, gradingConfig);
  const processedWithPolicy = applyExamPolicyToProcessedData(processedBase, policyRows, gradingConfig);
  const processed = applyCanonicalSummaryTotals(processedWithPolicy, summarySectionTotals);
  if (!processed) return null;

  const rawAssignmentsList = buildRawAssignments(rawSubmissions);
  const rawTrendData = rawAssignmentsList.map((assignment, idx) => ({
    index: idx + 1,
    name: `${assignment.category}-${assignment.name}`,
    percentage: assignment.percentage,
    category: assignment.category,
    score: assignment.score,
    maxPoints: assignment.maxPoints,
    submissionTime: assignment.submissionTime,
    dueAt: assignment.dueAt,
  }));

  const examComponentTrendsFromApi = payload?.examPolicy?.examComponentTrends || {};
  const trendFromApi = examComponentTrendsFromApi.quest || payload?.examPolicy?.questComponentTrend;
  const trendFromPolicy = buildQuestComponentTrendFallback(policyRows);
  const trendFromAssignments = buildQuestComponentTrendFromAssignments(processed?.assignmentsList || []);
  const hasTrendSeries = (trend) => Array.isArray(trend?.series) && trend.series.length > 0;
  const questComponentTrend = hasTrendSeries(trendFromApi)
    ? trendFromApi
    : (hasTrendSeries(trendFromPolicy) ? trendFromPolicy : trendFromAssignments);

  return {
    ...processed,
    rawAssignmentsList,
    rawTrendData,
    gradeBins: gradingConfig.gradeBins,
    roundingPolicy: gradingConfig.roundingPolicy,
    examPolicyRows: policyRows,
    questComponentTrend,
    examComponentTrends: {
      ...examComponentTrendsFromApi,
      quest: questComponentTrend,
    },
    categoryBlocks: normalizeCategoryBlocks(payload?.categoryBlocks, processed),
    gradeFlow: payload?.gradeFlow || null,
  };
}

async function fetchLegacyStudentProfilePayload(studentEmail, selectedCourse, courses = [], signal) {
  const queryCourseId = resolveCourseQueryId(selectedCourse, courses);
  const courseQuery = buildCourseQuery(queryCourseId);
  const gradesPath = `/students/${encodeURIComponent(studentEmail)}/grades?format=db${queryCourseId ? `&course_id=${encodeURIComponent(queryCourseId)}` : ''}`;

  const [
    gradesRes,
    rawGradesRes,
    statsRes,
    binsRes,
    policyRes,
    summaryRes,
  ] = await Promise.all([
    apiv2.get(gradesPath, { signal }),
    apiv2.get(`${gradesPath}&sort=time`, { signal }),
    apiv2.get(`/students/category-stats${courseQuery}`, { signal }).catch(() => ({ data: {} })),
    apiv2.get(`/bins${courseQuery}`, { signal }),
    apiv2.get(`/students/${encodeURIComponent(studentEmail)}/exam-policy${courseQuery}`, { signal }),
    apiv2.get(`/admin/studentScores/summary/${encodeURIComponent(studentEmail)}${courseQuery}`, { signal }).catch(() => ({
      data: { summarySectionTotals: {} },
    })),
  ]);

  return {
    grades: gradesRes.data,
    rawGrades: rawGradesRes.data,
    categoryStats: statsRes.data,
    bins: binsRes.data,
    examPolicy: policyRes.data,
    summary: summaryRes.data,
    gradeFlow: null,
  };
}

export async function fetchStudentProfileData({
  studentEmail,
  studentName,
  selectedCourse,
  courses = [],
  includeGradeFlow = false,
  signal,
}) {
  const queryCourseId = resolveCourseQueryId(selectedCourse, courses);
  const aggregatePath = appendQuery(`/students/${encodeURIComponent(studentEmail)}/profile`, {
    course_id: queryCourseId,
    include_grade_flow: includeGradeFlow ? '1' : '',
  });

  let payload;
  try {
    const profileRes = await cachedApiGet(aggregatePath, {
      ttlMs: 45000,
      config: { signal },
    });
    payload = profileRes.data;
  } catch (err) {
    if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') throw err;
    payload = await fetchLegacyStudentProfilePayload(studentEmail, selectedCourse, courses, signal);
  }

  return buildStudentProfileData(payload, studentEmail, studentName);
}

export async function fetchStudentGradeFlow({
  studentEmail,
  selectedCourse,
  courses = [],
  signal,
}) {
  const queryCourseId = resolveCourseQueryId(selectedCourse, courses);
  const courseQuery = buildCourseQuery(queryCourseId);
  const gradeFlowRes = await cachedApiGet(
    `/students/${encodeURIComponent(studentEmail)}/grade-flow${courseQuery}`,
    {
      ttlMs: 45000,
      config: { signal },
    },
  );
  return gradeFlowRes.data || null;
}
