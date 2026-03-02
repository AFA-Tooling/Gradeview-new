import { Router } from 'express';
import { getGradeSyncConfig, getCourseGeneral, getCourseGradeView } from '../../../lib/unifiedConfig.mjs';

const router = Router({ mergeParams: true });

const DEFAULT_ASSIGNMENT_POINTS = {
    'Quest': 25,
    'Midterm': 50,
    'Postterm': 75,
    'Project 1: Wordle™-lite': 15,
    'Project 2: Spelling-Bee': 25,
    'Project 3: 2048': 35,
    'Project 4: Explore': 20,
    'Final Project': 60,
    'Labs': 80,
    'Attendance / Participation': 15,
};

const DEFAULT_COMPONENT_PERCENTAGES = [
    { component: 'Attendance / Participation', percentage: 3.75 },
    { component: 'Labs', percentage: 20 },
    { component: 'Projects', percentage: 38.75 },
    { component: 'Quest', percentage: 6.25 },
    { component: 'Midterm', percentage: 12.5 },
    { component: 'Postterm', percentage: 18.75 },
];

const DEFAULT_GRADE_BINS = [
    { grade: 'A+', range: '390-400' },
    { grade: 'A', range: '370-390' },
    { grade: 'A-', range: '360-370' },
    { grade: 'B+', range: '350-360' },
    { grade: 'B', range: '330-350' },
    { grade: 'B-', range: '320-330' },
    { grade: 'C+', range: '310-320' },
    { grade: 'C', range: '290-310' },
    { grade: 'C-', range: '280-290' },
    { grade: 'D', range: '240-280' },
    { grade: 'F', range: '0-240' }
];

async function loadGradeSyncConfig() {
    try {
        const parsed = getGradeSyncConfig();
        return parsed?.courses || [];
    } catch (err) {
        console.warn('Unable to read GradeSync config for bins route, using defaults:', err?.message || err);
        return [];
    }
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
        return DEFAULT_GRADE_BINS;
    }

    const formatted = rawBins
        .map((item) => {
            if (!item || typeof item !== 'object') {
                return null;
            }

            if (item.grade && item.range) {
                return {
                    grade: String(item.grade),
                    range: String(item.range)
                };
            }

            if (item.letter && item.range) {
                return {
                    grade: String(item.letter),
                    range: String(item.range)
                };
            }

            return null;
        })
        .filter(Boolean);

    return formatted.length > 0 ? formatted : DEFAULT_GRADE_BINS;
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

router.get('/', async (req, res) => {
    const { course_id: requestedCourseId } = req.query;

    try {
        const courses = await loadGradeSyncConfig();
        const course = resolveCourseById(courses, requestedCourseId);
        const courseGeneral = getCourseGeneral(course);
        const courseGradeView = getCourseGradeView(course);

        const bins = normalizeBins(courseGradeView?.buckets?.grade_bins || course?.buckets?.grade_bins);
        const assignmentPointsFromConfig = normalizeAssignmentPoints(courseGradeView?.buckets?.grading_breakdown || course?.buckets?.grading_breakdown);
        const assignmentPoints = Object.keys(assignmentPointsFromConfig).length > 0
            ? assignmentPointsFromConfig
            : DEFAULT_ASSIGNMENT_POINTS;
        const totalCoursePoints = Object.values(assignmentPoints).reduce((sum, val) => sum + (Number(val) || 0), 0);
        const configuredCapPoints = Number(courseGradeView?.buckets?.total_points_cap || course?.buckets?.total_points_cap) || totalCoursePoints;
        const maxBinPoints = getMaxBinPoints(bins);
        const overallCapPoints = maxBinPoints || configuredCapPoints || totalCoursePoints;
        
        const response = {
            bins,
            assignment_points: assignmentPoints,
            total_course_points: totalCoursePoints,
            total_points_cap: configuredCapPoints,
            overall_cap_points: overallCapPoints,
            component_percentages: Array.isArray(courseGradeView?.buckets?.component_percentages || course?.buckets?.component_percentages)
                ? (courseGradeView?.buckets?.component_percentages || course?.buckets?.component_percentages)
                : DEFAULT_COMPONENT_PERCENTAGES,
            rounding_policy: courseGradeView?.buckets?.rounding_policy
                || course?.buckets?.rounding_policy
                || 'Total points are rounded to nearest integer before letter-grade bin lookup (0.5 rounds up). No curve/bin shifting.',
            course_id: courseGeneral?.id || course?.id || requestedCourseId || null,
            source: course ? 'gradesync_config' : 'default_policy'
        };

        return res.status(200).json(response);
    } catch (err) {
        console.error('Error retrieving bins from GradeSync config:', {
            message: err?.message,
            courseId: requestedCourseId || null
        });
        return res.status(200).json({
            bins: DEFAULT_GRADE_BINS,
            assignment_points: DEFAULT_ASSIGNMENT_POINTS,
            total_course_points: 400,
            total_points_cap: 400,
            overall_cap_points: 400,
            component_percentages: DEFAULT_COMPONENT_PERCENTAGES,
            rounding_policy: 'Total points are rounded to nearest integer before letter-grade bin lookup (0.5 rounds up). No curve/bin shifting.',
            course_id: requestedCourseId || null,
            source: 'default_policy_fallback'
        });
    }
});

export default router;
