import mongoose from 'mongoose';
import { isDeepStrictEqual } from 'util';

import User from '../../../../models/User';
import PostFeatureSnapshot from '../../../../models/PostFeatureSnapshot';
import UserFeatureVector from '../../../../models/UserFeatureVector';
import {
    HEURISTIC_POST_HASH_EMBEDDING_CONTRACT,
    REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
    type EmbeddingContract,
} from '../../../recommendation/contracts/embeddingContract';
import {
    LEGACY_SERVING_LITE_MIXED_LINEAGE_QUARANTINE_REASON,
    classifyEmbeddingContractEvidence,
    vectorChecksum,
} from '../../../recommendation/contracts/embeddingContractEvidence';
import { buildDensePostEmbedding } from '../../../recommendation/contentFeatures/denseEmbedding';
import {
    buildRegisteredUserColdStartEmbedding,
    canonicalRegisteredUserColdStartInput,
    type RegisteredUserColdStartInput,
} from '../../../recommendation/users/coldStartEmbedding';
import {
    assertProposalBackupPair,
    canonicalDigest,
    validateEmbeddingMetadataBackup,
    validateEmbeddingRepairProposal,
} from './artifacts';
import {
    EmbeddingRepairRejectedError,
    type EmbeddingContractRepairProposal,
    type EmbeddingMetadataBackup,
    type EmbeddingMetadataBackupOperation,
    type EmbeddingMetadataOperation,
    type EmbeddingRepairCollection,
    type EmbeddingRepairTransactionResult,
    type MetadataPatch,
} from './contracts';
import {
    captureMetadata,
    POST_METADATA_FIELDS,
    USER_METADATA_FIELDS,
} from './metadataPolicy';
import { planEmbeddingContractRepair } from './planner';
import {
    assertArtifactApprovalEvidence,
    assertExecutionAuthorization,
    type ArtifactApprovalEvidence,
    type ProductionAuthorizationEvidence,
    type WriterPauseEvidence,
} from './authorization';

type RepairSession = {
    withTransaction?: (
        callback: () => Promise<void>,
        options?: Record<string, unknown>,
    ) => Promise<unknown>;
    endSession?: () => Promise<void> | void;
};

type UpdateResult = { matchedCount?: number };

export interface EmbeddingRepairTransactionDependencies {
    startSession: () => Promise<RepairSession>;
    rebuildLiveProposal: (session: RepairSession) => Promise<EmbeddingContractRepairProposal>;
    loadDocument: (
        collection: EmbeddingRepairCollection,
        id: string,
        session: RepairSession,
    ) => Promise<Record<string, unknown> | null>;
    loadUserInput: (userId: string) => Promise<RegisteredUserColdStartInput | null>;
    updateMetadata: (
        collection: EmbeddingRepairCollection,
        id: string,
        patch: MetadataPatch,
        session: RepairSession,
        options: { timestamps: false },
    ) => Promise<UpdateResult>;
}

export interface ApplyApprovedProposalInput {
    proposal: EmbeddingContractRepairProposal;
    backup: EmbeddingMetadataBackup;
    approvedProposalDigest: string;
    approvedQuarantineDigest: string;
    approvedBackupDigest: string;
    proposalApproval: ArtifactApprovalEvidence;
    backupApproval: ArtifactApprovalEvidence;
    productionAuthorization: ProductionAuthorizationEvidence;
    writerPauseEvidence: WriterPauseEvidence;
    dependencies?: EmbeddingRepairTransactionDependencies;
}

export interface RollbackApprovedBackupInput {
    proposal: EmbeddingContractRepairProposal;
    backup: EmbeddingMetadataBackup;
    approvedBackupDigest: string;
    approvedSourceProposalDigest: string;
    approvedSourceQuarantineDigest: string;
    proposalApproval: ArtifactApprovalEvidence;
    backupApproval: ArtifactApprovalEvidence;
    productionAuthorization: ProductionAuthorizationEvidence;
    writerPauseEvidence: WriterPauseEvidence;
    dependencies?: EmbeddingRepairTransactionDependencies;
}

