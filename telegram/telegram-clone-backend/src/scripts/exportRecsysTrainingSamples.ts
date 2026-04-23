/**
 * 导出推荐训练样本（基于 impression + action window）
 *
 * 用法：
 *   npx ts-node src/scripts/exportRecsysTrainingSamples.ts --days 30 --windowHours 24 --output ./tmp/recsys_samples.ndjson
 *   npx ts-node src/scripts/exportRecsysTrainingSamples.ts --experimentKey space_feed_recsys_alignment:treatment --limit 5000
 */

import fs from 'fs';
import path from 'path';

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Op } from 'sequelize';

import { connectMongoDB } from '../config/db';
import { sequelize } from '../config/sequelize';
import Contact, { ContactStatus } from '../models/Contact';
import User from '../models/User';
import UserAction, { ActionType } from '../models/UserAction';
import UserFeatureVector from '../models/UserFeatureVector';
import { postFeatureSnapshotService } from '../services/recommendation/contentFeatures';
import { buildSocialPhoenixFeatureMap } from '../services/recommendation/socialPhoenix';
import {
    computeEmbeddingRecallSignalsFromSnapshot,
    prepareEmbeddingRetrievalContext,
    type PreparedEmbeddingRetrievalContext,
} from '../services/recommendation/utils/embeddingRetrieval';
import { buildUserStateContext } from '../services/recommendation/utils/userState';
import {
    LABEL_ACTION_TYPES,
    summarizeActionsInWindow,
} from '../services/recommendation/utils/actionLabels';

dotenv.config();

type Args = {
    days: number;
    windowHours: number;
    surface?: string;
    experimentKey?: string;
    recallSource?: string;
    output: string;
    limit: number;
};

type ImpressionRecord = {
    userId: string;
    targetPostId?: any;
    targetAuthorId?: string;
    requestId?: string;
    rank?: number;
    timestamp: Date;
    inNetwork?: boolean;
    isNews?: boolean;
    score?: number;
    weightedScore?: number;
    modelPostId?: string;
    recallSource?: string;
    experimentKeys?: string[];
};

type FollowUpRecord = {
    userId: string;
    targetPostId?: any;
    action: ActionType | string;
    timestamp: Date;
    dwellTimeMs?: number;
};

type UserContextRecord = {
    id: string;
    createdAt?: Date;
};

type ContactRecord = {
    userId: string;
    contactId: string;
};

function parseArgs(): Args {
    const args = process.argv.slice(2);
    const kv: Record<string, string> = {};
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (!a.startsWith('--')) continue;
        const key = a.slice(2);
        const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true';
        kv[key] = val;
    }

    const days = Math.max(1, parseInt(kv.days || '30', 10) || 30);
    const windowHours = Math.max(1, parseInt(kv.windowHours || '24', 10) || 24);
    const limit = Math.max(0, parseInt(kv.limit || '0', 10) || 0);

    return {
        days,
        windowHours,
        surface: kv.surface || 'space_feed',
        experimentKey: kv.experimentKey || undefined,
        recallSource: kv.recallSource || undefined,
        output: kv.output || './tmp/recsys_samples.ndjson',
        limit,
    };
}

function idToString(id: any): string {
    if (!id) return '';
    if (typeof id === 'string') return id;
    if (id instanceof mongoose.Types.ObjectId) return id.toString();
    if (typeof id.toString === 'function') return id.toString();
    return '';
}

function mapKey(userId: string, postId: string): string {
    return `${userId}:${postId}`;
}

function normalizeEmbeddingContext(embedding?: any) {
    if (!embedding) return undefined;
    const interestedInClusters = normalizeSparseEntries(embedding.interestedInClusters);
    const producerEmbedding = normalizeSparseEntries(embedding.producerEmbedding);
    const computedAt = embedding.computedAt ? new Date(embedding.computedAt) : undefined;
    const stale = computedAt
        ? Date.now() - computedAt.getTime() > 30 * 24 * 60 * 60 * 1000
        : true;
    const qualityScore = typeof embedding.qualityScore === 'number' ? embedding.qualityScore : 0;

    return {
        interestedInClusters,
        producerEmbedding,
        knownForCluster: embedding.knownForCluster,
        knownForScore: embedding.knownForScore,
        qualityScore,
        computedAt,
        version: embedding.version,
        usable: !stale && qualityScore >= 0.04 && interestedInClusters.length > 0,
        stale,
    };
}

