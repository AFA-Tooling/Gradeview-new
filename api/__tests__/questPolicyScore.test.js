import { resolveQuestPolicyScore } from '../lib/canonicalGrade.mjs';

describe('Quest policy score authority', () => {
    test('effective policy final wins over a higher question-best and reconstruction', () => {
        const resolved = resolveQuestPolicyScore({
            policyFinalScore: 24.5,
            questionBestScore: 25,
            reconstructedScore: 25,
            cap: 25,
        });

        expect(resolved).toEqual({
            exactScore: 24.5,
            status: 'available',
            source: 'policy_final',
            usedFallback: false,
        });
        expect(resolved.exactScore).not.toBe(Math.max(24.5, 25));
    });

    test('question-best is used only when effective policy final is absent', () => {
        expect(resolveQuestPolicyScore({
            policyFinalScore: null,
            questionBestScore: 25,
            reconstructedScore: 24,
            cap: 25,
        })).toEqual({
            exactScore: 25,
            status: 'available',
            source: 'question_best_fallback',
            usedFallback: true,
        });
    });

    test('component reconstruction is last fallback and null is not treated as zero evidence', () => {
        expect(resolveQuestPolicyScore({
            policyFinalScore: null,
            questionBestScore: null,
            reconstructedScore: 23.75,
            cap: 25,
        })).toEqual({
            exactScore: 23.75,
            status: 'available',
            source: 'component_reconstruction_fallback',
            usedFallback: true,
        });

        expect(resolveQuestPolicyScore({
            policyFinalScore: null,
            questionBestScore: null,
            reconstructedScore: null,
            cap: 25,
        })).toMatchObject({
            exactScore: 0,
            status: 'unavailable',
            source: 'quest_policy_unavailable',
        });
    });
});
