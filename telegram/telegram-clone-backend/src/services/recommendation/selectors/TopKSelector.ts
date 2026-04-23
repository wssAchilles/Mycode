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
    laneOrder: RetrievalLane[];
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
        return candidate.score ?? 0;
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
        const sorted = candidates.slice().sort((a, b) => {
            if (query.inNetworkOnly) {
                const at = a.candidate.createdAt instanceof Date ? a.candidate.createdAt.getTime() : 0;
                const bt = b.candidate.createdAt instanceof Date ? b.candidate.createdAt.getTime() : 0;
                if (bt !== at) return bt - at;
            }
            return b.score - a.score;
        });

        if (query.inNetworkOnly) {
            return sorted.slice(0, size).map((item) => item.candidate);
        }

        const window = sorted.slice(0, Math.min(sorted.length, Math.max(size, size * 3)));
        const constraints = selectorConstraints(query, size);
        const selected = new Set<number>();
        const authorCounts = new Map<string, number>();
        const laneCounts = new Map<RetrievalLane, number>();
        let oonCount = 0;

        for (const lane of constraints.laneOrder.filter((entry) => constraints.laneFloors[entry])) {
            const laneFloor = constraints.laneFloors[lane] || 0;
            while ((laneCounts.get(lane) || 0) < laneFloor && selected.size < size) {
                const index = this.nextCandidateIndex(
                    window,
                    selected,
                    authorCounts,
                    laneCounts,
                    constraints,
                    oonCount,
                    lane,
                    this.authorSoftCap,
                    true,
                );
                if (index < 0) break;
                oonCount = this.applySelection(window[index].candidate, index, selected, authorCounts, laneCounts, oonCount);
            }
        }

        while (selected.size < size) {
            const index = this.nextCandidateIndex(
                window,
                selected,
                authorCounts,
                laneCounts,
                constraints,
                oonCount,
                undefined,
                this.authorSoftCap,
                true,
            );
            if (index < 0) break;
            oonCount = this.applySelection(window[index].candidate, index, selected, authorCounts, laneCounts, oonCount);
        }

        while (selected.size < size) {
            const index = this.nextCandidateIndex(
                window,
                selected,
                authorCounts,
                laneCounts,
                constraints,
                oonCount,
                undefined,
                this.authorSoftCap + 1,
                false,
            );
            if (index < 0) break;
            oonCount = this.applySelection(window[index].candidate, index, selected, authorCounts, laneCounts, oonCount);
        }

        const output = Array.from(selected.values())
            .sort((a, b) => a - b)
            .map((index) => window[index].candidate);

        for (const item of sorted.slice(window.length)) {
            if (output.length >= size) break;
            output.push(item.candidate);
        }

        return output.slice(0, size);
    }

    private nextCandidateIndex(
        window: { candidate: FeedCandidate; score: number }[],
        selected: Set<number>,
        authorCounts: Map<string, number>,
        laneCounts: Map<RetrievalLane, number>,
        constraints: SelectorConstraints,
        oonCount: number,
        requiredLane: RetrievalLane | undefined,
        authorSoftCap: number,
        enforceConstraints: boolean,
    ): number {
        for (let index = 0; index < window.length; index += 1) {
            if (selected.has(index)) continue;
            const candidate = window[index].candidate;
            const lane = candidateLane(candidate);
            if (requiredLane && lane !== requiredLane) continue;
            if ((authorCounts.get(candidate.authorId) || 0) >= authorSoftCap) continue;
            if (enforceConstraints) {
                if (candidate.inNetwork === false && oonCount >= constraints.maxOonCount) continue;
                const ceiling = constraints.laneCeilings[lane];
                if (ceiling && (laneCounts.get(lane) || 0) >= ceiling) continue;
            }
            return index;
        }
        return -1;
    }

    private applySelection(
        candidate: FeedCandidate,
        index: number,
        selected: Set<number>,
        authorCounts: Map<string, number>,
        laneCounts: Map<RetrievalLane, number>,
        oonCount: number,
    ): number {
        if (selected.has(index)) {
            return oonCount;
        }
        selected.add(index);
        authorCounts.set(candidate.authorId, (authorCounts.get(candidate.authorId) || 0) + 1);
        const lane = candidateLane(candidate);
        laneCounts.set(lane, (laneCounts.get(lane) || 0) + 1);
        return candidate.inNetwork === false ? oonCount + 1 : oonCount;
    }
}

function selectorConstraints(query: FeedQuery, size: number): SelectorConstraints {
    switch (query.userStateContext?.state) {
        case 'cold_start':
            return {
                laneFloors: { fallback: size },
                laneCeilings: {},
                maxOonCount: size,
                laneOrder: ['fallback'],
            };
        case 'sparse':
            return {
                laneFloors: {
                    in_network: Math.ceil(size * 0.2),
                    interest: Math.ceil(size * 0.4),
                },
                laneCeilings: { fallback: Math.ceil(size * 0.35) },
                maxOonCount: Math.ceil(size * 0.7),
                laneOrder: ['interest', 'in_network', 'fallback'],
            };
        case 'heavy':
            return {
                laneFloors: {
                    in_network: Math.ceil(size * 0.4),
                    social_expansion: Math.ceil(size * 0.12),
                    interest: Math.ceil(size * 0.2),
                },
                laneCeilings: { fallback: Math.ceil(size * 0.15) },
                maxOonCount: Math.ceil(size * 0.45),
                laneOrder: ['in_network', 'social_expansion', 'interest', 'fallback'],
            };
        default:
            return {
                laneFloors: {
                    in_network: Math.ceil(size * 0.35),
                    social_expansion: Math.ceil(size * 0.1),
                    interest: Math.ceil(size * 0.18),
                },
                laneCeilings: { fallback: Math.ceil(size * 0.2) },
                maxOonCount: Math.ceil(size * 0.5),
                laneOrder: ['in_network', 'social_expansion', 'interest', 'fallback'],
            };
    }
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
