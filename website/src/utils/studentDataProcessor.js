// src/utils/studentDataProcessor.js

/**
 * Process student grades data into structured format for display
 * @param {Object} data - Raw grades data from API
 * @param {string} email - Student email
 * @param {string} name - Student name
 * @param {string} sortMode - 'assignment' or 'time'
 * @param {Object} classAverages - Class average percentages by category
 * @returns {Object} Processed student data
 */
export function processStudentData(data, email, name, sortMode = 'assignment', classAverages = {}, gradingConfig = {}) {
  if (!data || Object.keys(data).length === 0) return null;

  // Handle time-sorted data format
  if (sortMode === 'time' && data.sortBy === 'time' && Array.isArray(data.submissions)) {
    return processTimeSortedData(data.submissions, email, name, classAverages, gradingConfig);
  }

  // Handle assignment-sorted data format (original)
  return processAssignmentSortedData(data, email, name, classAverages, gradingConfig);
}

function roundUpPoints(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.ceil(numeric);
}

function normalizePointsMap(assignmentPoints = {}) {
  return Object.entries(assignmentPoints || {}).reduce((acc, [key, value]) => {
    const normalizedKey = String(key || '').trim().toLowerCase();
    if (!normalizedKey) return acc;
    acc[normalizedKey] = Number(value) || 0;
    return acc;
  }, {});
}

function getPointsForName(name, pointsMap) {
  const normalizedName = String(name || '').trim().toLowerCase();
  if (!normalizedName) return 0;
  return Number(pointsMap[normalizedName]) || 0;
}

function calculateUniqueAssignmentCapSum(scores = []) {
  const capByAssignment = new Map();

  (Array.isArray(scores) ? scores : []).forEach((item) => {
    const assignmentKey = String(item?.name || '').trim().toLowerCase();
    if (!assignmentKey) return;
    const capPoints = Number(item?.capPoints) || 0;
    const previous = Number(capByAssignment.get(assignmentKey)) || 0;
    capByAssignment.set(assignmentKey, Math.max(previous, capPoints));
  });

  return Array.from(capByAssignment.values()).reduce((sum, cap) => sum + cap, 0);
}

function calculateCategoryCapFromBins(categoryName, scores = [], pointsMap = {}) {
  const normalizedCategory = String(categoryName || '').trim().toLowerCase();
  if (!normalizedCategory) return 0;

  const directCategoryCap = getPointsForName(normalizedCategory, pointsMap);
  if (directCategoryCap > 0) {
    return directCategoryCap;
  }

  if (normalizedCategory.includes('project')) {
    const projectCapSum = Object.entries(pointsMap).reduce((sum, [name, value]) => {
      if (String(name).includes('project')) {
        return sum + (Number(value) || 0);
      }
      return sum;
    }, 0);

    if (projectCapSum > 0) {
      return projectCapSum;
    }
  }

  const uniqueAssignmentCapsFromBins = new Map();
  (Array.isArray(scores) ? scores : []).forEach((item) => {
    const assignmentName = String(item?.name || '').trim();
    if (!assignmentName) return;
    const normalizedAssignment = assignmentName.toLowerCase();
    const pointsFromBins = Number(pointsMap[normalizedAssignment]) || 0;
    if (pointsFromBins <= 0) return;

    const existing = Number(uniqueAssignmentCapsFromBins.get(normalizedAssignment)) || 0;
    uniqueAssignmentCapsFromBins.set(normalizedAssignment, Math.max(existing, pointsFromBins));
  });

  return Array.from(uniqueAssignmentCapsFromBins.values()).reduce((sum, cap) => sum + cap, 0);
}

function isAttendanceCategory(categoryName = '') {
  const normalized = String(categoryName).trim().toLowerCase();
  return normalized.includes('attendance');
}

function normalizeAssignmentScore(category, rawScore, rawMaxPoints) {
  if (isAttendanceCategory(category)) {
    return {
      score: rawScore > 0 ? 1 : 0,
      maxPoints: 1,
    };
  }

  return {
    score: rawScore,
    maxPoints: rawMaxPoints,
  };
}

/**
 * Process time-sorted submission data
 * @param {Array} submissions - Array of submissions
 * @param {string} email - Student email
 * @param {string} name - Student name
 * @param {Object} classAverages - Class average percentages by category
 */
