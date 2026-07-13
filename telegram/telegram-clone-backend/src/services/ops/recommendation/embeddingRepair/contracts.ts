import type {
    EmbeddingEvidenceStatus,
} from '../../../recommendation/contracts/embeddingContractEvidence';
import type {
    EmbeddingEvidenceSummary,
} from '../embeddingEvidenceAudit';

export type EmbeddingRepairMode = 'dry-run' | 'diagnostic' | 'apply' | 'rollback';
export type EmbeddingRepairCollection = 'user_feature_vectors' | 'post_feature_snapshots';
export type EmbeddingRepairVectorField =
    | 'twoTowerEmbedding'
    | 'phoenixEmbedding'
    | 'denseEmbedding';

export interface ExpectedVectorArtifact {
    field: EmbeddingRepairVectorField;
    vectorChecksum: string;
    classification: EmbeddingEvidenceStatus;
}

export interface MetadataPatch {
    set: Record<string, unknown>;
    unset: string[];
}

export interface EmbeddingMetadataOperation {
    collection: EmbeddingRepairCollection;
    id: string;
    userId?: string;
    replayInputDigest?: string;
    expectedVectors: ExpectedVectorArtifact[];
    currentMetadata: Record<string, unknown>;
    expectedPostApplyMetadata: Record<string, unknown>;
    patch: MetadataPatch;
    restorePatch: MetadataPatch;
}

export interface EmbeddingRepairEvidence {
    aggregate: EmbeddingEvidenceSummary;
    cohorts: {
        userVectors: EmbeddingEvidenceSummary;
        postFeatureSnapshots: EmbeddingEvidenceSummary;
    };
}

export interface EmbeddingRepairReplayCounts {
    user: {
        matched: number;
        mismatched: number;
        inputMissing: number;
    };
    post: {
        matched: number;
        mismatched: number;
    };
}

export interface EmbeddingRepairWriteCounters {
    mongo: 0;
    redis: 0;
    scheduler: 0;
    process: 0;
    python: 0;
}

export interface EmbeddingContractRepairProposalInput {
    schemaVersion: 1;
    mode: 'dry-run' | 'diagnostic';
    fullScan: boolean;
    scanned: {
        users: number;
        postFeatureSnapshots: number;
    };
    evidence: EmbeddingRepairEvidence;
    replay: EmbeddingRepairReplayCounts;
    operations: EmbeddingMetadataOperation[];
    corpusStateDigest: string;
    quarantineDigest: string;
    writeCounters: EmbeddingRepairWriteCounters;
}

export interface EmbeddingContractRepairProposal extends EmbeddingContractRepairProposalInput {
    proposalDigest: string;
}

export interface EmbeddingMetadataBackupOperation {
    collection: EmbeddingRepairCollection;
    id: string;
    userId?: string;
    replayInputDigest?: string;
    expectedVectors: ExpectedVectorArtifact[];
    expectedPostApplyMetadata: Record<string, unknown>;
    restoredMetadata: Record<string, unknown>;
    restorePatch: MetadataPatch;
}

export interface EmbeddingMetadataBackupInput {
    schemaVersion: 1;
    sourceProposalDigest: string;
    sourceQuarantineDigest: string;
    expectedPostApplyProposalDigest: string;
    operations: EmbeddingMetadataBackupOperation[];
    writeCounters: EmbeddingRepairWriteCounters;
}

export interface EmbeddingMetadataBackup extends EmbeddingMetadataBackupInput {
    backupDigest: string;
}

export interface EmbeddingRepairCliOptions {
    mode: EmbeddingRepairMode;
    limit?: number;
    batchSize: number;
    proposalFile?: string;
    backupFile?: string;
    proposalApprovalFile?: string;
    backupApprovalFile?: string;
    productionAuthorizationFile?: string;
    writerPauseEvidenceFile?: string;
    approvedProposalDigest?: string;
    approvedQuarantineDigest?: string;
    approvedBackupDigest?: string;
}

export interface EmbeddingRepairTransactionResult {
    schemaVersion: 1;
    mode: 'apply' | 'rollback';
    completed: true;
    operations: number;
    sourceProposalDigest: string;
    sourceBackupDigest: string;
    writeCounters: {
        mongo: number;
        redis: 0;
        scheduler: 0;
        process: 0;
        python: 0;
    };
}

export class EmbeddingRepairRejectedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'EmbeddingRepairRejectedError';
    }
}

export const ZERO_WRITE_COUNTERS: EmbeddingRepairWriteCounters = Object.freeze({
    mongo: 0,
    redis: 0,
    scheduler: 0,
    process: 0,
    python: 0,
});
