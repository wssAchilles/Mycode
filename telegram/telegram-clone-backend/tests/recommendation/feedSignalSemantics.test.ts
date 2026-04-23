import { describe, expect, it } from 'vitest';

import {
    pickFeedSignalGroup,
    pickFeedSignals,
    readFeedSignalValue,
} from '../../src/services/recommendation/signals/feedSignalSemantics';

describe('feed signal semantics', () => {
    it('resolves canonical keys from legacy aliases and top-level candidate scores', () => {
        const input = {
            explainSignals: {
                retrievalEmbeddingScore: 0.72,
            },
            scoreBreakdown: {
                rawWeightedScore: 1.8,
                authorAffinity: 0.34,
                affinityBoost: 0.21,
                retrievalSecondarySourceCount: 2,
            },
            candidate: {
                authorAffinityScore: 0.4,
                weightedScore: 0.66,
                score: 0.61,
                _pipelineScore: 0.63,
            },
        };

        expect(readFeedSignalValue(input, 'weightedRawScore')).toBeCloseTo(1.8);
        expect(readFeedSignalValue(input, 'authorAffinityScore')).toBeCloseTo(0.4);
        expect(readFeedSignalValue(input, 'authorAffinityBoost')).toBeCloseTo(0.21);
        expect(readFeedSignalValue(input, 'weightedScore')).toBeCloseTo(0.66);
        expect(readFeedSignalValue(input, 'finalScore')).toBeCloseTo(0.61);
        expect(readFeedSignalValue(input, 'pipelineScore')).toBeCloseTo(0.63);
    });

    it('emits grouped retrieval and distribution snapshots with canonical names', () => {
        const input = {
            explainSignals: {
                retrievalEmbeddingScore: 0.72,
                retrievalKeywordScore: 0.18,
            },
            scoreBreakdown: {
                retrievalSecondarySourceCount: 2,
                retrievalMultiSourceBonus: 0.06,
                rawWeightedScore: 1.8,
            },
            candidate: {
                weightedScore: 0.66,
                score: 0.61,
                _pipelineScore: 0.63,
            },
        };

        expect(pickFeedSignalGroup(input, 'retrieval')).toMatchObject({
            retrievalEmbeddingScore: 0.72,
            retrievalKeywordScore: 0.18,
        });
        expect(pickFeedSignalGroup(input, 'distribution')).toMatchObject({
            retrievalSecondarySourceCount: 2,
            retrievalMultiSourceBonus: 0.06,
        });
        expect(pickFeedSignals(input)).toMatchObject({
            weightedRawScore: 1.8,
            weightedScore: 0.66,
            finalScore: 0.61,
            pipelineScore: 0.63,
        });
    });
});
