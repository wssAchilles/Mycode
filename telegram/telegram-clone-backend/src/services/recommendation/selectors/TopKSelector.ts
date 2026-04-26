import { Selector } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';

type RetrievalLane =
    | 'in_network'
    | 'social_expansion'
    | 'interest'
    | 'fallback';

type SelectorConstraints = {
    laneFloors: Partial<Record<RetrievalLane, number>>;
    laneCeilings: Partial<Record<RetrievalLane, number>>;
    maxOonCount: number;
    explorationFloor: number;
    laneOrder: RetrievalLane[];
};

type CandidateWindowItem = {
    candidate: FeedCandidate;
    score: number;
};

type SelectionState = {
    selected: Set<number>;
    order: number[];
    authorCounts: Map<string, number>;
    laneCounts: Map<RetrievalLane, number>;
    sourceCounts: Map<string, number>;
    topicCounts: Map<string, number>;
    oonCount: number;
};

export class TopKSelector implements Selector<FeedQuery, FeedCandidate> {
    readonly name = 'TopKSelector';
    private fallbackSize: number;
    private oversampleFactor: number;
    private maxSize?: number;
    private authorSoftCap: number;

    constructor(
        fallbackSize: number,
        options?: { oversampleFactor?: number; maxSize?: number; authorSoftCap?: number }
    ) {
        this.fallbackSize = fallbackSize;
        this.oversampleFactor = Math.max(1, options?.oversampleFactor ?? 1);
        this.maxSize = options?.maxSize;
        this.authorSoftCap = Math.max(1, options?.authorSoftCap ?? 2);
    }

    enable(_query: FeedQuery): boolean {
        return true;
    }

    getScore(candidate: FeedCandidate): number {
        return candidate.score ?? candidate.weightedScore ?? candidate._pipelineScore ?? 0;
    }

    getSize(query: FeedQuery): number {
        const base = query.limit || this.fallbackSize;
        const size = base * this.oversampleFactor;
        return this.maxSize ? Math.min(size, this.maxSize) : size;
    }

    select(
        query: FeedQuery,
        candidates: { candidate: FeedCandidate; score: number }[]
    ): FeedCandidate[] {
        const size = this.getSize(query);
        const sorted = candidates.slice().sort((a, b) => compareCandidates(query, a, b));
        if (query.inNetworkOnly) {
            return sorted.slice(0, size).map((item) => item.candidate);
        }

        const constraints = selectorConstraints(query, size);
        const window = sorted.slice(0, Math.min(sorted.length, Math.max(size, size * windowFactor(query))));
        const state: SelectionState = {
            selected: new Set<number>(),
            order: [],
            authorCounts: new Map<string, number>(),
            laneCounts: new Map<RetrievalLane, number>(),
            sourceCounts: new Map<string, number>(),
            topicCounts: new Map<string, number>(),
            oonCount: 0,
        };
        const authorSoftCap = authorSoftCapForQuery(query, size, this.authorSoftCap);
        const topicSoftCap = topicSoftCapForQuery(query, size);
        const sourceSoftCap = sourceSoftCapForQuery(query, size);

        this.fillPersonalizedWindow(query, window, size, constraints, state, authorSoftCap, topicSoftCap, sourceSoftCap);
        this.fillRequiredLaneFloors(window, size, constraints, state, authorSoftCap, topicSoftCap, sourceSoftCap);
        this.fillExplorationFloor(window, size, constraints, state, authorSoftCap, topicSoftCap, sourceSoftCap);
        this.fillByLaneOrder(window, size, constraints.laneOrder, constraints, state, authorSoftCap, topicSoftCap, sourceSoftCap, true);
        this.fillBestAvailable(window, size, constraints, state, authorSoftCap, topicSoftCap, sourceSoftCap, true);
        this.fillByLaneOrder(window, size, constraints.laneOrder, constraints, state, authorSoftCap + 1, topicSoftCap + 1, sourceSoftCap + 1, false);
        this.fillBestAvailable(window, size, constraints, state, authorSoftCap + 1, topicSoftCap + 1, sourceSoftCap + 1, false);

        const output = state.order.map((index) => window[index].candidate);
        for (const item of sorted.slice(window.length)) {
            if (output.length >= size) break;
            output.push(item.candidate);
        }

        return output.slice(0, size).map((candidate) => markSelection(candidate));
    }

