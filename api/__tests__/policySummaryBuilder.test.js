import {
    canonicalGradeToAdminSummary,
    canonicalGradeToGradeFlowTotal,
    canonicalGradeToProfileSummary,
} from '../lib/canonicalGrade.mjs';
import { getDefaultCoursePolicy } from '../lib/coursePolicy.mjs';
import { buildPolicySummaryFromComponentMaps } from '../lib/policySummaryBuilder.mjs';

describe('database distribution row maps to canonical summary', () => {
    test('six component row maps preserve exact scores, true zero, and missing status', () => {
        const policy = getDefaultCoursePolicy();
        const email = 'jordan@example.edu';
        const values = {
            attendance: { exactScore: 15, status: 'available', source: 'attendance_effective' },
            projects: { exactScore: 154.33, status: 'available', source: 'project_rollup' },
            quest: { exactScore: 24.5, status: 'available', source: 'policy_final' },
            midterm: { exactScore: 0, status: 'available', source: 'exam_effective' },
            postterm: { exactScore: 72.3, status: 'available', source: 'exam_effective' },
        };
        const byComponent = policy.components.map((component) => ({
            component,
            rowMap: component.key === 'labs'
                ? new Map()
                : new Map([[email, values[component.key]]]),
        }));

        const summary = buildPolicySummaryFromComponentMaps({
            policy,
            components: policy.components,
            byComponent,
            email: 'JORDAN@EXAMPLE.EDU',
            asOf: '2026-07-09T15:00:00.000Z',
            rawEvidence: { status: 'available', submissionCount: 19 },
            dueWorkProgress: { status: 'available', totalItems: 0 },
        });

        expect(summary.canonicalGrade).toMatchObject({
            basis: 'policy_final',
            status: 'partial',
            exactScore: 266.13,
            displayScore: 266,
            cap: 400,
            letter: 'D',
            asOf: '2026-07-09T15:00:00.000Z',
            rawEvidence: {
                basis: 'raw_evidence',
                status: 'available',
                submissionCount: 19,
            },
            dueWorkProgress: {
                basis: 'due_work_progress',
                status: 'available',
                totalItems: 0,
            },
        });
        expect(summary.canonicalGrade.categories.labs).toMatchObject({
            exactScore: 0,
            cap: 80,
            status: 'unavailable',
        });
        expect(summary.canonicalGrade.categories.midterm).toMatchObject({
            exactScore: 0,
            cap: 50,
            status: 'available',
        });
        expect(summary.canonicalGrade.categories.projects.exactScore).toBe(154.33);

        expect(summary.summaryTotal).toBe(summary.canonicalGrade.exactScore);
        expect(summary.summaryByKey.labs.score).toBe(summary.canonicalGrade.categories.labs.exactScore);
        expect(summary.summaryByKey.labs.status).toBe('unavailable');
        expect(summary.summaryByKey.midterm.status).toBe('available');
        expect(summary.summarySectionTotals.Projects).toBe(154.33);

        const profile = canonicalGradeToProfileSummary(email, summary.canonicalGrade);
        const admin = canonicalGradeToAdminSummary(email, summary.canonicalGrade);
        const flow = canonicalGradeToGradeFlowTotal(summary.canonicalGrade);
        expect(profile.canonicalGrade).toBe(summary.canonicalGrade);
        expect(admin.canonicalGrade).toBe(summary.canonicalGrade);
        expect(profile.summaryTotal).toBe(266.13);
        expect(admin.summaryTotal).toBe(266.13);
        expect(flow).toMatchObject({
            exactScore: 266.13,
            displayScore: 266,
            cap: 400,
            letter: 'D',
        });
    });
});