function processTimeSortedData(submissions, email, name, classAverages = {}, gradingConfig = {}) {
  const categoriesData = {};
  const assignmentsList = [];
  let totalScore = 0;
  let totalMaxPoints = 0;
  const pointsMap = normalizePointsMap(gradingConfig.assignmentPoints);

  submissions.forEach((submission) => {
    const category = submission.category;
    const assignmentName = submission.name;
    const rawScore = roundUpPoints(parseFloat(submission.score) || 0);
    const rawMaxPoints = parseFloat(submission.maxPoints) || 0;
    const normalized = normalizeAssignmentScore(category, rawScore, rawMaxPoints);
    const score = normalized.score;
    const maxPoints = normalized.maxPoints;
    const percentage = maxPoints > 0 ? (score / maxPoints) * 100 : 0;
    const submissionTime = submission.submissionTime;
    const lateness = submission.lateness;

    // Skip Uncategorized assignments
    if (category === 'Uncategorized' || category === 'uncategorized') {
      return;
    }

    if (maxPoints > 0) {
      // Add to assignments list with time info
      const configuredAssignmentCap = getPointsForName(assignmentName, pointsMap);

      assignmentsList.push({
        category: category,
        name: assignmentName,
        score: score,
        maxPoints: maxPoints,
        capPoints: configuredAssignmentCap > 0 ? configuredAssignmentCap : maxPoints,
        percentage: percentage,
        submissionTime: submissionTime,
        lateness: lateness,
      });

      // Update category data
      if (!categoriesData[category]) {
        categoriesData[category] = {
          scores: [],
          total: 0,
          maxPoints: 0,
          count: 0,
        };
      }

      categoriesData[category].scores.push({
        name: assignmentName,
        score: score,
        maxPoints: maxPoints,
        capPoints: configuredAssignmentCap > 0 ? configuredAssignmentCap : maxPoints,
        percentage: percentage,
      });
      categoriesData[category].total += score;
      categoriesData[category].maxPoints += maxPoints;
      categoriesData[category].count++;
      totalMaxPoints += maxPoints;
    }
  });

  // Calculate category percentages and averages
  Object.keys(categoriesData).forEach(category => {
    const data = categoriesData[category];
    const configuredCategoryCap = calculateCategoryCapFromBins(category, data.scores, pointsMap);
    const assignmentCapSum = calculateUniqueAssignmentCapSum(data.scores);
    const categoryCap = configuredCategoryCap > 0
      ? configuredCategoryCap
      : (assignmentCapSum > 0 ? assignmentCapSum : data.maxPoints);

    const cappedTotal = categoryCap > 0
      ? Math.min(data.total, categoryCap)
      : data.total;

    data.capPoints = categoryCap;
    data.rawTotal = data.total;
    data.total = cappedTotal;
    data.percentage = categoryCap > 0 ? (cappedTotal / categoryCap) * 100 : 0;
    data.average = data.count > 0 ? data.total / data.count : 0;

    totalScore += cappedTotal;
  });

  const categoryPercentages = Object.values(categoriesData).map(d => d.percentage);
  const overallAvg = categoryPercentages.length > 0 
    ? parseFloat((categoryPercentages.reduce((sum, p) => sum + p, 0) / categoryPercentages.length).toFixed(2))
    : 0;

  const radarData = Object.entries(categoriesData).map(([category, data]) => ({
    category: category,
    percentage: parseFloat(data.percentage.toFixed(2)),
    score: parseFloat(data.total.toFixed(2)),
    maxPoints: parseFloat((data.capPoints ?? data.maxPoints).toFixed(2)),
    average: classAverages[category] || 0,
    fullMark: 100,
  }));

  const trendData = assignmentsList.map((a, idx) => ({
    index: idx + 1,
    name: `${a.category}-${a.name}`,
    percentage: a.percentage,
    category: a.category,
    submissionTime: a.submissionTime, // Include submission time for tooltip
  }));

  const totalCapPoints = Number(gradingConfig.totalCoursePoints) > 0
    ? Number(gradingConfig.totalCoursePoints)
    : totalMaxPoints;

  return {
    email: email,
    name: name,
    totalScore: totalScore,
    totalMaxPoints: totalMaxPoints,
    totalCapPoints,
    overallPercentage: totalCapPoints > 0 ? (totalScore / totalCapPoints) * 100 : 0,
    categoriesData: categoriesData,
    assignmentsList: assignmentsList,
    radarData: radarData,
    trendData: trendData,
  };
}

/**
 * Process assignment-sorted data (original logic)
 * @param {Object} data - Grades data grouped by category
 * @param {string} email - Student email
 * @param {string} name - Student name
 * @param {Object} classAverages - Class average percentages by category
 */
