export type AuthorSuggestionSource = 'active' | 'embedding' | 'graph' | 'fallback';

export type ViewerSuggestionState = 'cold_start' | 'sparse' | 'engaged';

export interface RecommendedAuthorSuggestion {
    id: string;
    username: string;
    avatarUrl?: string | null;
    isOnline?: boolean | null;
    reason?: string;
    isFollowed: boolean;
    recentPosts: number;
    engagementScore: number;
}

export interface ViewerSuggestionProfile {
    state: ViewerSuggestionState;
    followedCount: number;
    recentPositiveActionCount: number;
    hasEmbedding: boolean;
}

export interface AuthorSuggestionCandidate {
    userId: string;
    sources: AuthorSuggestionSource[];
    sourceScores: Partial<Record<AuthorSuggestionSource, number>>;
    recentPosts: number;
    engagementScore: number;
    graphProximity: number;
    embeddingAffinity: number;
    clusterProducerPrior: number;
    qualityScore: number;
    recentActivityPrior: number;
    engagementPrior: number;
    noveltyBonus: number;
    lowQualityDamping: number;
    score: number;
    reason?: string;
}

export interface ViewerAuthorSignal {
    authorId: string;
    score: number;
}
