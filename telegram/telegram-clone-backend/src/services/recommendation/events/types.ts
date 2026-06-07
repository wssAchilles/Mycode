import mongoose from 'mongoose';

import { ProductSurface, TargetType } from '../../../models/UserSignal';

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
    | 'unfollow';

export interface RecommendationEventInput {
    userId: string;
    eventType: RecommendationEventType;
    targetType?: TargetType | 'post' | 'user' | 'topic' | 'list' | 'notification' | 'search_query';
    targetId?: string | mongoose.Types.ObjectId;
    targetAuthorId?: string;
    requestId?: string;
    productSurface?: ProductSurface | string;
    position?: number;
    recommendationSource?: string;
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
}

export interface RecommendationEventBatchResult {
    actionsWritten: number;
    signalsWritten: number;
}
