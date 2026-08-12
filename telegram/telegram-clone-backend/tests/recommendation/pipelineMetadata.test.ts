import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';

import { RecommendationPipeline } from '../../src/services/recommendation/framework/Pipeline';
import { runStagedQueryHydrators } from '../../src/services/recommendation/framework/queryHydrationStages';
import type { ScoredCandidate } from '../../src/services/recommendation/framework/interfaces';
import { SpaceFeedMixer } from '../../src/services/recommendation/SpaceFeedMixer';
import { DuplicateFilter } from '../../src/services/recommendation/filters/DuplicateFilter';
import { EngagementScorer } from '../../src/services/recommendation/scorers/EngagementScorer';
import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';
import type { FeedCandidate } from '../../src/services/recommendation/types/FeedCandidate';
import {
    buildRecommendationQueryHydrators,
    recommendationQueryHydratorStage,
} from '../../src/services/recommendation/internal/componentCatalog';

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
    it('keeps every base patch when the real UserSignal hydrator merges its stage result', async () => {
        const names = new Set([
            'UserFeaturesQueryHydrator',
            'UserEmbeddingQueryHydrator',
            'UserActionSeqQueryHydrator',
            'UserSignalQueryHydrator',
            'MutualFollowQueryHydrator',
            'ExperimentQueryHydrator',
            'UserStateQueryHydrator',
        ]);
        const hydrators = buildRecommendationQueryHydrators().filter(({ name }) => names.has(name));
        const byName = Object.fromEntries(hydrators.map((hydrator) => [hydrator.name, hydrator])) as any;
        const dependentInputs: Record<string, any> = {};

        byName.UserFeaturesQueryHydrator.hydrate = async (query: any) => ({
            ...query,
            userFeatures: {
                followedUserIds: ['author-1', 'author-2'],
                followerIds: ['author-2'],
                blockedUserIds: [],
                mutedKeywords: [],
                seenPostIds: [],
            },
        });
        byName.UserEmbeddingQueryHydrator.hydrate = async (query: any) => ({
            ...query,
            embeddingContext: {
                interestedInClusters: [],
                producerEmbedding: [],
                usable: true,
            },
        });
        byName.UserActionSeqQueryHydrator.hydrate = async (query: any) => ({
            ...query,
            userActionSequence: [{ action: 'like' }],
        });
        byName.UserSignalQueryHydrator.hydrate = async (query: any) => ({
            ...query,
            userSignalFeatures: {
                favoriteCount: 1,
                retweetCount: 0,
                replyCount: 0,
                quoteCount: 0,
                followCount: 0,
                clickCount: 0,
                videoViewCount: 0,
                dwellTimeMs: 0,
                engagementScore: 0.5,
                explicitScore: 0.4,
                implicitScore: 0.1,
            },
        });
        for (const name of [
            'MutualFollowQueryHydrator',
            'ExperimentQueryHydrator',
            'UserStateQueryHydrator',
        ]) {
            byName[name].hydrate = async (query: any) => {
                dependentInputs[name] = query;
                return {
                    ...query,
                    mutualFollowIds: name === 'MutualFollowQueryHydrator' ? ['author-2'] : undefined,
                    experimentContext: name === 'ExperimentQueryHydrator'
                        ? { userId: query.userId, assignments: [] }
                        : undefined,
                    userStateContext: name === 'UserStateQueryHydrator'
                        ? { state: 'warm' }
                        : undefined,
                };
            };
        }

        await runStagedQueryHydrators(
            createFeedQuery('real-catalog-stage-user', 20),
            hydrators,
            (hydrator) => recommendationQueryHydratorStage(hydrator.name),
            async (hydrator, stageQuery) => hydrator.enable(stageQuery)
                ? { enabled: true, hydrated: await hydrator.hydrate(stageQuery) }
                : { enabled: false, hydrated: stageQuery },
            (query, hydrator, result) => result.enabled
                ? hydrator.update(query, result.hydrated)
                : query,
        );

        expect(Object.keys(dependentInputs)).toHaveLength(3);
        for (const input of Object.values(dependentInputs) as any[]) {
            expect(input.userFeatures.followedUserIds).toEqual(['author-1', 'author-2']);
            expect(input.embeddingContext.usable).toBe(true);
            expect(input.userActionSequence).toEqual([{ action: 'like' }]);
            expect(input.userSignalFeatures.engagementScore).toBe(0.5);
        }
    });

    it('runs dependent public fallback query hydrators after base patches merge', async () => {
        const mixer = new SpaceFeedMixer({ experimentsEnabled: false });
        const pipeline = (mixer as any).pipeline;
        const dependentInputs: Record<string, any> = {};

        pipeline.queryHydrators = [
            {
                name: 'MutualFollowQueryHydrator',
                enable: (query: any) => Boolean(query.userFeatures),
                hydrate: async (query: any) => {
                    dependentInputs.mutual = query;
                    return { mutualFollowIds: ['author-2'] };
                },
                update: (query: any, hydrated: any) => ({ ...query, ...hydrated }),
            },
            {
                name: 'ExperimentQueryHydrator',
                enable: () => true,
                hydrate: async (query: any) => {
                    dependentInputs.experiment = query;
                    return { experimentContext: { userId: query.userId, assignments: [] } };
                },
                update: (query: any, hydrated: any) => ({ ...query, ...hydrated }),
            },
            {
                name: 'UserStateQueryHydrator',
                enable: () => true,
                hydrate: async (query: any) => {
                    dependentInputs.userState = query;
                    return { userStateContext: { state: 'warm' } };
                },
                update: (query: any, hydrated: any) => ({ ...query, ...hydrated }),
            },
            {
                name: 'UserFeaturesQueryHydrator',
                enable: () => true,
                hydrate: async (query: any) => {
                    await new Promise((resolve) => setTimeout(resolve, 30));
                    return {
                        ...query,
                        userFeatures: {
                            followedUserIds: ['author-1', 'author-2'],
                            followerIds: ['author-2'],
                            blockedUserIds: [],
                            mutedKeywords: [],
                            seenPostIds: [],
                            followerCount: 7,
                        },
                    };
                },
                update: (query: any, hydrated: any) => ({ ...query, userFeatures: hydrated.userFeatures }),
            },
            {
                name: 'UserActionSeqQueryHydrator',
                enable: () => true,
                hydrate: async (query: any) => ({ ...query, userActionSequence: [{ action: 'like' }] }),
                update: (query: any, hydrated: any) => ({ ...query, userActionSequence: hydrated.userActionSequence }),
            },
            {
                name: 'UserEmbeddingQueryHydrator',
                enable: () => true,
                hydrate: async (query: any) => ({ ...query, embeddingContext: { usable: true } }),
                update: (query: any, hydrated: any) => ({ ...query, embeddingContext: hydrated.embeddingContext }),
            },
        ];
        let sourceQuery: any;
        pipeline.sources = [{
            name: 'EmptySource',
            enable: () => true,
            getCandidates: async (query: any) => {
                sourceQuery = query;
                return [];
            },
        }];
        pipeline.hydrators = [];
        pipeline.filters = [];
        pipeline.scorers = [];
        pipeline.selector = null;
        pipeline.sideEffects = [];

        await pipeline.execute(createFeedQuery('public-stage-user', 1));

        expect(Object.keys(dependentInputs).sort()).toEqual(['experiment', 'mutual', 'userState']);
        for (const input of Object.values(dependentInputs) as any[]) {
            expect(input.userFeatures.followedUserIds).toEqual(['author-1', 'author-2']);
            expect(input.userActionSequence).toHaveLength(1);
            expect(input.embeddingContext.usable).toBe(true);
        }
        expect(sourceQuery.mutualFollowIds).toEqual(['author-2']);
        expect(sourceQuery.experimentContext.userId).toBe('public-stage-user');
        expect(sourceQuery.userStateContext.state).toBe('warm');
    });

    it('merges source batches before DuplicateFilter in the public fallback', async () => {
        const mixer = new SpaceFeedMixer({ experimentsEnabled: false });
        const pipeline = (mixer as any).pipeline;
        const sharedId = oid('507f191e810c19729de87041');
        const candidate = (source: string): FeedCandidate => ({
            postId: sharedId,
            modelPostId: sharedId.toString(),
            authorId: 'author-shared',
            content: 'shared candidate',
            createdAt: new Date('2026-04-23T00:00:00.000Z'),
            isReply: false,
            isRepost: false,
            recallSource: source,
            retrievalLane: source === 'FollowingSource' ? 'in_network' : 'interest',
            inNetwork: source === 'FollowingSource',
        });

        pipeline.queryHydrators = [];
        pipeline.sources = [
            { name: 'FollowingSource', enable: () => true, getCandidates: async () => [candidate('FollowingSource')] },
            { name: 'TwoTowerSource', enable: () => true, getCandidates: async () => [candidate('TwoTowerSource')] },
        ];
        pipeline.hydrators = [];
        pipeline.filters = [new DuplicateFilter()];
        pipeline.scorers = [];
        pipeline.selector = null;
        pipeline.sideEffects = [];

        const result = await pipeline.execute(createFeedQuery('source-merge-user', 10));

        expect(result.selectedCandidates).toHaveLength(1);
        expect(result.filteredCandidates).toHaveLength(0);
        expect(result.selectedCandidates[0].secondaryRecallSources).toHaveLength(1);
        expect(result.selectedCandidates[0].recallEvidence).toMatchObject({ sourceCount: 2 });
    });

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

    it('passes selector-rejected scored candidates to side effects', async () => {
        let replayCandidates: Candidate[] | undefined;
        const pipeline = new RecommendationPipeline<Query, Candidate>({
            defaultResultSize: 1,
            debug: false,
        })
            .withSource({
                name: 'ReplaySource',
                enable: () => true,
                getCandidates: async () => [
                    mkCandidate(oid('507f191e810c19729de87081'), { score: 2 }),
                    mkCandidate(oid('507f191e810c19729de87082'), { score: 1 }),
                ],
            })
            .withSelector({
                name: 'TopOneSelector',
                enable: () => true,
                getScore: (candidate) => candidate.score ?? 0,
                getSize: () => 1,
                select: (_query, candidates) => [candidates[0].candidate],
            })
            .withSideEffect({
                name: 'ReplayObserver',
                enable: () => true,
                run: async (_query: Query, _selected: Candidate[], context?: any) => {
                    replayCandidates = context?.preSelectorCandidates;
                },
            } as any);

        const result = await pipeline.execute({ requestId: 'req-replay-pool', limit: 1 });

        expect(result.selectedCandidates).toHaveLength(1);
        expect(replayCandidates?.map((candidate) => candidate.postId.toString())).toEqual([
            '507f191e810c19729de87081',
            '507f191e810c19729de87082',
        ]);
    });

    it('captures scorer wrapper metadata in trace clones without mutating selector input', async () => {
        const candidates = [
            oid('507f191e810c19729de87091'),
            oid('507f191e810c19729de87092'),
        ].map((postId): FeedCandidate => ({
            postId,
            modelPostId: postId.toString(),
            authorId: `author-${postId.toString().slice(-2)}`,
            content: 'scored candidate',
            createdAt: new Date('2026-02-01T00:00:00.000Z'),
            isReply: false,
            isRepost: false,
            recallSource: 'TwoTowerSource',
            inNetwork: false,
        }));
        let selectorInput: ScoredCandidate<FeedCandidate>[] = [];
        let replayCandidates: FeedCandidate[] = [];
        const pipeline = new RecommendationPipeline<any, FeedCandidate>({ defaultResultSize: 1 })
            .withSource({
                name: 'ScoredReplaySource',
                enable: () => true,
                getCandidates: async () => candidates,
            })
            .withScorer(new EngagementScorer())
            .withSelector({
                name: 'CaptureSelector',
                enable: () => true,
                getScore: (candidate) => candidate.score ?? 0,
                getSize: () => 1,
                select: (_query, scored) => {
                    selectorInput = scored;
                    return [scored[0].candidate];
                },
            })
            .withSideEffect({
                name: 'CaptureTraceReplay',
                enable: () => true,
                run: async (_query, _selected, context) => {
                    replayCandidates = context?.preSelectorCandidates ?? [];
                },
            });

        await pipeline.execute(createFeedQuery('trace-score-user', 1));

        expect(selectorInput).toHaveLength(2);
        expect(selectorInput[0].score).toBeGreaterThan(0);
        expect(selectorInput[0].scoreBreakdown?.initialScore).toBe(selectorInput[0].score);
        expect(selectorInput[0].candidate.score).toBeUndefined();
        expect(selectorInput[0].candidate._pipelineScore).toBeUndefined();
        expect(selectorInput[0].candidate._scoreBreakdown).toBeUndefined();
        expect(replayCandidates).toHaveLength(2);
        expect(replayCandidates[0]).not.toBe(selectorInput[0].candidate);
        expect(replayCandidates[0].score).toBe(selectorInput[0].score);
        expect(replayCandidates[0]._pipelineScore).toBe(selectorInput[0].score);
        expect(replayCandidates[0]._scoreBreakdown).toMatchObject(
            selectorInput[0].scoreBreakdown ?? {},
        );
    });
});
