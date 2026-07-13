import crypto from 'crypto';

import { connectMongoDB } from '../../../../config/db';
import {
    assertProposalBackupPair,
    readJsonFileDurably,
    validateEmbeddingMetadataBackup,
    validateEmbeddingRepairProposal,
} from './artifacts';
import {
    EmbeddingRepairRejectedError,
    type EmbeddingRepairCliOptions,
} from './contracts';
import type {
    ApplyApprovedProposalInput,
    RollbackApprovedBackupInput,
} from './transactionAdapter';

const HASH_PATTERN = /^[a-f0-9]{64}$/;

export interface ProductionAuthorizationEvidence {
    schemaVersion: 1;
    operation: 'apply' | 'rollback';
    sourceProposalDigest: string;
    sourceBackupDigest: string;
    mongodbUriSha256: string;
    authorizedBy: string;
    authorizedAt: string;
    expiresAt: string;
}

export interface WriterPauseEvidence {
    schemaVersion: 1;
    scope: 'recommendation_embedding_contract_and_user_replay_input_writers';
    paused: true;
    sourceProposalDigest: string;
    sourceBackupDigest: string;
    pausedBy: string;
    pausedAt: string;
    expiresAt: string;
}

export interface ArtifactApprovalEvidence {
    schemaVersion: 1;
    artifact: 'proposal' | 'backup';
    approvedDigest: string;
    approvedBy: string;
    approvedAt: string;
    expiresAt: string;
}

export interface ApprovedApplyRequest extends ApplyApprovedProposalInput {
    productionAuthorization: ProductionAuthorizationEvidence;
    writerPauseEvidence: WriterPauseEvidence;
}

export interface ApprovedRollbackRequest extends RollbackApprovedBackupInput {
    productionAuthorization: ProductionAuthorizationEvidence;
    writerPauseEvidence: WriterPauseEvidence;
}

export interface AuthorizationLoadDependencies {
    readArtifact: (path: string) => Promise<unknown>;
    now: number;
}

export async function loadApprovedApplyRequest(
    options: EmbeddingRepairCliOptions,
    dependencyOverrides: Partial<AuthorizationLoadDependencies> = {},
): Promise<ApprovedApplyRequest> {
    const dependencies: AuthorizationLoadDependencies = {
        readArtifact: readJsonFileDurably,
        now: Date.now(),
        ...dependencyOverrides,
    };
    const proposal = validateEmbeddingRepairProposal(
        await readRequired(dependencies, requireOption(options.proposalFile, 'proposal_file')),
        { forApply: true },
    );
    const backup = validateEmbeddingMetadataBackup(
        await readRequired(dependencies, requireOption(options.backupFile, 'backup_file')),
    );
    const proposalApproval = parseArtifactApproval(
        await readRequired(
            dependencies,
            requireOption(options.proposalApprovalFile, 'proposal_approval_file'),
        ),
        'proposal',
        dependencies.now,
    );
    const backupApproval = parseArtifactApproval(
        await readRequired(
            dependencies,
            requireOption(options.backupApprovalFile, 'backup_approval_file'),
        ),
        'backup',
        dependencies.now,
    );
    const productionAuthorization = parseProductionAuthorization(
        await readRequired(
            dependencies,
            requireOption(options.productionAuthorizationFile, 'production_authorization_file'),
        ),
        'apply',
        dependencies.now,
    );
    const writerPauseEvidence = parseWriterPauseEvidence(
        await readRequired(
            dependencies,
            requireOption(options.writerPauseEvidenceFile, 'writer_pause_evidence_file'),
        ),
        dependencies.now,
    );

    assertProposalBackupPair(proposal, backup);
    if (options.approvedProposalDigest !== proposal.proposalDigest
        || proposalApproval.approvedDigest !== proposal.proposalDigest) {
        throw rejected('embedding_repair_proposal_approval_mismatch');
    }
    if (options.approvedBackupDigest !== backup.backupDigest
        || backupApproval.approvedDigest !== backup.backupDigest) {
        throw rejected('embedding_repair_backup_approval_mismatch');
    }
    if (options.approvedQuarantineDigest !== proposal.quarantineDigest) {
        throw rejected('embedding_repair_quarantine_digest_mismatch');
    }
    assertExecutionAuthorization({
        operation: 'apply',
        proposalDigest: proposal.proposalDigest,
        backupDigest: backup.backupDigest,
        proposalApproval,
        backupApproval,
        productionAuthorization,
        writerPauseEvidence,
        now: dependencies.now,
    });

    return {
        proposal,
        backup,
        approvedProposalDigest: proposal.proposalDigest,
        approvedQuarantineDigest: proposal.quarantineDigest,
        approvedBackupDigest: backup.backupDigest,
        proposalApproval,
        backupApproval,
        productionAuthorization,
        writerPauseEvidence,
    };
}

