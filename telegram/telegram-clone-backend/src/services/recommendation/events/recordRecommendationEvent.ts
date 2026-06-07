import mongoose from 'mongoose';

import UserAction from '../../../models/UserAction';
import { TargetType } from '../../../models/UserSignal';
import { UserSignalService } from '../UserSignalService';
import {
    mapEventToActionType,
    mapEventToSignalType,
    normalizeProductSurface,
    normalizeTargetType,
} from './eventMapping';
import type { RecommendationEventBatchResult, RecommendationEventInput } from './types';

const userSignalService = UserSignalService.getInstance();

export async function recordRecommendationEvent(
    event: RecommendationEventInput,
): Promise<RecommendationEventBatchResult> {
    return recordRecommendationEvents([event]);
}

export async function recordRecommendationEvents(
    events: RecommendationEventInput[],
): Promise<RecommendationEventBatchResult> {
    if (events.length === 0) {
        return { actionsWritten: 0, signalsWritten: 0 };
    }

    const actions: any[] = [];
    const signals: any[] = [];

    for (const event of events) {
        if (!event.userId) continue;

        const targetId = event.targetId ? String(event.targetId) : '';
        const targetType = normalizeTargetType(event.targetType);
        const productSurface = normalizeProductSurface(event.productSurface);
        const occurredAt = event.occurredAt || new Date();
        const actionType = mapEventToActionType(event.eventType);
        const signalType = mapEventToSignalType(event.eventType);

        if (actionType) {
            actions.push({
                userId: event.userId,
                action: actionType,
                targetPostId:
                    targetType === TargetType.POST && mongoose.Types.ObjectId.isValid(targetId)
                        ? new mongoose.Types.ObjectId(targetId)
                        : undefined,
                targetAuthorId: event.targetAuthorId,
                requestId: event.requestId,
                dwellTimeMs: event.dwellTimeMs,
                rank: event.position,
                score: toFiniteNumber(event.score),
                weightedScore: toFiniteNumber(event.weightedScore),
                inNetwork: event.inNetwork,
                isNews: event.isNews,
                modelPostId: event.modelPostId,
                recallSource: event.recommendationSource,
                selectionPool: event.selectionPool,
                selectionReason: event.selectionReason,
                experimentKeys: event.experimentKeys,
                targetKeywords: event.targetKeywords,
                targetUrl: event.targetUrl,
                actionText: event.actionText,
                productSurface,
                timestamp: occurredAt,
            });
        }

        if (signalType && targetId) {
            signals.push({
                userId: event.userId,
                signalType,
                targetId,
                targetType,
                targetAuthorId: event.targetAuthorId,
                productSurface,
                requestId: event.requestId,
                metadata: {
                    dwellTimeMs: event.dwellTimeMs,
                    recommendationPosition: event.position,
                    recommendationSource: event.recommendationSource,
                    recommendationScore: toFiniteNumber(event.score),
                    weightedScore: toFiniteNumber(event.weightedScore),
                    inNetwork: event.inNetwork,
                    isNews: event.isNews,
                    modelPostId: event.modelPostId,
                    selectionPool: event.selectionPool,
                    selectionReason: event.selectionReason,
                    experimentKeys: event.experimentKeys,
                    searchQuery: event.searchQuery,
                    hashtag: event.hashtag,
                    targetUrl: event.targetUrl,
                    targetKeywords: event.targetKeywords,
                },
            });
        }
    }

    const writes: Promise<unknown>[] = [];
    if (actions.length > 0) {
        writes.push(UserAction.logActions(actions));
    }
    if (signals.length > 0) {
        writes.push(userSignalService.logSignalsBatch(signals));
    }
    await Promise.all(writes);

    return {
        actionsWritten: actions.length,
        signalsWritten: signals.length,
    };
}

function toFiniteNumber(value: number | undefined): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