export async function applyApprovedProposal(
    input: ApplyApprovedProposalInput,
): Promise<EmbeddingRepairTransactionResult> {
    const proposal = validateEmbeddingRepairProposal(input.proposal, { forApply: true });
    const backup = validateEmbeddingMetadataBackup(input.backup);
    if (input.approvedProposalDigest !== proposal.proposalDigest) {
        throw rejected('embedding_repair_proposal_approval_mismatch');
    }
    if (input.approvedQuarantineDigest !== proposal.quarantineDigest) {
        throw rejected('embedding_repair_quarantine_digest_mismatch');
    }
    if (input.approvedBackupDigest !== backup.backupDigest) {
        throw rejected('embedding_repair_backup_approval_mismatch');
    }
    assertProposalBackupPair(proposal, backup);
    assertArtifactApprovalEvidence(
        input.proposalApproval,
        'proposal',
        proposal.proposalDigest,
    );
    assertArtifactApprovalEvidence(
        input.backupApproval,
        'backup',
        backup.backupDigest,
    );
    assertExecutionAuthorization({
        operation: 'apply',
        proposalDigest: proposal.proposalDigest,
        backupDigest: backup.backupDigest,
        proposalApproval: input.proposalApproval,
        backupApproval: input.backupApproval,
        productionAuthorization: input.productionAuthorization,
        writerPauseEvidence: input.writerPauseEvidence,
    });

    const dependencies = input.dependencies ?? defaultDependencies;
    await runTransaction(dependencies, async (session) => {
        // Mongo snapshot isolation does not cover PostgreSQL replay inputs; external writer-pause
        // evidence remains mandatory and each user input digest is checked again below.
        const liveProposal = validateEmbeddingRepairProposal(
            await dependencies.rebuildLiveProposal(session),
        );
        if (liveProposal.proposalDigest !== proposal.proposalDigest
            || liveProposal.quarantineDigest !== input.approvedQuarantineDigest) {
            throw rejected('embedding_repair_live_proposal_drift');
        }

        const prepared: EmbeddingMetadataOperation[] = [];
        for (const operation of proposal.operations) {
            const document = await loadRequiredDocument(dependencies, operation, session);
            await assertOperationCurrent(
                operation,
                document,
                dependencies.loadUserInput,
                false,
            );
            prepared.push(operation);
        }
        await writePreparedOperations(dependencies, prepared, session, 'patch');
        assertTransactionEvidence(
            input,
            'apply',
            proposal.proposalDigest,
            backup.backupDigest,
        );
    });

    return transactionResult('apply', proposal.proposalDigest, backup.backupDigest, proposal.operations.length);
}

