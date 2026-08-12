/**
 * Export point-in-time-safe partial recommendation samples.
 *
 * Usage:
 *   npx ts-node src/scripts/exportRecsysTrainingSamples.ts --days 30 --windowHours 24 --cutoff 2026-05-01T00:00:00.000Z --output ./tmp/recsys_samples.ndjson
 *   npx ts-node src/scripts/exportRecsysTrainingSamples.ts --cutoff 2026-05-01T00:00:00.000Z --approvalConfig ./dataset-acceptance.json
 */

import fs from 'fs';
import path from 'path';

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { Op } from 'sequelize';

import { sequelize } from '../config/sequelize';
import Contact, { ContactStatus } from '../models/Contact';
import RecommendationTrace from '../models/RecommendationTrace';
import User from '../models/User';
import UserAction, { ActionType } from '../models/UserAction';
import UserFeatureVector from '../models/UserFeatureVector';
import { postFeatureSnapshotService } from '../services/recommendation/contentFeatures';
import {
    type RecommendationDecisionLogV1,
    recommendationDecisionLogSchema,
} from '../services/recommendation/decisionLog/contracts';
import { attributeOutcomeV1 } from '../services/recommendation/outcomes/outcomeContractV1';
import { buildVersionedTrainingArtifacts } from '../services/recommendation/training/artifacts/build';
import type {
    DatasetAcceptanceApprovalConfigV1,
    TrainingArtifactIdentityInput,
} from '../services/recommendation/training/artifacts/contracts';
import {
    buildPitSafePartialArtifacts,
    buildPitSafePartialSample,
    parseRequiredCutoff,
    projectPitSafeSnapshotMap,
    type PitSafeAction,
    type PitSafePartialCandidate,
} from '../services/recommendation/training/pitSafePartialExport';
import {
    connectReadOnlyMongo,
    disconnectReadOnlyMongo,
} from '../services/recommendation/training/readOnlyMongo';
import { LABEL_ACTION_TYPES } from '../services/recommendation/utils/actionLabels';

dotenv.config();

type Args = {
    days: number;
    windowHours: number;
    surface?: string;
    experimentKey?: string;
    recallSource?: string;
    output: string;
    cutoff?: string;
    approvalConfig?: string;
    limit: number;
};

type OutcomeActionRecord = PitSafeAction & {
    userId: string;
    requestId?: string;
    rank?: number;
    dwellTimeMs?: number;
    metadata?: {
        decisionId?: string;
        candidateNamespace?: string;
        candidateId?: string;
        positionContractVersion?: string;
    };
};

type TraceCandidateRecord = {
    postId?: unknown;
    modelPostId?: string;
    authorId?: string;
    rank?: number;
    inNetwork?: boolean;
    isNews?: boolean;
    score?: number;
    weightedScore?: number;
    selectionPool?: string;
    selectionReason?: string;
    recallSource?: string;
    secondaryRecallSources?: string[];
};

type HistoryActionRecord = PitSafeAction & {
    userId: string;
    targetPostId?: unknown;
};

type UserContextRecord = {
    id: string;
    createdAt?: Date;
};

type ContactRecord = {
    userId: string;
    contactId: string;
};

type TraceRecord = {
    requestId: string;
    userId: string;
    productSurface: string;
    experimentKeys?: string[];
    decisionLogV1?: unknown;
    candidates?: TraceCandidateRecord[];
    pipeline?: string;
    pipelineVersion?: string;
    traceVersion?: string;
    owner?: string;
    fallbackMode?: string;
    degradedReasons?: string[];
    selectedCount?: number;
    inNetworkCount?: number;
    outOfNetworkCount?: number;
    sourceCounts?: Array<{ source: string; count: number }>;
    authorDiversity?: number;
    replyRatio?: number;
    averageScore?: number;
    topScore?: number;
    bottomScore?: number;
    freshness?: {
        newestAgeSeconds?: number;
        oldestAgeSeconds?: number;
        timeRangeSeconds?: number;
    };
    shadowComparison?: {
        overlapRatio?: number;
        selectedCount?: number;
        baselineCount?: number;
    };
};

type DecisionActionKey = RecommendationDecisionLogV1['actions'][number]['actionKey'];

function traceCandidateForAction(
    trace: TraceRecord,
    actionKey: DecisionActionKey,
): TraceCandidateRecord | undefined {
    return trace.candidates?.find((candidate) => (
        candidate.rank === actionKey.servedPosition
        && (
            actionKey.candidateNamespace === 'serving_post_id'
                ? idToString(candidate.postId) === actionKey.candidateId
                : candidate.modelPostId === actionKey.candidateId
        )
    ));
}

