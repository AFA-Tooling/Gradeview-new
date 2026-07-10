export function buildStudentProfileRouteResponse({
    courseId = null,
    canonicalGrade = null,
    groupedSubmissions = {},
    rawGrades = {},
    categoryAverages = {},
    bins = {},
    policyRows = [],
    examComponentTrends = {},
    profileSummary = null,
    categoryBlocks = [],
    gradeFlow = null,
} = {}) {
    return {
        courseId,
        canonicalGrade,
        grades: groupedSubmissions,
        rawGrades: {
            ...rawGrades,
            sortBy: 'time',
        },
        categoryStats: categoryAverages || {},
        bins,
        examPolicy: {
            rows: policyRows || [],
            total: Array.isArray(policyRows) ? policyRows.length : 0,
            questComponentTrend: examComponentTrends?.quest,
            examComponentTrends: examComponentTrends || {},
        },
        summary: profileSummary,
        // The top-level compatibility field is the exact canonical evidence
        // namespace. Keeping one reference prevents the two views drifting.
        dueWorkProgress: canonicalGrade?.dueWorkProgress || null,
        categoryBlocks,
        gradeFlow,
    };
}
