import { Router } from 'express';
import { IAM_ROLE } from '../../../../lib/iam.mjs';
import {
    getCategoryAverages,
    getCourseAssignmentMatrix,
    getStudentCourses,
    getStudentExamComponentTrends,
    getStudentExamPolicyScores,
    getStudentGradeFlow,
    getStudentPolicySummaries,
    getStudentSubmissionsByTime,
    getStudentSubmissionsGrouped,
    studentEnrolledInCourse,
} from '../../../../lib/dbHelper.mjs';
import { getBinsResponse } from '../../bins/index.js';

const router = Router({ mergeParams: true });

const CATEGORY_BLOCK_CONFIGS = [
    {
        key: 'attendance',
        type: 'attendance',
        label: 'Attendance / Participation',
        cap: 15,
        terms: ['attendance', 'attendence', 'participation', 'lecture quiz', 'discussion'],
    },
    {
        key: 'labs',
        type: 'labs',
        label: 'Labs',
        cap: 80,
        terms: ['lab', 'labs'],
    },
    {
        key: 'projects',
        type: 'projects',
        label: 'Projects',
        cap: 155,
        terms: ['project', 'projects'],
    },
    {
        key: 'quest',
        type: 'exam',
        label: 'Quest',
        cap: 25,
        terms: ['quest'],
    },
    {
        key: 'midterm',
        type: 'exam',
        label: 'Midterm',
        cap: 50,
        terms: ['midterm'],
    },
    {
        key: 'postterm',
        type: 'exam',
        label: 'Postterm',
        cap: 75,
        terms: ['postterm', 'posterm'],
    },
];

function getStudentScoresWithMaxPointsAndTime(studentScores, maxScores) {
    return Object.keys(studentScores || {}).reduce((assignmentsDict, assignment) => {
        assignmentsDict[assignment] = Object.entries(
            studentScores[assignment] || {},
        ).reduce((scoresDict, [category, data]) => {
            const maxScore = maxScores?.[assignment]?.[category] ?? data.max;
            scoresDict[category] = {
                student: data.student,
                max: maxScore,
                submissionTime: data.submissionTime,
                lateness: data.lateness,
                dueAt: data.dueAt,
                releaseAt: data.releaseAt,
            };
            return scoresDict;
        }, {});
        return assignmentsDict;
    }, {});
}

function normalizeText(value = '') {
    return String(value || '').trim().toLowerCase();
}

function includesCategoryTerm(combined = '', term = '') {
    if (term === 'lab' || term === 'labs') return /\blabs?\b/.test(combined);
    if (term === 'project' || term === 'projects') return /\bprojects?\b/.test(combined);
    if (term === 'quest') return /\bquests?\b/.test(combined);
    if (term === 'midterm') return /\bmidterms?\b/.test(combined);
    if (term === 'postterm' || term === 'posterm') return /\bpostt?erms?\b/.test(combined);
    return combined.includes(term);
}

function categoryMatches(category = '', name = '', terms = []) {
    const combined = `${normalizeText(category)} ${normalizeText(name)}`;
    return terms.some((term) => includesCategoryTerm(combined, term));
}

function isHiddenStatsCategory(category = '') {
    const normalized = normalizeText(category);
    return !normalized || normalized === 'uncategorized' || normalized.startsWith('_');
}

function isDueForStats(item = {}, now = Date.now()) {
    const rawDue = item?.dueAt || item?.due_at || item?.due || item?.dueDate || item?.due_date || item?.deadline;
    if (!rawDue) return false;
    const dueTime = new Date(rawDue).getTime();
    if (!Number.isFinite(dueTime)) return false;
    return dueTime <= now;
}

function getSummaryForBlock(summaryByKey = {}, summarySectionTotals = {}, config) {
    const keyed = summaryByKey?.[config.key] || null;
    const rawScore = keyed?.score ?? Object.entries(summarySectionTotals || {}).find(([section]) => (
        categoryMatches(section, '', config.terms)
    ))?.[1];
    const score = Math.min(config.cap, Math.max(0, Number(rawScore) || 0));
    return {
        score,
        cap: config.cap,
        rawScore: Number(keyed?.rawScore ?? rawScore ?? 0) || 0,
        percentage: config.cap > 0 ? (score / config.cap) * 100 : 0,
    };
}

