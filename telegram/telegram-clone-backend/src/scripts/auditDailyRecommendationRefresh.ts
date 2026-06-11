import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { connectMongoDB } from '../config/db';
import { sequelize } from '../config/sequelize';
import { buildDailyRecommendationRefreshAudit } from '../services/ops/recommendation/dailyRefreshOps';

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

    const output = await buildDailyRecommendationRefreshAudit({ hours, since });
    console.log(JSON.stringify(output, null, 2));
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
