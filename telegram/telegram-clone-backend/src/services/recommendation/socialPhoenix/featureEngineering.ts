import type { FeedCandidate } from '../types/FeedCandidate';
import type { FeedQuery, UserStateKind } from '../types/FeedQuery';
import type { SocialPhoenixFeatureMap } from './types';
import { readFeedSignalValue } from '../signals/feedSignalSemantics';

type UserStateLike = UserStateKind | 'unknown';

export interface SocialPhoenixFeatureInput {
    userState?: UserStateLike;
    embeddingQualityScore?: number;
    recallSource?: string;
    inNetwork?: boolean;
    authorAffinityScore?: number;
    retrievalEmbeddingScore?: number;
    retrievalDenseVectorScore?: number;
    retrievalAuthorClusterScore?: number;
    retrievalCandidateClusterScore?: number;
    retrievalKeywordScore?: number;
    retrievalEngagementPrior?: number;
    retrievalSnapshotQuality?: number;
    likeCount?: number;
    commentCount?: number;
    repostCount?: number;
    createdAt?: Date | string;
    hasImage?: boolean;
    hasVideo?: boolean;
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}

function freshnessDecay(createdAt?: Date | string): number {
    if (!createdAt) return 0;
    const timestamp = new Date(createdAt).getTime();
    if (!Number.isFinite(timestamp)) return 0;
    const ageHours = Math.max(0, (Date.now() - timestamp) / (1000 * 60 * 60));
    return clamp01(Math.exp(-ageHours / 72));
}

function engagementPrior(input: Pick<SocialPhoenixFeatureInput, 'likeCount' | 'commentCount' | 'repostCount'>): number {
    const engagements =
        (input.likeCount || 0) +
        (input.commentCount || 0) * 2 +
        (input.repostCount || 0) * 3;
    return clamp01(engagements / 120);
}

function setFeature(target: SocialPhoenixFeatureMap, key: string, value: number): void {
    if (!Number.isFinite(value) || value === 0) {
        return;
    }
    target[key] = value;
}

export function buildSocialPhoenixFeatureMap(input: SocialPhoenixFeatureInput): SocialPhoenixFeatureMap {
    const features: SocialPhoenixFeatureMap = {};
    const resolvedUserState = input.userState || 'unknown';
    const resolvedRecallSource = input.recallSource || 'unknown';
    const resolvedEngagementPrior = typeof input.retrievalEngagementPrior === 'number'
        ? clamp01(input.retrievalEngagementPrior)
        : engagementPrior(input);

    setFeature(features, 'bias', 1);
    setFeature(features, 'embedding_quality', clamp01(input.embeddingQualityScore || 0));
    setFeature(features, 'author_affinity', clamp01(input.authorAffinityScore || 0));
    setFeature(features, 'retrieval_embedding', clamp01(input.retrievalEmbeddingScore || 0));
    setFeature(features, 'retrieval_dense', clamp01(input.retrievalDenseVectorScore || 0));
    setFeature(features, 'retrieval_author_cluster', clamp01(input.retrievalAuthorClusterScore || 0));
    setFeature(features, 'retrieval_candidate_cluster', clamp01(input.retrievalCandidateClusterScore || 0));
    setFeature(features, 'retrieval_keyword', clamp01(input.retrievalKeywordScore || 0));
    setFeature(features, 'engagement_prior', resolvedEngagementPrior);
    setFeature(features, 'snapshot_quality', clamp01(input.retrievalSnapshotQuality || 0));
    setFeature(features, 'freshness', freshnessDecay(input.createdAt));
    setFeature(features, 'has_image', input.hasImage ? 1 : 0);
    setFeature(features, 'has_video', input.hasVideo ? 1 : 0);
    setFeature(features, 'has_media', input.hasImage || input.hasVideo ? 1 : 0);
    setFeature(features, 'in_network', input.inNetwork ? 1 : 0);
    setFeature(features, 'out_of_network', input.inNetwork ? 0 : 1);
    setFeature(features, `source:${resolvedRecallSource}`, 1);
    setFeature(features, `user_state:${resolvedUserState}`, 1);

    return features;
}

export function buildSocialPhoenixFeatureMapFromCandidate(
    query: FeedQuery,
    candidate: FeedCandidate,
): SocialPhoenixFeatureMap {
    const signalInput = {
        candidate,
        scoreBreakdown: candidate._scoreBreakdown,
    };
    return buildSocialPhoenixFeatureMap({
        userState: query.userStateContext?.state || 'unknown',
        embeddingQualityScore: query.embeddingContext?.qualityScore || 0,
        recallSource: candidate.recallSource,
        inNetwork: candidate.inNetwork,
        authorAffinityScore: readFeedSignalValue(signalInput, 'authorAffinityScore'),
        retrievalEmbeddingScore: readFeedSignalValue(signalInput, 'retrievalEmbeddingScore'),
        retrievalDenseVectorScore: readFeedSignalValue(signalInput, 'retrievalDenseVectorScore'),
        retrievalAuthorClusterScore: readFeedSignalValue(signalInput, 'retrievalAuthorClusterScore'),
        retrievalCandidateClusterScore: readFeedSignalValue(signalInput, 'retrievalCandidateClusterScore'),
        retrievalKeywordScore: readFeedSignalValue(signalInput, 'retrievalKeywordScore'),
        retrievalEngagementPrior: readFeedSignalValue(signalInput, 'retrievalEngagementPrior'),
        retrievalSnapshotQuality: readFeedSignalValue(signalInput, 'retrievalSnapshotQuality'),
        likeCount: candidate.likeCount,
        commentCount: candidate.commentCount,
        repostCount: candidate.repostCount,
        createdAt: candidate.createdAt,
        hasImage: candidate.hasImage,
        hasVideo: candidate.hasVideo,
    });
}