function summarizeAssignments(groupedSubmissions = {}, rawSubmissions = [], terms = []) {
    const items = [];

    Object.entries(groupedSubmissions || {}).forEach(([category, assignments]) => {
        if (isHiddenStatsCategory(category)) return;
        Object.entries(assignments || {}).forEach(([name, data]) => {
            if (!categoryMatches(category, name, terms)) return;
            if (!isDueForStats(data)) return;
            const maxPoints = Number(data?.max) || 0;
            const score = Number(data?.student) || 0;
            const hasSignal = Boolean(data?.submissionTime) || score > 0;
            items.push({
                category,
                name,
                score,
                maxPoints,
                percentage: maxPoints > 0 ? (score / maxPoints) * 100 : 0,
                submissionTime: data?.submissionTime || null,
                lateness: data?.lateness || '',
                submitted: hasSignal,
            });
        });
    });

    const recentItems = (rawSubmissions || [])
        .filter((item) => !isHiddenStatsCategory(item?.category))
        .filter((item) => categoryMatches(item?.category, item?.name, terms))
        .filter((item) => isDueForStats(item))
        .slice(0, 5)
        .map((item) => ({
            category: item.category,
            name: item.name,
            score: Number(item.score) || 0,
            maxPoints: Number(item.maxPoints) || 0,
            percentage: Number(item.percentage) || 0,
            submissionTime: item.submissionTime || null,
            lateness: item.lateness || '',
        }));

    const totalItems = items.length;
    const submittedItems = items.filter((item) => item.submitted).length;
    const missingItems = Math.max(0, totalItems - submittedItems);
    const rawScore = items.reduce((sum, item) => sum + item.score, 0);
    const rawMax = items.reduce((sum, item) => sum + item.maxPoints, 0);

    return {
        totalItems,
        submittedItems,
        missingItems,
        rawScore,
        rawMax,
        rawPercentage: rawMax > 0 ? (rawScore / rawMax) * 100 : 0,
        recentItems,
    };
}

function summarizeExam(policyRows = [], examType = '') {
    const rows = (policyRows || []).filter((row) => normalizeText(row?.examType) === examType);
    const latest = rows[rows.length - 1] || null;
    return {
        attempts: rows.length,
        latestFinalPercentage: latest?.finalPercentage ?? null,
        latestQuestionBestPercentage: latest?.questionBestPercentage ?? null,
        latestRawPercentage: latest?.rawPercentage ?? null,
        clobberedAttempts: rows.filter((row) => row?.clobberSourceTitle).length,
        rows: rows.slice(-4),
    };
}

function getBlockStatus(percentage) {
    const value = Number(percentage) || 0;
    if (value >= 90) return 'excellent';
    if (value >= 75) return 'solid';
    if (value >= 60) return 'watch';
    return 'attention';
}

function clampScoreSummaryToDueWork(scoreSummary, assignmentSummary) {
    if (!assignmentSummary || Number(assignmentSummary.totalItems) <= 0) {
        return {
            ...scoreSummary,
            score: 0,
            rawScore: 0,
            percentage: 0,
        };
    }

    const rawScore = Number(assignmentSummary.rawScore) || 0;
    const rawMax = Number(assignmentSummary.rawMax) || 0;
    const cap = Number(scoreSummary.cap) || 0;
    if (rawMax <= 0 || cap <= 0) return scoreSummary;

    const dueWorkCeiling = Math.min(cap, rawScore);
    const score = Math.min(Number(scoreSummary.score) || 0, dueWorkCeiling);
    return {
        ...scoreSummary,
        score,
        percentage: cap > 0 ? (score / cap) * 100 : 0,
    };
}

function buildCategoryBlocks({
    groupedSubmissions,
    rawSubmissions,
    policyRows,
    summaries,
    examComponentTrends,
}) {
    const summaryByKey = summaries?.summaryByKey || {};
    const summarySectionTotals = summaries?.summarySectionTotals || {};

    return CATEGORY_BLOCK_CONFIGS.map((config) => {
        const assignmentSummary = summarizeAssignments(groupedSubmissions, rawSubmissions, config.terms);
        const scoreSummary = clampScoreSummaryToDueWork(
            getSummaryForBlock(summaryByKey, summarySectionTotals, config),
            assignmentSummary,
        );
        const examSummary = config.type === 'exam'
            ? summarizeExam(policyRows, config.key)
            : null;
        const componentTrend = config.type === 'exam'
            ? examComponentTrends?.[config.key] || null
            : null;

        return {
            key: config.key,
            type: config.type,
            label: config.label,
            score: scoreSummary.score,
            cap: scoreSummary.cap,
            rawScore: scoreSummary.rawScore,
            percentage: scoreSummary.percentage,
            status: getBlockStatus(scoreSummary.percentage),
            summary: assignmentSummary,
            exam: examSummary,
            componentTrendAvailable: Boolean(
                Array.isArray(componentTrend?.components) && componentTrend.components.length > 0
                && Array.isArray(componentTrend?.series) && componentTrend.series.length > 0,
            ),
        };
    });
}

