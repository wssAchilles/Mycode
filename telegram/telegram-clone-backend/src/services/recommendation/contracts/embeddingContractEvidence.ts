import crypto from 'crypto';

import {
    HEURISTIC_POST_HASH_EMBEDDING_CONTRACT,
    REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
    isVectorCompatibleWithContract,
    type EmbeddingContract,
} from './embeddingContract';

export type EmbeddingEvidenceStatus =
    | 'verified_local_fallback'
    | 'semantic_ready'
    | 'quarantined'
    | 'invalid'
    | 'unclassified';

export const LEGACY_SERVING_LITE_MIXED_LINEAGE_QUARANTINE_REASON =
    'legacy_serving_lite_mixed_lineage_v1';

export interface EmbeddingContractEvidenceInput {
    vector: unknown;
    perVectorContract?: EmbeddingContract | null;
    legacySharedContract?: Partial<EmbeddingContract> | null;
    quarantineReason?: string | null;
    replayContract?: EmbeddingContract | null;
    replayMatched?: boolean;
}

export interface QuarantineDigestEntry {
    userId: string;
    vector: readonly number[];
    reason: string;
}

const KNOWN_LOCAL_CONTRACTS = [
    REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
    HEURISTIC_POST_HASH_EMBEDDING_CONTRACT,
];

export function classifyEmbeddingContractEvidence(
    input: EmbeddingContractEvidenceInput,
): EmbeddingEvidenceStatus {
    if (input.replayMatched === false || !isFiniteVector(input.vector)) {
        return 'invalid';
    }

    if (input.quarantineReason !== undefined && input.quarantineReason !== null) {
        return input.quarantineReason === LEGACY_SERVING_LITE_MIXED_LINEAGE_QUARANTINE_REASON
            && !input.perVectorContract
            ? 'quarantined'
            : 'invalid';
    }

    if (input.perVectorContract !== undefined && input.perVectorContract !== null) {
        if (!isCompleteEmbeddingContract(input.perVectorContract)
            || !isVectorCompatibleWithContract(input.vector, input.perVectorContract)) {
            return 'invalid';
        }
        return isKnownLocalContract(input.perVectorContract)
            ? 'verified_local_fallback'
            : 'unclassified';
    }

    if (input.replayContract !== undefined && input.replayContract !== null) {
        if (input.replayMatched !== true
            || !isCompleteEmbeddingContract(input.replayContract)
            || !isVectorCompatibleWithContract(input.vector, input.replayContract)) {
            return 'invalid';
        }
        return isKnownLocalContract(input.replayContract)
            ? 'verified_local_fallback'
            : 'unclassified';
    }

    if (input.legacySharedContract
        && legacyContractConflictsWithVector(input.vector, input.legacySharedContract)) {
        return 'invalid';
    }

    return 'unclassified';
}

export function vectorChecksum(vector: readonly number[]): string {
    if (!isFiniteVector(vector)) {
        throw new Error('invalid_vector');
    }

    const bytes = Buffer.allocUnsafe(4 + vector.length * 8);
    bytes.writeUInt32BE(vector.length, 0);
    vector.forEach((value, index) => bytes.writeDoubleBE(value, 4 + index * 8));
    return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function quarantineDigest(entries: readonly QuarantineDigestEntry[]): string {
    const rows = entries.map((entry) => {
        const userId = Buffer.from(entry.userId, 'utf8');
        const row = Buffer.concat([
            userId,
            Buffer.from([0]),
            Buffer.from(vectorChecksum(entry.vector), 'utf8'),
            Buffer.from([0]),
            Buffer.from(entry.reason, 'utf8'),
        ]);
        return { userId, row };
    });
    rows.sort((left, right) => (
        Buffer.compare(left.userId, right.userId) || Buffer.compare(left.row, right.row)
    ));

    return crypto.createHash('sha256')
        .update(Buffer.concat(rows.flatMap(({ row }, index) => (
            index === 0 ? [row] : [Buffer.from('\n'), row]
        ))))
        .digest('hex');
}

function isKnownLocalContract(contract: EmbeddingContract): boolean {
    return KNOWN_LOCAL_CONTRACTS.some((known) => (
        contract.embeddingSpace === known.embeddingSpace
        && (contract.dimensions === undefined || contract.dimensions === known.dimensions)
        && contract.retrievalEmbeddingDim === known.retrievalEmbeddingDim
        && contract.rankingEmbeddingDim === known.rankingEmbeddingDim
        && contract.modelVersion === known.modelVersion
        && contract.artifactVersion === known.artifactVersion
        && contract.producer === known.producer
        && contract.semantic === known.semantic
    ));
}

function isCompleteEmbeddingContract(contract: unknown): contract is EmbeddingContract {
    if (!contract || typeof contract !== 'object') return false;
    const candidate = contract as Partial<EmbeddingContract>;
    return isNonEmptyString(candidate.embeddingSpace)
        && isPositiveDimension(candidate.retrievalEmbeddingDim)
        && isPositiveDimension(candidate.rankingEmbeddingDim)
        && isNonEmptyString(candidate.modelVersion)
        && isNonEmptyString(candidate.artifactVersion)
        && isNonEmptyString(candidate.producer)
        && typeof candidate.semantic === 'boolean'
        && (candidate.dimensions === undefined
            || (isPositiveDimension(candidate.dimensions)
                && candidate.dimensions === candidate.retrievalEmbeddingDim));
}

function legacyContractConflictsWithVector(
    vector: unknown,
    contract: Partial<EmbeddingContract>,
): boolean {
    if (!Array.isArray(vector)) return true;
    return [contract.retrievalEmbeddingDim, contract.dimensions].some((dimension) => (
        dimension !== undefined
        && (!isPositiveDimension(dimension) || dimension !== vector.length)
    ));
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function isPositiveDimension(value: unknown): value is number {
    return Number.isInteger(value) && Number(value) > 0;
}

function isFiniteVector(vector: unknown): vector is number[] {
    return Array.isArray(vector)
        && vector.length > 0
        && vector.every((value) => typeof value === 'number' && Number.isFinite(value));
}