export async function rollbackApprovedBackup(
    input: RollbackApprovedBackupInput,
): Promise<EmbeddingRepairTransactionResult> {
    const proposal = validateEmbeddingRepairProposal(input.proposal, { forApply: true });
    const backup = validateEmbeddingMetadataBackup(input.backup);
    if (input.approvedBackupDigest !== backup.backupDigest) {
        throw rejected('embedding_repair_backup_approval_mismatch');
    }
    if (input.approvedSourceProposalDigest !== backup.sourceProposalDigest) {
        throw rejected('embedding_repair_backup_source_approval_mismatch');
    }
    if (input.approvedSourceQuarantineDigest !== backup.sourceQuarantineDigest) {
        throw rejected('embedding_repair_quarantine_digest_mismatch');
    }
    assertProposalBackupPair(proposal, backup);
    assertArtifactApprovalEvidence(
        input.proposalApproval,
        'proposal',
        proposal.proposalDigest,
    );
    assertArtifactApprovalEvidence(
        input.backupApproval,
        'backup',
        backup.backupDigest,
    );
    assertExecutionAuthorization({
        operation: 'rollback',
        proposalDigest: proposal.proposalDigest,
        backupDigest: backup.backupDigest,
        proposalApproval: input.proposalApproval,
        backupApproval: input.backupApproval,
        productionAuthorization: input.productionAuthorization,
        writerPauseEvidence: input.writerPauseEvidence,
    });

    const dependencies = input.dependencies ?? defaultDependencies;
    await runTransaction(dependencies, async (session) => {
        const liveProposal = validateEmbeddingRepairProposal(
            await dependencies.rebuildLiveProposal(session),
        );
        if (liveProposal.proposalDigest !== backup.expectedPostApplyProposalDigest
            || liveProposal.quarantineDigest !== backup.sourceQuarantineDigest) {
            throw rejected('embedding_repair_live_post_apply_proposal_drift');
        }

        const prepared: EmbeddingMetadataBackupOperation[] = [];
        for (const operation of backup.operations) {
            const document = await loadRequiredDocument(dependencies, operation, session);
            await assertOperationCurrent(
                operation,
                document,
                dependencies.loadUserInput,
                true,
            );
            prepared.push(operation);
        }
        await writePreparedOperations(dependencies, prepared, session, 'restorePatch');
        assertTransactionEvidence(
            input,
            'rollback',
            proposal.proposalDigest,
            backup.backupDigest,
        );
    });

    return transactionResult(
        'rollback',
        backup.sourceProposalDigest,
        backup.backupDigest,
        backup.operations.length,
    );
}

async function runTransaction(
    dependencies: EmbeddingRepairTransactionDependencies,
    callback: (session: RepairSession) => Promise<void>,
): Promise<void> {
    const session = await dependencies.startSession();
    try {
        if (typeof session.withTransaction !== 'function') {
            throw new Error('embedding_repair_transaction_unsupported');
        }
        await session.withTransaction(
            () => callback(session),
            {
                readConcern: { level: 'snapshot' },
                writeConcern: { w: 'majority' },
            },
        );
    } finally {
        await session.endSession?.();
    }
}

function assertTransactionEvidence(
    input: Pick<
        ApplyApprovedProposalInput,
        'proposalApproval' | 'backupApproval' | 'productionAuthorization' | 'writerPauseEvidence'
    >,
    operation: 'apply' | 'rollback',
    proposalDigest: string,
    backupDigest: string,
): void {
    const now = Date.now();
    assertArtifactApprovalEvidence(input.proposalApproval, 'proposal', proposalDigest, now);
    assertArtifactApprovalEvidence(input.backupApproval, 'backup', backupDigest, now);
    assertExecutionAuthorization({
        operation,
        proposalDigest,
        backupDigest,
        proposalApproval: input.proposalApproval,
        backupApproval: input.backupApproval,
        productionAuthorization: input.productionAuthorization,
        writerPauseEvidence: input.writerPauseEvidence,
        now,
    });
}

