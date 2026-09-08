import crypto from 'crypto';
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
    quarantineDigestFromChecksums,
    vectorChecksum,
    type EmbeddingEvidenceStatus,
    type QuarantineDigestChecksumEntry,
} from '../../../recommendation/contracts/embeddingContractEvidence';
import {
    buildDensePostEmbedding,
    type BuildDensePostEmbeddingInput,
} from '../../../recommendation/contentFeatures/denseEmbedding';
import {
    buildRegisteredUserColdStartEmbedding,
    canonicalRegisteredUserColdStartInput,
    type RegisteredUserColdStartInput,
} from '../../../recommendation/users/coldStartEmbedding';
import {
    createEmbeddingEvidenceSummary,
    type EmbeddingEvidenceSummary,
} from '../embeddingEvidenceAudit';
import {
    canonicalDigest,
    canonicalJson,
    computeProposalDigest,
    validateEmbeddingRepairProposal,
} from './artifacts';
import {
    ZERO_WRITE_COUNTERS,
    type EmbeddingContractRepairProposal,
    type EmbeddingContractRepairProposalInput,
    type EmbeddingMetadataOperation,
    type ExpectedVectorArtifact,
} from './contracts';
import {
    applyMetadataPatch,
    buildInverseMetadataPatch,
    captureMetadata,
    POST_METADATA_FIELDS,
    USER_METADATA_FIELDS,
} from './metadataPolicy';

type UserEvidenceDocument = Record<string, unknown> & {
    _id?: unknown;
    userId?: unknown;
    twoTowerEmbedding?: unknown;
    twoTowerEmbeddingContract?: EmbeddingContract | null;
    twoTowerEmbeddingQuarantineReason?: string | null;
    phoenixEmbedding?: unknown;
    phoenixEmbeddingContract?: EmbeddingContract | null;
    embeddingContract?: Partial<EmbeddingContract> | null;
    modelVersion?: unknown;
    artifactVersion?: unknown;
    modelProfile?: unknown;
    embeddingDim?: unknown;
};

type PostEvidenceDocument = Record<string, unknown> & BuildDensePostEmbeddingInput & {
    _id?: unknown;
    denseEmbedding?: unknown;
    embeddingContract?: EmbeddingContract | null;
};

type CursorQuery = {
    sort(value: { _id: 1 }): CursorQuery;
    select?(value: string): CursorQuery;
    limit(value: number): CursorQuery;
    session?(value: unknown): CursorQuery;
    lean(): CursorQuery;
    cursor(): AsyncIterable<unknown>;
};

type CursorModel = {
    find(filter: Record<string, never>): CursorQuery;
};

export interface EmbeddingRepairPlannerOptions {
    limit?: number;
    session?: unknown;
    models?: {
        userFeatureVector: unknown;
        postFeatureSnapshot: unknown;
    };
    loadUserInput?: (userId: string) => Promise<RegisteredUserColdStartInput | null>;
}

