import { isDeepStrictEqual } from 'util';

import {
    HEURISTIC_POST_HASH_EMBEDDING_CONTRACT,
    REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
} from '../../../recommendation/contracts/embeddingContract';
import {
    LEGACY_SERVING_LITE_MIXED_LINEAGE_QUARANTINE_REASON,
    isCompleteEmbeddingContract,
} from '../../../recommendation/contracts/embeddingContractEvidence';
import type {
    EmbeddingMetadataOperation,
    EmbeddingRepairCollection,
    MetadataPatch,
} from './contracts';

const USER_WRITABLE_METADATA = new Set([
    'twoTowerEmbeddingContract',
    'twoTowerEmbeddingQuarantineReason',
    'phoenixEmbeddingContract',
]);
const USER_OBSERVED_METADATA = new Set([
    ...USER_WRITABLE_METADATA,
    'embeddingContract',
]);
const POST_WRITABLE_METADATA = new Set(['embeddingContract']);
const VECTOR_FIELDS = new Set([
    'twoTowerEmbedding',
    'phoenixEmbedding',
    'denseEmbedding',
]);

export function assertMetadataOnlyOperations(
    operations: readonly EmbeddingMetadataOperation[],
): void {
    for (const operation of operations) {
        assertMetadataOperation(operation);
    }
}

export function assertMetadataOperation(operation: EmbeddingMetadataOperation): void {
    assertMetadataObject(operation.collection, operation.currentMetadata, false);
    assertMetadataObject(operation.collection, operation.expectedPostApplyMetadata, false);
    assertMetadataPatch(operation.collection, operation.patch, { direction: 'forward' });
    assertMetadataPatch(operation.collection, operation.restorePatch, { direction: 'restore' });

    if (Object.keys(operation.patch.set).length === 0 && operation.patch.unset.length === 0) {
        throw new Error('embedding_repair_metadata_patch_empty');
    }
    const expected = applyMetadataPatch(operation.currentMetadata, operation.patch);
    if (!isDeepStrictEqual(expected, operation.expectedPostApplyMetadata)) {
        throw new Error('embedding_repair_expected_metadata_mismatch');
    }
    const restored = applyMetadataPatch(operation.expectedPostApplyMetadata, operation.restorePatch);
    if (!isDeepStrictEqual(restored, operation.currentMetadata)) {
        throw new Error('embedding_repair_restore_patch_mismatch');
    }
}

export function assertMetadataPatch(
    collection: EmbeddingRepairCollection,
    patch: MetadataPatch,
    options: { direction?: 'forward' | 'restore' } = {},
): void {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)
        || !isRecord(patch.set) || !Array.isArray(patch.unset)) {
        throw new Error('embedding_repair_metadata_patch_invalid');
    }

    const setFields = Object.keys(patch.set);
    const unsetFields = patch.unset;
    if (!unsetFields.every((field) => typeof field === 'string')) {
        throw new Error('embedding_repair_metadata_patch_invalid');
    }
    if (new Set(unsetFields).size !== unsetFields.length) {
        throw new Error('embedding_repair_metadata_unset_duplicate');
    }

    for (const field of [...setFields, ...unsetFields]) {
        if (options.direction !== 'restore'
            && field.endsWith('QuarantineReason')
            && (collection !== 'user_feature_vectors'
                || field !== 'twoTowerEmbeddingQuarantineReason'
                || !hasOwn(patch.set, field)
                || patch.set[field] !== LEGACY_SERVING_LITE_MIXED_LINEAGE_QUARANTINE_REASON)) {
            throw new Error('embedding_repair_quarantine_forward_write_forbidden');
        }
        assertMetadataField(collection, field, true);
    }
    for (const field of setFields) {
        if (unsetFields.includes(field)) {
            throw new Error(`embedding_repair_metadata_patch_overlap:${field}`);
        }
        if (options.direction !== 'restore') {
            assertMetadataValue(collection, field, patch.set[field]);
        }
    }
}