async function assertOperationCurrent(
    operation: EmbeddingMetadataOperation | EmbeddingMetadataBackupOperation,
    document: Record<string, unknown>,
    loadUserInput: (userId: string) => Promise<RegisteredUserColdStartInput | null>,
    rollback: boolean,
): Promise<void> {
    const expectedMetadata = rollback
        ? operation.expectedPostApplyMetadata
        : (operation as EmbeddingMetadataOperation).currentMetadata;
    if (rollback) assertMetadataMatches(operation.collection, document, expectedMetadata);
    const classificationDocument = buildClassificationDocument(
        operation.collection,
        document,
        operation.expectedPostApplyMetadata,
    );

    let userInput: RegisteredUserColdStartInput | null = null;
    let replayVector: readonly number[];
    if (operation.collection === 'user_feature_vectors') {
        userInput = await loadUserInput(String(operation.userId));
        if (!userInput
            || canonicalDigest(canonicalRegisteredUserColdStartInput(userInput)) !== operation.replayInputDigest) {
            throw rejected('embedding_repair_replay_input_drift');
        }
        replayVector = buildRegisteredUserColdStartEmbedding(userInput);
    } else {
        replayVector = buildDensePostEmbedding(document);
    }

    for (const expected of operation.expectedVectors) {
        const vector = document[expected.field];
        let currentChecksum: string;
        try {
            currentChecksum = vectorChecksum(vector as number[]);
        } catch {
            throw rejected(`embedding_repair_vector_drift:${operation.collection}:${operation.id}:${expected.field}`);
        }
        if (currentChecksum !== expected.vectorChecksum) {
            throw rejected(`embedding_repair_vector_drift:${operation.collection}:${operation.id}:${expected.field}`);
        }
        const replayMatched = vectorsEqual(vector, replayVector);
        const classification = operation.collection === 'user_feature_vectors'
            ? classifyUserVector(classificationDocument, expected.field, replayMatched)
            : classifyEmbeddingContractEvidence({
                vector,
                perVectorContract: classificationDocument.embeddingContract as EmbeddingContract | null | undefined,
                replayContract: HEURISTIC_POST_HASH_EMBEDDING_CONTRACT,
                replayMatched,
            });
        const approvedQuarantineMismatch = !replayMatched
            && operation.collection === 'user_feature_vectors'
            && expected.field === 'twoTowerEmbedding'
            && expected.classification === 'quarantined'
            && classification === 'quarantined'
            && (operation.expectedPostApplyMetadata.twoTowerEmbeddingContract === undefined
                || operation.expectedPostApplyMetadata.twoTowerEmbeddingContract === null)
            && operation.expectedPostApplyMetadata.twoTowerEmbeddingQuarantineReason
                === LEGACY_SERVING_LITE_MIXED_LINEAGE_QUARANTINE_REASON;
        if (!replayMatched && !approvedQuarantineMismatch) {
            throw rejected(`embedding_repair_replay_drift:${operation.collection}:${operation.id}:${expected.field}`);
        }
        if (classification !== expected.classification) {
            throw rejected(`embedding_repair_classification_drift:${operation.collection}:${operation.id}:${expected.field}`);
        }
    }

    if (!rollback) assertMetadataMatches(operation.collection, document, expectedMetadata);
}

function buildClassificationDocument(
    collection: EmbeddingRepairCollection,
    document: Record<string, unknown>,
    metadata: Record<string, unknown>,
): Record<string, unknown> {
    const result = { ...document };
    const fields = collection === 'user_feature_vectors'
        ? USER_METADATA_FIELDS
        : POST_METADATA_FIELDS;
    for (const field of fields) delete result[field];
    Object.assign(result, structuredClone(metadata));
    return result;
}

function classifyUserVector(
    document: Record<string, unknown>,
    field: 'twoTowerEmbedding' | 'phoenixEmbedding' | 'denseEmbedding',
    replayMatched: boolean,
) {
    const twoTower = field === 'twoTowerEmbedding';
    return classifyEmbeddingContractEvidence({
        vector: document[field],
        perVectorContract: document[twoTower
            ? 'twoTowerEmbeddingContract'
            : 'phoenixEmbeddingContract'] as EmbeddingContract | null | undefined,
        legacySharedContract: document.embeddingContract as Partial<EmbeddingContract> | null | undefined,
        ...(twoTower ? {
            quarantineReason: document.twoTowerEmbeddingQuarantineReason as string | null | undefined,
        } : {}),
        replayContract: REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
        replayMatched,
    });
}

function assertMetadataMatches(
    collection: EmbeddingRepairCollection,
    document: Record<string, unknown>,
    expected: Record<string, unknown>,
): void {
    const current = captureMetadata(
        document,
        collection === 'user_feature_vectors' ? USER_METADATA_FIELDS : POST_METADATA_FIELDS,
    );
    if (!isDeepStrictEqual(current, expected)) {
        throw rejected(`embedding_repair_metadata_drift:${collection}:${String(document._id ?? '')}`);
    }
}

