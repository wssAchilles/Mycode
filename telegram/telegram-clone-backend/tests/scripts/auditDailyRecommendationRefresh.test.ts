import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    connectMongo: vi.fn(),
    authenticate: vi.fn(),
    close: vi.fn(),
    buildAudit: vi.fn(),
}));

vi.mock('../../src/services/ops/recommendation/auditMongoAccess', () => ({
    connectRecommendationAuditMongo: mocks.connectMongo,
}));

vi.mock('../../src/config/sequelize', () => ({
    sequelize: {
        authenticate: mocks.authenticate,
        close: mocks.close,
    },
}));

vi.mock('../../src/services/ops/recommendation/dailyRefreshOps', () => ({
    buildDailyRecommendationRefreshAudit: mocks.buildAudit,
}));

describe('auditDailyRecommendationRefresh CLI', () => {
    it('is import-safe and does not connect or query models', async () => {
        await import('../../src/scripts/auditDailyRecommendationRefresh');
        await Promise.resolve();

        expect(mocks.connectMongo).not.toHaveBeenCalled();
        expect(mocks.authenticate).not.toHaveBeenCalled();
        expect(mocks.buildAudit).not.toHaveBeenCalled();
    });

    it('maps preflight failures to exit 3 before the audit read model', async () => {
        const {
            DAILY_RECOMMENDATION_AUDIT_EXIT_PROGRAM_FAILURE,
            runAuditDailyRecommendationRefreshCli,
        } = await import('../../src/scripts/auditDailyRecommendationRefresh');
        const writeError = vi.fn();

        const exitCode = await runAuditDailyRecommendationRefreshCli([], {
            connectMongo: vi.fn().mockRejectedValue(new Error('evidence invalid')),
            authenticateSql: vi.fn(),
            buildAudit: vi.fn(),
            writeJson: vi.fn(),
            writeError,
        });

        expect(exitCode).toBe(DAILY_RECOMMENDATION_AUDIT_EXIT_PROGRAM_FAILURE);
        expect(writeError).toHaveBeenCalledWith(expect.stringMatching(/^\[AuditDailyRecommendationRefresh\] failed:/));
    });
});