export async function planEmbeddingContractRepair(
    options: EmbeddingRepairPlannerOptions = {},
): Promise<EmbeddingContractRepairProposal> {
    const aggregate = createEmbeddingEvidenceSummary();
    const userVectors = createEmbeddingEvidenceSummary();
    const postFeatureSnapshots = createEmbeddingEvidenceSummary();
    const quarantineEntries: QuarantineDigestChecksumEntry[] = [];
    const corpusState = crypto.createHash('sha256');
    const operations: EmbeddingMetadataOperation[] = [];
    const replay = {
        user: { matched: 0, mismatched: 0, inputMissing: 0 },
        post: { matched: 0, mismatched: 0 },
    };
    const models = options.models ?? {
        userFeatureVector: UserFeatureVector,
        postFeatureSnapshot: PostFeatureSnapshot,
    };
    const loadUserInput = options.loadUserInput ?? loadRegisteredUserInput;
    let users = 0;
    let posts = 0;

    for await (const value of buildCursor(
        models.userFeatureVector,
        options.limit,
        USER_PROJECTION,
        options.session,
    )) {
        const document = value as UserEvidenceDocument;
        users += 1;
        const documentId = requireDocumentId(document);
        const userId = String(document.userId ?? '');
        // ponytail: one SQL lookup per Mongo user; batch SQL reads if this one-off repair becomes a recurring job.
        const userInput = userId ? await loadUserInput(userId) : null;
        const replayVector = userInput
            ? buildRegisteredUserColdStartEmbedding(userInput)
            : null;
        const replayInputDigest = userInput
            ? canonicalDigest(canonicalRegisteredUserColdStartInput(userInput))
            : MISSING_REPLAY_INPUT_DIGEST;
        const plannedQuarantineReason = shouldPlanServingLiteQuarantine(document, replayVector)
            ? LEGACY_SERVING_LITE_MIXED_LINEAGE_QUARANTINE_REASON
            : null;
        const effectiveQuarantineReason = plannedQuarantineReason
            ?? document.twoTowerEmbeddingQuarantineReason;
        const twoTower = analyzeUserSlot({
            document,
            field: 'twoTowerEmbedding',
            contractField: 'twoTowerEmbeddingContract',
            quarantineReason: effectiveQuarantineReason,
            replayVector,
        });
        const phoenix = analyzeUserSlot({
            document,
            field: 'phoenixEmbedding',
            contractField: 'phoenixEmbeddingContract',
            replayVector,
        });

        for (const [field, analysis] of [
            ['phoenixEmbedding', phoenix],
            ['twoTowerEmbedding', twoTower],
        ] as const) {
            accumulate([aggregate, userVectors], analysis.classification);
            if (!userInput) replay.user.inputMissing += 1;
            else if (analysis.replayMatched) replay.user.matched += 1;
            else replay.user.mismatched += 1;
            appendCorpusSlot(corpusState, {
                collection: 'user_feature_vectors',
                id: documentId,
                field,
                vectorChecksum: analysis.expectedVector?.vectorChecksum
                    ?? INVALID_VECTOR_CHECKSUM,
                classification: analysis.classification,
                replayInputDigest,
            });
        }
        if (twoTower.classification === 'quarantined' && twoTower.expectedVector) {
            quarantineEntries.push({
                userId,
                vectorChecksum: twoTower.expectedVector.vectorChecksum,
                reason: String(effectiveQuarantineReason),
            });
        }

        const set: Record<string, unknown> = {};
        if (plannedQuarantineReason) {
            set.twoTowerEmbeddingQuarantineReason = plannedQuarantineReason;
        }
        if (twoTower.repairContract) {
            set.twoTowerEmbeddingContract = { ...REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT };
        }
        if (phoenix.repairContract) {
            set.phoenixEmbeddingContract = { ...REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT };
        }
        if (Object.keys(set).length === 0 || !twoTower.expectedVector || !phoenix.expectedVector || !userInput) {
            continue;
        }

        const currentMetadata = captureMetadata(document, USER_METADATA_FIELDS);
        const patch = { set, unset: [] };
        operations.push({
            collection: 'user_feature_vectors',
            id: documentId,
            userId,
            replayInputDigest,
            expectedVectors: [phoenix.expectedVector, twoTower.expectedVector]
                .sort((left, right) => compareUtf8(left.field, right.field)),
            currentMetadata,
            expectedPostApplyMetadata: applyMetadataPatch(currentMetadata, patch),
            patch,
            restorePatch: buildInverseMetadataPatch(currentMetadata, patch),
        });
    }

    for await (const value of buildCursor(
        models.postFeatureSnapshot,
        options.limit,
        POST_PROJECTION,
        options.session,
    )) {
        const document = value as PostEvidenceDocument;
        posts += 1;
        const documentId = requireDocumentId(document);
        const replayVector = buildDensePostEmbedding(document);
        const replayMatched = vectorsEqual(document.denseEmbedding, replayVector);
        const classification = classifyEmbeddingContractEvidence({
            vector: document.denseEmbedding,
            replayContract: HEURISTIC_POST_HASH_EMBEDDING_CONTRACT,
            replayMatched,
        });
        accumulate([aggregate, postFeatureSnapshots], classification);
        if (replayMatched) replay.post.matched += 1;
        else replay.post.mismatched += 1;

        const expectedVector = buildExpectedVector(
            'denseEmbedding',
            document.denseEmbedding,
            classification,
        );
        appendCorpusSlot(corpusState, {
            collection: 'post_feature_snapshots',
            id: documentId,
            field: 'denseEmbedding',
            vectorChecksum: expectedVector?.vectorChecksum ?? INVALID_VECTOR_CHECKSUM,
            classification,
        });
        const repairContract = replayMatched
            && classification === 'verified_local_fallback'
            && !isDeepStrictEqual(document.embeddingContract, HEURISTIC_POST_HASH_EMBEDDING_CONTRACT);
        if (!repairContract || !expectedVector) continue;

        const currentMetadata = captureMetadata(document, POST_METADATA_FIELDS);
        const patch = {
            set: { embeddingContract: { ...HEURISTIC_POST_HASH_EMBEDDING_CONTRACT } },
            unset: [],
        };
        operations.push({
            collection: 'post_feature_snapshots',
            id: documentId,
            expectedVectors: [expectedVector],
            currentMetadata,
            expectedPostApplyMetadata: applyMetadataPatch(currentMetadata, patch),
            patch,
            restorePatch: buildInverseMetadataPatch(currentMetadata, patch),
        });
    }

    operations.sort((left, right) => (
        compareUtf8(left.collection, right.collection) || compareUtf8(left.id, right.id)
    ));
    const input: EmbeddingContractRepairProposalInput = {
        schemaVersion: 1,
        mode: options.limit === undefined ? 'dry-run' : 'diagnostic',
        fullScan: options.limit === undefined,
        scanned: { users, postFeatureSnapshots: posts },
        evidence: {
            aggregate,
            cohorts: { userVectors, postFeatureSnapshots },
        },
        replay,
        operations,
        corpusStateDigest: corpusState.digest('hex'),
        quarantineDigest: quarantineDigestFromChecksums(quarantineEntries),
        writeCounters: { ...ZERO_WRITE_COUNTERS },
    };
    return validateEmbeddingRepairProposal({
        ...input,
        proposalDigest: computeProposalDigest(input),
    });
}