    private fillPersonalizedWindow(
        query: FeedQuery,
        window: CandidateWindowItem[],
        size: number,
        constraints: SelectorConstraints,
        state: SelectionState,
        authorSoftCap: number,
        topicSoftCap: number,
        sourceSoftCap: number,
    ): void {
        const target = Math.min(personalizedWindowSize(query, size), size);
        this.fillBestAvailable(
            window,
            target,
            constraints,
            state,
            authorSoftCap,
            topicSoftCap,
            sourceSoftCap,
            true,
            undefined,
            isStrongPersonalizedCandidate,
        );
    }

    private fillRequiredLaneFloors(
        window: CandidateWindowItem[],
        size: number,
        constraints: SelectorConstraints,
        state: SelectionState,
        authorSoftCap: number,
        topicSoftCap: number,
        sourceSoftCap: number,
    ): void {
        let progress = true;
        while (state.selected.size < size && progress) {
            progress = false;
            for (const lane of constraints.laneOrder) {
                if ((state.laneCounts.get(lane) || 0) >= (constraints.laneFloors[lane] || 0)) {
                    continue;
                }
                const index = this.nextCandidateIndex(
                    window,
                    constraints,
                    state,
                    authorSoftCap,
                    topicSoftCap,
                    sourceSoftCap,
                    true,
                    lane,
                );
                if (index >= 0) {
                    applySelection(window[index].candidate, index, state);
                    progress = true;
                }
            }
        }
    }

    private fillExplorationFloor(
        window: CandidateWindowItem[],
        size: number,
        constraints: SelectorConstraints,
        state: SelectionState,
        authorSoftCap: number,
        topicSoftCap: number,
        sourceSoftCap: number,
    ): void {
        while (
            state.selected.size < size &&
            Array.from(state.selected).filter((index) => isExplorationCandidate(window[index].candidate)).length < constraints.explorationFloor
        ) {
            const index = this.nextCandidateIndex(
                window,
                constraints,
                state,
                authorSoftCap,
                topicSoftCap,
                sourceSoftCap,
                true,
                undefined,
                isExplorationCandidate,
            );
            if (index < 0) break;
            applySelection(window[index].candidate, index, state);
        }
    }

    private fillByLaneOrder(
        window: CandidateWindowItem[],
        size: number,
        laneOrder: RetrievalLane[],
        constraints: SelectorConstraints,
        state: SelectionState,
        authorSoftCap: number,
        topicSoftCap: number,
        sourceSoftCap: number,
        enforceConstraints: boolean,
    ): void {
        let progress = true;
        while (state.selected.size < size && progress) {
            progress = false;
            for (const lane of laneOrder) {
                const index = this.nextCandidateIndex(
                    window,
                    constraints,
                    state,
                    authorSoftCap,
                    topicSoftCap,
                    sourceSoftCap,
                    enforceConstraints,
                    lane,
                );
                if (index >= 0) {
                    applySelection(window[index].candidate, index, state);
                    progress = true;
                }
            }
        }
    }

    private fillBestAvailable(
        window: CandidateWindowItem[],
        size: number,
        constraints: SelectorConstraints,
        state: SelectionState,
        authorSoftCap: number,
        topicSoftCap: number,
        sourceSoftCap: number,
        enforceConstraints: boolean,
        requiredLane?: RetrievalLane,
        predicate?: (candidate: FeedCandidate) => boolean,
    ): void {
        while (state.selected.size < size) {
            const index = this.nextCandidateIndex(
                window,
                constraints,
                state,
                authorSoftCap,
                topicSoftCap,
                sourceSoftCap,
                enforceConstraints,
                requiredLane,
                predicate,
            );
            if (index < 0) break;
            applySelection(window[index].candidate, index, state);
        }
    }

