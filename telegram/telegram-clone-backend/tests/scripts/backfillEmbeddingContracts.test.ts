import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    connectAudit: vi.fn(),
    connectWriter: vi.fn(),
    disconnectMongo: vi.fn(),
    plan: vi.fn(),
}));

vi.mock('../../src/services/ops/recommendation/auditMongoAccess', () => ({
    connectRecommendationAuditMongo: mocks.connectAudit,
}));

vi.mock('../../src/config/db', () => ({
    disconnectMongoDB: mocks.disconnectMongo,
}));

vi.mock('../../src/services/ops/recommendation/embeddingRepair/planner', () => ({
    planEmbeddingContractRepair: mocks.plan,
}));

describe('embedding contract repair CLI arguments', () => {
    beforeEach(() => vi.clearAllMocks());

    it('defaults to an uncapped full dry-run and makes a limit diagnostic-only', async () => {
        const { parseArgs } = await import('../../src/scripts/backfillEmbeddingContracts');

        expect(parseArgs([])).toMatchObject({
            mode: 'dry-run',
            limit: undefined,
            batchSize: 200,
        });
        expect(parseArgs(['--limit', '25'])).toMatchObject({
            mode: 'diagnostic',
            limit: 25,
            batchSize: 200,
        });
    });

    it.each([
        [['--apply', '--limit', '1'], 'embedding_repair_limited_apply_forbidden'],
        [['--rollback', '--limit', '1'], 'embedding_repair_limited_rollback_forbidden'],
        [['--apply', '--rollback'], 'embedding_repair_mode_conflict'],
        [['--dry-run', '--apply'], 'embedding_repair_mode_conflict'],
        [['--unknown'], 'embedding_repair_argument_unknown:--unknown'],
    ])('rejects conflicting or unknown arguments before any connection', async (argv, message) => {
        const { parseArgs } = await import('../../src/scripts/backfillEmbeddingContracts');

        expect(() => parseArgs(argv)).toThrow(message);
        expect(mocks.connectAudit).not.toHaveBeenCalled();
        expect(mocks.connectWriter).not.toHaveBeenCalled();
    });

    it.each([
        [[], 'embedding_repair_proposal_file_required'],
        [['--proposal-file', 'proposal.json'], 'embedding_repair_backup_file_required'],
        [[
            '--proposal-file', 'proposal.json',
            '--backup-file', 'backup.json',
        ], 'embedding_repair_proposal_approval_file_required'],
        [[
            '--proposal-file', 'proposal.json',
            '--backup-file', 'backup.json',
            '--proposal-approval-file', 'proposal.approval.json',
            '--backup-approval-file', 'backup.approval.json',
            '--production-authorization-file', 'production.json',
            '--writer-pause-evidence-file', 'pause.json',
        ], 'embedding_repair_approved_proposal_digest_required'],
    ])('rejects incomplete apply authorization before connection', async (tail, message) => {
        const { parseArgs } = await import('../../src/scripts/backfillEmbeddingContracts');

        expect(() => parseArgs(['--apply', ...tail])).toThrow(message);
        expect(mocks.connectAudit).not.toHaveBeenCalled();
        expect(mocks.connectWriter).not.toHaveBeenCalled();
    });

    it('requires external backup approval and writer pause evidence for rollback', async () => {
        const { parseArgs } = await import('../../src/scripts/backfillEmbeddingContracts');

        expect(() => parseArgs([
            '--rollback',
            '--proposal-file', 'proposal.json',
            '--proposal-approval-file', 'proposal.approval.json',
            '--backup-file', 'backup.json',
        ]))
            .toThrow('embedding_repair_backup_approval_file_required');
    });

    it('forbids diagnostic scans from generating rollback authority', async () => {
        const { parseArgs } = await import('../../src/scripts/backfillEmbeddingContracts');

        expect(() => parseArgs(['--limit', '10', '--backup-file', 'backup.json']))
            .toThrow('embedding_repair_diagnostic_backup_forbidden');
    });
});

