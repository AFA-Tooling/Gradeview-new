const EPSILON = 1e-9;

export const CANONICAL_GRADE_SCHEMA_VERSION = '1.0';
export const CANONICAL_GRADE_BASIS = 'policy_final';

export class GradePolicyValidationError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'GradePolicyValidationError';
        this.code = 'INVALID_GRADE_POLICY';
        this.status = 422;
        this.details = details;
    }
}

function finiteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function cleanNumber(value) {
    const numeric = finiteNumber(value);
    return Math.abs(numeric) < EPSILON ? 0 : Number(numeric.toFixed(10));
}

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function parseRange(range) {
    const match = String(range || '').match(/^\s*(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!match) return null;
    return {
        minimum: Number(match[1]),
        maximum: Number(match[2]),
    };
}

function firstFinite(...values) {
    for (const value of values) {
        if (value === null || value === undefined || value === '') continue;
        const numeric = Number(value);
        if (Number.isFinite(numeric)) return numeric;
    }
    return null;
}

function optionalFiniteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

export function resolveQuestPolicyScore({
    policyFinalScore,
    questionBestScore,
    reconstructedScore,
    cap = Number.POSITIVE_INFINITY,
} = {}) {
    const maximum = optionalFiniteNumber(cap);
    const bounded = (value) => {
        const numeric = optionalFiniteNumber(value);
        if (numeric == null) return null;
        return cleanNumber(clamp(numeric, 0, maximum != null && maximum > 0 ? maximum : numeric));
    };
    const candidates = [
        ['policy_final', bounded(policyFinalScore), false],
        ['question_best_fallback', bounded(questionBestScore), true],
        ['component_reconstruction_fallback', bounded(reconstructedScore), true],
    ];
    const selected = candidates.find(([, score]) => score != null);

    if (!selected) {
        return {
            exactScore: 0,
            status: 'unavailable',
            source: 'quest_policy_unavailable',
            usedFallback: false,
        };
    }

    return {
        exactScore: selected[1],
        status: 'available',
        source: selected[0],
        usedFallback: selected[2],
    };
}

export function normalizeRoundingPolicy(rawPolicy) {
    if (rawPolicy && typeof rawPolicy === 'object' && rawPolicy.mode) {
        const mode = String(rawPolicy.mode).trim().toLowerCase();
        if (['half_up_integer', 'ceil_integer', 'floor_integer'].includes(mode)) {
            return {
                mode,
                precision: 0,
                description: String(rawPolicy.description || rawPolicy.text || mode),
            };
        }
    }

    const description = String(rawPolicy || '').trim();
    const normalized = description.toLowerCase();
    let mode = null;

    if (normalized.includes('nearest') || normalized.includes('0.5') || normalized.includes('half up')) {
        mode = 'half_up_integer';
    } else if (normalized.includes('ceil') || normalized.includes('round up')) {
        mode = 'ceil_integer';
    } else if (normalized.includes('floor') || normalized.includes('round down')) {
        mode = 'floor_integer';
    }

    if (!mode) {
        throw new GradePolicyValidationError('Unsupported grade rounding policy', {
            roundingPolicy: rawPolicy ?? null,
            supportedModes: ['half_up_integer', 'ceil_integer', 'floor_integer'],
        });
    }

    return { mode, precision: 0, description };
}

export function applyFinalGradeRounding(exactScore, rawPolicy) {
    const policy = normalizeRoundingPolicy(rawPolicy);
    const score = finiteNumber(exactScore);

    if (policy.mode === 'ceil_integer') return Math.ceil(score);
    if (policy.mode === 'floor_integer') return Math.floor(score);
    return Math.floor(score + 0.5 + EPSILON);
}

/**
 * Normalize legacy bins that share a boundary (for example A 370-390 and
 * A+ 390-400) into unique display-score ranges. Policy lookup happens only
 * after final-stage integer rounding, so every integer belongs to one bin.
 */
export function normalizeGradeBins(rawBins, totalCap, rawRoundingPolicy) {
    const rounding = normalizeRoundingPolicy(rawRoundingPolicy);
    const cap = finiteNumber(totalCap, -1);
    if (cap <= 0 || !Number.isInteger(cap)) {
        throw new GradePolicyValidationError('Grade policy cap must be a positive integer', {
            totalCap,
        });
    }
    if (!Array.isArray(rawBins) || rawBins.length === 0) {
        throw new GradePolicyValidationError('Grade policy must define at least one grade bin');
    }

    const parsed = rawBins.map((rawBin, index) => {
        const range = parseRange(rawBin?.range);
        const minimum = firstFinite(
            rawBin?.minScore,
            rawBin?.minimum,
            rawBin?.min_points,
            rawBin?.min,
            range?.minimum,
        );
        const explicitUpperExclusive = firstFinite(rawBin?.upperExclusive, rawBin?.upper_exclusive);
        const maximum = firstFinite(
            rawBin?.sourceMaximum,
            rawBin?.maximum,
            rawBin?.max_points,
            rawBin?.max,
            rawBin?.maxScore,
            range?.maximum,
        );
        const grade = String(rawBin?.grade || rawBin?.letter || rawBin?.label || '').trim();

        if (!grade || minimum == null || (maximum == null && explicitUpperExclusive == null)) {
            throw new GradePolicyValidationError('Every grade bin needs a grade and numeric range', {
                index,
                bin: rawBin,
            });
        }

        return {
            grade,
            minimum,
            maximum,
            explicitUpperExclusive,
            sourceRange: String(rawBin?.sourceRange || rawBin?.range || `${minimum}-${maximum}`),
        };
    }).sort((left, right) => left.minimum - right.minimum);

    const grades = new Set();
    const minimums = new Set();
    parsed.forEach((bin) => {
        if (grades.has(bin.grade)) {
            throw new GradePolicyValidationError('Grade labels must be unique', { grade: bin.grade });
        }
        if (minimums.has(bin.minimum)) {
            throw new GradePolicyValidationError('Grade bin lower boundaries must be unique', {
                minimum: bin.minimum,
            });
        }
        grades.add(bin.grade);
        minimums.add(bin.minimum);
    });

    if (Math.abs(parsed[0].minimum) > EPSILON) {
        throw new GradePolicyValidationError('Grade bins must start at zero', {
            lowestBoundary: parsed[0].minimum,
        });
    }

    const ascending = parsed.map((bin, index) => {
        const next = parsed[index + 1] || null;
        if (!next) {
            const topMaximum = bin.explicitUpperExclusive == null
                ? bin.maximum
                : bin.explicitUpperExclusive - 1;
            if (Math.abs(topMaximum - cap) > EPSILON) {
                throw new GradePolicyValidationError('Highest grade bin must end at the course cap', {
                    grade: bin.grade,
                    maximum: topMaximum,
                    totalCap: cap,
                });
            }
            return {
                grade: bin.grade,
                minScore: bin.minimum,
                maxScore: cap,
                lowerInclusive: true,
                upperInclusive: true,
                upperExclusive: null,
                range: `${bin.minimum}-${cap}`,
                sourceRange: bin.sourceRange,
            };
        }

        const expectedExclusive = next.minimum;
        const configuredMaximum = bin.explicitUpperExclusive ?? bin.maximum;
        const isSharedLegacyBoundary = Math.abs(configuredMaximum - expectedExclusive) <= EPSILON;
        const isAlreadyUniqueIntegerRange = Math.abs(configuredMaximum - (expectedExclusive - 1)) <= EPSILON;
        if (!isSharedLegacyBoundary && !isAlreadyUniqueIntegerRange) {
            const relationship = configuredMaximum < expectedExclusive - 1 ? 'gap' : 'overlap';
            throw new GradePolicyValidationError(`Grade bins contain a ${relationship}`, {
                lowerGrade: bin.grade,
                lowerConfiguredMaximum: configuredMaximum,
                upperGrade: next.grade,
                upperMinimum: expectedExclusive,
            });
        }

        return {
            grade: bin.grade,
            minScore: bin.minimum,
            maxScore: expectedExclusive - 1,
            lowerInclusive: true,
            upperInclusive: true,
            upperExclusive: expectedExclusive,
            range: `${bin.minimum}-${expectedExclusive - 1}`,
            sourceRange: bin.sourceRange,
        };
    });

    if (rounding.precision !== 0 || ascending.some((bin) => !Number.isInteger(bin.minScore))) {
        throw new GradePolicyValidationError('Integer grade rounding requires integer bin boundaries', {
            rounding,
        });
    }

    return ascending.reverse();
}

export function findGradeBin(displayScore, normalizedBins) {
    const score = finiteNumber(displayScore, Number.NaN);
    if (!Number.isFinite(score) || !Array.isArray(normalizedBins)) return null;

    return normalizedBins
        .slice()
        .sort((left, right) => Number(right.minScore) - Number(left.minScore))
        .find((bin) => score >= Number(bin.minScore) && score <= Number(bin.maxScore)) || null;
}

function categoryInputFor(categoryScores, component) {
    if (categoryScores instanceof Map) {
        return categoryScores.get(component.key)
            ?? categoryScores.get(component.label)
            ?? categoryScores.get(component.summary_source);
    }
    return categoryScores?.[component.key]
        ?? categoryScores?.[component.label]
        ?? categoryScores?.[component.summary_source];
}

function normalizeEvidenceNamespace(value, basis, defaultStatus) {
    const input = value && typeof value === 'object' ? value : {};
    return {
        ...input,
        basis,
        status: String(input.status || defaultStatus),
    };
}

export function buildCanonicalGrade({
    components = [],
    categoryScores = {},
    totalCap,
    gradeBins,
    roundingPolicy,
    source = 'course_policy_summary',
    asOf = null,
    rawEvidence = null,
    dueWorkProgress = null,
} = {}) {
    const normalizedComponents = Array.isArray(components) ? components : [];
    const cap = finiteNumber(totalCap, normalizedComponents.reduce(
        (sum, component) => sum + Math.max(0, finiteNumber(component?.cap)),
        0,
    ));
    const componentCap = cleanNumber(normalizedComponents.reduce(
        (sum, component) => sum + Math.max(0, finiteNumber(component?.cap)),
        0,
    ));

    if (cap <= 0 || Math.abs(componentCap - cap) > EPSILON) {
        throw new GradePolicyValidationError('Component caps must add up to the course cap', {
            componentCap,
            totalCap: cap,
        });
    }

    const rounding = normalizeRoundingPolicy(roundingPolicy);
    const bins = normalizeGradeBins(gradeBins, cap, rounding);
    const categories = {};

    normalizedComponents.forEach((component) => {
        const componentCapValue = Math.max(0, finiteNumber(component?.cap));
        const input = categoryInputFor(categoryScores, component);
        const inputObject = input && typeof input === 'object' ? input : null;
        const hasValue = input !== undefined && input !== null
            && (!inputObject || [inputObject.exactScore, inputObject.score, inputObject.rawScore].some(
                (value) => value !== undefined && value !== null && Number.isFinite(Number(value)),
            ));
        const inputScore = inputObject
            ? firstFinite(inputObject.exactScore, inputObject.score, inputObject.rawScore, 0)
            : finiteNumber(input);
        const exactScore = cleanNumber(clamp(inputScore ?? 0, 0, componentCapValue));
        const status = String(inputObject?.status || (hasValue ? 'available' : 'unavailable'));

        categories[component.key] = {
            key: component.key,
            label: component.label,
            type: component.type || 'category',
            basis: CANONICAL_GRADE_BASIS,
            exactScore,
            cap: componentCapValue,
            percentage: componentCapValue > 0 ? cleanNumber((exactScore / componentCapValue) * 100) : 0,
            status,
            source: String(inputObject?.source || component.summary_source || component.label || source),
        };
    });

    const exactScore = cleanNumber(Object.values(categories).reduce(
        (sum, category) => sum + category.exactScore,
        0,
    ));
    const roundedScore = applyFinalGradeRounding(exactScore, rounding);
    const displayScore = clamp(roundedScore, 0, cap);
    const bin = findGradeBin(displayScore, bins);
    if (!bin) {
        throw new GradePolicyValidationError('Rounded grade does not belong to a configured bin', {
            exactScore,
            displayScore,
        });
    }

    const examCategories = Object.values(categories).filter((category) => category.type === 'exam');
    const examExactScore = cleanNumber(examCategories.reduce((sum, category) => sum + category.exactScore, 0));
    const examCap = cleanNumber(examCategories.reduce((sum, category) => sum + category.cap, 0));

    return {
        schemaVersion: CANONICAL_GRADE_SCHEMA_VERSION,
        basis: CANONICAL_GRADE_BASIS,
        status: Object.values(categories).every((category) => category.status === 'available')
            ? 'complete'
            : 'partial',
        exactScore,
        displayScore,
        cap,
        percentage: cleanNumber((exactScore / cap) * 100),
        letter: bin.grade,
        bin: {
            grade: bin.grade,
            range: bin.range,
            minScore: bin.minScore,
            maxScore: bin.maxScore,
        },
        rounding,
        categories,
        subtotals: {
            exams: {
                basis: CANONICAL_GRADE_BASIS,
                exactScore: examExactScore,
                cap: examCap,
                percentage: examCap > 0 ? cleanNumber((examExactScore / examCap) * 100) : 0,
                categoryKeys: examCategories.map((category) => category.key),
            },
        },
        asOf: asOf ? String(asOf) : null,
        source: String(source || 'course_policy_summary'),
        rawEvidence: normalizeEvidenceNamespace(rawEvidence, 'raw_evidence', 'not_aggregated'),
        dueWorkProgress: normalizeEvidenceNamespace(dueWorkProgress, 'due_work_progress', 'not_aggregated'),
    };
}

export function canonicalGradeToLegacySummary(canonicalGrade) {
    const grade = canonicalGrade || {};
    const categories = grade.categories || {};
    const summaryByKey = {};
    const summarySectionTotals = {};

    Object.values(categories).forEach((category) => {
        summaryByKey[category.key] = {
            key: category.key,
            label: category.label,
            type: category.type,
            cap: category.cap,
            score: category.exactScore,
            rawScore: category.exactScore,
            percentage: category.percentage,
            status: category.status,
            source: category.source,
            deprecated: true,
        };
        summarySectionTotals[category.label] = category.exactScore;
    });

    return {
        summaryByKey,
        summarySectionTotals,
        summaryTotal: finiteNumber(grade.exactScore),
        deprecated: {
            summaryByKey: 'Use canonicalGrade.categories',
            summarySectionTotals: 'Use canonicalGrade.categories',
            summaryTotal: 'Use canonicalGrade.exactScore',
        },
    };
}

export function buildPolicySummary(canonicalGrade) {
    return {
        canonicalGrade,
        ...canonicalGradeToLegacySummary(canonicalGrade),
    };
}

export function canonicalGradeToGradeFlowTotal(canonicalGrade) {
    return {
        basis: CANONICAL_GRADE_BASIS,
        exactScore: canonicalGrade.exactScore,
        displayScore: canonicalGrade.displayScore,
        score: canonicalGrade.exactScore,
        cap: canonicalGrade.cap,
        percentage: canonicalGrade.percentage,
        letter: canonicalGrade.letter,
        displayValue: `${canonicalGrade.displayScore}/${canonicalGrade.cap}`,
        deprecated: {
            score: 'Use exactScore',
        },
    };
}

export function canonicalGradeToAdminSummary(email, canonicalGrade) {
    return {
        email: email || null,
        canonicalGrade,
        ...canonicalGradeToLegacySummary(canonicalGrade),
    };
}

export function canonicalGradeToProfileSummary(email, canonicalGrade) {
    return {
        email: email || null,
        canonicalGrade,
        ...canonicalGradeToLegacySummary(canonicalGrade),
    };
}

export function canonicalCategoryToProfileBlock(category, dueWorkProgress = null) {
    return {
        key: category.key,
        label: category.label,
        type: category.type,
        basis: CANONICAL_GRADE_BASIS,
        exactScore: category.exactScore,
        score: category.exactScore,
        cap: category.cap,
        percentage: category.percentage,
        canonicalStatus: category.status,
        source: category.source,
        dueWorkProgress: normalizeEvidenceNamespace(
            dueWorkProgress,
            'due_work_progress',
            'not_aggregated',
        ),
        deprecated: {
            score: 'Use exactScore',
        },
    };
}