export async function loadApprovedRollbackRequest(
    options: EmbeddingRepairCliOptions,
    dependencyOverrides: Partial<AuthorizationLoadDependencies> = {},
): Promise<ApprovedRollbackRequest> {
    const dependencies: AuthorizationLoadDependencies = {
        readArtifact: readJsonFileDurably,
        now: Date.now(),
        ...dependencyOverrides,
    };
    const proposal = validateEmbeddingRepairProposal(
        await readRequired(dependencies, requireOption(options.proposalFile, 'proposal_file')),
        { forApply: true },
    );
    const backup = validateEmbeddingMetadataBackup(
        await readRequired(dependencies, requireOption(options.backupFile, 'backup_file')),
    );
    const proposalApproval = parseArtifactApproval(
        await readRequired(
            dependencies,
            requireOption(options.proposalApprovalFile, 'proposal_approval_file'),
        ),
        'proposal',
        dependencies.now,
    );
    const backupApproval = parseArtifactApproval(
        await readRequired(
            dependencies,
            requireOption(options.backupApprovalFile, 'backup_approval_file'),
        ),
        'backup',
        dependencies.now,
    );
    const productionAuthorization = parseProductionAuthorization(
        await readRequired(
            dependencies,
            requireOption(options.productionAuthorizationFile, 'production_authorization_file'),
        ),
        'rollback',
        dependencies.now,
    );
    const writerPauseEvidence = parseWriterPauseEvidence(
        await readRequired(
            dependencies,
            requireOption(options.writerPauseEvidenceFile, 'writer_pause_evidence_file'),
        ),
        dependencies.now,
    );

    assertProposalBackupPair(proposal, backup);
    if (options.approvedProposalDigest !== proposal.proposalDigest
        || proposalApproval.approvedDigest !== proposal.proposalDigest) {
        throw rejected('embedding_repair_proposal_approval_mismatch');
    }
    if (options.approvedBackupDigest !== backup.backupDigest
        || backupApproval.approvedDigest !== backup.backupDigest) {
        throw rejected('embedding_repair_backup_approval_mismatch');
    }
    if (options.approvedQuarantineDigest !== proposal.quarantineDigest) {
        throw rejected('embedding_repair_quarantine_digest_mismatch');
    }
    assertExecutionAuthorization({
        operation: 'rollback',
        proposalDigest: backup.sourceProposalDigest,
        backupDigest: backup.backupDigest,
        proposalApproval,
        backupApproval,
        productionAuthorization,
        writerPauseEvidence,
        now: dependencies.now,
    });

    return {
        proposal,
        backup,
        approvedBackupDigest: backup.backupDigest,
        approvedSourceProposalDigest: proposal.proposalDigest,
        approvedSourceQuarantineDigest: proposal.quarantineDigest,
        proposalApproval,
        backupApproval,
        productionAuthorization,
        writerPauseEvidence,
    };
}

export function assertArtifactApprovalEvidence(
    value: ArtifactApprovalEvidence,
    artifact: 'proposal' | 'backup',
    approvedDigest: string,
    now = Date.now(),
): void {
    const approval = parseArtifactApproval(value, artifact, now);
    if (approval.approvedDigest !== approvedDigest) {
        throw rejected(`embedding_repair_${artifact}_approval_mismatch`);
    }
}

