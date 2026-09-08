import crypto from 'crypto';
import { link, open, readFile, unlink } from 'fs/promises';
import { basename, dirname, join } from 'path';
import { isDeepStrictEqual } from 'util';

import type { EmbeddingEvidenceSummary } from '../embeddingEvidenceAudit';
import {
    EmbeddingRepairRejectedError,
    ZERO_WRITE_COUNTERS,
    type EmbeddingContractRepairProposal,
    type EmbeddingContractRepairProposalInput,
    type EmbeddingMetadataBackup,
    type EmbeddingMetadataBackupInput,
    type EmbeddingMetadataBackupOperation,
    type EmbeddingMetadataOperation,
    type ExpectedVectorArtifact,
} from './contracts';
import {
    applyMetadataPatch,
    assertMetadataOnlyOperations,
    assertMetadataPatch,
    assertMetadataSnapshot,
} from './metadataPolicy';

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const EVIDENCE_FIELDS = [
    'total',
    'verified_local_fallback',
    'semantic_ready',
    'quarantined',
    'invalid',
    'unclassified',
] as const;
const CLASSIFICATIONS = new Set([
    'verified_local_fallback',
    'semantic_ready',
    'quarantined',
    'invalid',
    'unclassified',
]);

export function canonicalJson(value: unknown): string {
    if (value === null) return 'null';
    if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error('embedding_repair_canonical_json_invalid');
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(',')}]`;
    }
    if (!isRecord(value)) throw new Error('embedding_repair_canonical_json_invalid');
    const keys = Object.keys(value).sort(compareUtf8);
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function canonicalDigest(value: unknown): string {
    return crypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

export function computeProposalDigest(
    proposal: EmbeddingContractRepairProposalInput | EmbeddingContractRepairProposal,
): string {
    const { proposalDigest: _ignored, ...input } = proposal as EmbeddingContractRepairProposal;
    return canonicalDigest(input);
}

export function computeBackupDigest(
    backup: EmbeddingMetadataBackupInput | EmbeddingMetadataBackup,
): string {
    const { backupDigest: _ignored, ...input } = backup as EmbeddingMetadataBackup;
    return canonicalDigest(input);
}

export function validateEmbeddingRepairProposal(
    value: unknown,
    options: { forApply?: boolean } = {},
): EmbeddingContractRepairProposal {
    const proposal = parseProposalShape(value);
    assertCanonicalOperations(proposal.operations);
    assertMetadataOnlyOperations(proposal.operations);
    assertProposalCounts(proposal);
    if (computeProposalDigest(proposal) !== proposal.proposalDigest) {
        throw new EmbeddingRepairRejectedError('embedding_repair_proposal_digest_mismatch');
    }
    if (options.forApply) assertProposalAuthorizable(proposal);
    return proposal;
}

export function createEmbeddingMetadataBackup(
    proposalValue: EmbeddingContractRepairProposal,
): EmbeddingMetadataBackup {
    const proposal = validateEmbeddingRepairProposal(proposalValue, { forApply: true });
    const input: EmbeddingMetadataBackupInput = {
        schemaVersion: 1,
        sourceProposalDigest: proposal.proposalDigest,
        sourceQuarantineDigest: proposal.quarantineDigest,
        expectedPostApplyProposalDigest: expectedPostApplyProposalDigest(proposal),
        operations: proposal.operations.map((operation) => ({
            collection: operation.collection,
            id: operation.id,
            ...(operation.userId === undefined ? {} : { userId: operation.userId }),
            ...(operation.replayInputDigest === undefined
                ? {}
                : { replayInputDigest: operation.replayInputDigest }),
            expectedVectors: structuredClone(operation.expectedVectors),
            expectedPostApplyMetadata: structuredClone(operation.expectedPostApplyMetadata),
            restoredMetadata: structuredClone(operation.currentMetadata),
            restorePatch: structuredClone(operation.restorePatch),
        })),
        writeCounters: { ...ZERO_WRITE_COUNTERS },
    };
    return { ...input, backupDigest: computeBackupDigest(input) };
}

export function validateEmbeddingMetadataBackup(value: unknown): EmbeddingMetadataBackup {
    const backup = parseBackupShape(value);
    assertCanonicalBackupOperations(backup.operations);
    for (const operation of backup.operations) {
        assertMetadataSnapshot(operation.collection, operation.expectedPostApplyMetadata);
        assertMetadataSnapshot(operation.collection, operation.restoredMetadata);
        assertMetadataPatch(
            operation.collection,
            operation.restorePatch,
            { direction: 'restore' },
        );
        if (operation.expectedVectors.some(({ classification }) => (
            classification === 'semantic_ready'
            || classification === 'invalid'
            || classification === 'unclassified'
        ))) {
            throw new EmbeddingRepairRejectedError('embedding_repair_backup_classification_not_authorizable');
        }
        const restored = applyMetadataPatch(
            operation.expectedPostApplyMetadata,
            operation.restorePatch,
        );
        if (!isDeepStrictEqual(restored, operation.restoredMetadata)) {
            throw new Error('embedding_repair_backup_restore_patch_mismatch');
        }
    }
    if (computeBackupDigest(backup) !== backup.backupDigest) {
        throw new EmbeddingRepairRejectedError('embedding_repair_backup_digest_mismatch');
    }
    return backup;
}

export function assertProposalBackupPair(
    proposal: EmbeddingContractRepairProposal,
    backup: EmbeddingMetadataBackup,
): void {
    if (backup.sourceProposalDigest !== proposal.proposalDigest
        || backup.sourceQuarantineDigest !== proposal.quarantineDigest) {
        throw new EmbeddingRepairRejectedError('embedding_repair_backup_source_mismatch');
    }
    const expected = createEmbeddingMetadataBackup(proposal);
    if (!isDeepStrictEqual(expected, backup)) {
        throw new EmbeddingRepairRejectedError('embedding_repair_backup_content_mismatch');
    }
}

export async function readJsonFileDurably(path: string): Promise<unknown> {
    const handle = await open(path, 'r');
    let first: Buffer;
    try {
        await handle.sync();
        first = await handle.readFile();
    } finally {
        await handle.close();
    }
    const second = await readFile(path);
    if (!first.equals(second)) throw new Error('embedding_repair_artifact_reread_mismatch');
    try {
        return JSON.parse(first.toString('utf8'));
    } catch {
        throw new Error('embedding_repair_artifact_json_invalid');
    }
}

export async function writeJsonFileDurably(path: string, value: unknown): Promise<void> {
    const directory = dirname(path);
    const temporaryPath = join(
        directory,
        `.${basename(path)}.${process.pid}.${crypto.randomUUID()}.tmp`,
    );
    const handle = await open(temporaryPath, 'wx');
    try {
        await handle.writeFile(`${canonicalJson(value)}\n`, 'utf8');
        await handle.sync();
    } finally {
        await handle.close();
    }
    try {
        await link(temporaryPath, path);
        const directoryHandle = await open(directory, 'r');
        try {
            await directoryHandle.sync();
        } finally {
            await directoryHandle.close();
        }
    } finally {
        await unlink(temporaryPath).catch(() => undefined);
    }
    const reread = await readJsonFileDurably(path);
    if (!isDeepStrictEqual(reread, value)) {
        throw new Error('embedding_repair_artifact_reread_mismatch');
    }
}

function parseProposalShape(value: unknown): EmbeddingContractRepairProposal {
    if (!isRecord(value)) throw new Error('embedding_repair_proposal_schema_invalid');
    assertExactKeys(value, [
        'schemaVersion',
        'mode',
        'fullScan',
        'scanned',
        'evidence',
        'replay',
        'operations',
        'corpusStateDigest',
        'quarantineDigest',
        'writeCounters',
        'proposalDigest',
    ], 'embedding_repair_proposal_schema_invalid');
    if (value.schemaVersion !== 1
        || (value.mode !== 'dry-run' && value.mode !== 'diagnostic')
        || typeof value.fullScan !== 'boolean'
        || !isRecord(value.scanned)
        || !isRecord(value.evidence)
        || !isRecord(value.replay)
        || !Array.isArray(value.operations)
        || !isHash(value.corpusStateDigest)
        || !isHash(value.quarantineDigest)
        || !isHash(value.proposalDigest)) {
        throw new Error('embedding_repair_proposal_schema_invalid');
    }
    if ((value.mode === 'dry-run') !== value.fullScan) {
        throw new Error('embedding_repair_proposal_scan_mode_invalid');
    }
    assertExactKeys(value.scanned, ['users', 'postFeatureSnapshots'], 'embedding_repair_proposal_schema_invalid');
    if (!isNonNegativeInteger(value.scanned.users)
        || !isNonNegativeInteger(value.scanned.postFeatureSnapshots)) {
        throw new Error('embedding_repair_proposal_schema_invalid');
    }
    parseEvidence(value.evidence);
    parseReplay(value.replay);
    assertZeroWriteCounters(value.writeCounters);
    value.operations.forEach(parseOperationShape);
    return value as unknown as EmbeddingContractRepairProposal;
}

function parseBackupShape(value: unknown): EmbeddingMetadataBackup {
    if (!isRecord(value)) throw new Error('embedding_repair_backup_schema_invalid');
    assertExactKeys(value, [
        'schemaVersion',
        'sourceProposalDigest',
        'sourceQuarantineDigest',
        'expectedPostApplyProposalDigest',
        'operations',
        'writeCounters',
        'backupDigest',
    ], 'embedding_repair_backup_schema_invalid');
    if (value.schemaVersion !== 1
        || !isHash(value.sourceProposalDigest)
        || !isHash(value.sourceQuarantineDigest)
        || !isHash(value.expectedPostApplyProposalDigest)
        || !Array.isArray(value.operations)
        || !isHash(value.backupDigest)) {
        throw new Error('embedding_repair_backup_schema_invalid');
    }
    assertZeroWriteCounters(value.writeCounters);
    value.operations.forEach(parseBackupOperationShape);
    return value as unknown as EmbeddingMetadataBackup;
}

function expectedPostApplyProposalDigest(
    proposal: EmbeddingContractRepairProposal,
): string {
    const { proposalDigest: _ignored, ...input } = proposal;
    return computeProposalDigest({ ...input, operations: [] });
}

function parseOperationShape(value: unknown): void {
    if (!isRecord(value)) throw new Error('embedding_repair_operation_schema_invalid');
    const isUser = value.collection === 'user_feature_vectors';
    const expectedKeys = [
        'collection',
        'id',
        ...(isUser ? ['userId', 'replayInputDigest'] : []),
        'expectedVectors',
        'currentMetadata',
        'expectedPostApplyMetadata',
        'patch',
        'restorePatch',
    ];
    assertExactKeys(value, expectedKeys, 'embedding_repair_operation_schema_invalid');
    if ((!isUser && value.collection !== 'post_feature_snapshots')
        || !isNonEmptyString(value.id)
        || (isUser && (!isNonEmptyString(value.userId) || !isHash(value.replayInputDigest)))
        || !Array.isArray(value.expectedVectors)
        || !isRecord(value.currentMetadata)
        || !isRecord(value.expectedPostApplyMetadata)
        || !isRecord(value.patch)
        || !isRecord(value.restorePatch)) {
        throw new Error('embedding_repair_operation_schema_invalid');
    }
    value.expectedVectors.forEach(parseExpectedVectorShape);
}

function parseBackupOperationShape(value: unknown): void {
    if (!isRecord(value)) throw new Error('embedding_repair_backup_operation_schema_invalid');
    const isUser = value.collection === 'user_feature_vectors';
    const expectedKeys = [
        'collection',
        'id',
        ...(isUser ? ['userId', 'replayInputDigest'] : []),
        'expectedVectors',
        'expectedPostApplyMetadata',
        'restoredMetadata',
        'restorePatch',
    ];
    assertExactKeys(value, expectedKeys, 'embedding_repair_backup_operation_schema_invalid');
    if ((!isUser && value.collection !== 'post_feature_snapshots')
        || !isNonEmptyString(value.id)
        || (isUser && (!isNonEmptyString(value.userId) || !isHash(value.replayInputDigest)))
        || !Array.isArray(value.expectedVectors)
        || !isRecord(value.expectedPostApplyMetadata)
        || !isRecord(value.restoredMetadata)
        || !isRecord(value.restorePatch)) {
        throw new Error('embedding_repair_backup_operation_schema_invalid');
    }
    value.expectedVectors.forEach(parseExpectedVectorShape);
}

function parseExpectedVectorShape(value: unknown): void {
    if (!isRecord(value)) throw new Error('embedding_repair_expected_vector_schema_invalid');
    assertExactKeys(
        value,
        ['field', 'vectorChecksum', 'classification'],
        'embedding_repair_expected_vector_schema_invalid',
    );
    if (!['twoTowerEmbedding', 'phoenixEmbedding', 'denseEmbedding'].includes(String(value.field))
        || !isHash(value.vectorChecksum)
        || !CLASSIFICATIONS.has(String(value.classification))) {
        throw new Error('embedding_repair_expected_vector_schema_invalid');
    }
}

function assertCanonicalOperations(operations: readonly EmbeddingMetadataOperation[]): void {
    const seen = new Set<string>();
    for (let index = 0; index < operations.length; index += 1) {
        const operation = operations[index];
        const key = `${operation.collection}\0${operation.id}`;
        if (seen.has(key)) throw new Error('embedding_repair_operation_duplicate');
        seen.add(key);
        if (index > 0 && compareOperations(operations[index - 1], operation) >= 0) {
            throw new Error('embedding_repair_operations_not_canonical');
        }
        assertExpectedVectors(operation.collection, operation.expectedVectors);
    }
}

function assertCanonicalBackupOperations(
    operations: readonly EmbeddingMetadataBackupOperation[],
): void {
    const seen = new Set<string>();
    for (let index = 0; index < operations.length; index += 1) {
        const operation = operations[index];
        const key = `${operation.collection}\0${operation.id}`;
        if (seen.has(key)) throw new Error('embedding_repair_backup_operation_duplicate');
        seen.add(key);
        if (index > 0 && compareOperations(operations[index - 1], operation) >= 0) {
            throw new Error('embedding_repair_backup_operations_not_canonical');
        }
        assertExpectedVectors(operation.collection, operation.expectedVectors);
    }
}

function assertExpectedVectors(
    collection: string,
    vectors: readonly ExpectedVectorArtifact[],
): void {
    const seen = new Set<string>();
    for (let index = 0; index < vectors.length; index += 1) {
        const field = vectors[index].field;
        if (seen.has(field)) throw new Error('embedding_repair_expected_vector_duplicate');
        seen.add(field);
        if (index > 0 && compareUtf8(vectors[index - 1].field, field) >= 0) {
            throw new Error('embedding_repair_expected_vectors_not_canonical');
        }
    }
    const required = collection === 'user_feature_vectors'
        ? ['phoenixEmbedding', 'twoTowerEmbedding']
        : ['denseEmbedding'];
    if (!isDeepStrictEqual(vectors.map(({ field }) => field), required)) {
        throw new Error('embedding_repair_expected_vectors_incomplete');
    }
}

function assertProposalCounts(proposal: EmbeddingContractRepairProposal): void {
    const { aggregate, cohorts } = proposal.evidence;
    if (cohorts.userVectors.total !== proposal.scanned.users * 2
        || cohorts.postFeatureSnapshots.total !== proposal.scanned.postFeatureSnapshots
        || !EVIDENCE_FIELDS.every((field) => (
            aggregate[field] === cohorts.userVectors[field] + cohorts.postFeatureSnapshots[field]
        ))) {
        throw new Error('embedding_repair_evidence_count_mismatch');
    }
    const userReplay = proposal.replay.user;
    const postReplay = proposal.replay.post;
    if (userReplay.matched + userReplay.mismatched + userReplay.inputMissing !== proposal.scanned.users * 2
        || postReplay.matched + postReplay.mismatched !== proposal.scanned.postFeatureSnapshots) {
        throw new Error('embedding_repair_replay_count_mismatch');
    }
}

function assertProposalAuthorizable(proposal: EmbeddingContractRepairProposal): void {
    if (proposal.mode !== 'dry-run' || !proposal.fullScan) {
        throw new EmbeddingRepairRejectedError('embedding_repair_proposal_not_authorizable');
    }
    const aggregate = proposal.evidence.aggregate;
    if (aggregate.semantic_ready > 0 || aggregate.invalid > 0 || aggregate.unclassified > 0) {
        throw new EmbeddingRepairRejectedError('embedding_repair_classification_not_authorizable');
    }
    if (proposal.replay.user.mismatched > proposal.evidence.cohorts.userVectors.quarantined
        || proposal.replay.user.inputMissing > 0
        || proposal.replay.post.mismatched > 0) {
        throw new EmbeddingRepairRejectedError('embedding_repair_replay_not_authorizable');
    }
    for (const operation of proposal.operations) {
        for (const vector of operation.expectedVectors) {
            if (vector.classification === 'semantic_ready'
                || vector.classification === 'invalid'
                || vector.classification === 'unclassified') {
                throw new EmbeddingRepairRejectedError('embedding_repair_classification_not_authorizable');
            }
        }
    }
}

function parseEvidence(value: Record<string, unknown>): void {
    assertExactKeys(value, ['aggregate', 'cohorts'], 'embedding_repair_proposal_schema_invalid');
    if (!isRecord(value.aggregate) || !isRecord(value.cohorts)) {
        throw new Error('embedding_repair_proposal_schema_invalid');
    }
    assertExactKeys(
        value.cohorts,
        ['userVectors', 'postFeatureSnapshots'],
        'embedding_repair_proposal_schema_invalid',
    );
    parseEvidenceSummary(value.aggregate);
    parseEvidenceSummary(value.cohorts.userVectors);
    parseEvidenceSummary(value.cohorts.postFeatureSnapshots);
}

function parseEvidenceSummary(value: unknown): asserts value is EmbeddingEvidenceSummary {
    if (!isRecord(value)) throw new Error('embedding_repair_proposal_schema_invalid');
    assertExactKeys(value, [...EVIDENCE_FIELDS], 'embedding_repair_proposal_schema_invalid');
    if (!EVIDENCE_FIELDS.every((field) => isNonNegativeInteger(value[field]))) {
        throw new Error('embedding_repair_proposal_schema_invalid');
    }
    const counted = Number(value.verified_local_fallback)
        + Number(value.semantic_ready)
        + Number(value.quarantined)
        + Number(value.invalid)
        + Number(value.unclassified);
    if (value.total !== counted) throw new Error('embedding_repair_evidence_count_mismatch');
}

function parseReplay(value: Record<string, unknown>): void {
    assertExactKeys(value, ['user', 'post'], 'embedding_repair_proposal_schema_invalid');
    if (!isRecord(value.user) || !isRecord(value.post)) {
        throw new Error('embedding_repair_proposal_schema_invalid');
    }
    assertExactKeys(value.user, ['matched', 'mismatched', 'inputMissing'], 'embedding_repair_proposal_schema_invalid');
    assertExactKeys(value.post, ['matched', 'mismatched'], 'embedding_repair_proposal_schema_invalid');
    if (![value.user.matched, value.user.mismatched, value.user.inputMissing,
        value.post.matched, value.post.mismatched].every(isNonNegativeInteger)) {
        throw new Error('embedding_repair_proposal_schema_invalid');
    }
}

function assertZeroWriteCounters(value: unknown): void {
    if (!isRecord(value)) throw new Error('embedding_repair_write_counters_nonzero');
    assertExactKeys(
        value,
        ['mongo', 'redis', 'scheduler', 'process', 'python'],
        'embedding_repair_write_counters_nonzero',
    );
    if (Object.values(value).some((count) => count !== 0)) {
        throw new EmbeddingRepairRejectedError('embedding_repair_write_counters_nonzero');
    }
}

function assertExactKeys(
    value: Record<string, unknown>,
    expected: readonly string[],
    error: string,
): void {
    const actual = Object.keys(value).sort(compareUtf8);
    const canonicalExpected = [...expected].sort(compareUtf8);
    if (!isDeepStrictEqual(actual, canonicalExpected)) throw new Error(error);
}

function compareOperations(
    left: Pick<EmbeddingMetadataOperation, 'collection' | 'id'>,
    right: Pick<EmbeddingMetadataOperation, 'collection' | 'id'>,
): number {
    return compareUtf8(left.collection, right.collection) || compareUtf8(left.id, right.id);
}

function compareUtf8(left: string, right: string): number {
    return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function isHash(value: unknown): value is string {
    return typeof value === 'string' && HASH_PATTERN.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
    return Number.isInteger(value) && Number(value) >= 0;
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
