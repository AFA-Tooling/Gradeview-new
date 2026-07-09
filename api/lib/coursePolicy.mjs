import {
    GradePolicyValidationError,
    normalizeGradeBins,
    normalizeRoundingPolicy,
} from './canonicalGrade.mjs';

const DEFAULT_ROUNDING_POLICY = 'Total points are rounded to nearest integer before letter-grade bin lookup (0.5 rounds up). No curve/bin shifting.';

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
    { grade: 'F', range: '0-240' },
];

const DEFAULT_ASSIGNMENT_POINTS = {
    Quest: 25,
    Midterm: 50,
    Postterm: 75,
    'Project 1: Wordle™-lite': 15,
    'Project 2: Spelling-Bee': 25,
    'Project 3: 2048': 35,
    'Project 4: Explore': 20,
    'Final Project': 60,
    Labs: 80,
    'Attendance / Participation': 15,
};

const DEFAULT_COMPONENTS = [
    { key: 'attendance', label: 'Attendance / Participation', cap: 15, summary_source: 'Attendance / Participation', type: 'attendance' },
    { key: 'labs', label: 'Labs', cap: 80, summary_source: 'Labs', type: 'labs' },
    { key: 'projects', label: 'Projects', cap: 155, summary_source: 'Projects', type: 'projects' },
    { key: 'quest', label: 'Quest', cap: 25, summary_source: 'Quest', type: 'exam', exam_type: 'quest' },
    { key: 'midterm', label: 'Midterm', cap: 50, summary_source: 'Midterm', type: 'exam', exam_type: 'midterm' },
    { key: 'postterm', label: 'Postterm', cap: 75, summary_source: 'Postterm', type: 'exam', exam_type: 'postterm' },
];

const DEFAULT_PROJECTS = [
    { key: '1', label: 'Project 1: Wordle™-lite', cap: 15, patterns: ['\\bproject\\s*1\\b'] },
    { key: '2', label: 'Project 2: Spelling Bee', cap: 25, patterns: ['\\bproject\\s*2\\b'] },
    { key: '3', label: 'Project 3: 2048', cap: 35, patterns: ['\\bproject\\s*3\\b'] },
    { key: '4', label: 'Project 4: Explore', cap: 20, patterns: ['\\bproject\\s*4\\b'] },
    { key: '5', label: 'Final Project', cap: 60, patterns: ['\\bproject\\s*5\\b', '\\bfinal\\s+project\\b'] },
];

export const DEFAULT_COURSE_POLICY = Object.freeze({
    source: 'default_policy',
    policy_version: 'default_cs10',
    total_points_cap: 400,
    rounding_policy: DEFAULT_ROUNDING_POLICY,
    grade_bins: DEFAULT_GRADE_BINS,
    component_percentages: [
        { component: 'Attendance / Participation', percentage: 3.75 },
        { component: 'Labs', percentage: 20 },
        { component: 'Projects', percentage: 38.75 },
        { component: 'Quest', percentage: 6.25 },
        { component: 'Midterm', percentage: 12.5 },
        { component: 'Postterm', percentage: 18.75 },
    ],
    components: DEFAULT_COMPONENTS,
    assignment_points: DEFAULT_ASSIGNMENT_POINTS,
    rules: {
        attendance: {
            cap: 15,
            count_mode: 'effective_policy',
            include_lecture_quiz_without_iclicker: false,
        },
        labs: {
            cap: 80,
            drop_lowest: 2,
            full_credit_threshold: 0.999,
        },
        projects: {
            cap: 155,
            items: DEFAULT_PROJECTS,
        },
        exams: {
            clobber: {
                midterm: ['postterm'],
            },
        },
    },
});

let warnedMissingCoursePolicies = false;

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function safeParseJson(value, fallback) {
    if (value == null) return fallback;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch {
            return fallback;
        }
    }
    return value;
}

export function normalizePolicyKey(value = '') {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/&/g, 'and')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function inferComponentType(component = {}) {
    const explicit = String(component.type || '').trim().toLowerCase();
    if (explicit) return explicit;
    const normalized = normalizePolicyKey(component.key || component.label || component.component);
    if (normalized.includes('attendance') || normalized.includes('participation')) return 'attendance';
    if (normalized.includes('lab')) return 'labs';
    if (normalized.includes('project')) return 'projects';
    if (normalized.includes('quest') || normalized.includes('quiz') || normalized.includes('midterm') || normalized.includes('postterm')) return 'exam';
    return 'category';
}