export function assertExecutionAuthorization({
    operation,
    proposalDigest,
    backupDigest,
    proposalApproval,
    backupApproval,
    productionAuthorization,
    writerPauseEvidence,
    now = Date.now(),
}: {
    operation: 'apply' | 'rollback';
    proposalDigest: string;
    backupDigest: string;
    proposalApproval: ArtifactApprovalEvidence;
    backupApproval: ArtifactApprovalEvidence;
    productionAuthorization: ProductionAuthorizationEvidence;
    writerPauseEvidence: WriterPauseEvidence;
    now?: number;
}): void {
    const proposal = parseArtifactApproval(proposalApproval, 'proposal', now);
    const backup = parseArtifactApproval(backupApproval, 'backup', now);
    const production = parseProductionAuthorization(
        productionAuthorization,
        operation,
        now,
    );
    const pause = parseWriterPauseEvidence(writerPauseEvidence, now);
    assertProductionAndPauseBinding(production, pause, proposalDigest, backupDigest);
    assertAuthorizationChronology(proposal, backup, production, pause);
}

export async function connectRecommendationRepairMongo(
    authorization: ProductionAuthorizationEvidence,
): Promise<void> {
    const uri = process.env.RECOMMENDATION_REPAIR_MONGODB_URI?.trim();
    if (!uri) throw new Error('embedding_repair_mongodb_uri_required');
    const digest = crypto.createHash('sha256').update(uri, 'utf8').digest('hex');
    if (!safeEqual(digest, authorization.mongodbUriSha256)) {
        throw rejected('embedding_repair_mongodb_uri_approval_mismatch');
    }
    await connectMongoDB({
        uri,
        autoIndex: false,
        autoCreate: false,
        quiet: true,
    });
}

function parseArtifactApproval(
    value: unknown,
    artifact: 'proposal' | 'backup',
    now: number,
): ArtifactApprovalEvidence {
    const expectedKeys = [
        'schemaVersion',
        'artifact',
        'approvedDigest',
        'approvedBy',
        'approvedAt',
        'expiresAt',
    ];
    if (!isRecord(value)
        || !hasExactKeys(value, expectedKeys)
        || value.schemaVersion !== 1
        || value.artifact !== artifact
        || !isHash(value.approvedDigest)
        || !isNonEmptyString(value.approvedBy)
        || !isDate(value.approvedAt)
        || !isDate(value.expiresAt)) {
        throw new Error(`embedding_repair_${artifact}_approval_invalid`);
    }
    assertEvidenceWindow(
        value.approvedAt,
        value.expiresAt,
        now,
        `${artifact}_approval`,
    );
    return value as unknown as ArtifactApprovalEvidence;
}

function parseProductionAuthorization(
    value: unknown,
    operation: 'apply' | 'rollback',
    now: number,
): ProductionAuthorizationEvidence {
    const expectedKeys = [
        'schemaVersion',
        'operation',
        'sourceProposalDigest',
        'sourceBackupDigest',
        'mongodbUriSha256',
        'authorizedBy',
        'authorizedAt',
        'expiresAt',
    ];
    if (!isRecord(value)
        || !hasExactKeys(value, expectedKeys)
        || value.schemaVersion !== 1
        || value.operation !== operation
        || !isHash(value.sourceProposalDigest)
        || !isHash(value.sourceBackupDigest)
        || !isHash(value.mongodbUriSha256)
        || !isNonEmptyString(value.authorizedBy)
        || !isDate(value.authorizedAt)
        || !isDate(value.expiresAt)) {
        throw new Error('embedding_repair_production_authorization_invalid');
    }
    assertEvidenceWindow(
        value.authorizedAt,
        value.expiresAt,
        now,
        'production_authorization',
    );
    return value as unknown as ProductionAuthorizationEvidence;
}

