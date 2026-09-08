import PostFeatureSnapshot from '../../../models/PostFeatureSnapshot';
import UserFeatureVector from '../../../models/UserFeatureVector';
import {
    HEURISTIC_POST_HASH_EMBEDDING_CONTRACT,
    type EmbeddingContract,
} from '../../recommendation/contracts/embeddingContract';
import {
    classifyEmbeddingContractEvidence,
    quarantineDigestFromChecksums,
    vectorChecksum,
    type EmbeddingContractEvidenceInput,
    type EmbeddingEvidenceStatus,
    type QuarantineDigestChecksumEntry,
} from '../../recommendation/contracts/embeddingContractEvidence';
import {
    buildDensePostEmbedding,
    type BuildDensePostEmbeddingInput,
} from '../../recommendation/contentFeatures/denseEmbedding';

export interface EmbeddingEvidenceSummary {
    total: number;
    verified_local_fallback: number;
    semantic_ready: number;
    quarantined: number;
    invalid: number;
    unclassified: number;
}

export interface PersistedEmbeddingEvidenceSummary extends EmbeddingEvidenceSummary {
    cohorts: {
        userVectors: EmbeddingEvidenceSummary;
        postFeatureSnapshots: EmbeddingEvidenceSummary;
    };
    quarantineDigest: string;
    scan: {
        userDocuments: number;
        postFeatureSnapshots: number;
        mode: 'full' | 'limited';
        limit: number | null;
        diagnosticOnly: boolean;
        ordering: '_id_ascending';
    };
}

export interface EmbeddingEvidenceScanResult {
    embeddingEvidence: PersistedEmbeddingEvidenceSummary;
}

type UserEmbeddingEvidenceDocument = {
    userId?: unknown;
    twoTowerEmbedding?: unknown;
    twoTowerEmbeddingContract?: EmbeddingContract | null;
    twoTowerEmbeddingQuarantineReason?: string | null;
    phoenixEmbedding?: unknown;
    phoenixEmbeddingContract?: EmbeddingContract | null;
    embeddingContract?: Partial<EmbeddingContract> | null;
};

type PostEmbeddingEvidenceDocument = BuildDensePostEmbeddingInput & {
    denseEmbedding?: unknown;
    embeddingContract?: Partial<EmbeddingContract> | null;
};

type CursorQuery = {
    sort(value: { _id: 1 }): CursorQuery;
    limit(value: number): CursorQuery;
    session?(value: unknown): CursorQuery;
    lean(): CursorQuery;
    cursor(): AsyncIterable<unknown>;
};

type ScanModel = {
    find(filter: Record<string, never>): CursorQuery;
};

export function createEmbeddingEvidenceSummary(): EmbeddingEvidenceSummary {
    return {
        total: 0,
        verified_local_fallback: 0,
        semantic_ready: 0,
        quarantined: 0,
        invalid: 0,
        unclassified: 0,
    };
}

export function accumulateEmbeddingEvidence(
    summary: EmbeddingEvidenceSummary,
    input: EmbeddingContractEvidenceInput,
): EmbeddingEvidenceStatus {
    return classifyAndAccumulate([summary], input);
}

export function accumulatePostEmbeddingEvidence(
    summary: EmbeddingEvidenceSummary,
    document: PostEmbeddingEvidenceDocument,
): EmbeddingEvidenceStatus {
    return accumulatePostEmbeddingEvidenceInto([summary], document);
}

export function isFullEmbeddingEvidenceSummary(
    value: unknown,
): value is PersistedEmbeddingEvidenceSummary {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const evidence = value as Record<string, unknown>;
    const aggregate = readEvidenceSummary(evidence);
    const cohorts = readRecord(evidence.cohorts);
    const userVectors = readEvidenceSummary(readRecord(cohorts.userVectors));
    const postFeatureSnapshots = readEvidenceSummary(readRecord(cohorts.postFeatureSnapshots));
    const scan = readRecord(evidence.scan);
    if (!aggregate
        || !userVectors
        || !postFeatureSnapshots
        || aggregate.semantic_ready !== 0
        || userVectors.semantic_ready !== 0
        || postFeatureSnapshots.semantic_ready !== 0
        || typeof evidence.quarantineDigest !== 'string'
        || !/^[a-f0-9]{64}$/.test(evidence.quarantineDigest)
        || !isNonNegativeInteger(scan.userDocuments)
        || !isNonNegativeInteger(scan.postFeatureSnapshots)
        || scan.mode !== 'full'
        || scan.limit !== null
        || scan.diagnosticOnly !== false
        || scan.ordering !== '_id_ascending'
        || userVectors.total !== scan.userDocuments * 2
        || postFeatureSnapshots.total !== scan.postFeatureSnapshots) {
        return false;
    }
    return EVIDENCE_COUNT_FIELDS.every((field) => (
        aggregate[field] === userVectors[field] + postFeatureSnapshots[field]
    ));
}