function normalizeComponent(rawComponent = {}, index = 0, assignmentPoints = {}) {
    const label = String(
        rawComponent.label
        || rawComponent.component
        || rawComponent.name
        || rawComponent.summary_source
        || rawComponent.summarySource
        || `Component ${index + 1}`,
    ).trim();
    const key = normalizePolicyKey(rawComponent.key || label) || `component_${index + 1}`;
    const capCandidate = Number(rawComponent.cap ?? rawComponent.points ?? rawComponent.max_points ?? assignmentPoints[label]);
    const cap = Number.isFinite(capCandidate) && capCandidate > 0 ? capCandidate : 0;
    const summarySource = String(
        rawComponent.summary_source
        || rawComponent.summarySource
        || rawComponent.source_category
        || rawComponent.sourceCategory
        || rawComponent.category
        || label,
    ).trim();

    return {
        ...rawComponent,
        key,
        label,
        cap,
        summary_source: summarySource || label,
        type: inferComponentType({ ...rawComponent, key, label }),
        exam_type: rawComponent.exam_type || rawComponent.examType || null,
    };
}

function normalizeProjectItem(rawItem = {}, index = 0) {
    const label = String(rawItem.label || rawItem.title || rawItem.name || `Project ${index + 1}`).trim();
    const key = String(rawItem.key || rawItem.project_key || index + 1).trim();
    const capCandidate = Number(rawItem.cap ?? rawItem.points ?? rawItem.max_points);
    const patterns = Array.isArray(rawItem.patterns)
        ? rawItem.patterns.map((pattern) => String(pattern || '').trim()).filter(Boolean)
        : [];
    return {
        ...rawItem,
        key,
        label,
        cap: Number.isFinite(capCandidate) && capCandidate > 0 ? capCandidate : 0,
        patterns,
    };
}

function normalizePolicy(rawPolicy = {}, source = 'default_policy') {
    const fallback = cloneJson(DEFAULT_COURSE_POLICY);
    const rawAssignmentPoints = safeParseJson(rawPolicy.assignment_points, {}) || {};
    const assignmentPoints = Object.keys(rawAssignmentPoints).length > 0
        ? rawAssignmentPoints
        : fallback.assignment_points;
    const rawComponents = safeParseJson(rawPolicy.components, null);
    const components = (Array.isArray(rawComponents) && rawComponents.length > 0
        ? rawComponents
        : fallback.components
    ).map((component, index) => normalizeComponent(component, index, assignmentPoints));

    const rawRules = safeParseJson(rawPolicy.rules, {}) || {};
    const rawProjectItems = rawRules?.projects?.items;
    const projectItems = (Array.isArray(rawProjectItems) && rawProjectItems.length > 0
        ? rawProjectItems
        : fallback.rules.projects.items
    ).map(normalizeProjectItem);

    const totalCapCandidate = Number(rawPolicy.total_points_cap ?? rawPolicy.totalPointsCap);
    const totalPointsCap = Number.isFinite(totalCapCandidate) && totalCapCandidate > 0
        ? totalCapCandidate
        : components.reduce((sum, component) => sum + (Number(component.cap) || 0), 0) || fallback.total_points_cap;
    const componentCapTotal = components.reduce((sum, component) => sum + (Number(component.cap) || 0), 0);
    if (Math.abs(componentCapTotal - totalPointsCap) > 1e-9) {
        throw new GradePolicyValidationError('Component caps must add up to the course cap', {
            componentCap: componentCapTotal,
            totalCap: totalPointsCap,
        });
    }
    const roundingPolicy = rawPolicy.rounding_policy || rawPolicy.rounding || fallback.rounding_policy;
    const rounding = normalizeRoundingPolicy(roundingPolicy);
    const parsedGradeBins = safeParseJson(rawPolicy.grade_bins, null);
    const gradeBins = normalizeGradeBins(
        Array.isArray(parsedGradeBins) && parsedGradeBins.length > 0
            ? parsedGradeBins
            : fallback.grade_bins,
        totalPointsCap,
        rounding,
    );

    return {
        ...fallback,
        ...rawPolicy,
        source,
        total_points_cap: totalPointsCap,
        rounding_policy: rounding.description,
        rounding,
        grade_bins: gradeBins,
        component_percentages: Array.isArray(safeParseJson(rawPolicy.component_percentages, null)) && safeParseJson(rawPolicy.component_percentages, []).length > 0
            ? safeParseJson(rawPolicy.component_percentages, [])
            : fallback.component_percentages,
        assignment_points: assignmentPoints,
        components,
        rules: {
            ...fallback.rules,
            ...rawRules,
            attendance: {
                ...fallback.rules.attendance,
                ...(rawRules.attendance || {}),
            },
            labs: {
                ...fallback.rules.labs,
                ...(rawRules.labs || {}),
            },
            projects: {
                ...fallback.rules.projects,
                ...(rawRules.projects || {}),
                items: projectItems,
            },
            exams: {
                ...fallback.rules.exams,
                ...(rawRules.exams || {}),
            },
        },
    };
}