function appendCorpusSlot(
    digest: crypto.Hash,
    slot: {
        collection: 'user_feature_vectors' | 'post_feature_snapshots';
        id: string;
        field: 'twoTowerEmbedding' | 'phoenixEmbedding' | 'denseEmbedding';
        vectorChecksum: string;
        classification: EmbeddingEvidenceStatus;
        replayInputDigest?: string;
    },
): void {
    digest.update(canonicalJson(slot), 'utf8');
    digest.update('\n', 'utf8');
}

const INVALID_VECTOR_CHECKSUM = canonicalDigest({ state: 'invalid_vector' });
const MISSING_REPLAY_INPUT_DIGEST = canonicalDigest({ state: 'missing_replay_input' });

async function loadRegisteredUserInput(
    userId: string,
): Promise<RegisteredUserColdStartInput | null> {
    const user = await User.findByPk(userId, {
        attributes: ['id', 'username', 'region', 'language'],
    });
    if (!user) return null;
    return {
        id: user.id,
        username: user.username,
        region: user.region,
        language: user.language,
    };
}

function analyzeUserSlot({
    document,
    field,
    contractField,
    quarantineReason,
    replayVector,
}: {
    document: UserEvidenceDocument;
    field: 'twoTowerEmbedding' | 'phoenixEmbedding';
    contractField: 'twoTowerEmbeddingContract' | 'phoenixEmbeddingContract';
    quarantineReason?: string | null;
    replayVector: readonly number[] | null;
}): {
    classification: EmbeddingEvidenceStatus;
    replayMatched: boolean;
    expectedVector: ExpectedVectorArtifact | null;
    repairContract: boolean;
} {
    const vector = document[field];
    const replayMatched = replayVector !== null && vectorsEqual(vector, replayVector);
    const contract = document[contractField];
    const classification = classifyEmbeddingContractEvidence({
        vector,
        perVectorContract: contract,
        legacySharedContract: document.embeddingContract,
        quarantineReason,
        ...(replayVector === null ? {} : {
            replayContract: REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
            replayMatched,
        }),
    });
    return {
        classification,
        replayMatched,
        expectedVector: buildExpectedVector(field, vector, classification),
        repairContract: replayMatched
            && classification === 'verified_local_fallback'
            && (contract === undefined || contract === null),
    };
}

