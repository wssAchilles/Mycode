import { describe, expect, it, vi } from 'vitest';

import {
    LEGACY_SERVING_LITE_MIXED_LINEAGE_QUARANTINE_REASON,
} from '../../src/services/recommendation/contracts/embeddingContractEvidence';
import {
    HEURISTIC_POST_HASH_EMBEDDING_CONTRACT,
    REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
} from '../../src/services/recommendation/contracts/embeddingContract';
import { buildDensePostEmbedding } from '../../src/services/recommendation/contentFeatures/denseEmbedding';
import {
    accumulateEmbeddingEvidence,
    accumulatePostEmbeddingEvidence,
    createEmbeddingEvidenceSummary,
    scanEmbeddingContractEvidence,
} from '../../src/services/ops/recommendation/embeddingEvidenceAudit';

describe('embeddingEvidenceAudit', () => {
    it('increments the shared five-state summary without inventing semantic evidence', () => {
        const summary = createEmbeddingEvidenceSummary();
        const localVector = vector(REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT.retrievalEmbeddingDim);

        accumulateEmbeddingEvidence(summary, {
            vector: localVector,
            perVectorContract: REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
        });
        accumulateEmbeddingEvidence(summary, {
            vector: localVector,
            quarantineReason: LEGACY_SERVING_LITE_MIXED_LINEAGE_QUARANTINE_REASON,
        });
        accumulateEmbeddingEvidence(summary, {
            vector: [],
        });
        accumulateEmbeddingEvidence(summary, {
            vector: [1, 2],
        });

        expect(summary).toEqual({
            total: 4,
            verified_local_fallback: 1,
            semantic_ready: 0,
            quarantined: 1,
            invalid: 1,
            unclassified: 1,
        });
    });

    it('marks deterministic post replay mismatch invalid', () => {
        const summary = createEmbeddingEvidenceSummary();
        const snapshot = postSnapshot();

        expect(accumulatePostEmbeddingEvidence(summary, {
            ...snapshot,
            denseEmbedding: snapshot.denseEmbedding.map((value, index) => index === 0 ? value + 1 : value),
        })).toBe('invalid');
        expect(summary.invalid).toBe(1);
        expect(summary.semantic_ready).toBe(0);
    });

    it('does not let a matching replay override an unknown persisted post contract', () => {
        const summary = createEmbeddingEvidenceSummary();
        const snapshot = postSnapshot();

        expect(accumulatePostEmbeddingEvidence(summary, {
            ...snapshot,
            embeddingContract: {
                ...HEURISTIC_POST_HASH_EMBEDDING_CONTRACT,
                embeddingSpace: 'remote_post_embedding_v1',
                modelVersion: 'remote_model_v1',
                artifactVersion: 'remote_artifact_v1',
                producer: 'remote-predictor',
                semantic: true,
            },
        })).toBe('unclassified');
    });

    it('supports incremental accumulation into one bounded summary', () => {
        const summary = createEmbeddingEvidenceSummary();
        const snapshot = postSnapshot();

        expect(accumulatePostEmbeddingEvidence(summary, snapshot)).toBe('verified_local_fallback');
        accumulateEmbeddingEvidence(summary, { vector: [0.5] });
        accumulateEmbeddingEvidence(summary, { vector: [0.25] });

        expect(summary.total).toBe(3);
        expect(summary.verified_local_fallback).toBe(1);
        expect(summary.unclassified).toBe(2);
        expect(summary.semantic_ready).toBe(0);
    });

    it('uses ascending _id cursors and does not apply a limit to a full scan', async () => {
        const user = mongoSource([{
            userId: 'user-1',
            twoTowerEmbedding: vector(REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT.retrievalEmbeddingDim),
            twoTowerEmbeddingContract: REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
            phoenixEmbedding: vector(REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT.retrievalEmbeddingDim),
            phoenixEmbeddingContract: REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
        }]);
        const post = mongoSource([postSnapshot()]);

        const result = await scanEmbeddingContractEvidence({
            limit: undefined,
            models: {
                userFeatureVector: user.model,
                postFeatureSnapshot: post.model,
            },
        });

        expect(user.query.sort).toHaveBeenCalledWith({ _id: 1 });
        expect(post.query.sort).toHaveBeenCalledWith({ _id: 1 });
        expect(user.query.limit).not.toHaveBeenCalled();
        expect(post.query.limit).not.toHaveBeenCalled();
        expect(user.session).not.toHaveBeenCalled();
        expect(post.session).not.toHaveBeenCalled();
        expect(result.embeddingEvidence.scan).toMatchObject({
            userDocuments: 1,
            postFeatureSnapshots: 1,
            mode: 'full',
            diagnosticOnly: false,
        });
        expect(result.embeddingEvidence.total).toBe(3);
        expect(result.embeddingEvidence.cohorts).toEqual({
            userVectors: {
                total: 2,
                verified_local_fallback: 2,
                semantic_ready: 0,
                quarantined: 0,
                invalid: 0,
                unclassified: 0,
            },
            postFeatureSnapshots: {
                total: 1,
                verified_local_fallback: 1,
                semantic_ready: 0,
                quarantined: 0,
                invalid: 0,
                unclassified: 0,
            },
        });
    });

    it('binds both collection cursors to the same snapshot session', async () => {
        const user = mongoSource([]);
        const post = mongoSource([]);
        const session = { id: 'snapshot-session' };

        await scanEmbeddingContractEvidence({
            session,
            models: {
                userFeatureVector: user.model,
                postFeatureSnapshot: post.model,
            },
        });

        expect(user.session).toHaveBeenCalledOnce();
        expect(user.session).toHaveBeenCalledWith(session);
        expect(post.session).toHaveBeenCalledOnce();
        expect(post.session).toHaveBeenCalledWith(session);
    });

    it('fails closed when a required snapshot session cannot bind to a query', async () => {
        const user = mongoSource([]);
        const post = mongoSource([], { supportsSession: false });

        await expect(scanEmbeddingContractEvidence({
            session: { id: 'snapshot-session' },
            models: {
                userFeatureVector: user.model,
                postFeatureSnapshot: post.model,
            },
        })).rejects.toThrow('embedding_audit_snapshot_session_unsupported');
    });
});

function postSnapshot() {
    const input = {
        keywordScores: [{ keyword: 'rust', weight: 0.8 }],
        clusterScores: [{ clusterId: 7, score: 0.9 }],
        authorProducerClusters: [{ clusterId: 11, score: 0.6 }],
        authorKnownForCluster: 11,
        engagementBucket: 'high' as const,
        freshnessBucket: 'hours_24' as const,
        hasMedia: true,
        mediaTypes: ['image'],
        language: 'en',
    };
    return {
        ...input,
        denseEmbedding: buildDensePostEmbedding(input),
        embeddingContract: HEURISTIC_POST_HASH_EMBEDDING_CONTRACT,
    };
}

function vector(dimensions: number): number[] {
    return Array.from({ length: dimensions }, (_, index) => index / dimensions);
}

function mongoSource(
    documents: unknown[],
    options: { supportsSession?: boolean } = {},
) {
    const session = vi.fn().mockReturnThis();
    const query = {
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        lean: vi.fn().mockReturnThis(),
        cursor: vi.fn(() => ({
            async *[Symbol.asyncIterator]() {
                for (const document of documents) yield document;
            },
        })),
        ...(options.supportsSession === false ? {} : { session }),
    };
    return {
        model: { find: vi.fn(() => query) },
        query,
        session,
    };
}
