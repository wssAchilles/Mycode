import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { connectMongoDB } from '../config/db';
import { sequelize } from '../config/sequelize';
import User from '../models/User';
import UserFeatureVector from '../models/UserFeatureVector';
import UserAction from '../models/UserAction';
import UserSignal from '../models/UserSignal';
import RealGraphEdge from '../models/RealGraphEdge';
import PostFeatureSnapshot from '../models/PostFeatureSnapshot';
import RecommendationJobRun from '../models/RecommendationJobRun';

dotenv.config({ quiet: true });

function parseArgs() {
    const args = process.argv.slice(2);
    const kv: Record<string, string> = {};
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (!arg.startsWith('--')) continue;
        const key = arg.slice(2);
        const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true';
        kv[key] = value;
    }

    const hours = Math.max(1, parseInt(kv.hours || '24', 10) || 24);
    return {
        hours,
        since: kv.since ? new Date(kv.since) : new Date(Date.now() - hours * 60 * 60 * 1000),
    };
}

async function main() {
    const { hours, since } = parseArgs();

    await Promise.all([
        connectMongoDB(),
        sequelize.authenticate(),
    ]);

    const [
        registeredUsers,
        userVectors,
        userVectorsFresh,
        userVectorsWithContract,
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
        RecommendationJobRun.findOne({ jobName: 'daily_recommendation_refresh' })
            .sort({ startedAt: -1 })
            .lean(),
        RecommendationJobRun.find({ jobName: 'daily_recommendation_refresh', startedAt: { $gte: since } })
            .sort({ startedAt: -1 })
            .limit(5)
            .lean(),
    ]);

    const output = {
        auditedAt: new Date().toISOString(),
        freshnessWindow: {
            hours,
            since: since.toISOString(),
        },
        dailyJobEvidence: {
            latest: latestJobRun ? {
                status: latestJobRun.status,
                startedAt: latestJobRun.startedAt,
                finishedAt: latestJobRun.finishedAt,
                durationMs: latestJobRun.durationMs,
                trigger: latestJobRun.trigger,
                summary: latestJobRun.summary,
                error: latestJobRun.error,
            } : null,
            runsInWindow: recentJobRuns.length,
            recentStatuses: recentJobRuns.map((run) => ({
                status: run.status,
                startedAt: run.startedAt,
                finishedAt: run.finishedAt,
                trigger: run.trigger,
            })),
        },
        registeredUserFeatureCoverage: {
            registeredUsers,
            userFeatureVectors: userVectors,
            coverageRatio: ratio(userVectors, registeredUsers),
            refreshedInWindow: userVectorsFresh,
            refreshedRatio: ratio(userVectorsFresh, registeredUsers),
            embeddingContractCoverageRatio: ratio(userVectorsWithContract, userVectors),
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

    console.log(JSON.stringify(output, null, 2));
}

function ratio(count: number, total: number): number {
    return total > 0 ? Number((count / total).toFixed(4)) : 0;
}

main()
    .catch((error) => {
        console.error('[AuditDailyRecommendationRefresh] failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        try {
            mongoose.connection.removeAllListeners('disconnected');
            mongoose.connection.removeAllListeners('error');
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