describe('embedding contract repair CLI boundary', () => {
    beforeEach(() => vi.clearAllMocks());

    it('is import-safe and uses the read-only audit connection for a full dry-run', async () => {
        const proposal = { schemaVersion: 1, mode: 'dry-run', proposalDigest: 'a'.repeat(64) };
        mocks.connectAudit.mockResolvedValue({
            evidenceFile: '/tmp/audit.json',
            evidenceFileSha256: 'b'.repeat(64),
        });
        mocks.plan.mockResolvedValue(proposal);
        const writeJson = vi.fn();

        const module = await import('../../src/scripts/backfillEmbeddingContracts');
        expect(mocks.connectAudit).not.toHaveBeenCalled();
        expect(mocks.plan).not.toHaveBeenCalled();

        const exitCode = await module.runEmbeddingContractRepairCli([], {
            writeJson,
            writeError: vi.fn(),
        });

        expect(exitCode).toBe(module.EMBEDDING_REPAIR_EXIT_SUCCESS);
        expect(mocks.connectAudit).toHaveBeenCalledOnce();
        expect(mocks.plan).toHaveBeenCalledWith(expect.objectContaining({ limit: undefined }));
        expect(writeJson).toHaveBeenCalledWith(proposal);
    });

    it('maps argument failures to exit 3 without connecting', async () => {
        const module = await import('../../src/scripts/backfillEmbeddingContracts');

        const exitCode = await module.runEmbeddingContractRepairCli(['--apply'], {
            writeJson: vi.fn(),
            writeError: vi.fn(),
        });

        expect(exitCode).toBe(module.EMBEDDING_REPAIR_EXIT_PROGRAM_FAILURE);
        expect(mocks.connectAudit).not.toHaveBeenCalled();
        expect(mocks.connectWriter).not.toHaveBeenCalled();
    });

    it('loads and validates every saved artifact and external approval before writer connection', async () => {
        const module = await import('../../src/scripts/backfillEmbeddingContracts');
        const order: string[] = [];
        const request = { approved: true } as never;
        const writeArtifact = vi.fn();

        const exitCode = await module.runEmbeddingContractRepairCli(applyArgs(), {
            loadApplyRequest: vi.fn(async () => {
                order.push('load');
                return request;
            }),
            connectWriter: vi.fn(async () => order.push('connect')),
            applyProposal: vi.fn(async () => {
                order.push('apply');
                return { schemaVersion: 1, mode: 'apply', completed: true } as never;
            }),
            writeArtifact,
            writeJson: vi.fn(),
            writeError: vi.fn(),
        });

        expect(exitCode).toBe(module.EMBEDDING_REPAIR_EXIT_SUCCESS);
        expect(order).toEqual(['load', 'connect', 'apply']);
        expect(writeArtifact).not.toHaveBeenCalled();
    });

    it('returns exit 2 and performs no connection or write when saved approval validation rejects', async () => {
        const module = await import('../../src/scripts/backfillEmbeddingContracts');
        const connectWriter = vi.fn();
        const applyProposal = vi.fn();

        const exitCode = await module.runEmbeddingContractRepairCli(applyArgs(), {
            loadApplyRequest: vi.fn().mockRejectedValue(
                new module.EmbeddingRepairRejectedError('embedding_repair_backup_approval_mismatch'),
            ),
            connectWriter,
            applyProposal,
            writeJson: vi.fn(),
            writeError: vi.fn(),
        });

        expect(exitCode).toBe(module.EMBEDDING_REPAIR_EXIT_REJECTED);
        expect(connectWriter).not.toHaveBeenCalled();
        expect(applyProposal).not.toHaveBeenCalled();
    });
});

function applyArgs(): string[] {
    return [
        '--apply',
        '--proposal-file', 'proposal.json',
        '--backup-file', 'backup.json',
        '--proposal-approval-file', 'proposal.approval.json',
        '--backup-approval-file', 'backup.approval.json',
        '--production-authorization-file', 'production.json',
        '--writer-pause-evidence-file', 'pause.json',
        '--approved-proposal-digest', '1'.repeat(64),
        '--approved-quarantine-digest', '2'.repeat(64),
        '--approved-backup-digest', '3'.repeat(64),
    ];
}
