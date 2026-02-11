import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';

import { RecommendationPipeline } from '../../src/services/recommendation/framework/Pipeline';
import type { ScoredCandidate } from '../../src/services/recommendation/framework/interfaces';

type Query = {
    requestId: string;
    limit: number;
};

type Candidate = {
    postId: mongoose.Types.ObjectId;
    authorId: string;
    content: string;
    createdAt: Date;
    isReply: boolean;
    isRepost: boolean;
    score?: number;
    recallSource?: string;
    _scoreBreakdown?: Record<string, number>;
    _pipelineScore?: number;
};

const oid = (hex: string) => new mongoose.Types.ObjectId(hex);

const mkCandidate = (
    postId: mongoose.Types.ObjectId,
    extra?: Partial<Candidate>
): Candidate => ({
    postId,
    authorId: 'a1',
    content: 'hello',
    createdAt: new Date('2026-02-01T00:00:00.000Z'),
    isReply: false,
    isRepost: false,
    ...extra,
});

describe('RecommendationPipeline metadata contracts', () => {
    it('annotates recallSource from source name while preserving pre-set source', async () => {
        const pipeline = new RecommendationPipeline<Query, Candidate>({
            defaultResultSize: 20,
            debug: false,
        })
            .withSource({
                name: 'SourceA',
                enable: () => true,
                getCandidates: async () => [mkCandidate(oid('507f191e810c19729de87051'))],
            })
            .withSource({
                name: 'SourceB',
                enable: () => true,
                getCandidates: async () => [
                    mkCandidate(oid('507f191e810c19729de87052'), { recallSource: 'PresetSource' }),
                ],
            });

        const result = await pipeline.execute({ requestId: 'req-source-attr', limit: 20 });
        const map = new Map(
            result.selectedCandidates.map((c) => [c.postId.toString(), c.recallSource])
        );

        expect(map.get('507f191e810c19729de87051')).toBe('SourceA');
        expect(map.get('507f191e810c19729de87052')).toBe('PresetSource');
    });

    it('injects debug score metadata in debug mode', async () => {
        const scorer = {
            name: 'TestScorer',
            enable: () => true,
            score: async (_query: Query, candidates: Candidate[]): Promise<ScoredCandidate<Candidate>[]> =>
                candidates.map((candidate, idx) => {
                    const score = (idx + 1) * 10;
                    return {
                        candidate: { ...candidate, score },
                        score,
                        scoreBreakdown: { TestScorer: score },
                    };
                }),
            update: (_candidate: Candidate, scored: ScoredCandidate<Candidate>): Candidate => ({
                ...scored.candidate,
            }),
        };

        const pipeline = new RecommendationPipeline<Query, Candidate>({
            defaultResultSize: 20,
            debug: true,
        })
            .withSource({
                name: 'SourceDebug',
                enable: () => true,
                getCandidates: async () => [
                    mkCandidate(oid('507f191e810c19729de87061')),
                    mkCandidate(oid('507f191e810c19729de87062')),
                ],
            })
            .withScorer(scorer);

        const result = await pipeline.execute({ requestId: 'req-debug-meta', limit: 20 });

        expect(result.selectedCandidates[0]._scoreBreakdown?.TestScorer).toBeTypeOf('number');
        expect(result.selectedCandidates[0]._pipelineScore).toBeTypeOf('number');
        expect(result.selectedCandidates[1]._scoreBreakdown?.TestScorer).toBeTypeOf('number');
        expect(result.selectedCandidates[1]._pipelineScore).toBeTypeOf('number');
    });
});