function shouldPlanServingLiteQuarantine(
    document: UserEvidenceDocument,
    replayVector: readonly number[] | null,
): boolean {
    return replayVector !== null
        && document.modelVersion === '2026-04-29_kuai_lite256'
        && document.artifactVersion === '2026-04-29_kuai_lite256'
        && document.modelProfile === 'serving-lite'
        && document.embeddingDim === 256
        && Array.isArray(document.twoTowerEmbedding)
        && document.twoTowerEmbedding.length === 256
        && (document.twoTowerEmbeddingContract === undefined
            || document.twoTowerEmbeddingContract === null)
        && (document.twoTowerEmbeddingQuarantineReason === undefined
            || document.twoTowerEmbeddingQuarantineReason === null)
        && !vectorsEqual(document.twoTowerEmbedding, replayVector)
        && vectorsEqual(document.phoenixEmbedding, replayVector);
}

function buildExpectedVector(
    field: ExpectedVectorArtifact['field'],
    vector: unknown,
    classification: EmbeddingEvidenceStatus,
): ExpectedVectorArtifact | null {
    try {
        return {
            field,
            vectorChecksum: vectorChecksum(vector as number[]),
            classification,
        };
    } catch {
        return null;
    }
}

function accumulate(
    summaries: readonly EmbeddingEvidenceSummary[],
    classification: EmbeddingEvidenceStatus,
): void {
    for (const summary of summaries) {
        summary.total += 1;
        summary[classification] += 1;
    }
}

function buildCursor(
    model: unknown,
    limit: number | undefined,
    projection: string,
    session: unknown,
): AsyncIterable<unknown> {
    let query = (model as CursorModel).find({}).sort({ _id: 1 });
    if (typeof query.select === 'function') query = query.select(projection);
    if (limit !== undefined) query = query.limit(limit);
    if (session !== undefined && typeof query.session === 'function') query = query.session(session);
    return query.lean().cursor();
}

function requireDocumentId(document: { _id?: unknown }): string {
    if (document._id === undefined || document._id === null) {
        throw new Error('embedding_repair_document_id_missing');
    }
    return String(document._id);
}

function vectorsEqual(left: unknown, right: readonly number[]): boolean {
    return Array.isArray(left)
        && left.length === right.length
        && left.every((value, index) => value === right[index]);
}

function compareUtf8(left: string, right: string): number {
    return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

const USER_PROJECTION = [
    '_id',
    'userId',
    'twoTowerEmbedding',
    'twoTowerEmbeddingContract',
    'twoTowerEmbeddingQuarantineReason',
    'phoenixEmbedding',
    'phoenixEmbeddingContract',
    'embeddingContract',
    'modelVersion',
    'artifactVersion',
    'modelProfile',
    'embeddingDim',
].join(' ');

const POST_PROJECTION = [
    '_id',
    'denseEmbedding',
    'embeddingContract',
    'keywordScores',
    'clusterScores',
    'authorProducerClusters',
    'authorKnownForCluster',
    'engagementBucket',
    'freshnessBucket',
    'hasMedia',
    'mediaTypes',
    'language',
].join(' ');
