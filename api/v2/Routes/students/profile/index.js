import { Router } from 'express';
import { IAM_ROLE } from '../../../../lib/iam.mjs';
import {
    getCategoryAverages,
    getStudentCourses,
    getStudentAssignmentEvidence,
    getStudentExamComponentTrends,
    getStudentExamPolicyScores,
    getStudentGradeFlow,
    getStudentPolicySummaries,
    studentEnrolledInCourse,
} from '../../../../lib/dbHelper.mjs';
import { getBinsResponse } from '../../bins/index.js';
import {
    canonicalCategoryToProfileBlock,
    canonicalGradeToProfileSummary,
} from '../../../../lib/canonicalGrade.mjs';
import {
    attachAssignmentEvidenceToCanonicalGrade,
    assignmentEvidenceRequestError,
    buildAssignmentEvidenceResponse,
    groupAssignmentEvidence,
    sortAssignmentEvidenceByTime,
    summarizeAssignmentEvidence,
} from '../../../../lib/assignmentEvidence.mjs';
import { buildStudentProfileRouteResponse } from './profileResponse.mjs';

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

function getSummaryForBlock(canonicalGrade = null, summaryByKey = {}, summarySectionTotals = {}, config) {
    const canonicalCategory = canonicalGrade?.categories?.[config.key] || null;
    if (canonicalCategory) {
        return canonicalCategoryToProfileBlock(canonicalCategory);
    }
    const keyed = summaryByKey?.[config.key] || null;
    const rawScore = keyed?.score ?? Object.entries(summarySectionTotals || {}).find(([section]) => (
        categoryMatches(section, '', config.terms)
    ))?.[1];
    const cap = Number(canonicalCategory?.cap ?? keyed?.cap ?? config.cap) || config.cap;
    const exactScore = canonicalCategory
        ? Number(canonicalCategory.exactScore) || 0
        : Math.min(cap, Math.max(0, Number(rawScore) || 0));
    return {
        exactScore,
        score: exactScore,
        cap,
        rawScore: exactScore,
        percentage: canonicalCategory?.percentage ?? (cap > 0 ? (exactScore / cap) * 100 : 0),
        canonicalStatus: canonicalCategory?.status || 'legacy',
        source: canonicalCategory?.source || keyed?.source || config.label,
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

function buildCategoryBlocks({
    assignmentEvidence,
    policyRows,
    summaries,
    examComponentTrends,
}) {
    const summaryByKey = summaries?.summaryByKey || {};
    const summarySectionTotals = summaries?.summarySectionTotals || {};
    const canonicalGrade = summaries?.canonicalGrade || null;

    return CATEGORY_BLOCK_CONFIGS.map((config) => {
        const assignmentSummary = summarizeAssignmentEvidence(assignmentEvidence, {
            matches: (category, name) => categoryMatches(category, name, config.terms),
        });
        const scoreSummary = getSummaryForBlock(
            canonicalGrade,
            summaryByKey,
            summarySectionTotals,
            config,
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
            basis: 'policy_final',
            exactScore: scoreSummary.exactScore,
            score: scoreSummary.score,
            cap: scoreSummary.cap,
            rawScore: scoreSummary.rawScore,
            percentage: scoreSummary.percentage,
            canonicalStatus: scoreSummary.canonicalStatus,
            source: scoreSummary.source,
            status: getBlockStatus(scoreSummary.percentage),
            deprecated: {
                score: 'Use exactScore',
                rawScore: 'Raw evidence is in summary; use exactScore for policy standing',
            },
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

        const assignmentEvidencePromise = getStudentAssignmentEvidence(email, effectiveCourseId);
        const categoryAveragesPromise = getCategoryAverages(effectiveCourseId).catch((err) => {
            console.warn('Profile category averages unavailable:', err?.message || err);
            return {};
        });
        const binsPromise = getBinsResponse(effectiveCourseId);
        const policyRowsPromise = getStudentExamPolicyScores(email, effectiveCourseId);
        const examComponentTrendsPromise = getStudentExamComponentTrends(email, effectiveCourseId);
        const summariesPromise = getStudentPolicySummaries(email, effectiveCourseId);

        const [
            assignmentEvidence,
            categoryAverages,
            bins,
            policyRows,
            examComponentTrends,
            summaries,
        ] = await Promise.all([
            assignmentEvidencePromise,
            categoryAveragesPromise,
            binsPromise,
            policyRowsPromise,
            examComponentTrendsPromise,
            summariesPromise,
        ]);
        const groupedSubmissions = groupAssignmentEvidence(assignmentEvidence);
        const rawSubmissions = sortAssignmentEvidenceByTime(assignmentEvidence);
        const rawGrades = buildAssignmentEvidenceResponse(rawSubmissions);

        const categoryBlocks = buildCategoryBlocks({
            assignmentEvidence: rawSubmissions,
            policyRows,
            summaries,
            examComponentTrends,
        });
        const canonicalGrade = attachAssignmentEvidenceToCanonicalGrade(
            summaries.canonicalGrade,
            assignmentEvidence,
            categoryBlocks,
        );
        const profileSummary = canonicalGradeToProfileSummary(email, canonicalGrade);

        const gradeFlow = includeGradeFlow
            ? await getStudentGradeFlow(email, effectiveCourseId, {
                canonicalGrade,
            }).catch((err) => {
                console.warn('Profile grade flow unavailable:', err?.message || err);
                return null;
            })
            : null;

        return res.status(200).json(buildStudentProfileRouteResponse({
            courseId: effectiveCourseId,
            canonicalGrade,
            groupedSubmissions,
            rawGrades,
            categoryAverages,
            bins,
            policyRows,
            examComponentTrends,
            profileSummary,
            categoryBlocks,
            gradeFlow,
        }));
    } catch (err) {
        const status = Number(err?.status) || 500;
        const evidenceError = err?.code === 'ASSIGNMENT_EVIDENCE_REQUEST_ERROR'
            ? assignmentEvidenceRequestError(err)
            : {};
        console.error('Error building student profile payload:', err);
        return res.status(status).json({
            ...evidenceError,
            message: evidenceError.message || (status < 500 ? err.message : 'Internal server error.'),
            code: evidenceError.code || err?.code || 'PROFILE_BUILD_FAILED',
            details: err?.details || null,
            error: err?.message || 'Failed to build student profile payload',
        });
    }
});

export default router;
