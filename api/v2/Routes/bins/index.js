import { Router } from 'express';
import { getPool } from '../../../lib/dbHelper.mjs';
import { getCoursePolicy, getDefaultCoursePolicy, policyToBinsResponse } from '../../../lib/coursePolicy.mjs';

const router = Router({ mergeParams: true });

const DEFAULT_BINS_RESPONSE = policyToBinsResponse(getDefaultCoursePolicy(), null, 'default_policy');

async function loadGradeSyncConfig() {
    const pool = getPool();
    const result = await pool.query(
        `
        SELECT id::text AS id, gradescope_course_id::text AS gradescope_course_id
        FROM courses
        WHERE is_active = true
        ORDER BY year DESC NULLS LAST, semester ASC NULLS LAST, name ASC NULLS LAST
        `,
    );

    return result.rows.map((row) => ({
        id: String(row.id || ''),
        sources: {
            gradescope: {
                course_id: String(row.gradescope_course_id || ''),
            },
        },
    }));
}

function resolveCourseById(courses, requestedCourseId) {
    if (!Array.isArray(courses) || courses.length === 0) {
        return null;
    }

    if (!requestedCourseId || typeof requestedCourseId !== 'string') {
        return courses[0];
    }

    const normalized = requestedCourseId.trim();
    if (!normalized) {
        return courses[0];
    }

    const matched = courses.find((course) => (
        String(course?.general?.id || course?.id || '') === normalized ||
        String(course?.gradesync?.sources?.gradescope?.course_id || course?.sources?.gradescope?.course_id || '') === normalized
    ));

    return matched || courses[0];
}

function normalizeBins(rawBins) {
    if (!Array.isArray(rawBins) || rawBins.length === 0) {
        return DEFAULT_BINS_RESPONSE.bins;
    }

    const formatted = rawBins
        .map((item) => {
            if (!item || typeof item !== 'object') {
                return null;
            }

            if (item.grade && item.range) {
                return {
                    ...item,
                    grade: String(item.grade),
                    range: String(item.range)
                };
            }

            if (item.letter && item.range) {
                return {
                    ...item,
                    grade: String(item.letter),
                    range: String(item.range)
                };
            }

            return null;
        })
        .filter(Boolean);

    return formatted.length > 0 ? formatted : DEFAULT_BINS_RESPONSE.bins;
}

function normalizeAssignmentPoints(rawBreakdown) {
    if (!rawBreakdown) {
        return {};
    }

    if (!Array.isArray(rawBreakdown) && typeof rawBreakdown === 'object') {
        return rawBreakdown;
    }

    if (!Array.isArray(rawBreakdown)) {
        return {};
    }

    return rawBreakdown.reduce((acc, item) => {
        if (!item || typeof item !== 'object') {
            return acc;
        }

        const name = item.assignment || item.name;
        const points = item.points;

        if (typeof name === 'string' && name.trim()) {
            acc[name.trim()] = Number(points) || 0;
        }

        return acc;
    }, {});
}

function getMaxBinPoints(bins = []) {
    const maxes = bins
        .map((bin) => {
            const range = String(bin?.range || '');
            const match = range.match(/(\d+)\s*$/);
            return match ? Number(match[1]) : NaN;
        })
        .filter((value) => Number.isFinite(value));

    return maxes.length > 0 ? Math.max(...maxes) : 0;
}

export async function getBinsResponse(requestedCourseId = null) {
    try {
        const courses = await loadGradeSyncConfig();
        const course = resolveCourseById(courses, requestedCourseId);
        const effectiveCourseId = requestedCourseId || course?.sources?.gradescope?.course_id || course?.id || null;
        const policy = await getCoursePolicy(effectiveCourseId, getPool());
        const response = policyToBinsResponse(policy, effectiveCourseId, policy.source || (course ? 'course_policies' : 'default_policy'));

        const bins = normalizeBins(response.bins);
        const assignmentPoints = normalizeAssignmentPoints(response.assignment_points);
        const maxBinPoints = getMaxBinPoints(bins);

        return {
            ...response,
            bins,
            assignment_points: Object.keys(assignmentPoints).length > 0
                ? assignmentPoints
                : DEFAULT_BINS_RESPONSE.assignment_points,
            total_course_points: response.total_points_cap || response.total_course_points,
            overall_cap_points: response.total_points_cap || maxBinPoints || response.total_course_points,
            course_id: effectiveCourseId,
        };
    } catch (err) {
        if (err?.code === 'INVALID_GRADE_POLICY') {
            throw err;
        }
        console.error('Error retrieving bins from GradeSync config:', {
            message: err?.message,
            courseId: requestedCourseId || null,
        });
        return {
            ...DEFAULT_BINS_RESPONSE,
            course_id: requestedCourseId || null,
            source: 'default_policy_fallback',
        };
    }
}

router.get('/', async (req, res) => {
    const { course_id: requestedCourseId } = req.query;
    try {
        const response = await getBinsResponse(requestedCourseId || null);
        return res.status(200).json(response);
    } catch (err) {
        const status = Number(err?.status) || 500;
        return res.status(status).json({
            error: err?.code || 'FAILED_TO_LOAD_GRADE_POLICY',
            message: err?.message || 'Failed to load grade policy',
            details: err?.details || null,
        });
    }
});

export default router;
