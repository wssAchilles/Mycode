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

export async function backfillPostFeatureSnapshots(options: {
    createdAfter: Date;
    batch: number;
}): Promise<number> {
    let processed = 0;
    let cursor: { createdAt: Date; id: mongoose.Types.ObjectId } | undefined;

    while (true) {
        const query: Record<string, unknown> = cursor
            ? {
                $or: [
                    { createdAt: { $gte: options.createdAfter, $lt: cursor.createdAt } },
                    { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
                ],
                deletedAt: null,
            }
            : {
                createdAt: { $gte: options.createdAfter },
                deletedAt: null,
            };

        const posts = await Post.find(query)
            .select('_id authorId content keywords language createdAt updatedAt media stats engagementScore isNews newsMetadata.clusterId')
            .sort({ createdAt: -1, _id: -1 })
            .limit(options.batch)
            .lean();

        if (posts.length === 0) {
            break;
        }

        await postFeatureSnapshotService.ensureSnapshotsForPosts(posts as any);
        processed += posts.length;
        const lastPost = posts[posts.length - 1];
        cursor = {
            createdAt: new Date(lastPost.createdAt),
            id: lastPost._id as mongoose.Types.ObjectId,
        };
        console.log(`[BackfillPostFeatureSnapshots] processed=${processed}`);
    }

    return processed;
}

async function main() {
    const args = parseArgs();
    const createdAfter = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000);
    await connectMongoDB();

    const processed = await backfillPostFeatureSnapshots({
        createdAfter,
        batch: args.batch,
    });
    console.log(`[BackfillPostFeatureSnapshots] completed processed=${processed}`);
}

if (require.main === module) {
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
}
