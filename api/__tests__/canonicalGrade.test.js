import {
    GradePolicyValidationError,
    buildCanonicalGrade,
    canonicalGradeToAdminSummary,
    canonicalCategoryToProfileBlock,
    canonicalGradeToGradeFlowTotal,
    canonicalGradeToProfileSummary,
    normalizeGradeBins,
} from '../lib/canonicalGrade.mjs';
import { getDefaultCoursePolicy } from '../lib/coursePolicy.mjs';

const policy = getDefaultCoursePolicy();

const AVERY_CATEGORIES = {
    attendance: 15,
    labs: 64.5,
    projects: 141,
    quest: 24.5,
    midterm: 32.67,
    postterm: 42,
};

const JORDAN_CATEGORIES = {
    attendance: 15,
    labs: 53.3,
    projects: 154.33,
    quest: 25,
    midterm: 48.4,
    postterm: 72.3,
};

function buildGrade(categoryScores, overrides = {}) {
    return buildCanonicalGrade({
        components: policy.components,
        categoryScores,
        totalCap: policy.total_points_cap,
        gradeBins: policy.grade_bins,
        roundingPolicy: policy.rounding,
        source: 'test_policy',
        asOf: '2026-07-09T12:00:00.000Z',
        ...overrides,
    });
}

function scoresForTotal(total) {
    let remaining = total;
    return Object.fromEntries(policy.components.map((component) => {
        const exactScore = Math.min(component.cap, Math.max(0, remaining));
        remaining -= exactScore;
        return [component.key, exactScore];
    }));
}