    private nextCandidateIndex(
        window: CandidateWindowItem[],
        constraints: SelectorConstraints,
        state: SelectionState,
        authorSoftCap: number,
        topicSoftCap: number,
        sourceSoftCap: number,
        enforceConstraints: boolean,
        requiredLane?: RetrievalLane,
        predicate?: (candidate: FeedCandidate) => boolean,
    ): number {
        for (let index = 0; index < window.length; index += 1) {
            if (state.selected.has(index)) continue;
            const candidate = window[index].candidate;
            if (predicate && !predicate(candidate)) continue;
            if (canSelectCandidate(
                candidate,
                constraints,
                state,
                authorSoftCap,
                topicSoftCap,
                sourceSoftCap,
                enforceConstraints,
                requiredLane,
            )) {
                return index;
            }
        }
        return -1;
    }
}

function compareCandidates(query: FeedQuery, a: CandidateWindowItem, b: CandidateWindowItem): number {
    if (query.inNetworkOnly) {
        const diff = toTime(b.candidate.createdAt) - toTime(a.candidate.createdAt);
        if (diff !== 0) return diff;
    } else if (b.score !== a.score) {
        return b.score - a.score;
    }
    const timeDiff = toTime(b.candidate.createdAt) - toTime(a.candidate.createdAt);
    if (timeDiff !== 0) return timeDiff;
    const postDiff = a.candidate.postId.toString().localeCompare(b.candidate.postId.toString());
    if (postDiff !== 0) return postDiff;
    return a.candidate.authorId.localeCompare(b.candidate.authorId);
}

function canSelectCandidate(
    candidate: FeedCandidate,
    constraints: SelectorConstraints,
    state: SelectionState,
    authorSoftCap: number,
    topicSoftCap: number,
    sourceSoftCap: number,
    enforceConstraints: boolean,
    requiredLane?: RetrievalLane,
): boolean {
    const lane = candidateLane(candidate);
    if (requiredLane && lane !== requiredLane) return false;
    if ((state.authorCounts.get(candidate.authorId) || 0) >= authorSoftCap) return false;
    if (!enforceConstraints) return true;
    if ((state.sourceCounts.get(candidateSource(candidate)) || 0) >= sourceSoftCap) return false;
    if (candidate.inNetwork === false && state.oonCount >= constraints.maxOonCount) return false;
    const ceiling = constraints.laneCeilings[lane];
    if (ceiling !== undefined && (state.laneCounts.get(lane) || 0) >= ceiling) return false;
    const topicKey = candidateTopicKey(candidate);
    return !(topicKey && (state.topicCounts.get(topicKey) || 0) >= topicSoftCap);
}

function applySelection(candidate: FeedCandidate, index: number, state: SelectionState): void {
    if (state.selected.has(index)) return;
    state.selected.add(index);
    state.order.push(index);
    state.authorCounts.set(candidate.authorId, (state.authorCounts.get(candidate.authorId) || 0) + 1);
    const lane = candidateLane(candidate);
    state.laneCounts.set(lane, (state.laneCounts.get(lane) || 0) + 1);
    const source = candidateSource(candidate);
    state.sourceCounts.set(source, (state.sourceCounts.get(source) || 0) + 1);
    const topicKey = candidateTopicKey(candidate);
    if (topicKey) state.topicCounts.set(topicKey, (state.topicCounts.get(topicKey) || 0) + 1);
    if (candidate.inNetwork === false) state.oonCount += 1;
}