function parseWriterPauseEvidence(value: unknown, now: number): WriterPauseEvidence {
    const expectedKeys = [
        'schemaVersion',
        'scope',
        'paused',
        'sourceProposalDigest',
        'sourceBackupDigest',
        'pausedBy',
        'pausedAt',
        'expiresAt',
    ];
    if (!isRecord(value)
        || !hasExactKeys(value, expectedKeys)
        || value.schemaVersion !== 1
        || value.scope !== 'recommendation_embedding_contract_and_user_replay_input_writers'
        || value.paused !== true
        || !isHash(value.sourceProposalDigest)
        || !isHash(value.sourceBackupDigest)
        || !isNonEmptyString(value.pausedBy)
        || !isDate(value.pausedAt)
        || !isDate(value.expiresAt)) {
        throw new Error('embedding_repair_writer_pause_invalid');
    }
    assertEvidenceWindow(value.pausedAt, value.expiresAt, now, 'writer_pause');
    return value as unknown as WriterPauseEvidence;
}

function assertProductionAndPauseBinding(
    production: ProductionAuthorizationEvidence,
    pause: WriterPauseEvidence,
    proposalDigest: string,
    backupDigest: string,
): void {
    if (production.sourceProposalDigest !== proposalDigest
        || production.sourceBackupDigest !== backupDigest) {
        throw rejected('embedding_repair_production_authorization_mismatch');
    }
    if (pause.sourceProposalDigest !== proposalDigest
        || pause.sourceBackupDigest !== backupDigest) {
        throw rejected('embedding_repair_writer_pause_mismatch');
    }
}

function assertAuthorizationChronology(
    proposal: ArtifactApprovalEvidence,
    backup: ArtifactApprovalEvidence,
    production: ProductionAuthorizationEvidence,
    pause: WriterPauseEvidence,
): void {
    const proposalApprovedAt = Date.parse(proposal.approvedAt);
    const backupApprovedAt = Date.parse(backup.approvedAt);
    const authorizedAt = Date.parse(production.authorizedAt);
    const pausedAt = Date.parse(pause.pausedAt);
    if (proposalApprovedAt < pausedAt
        || backupApprovedAt < pausedAt
        || authorizedAt < proposalApprovedAt
        || authorizedAt < backupApprovedAt) {
        throw rejected('embedding_repair_authorization_chronology_invalid');
    }
}

async function readRequired(
    dependencies: AuthorizationLoadDependencies,
    path: string,
): Promise<unknown> {
    try {
        const value = await dependencies.readArtifact(path);
        if (value === undefined) throw new Error('undefined');
        return value;
    } catch {
        throw new Error(`embedding_repair_artifact_file_missing:${path}`);
    }
}

function requireOption(value: string | undefined, name: string): string {
    if (!value) throw new Error(`embedding_repair_${name}_required`);
    return value;
}

function assertEvidenceWindow(
    issuedAtValue: string,
    expiresAtValue: string,
    now: number,
    kind: string,
): void {
    const issuedAt = Date.parse(issuedAtValue);
    const expiresAt = Date.parse(expiresAtValue);
    if (issuedAt >= expiresAt) {
        throw rejected(`embedding_repair_${kind}_window_invalid`);
    }
    if (issuedAt > now) {
        throw rejected(`embedding_repair_${kind}_issued_in_future`);
    }
    if (expiresAt <= now) throw rejected(`embedding_repair_${kind}_expired`);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
    const actual = Object.keys(value).sort();
    const sortedExpected = [...expected].sort();
    return actual.length === sortedExpected.length
        && actual.every((key, index) => key === sortedExpected[index]);
}

function safeEqual(left: string, right: string): boolean {
    return left.length === right.length
        && crypto.timingSafeEqual(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function isHash(value: unknown): value is string {
    return typeof value === 'string' && HASH_PATTERN.test(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function isDate(value: unknown): value is string {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function rejected(message: string): EmbeddingRepairRejectedError {
    return new EmbeddingRepairRejectedError(message);
}
