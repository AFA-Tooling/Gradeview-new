import {
    buildCanonicalGrade,
    buildPolicySummary,
} from './canonicalGrade.mjs';

/**
 * Pure boundary between database distribution row maps and the canonical
 * policy-final contract. Row maps preserve evidence availability separately
 * from an earned score of zero.
 */
export function buildPolicySummaryFromComponentMaps({
    policy,
    components,
    byComponent,
    email,
    asOf = null,
    rawEvidence = null,
    dueWorkProgress = null,
} = {}) {
    const targetEmail = String(email || '').trim().toLowerCase();
    const categoryScores = {};

    (byComponent || []).forEach(({ component, rowMap }) => {
        const hasScore = rowMap instanceof Map && rowMap.has(targetEmail);
        const storedScore = hasScore ? rowMap.get(targetEmail) : null;
        categoryScores[component.key] = hasScore
            ? storedScore
            : {
                exactScore: 0,
                status: 'unavailable',
                source: component.summary_source || component.label,
            };
    });

    const canonicalGrade = buildCanonicalGrade({
        components,
        categoryScores,
        totalCap: policy.total_points_cap,
        gradeBins: policy.grade_bins,
        roundingPolicy: policy.rounding || policy.rounding_policy,
        source: policy.source || 'course_policy_summary',
        asOf,
        rawEvidence,
        dueWorkProgress,
    });

    return buildPolicySummary(canonicalGrade);
}
