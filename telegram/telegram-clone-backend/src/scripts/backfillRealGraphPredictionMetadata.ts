import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { connectMongoDB } from '../config/db';
import { redis } from '../config/redis';
import { realGraphService } from '../services/recommendation/RealGraphService';

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

    const since = kv.since ? new Date(kv.since) : undefined;
    return {
        dryRun: kv['dry-run'] === 'true',
        limit: Math.max(1, parseInt(kv.limit || '1000', 10) || 1000),
        batchSize: Math.max(1, parseInt(kv.batch || '200', 10) || 200),
        since: since && !Number.isNaN(since.getTime()) ? since : undefined,
    };
}

async function main() {
    const args = parseArgs();
    await connectMongoDB();

    const result = await realGraphService.backfillPredictionMetadata({
        dryRun: args.dryRun,
        limit: args.limit,
        batchSize: args.batchSize,
        since: args.since,
    });

    console.log(JSON.stringify(result, null, 2));
}

main()
    .catch((error) => {
        console.error('[BackfillRealGraphPredictionMetadata] failed:', error);
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
            redis.disconnect();
        } catch {
            // ignore
        }
    });
