import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { connectMongoDB } from '../config/db';
import { sequelize } from '../config/sequelize';
import { newsMaterializationService } from '../services/recommendation/newsMaterialization';

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
        batchSize: Math.max(1, parseInt(kv.batch || '100', 10) || 100),
        since: since && !Number.isNaN(since.getTime()) ? since : undefined,
        refreshFeatureSnapshots: kv['skip-snapshots'] !== 'true',
    };
}

async function main() {
    const args = parseArgs();
    await connectMongoDB();

    const result = await newsMaterializationService.materialize({
        dryRun: args.dryRun,
        limit: args.limit,
        batchSize: args.batchSize,
        since: args.since,
        refreshFeatureSnapshots: args.refreshFeatureSnapshots,
    });

    console.log(JSON.stringify(result, null, 2));
}

main()
    .catch((error) => {
        console.error('[MaterializeNewsArticlesToPosts] failed:', error);
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