function parseArgs(): Args {
    const args = process.argv.slice(2);
    const kv: Record<string, string> = {};
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (!argument.startsWith('--')) continue;
        const key = argument.slice(2);
        kv[key] = args[index + 1] && !args[index + 1].startsWith('--')
            ? args[index + 1]
            : 'true';
    }

    return {
        days: Math.max(1, parseInt(kv.days || '30', 10) || 30),
        windowHours: Math.max(1, parseInt(kv.windowHours || '24', 10) || 24),
        surface: kv.surface || 'space_feed',
        experimentKey: kv.experimentKey || undefined,
        recallSource: kv.recallSource || undefined,
        output: kv.output || './tmp/recsys_samples.ndjson',
        cutoff: kv.cutoff || undefined,
        approvalConfig: kv.approvalConfig || undefined,
        limit: Math.max(0, parseInt(kv.limit || '0', 10) || 0),
    };
}

function idToString(id: unknown): string {
    if (!id) return '';
    if (typeof id === 'string') return id;
    if (id instanceof mongoose.Types.ObjectId) return id.toString();
    if (typeof (id as { toString?: unknown }).toString === 'function') return String(id);
    return '';
}

function outputPaths(output: string) {
    const resolved = path.resolve(process.cwd(), output);
    const extension = path.extname(resolved).toLowerCase();
    const base = extension === '.ndjson' || extension === '.jsonl'
        ? resolved.slice(0, -extension.length)
        : resolved;
    return {
        validPath: `${base}.valid.ndjson`,
        quarantinePath: `${base}.quarantine.ndjson`,
        manifestPath: `${base}.pit-safe-partial.manifest.json`,
        versionedValidPath: `${base}.recommendation-training-example-v1.valid.ndjson`,
        versionedQuarantinePath: `${base}.recommendation-training-example-v1.quarantine.ndjson`,
        annManifestPath: `${base}.ann-artifact.manifest.json`,
        datasetAcceptancePath: `${base}.dataset-acceptance.json`,
    };
}

function readApprovalConfig(
    approvalConfig: string | undefined,
): DatasetAcceptanceApprovalConfigV1 | undefined {
    if (!approvalConfig) return undefined;
    return JSON.parse(fs.readFileSync(
        path.resolve(process.cwd(), approvalConfig),
        'utf8',
    )) as DatasetAcceptanceApprovalConfigV1;
}

const DIAGNOSTIC_ARTIFACT_IDENTITY: TrainingArtifactIdentityInput = {
    servingIdNamespace: '',
    modelIdNamespace: '',
    pipelineVersion: '',
    graphVersion: '',
    model: { id: '', version: '' },
    artifact: { id: '' },
    index: { namespace: '', id: '' },
};

function writeArtifacts(
    candidates: PitSafePartialCandidate[],
    cutoff: Date,
    output: string,
    approvalConfig?: string,
) {
    const {
        validPath,
        quarantinePath,
        manifestPath,
        versionedValidPath,
        versionedQuarantinePath,
        annManifestPath,
        datasetAcceptancePath,
    } = outputPaths(output);
    const artifacts = buildPitSafePartialArtifacts({
        candidates,
        cutoff,
        validFile: path.basename(validPath),
        quarantineFile: path.basename(quarantinePath),
    });
    const versioned = buildVersionedTrainingArtifacts({
        phase3Artifacts: artifacts,
        identity: DIAGNOSTIC_ARTIFACT_IDENTITY,
        annArtifact: {
            built: false,
            bytes: '',
            metric: 'none',
            normalization: 'none',
            dimension: 0,
            count: 0,
        },
        approvalConfig: readApprovalConfig(approvalConfig),
    });
    fs.mkdirSync(path.dirname(validPath), { recursive: true });
    fs.writeFileSync(validPath, artifacts.validNdjson, 'utf8');
    fs.writeFileSync(quarantinePath, artifacts.quarantineNdjson, 'utf8');
    fs.writeFileSync(manifestPath, artifacts.manifestJson, 'utf8');
    fs.writeFileSync(versionedValidPath, versioned.validNdjson, 'utf8');
    fs.writeFileSync(versionedQuarantinePath, versioned.quarantineNdjson, 'utf8');
    fs.writeFileSync(annManifestPath, versioned.annManifestJson, 'utf8');
    fs.writeFileSync(datasetAcceptancePath, versioned.datasetAcceptanceJson, 'utf8');
    console.log(
        `[ExportRecsysSamples] valid=${artifacts.manifest.counts.valid}`
        + ` quarantine=${artifacts.manifest.counts.quarantine}`,
    );
    console.log(`[ExportRecsysSamples] reasonCounts=${JSON.stringify(artifacts.manifest.reasonCounts)}`);
    console.log(`[ExportRecsysSamples] wrote ${validPath}`);
    console.log(`[ExportRecsysSamples] wrote ${quarantinePath}`);
    console.log(`[ExportRecsysSamples] wrote ${manifestPath}`);
    console.log(`[ExportRecsysSamples] wrote ${versionedValidPath}`);
    console.log(`[ExportRecsysSamples] wrote ${versionedQuarantinePath}`);
    console.log(`[ExportRecsysSamples] wrote ${annManifestPath}`);
    console.log(`[ExportRecsysSamples] wrote ${datasetAcceptancePath}`);
}

