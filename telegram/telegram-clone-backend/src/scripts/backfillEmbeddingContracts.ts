import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { connectMongoDB } from '../config/db';
import PostFeatureSnapshot from '../models/PostFeatureSnapshot';

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
    const since = kv.since ? new Date(kv.since) : undefined;
    return {
        dryRun: kv['dry-run'] === 'true',
        limit: Math.max(1, parseInt(kv.limit || '1000', 10) || 1000),
        batchSize: Math.max(1, parseInt(kv.batch || '200', 10) || 200),
        since: since && !Number.isNaN(since.getTime()) ? since : undefined,
    };
}

async function main() {
    dotenv.config();
    const args = parseArgs();
    await connectMongoDB();
    const result = await backfillEmbeddingContracts(args);
    console.log(JSON.stringify(result, null, 2));
}

export async function backfillEmbeddingContracts(options: {
    dryRun: boolean;
    limit: number;
    batchSize: number;
    since?: Date;
}) {
    const posts = await backfillPosts(options);
    return {
        dryRun: options.dryRun,
        users: {
            scanned: 0,
            matched: 0,
            updated: 0,
            disabled: true,
        },
        postFeatureSnapshots: posts,
    };
}

async function backfillPosts(options: {
    dryRun: boolean;
    limit: number;
    batchSize: number;
    since?: Date;
}) {
    const query: Record<string, unknown> = {
        denseEmbedding: { $exists: true, $ne: [] },
        $or: [
            { embeddingContract: { $exists: false } },
            { 'embeddingContract.artifactVersion': { $exists: false } },
        ],
    };
    if (options.since) query.updatedAt = { $gte: options.since };

    const docs = await PostFeatureSnapshot.find(query).limit(options.limit);
    let matched = 0;
    let updated = 0;
    for (const doc of docs) {
        const vector = doc.denseEmbedding;
        if (!Array.isArray(vector) || vector.length === 0) continue;
        matched += 1;
        if (options.dryRun) continue;
        doc.embeddingContract = {
            embeddingSpace: `post_dense_dim_${vector.length}`,
            retrievalEmbeddingDim: vector.length,
            rankingEmbeddingDim: vector.length,
            modelVersion: doc.embeddingPlanVersion || `post_dense_dim_${vector.length}_v1`,
            artifactVersion: `mongo_post_feature_snapshots_${vector.length}_v1`,
            producer: 'backfillEmbeddingContracts',
        };
        await doc.save();
        updated += 1;
    }
    return { scanned: docs.length, matched, updated };
}

if (require.main === module) {
    main()
        .catch((error) => {
            console.error('[BackfillEmbeddingContracts] failed:', error);
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
        });
}