async function loadRequiredDocument(
    dependencies: EmbeddingRepairTransactionDependencies,
    operation: Pick<EmbeddingMetadataOperation, 'collection' | 'id'>,
    session: RepairSession,
): Promise<Record<string, unknown>> {
    const document = await dependencies.loadDocument(operation.collection, operation.id, session);
    if (!document) {
        throw rejected(`embedding_repair_document_missing:${operation.collection}:${operation.id}`);
    }
    return document;
}

async function writePreparedOperations(
    dependencies: EmbeddingRepairTransactionDependencies,
    operations: readonly (EmbeddingMetadataOperation | EmbeddingMetadataBackupOperation)[],
    session: RepairSession,
    patchField: 'patch' | 'restorePatch',
): Promise<void> {
    for (const operation of operations) {
        const patch = patchField === 'patch'
            ? (operation as EmbeddingMetadataOperation).patch
            : operation.restorePatch;
        const result = await dependencies.updateMetadata(
            operation.collection,
            operation.id,
            patch,
            session,
            { timestamps: false },
        );
        if (result.matchedCount !== 1) {
            throw rejected(`embedding_repair_matched_count_mismatch:${operation.collection}:${operation.id}`);
        }
    }
}

function transactionResult(
    mode: 'apply' | 'rollback',
    proposalDigest: string,
    backupDigest: string,
    operations: number,
): EmbeddingRepairTransactionResult {
    return {
        schemaVersion: 1,
        mode,
        completed: true,
        operations,
        sourceProposalDigest: proposalDigest,
        sourceBackupDigest: backupDigest,
        writeCounters: {
            mongo: operations,
            redis: 0,
            scheduler: 0,
            process: 0,
            python: 0,
        },
    };
}

function rejected(message: string): EmbeddingRepairRejectedError {
    return new EmbeddingRepairRejectedError(message);
}

function vectorsEqual(left: unknown, right: readonly number[]): boolean {
    return Array.isArray(left)
        && left.length === right.length
        && left.every((value, index) => value === right[index]);
}

async function defaultLoadDocument(
    collection: EmbeddingRepairCollection,
    id: string,
    session: RepairSession,
): Promise<Record<string, unknown> | null> {
    if (collection === 'user_feature_vectors') {
        return await UserFeatureVector.findById(id)
            .session(session as never)
            .lean() as unknown as Record<string, unknown> | null;
    }
    return await PostFeatureSnapshot.findById(id)
        .session(session as never)
        .lean() as unknown as Record<string, unknown> | null;
}

async function defaultLoadUserInput(userId: string): Promise<RegisteredUserColdStartInput | null> {
    const user = await User.findByPk(userId, {
        attributes: ['id', 'username', 'region', 'language'],
    });
    return user ? {
        id: user.id,
        username: user.username,
        region: user.region,
        language: user.language,
    } : null;
}

async function defaultUpdateMetadata(
    collection: EmbeddingRepairCollection,
    id: string,
    patch: MetadataPatch,
    session: RepairSession,
): Promise<UpdateResult> {
    const update: Record<string, unknown> = {};
    if (Object.keys(patch.set).length > 0) update.$set = patch.set;
    if (patch.unset.length > 0) {
        update.$unset = Object.fromEntries(patch.unset.map((field) => [field, '']));
    }
    const options = { session: session as never, timestamps: false, runValidators: true };
    return collection === 'user_feature_vectors'
        ? UserFeatureVector.updateOne({ _id: id }, update, options)
        : PostFeatureSnapshot.updateOne({ _id: id }, update, options);
}

const defaultDependencies: EmbeddingRepairTransactionDependencies = {
    startSession: () => mongoose.startSession() as unknown as Promise<RepairSession>,
    rebuildLiveProposal: (session) => planEmbeddingContractRepair({ session }),
    loadDocument: defaultLoadDocument,
    loadUserInput: defaultLoadUserInput,
    updateMetadata: defaultUpdateMetadata,
};
