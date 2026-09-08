import dotenv from 'dotenv';

import { disconnectMongoDB } from '../config/db';
import { sequelize } from '../config/sequelize';
import { connectRecommendationAuditMongo } from '../services/ops/recommendation/auditMongoAccess';
import { buildDailyRecommendationRefreshAudit } from '../services/ops/recommendation/dailyRefreshOps';

dotenv.config({ quiet: true });

export const DAILY_RECOMMENDATION_AUDIT_EXIT_PASS = 0 as const;
export const DAILY_RECOMMENDATION_AUDIT_EXIT_PROGRAM_FAILURE = 3 as const;

type DailyRecommendationAuditCliDependencies = {
    connectMongo: typeof connectRecommendationAuditMongo;
    authenticateSql: () => Promise<unknown>;
    buildAudit: typeof buildDailyRecommendationRefreshAudit;
    writeJson: (value: unknown) => void;
    writeError: (message: string) => void;
};

export function parseArgs(argv: readonly string[]): { hours: number; since: Date } {
    let hours = 24;
    let since: Date | undefined;

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        const value = argv[index + 1];
        if (argument === '--hours') {
            if (!value || value.startsWith('--') || !/^\d+$/.test(value) || Number(value) < 1) {
                throw new Error('daily_recommendation_audit_hours_invalid');
            }
            hours = Number(value);
            index += 1;
            continue;
        }
        if (argument === '--since') {
            if (!value || value.startsWith('--') || !Number.isFinite(Date.parse(value))) {
                throw new Error('daily_recommendation_audit_since_invalid');
            }
            since = new Date(value);
            index += 1;
            continue;
        }
        throw new Error(`daily_recommendation_audit_argument_unknown:${argument}`);
    }

    return {
        hours,
        since: since ?? new Date(Date.now() - hours * 60 * 60 * 1000),
    };
}

export async function runAuditDailyRecommendationRefreshCli(
    argv: readonly string[],
    dependencyOverrides: Partial<DailyRecommendationAuditCliDependencies> = {},
): Promise<
    | typeof DAILY_RECOMMENDATION_AUDIT_EXIT_PASS
    | typeof DAILY_RECOMMENDATION_AUDIT_EXIT_PROGRAM_FAILURE
> {
    const dependencies: DailyRecommendationAuditCliDependencies = {
        connectMongo: connectRecommendationAuditMongo,
        authenticateSql: () => sequelize.authenticate(),
        buildAudit: buildDailyRecommendationRefreshAudit,
        writeJson: (value) => console.log(JSON.stringify(value, null, 2)),
        writeError: (message) => console.error(message),
        ...dependencyOverrides,
    };

    try {
        const { hours, since } = parseArgs(argv);
        await dependencies.connectMongo();
        await dependencies.authenticateSql();
        dependencies.writeJson(await dependencies.buildAudit({ hours, since }));
        return DAILY_RECOMMENDATION_AUDIT_EXIT_PASS;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        dependencies.writeError(`[AuditDailyRecommendationRefresh] failed: ${message}`);
        return DAILY_RECOMMENDATION_AUDIT_EXIT_PROGRAM_FAILURE;
    }
}

async function closeConnections(): Promise<void> {
    try {
        await disconnectMongoDB();
    } catch {
        // ignore
    }
    try {
        await sequelize.close();
    } catch {
        // ignore
    }
}

if (require.main === module) {
    runAuditDailyRecommendationRefreshCli(process.argv.slice(2))
        .then((exitCode) => {
            process.exitCode = exitCode;
        })
        .finally(closeConnections);
}