function processAssignmentSortedData(data, email, name, classAverages = {}, gradingConfig = {}) {
  const categoriesData = {};
  const assignmentsList = [];
  let totalScore = 0;
  let totalMaxPoints = 0;
  const pointsMap = normalizePointsMap(gradingConfig.assignmentPoints);

  Object.entries(data).forEach(([category, assignments]) => {
    // Skip Uncategorized assignments
    if (category === 'Uncategorized' || category === 'uncategorized') {
      return;
    }

    const categoryScores = [];
    let categoryTotal = 0;
    let categoryMax = 0;
    let categoryCount = 0;

    Object.entries(assignments).forEach(([assignmentName, assignmentData]) => {
      const rawScore = roundUpPoints(parseFloat(assignmentData.student) || 0);
      const rawMaxPoints = parseFloat(assignmentData.max) || 0;
      const normalized = normalizeAssignmentScore(category, rawScore, rawMaxPoints);
      const score = normalized.score;
      const maxPoints = normalized.maxPoints;
      const submissionTime = assignmentData.submissionTime;
      const lateness = assignmentData.lateness;
      
      if (maxPoints > 0) {
        const configuredAssignmentCap = getPointsForName(assignmentName, pointsMap);

        categoryScores.push({
          name: assignmentName,
          score: score,
          maxPoints: maxPoints,
          capPoints: configuredAssignmentCap > 0 ? configuredAssignmentCap : maxPoints,
          percentage: (score / maxPoints) * 100,
        });
        
        categoryTotal += score;
        categoryMax += maxPoints;
        categoryCount++;

        assignmentsList.push({
          category: category,
          name: assignmentName,
          score: score,
          maxPoints: maxPoints,
          capPoints: configuredAssignmentCap > 0 ? configuredAssignmentCap : maxPoints,
          percentage: (score / maxPoints) * 100,
          submissionTime: submissionTime,
          lateness: lateness,
        });
      }
    });

    if (categoryMax > 0) {
      const configuredCategoryCap = calculateCategoryCapFromBins(category, categoryScores, pointsMap);
      const assignmentCapSum = calculateUniqueAssignmentCapSum(categoryScores);
      const categoryCap = configuredCategoryCap > 0
        ? configuredCategoryCap
        : (assignmentCapSum > 0 ? assignmentCapSum : categoryMax);

      categoriesData[category] = {
        scores: categoryScores,
        total: categoryTotal,
        maxPoints: categoryMax,
        capPoints: categoryCap,
        percentage: categoryCap > 0 ? (categoryTotal / categoryCap) * 100 : 0,
        count: categoryCount,
        average: categoryCount > 0 ? categoryTotal / categoryCount : 0,
      };

      totalMaxPoints += categoryMax;
    }
  });

  Object.keys(categoriesData).forEach(category => {
    const categoryData = categoriesData[category];
    const categoryCap = Number(categoryData.capPoints) || 0;
    const cappedTotal = categoryCap > 0
      ? Math.min(categoryData.total, categoryCap)
      : categoryData.total;

    categoryData.rawTotal = categoryData.total;
    categoryData.total = cappedTotal;
    categoryData.percentage = categoryCap > 0 ? (cappedTotal / categoryCap) * 100 : 0;

    totalScore += cappedTotal;
  });

  const categoryPercentages = Object.values(categoriesData).map(d => d.percentage);
  const overallAvg = categoryPercentages.length > 0 
    ? parseFloat((categoryPercentages.reduce((sum, p) => sum + p, 0) / categoryPercentages.length).toFixed(2))
    : 0;

  const radarData = Object.entries(categoriesData).map(([category, data]) => ({
    category: category,
    percentage: parseFloat(data.percentage.toFixed(2)),
    score: parseFloat(data.total.toFixed(2)),
    maxPoints: parseFloat((data.capPoints ?? data.maxPoints).toFixed(2)),
    average: classAverages[category] || 0,
    fullMark: 100,
  }));

  const trendData = assignmentsList.map((a, idx) => ({
    index: idx + 1,
    name: `${a.category}-${a.name}`,
    percentage: a.percentage,
    category: a.category,
    submissionTime: a.submissionTime || null, // Include for consistency
  }));

  const totalCapPoints = Number(gradingConfig.totalCoursePoints) > 0
    ? Number(gradingConfig.totalCoursePoints)
    : totalMaxPoints;

  return {
    email: email,
    name: name,
    totalScore: totalScore,
    totalMaxPoints: totalMaxPoints,
    totalCapPoints,
    overallPercentage: totalCapPoints > 0 ? (totalScore / totalCapPoints) * 100 : 0,
    categoriesData: categoriesData,
    assignmentsList: assignmentsList,
    radarData: radarData,
    trendData: trendData,
  };
}

