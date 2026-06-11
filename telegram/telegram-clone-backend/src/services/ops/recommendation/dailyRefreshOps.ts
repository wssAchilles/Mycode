import User from '../../../models/User';
import UserFeatureVector from '../../../models/UserFeatureVector';
import UserAction from '../../../models/UserAction';
import UserSignal from '../../../models/UserSignal';
import RealGraphEdge from '../../../models/RealGraphEdge';
import PostFeatureSnapshot from '../../../models/PostFeatureSnapshot';
import RecommendationJobRun from '../../../models/RecommendationJobRun';
import { DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT } from '../../recommendation/contracts/embeddingContract';

const DAILY_RECOMMENDATION_REFRESH_JOB = 'daily_recommendation_refresh';
const DEFAULT_FRESHNESS_HOURS = 24;
const DAILY_REFRESH_CRON = '0 2 * * *';
const DAILY_REFRESH_LABEL = '每天 02:00';

export type DailyRecommendationRefreshStatus = 'success' | 'running' | 'failed' | 'unknown';

export interface DailyRecommendationRefreshAuditOptions {
    hours?: number;
    since?: Date;
}

export interface DailyRecommendationRefreshAudit {
    auditedAt: string;
    freshnessWindow: {
        hours: number;
        since: string;
    };
    dailyJobEvidence: {
        latest: {
            status: DailyRecommendationRefreshStatus;
            startedAt: Date | string | null;
            finishedAt?: Date | string | null;
            durationMs?: number | null;
            trigger?: string | null;
            summary?: Record<string, unknown>;
            error?: string | null;
        } | null;
        runsInWindow: number;
        recentStatuses: Array<{
            status: DailyRecommendationRefreshStatus;
            startedAt: Date | string | null;
            finishedAt?: Date | string | null;
            trigger?: string | null;
        }>;
    };
    registeredUserFeatureCoverage: {
        registeredUsers: number;
        userFeatureVectors: number;
        coverageRatio: number;
        refreshedInWindow: number;
        refreshedRatio: number;
        embeddingContractCoverageRatio: number;
        compatibleDenseVectorRatio: number;
    };
    eventFactsAreRealtimeNotDailySynthetic: {
        userActionsTotal: number;
        userActionsInWindow: number;
        userSignalsTotal: number;
        userSignalsInWindow: number;
    };
    realGraphRefreshCoverage: {
        edges: number;
        decayedInWindow: number;
        predictedInWindow: number;
        predictionMetadataCoverageRatio: number;
    };
    postFeatureRefreshCoverage: {
        snapshots: number;
        refreshedInWindow: number;
        refreshedRatio: number;
    };
}

export interface RecommendationDailyRefreshOps {
    status: DailyRecommendationRefreshStatus;
    lastRefreshAt: string | null;
    latestRun: {
        startedAt: string | null;
        finishedAt: string | null;
        durationMs: number | null;
        trigger: string | null;
        error?: string | null;
    };
    users: {
        registered: number;
        vectors: number;
        refreshed: number;
        compatibleDenseVectorRatio: number;
    };
    realGraph: {
        edges: number;
        predicted: number;
    };
    posts: {
        snapshots: number;
        refreshed: number;
    };
    artifacts: {
        usersExported: number;
        postsExported: number;
        clustersExported: number;
    };
    schedule: {
        label: typeof DAILY_REFRESH_LABEL;
        cron: typeof DAILY_REFRESH_CRON;
    };
    freshnessWindow: {
        hours: number;
        since: string;
    };
}