function normalizeSparseEntries(entries: Array<{ clusterId: number; score: number }> | undefined) {
    if (!Array.isArray(entries)) return [];
    return entries
        .filter((entry) => Number.isFinite(entry?.clusterId) && Number.isFinite(entry?.score))
        .sort((left, right) => right.score - left.score)
        .slice(0, 12)
        .map((entry) => ({
            clusterId: entry.clusterId,
            score: entry.score,
        }));
}

function engagementBucketPrior(bucket?: string | null): number {
    switch (bucket) {
        case 'viral':
            return 0.85;
        case 'high':
            return 0.6;
        case 'medium':
            return 0.35;
        case 'low':
            return 0.12;
        default:
            return 0;
    }
}

async function main() {
    const args = parseArgs();
    const now = new Date();
    const since = new Date(now.getTime() - args.days * 24 * 60 * 60 * 1000);
    const windowMs = args.windowHours * 60 * 60 * 1000;

    await connectMongoDB();
    await sequelize.authenticate();

    const impressionQuery: Record<string, any> = {
        action: ActionType.IMPRESSION,
        timestamp: { $gte: since, $lte: now },
    };
    if (args.surface) impressionQuery.productSurface = args.surface;
    if (args.experimentKey) impressionQuery.experimentKeys = args.experimentKey;
    if (args.recallSource) impressionQuery.recallSource = args.recallSource;

    const impressionCursor = UserAction.find(impressionQuery)
        .select(
            'userId targetPostId targetAuthorId requestId rank timestamp inNetwork isNews score weightedScore modelPostId recallSource experimentKeys'
        )
        .sort({ timestamp: -1 });

    if (args.limit > 0) {
        impressionCursor.limit(args.limit);
    }

    const impressionDocs = (await impressionCursor.lean()) as ImpressionRecord[];
    const impressions = impressionDocs.slice().reverse();

    if (impressions.length === 0) {
        console.log('[ExportRecsysSamples] no impressions found for filters');
        return;
    }

    const postIds = Array.from(
        new Set(
            impressions.map((i) => idToString(i.targetPostId)).filter(Boolean)
        )
    )
        .filter((id) => mongoose.isValidObjectId(id))
        .map((id) => new mongoose.Types.ObjectId(id));
    const userIds = Array.from(new Set(impressions.map((i) => i.userId)));

    const minImpressionAt = impressions[0].timestamp;
    const maxImpressionAt = impressions[impressions.length - 1].timestamp;
    const followupUntil = new Date(maxImpressionAt.getTime() + windowMs);

    const followups = (await UserAction.find({
        action: { $in: LABEL_ACTION_TYPES },
        userId: { $in: userIds },
        targetPostId: { $in: postIds },
        timestamp: { $gte: minImpressionAt, $lte: followupUntil },
    })
        .select('userId targetPostId action timestamp dwellTimeMs')
        .lean()) as FollowUpRecord[];

    const recentStateActions = (await UserAction.find({
        userId: { $in: userIds },
        timestamp: { $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), $lte: now },
        action: {
            $in: [
                ActionType.IMPRESSION,
                ActionType.CLICK,
                ActionType.LIKE,
                ActionType.REPLY,
                ActionType.REPOST,
                ActionType.QUOTE,
                ActionType.SHARE,
                ActionType.DISMISS,
                ActionType.BLOCK_AUTHOR,
                ActionType.REPORT,
            ],
        },
    })
        .select('userId action timestamp targetPostId')
        .lean()) as Array<Record<string, any>>;

    const userRecords = (await User.findAll({
        where: { id: { [Op.in]: userIds } },
        attributes: ['id', 'createdAt'],
        raw: true,
    })) as UserContextRecord[];
    const contactRecords = (await Contact.findAll({
        where: {
            userId: { [Op.in]: userIds },
            status: ContactStatus.ACCEPTED,
        },
        attributes: ['userId', 'contactId'],
        raw: true,
    })) as ContactRecord[];
    const userEmbeddings = await UserFeatureVector.getUserEmbeddingsBatch(userIds);
    const snapshots = await postFeatureSnapshotService.ensureSnapshotsByPostIds(postIds);

    const followupsByKey = new Map<string, FollowUpRecord[]>();
    for (const action of followups) {
        const postId = idToString(action.targetPostId);
        if (!postId) continue;
        const key = mapKey(action.userId, postId);
        const arr = followupsByKey.get(key) || [];
        arr.push(action);
        followupsByKey.set(key, arr);
    }

    for (const arr of followupsByKey.values()) {
        arr.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    }

    const recentActionsByUser = new Map<string, Array<Record<string, any>>>();
    for (const action of recentStateActions) {
        const bucket = recentActionsByUser.get(action.userId) || [];
        bucket.push(action);
        recentActionsByUser.set(action.userId, bucket);
    }
    for (const actions of recentActionsByUser.values()) {
        actions.sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
    }

    const usersById = new Map(userRecords.map((record) => [record.id, record]));
    const followedByUser = new Map<string, string[]>();
    for (const contact of contactRecords) {
        const bucket = followedByUser.get(contact.userId) || [];
        bucket.push(contact.contactId);
        followedByUser.set(contact.userId, bucket);
    }

    const outputPath = path.resolve(process.cwd(), args.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const out = fs.createWriteStream(outputPath, { encoding: 'utf8' });

    let exported = 0;
    let positiveCount = 0;
    let negativeCount = 0;
    const retrievalContextByUser = new Map<string, PreparedEmbeddingRetrievalContext | null>();

    for (const imp of impressions) {
        const postId = idToString(imp.targetPostId);
        if (!postId) continue;

        const labels = summarizeActionsInWindow(
            imp.timestamp,
            (followupsByKey.get(mapKey(imp.userId, postId)) || []).map((a) => ({
                action: a.action,
                timestamp: a.timestamp,
                dwellTimeMs: a.dwellTimeMs,
            })),
            windowMs
        );
        const userEmbedding = normalizeEmbeddingContext(userEmbeddings.get(imp.userId));
        const userRecord = usersById.get(imp.userId);
        const userState = buildUserStateContext({
            userFeatures: {
                followedUserIds: followedByUser.get(imp.userId) || [],
                blockedUserIds: [],
                mutedKeywords: [],
                seenPostIds: [],
                accountCreatedAt: userRecord?.createdAt ? new Date(userRecord.createdAt) : undefined,
            },
            embeddingContext: userEmbedding,
            userActionSequence: recentActionsByUser.get(imp.userId) as any,
        });
        const snapshot = snapshots.get(postId);
        let retrievalContext = retrievalContextByUser.get(imp.userId);
        if (typeof retrievalContext === 'undefined') {
            retrievalContext = userEmbedding
                ? await prepareEmbeddingRetrievalContext({
                    requestId: `export-${imp.userId}`,
                    userId: imp.userId,
                    limit: 20,
                    inNetworkOnly: false,
                    seenIds: [],
                    servedIds: [],
                    isBottomRequest: false,
                    userFeatures: {
                        followedUserIds: followedByUser.get(imp.userId) || [],
                        blockedUserIds: [],
                        mutedKeywords: [],
                        seenPostIds: [],
                    },
                    embeddingContext: userEmbedding,
                } as any)
                : null;
            retrievalContextByUser.set(imp.userId, retrievalContext);
        }
        const retrievalSignals = snapshot && retrievalContext
            ? computeEmbeddingRecallSignalsFromSnapshot(snapshot as any, retrievalContext)
            : {
                authorScore: 0,
                clusterScore: 0,
                keywordScore: 0,
                denseVectorScore: 0,
            };
        const trainingFeatures = buildSocialPhoenixFeatureMap({
            userState: userState.state,
            embeddingQualityScore: userEmbedding?.qualityScore ?? 0,
            recallSource: imp.recallSource || 'unknown',
            inNetwork: imp.inNetwork === true,
            retrievalEmbeddingScore: typeof imp.weightedScore === 'number'
                ? imp.weightedScore
                : (imp.score ?? 0),
            retrievalDenseVectorScore: retrievalSignals.denseVectorScore,
            retrievalAuthorClusterScore: retrievalSignals.authorScore,
            retrievalCandidateClusterScore: retrievalSignals.clusterScore,
            retrievalKeywordScore: retrievalSignals.keywordScore,
            retrievalEngagementPrior: engagementBucketPrior(snapshot?.engagementBucket || null),
            retrievalSnapshotQuality: snapshot?.qualityScore ?? 0,
            createdAt: snapshot?.postCreatedAt,
            hasImage: Boolean(snapshot?.mediaTypes?.includes('image')),
            hasVideo: Boolean(snapshot?.mediaTypes?.includes('video')),
        });

        const row = {
            userId: imp.userId,
            requestId: imp.requestId || '',
            postId,
            targetAuthorId: imp.targetAuthorId || '',
            impressionAt: new Date(imp.timestamp).toISOString(),
            rank: imp.rank ?? null,
            inNetwork: imp.inNetwork === true,
            isNews: imp.isNews === true,
            score: imp.score ?? null,
            weightedScore: imp.weightedScore ?? null,
            modelPostId: imp.modelPostId || '',
            recallSource: imp.recallSource || 'unknown',
            experimentKeys: imp.experimentKeys || [],
            windowHours: args.windowHours,
            labelClick: labels.click ? 1 : 0,
            labelLike: labels.like ? 1 : 0,
            labelReply: labels.reply ? 1 : 0,
            labelRepost: labels.repost ? 1 : 0,
            labelQuote: labels.quote ? 1 : 0,
            labelShare: labels.share ? 1 : 0,
            labelDismiss: labels.dismiss ? 1 : 0,
            labelBlockAuthor: labels.blockAuthor ? 1 : 0,
            labelReport: labels.report ? 1 : 0,
            labelEngagement: labels.engagement ? 1 : 0,
            labelNegative: labels.negative ? 1 : 0,
            labelDwellTimeMs: labels.dwellTimeMs,
            userState: userState.state,
            userStateReason: userState.reason,
            userFollowedCount: userState.followedCount,
            userRecentActionCount: userState.recentActionCount,
            userRecentPositiveActionCount: userState.recentPositiveActionCount,
            embeddingUsable: userState.usableEmbedding,
            embeddingQualityScore: userEmbedding?.qualityScore ?? null,
            embeddingInterestedClusters: userEmbedding?.interestedInClusters || [],
            embeddingProducerClusters: userEmbedding?.producerEmbedding || [],
            snapshotDominantClusters: snapshot?.dominantClusterIds || [],
            snapshotClusterScores: snapshot?.clusterScores || [],
            snapshotKeywords: snapshot?.keywords || [],
            snapshotKeywordScores: snapshot?.keywordScores || [],
            snapshotEngagementBucket: snapshot?.engagementBucket || null,
            snapshotFreshnessBucket: snapshot?.freshnessBucket || null,
            snapshotQualityScore: snapshot?.qualityScore ?? null,
            snapshotAuthorKnownForCluster: snapshot?.authorKnownForCluster ?? null,
            retrievalAuthorClusterScore: retrievalSignals.authorScore,
            retrievalCandidateClusterScore: retrievalSignals.clusterScore,
            retrievalKeywordScore: retrievalSignals.keywordScore,
            retrievalDenseVectorScore: retrievalSignals.denseVectorScore,
            trainingFeatures,
        };

        out.write(`${JSON.stringify(row)}\n`);
        exported += 1;
        if (labels.engagement) positiveCount += 1;
        if (labels.negative) negativeCount += 1;
    }

    out.end();

    console.log(`[ExportRecsysSamples] exported=${exported}`);
    console.log(`[ExportRecsysSamples] engagementRate=${((positiveCount / Math.max(1, exported)) * 100).toFixed(2)}%`);
    console.log(`[ExportRecsysSamples] negativeRate=${((negativeCount / Math.max(1, exported)) * 100).toFixed(2)}%`);
    console.log(`[ExportRecsysSamples] wrote ${outputPath}`);
}

main()
    .catch((error) => {
        console.error('[ExportRecsysSamples] failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        try {
            await mongoose.disconnect();
        } catch {
            // ignore
        }
        try {
            await sequelize.close();
        } catch {
            // ignore
        }
    });
