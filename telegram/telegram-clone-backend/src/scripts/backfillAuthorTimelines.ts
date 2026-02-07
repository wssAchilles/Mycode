/**
 * One-time backfill for Redis author timelines:
 * - Reads recent posts from MongoDB
 * - Writes to Redis ZSET `tl:author:{authorId}` with score=createdAtMs
 *
 * Usage:
 *   ts-node src/scripts/backfillAuthorTimelines.ts --days 7
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectMongoDB } from '../config/db';
import { redis } from '../config/redis';
import Post from '../models/Post';
import { InNetworkTimelineService } from '../services/recommendation/InNetworkTimelineService';

dotenv.config();

function parseArgs() {
    const args = process.argv.slice(2);
    const out: Record<string, string> = {};
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a.startsWith('--')) {
            const key = a.slice(2);
            const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true';
            out[key] = val;
        }
    }
    return out;
}

async function main() {
    const args = parseArgs();
    const days = Math.max(1, parseInt(args.days || '7', 10) || 7);
    const batchSize = Math.max(100, parseInt(args.batchSize || '1000', 10) || 1000);

    console.log(`[Backfill] Starting author timeline backfill: days=${days}, batchSize=${batchSize}`);

    await connectMongoDB();
    // ioredis lazyConnect; force connect here for clearer failures
    await redis.connect().catch(() => undefined);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const cursor = Post.find({
        createdAt: { $gte: cutoff },
        deletedAt: null,
        isNews: { $ne: true },
    })
        .select('_id authorId createdAt')
        .sort({ createdAt: 1 })
        .cursor();

    let total = 0;
    let batch: Array<{ id: string; authorId: string; createdAt: Date }> = [];
    const touchedAuthors = new Set<string>();

    const flush = async () => {
        if (batch.length === 0) return;
        const pipeline = redis.pipeline();
        for (const p of batch) {
            const key = InNetworkTimelineService.timelineKey(p.authorId);
            pipeline.zadd(key, p.createdAt.getTime(), p.id);
            touchedAuthors.add(p.authorId);
        }
        await pipeline.exec();
        total += batch.length;
        console.log(`[Backfill] wrote ${total} posts...`);
        batch = [];
    };

    for await (const doc of cursor as any) {
        batch.push({ id: doc._id.toString(), authorId: doc.authorId, createdAt: doc.createdAt });
        if (batch.length >= batchSize) {
            await flush();
        }
    }
    await flush();

    console.log(`[Backfill] Trimming timelines for ${touchedAuthors.size} authors...`);
    const cutoffMs = InNetworkTimelineService.windowCutoffMs(Date.now());

    // Trim per author: window + TTL + cap
    const authors = Array.from(touchedAuthors);
    for (let i = 0; i < authors.length; i += 200) {
        const slice = authors.slice(i, i + 200);
        const pipeline = redis.pipeline();
        slice.forEach((authorId) => {
            const key = InNetworkTimelineService.timelineKey(authorId);
            pipeline.zremrangebyscore(key, 0, cutoffMs);
            pipeline.expire(key, 8 * 24 * 60 * 60);
            pipeline.zcard(key);
        });
        const res = await pipeline.exec();
        // Enforce cap (200) for this batch; zcard replies are in positions 2,5,8...
        for (let j = 0; j < slice.length; j++) {
            const authorId = slice[j];
            const zcardReply = res?.[j * 3 + 2]?.[1];
            const card = typeof zcardReply === 'number' ? (zcardReply as number) : null;
            if (card && card > 200) {
                const removeCount = card - 200;
                await redis.zremrangebyrank(
                    InNetworkTimelineService.timelineKey(authorId),
                    0,
                    removeCount - 1
                );
            }
        }
    }

    console.log(`[Backfill] Done. totalPosts=${total}, authors=${touchedAuthors.size}`);
}

main()
    .catch((err) => {
        console.error('[Backfill] failed', err);
        process.exitCode = 1;
    })
    .finally(async () => {
        try {
            await mongoose.disconnect();
        } catch {}
        try {
            redis.disconnect();
        } catch {}
    });