export async function buildDailyRecommendationRefreshAudit(
    options: DailyRecommendationRefreshAuditOptions = {},
): Promise<DailyRecommendationRefreshAudit> {
    const hours = normalizeHours(options.hours);
    const since = options.since ?? new Date(Date.now() - hours * 60 * 60 * 1000);

    const [
        registeredUsers,
        userVectors,
        userVectorsFresh,
        userVectorsWithContract,
        userVectorsCompatible,
        actionsTotal,
        actionsFresh,
        signalsTotal,
        signalsFresh,
        realGraphEdges,
        realGraphDecayedFresh,
        realGraphPredictedFresh,
        realGraphPredictionCovered,
        postSnapshots,
        postSnapshotsFresh,
        latestJobRun,
        recentJobRuns,
    ] = await Promise.all([
        User.count(),
        UserFeatureVector.countDocuments(),
        UserFeatureVector.countDocuments({ computedAt: { $gte: since } }),
        UserFeatureVector.countDocuments({ 'embeddingContract.artifactVersion': { $exists: true, $ne: '' } }),
        UserFeatureVector.countDocuments({
            'embeddingContract.embeddingSpace': DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT.embeddingSpace,
            'embeddingContract.retrievalEmbeddingDim': DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT.retrievalEmbeddingDim,
            twoTowerEmbedding: { $size: DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT.retrievalEmbeddingDim },
        }),
        UserAction.countDocuments(),
        UserAction.countDocuments({ createdAt: { $gte: since } }),
        UserSignal.countDocuments(),
        UserSignal.countDocuments({ createdAt: { $gte: since } }),
        RealGraphEdge.countDocuments(),
        RealGraphEdge.countDocuments({ lastDecayAppliedAt: { $gte: since } }),
        RealGraphEdge.countDocuments({ lastPredictionAt: { $gte: since } }),
        RealGraphEdge.countDocuments({
            modelVersion: { $exists: true, $ne: '' },
            predictionMode: { $exists: true, $ne: '' },
            featureVersion: { $exists: true, $ne: '' },
            lastPredictionAt: { $exists: true },
        }),
        PostFeatureSnapshot.countDocuments(),
        PostFeatureSnapshot.countDocuments({ computedAt: { $gte: since } }),
        RecommendationJobRun.findOne({ jobName: DAILY_RECOMMENDATION_REFRESH_JOB })
            .sort({ startedAt: -1 })
            .lean(),
        RecommendationJobRun.find({
            jobName: DAILY_RECOMMENDATION_REFRESH_JOB,
            startedAt: { $gte: since },
        })
            .sort({ startedAt: -1 })
            .limit(5)
            .lean(),
    ]);

    return {
        auditedAt: new Date().toISOString(),
        freshnessWindow: {
            hours,
            since: since.toISOString(),
        },
        dailyJobEvidence: {
            latest: latestJobRun ? {
                status: normalizeStatus(latestJobRun.status),
                startedAt: latestJobRun.startedAt ?? null,
                finishedAt: latestJobRun.finishedAt ?? null,
                durationMs: latestJobRun.durationMs ?? null,
                trigger: latestJobRun.trigger ?? null,
                summary: normalizeSummary(latestJobRun.summary),
                error: latestJobRun.error ?? null,
            } : null,
            runsInWindow: recentJobRuns.length,
            recentStatuses: recentJobRuns.map((run) => ({
                status: normalizeStatus(run.status),
                startedAt: run.startedAt ?? null,
                finishedAt: run.finishedAt ?? null,
                trigger: run.trigger ?? null,
            })),
        },
        registeredUserFeatureCoverage: {
            registeredUsers,
            userFeatureVectors: userVectors,
            coverageRatio: ratio(userVectors, registeredUsers),
            refreshedInWindow: userVectorsFresh,
            refreshedRatio: ratio(userVectorsFresh, registeredUsers),
            embeddingContractCoverageRatio: ratio(userVectorsWithContract, userVectors),
            compatibleDenseVectorRatio: ratio(userVectorsCompatible, registeredUsers),
        },
        eventFactsAreRealtimeNotDailySynthetic: {
            userActionsTotal: actionsTotal,
            userActionsInWindow: actionsFresh,
            userSignalsTotal: signalsTotal,
            userSignalsInWindow: signalsFresh,
        },
        realGraphRefreshCoverage: {
            edges: realGraphEdges,
            decayedInWindow: realGraphDecayedFresh,
            predictedInWindow: realGraphPredictedFresh,
            predictionMetadataCoverageRatio: ratio(realGraphPredictionCovered, realGraphEdges),
        },
        postFeatureRefreshCoverage: {
            snapshots: postSnapshots,
            refreshedInWindow: postSnapshotsFresh,
            refreshedRatio: ratio(postSnapshotsFresh, postSnapshots),
        },
    };
}

