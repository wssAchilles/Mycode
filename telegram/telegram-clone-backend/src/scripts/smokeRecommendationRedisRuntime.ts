import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { connectMongoDB } from '../config/db';
import { getRedis } from '../services/recommendation/utils/redisClient';
import { InNetworkTimelineService } from '../services/recommendation/InNetworkTimelineService';

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
        userId: kv.userId || 'redis_smoke_user',
        authorId: kv.authorId || 'redis_smoke_author',
        postId: kv.postId || `redis_smoke_post_${Date.now()}`,
    };
}

async function main() {
    const args = parseArgs();
    await connectMongoDB();
    const redis = getRedis();
    if (!redis) {
        console.log(JSON.stringify({ ok: false, reason: 'redis_unavailable' }, null, 2));
        return;
    }

    await InNetworkTimelineService.addPost(args.authorId, args.postId, new Date());
    const timelineKey = InNetworkTimelineService.thunderTimelineKey(args.authorId);
    const serveKey = `recommendation:serve:v1:${args.userId}`;
    await redis.sadd(serveKey, args.postId);
    await redis.expire(serveKey, 60);

    const [timelineExists, serveExists] = await Promise.all([
        redis.zscore(timelineKey, args.postId),
        redis.sismember(serveKey, args.postId),
    ]);

    console.log(JSON.stringify({
        ok: Boolean(timelineExists) || serveExists === 1,
        timelineKey,
        serveKey,
        timelineContainsPost: Boolean(timelineExists),
        serveContainsPost: serveExists === 1,
    }, null, 2));
}

main()
    .catch((error) => {
        console.error('[SmokeRecommendationRedisRuntime] failed:', error);
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
            getRedis()?.disconnect();
        } catch {
            // ignore
        }
    });