function getBestCategoryPercentageFromAssignments(processedData, categoryName) {
  const assignments = Array.isArray(processedData?.assignmentsList) ? processedData.assignmentsList : [];
  const target = String(categoryName || '').trim().toLowerCase();
  const percentages = assignments
    .filter((assignment) => String(assignment?.category || '').trim().toLowerCase() === target)
    .map((assignment) => Number(assignment?.percentage))
    .filter((value) => Number.isFinite(value));

  if (percentages.length === 0) {
    return null;
  }

  return Math.max(...percentages);
}

export function applyExamPolicyToProcessedData(processedData, examPolicyRows = [], gradingConfig = {}) {
  if (!processedData) {
    return processedData;
  }

  const policyRows = Array.isArray(examPolicyRows) ? examPolicyRows : [];

  const pointsMap = normalizePointsMap(gradingConfig.assignmentPoints);
  const componentCaps = {
    quest: getPointsForName('Quest', pointsMap),
    midterm: getPointsForName('Midterm', pointsMap),
    postterm: getPointsForName('Postterm', pointsMap),
  };

  const bestPercentages = {};
  policyRows.forEach((row) => {
    const type = String(row?.examType || '').trim().toLowerCase();
    if (!['quest', 'midterm', 'postterm'].includes(type)) {
      return;
    }
    const sourcePercentage = type === 'quest'
      ? Number(row?.questionBestPercentage)
      : Number(row?.finalPercentage);
    if (!Number.isFinite(sourcePercentage)) {
      return;
    }
    if (bestPercentages[type] == null || sourcePercentage > bestPercentages[type]) {
      bestPercentages[type] = sourcePercentage;
    }
  });

  const categoryNames = {
    quest: 'Quest',
    midterm: 'Midterm',
    postterm: 'Postterm',
  };

  const fallbackPercentages = {
    quest: getBestCategoryPercentageFromAssignments(processedData, 'Quest'),
    midterm: getBestCategoryPercentageFromAssignments(processedData, 'Midterm'),
    postterm: getBestCategoryPercentageFromAssignments(processedData, 'Postterm'),
  };

  if (!processedData.categoriesData) {
    processedData.categoriesData = {};
  }

  let changed = false;
  Object.entries(categoryNames).forEach(([type, categoryName]) => {
    const bestPct = Number.isFinite(bestPercentages[type])
      ? bestPercentages[type]
      : fallbackPercentages[type];
    if (!Number.isFinite(bestPct)) {
      return;
    }

    const cap = Number(componentCaps[type]) || 0;
    if (cap <= 0) return;

    const existing = processedData.categoriesData[categoryName] || {};
    const rawScore = (bestPct / 100) * cap;
    const score = Math.min(cap, roundUpPoints(rawScore));

    processedData.categoriesData[categoryName] = {
      ...existing,
      total: score,
      rawTotal: score,
      maxPoints: cap,
      capPoints: cap,
      percentage: cap > 0 ? (score / cap) * 100 : 0,
      count: existing.count ?? 1,
      average: cap > 0 ? score / (existing.count ?? 1) : 0,
      scores: Array.isArray(existing.scores) ? existing.scores : [],
    };
    changed = true;
  });

  if (!changed) {
    return processedData;
  }

  const categories = Object.entries(processedData.categoriesData);
  const totalScore = categories.reduce((sum, [, category]) => sum + (Number(category.total) || 0), 0);
  const totalMaxPoints = categories.reduce((sum, [, category]) => {
    const cap = Number(category.capPoints ?? category.maxPoints) || 0;
    return sum + cap;
  }, 0);

  const totalCapPoints = Number(processedData.totalCapPoints) > 0
    ? Number(processedData.totalCapPoints)
    : totalMaxPoints;

  processedData.totalScore = roundUpPoints(totalScore);
  processedData.totalMaxPoints = totalMaxPoints;
  processedData.totalCapPoints = totalCapPoints;
  processedData.overallPercentage = totalCapPoints > 0 ? (processedData.totalScore / totalCapPoints) * 100 : 0;
  processedData.radarData = categories.map(([categoryName, category]) => ({
    category: categoryName,
    percentage: parseFloat((Number(category.percentage) || 0).toFixed(2)),
    score: parseFloat((Number(category.total) || 0).toFixed(2)),
    maxPoints: parseFloat((Number(category.capPoints ?? category.maxPoints) || 0).toFixed(2)),
    average: 0,
    fullMark: 100,
  }));

  return processedData;
}

