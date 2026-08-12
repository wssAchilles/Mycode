import mongoose from 'mongoose';

import { ProductSurface, TargetType } from '../../../models/UserSignal';
import { SERVED_POSITION_CONTRACT_VERSION } from './positionContract';
import type { CandidateNamespace } from './actionIdentity';

export type RecommendationEventType =
    | 'delivery'
    | 'impression'
    | 'click'
    | 'profile_click'
    | 'like'
    | 'unlike'
    | 'reply'
    | 'repost'
    | 'unrepost'
    | 'quote'
    | 'share'
    | 'dwell'
    | 'dismiss'
    | 'hide'
    | 'report'
    | 'block'
    | 'mute'
    | 'follow'
    | 'unfollow'
    | 'search_query'
    | 'hashtag_click'
    | 'open_link';

export interface RecommendationEventInput {
    clientEventId?: string;
    userId: string;
    eventType: RecommendationEventType;
    targetType?: TargetType | 'post' | 'user' | 'topic' | 'list' | 'notification' | 'search_query';
    targetId?: string | mongoose.Types.ObjectId;
    targetCommentId?: string | mongoose.Types.ObjectId;
    targetAuthorId?: string;
    requestId?: string;
    decisionId?: string;
    candidateNamespace?: CandidateNamespace;
    candidateId?: string;
    productSurface?: ProductSurface | string;
    servedPosition?: number;
    positionContractVersion?: typeof SERVED_POSITION_CONTRACT_VERSION;
    recommendationSource?: string;
    secondaryRecallSources?: string[];
    dwellTimeMs?: number;
    score?: number;
    weightedScore?: number;
    inNetwork?: boolean;
    isNews?: boolean;
    modelPostId?: string;
    experimentKeys?: string[];
    occurredAt?: Date;
    selectionPool?: string;
    selectionReason?: string;
    actionText?: string;
    targetKeywords?: string[];
    searchQuery?: string;
    hashtag?: string;
    targetUrl?: string;
}

export interface RecommendationEventBatchResult {
    actionsWritten: number;
    signalsWritten: number;
}

export interface RecommendationEventIdentity {
    clientEventId?: string;
    recommendationEventKey: string;
}

export function buildRecommendationEventKey(input: {
    clientEventId?: string;
    userId: string;
    eventType: string;
    targetId?: string;
    requestId?: string;
    rank?: number;
    occurredAt?: Date | string;
}): string {
    const clientEventId = typeof input.clientEventId === 'string'
        ? input.clientEventId.trim()
        : '';
    if (clientEventId) return clientEventId;
    const hasServingAnchor = Boolean(input.requestId) || input.rank !== undefined;
    const occurredAt = !hasServingAnchor && input.occurredAt
        ? new Date(input.occurredAt).toISOString()
        : undefined;

    return [
        input.userId,
        input.eventType,
        input.targetId || 'no_target',
        input.requestId || 'no_request',
        input.rank ?? 'no_rank',
        occurredAt,
    ].filter((part) => part !== undefined).map((part) => String(part)).join(':');
}
