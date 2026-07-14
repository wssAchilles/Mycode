import { disconnectMongoDB } from '../config/db';
import {
    connectRecommendationAuditMongo,
} from '../services/ops/recommendation/auditMongoAccess';
import {
    connectRecommendationRepairMongo,
    loadApprovedApplyRequest,
    loadApprovedRollbackRequest,
    type ApprovedApplyRequest,
    type ApprovedRollbackRequest,
    type ProductionAuthorizationEvidence,
} from '../services/ops/recommendation/embeddingRepair/authorization';
import {
    createEmbeddingMetadataBackup,
    writeJsonFileDurably,
} from '../services/ops/recommendation/embeddingRepair/artifacts';
import {
    EmbeddingRepairRejectedError,
    ZERO_WRITE_COUNTERS,
    type EmbeddingContractRepairProposal,
    type EmbeddingRepairCliOptions,
    type EmbeddingRepairTransactionResult,
} from '../services/ops/recommendation/embeddingRepair/contracts';
import {
    planEmbeddingContractRepair,
} from '../services/ops/recommendation/embeddingRepair/planner';
import {
    applyApprovedProposal,
    rollbackApprovedBackup,
} from '../services/ops/recommendation/embeddingRepair/transactionAdapter';

export {
    EmbeddingRepairRejectedError,
    type EmbeddingContractRepairProposal,
    type EmbeddingRepairCliOptions,
} from '../services/ops/recommendation/embeddingRepair/contracts';
export {
    canonicalDigest,
    computeBackupDigest,
    computeProposalDigest,
    createEmbeddingMetadataBackup,
    validateEmbeddingMetadataBackup,
    validateEmbeddingRepairProposal,
} from '../services/ops/recommendation/embeddingRepair/artifacts';
export {
    assertMetadataOnlyOperations,
} from '../services/ops/recommendation/embeddingRepair/metadataPolicy';
export {
    applyApprovedProposal,
    rollbackApprovedBackup,
} from '../services/ops/recommendation/embeddingRepair/transactionAdapter';

export const EMBEDDING_REPAIR_EXIT_SUCCESS = 0 as const;
export const EMBEDDING_REPAIR_EXIT_REJECTED = 2 as const;
export const EMBEDDING_REPAIR_EXIT_PROGRAM_FAILURE = 3 as const;

export async function closeEmbeddingRepairConnections(): Promise<void> {
    const { sequelize } = await import('../config/sequelize');
    await Promise.allSettled([disconnectMongoDB(), sequelize.close()]);
}

type EmbeddingRepairCliExitCode =
    | typeof EMBEDDING_REPAIR_EXIT_SUCCESS
    | typeof EMBEDDING_REPAIR_EXIT_REJECTED
    | typeof EMBEDDING_REPAIR_EXIT_PROGRAM_FAILURE;

interface EmbeddingRepairCliDependencies {
    connectAudit: typeof connectRecommendationAuditMongo;
    plan: typeof planEmbeddingContractRepair;
    writeArtifact: typeof writeJsonFileDurably;
    loadApplyRequest: (options: EmbeddingRepairCliOptions) => Promise<ApprovedApplyRequest>;
    loadRollbackRequest: (options: EmbeddingRepairCliOptions) => Promise<ApprovedRollbackRequest>;
    connectWriter: (authorization: ProductionAuthorizationEvidence) => Promise<void>;
    applyProposal: typeof applyApprovedProposal;
    rollbackBackup: typeof rollbackApprovedBackup;
    writeJson: (value: unknown) => void;
    writeError: (message: string) => void;
}

const BOOLEAN_ARGUMENTS = new Set(['--apply', '--rollback', '--dry-run']);
const VALUE_ARGUMENTS = new Map<string, keyof EmbeddingRepairCliOptions>([
    ['--limit', 'limit'],
    ['--batch', 'batchSize'],
    ['--proposal-file', 'proposalFile'],
    ['--backup-file', 'backupFile'],
    ['--proposal-approval-file', 'proposalApprovalFile'],
    ['--backup-approval-file', 'backupApprovalFile'],
    ['--production-authorization-file', 'productionAuthorizationFile'],
    ['--writer-pause-evidence-file', 'writerPauseEvidenceFile'],
    ['--approved-proposal-digest', 'approvedProposalDigest'],
    ['--approved-quarantine-digest', 'approvedQuarantineDigest'],
    ['--approved-backup-digest', 'approvedBackupDigest'],
]);