export function buildQuestComponentTrendFallback(examPolicyRows = []) {
  const rows = Array.isArray(examPolicyRows) ? examPolicyRows : [];
  const questRows = rows
    .filter((row) => String(row?.examType || '').trim().toLowerCase() === 'quest')
    .sort((a, b) => Number(a?.attemptNo || 0) - Number(b?.attemptNo || 0));

  const components = [
    'Abstraction',
    'Number Representation',
    'Iteration',
    'Domain and Range',
    'Booleans',
    'Functions',
    'HOFs I',
  ];

  if (questRows.length === 0) {
    return {
      components,
      series: [],
    };
  }

  const pctByAttempt = {
    1: null,
    2: null,
    3: null,
  };

  questRows.forEach((row) => {
    const attemptNo = Number(row?.attemptNo || 0);
    if (![1, 2, 3].includes(attemptNo)) return;
    const raw = Number(row?.rawPercentage);
    if (Number.isFinite(raw)) {
      pctByAttempt[attemptNo] = raw;
    }
  });

  const after1 = Number.isFinite(pctByAttempt[1]) ? pctByAttempt[1] : 0;
  const after2 = Math.max(after1, Number.isFinite(pctByAttempt[2]) ? pctByAttempt[2] : 0);
  const after3 = Math.max(after2, Number.isFinite(pctByAttempt[3]) ? pctByAttempt[3] : 0);

  const fillSeries = (name, value) => ({
    name,
    data: components.map(() => Number(value.toFixed(2))),
  });

  return {
    components,
    series: [
      fillSeries('After Quest-1', after1),
      fillSeries('After Quest-2 (Cumulative Best)', after2),
      fillSeries('After Quest-3 (Cumulative Best)', after3),
    ],
  };
}

export function buildQuestComponentTrendFromAssignments(assignmentsList = []) {
  const assignments = Array.isArray(assignmentsList) ? assignmentsList : [];
  const questAssignments = assignments
    .filter((assignment) => String(assignment?.category || '').trim().toLowerCase() === 'quest')
    .map((assignment) => {
      const name = String(assignment?.name || '');
      const match = name.match(/quest\s*[-:]?\s*(\d+)/i);
      return {
        attemptNo: Number(match?.[1] || 0),
        percentage: Number(assignment?.percentage),
      };
    })
    .filter((item) => [1, 2, 3].includes(item.attemptNo) && Number.isFinite(item.percentage))
    .sort((a, b) => a.attemptNo - b.attemptNo);

  if (questAssignments.length === 0) {
    return { components: [], series: [] };
  }

  const components = [
    'Abstraction',
    'Number Representation',
    'Iteration',
    'Domain and Range',
    'Booleans',
    'Functions',
    'HOFs I',
  ];

  const pctByAttempt = { 1: 0, 2: 0, 3: 0 };
  questAssignments.forEach((item) => {
    pctByAttempt[item.attemptNo] = Math.max(pctByAttempt[item.attemptNo], item.percentage);
  });

  const after1 = pctByAttempt[1] || 0;
  const after2 = Math.max(after1, pctByAttempt[2] || 0);
  const after3 = Math.max(after2, pctByAttempt[3] || 0);

  const fillSeries = (name, value) => ({
    name,
    data: components.map(() => Number(value.toFixed(2))),
  });

  return {
    components,
    series: [
      fillSeries('After Quest-1', after1),
      fillSeries('After Quest-2 (Cumulative Best)', after2),
      fillSeries('After Quest-3 (Cumulative Best)', after3),
    ],
  };
}

/**
 * Get grade level based on percentage
 * @param {number} percentage - Score percentage
 * @returns {Object} Grade info with grade letter and color
 */
export function getGradeLevel(percentage) {
  if (percentage >= 90) return { grade: 'A', color: '#4caf50' };
  if (percentage >= 80) return { grade: 'B', color: '#8bc34a' };
  if (percentage >= 70) return { grade: 'C', color: '#ffc107' };
  if (percentage >= 60) return { grade: 'D', color: '#ff9800' };
  return { grade: 'F', color: '#f44336' };
}
