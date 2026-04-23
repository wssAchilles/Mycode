import { describe, expect, it } from 'vitest';

import {
    buildDensePostEmbedding,
    buildDenseUserEmbedding,
    cosineDenseEmbedding,
} from '../../src/services/recommendation/contentFeatures/denseEmbedding';

describe('dense embedding feature hashing', () => {
    it('keeps aligned user/post features closer than unrelated content', () => {
        const user = buildDenseUserEmbedding({
            clusters: [
                { clusterId: 11, score: 0.92 },
                { clusterId: 21, score: 0.48 },
            ],
            keywordWeights: new Map([
                ['rust', 0.8],
                ['latency', 0.5],
            ]),
            qualityScore: 0.86,
        });

        const relevantPost = buildDensePostEmbedding({
            clusterScores: [
                { clusterId: 11, score: 1 },
                { clusterId: 21, score: 0.45 },
            ],
            keywordScores: [
                { keyword: 'rust', weight: 0.5 },
                { keyword: 'latency', weight: 0.35 },
            ],
            engagementBucket: 'high',
            freshnessBucket: 'days_7',
        });

        const unrelatedPost = buildDensePostEmbedding({
            clusterScores: [{ clusterId: 88, score: 1 }],
            keywordScores: [{ keyword: 'fashion', weight: 0.9 }],
            engagementBucket: 'high',
            freshnessBucket: 'days_7',
        });

        expect(cosineDenseEmbedding(user, relevantPost)).toBeGreaterThan(
            cosineDenseEmbedding(user, unrelatedPost),
        );
    });

    it('returns normalized vectors with stable dimensionality', () => {
        const vector = buildDensePostEmbedding({
            clusterScores: [{ clusterId: 5, score: 1 }],
            keywordScores: [{ keyword: 'graph', weight: 1 }],
            engagementBucket: 'medium',
            freshnessBucket: 'hours_24',
        });

        expect(vector.length).toBeGreaterThan(15);
        const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
        expect(norm).toBeCloseTo(1, 6);
    });
});