export function parseArgs(argv: readonly string[] = process.argv.slice(2)): EmbeddingRepairCliOptions {
    const values = new Map<string, string>();
    const flags = new Set<string>();
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (BOOLEAN_ARGUMENTS.has(argument)) {
            if (flags.has(argument)) throw new Error(`embedding_repair_argument_duplicate:${argument}`);
            flags.add(argument);
            continue;
        }
        if (!VALUE_ARGUMENTS.has(argument)) {
            throw new Error(`embedding_repair_argument_unknown:${argument}`);
        }
        if (values.has(argument)) throw new Error(`embedding_repair_argument_duplicate:${argument}`);
        const value = argv[index + 1];
        if (!value || value.startsWith('--')) {
            throw new Error(`embedding_repair_argument_value_required:${argument}`);
        }
        values.set(argument, value);
        index += 1;
    }

    const explicitModes = ['--apply', '--rollback', '--dry-run'].filter((flag) => flags.has(flag));
    if (explicitModes.length > 1) throw new Error('embedding_repair_mode_conflict');
    const limit = parsePositiveInteger(values.get('--limit'), 'limit');
    if (flags.has('--apply') && limit !== undefined) {
        throw new Error('embedding_repair_limited_apply_forbidden');
    }
    if (flags.has('--rollback') && limit !== undefined) {
        throw new Error('embedding_repair_limited_rollback_forbidden');
    }
    if (flags.has('--dry-run') && limit !== undefined) {
        throw new Error('embedding_repair_mode_conflict');
    }

    const mode = flags.has('--apply')
        ? 'apply'
        : flags.has('--rollback')
            ? 'rollback'
            : limit === undefined
                ? 'dry-run'
                : 'diagnostic';
    if (mode === 'diagnostic' && values.has('--backup-file')) {
        throw new Error('embedding_repair_diagnostic_backup_forbidden');
    }
    const options: EmbeddingRepairCliOptions = {
        mode,
        limit,
        batchSize: parsePositiveInteger(values.get('--batch'), 'batch') ?? 200,
        proposalFile: values.get('--proposal-file'),
        backupFile: values.get('--backup-file'),
        proposalApprovalFile: values.get('--proposal-approval-file'),
        backupApprovalFile: values.get('--backup-approval-file'),
        productionAuthorizationFile: values.get('--production-authorization-file'),
        writerPauseEvidenceFile: values.get('--writer-pause-evidence-file'),
        approvedProposalDigest: values.get('--approved-proposal-digest'),
        approvedQuarantineDigest: values.get('--approved-quarantine-digest'),
        approvedBackupDigest: values.get('--approved-backup-digest'),
    };
    if (mode === 'apply') assertApplyOptions(options);
    if (mode === 'rollback') assertRollbackOptions(options);
    return options;
}

export async function backfillEmbeddingContracts(
    options: EmbeddingRepairCliOptions,
    dependencyOverrides: Partial<EmbeddingRepairCliDependencies> = {},
): Promise<EmbeddingContractRepairProposal | EmbeddingRepairTransactionResult> {
    const dependencies = buildDependencies(dependencyOverrides);
    if (options.mode === 'dry-run' || options.mode === 'diagnostic') {
        await dependencies.connectAudit();
        const proposal = await dependencies.plan({ limit: options.limit });
        if (options.proposalFile) {
            await dependencies.writeArtifact(options.proposalFile, proposal);
        }
        if (options.backupFile) {
            await dependencies.writeArtifact(
                options.backupFile,
                createEmbeddingMetadataBackup(proposal),
            );
        }
        return proposal;
    }
    if (options.mode === 'apply') {
        const request = await dependencies.loadApplyRequest(options);
        await dependencies.connectWriter(request.productionAuthorization);
        return dependencies.applyProposal(request);
    }
    const request = await dependencies.loadRollbackRequest(options);
    await dependencies.connectWriter(request.productionAuthorization);
    return dependencies.rollbackBackup(request);
}