function selectorConstraints(query: FeedQuery, size: number): SelectorConstraints {
    const maxOonCount = (defaultRatio: number) => Math.min(size, Math.ceil(size * policyNumber(query, 'maxOonRatio', defaultRatio)));
    const fallbackCeiling = (defaultRatio: number) => Math.min(size, Math.ceil(size * policyNumber(query, 'fallbackCeilingRatio', defaultRatio)));
    const explorationFloor = (defaultRatio: number) => Math.ceil(size * policyNumber(query, 'explorationFloorRatio', defaultRatio));
    switch (query.userStateContext?.state) {
        case 'cold_start':
            return {
                laneFloors: { fallback: size },
                laneCeilings: {},
                maxOonCount: maxOonCount(1),
                explorationFloor: explorationFloor(0.24),
                laneOrder: ['fallback'],
            };
        case 'sparse':
            return {
                laneFloors: {
                    in_network: Math.ceil(size * 0.16),
                    social_expansion: Math.ceil(size * 0.08),
                    interest: Math.ceil(size * 0.36),
                },
                laneCeilings: { fallback: fallbackCeiling(0.25) },
                maxOonCount: maxOonCount(0.64),
                explorationFloor: explorationFloor(0.14),
                laneOrder: ['interest', 'social_expansion', 'in_network', 'fallback'],
            };
        case 'heavy':
            return {
                laneFloors: {
                    in_network: Math.ceil(size * 0.35),
                    social_expansion: Math.ceil(size * 0.16),
                    interest: Math.ceil(size * 0.18),
                },
                laneCeilings: { fallback: fallbackCeiling(0.12) },
                maxOonCount: maxOonCount(0.42),
                explorationFloor: explorationFloor(0.06),
                laneOrder: ['in_network', 'social_expansion', 'interest', 'fallback'],
            };
        default:
            return {
                laneFloors: {
                    in_network: Math.ceil(size * 0.32),
                    social_expansion: Math.ceil(size * 0.12),
                    interest: Math.ceil(size * 0.22),
                },
                laneCeilings: { fallback: fallbackCeiling(0.18) },
                maxOonCount: maxOonCount(0.46),
                explorationFloor: explorationFloor(0.08),
                laneOrder: ['in_network', 'social_expansion', 'interest', 'fallback'],
            };
    }
}

function windowFactor(query: FeedQuery): number {
    switch (query.userStateContext?.state) {
        case 'cold_start':
            return 2;
        case 'sparse':
        case 'heavy':
            return 4;
        default:
            return 3;
    }
}

function personalizedWindowSize(query: FeedQuery, size: number): number {
    switch (query.userStateContext?.state) {
        case 'cold_start':
            return 0;
        case 'sparse':
            return Math.max(1, Math.ceil(size * 0.2));
        case 'heavy':
            return Math.max(1, Math.ceil(size * 0.25));
        default:
            return 0;
    }
}

function authorSoftCapForQuery(query: FeedQuery, size: number, baseCap: number): number {
    const configured = Math.max(1, query.rankingPolicy?.authorSoftCap ?? baseCap);
    switch (query.userStateContext?.state) {
        case 'cold_start':
            return Math.max(2, configured + 1);
        case 'sparse':
            return size >= 8 ? Math.max(2, configured + 1) : configured;
        default:
            return configured;
    }
}

function topicSoftCapForQuery(query: FeedQuery, size: number): number {
    const ratio = query.rankingPolicy?.topicSoftCapRatio;
    if (typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0) {
        return Math.max(1, Math.ceil(size * Math.min(1, ratio)));
    }
    switch (query.userStateContext?.state) {
        case 'cold_start':
            return Math.max(1, size);
        case 'sparse':
            return Math.max(2, Math.ceil(size * 0.38));
        case 'heavy':
            return Math.max(3, Math.ceil(size * 0.45));
        default:
            return Math.max(3, Math.ceil(size * 0.42));
    }
}

function sourceSoftCapForQuery(query: FeedQuery, size: number): number {
    const ratio = query.rankingPolicy?.sourceSoftCapRatio;
    if (typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0) {
        return Math.max(1, Math.ceil(size * Math.min(1, ratio)));
    }
    switch (query.userStateContext?.state) {
        case 'cold_start':
            return Math.max(1, size);
        case 'sparse':
            return Math.max(2, Math.ceil(size * 0.48));
        case 'heavy':
            return Math.max(2, Math.ceil(size * 0.42));
        default:
            return Math.max(2, Math.ceil(size * 0.5));
    }
}

function candidateTopicKey(candidate: FeedCandidate): string | undefined {
    const clusterId = candidate.newsMetadata?.clusterId;
    if (typeof clusterId === 'number' && Number.isFinite(clusterId)) return `news_cluster:${clusterId}`;
    if (candidate.conversationId) return `conversation:${candidate.conversationId.toString()}`;
    if (candidate.interestPoolKind) return `interest_pool:${candidate.interestPoolKind}`;
    return `format:${candidateFormatKey(candidate)}`;
}