export function assertMetadataSnapshot(
    collection: EmbeddingRepairCollection,
    metadata: Record<string, unknown>,
): void {
    assertMetadataObject(collection, metadata, false);
}

export function applyMetadataPatch(
    metadata: Record<string, unknown>,
    patch: MetadataPatch,
): Record<string, unknown> {
    const result = structuredClone(metadata);
    for (const [field, value] of Object.entries(patch.set)) {
        result[field] = structuredClone(value);
    }
    for (const field of patch.unset) {
        delete result[field];
    }
    return result;
}

export function buildInverseMetadataPatch(
    currentMetadata: Record<string, unknown>,
    patch: MetadataPatch,
): MetadataPatch {
    const set: Record<string, unknown> = {};
    const unset: string[] = [];
    for (const field of Object.keys(patch.set)) {
        if (hasOwn(currentMetadata, field)) {
            set[field] = structuredClone(currentMetadata[field]);
        } else {
            unset.push(field);
        }
    }
    for (const field of patch.unset) {
        if (hasOwn(currentMetadata, field)) {
            set[field] = structuredClone(currentMetadata[field]);
        }
    }
    unset.sort(compareUtf8);
    return { set, unset };
}

export function captureMetadata(
    document: Record<string, unknown>,
    fields: readonly string[],
): Record<string, unknown> {
    const metadata: Record<string, unknown> = {};
    for (const field of fields) {
        if (hasOwn(document, field) && document[field] !== undefined) {
            metadata[field] = structuredClone(document[field]);
        }
    }
    return metadata;
}

export const USER_METADATA_FIELDS = [...USER_OBSERVED_METADATA] as readonly string[];
export const POST_METADATA_FIELDS = [...POST_WRITABLE_METADATA] as readonly string[];

function assertMetadataObject(
    collection: EmbeddingRepairCollection,
    metadata: Record<string, unknown>,
    writable: boolean,
): void {
    if (!isRecord(metadata)) throw new Error('embedding_repair_metadata_invalid');
    for (const [field, value] of Object.entries(metadata)) {
        assertMetadataField(collection, field, writable);
        if (writable) assertMetadataValue(collection, field, value);
    }
}

function assertMetadataField(
    collection: EmbeddingRepairCollection,
    field: string,
    writable: boolean,
): void {
    if (field.includes('.')) {
        throw new Error(`embedding_repair_metadata_dotted_path_forbidden:${field}`);
    }
    if (VECTOR_FIELDS.has(field)) {
        throw new Error(`embedding_repair_vector_field_forbidden:${field}`);
    }
    if (collection === 'user_feature_vectors') {
        if (field === 'embeddingContract' && writable) {
            throw new Error('embedding_repair_legacy_contract_write_forbidden');
        }
        const allowed = writable ? USER_WRITABLE_METADATA : USER_OBSERVED_METADATA;
        if (!allowed.has(field)) {
            throw new Error(`embedding_repair_metadata_field_forbidden:${field}`);
        }
        return;
    }
    if (collection === 'post_feature_snapshots' && POST_WRITABLE_METADATA.has(field)) return;
    throw new Error(`embedding_repair_metadata_field_forbidden:${field}`);
}

function assertMetadataValue(
    collection: EmbeddingRepairCollection,
    field: string,
    value: unknown,
): void {
    if (field.endsWith('QuarantineReason')) {
        if (typeof value !== 'string' || value.length === 0) {
            throw new Error('embedding_repair_quarantine_reason_invalid');
        }
        return;
    }
    if (!isCompleteEmbeddingContract(value)) {
        throw new Error(`embedding_repair_contract_incomplete:${field}`);
    }
    const expected = collection === 'post_feature_snapshots'
        ? HEURISTIC_POST_HASH_EMBEDDING_CONTRACT
        : REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT;
    if (!isDeepStrictEqual(value, expected)) {
        throw new Error(`embedding_repair_contract_not_allowed:${field}`);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: object, field: PropertyKey): boolean {
    return Object.prototype.hasOwnProperty.call(value, field);
}

function compareUtf8(left: string, right: string): number {
    return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}