async function main() {
    const args = parseArgs();
    const cutoff = parseRequiredCutoff(args.cutoff);
    const since = new Date(cutoff.getTime() - args.days * 24 * 60 * 60 * 1000);
    const windowMs = args.windowHours * 60 * 60 * 1000;

    await connectReadOnlyMongo();
    await sequelize.authenticate();

    const traceQuery: Record<string, unknown> = {
        'decisionLogV1.decisionAt': {
            $gte: since.toISOString(),
            $lte: cutoff.toISOString(),
        },
    };
    if (args.surface) traceQuery.productSurface = args.surface;
    if (args.experimentKey) traceQuery.experimentKeys = args.experimentKey;
    if (args.recallSource) traceQuery['sourceCounts.source'] = args.recallSource;

    const traceCursor = RecommendationTrace.find(traceQuery)
        .select(
            'requestId userId productSurface experimentKeys decisionLogV1 candidates pipeline pipelineVersion traceVersion owner fallbackMode degradedReasons selectedCount inNetworkCount outOfNetworkCount sourceCounts authorDiversity replyRatio averageScore topScore bottomScore freshness shadowComparison',
        )
        .sort({ 'decisionLogV1.decisionAt': -1, _id: -1 });
    if (args.limit > 0) traceCursor.limit(args.limit);

    const traceDocs = ((await traceCursor.lean()) as TraceRecord[]).slice().reverse();
    const canonicalTraces: Array<{
        trace: TraceRecord;
        decision: RecommendationDecisionLogV1;
    }> = [];
    for (const trace of traceDocs) {
        const parsed = recommendationDecisionLogSchema.safeParse(trace.decisionLogV1);
        if (!parsed.success) continue;
        const decisionAtMs = Date.parse(parsed.data.decisionAt);
        if (decisionAtMs < since.getTime() || decisionAtMs > cutoff.getTime()) continue;
        canonicalTraces.push({ trace, decision: parsed.data });
    }
    if (canonicalTraces.length === 0) {
        writeArtifacts([], cutoff, args.output, args.approvalConfig);
        return;
    }

    const servedSamples = canonicalTraces.flatMap(({ trace, decision }) => (
        decision.actions.flatMap((servedAction) => {
            const traceCandidate = traceCandidateForAction(trace, servedAction.actionKey);
            if (args.recallSource && traceCandidate?.recallSource !== args.recallSource) return [];
            return [{ trace, decision, servedAction, traceCandidate }];
        })
    ));
    if (servedSamples.length === 0) {
        writeArtifacts([], cutoff, args.output, args.approvalConfig);
        return;
    }

    const postIds = Array.from(new Set(
        servedSamples.map(({ servedAction, traceCandidate }) => (
            idToString(traceCandidate?.postId)
            || servedAction.actionKey.candidateId
        )),
    ))
        .filter((id) => mongoose.isValidObjectId(id))
        .sort()
        .map((id) => new mongoose.Types.ObjectId(id));
    const userIds = Array.from(new Set(
        servedSamples.map(({ trace }) => trace.userId),
    )).sort();
    const decisionTimes = canonicalTraces.map(({ decision }) => Date.parse(decision.decisionAt));
    const minDecisionAt = new Date(Math.min(...decisionTimes));
    const maxDecisionAt = new Date(Math.max(...decisionTimes));
    const historySince = new Date(minDecisionAt.getTime() - 7 * 24 * 60 * 60 * 1000);
    const decisionIds = canonicalTraces.map(({ decision }) => decision.decisionId).sort();

    const outcomeActions = (await UserAction.find({
        'metadata.decisionId': { $in: decisionIds },
        action: { $in: [ActionType.IMPRESSION, ...LABEL_ACTION_TYPES] },
        timestamp: { $gte: minDecisionAt, $lte: cutoff },
    })
        .select('metadata rank requestId userId action timestamp dwellTimeMs')
        .lean()) as OutcomeActionRecord[];
    const historyActions = (await UserAction.find({
        userId: { $in: userIds },
        timestamp: { $gte: historySince, $lte: maxDecisionAt },
        action: {
            $in: [
                ActionType.IMPRESSION,
                ActionType.CLICK,
                ActionType.LIKE,
                ActionType.REPLY,
                ActionType.REPOST,
                ActionType.QUOTE,
                ActionType.SHARE,
                ActionType.PROFILE_CLICK,
                ActionType.DWELL,
                ActionType.VIDEO_QUALITY_VIEW,
                ActionType.DISMISS,
                ActionType.BLOCK_AUTHOR,
                ActionType.REPORT,
            ],
        },
    })
        .select('userId action timestamp targetPostId')
        .lean()) as HistoryActionRecord[];

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
    const embeddingDocs = (await UserFeatureVector.find({
        userId: { $in: userIds },
    })
        .select('userId interestedInClusters producerEmbedding knownForCluster knownForScore qualityScore computedAt version')
        .lean()) as Array<Record<string, unknown> & { userId: string }>;
    const snapshots = projectPitSafeSnapshotMap(
        await postFeatureSnapshotService.getSnapshotsByPostIds(postIds),
    );

    const outcomeActionsByDecisionId = new Map<string, OutcomeActionRecord[]>();
    for (const action of outcomeActions) {
        const decisionId = action.metadata?.decisionId;
        if (!decisionId) continue;
        const bucket = outcomeActionsByDecisionId.get(decisionId) || [];
        bucket.push(action);
        outcomeActionsByDecisionId.set(decisionId, bucket);
    }
    const historyByUser = new Map<string, HistoryActionRecord[]>();
    for (const action of historyActions) {
        const bucket = historyByUser.get(action.userId) || [];
        bucket.push(action);
        historyByUser.set(action.userId, bucket);
    }
    const usersById = new Map(userRecords.map((record) => [record.id, record]));
    const followedByUser = new Map<string, string[]>();
    for (const contact of contactRecords) {
        const bucket = followedByUser.get(contact.userId) || [];
        bucket.push(contact.contactId);
        followedByUser.set(contact.userId, bucket);
    }
    const embeddingsByUser = new Map(embeddingDocs.map((record) => [record.userId, record]));

    const candidates: PitSafePartialCandidate[] = [];
    for (const { trace, decision, servedAction, traceCandidate } of servedSamples) {
        const postId = idToString(traceCandidate?.postId)
            || servedAction.actionKey.candidateId;
        const sampleId = [
            decision.decisionId,
            servedAction.actionKey.candidateNamespace,
            servedAction.actionKey.candidateId,
            servedAction.actionKey.servedPosition,
        ].join(':');
        const outcomeContractV1 = attributeOutcomeV1({
            decisionLog: decision,
            servedAction,
            traceUserId: trace.userId,
            events: outcomeActionsByDecisionId.get(decision.decisionId) || [],
            observedThrough: cutoff,
            horizonMs: windowMs,
        });
        const poolCandidate = decision.candidatePool.candidates.find((candidate) => (
            candidate.candidateNamespace === servedAction.actionKey.candidateNamespace
            && candidate.candidateId === servedAction.actionKey.candidateId
            && candidate.servedPosition === servedAction.actionKey.servedPosition
        ));

        candidates.push(buildPitSafePartialSample({
            impression: {
                sampleId,
                userId: trace.userId,
                postId,
                targetAuthorId: traceCandidate?.authorId,
                requestId: decision.requestId,
                rank: servedAction.actionKey.servedPosition,
                timestamp: decision.decisionAt,
                inNetwork: traceCandidate?.inNetwork,
                isNews: traceCandidate?.isNews,
                score: traceCandidate?.score ?? poolCandidate?.score ?? undefined,
                weightedScore: traceCandidate?.weightedScore,
                selectionPool: traceCandidate?.selectionPool,
                selectionReason: traceCandidate?.selectionReason,
                modelPostId: traceCandidate?.modelPostId
                    || (servedAction.actionKey.candidateNamespace === 'model_post_id'
                        ? servedAction.actionKey.candidateId
                        : undefined),
                recallSource: traceCandidate?.recallSource,
                secondaryRecallSources: traceCandidate?.secondaryRecallSources,
                experimentKeys: trace.experimentKeys,
                productSurface: trace.productSurface,
            },
            decisionAt: decision.decisionAt,
            outcomeContractV1,
            historyActions: historyByUser.get(trace.userId) || [],
            labelActions: [],
            labelObservedThrough: cutoff,
            windowMs,
            surface: args.surface,
            user: usersById.get(trace.userId),
            contacts: {
                followedUserIds: followedByUser.get(trace.userId) || [],
                evidence: undefined,
            },
            embedding: embeddingsByUser.get(trace.userId),
            snapshot: snapshots.get(postId) as unknown as Record<string, unknown> | undefined,
            trace,
        }));
    }

    writeArtifacts(candidates, cutoff, args.output, args.approvalConfig);
}

main()
    .catch((error) => {
        console.error('[ExportRecsysSamples] failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        try {
            await disconnectReadOnlyMongo();
        } catch {
            // ignore
        }
        try {
            await sequelize.close();
        } catch {
            // ignore
        }
    });