async function resolveEffectiveCourseId(req, email) {
    const requestedCourseId = req.query?.course_id || null;
    const requesterRole = req?.auth?.role;
    const requesterIsPrivileged = [
        IAM_ROLE.SUPER_ADMIN,
        IAM_ROLE.COURSE_ADMIN,
        IAM_ROLE.INSTRUCTOR,
    ].includes(requesterRole);

    if (requestedCourseId && !requesterIsPrivileged) {
        const enrolled = await studentEnrolledInCourse(email, requestedCourseId);
        if (!enrolled) {
            const err = new Error('Access denied for requested course.');
            err.status = 403;
            throw err;
        }
    }

    if (!requestedCourseId && !requesterIsPrivileged) {
        const studentCourses = await getStudentCourses(email);
        const defaultCourseId = studentCourses[0]?.gradescope_course_id || studentCourses[0]?.id;
        return defaultCourseId ? String(defaultCourseId) : null;
    }

    return requestedCourseId ? String(requestedCourseId) : null;
}

router.get('/', async (req, res) => {
    const { email } = req.params;
    const includeGradeFlow = req.query?.include_grade_flow === '1'
        || req.query?.includeGradeFlow === 'true';

    try {
        const effectiveCourseId = await resolveEffectiveCourseId(req, email);

        const groupedSubmissionsPromise = getStudentSubmissionsGrouped(email, effectiveCourseId);
        const assignmentMatrixPromise = getCourseAssignmentMatrix(effectiveCourseId);
        const rawSubmissionsPromise = getStudentSubmissionsByTime(email, effectiveCourseId);
        const categoryAveragesPromise = getCategoryAverages(effectiveCourseId).catch((err) => {
            console.warn('Profile category averages unavailable:', err?.message || err);
            return {};
        });
        const binsPromise = getBinsResponse(effectiveCourseId);
        const policyRowsPromise = getStudentExamPolicyScores(email, effectiveCourseId);
        const examComponentTrendsPromise = getStudentExamComponentTrends(email, effectiveCourseId);
        const summariesPromise = getStudentPolicySummaries(email, effectiveCourseId).catch((err) => {
            console.warn('Profile summary totals unavailable:', err?.message || err);
            return {
                summaryByKey: null,
                summarySectionTotals: {},
                summaryTotal: 0,
            };
        });

        const [
            groupedSubmissions,
            assignmentMatrix,
            rawSubmissions,
            categoryAverages,
            bins,
            policyRows,
            examComponentTrends,
            summaries,
        ] = await Promise.all([
            groupedSubmissionsPromise,
            assignmentMatrixPromise,
            rawSubmissionsPromise,
            categoryAveragesPromise,
            binsPromise,
            policyRowsPromise,
            examComponentTrendsPromise,
            summariesPromise,
        ]);

        const gradeFlow = includeGradeFlow
            ? await getStudentGradeFlow(email, effectiveCourseId, {
                summaryByKey: summaries.summaryByKey,
            }).catch((err) => {
                console.warn('Profile grade flow unavailable:', err?.message || err);
                return null;
            })
            : null;

        return res.status(200).json({
            courseId: effectiveCourseId,
            grades: getStudentScoresWithMaxPointsAndTime(groupedSubmissions, assignmentMatrix),
            rawGrades: {
                sortBy: 'time',
                submissions: rawSubmissions || [],
            },
            categoryStats: categoryAverages || {},
            bins,
            examPolicy: {
                rows: policyRows || [],
                total: Array.isArray(policyRows) ? policyRows.length : 0,
                questComponentTrend: examComponentTrends?.quest,
                examComponentTrends: examComponentTrends || {},
            },
            summary: {
                email,
                summarySectionTotals: summaries.summarySectionTotals || {},
                summaryTotal: summaries.summaryTotal || 0,
            },
            categoryBlocks: buildCategoryBlocks({
                groupedSubmissions,
                rawSubmissions,
                policyRows,
                summaries,
                examComponentTrends,
            }),
            gradeFlow,
        });
    } catch (err) {
        const status = Number(err?.status) || 500;
        console.error('Error building student profile payload:', err);
        return res.status(status).json({
            message: status === 403 ? err.message : 'Internal server error.',
            error: err?.message || 'Failed to build student profile payload',
        });
    }
});

export default router;