describe('canonical policy-final grade contract', () => {
    test.each([
        ['Avery', AVERY_CATEGORIES, 319.67, 320, 'B-'],
        ['Jordan', JORDAN_CATEGORIES, 368.33, 368, 'A-'],
    ])('%s has one exact six-category standing', (_name, categories, exact, display, letter) => {
        const grade = buildGrade(categories);

        expect(Object.keys(grade.categories)).toEqual([
            'attendance',
            'labs',
            'projects',
            'quest',
            'midterm',
            'postterm',
        ]);
        expect(grade).toMatchObject({
            schemaVersion: '1.0',
            basis: 'policy_final',
            status: 'complete',
            exactScore: exact,
            displayScore: display,
            cap: 400,
            letter,
            asOf: '2026-07-09T12:00:00.000Z',
            source: 'test_policy',
        });
        expect(grade.rounding.mode).toBe('half_up_integer');
        expect(Object.values(grade.categories).map((category) => category.exactScore)).toEqual(
            Object.values(categories),
        );
        expect(grade.rawEvidence.basis).toBe('raw_evidence');
        expect(grade.dueWorkProgress.basis).toBe('due_work_progress');
    });

    test('profile, Grade Flow, and admin adapters preserve the same canonical standing', () => {
        const grade = buildGrade(AVERY_CATEGORIES);
        const profile = canonicalGradeToProfileSummary('avery@example.edu', grade);
        const gradeFlow = canonicalGradeToGradeFlowTotal(grade);
        const admin = canonicalGradeToAdminSummary('avery@example.edu', grade);

        expect(profile.canonicalGrade).toBe(grade);
        expect(admin.canonicalGrade).toBe(grade);
        expect(profile.summaryTotal).toBe(grade.exactScore);
        expect(admin.summaryTotal).toBe(grade.exactScore);
        expect(gradeFlow).toMatchObject({
            basis: 'policy_final',
            exactScore: grade.exactScore,
            displayScore: grade.displayScore,
            cap: grade.cap,
            percentage: grade.percentage,
            letter: grade.letter,
        });
        expect(profile.summaryByKey.quest.score).toBe(grade.categories.quest.exactScore);
        expect(admin.summarySectionTotals.Quest).toBe(grade.categories.quest.exactScore);
        expect(profile.deprecated.summaryTotal).toContain('canonicalGrade.exactScore');
    });

    test.each([
        [389.49, 389, 'A'],
        [389.5, 390, 'A+'],
        [390, 390, 'A+'],
        [370, 370, 'A'],
        [360, 360, 'A-'],
        [240, 240, 'D'],
    ])('rounds %p once before unique bin lookup', (exactScore, displayScore, letter) => {
        const grade = buildGrade(scoresForTotal(exactScore));
        expect(grade.exactScore).toBe(exactScore);
        expect(grade.displayScore).toBe(displayScore);
        expect(grade.letter).toBe(letter);
    });

    test('bin lookup is independent of configured array order and exposes no display overlap', () => {
        const bins = normalizeGradeBins(
            policy.grade_bins.slice().reverse(),
            policy.total_points_cap,
            policy.rounding,
        );
        const ascending = bins.slice().sort((left, right) => left.minScore - right.minScore);

        ascending.forEach((bin, index) => {
            const next = ascending[index + 1];
            if (next) expect(bin.maxScore + 1).toBe(next.minScore);
        });
        expect(bins.find((bin) => bin.grade === 'A').range).toBe('370-389');
        expect(bins.find((bin) => bin.grade === 'F').range).toBe('0-239');
    });

    test.each([
        ['gap', { grade: 'F', range: '0-230' }],
        ['overlap', { grade: 'F', range: '0-250' }],
    ])('rejects a policy bin %s with a stable validation error', (_kind, invalidBottomBin) => {
        const invalidBins = policy.grade_bins.map((bin) => (
            bin.grade === 'F' ? invalidBottomBin : bin
        ));

        expect(() => normalizeGradeBins(invalidBins, 400, policy.rounding)).toThrow(
            GradePolicyValidationError,
        );
        try {
            normalizeGradeBins(invalidBins, 400, policy.rounding);
        } catch (error) {
            expect(error).toMatchObject({
                code: 'INVALID_GRADE_POLICY',
                status: 422,
            });
        }
    });

    test('rejects component caps that do not match the course cap', () => {
        expect(() => buildCanonicalGrade({
            components: policy.components.map((component) => (
                component.key === 'labs' ? { ...component, cap: 79 } : component
            )),
            categoryScores: AVERY_CATEGORIES,
            totalCap: 400,
            gradeBins: policy.grade_bins,
            roundingPolicy: policy.rounding,
        })).toThrow(GradePolicyValidationError);
    });

    test('missing due dates never truncate the policy-final standing', () => {
        const withoutDueProgress = buildGrade(AVERY_CATEGORIES);
        const withNoDueAssignments = buildGrade(AVERY_CATEGORIES, {
            dueWorkProgress: {
                status: 'available',
                totalItems: 0,
                assignments: [
                    { name: 'Labs', dueAt: null },
                    { name: 'Projects', dueAt: null },
                ],
            },
        });

        expect(withNoDueAssignments).toMatchObject({
            exactScore: withoutDueProgress.exactScore,
            displayScore: withoutDueProgress.displayScore,
            percentage: withoutDueProgress.percentage,
            letter: withoutDueProgress.letter,
        });
        expect(withNoDueAssignments.dueWorkProgress).toMatchObject({
            basis: 'due_work_progress',
            status: 'available',
            totalItems: 0,
        });

        const profileBlock = canonicalCategoryToProfileBlock(
            withNoDueAssignments.categories.labs,
            { status: 'available', totalItems: 0, assignments: [{ dueAt: null }] },
        );
        expect(profileBlock).toMatchObject({
            basis: 'policy_final',
            exactScore: 64.5,
            score: 64.5,
            cap: 80,
            dueWorkProgress: {
                basis: 'due_work_progress',
                totalItems: 0,
            },
        });
    });

    test('exam subtotal and Quest final are exact values from canonical exam categories', () => {
        const grade = buildGrade(JORDAN_CATEGORIES);

        expect(grade.categories.quest.exactScore).toBe(25);
        expect(grade.categories.midterm.exactScore).toBe(48.4);
        expect(grade.categories.postterm.exactScore).toBe(72.3);
        expect(grade.subtotals.exams).toMatchObject({
            basis: 'policy_final',
            exactScore: 145.7,
            cap: 150,
            categoryKeys: ['quest', 'midterm', 'postterm'],
        });
    });

    test('category decimals are not rounded independently before the final sum', () => {
        const grade = buildGrade({
            attendance: 14.51,
            labs: 63.51,
            projects: 140.51,
            quest: 23.51,
            midterm: 31.51,
            postterm: 40.51,
        });

        expect(grade.exactScore).toBe(314.06);
        expect(grade.displayScore).toBe(314);
        expect(grade.categories.attendance.exactScore).toBe(14.51);
        expect(grade.categories.postterm.exactScore).toBe(40.51);
        expect(Object.values(grade.categories).reduce(
            (sum, category) => sum + Math.ceil(category.exactScore),
            0,
        )).toBe(317);
    });
});