export function getDefaultCoursePolicy() {
    return normalizePolicy({}, 'default_policy');
}

export function getCoursePolicyComponents(policy = DEFAULT_COURSE_POLICY) {
    return normalizePolicy(policy, policy.source || 'configured_policy').components;
}

export function getCoursePolicyProjectItems(policy = DEFAULT_COURSE_POLICY) {
    return normalizePolicy(policy, policy.source || 'configured_policy').rules.projects.items;
}

export function getPolicyComponentForSummary(category = '', policy = DEFAULT_COURSE_POLICY) {
    const normalizedCategory = normalizePolicyKey(category);
    return getCoursePolicyComponents(policy).find((component) => {
        const keys = [
            component.key,
            component.label,
            component.summary_source,
            component.summarySource,
            component.source_category,
            component.sourceCategory,
        ].map(normalizePolicyKey);
        return keys.includes(normalizedCategory);
    }) || null;
}

export function getPolicySummaryCap(category = '', policy = DEFAULT_COURSE_POLICY) {
    const component = getPolicyComponentForSummary(category, policy);
    return component ? Number(component.cap) || 0 : null;
}

export async function getCoursePolicy(courseId = null, pool = null) {
    if (!courseId || !pool) {
        return getDefaultCoursePolicy();
    }

    try {
        const result = await pool.query(
            `
            SELECT
                c.id AS course_internal_id,
                c.gradescope_course_id,
                cp.policy_version,
                cp.total_points_cap,
                cp.rounding_policy,
                cp.grade_bins,
                cp.component_percentages,
                cp.components,
                cp.assignment_points,
                cp.rules
            FROM courses c
            LEFT JOIN course_policies cp
              ON cp.course_id = c.id
             AND cp.is_active = true
            WHERE c.id::text = $1 OR c.gradescope_course_id::text = $1
            ORDER BY cp.updated_at DESC NULLS LAST
            LIMIT 1
            `,
            [String(courseId)],
        );

        const row = result.rows?.[0];
        if (!row || !row.policy_version) {
            return getDefaultCoursePolicy();
        }

        return normalizePolicy(row, 'course_policies');
    } catch (err) {
        if (err?.code === '42P01') {
            if (!warnedMissingCoursePolicies) {
                warnedMissingCoursePolicies = true;
                console.warn('course_policies table not found; using default CS10 grading policy');
            }
            return getDefaultCoursePolicy();
        }
        throw err;
    }
}

export function policyToBinsResponse(policy, courseId = null, source = null) {
    const normalized = normalizePolicy(policy, policy?.source || source || 'configured_policy');
    const assignmentPoints = normalized.assignment_points || {};
    return {
        bins: normalized.grade_bins,
        assignment_points: assignmentPoints,
        total_course_points: normalized.total_points_cap,
        total_points_cap: normalized.total_points_cap,
        overall_cap_points: normalized.total_points_cap,
        component_percentages: normalized.component_percentages,
        rounding_policy: normalized.rounding_policy,
        rounding: normalized.rounding,
        course_id: courseId || null,
        source: source || normalized.source || 'configured_policy',
    };
}
