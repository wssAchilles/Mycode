import { describe, expect, it } from 'vitest';

import { extractExperimentKeys } from '../../src/services/recommendation/utils/experimentKeys';

describe('extractExperimentKeys', () => {
    it('returns only in-experiment assignments as experimentId:bucket', () => {
        const keys = extractExperimentKeys({
            experimentContext: {
                userId: 'u1',
                assignments: [
                    {
                        experimentId: 'exp-a',
                        experimentName: 'A',
                        bucket: 'treatment',
                        config: {},
                        inExperiment: true,
                    },
                    {
                        experimentId: 'exp-b',
                        experimentName: 'B',
                        bucket: 'control',
                        config: {},
                        inExperiment: false,
                    },
                ],
                getConfig: <T>(_experimentId: string, _key: string, defaultValue: T) => defaultValue,
                isInBucket: (_experimentId: string, _bucket: string) => false,
            },
        } as any);

        expect(keys).toEqual(['exp-a:treatment']);
    });
});