export async function buildDailyRecommendationRefreshOps(
    options: DailyRecommendationRefreshAuditOptions = {},
): Promise<RecommendationDailyRefreshOps> {
    return mapDailyRefreshAuditToOps(await buildDailyRecommendationRefreshAudit(options));
}

export function mapDailyRefreshAuditToOps(
    audit: DailyRecommendationRefreshAudit,
): RecommendationDailyRefreshOps {
    const latest = audit.dailyJobEvidence.latest;
    const summary = latest?.summary ?? {};
    const usersSummary = readRecord(summary.users);
    const realGraphSummary = readRecord(summary.realGraph);
    const postsSummary = readRecord(summary.posts);
    const featureExportSummary = readRecord(summary.featureExport);
    const lastRefreshAt = latest
        ? toIsoString(latest.finishedAt) ?? toIsoString(latest.startedAt)
        : null;

    return {
        status: latest?.status ?? 'unknown',
        lastRefreshAt,
        latestRun: {
            startedAt: toIsoString(latest?.startedAt),
            finishedAt: toIsoString(latest?.finishedAt),
            durationMs: readNumber(latest?.durationMs),
            trigger: typeof latest?.trigger === 'string' ? latest.trigger : null,
            error: typeof latest?.error === 'string' ? latest.error : null,
        },
        users: {
            registered: audit.registeredUserFeatureCoverage.registeredUsers,
            vectors: audit.registeredUserFeatureCoverage.userFeatureVectors,
            refreshed: readNumber(usersSummary.embeddingsUpdated)
                ?? audit.registeredUserFeatureCoverage.refreshedInWindow,
            compatibleDenseVectorRatio: audit.registeredUserFeatureCoverage.compatibleDenseVectorRatio,
        },
        realGraph: {
            edges: readNumber(realGraphSummary.predictionMatched)
                ?? audit.realGraphRefreshCoverage.edges,
            predicted: readNumber(realGraphSummary.predictionUpdated)
                ?? audit.realGraphRefreshCoverage.predictedInWindow,
        },
        posts: {
            snapshots: audit.postFeatureRefreshCoverage.snapshots,
            refreshed: readNumber(postsSummary.refreshed)
                ?? audit.postFeatureRefreshCoverage.refreshedInWindow,
        },
        artifacts: {
            usersExported: readNumber(featureExportSummary.usersExported) ?? 0,
            postsExported: readNumber(featureExportSummary.postsExported) ?? 0,
            clustersExported: readNumber(featureExportSummary.clustersExported) ?? 0,
        },
        schedule: {
            label: DAILY_REFRESH_LABEL,
            cron: DAILY_REFRESH_CRON,
        },
        freshnessWindow: audit.freshnessWindow,
    };
}

function normalizeHours(value: number | undefined): number {
    if (value === undefined) return DEFAULT_FRESHNESS_HOURS;
    return Math.max(1, Math.floor(value) || DEFAULT_FRESHNESS_HOURS);
}

function normalizeStatus(value: unknown): DailyRecommendationRefreshStatus {
    return value === 'success' || value === 'running' || value === 'failed'
        ? value
        : 'unknown';
}

function normalizeSummary(value: unknown): Record<string, unknown> {
    return readRecord(value);
}

function readRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toIsoString(value: unknown): string | null {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string') return value;
    return null;
}

function ratio(count: number, total: number): number {
    return total > 0 ? Number((count / total).toFixed(4)) : 0;
}