function isStrongPersonalizedCandidate(candidate: FeedCandidate): boolean {
    if (candidate.inNetwork) return true;
    const breakdown = candidate._scoreBreakdown || {};
    const authorAffinity = Math.max(candidate.authorAffinityScore || 0, breakdown.authorAffinityScore || 0);
    const evidenceConfidence = breakdown.retrievalEvidenceConfidence || 0;
    const denseScore = breakdown.retrievalDenseVectorScore || 0;
    const topicScore = Math.max(
        breakdown.retrievalTopicCoverageScore || 0,
        breakdown.retrievalCandidateClusterScore || 0,
    );
    const graphScore = Math.max(candidate.graphScore || 0, breakdown.retrievalAuthorGraphPrior || 0);
    return authorAffinity >= 0.18
        || evidenceConfidence >= 0.62
        || (candidateLane(candidate) === 'interest' && Math.max(denseScore, topicScore) >= 0.25)
        || graphScore >= 0.2;
}

function isExplorationCandidate(candidate: FeedCandidate): boolean {
    const lane = candidateLane(candidate);
    const breakdown = candidate._scoreBreakdown || {};
    return (breakdown.explorationEligible || 0) >= 0.5
        || (candidate.inNetwork !== true
            && (lane === 'fallback' || lane === 'interest')
            && (breakdown.fatigueStrength || 0) < 0.42);
}

function markSelection(candidate: FeedCandidate): FeedCandidate {
    const pool = candidateSelectionPool(candidate);
    return {
        ...candidate,
        selectionPool: candidate.selectionPool ?? pool,
        selectionReason: candidate.selectionReason ?? selectionReason(candidate, pool),
        scoreContractVersion: candidate.scoreContractVersion ?? 'recommendation_score_contract_v2',
        scoreBreakdownVersion: candidate.scoreBreakdownVersion ?? 'score_breakdown_v2',
    };
}

function candidateSelectionPool(candidate: FeedCandidate): string {
    if ((candidate._scoreBreakdown?.selectorRescueEligible || 0) >= 0.5) return 'rescue';
    if (isExplorationCandidate(candidate)) return 'exploration';
    const lane = candidateLane(candidate);
    if (lane === 'in_network' || lane === 'social_expansion' || lane === 'interest') return 'primary';
    return 'fallback';
}

function selectionReason(candidate: FeedCandidate, pool: string): string {
    if (pool === 'primary' && candidate.inNetwork) return 'in_network_primary';
    if (pool === 'primary') return `${candidateLane(candidate)}_primary`;
    if (pool === 'exploration') return 'bandit_or_novelty_exploration';
    if (pool === 'rescue') return 'underfill_rescue';
    return `${candidateLane(candidate)}_fallback`;
}

function candidateLane(candidate: FeedCandidate): RetrievalLane {
    switch (candidate.retrievalLane) {
        case 'in_network':
        case 'social_expansion':
        case 'interest':
        case 'fallback':
            return candidate.retrievalLane;
        default:
            switch (candidate.recallSource) {
                case 'FollowingSource':
                    return 'in_network';
                case 'GraphSource':
                case 'GraphKernelSource':
                    return 'social_expansion';
                case 'TwoTowerSource':
                case 'EmbeddingAuthorSource':
                case 'NewsAnnSource':
                    return 'interest';
                default:
                    return 'fallback';
            }
    }
}

function candidateSource(candidate: FeedCandidate): string {
    return candidate.recallSource || candidate.retrievalLane || candidateLane(candidate);
}

function candidateFormatKey(candidate: FeedCandidate): string {
    if (candidate.isNews) return 'news';
    if (candidate.hasVideo) return 'video';
    if (candidate.hasImage) return 'image';
    if (candidate.isReply) return 'reply';
    if (candidate.isRepost) return 'repost';
    return 'text';
}

function policyNumber(query: FeedQuery, key: keyof NonNullable<FeedQuery['rankingPolicy']>, fallback: number): number {
    const value = query.rankingPolicy?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function toTime(value: Date | string): number {
    const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isFinite(time) ? time : 0;
}
