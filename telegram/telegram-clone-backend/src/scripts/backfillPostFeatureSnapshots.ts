/**
 * 回填近期帖子的内容特征快照。
 *
 * 用法：
 *   npx ts-node src/scripts/backfillPostFeatureSnapshots.ts --days 30 --batch 200
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { connectMongoDB } from '../config/db';
import Post from '../models/Post';
import { postFeatureSnapshotService } from '../services/recommendation/contentFeatures';

dotenv.config();

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

    return {
        days: Math.max(1, parseInt(kv.days || '30', 10) || 30),
        batch: Math.max(1, parseInt(kv.batch || '200', 10) || 200),
    };
}

async function main() {
    const args = parseArgs();
    const createdAfter = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000);
    await connectMongoDB();

    let processed = 0;
    let cursor: Date | undefined;

    while (true) {
        const query: Record<string, unknown> = {
            createdAt: cursor
                ? { $gte: createdAfter, $lt: cursor }
                : { $gte: createdAfter },
            deletedAt: null,
        };

        const posts = await Post.find(query)
            .select('_id authorId content keywords language createdAt updatedAt media stats engagementScore isNews newsMetadata.clusterId')
            .sort({ createdAt: -1, _id: -1 })
            .limit(args.batch)
            .lean();

        if (posts.length === 0) {
            break;
        }

        await postFeatureSnapshotService.ensureSnapshotsForPosts(posts as any);
        processed += posts.length;
        cursor = new Date(posts[posts.length - 1].createdAt);
        console.log(`[BackfillPostFeatureSnapshots] processed=${processed}`);
    }

    console.log(`[BackfillPostFeatureSnapshots] completed processed=${processed}`);
}

main()
    .catch((error) => {
        console.error('[BackfillPostFeatureSnapshots] failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        try {
            await mongoose.disconnect();
        } catch {
            // ignore
        }
    });