function accumulatePostEmbeddingEvidenceInto(
    summaries: readonly EmbeddingEvidenceSummary[],
    document: PostEmbeddingEvidenceDocument,
): EmbeddingEvidenceStatus {
    const replay = buildDensePostEmbedding(document);
    return classifyAndAccumulate(summaries, {
        vector: document.denseEmbedding,
        perVectorContract: document.embeddingContract as EmbeddingContract | null | undefined,
        replayContract: HEURISTIC_POST_HASH_EMBEDDING_CONTRACT,
        replayMatched: vectorsEqual(document.denseEmbedding, replay),
    });
}

export async function scanEmbeddingContractEvidence(options: {
    limit?: number;
    session?: unknown;
    models?: {
        userFeatureVector: unknown;
        postFeatureSnapshot: unknown;
    };
} = {}): Promise<EmbeddingEvidenceScanResult> {
    const summary = createEmbeddingEvidenceSummary();
    const userVectors = createEmbeddingEvidenceSummary();
    const postFeatureSnapshotsSummary = createEmbeddingEvidenceSummary();
    const quarantineEntries: QuarantineDigestChecksumEntry[] = [];
    const limit = options.limit;
    const models = options.models ?? {
        userFeatureVector: UserFeatureVector,
        postFeatureSnapshot: PostFeatureSnapshot,
    };
    let userDocuments = 0;
    let postFeatureSnapshots = 0;

    for await (const value of buildCursor(models.userFeatureVector, limit, options.session)) {
        const document = value as UserEmbeddingEvidenceDocument;
        userDocuments += 1;
        const twoTowerStatus = classifyAndAccumulate([summary, userVectors], {
            vector: document.twoTowerEmbedding,
            perVectorContract: document.twoTowerEmbeddingContract,
            legacySharedContract: document.embeddingContract,
            quarantineReason: document.twoTowerEmbeddingQuarantineReason,
        });
        if (twoTowerStatus === 'quarantined' && Array.isArray(document.twoTowerEmbedding)) {
            quarantineEntries.push({
                userId: String(document.userId ?? ''),
                vectorChecksum: vectorChecksum(document.twoTowerEmbedding as number[]),
                reason: String(document.twoTowerEmbeddingQuarantineReason),
            });
        }
        classifyAndAccumulate([summary, userVectors], {
            vector: document.phoenixEmbedding,
            perVectorContract: document.phoenixEmbeddingContract,
            legacySharedContract: document.embeddingContract,
        });
    }

    for await (const value of buildCursor(models.postFeatureSnapshot, limit, options.session)) {
        postFeatureSnapshots += 1;
        accumulatePostEmbeddingEvidenceInto(
            [summary, postFeatureSnapshotsSummary],
            value as PostEmbeddingEvidenceDocument,
        );
    }

    return {
        embeddingEvidence: {
            ...summary,
            cohorts: {
                userVectors,
                postFeatureSnapshots: postFeatureSnapshotsSummary,
            },
            quarantineDigest: quarantineDigestFromChecksums(quarantineEntries),
            scan: {
                userDocuments,
                postFeatureSnapshots,
                mode: limit === undefined ? 'full' : 'limited',
                limit: limit ?? null,
                diagnosticOnly: limit !== undefined,
                ordering: '_id_ascending',
            },
        },
    };
}

const EVIDENCE_COUNT_FIELDS = [
    'total',
    'verified_local_fallback',
    'semantic_ready',
    'quarantined',
    'invalid',
    'unclassified',
] as const;

function classifyAndAccumulate(
    summaries: readonly EmbeddingEvidenceSummary[],
    input: EmbeddingContractEvidenceInput,
): EmbeddingEvidenceStatus {
    const status = classifyEmbeddingContractEvidence(input);
    for (const summary of summaries) {
        summary.total += 1;
        summary[status] += 1;
    }
    return status;
}

function readEvidenceSummary(value: Record<string, unknown>): EmbeddingEvidenceSummary | null {
    const summary = EVIDENCE_COUNT_FIELDS.reduce<Record<string, number>>((result, field) => {
        if (isNonNegativeInteger(value[field])) result[field] = value[field];
        return result;
    }, {});
    if (Object.keys(summary).length !== EVIDENCE_COUNT_FIELDS.length) return null;
    const typed = summary as unknown as EmbeddingEvidenceSummary;
    const counted = typed.verified_local_fallback
        + typed.semantic_ready
        + typed.quarantined
        + typed.invalid
        + typed.unclassified;
    return typed.total === counted ? typed : null;
}

function readRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function isNonNegativeInteger(value: unknown): value is number {
    return Number.isInteger(value) && Number(value) >= 0;
}

function buildCursor(
    model: unknown,
    limit: number | undefined,
    session: unknown,
): AsyncIterable<unknown> {
    let query = (model as ScanModel).find({}).sort({ _id: 1 });
    if (limit !== undefined) query = query.limit(limit);
    if (session !== undefined) {
        if (typeof query.session !== 'function') {
            throw new Error('embedding_audit_snapshot_session_unsupported');
        }
        query = query.session(session);
    }
    return query.lean().cursor();
}

function vectorsEqual(left: unknown, right: readonly number[]): boolean {
    return Array.isArray(left)
        && left.length === right.length
        && left.every((value, index) => value === right[index]);
}