export async function runEmbeddingContractRepairCli(
    argv: readonly string[],
    dependencyOverrides: Partial<EmbeddingRepairCliDependencies> = {},
): Promise<EmbeddingRepairCliExitCode> {
    const dependencies = buildDependencies(dependencyOverrides);
    let mode = 'unknown';
    try {
        const options = parseArgs(argv);
        mode = options.mode;
        const result = await backfillEmbeddingContracts(options, dependencies);
        dependencies.writeJson(result);
        return EMBEDDING_REPAIR_EXIT_SUCCESS;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof EmbeddingRepairRejectedError) {
            dependencies.writeJson({
                schemaVersion: 1,
                mode,
                status: 'rejected',
                reason: message,
                writeCounters: { ...ZERO_WRITE_COUNTERS },
            });
            return EMBEDDING_REPAIR_EXIT_REJECTED;
        }
        dependencies.writeError(JSON.stringify({
            schemaVersion: 1,
            mode,
            status: 'error',
            reason: message,
            writeCounters: { ...ZERO_WRITE_COUNTERS },
        }));
        return EMBEDDING_REPAIR_EXIT_PROGRAM_FAILURE;
    }
}

function buildDependencies(
    overrides: Partial<EmbeddingRepairCliDependencies>,
): EmbeddingRepairCliDependencies {
    return {
        connectAudit: connectRecommendationAuditMongo,
        plan: planEmbeddingContractRepair,
        writeArtifact: writeJsonFileDurably,
        loadApplyRequest: loadApprovedApplyRequest,
        loadRollbackRequest: loadApprovedRollbackRequest,
        connectWriter: connectRecommendationRepairMongo,
        applyProposal: applyApprovedProposal,
        rollbackBackup: rollbackApprovedBackup,
        writeJson: (value) => console.log(JSON.stringify(value, null, 2)),
        writeError: (message) => console.error(message),
        ...overrides,
    };
}

function assertApplyOptions(options: EmbeddingRepairCliOptions): void {
    requirePath(options.proposalFile, 'proposal_file');
    requirePath(options.backupFile, 'backup_file');
    requirePath(options.proposalApprovalFile, 'proposal_approval_file');
    requirePath(options.backupApprovalFile, 'backup_approval_file');
    requirePath(options.productionAuthorizationFile, 'production_authorization_file');
    requirePath(options.writerPauseEvidenceFile, 'writer_pause_evidence_file');
    requireDigest(options.approvedProposalDigest, 'approved_proposal_digest');
    requireDigest(options.approvedQuarantineDigest, 'approved_quarantine_digest');
    requireDigest(options.approvedBackupDigest, 'approved_backup_digest');
}

function assertRollbackOptions(options: EmbeddingRepairCliOptions): void {
    requirePath(options.proposalFile, 'proposal_file');
    requirePath(options.backupFile, 'backup_file');
    requirePath(options.proposalApprovalFile, 'proposal_approval_file');
    requirePath(options.backupApprovalFile, 'backup_approval_file');
    requirePath(options.productionAuthorizationFile, 'production_authorization_file');
    requirePath(options.writerPauseEvidenceFile, 'writer_pause_evidence_file');
    requireDigest(options.approvedBackupDigest, 'approved_backup_digest');
    requireDigest(options.approvedProposalDigest, 'approved_proposal_digest');
    requireDigest(options.approvedQuarantineDigest, 'approved_quarantine_digest');
}

function requirePath(value: string | undefined, field: string): void {
    if (!value) throw new Error(`embedding_repair_${field}_required`);
}

function requireDigest(value: string | undefined, field: string): void {
    if (!value) throw new Error(`embedding_repair_${field}_required`);
    if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`embedding_repair_${field}_invalid`);
}

function parsePositiveInteger(value: string | undefined, field: string): number | undefined {
    if (value === undefined) return undefined;
    if (!/^\d+$/.test(value) || Number(value) < 1 || !Number.isSafeInteger(Number(value))) {
        throw new Error(`embedding_repair_${field}_invalid`);
    }
    return Number(value);
}

if (require.main === module) {
    runEmbeddingContractRepairCli(process.argv.slice(2))
        .then((exitCode) => {
            process.exitCode = exitCode;
        })
        .finally(closeEmbeddingRepairConnections);
}
