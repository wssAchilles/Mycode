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
import {
    buildRecommendationEventKey,
    type RecommendationEventBatchResult,
    type RecommendationEventInput,
} from './types';
import {
    normalizeServedPosition,
    SERVED_POSITION_CONTRACT_VERSION,
} from './positionContract';
import { normalizeRecommendationActionIdentity } from './actionIdentity';

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
        const servedPosition = event.positionContractVersion === SERVED_POSITION_CONTRACT_VERSION
            ? normalizeServedPosition(event.servedPosition)
            : undefined;
        const positionContractVersion = servedPosition === undefined
            ? undefined
            : SERVED_POSITION_CONTRACT_VERSION;
        const actionIdentity = normalizeRecommendationActionIdentity(event);
        const eventKey = buildRecommendationEventKey({
            clientEventId: event.clientEventId,
            userId: event.userId,
            eventType: event.eventType,
            targetId,
            requestId: event.requestId,
            rank: servedPosition,
            occurredAt,
        });
        const metadata = {
            clientEventId: event.clientEventId,
            recommendationEventKey: eventKey,
            positionContractVersion,
            ...actionIdentity,
        };

        if (actionType) {
            actions.push({
                userId: event.userId,
                action: actionType,
                targetPostId:
                    targetType === TargetType.POST && mongoose.Types.ObjectId.isValid(targetId)
                        ? new mongoose.Types.ObjectId(targetId)
                        : undefined,
                targetCommentId:
                    event.targetCommentId && mongoose.Types.ObjectId.isValid(String(event.targetCommentId))
                        ? new mongoose.Types.ObjectId(String(event.targetCommentId))
                        : undefined,
                targetAuthorId: event.targetAuthorId,
                requestId: event.requestId,
                dwellTimeMs: event.dwellTimeMs,
                rank: servedPosition,
                score: toFiniteNumber(event.score),
                weightedScore: toFiniteNumber(event.weightedScore),
                inNetwork: event.inNetwork,
                isNews: event.isNews,
                modelPostId: event.modelPostId,
                recallSource: event.recommendationSource,
                secondaryRecallSources: normalizeStringArray(event.secondaryRecallSources),
                selectionPool: event.selectionPool,
                selectionReason: event.selectionReason,
                experimentKeys: event.experimentKeys,
                targetKeywords: event.targetKeywords,
                targetUrl: event.targetUrl,
                actionText: event.actionText,
                productSurface,
                metadata,
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
                    recommendationPosition: servedPosition,
                    positionContractVersion,
                    ...actionIdentity,
                    recommendationSource: event.recommendationSource,
                    secondaryRecallSources: normalizeStringArray(event.secondaryRecallSources),
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
                    clientEventId: event.clientEventId,
                    recommendationEventKey: eventKey,
                },
            });
        }
    }

    const dedupedActions = dedupeByRecommendationEventKey(actions);
    const dedupedSignals = dedupeByRecommendationEventKey(signals);

    const writes: Promise<unknown>[] = [];
    if (dedupedActions.length > 0) {
        writes.push(UserAction.logActions(dedupedActions));
    }
    if (dedupedSignals.length > 0) {
        writes.push(userSignalService.logSignalsBatch(dedupedSignals));
    }
    await Promise.all(writes);

    return {
        actionsWritten: dedupedActions.length,
        signalsWritten: dedupedSignals.length,
    };
}

function toFiniteNumber(value: number | undefined): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeStringArray(values: string[] | undefined): string[] | undefined {
    if (!Array.isArray(values)) return undefined;
    const normalized = values
        .map((value) => value.trim())
        .filter(Boolean);
    return normalized.length > 0 ? normalized : undefined;
}

function dedupeByRecommendationEventKey<T extends { metadata?: { recommendationEventKey?: string } }>(
    docs: T[],
): T[] {
    const keyedDocs = new Map<string, T>();
    const unkeyedDocs: T[] = [];

    for (const doc of docs) {
        const eventKey = doc.metadata?.recommendationEventKey;
        if (eventKey) {
            if (!keyedDocs.has(eventKey)) keyedDocs.set(eventKey, doc);
        } else {
            unkeyedDocs.push(doc);
        }
    }

    return [...keyedDocs.values(), ...unkeyedDocs];
}
