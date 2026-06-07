import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { sequelize } from '../config/sequelize';
import { connectMongoDB } from '../config/db';
import { registeredUserFeatureBootstrapService } from '../services/recommendation/users';

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
        dryRun: kv['dry-run'] === 'true',
        limit: Math.max(1, parseInt(kv.limit || '10000', 10) || 10000),
        batchSize: Math.max(1, parseInt(kv.batch || '500', 10) || 500),
    };
}

async function main() {
    const args = parseArgs();
    await connectMongoDB();
    const result = await registeredUserFeatureBootstrapService.backfill(args);
    console.log(JSON.stringify(result, null, 2));
}

main()
    .catch((error) => {
        console.error('[BackfillRegisteredUserRecommendationFeatures] failed:', error);
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
