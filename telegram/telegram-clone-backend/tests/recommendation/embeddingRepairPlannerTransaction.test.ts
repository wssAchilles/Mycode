import { describe, expect, it, vi } from 'vitest';

import {
    createEmbeddingMetadataBackup,
    computeProposalDigest,
} from '../../src/services/ops/recommendation/embeddingRepair/artifacts';
import {
    planEmbeddingContractRepair,
} from '../../src/services/ops/recommendation/embeddingRepair/planner';
import {
    applyApprovedProposal,
    rollbackApprovedBackup,
    type EmbeddingRepairTransactionDependencies,
} from '../../src/services/ops/recommendation/embeddingRepair/transactionAdapter';
import {
    buildRegisteredUserColdStartEmbedding,
} from '../../src/services/recommendation/users/coldStartEmbedding';
import {
    buildDensePostEmbedding,
} from '../../src/services/recommendation/contentFeatures/denseEmbedding';
import {
    LEGACY_SERVING_LITE_MIXED_LINEAGE_QUARANTINE_REASON,
} from '../../src/services/recommendation/contracts/embeddingContractEvidence';
import {
    REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
} from '../../src/services/recommendation/contracts/embeddingContract';

const userInput = {
    id: 'user-1',
    username: 'registered_user',
    region: 'CN',
    language: 'zh',
};

const invalidAuthorizationChronology = [
    ['proposal approval before writer pause', 'proposalApproval', 'approvedAt', '2026-07-12T22:59:00.000Z'],
    ['backup approval before writer pause', 'backupApproval', 'approvedAt', '2026-07-12T22:59:00.000Z'],
    ['production authorization before proposal approval', 'proposalApproval', 'approvedAt', '2026-07-12T23:01:00.000Z'],
    ['production authorization before backup approval', 'backupApproval', 'approvedAt', '2026-07-12T23:01:00.000Z'],
] as const;

describe('embedding repair planner', () => {
    it('uses exact shared cold-start and post replay with uncapped ascending cursors', async () => {
        const cold = buildRegisteredUserColdStartEmbedding(userInput);
        const post = postDocument();
        const users = mongoSource([{
            _id: 'user-vector-1',
            userId: userInput.id,
            twoTowerEmbedding: cold,
            phoenixEmbedding: cold,
            phoenixEmbeddingContract: REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
            embeddingContract: { legacy: true },
        }]);
        const posts = mongoSource([post]);

        const proposal = await planEmbeddingContractRepair({
            models: {
                userFeatureVector: users.model,
                postFeatureSnapshot: posts.model,
            },
            loadUserInput: vi.fn().mockResolvedValue(userInput),
        });

        expect(users.query.sort).toHaveBeenCalledWith({ _id: 1 });
        expect(posts.query.sort).toHaveBeenCalledWith({ _id: 1 });
        expect(users.query.limit).not.toHaveBeenCalled();
        expect(posts.query.limit).not.toHaveBeenCalled();
        expect(proposal).toMatchObject({
            mode: 'dry-run',
            fullScan: true,
            scanned: { users: 1, postFeatureSnapshots: 1 },
            replay: {
                user: { matched: 2, mismatched: 0, inputMissing: 0 },
                post: { matched: 1, mismatched: 0 },
            },
            writeCounters: { mongo: 0, redis: 0, scheduler: 0, process: 0, python: 0 },
        });
        expect(proposal.operations).toHaveLength(2);
        expect(proposal.operations[1].expectedVectors.map(({ field }) => field))
            .toEqual(['phoenixEmbedding', 'twoTowerEmbedding']);
        expect(proposal.operations[1].patch.set).toEqual({
            twoTowerEmbeddingContract: REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
        });
        expect(proposal.operations[1].currentMetadata).toHaveProperty('embeddingContract');
        expect(JSON.stringify(proposal)).not.toContain(JSON.stringify(cold));
        expect(JSON.stringify(proposal)).not.toContain(JSON.stringify(post.denseEmbedding));
    });

    it('uses a limit only for non-authorizable diagnostic proposals', async () => {
        const users = mongoSource([]);
        const posts = mongoSource([]);

        const proposal = await planEmbeddingContractRepair({
            limit: 5,
            models: {
                userFeatureVector: users.model,
                postFeatureSnapshot: posts.model,
            },
            loadUserInput: vi.fn(),
        });

        expect(users.query.limit).toHaveBeenCalledWith(5);
        expect(posts.query.limit).toHaveBeenCalledWith(5);
        expect(proposal).toMatchObject({ mode: 'diagnostic', fullScan: false });
    });

    it('does not infer lineage for quarantine, unknown contracts, or post replay mismatch', async () => {
        const cold = buildRegisteredUserColdStartEmbedding(userInput);
        const unknownContract = {
            ...REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
            producer: 'unknown-writer',
        };
        const post = postDocument();
        const users = mongoSource([{
            _id: 'user-vector-1',
            userId: userInput.id,
            twoTowerEmbedding: cold,
            twoTowerEmbeddingQuarantineReason: LEGACY_SERVING_LITE_MIXED_LINEAGE_QUARANTINE_REASON,
            phoenixEmbedding: cold,
            phoenixEmbeddingContract: unknownContract,
        }]);
        const posts = mongoSource([{
            ...post,
            language: 'drifted-language',
        }]);

        const proposal = await planEmbeddingContractRepair({
            models: {
                userFeatureVector: users.model,
                postFeatureSnapshot: posts.model,
            },
            loadUserInput: vi.fn().mockResolvedValue(userInput),
        });

        expect(proposal.operations).toEqual([]);
        expect(proposal.evidence.aggregate).toMatchObject({
            quarantined: 1,
            unclassified: 1,
            invalid: 1,
        });
        expect(proposal.replay).toMatchObject({
            user: { matched: 2, mismatched: 0 },
            post: { matched: 0, mismatched: 1 },
        });
    });
});

describe('embedding repair transaction adapter', () => {
    it.each([
        ['either user slot checksum', (state: Awaited<ReturnType<typeof transactionFixture>>) => {
            state.documents.user_feature_vectors['user-vector-1'].twoTowerEmbedding[0] += 0.01;
        }, 'embedding_repair_vector_drift'],
        ['post replay', (state: Awaited<ReturnType<typeof transactionFixture>>) => {
            state.documents.post_feature_snapshots['post-1'].language = 'drifted';
        }, 'embedding_repair_replay_drift'],
        ['user replay input', (state: Awaited<ReturnType<typeof transactionFixture>>) => {
            state.user.username = 'renamed_user';
        }, 'embedding_repair_replay_input_drift'],
        ['classification', (state: Awaited<ReturnType<typeof transactionFixture>>) => {
            state.documents.user_feature_vectors['user-vector-1'].phoenixEmbeddingContract = {
                ...REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
                producer: 'unknown-writer',
            };
        }, 'embedding_repair_classification_drift'],
        ['current metadata', (state: Awaited<ReturnType<typeof transactionFixture>>) => {
            state.documents.user_feature_vectors['user-vector-1'].embeddingContract = { legacy: 'v2' };
        }, 'embedding_repair_metadata_drift'],
    ])('performs zero writes on %s drift', async (_case, mutate, message) => {
        const state = await transactionFixture();
        mutate(state);

        await expect(applyApprovedProposal(state.request)).rejects.toThrow(message);
        expect(state.dependencies.updateMetadata).not.toHaveBeenCalled();
    });

    it.each([
        ['proposal approval', { approvedProposalDigest: '0'.repeat(64) }, 'embedding_repair_proposal_approval_mismatch'],
        ['quarantine approval', { approvedQuarantineDigest: '0'.repeat(64) }, 'embedding_repair_quarantine_digest_mismatch'],
        ['backup approval', { approvedBackupDigest: '0'.repeat(64) }, 'embedding_repair_backup_approval_mismatch'],
    ])('rejects %s before starting a transaction', async (_case, approvalPatch, message) => {
        const state = await transactionFixture();
        Object.assign(state.request, approvalPatch);

        await expect(applyApprovedProposal(state.request)).rejects.toThrow(message);
        expect(state.dependencies.startSession).not.toHaveBeenCalled();
        expect(state.dependencies.updateMetadata).not.toHaveBeenCalled();
    });

    it.each([
        ['expired production authorization', (state: Awaited<ReturnType<typeof transactionFixture>>) => {
            state.request.productionAuthorization.expiresAt = '2026-07-13T00:00:00.000Z';
        }, 'embedding_repair_production_authorization_expired'],
        ['writer pause binding', (state: Awaited<ReturnType<typeof transactionFixture>>) => {
            state.request.writerPauseEvidence.sourceBackupDigest = '0'.repeat(64);
        }, 'embedding_repair_writer_pause_mismatch'],
    ])('revalidates %s at the transaction entry', async (_case, mutate, message) => {
        const state = await transactionFixture();
        mutate(state);

        await expect(applyApprovedProposal(state.request)).rejects.toThrow(message);
        expect(state.dependencies.startSession).not.toHaveBeenCalled();
        expect(state.dependencies.updateMetadata).not.toHaveBeenCalled();
    });

    it.each(invalidAuthorizationChronology)(
        'rejects %s chronology before starting an apply transaction',
        async (_case, evidence, field, value) => {
            const state = await transactionFixture();
            Object.assign(state.request[evidence], { [field]: value });

            await expect(applyApprovedProposal(state.request))
                .rejects.toThrow('embedding_repair_authorization_chronology_invalid');
            expect(state.dependencies.startSession).not.toHaveBeenCalled();
            expect(state.dependencies.updateMetadata).not.toHaveBeenCalled();
        },
    );

    it('rejects proposal approval that expired after load but before apply', async () => {
        const state = await transactionFixture();
        state.request.proposalApproval.expiresAt = '2026-07-13T00:00:00.000Z';
        const now = vi.spyOn(Date, 'now')
            .mockReturnValue(Date.parse('2026-07-13T00:00:01.000Z'));
        try {
            await expect(applyApprovedProposal(state.request))
                .rejects.toThrow('embedding_repair_proposal_approval_expired');
        } finally {
            now.mockRestore();
        }
        expect(state.dependencies.startSession).not.toHaveBeenCalled();
        expect(state.dependencies.updateMetadata).not.toHaveBeenCalled();
    });

    it('rejects synchronized non-target user input and vector drift before target reads', async () => {
        const state = await transactionFixture();
        state.nonTargetUser.username = 'renamed_non_target';
        const replay = buildRegisteredUserColdStartEmbedding(state.nonTargetUser);
        const document = state.documents.user_feature_vectors['user-vector-2'];
        document.twoTowerEmbedding = [...replay];
        document.phoenixEmbedding = [...replay];
        const live = await state.planLiveProposal();
        expect(live.evidence).toEqual(state.request.proposal.evidence);
        expect(live.replay).toEqual(state.request.proposal.replay);
        state.dependencies.rebuildLiveProposal.mockResolvedValue(live);

        await expect(applyApprovedProposal(state.request))
            .rejects.toThrow('embedding_repair_live_proposal_drift');
        expect(state.dependencies.loadDocument).not.toHaveBeenCalled();
        expect(state.dependencies.updateMetadata).not.toHaveBeenCalled();
    });

    it('rejects a rebuilt full live proposal mismatch before target writes', async () => {
        const state = await transactionFixture();
        const live = structuredClone(state.request.proposal);
        live.evidence.aggregate.verified_local_fallback -= 1;
        live.evidence.aggregate.invalid += 1;
        live.evidence.cohorts.postFeatureSnapshots.verified_local_fallback -= 1;
        live.evidence.cohorts.postFeatureSnapshots.invalid += 1;
        live.proposalDigest = computeProposalDigest(live);
        state.dependencies.rebuildLiveProposal.mockResolvedValue(live);

        await expect(applyApprovedProposal(state.request))
            .rejects.toThrow('embedding_repair_live_proposal_drift');
        expect(state.dependencies.updateMetadata).not.toHaveBeenCalled();
    });

    it('preflights every target before sequential metadata-only writes with timestamps disabled', async () => {
        const state = await transactionFixture();

        const result = await applyApprovedProposal(state.request);

        expect(result).toMatchObject({ mode: 'apply', completed: true, operations: 2 });
        expect(state.order).toEqual([
            'live-proposal',
            'load:post_feature_snapshots:post-1',
            'load:user_feature_vectors:user-vector-1',
            'user:user-1',
            'write:post_feature_snapshots:post-1',
            'write:user_feature_vectors:user-vector-1',
        ]);
        for (const call of state.dependencies.updateMetadata.mock.calls) {
            expect(call[4]).toMatchObject({ timestamps: false });
        }
    });

    it('aborts matched-count mismatch without committing staged writes or falling back', async () => {
        const state = await transactionFixture({ secondMatchedCount: 0 });

        await expect(applyApprovedProposal(state.request))
            .rejects.toThrow('embedding_repair_matched_count_mismatch');
        expect(state.visibleWrites).toEqual([]);
        expect(state.session.withTransaction).toHaveBeenCalledOnce();
    });

    it('aborts apply when backup approval expires after the final staged write', async () => {
        let currentTime = Date.parse('2026-07-12T23:59:59.000Z');
        const state = await transactionFixture({
            afterLastStagedWrite: () => {
                currentTime = Date.parse('2026-07-13T00:00:01.000Z');
            },
        });
        state.request.backupApproval.expiresAt = '2026-07-13T00:00:00.000Z';
        const now = vi.spyOn(Date, 'now').mockImplementation(() => currentTime);
        try {
            await expect(applyApprovedProposal(state.request))
                .rejects.toThrow('embedding_repair_backup_approval_expired');
        } finally {
            now.mockRestore();
        }
        expect(state.dependencies.updateMetadata).toHaveBeenCalledTimes(2);
        expect(state.visibleWrites).toEqual([]);
        expect(state.session.withTransaction).toHaveBeenCalledOnce();
    });

    it('fails closed when transactions are unsupported', async () => {
        const state = await transactionFixture();
        state.dependencies.startSession.mockResolvedValue({ endSession: vi.fn() });

        await expect(applyApprovedProposal(state.request))
            .rejects.toThrow('embedding_repair_transaction_unsupported');
        expect(state.dependencies.updateMetadata).not.toHaveBeenCalled();
    });
});

describe('embedding repair rollback transaction adapter', () => {
    it.each([
        ['backup approval', { approvedBackupDigest: '0'.repeat(64) }, 'embedding_repair_backup_approval_mismatch'],
        ['source proposal', { approvedSourceProposalDigest: '0'.repeat(64) }, 'embedding_repair_backup_source_approval_mismatch'],
        ['source quarantine', { approvedSourceQuarantineDigest: '0'.repeat(64) }, 'embedding_repair_quarantine_digest_mismatch'],
    ])('rejects %s before starting a transaction', async (_case, approvalPatch, message) => {
        const state = await rollbackFixture();
        Object.assign(state.request, approvalPatch);

        await expect(rollbackApprovedBackup(state.request)).rejects.toThrow(message);
        expect(state.dependencies.startSession).not.toHaveBeenCalled();
        expect(state.dependencies.updateMetadata).not.toHaveBeenCalled();
    });

    it.each([
        ['post-apply metadata', (state: Awaited<ReturnType<typeof rollbackFixture>>) => {
            state.documents.post_feature_snapshots['post-1'].embeddingContract.producer = 'drifted';
        }, 'embedding_repair_metadata_drift'],
        ['per-slot checksum', (state: Awaited<ReturnType<typeof rollbackFixture>>) => {
            state.documents.user_feature_vectors['user-vector-1'].phoenixEmbedding[0] += 0.01;
        }, 'embedding_repair_vector_drift'],
        ['replay input', (state: Awaited<ReturnType<typeof rollbackFixture>>) => {
            state.user.region = 'US';
        }, 'embedding_repair_replay_input_drift'],
    ])('performs zero writes on %s drift', async (_case, mutate, message) => {
        const state = await rollbackFixture();
        mutate(state);

        await expect(rollbackApprovedBackup(state.request)).rejects.toThrow(message);
        expect(state.dependencies.updateMetadata).not.toHaveBeenCalled();
    });

    it.each(invalidAuthorizationChronology)(
        'rejects %s chronology before starting a rollback transaction',
        async (_case, evidence, field, value) => {
            const state = await rollbackFixture();
            Object.assign(state.request[evidence], { [field]: value });

            await expect(rollbackApprovedBackup(state.request))
                .rejects.toThrow('embedding_repair_authorization_chronology_invalid');
            expect(state.dependencies.startSession).not.toHaveBeenCalled();
            expect(state.dependencies.updateMetadata).not.toHaveBeenCalled();
        },
    );

    it('rejects non-target full live-state drift before rollback target reads or writes', async () => {
        const state = await rollbackFixture();
        const live = structuredClone(state.expectedPostApplyProposal);
        live.evidence.aggregate.verified_local_fallback -= 1;
        live.evidence.aggregate.invalid += 1;
        live.evidence.cohorts.postFeatureSnapshots.verified_local_fallback -= 1;
        live.evidence.cohorts.postFeatureSnapshots.invalid += 1;
        live.proposalDigest = computeProposalDigest(live);
        state.dependencies.rebuildLiveProposal.mockResolvedValue(live);

        await expect(rollbackApprovedBackup(state.request))
            .rejects.toThrow('embedding_repair_live_post_apply_proposal_drift');
        expect(state.dependencies.loadDocument).not.toHaveBeenCalled();
        expect(state.dependencies.updateMetadata).not.toHaveBeenCalled();
    });

    it('rejects expired backup approval before rollback transaction start', async () => {
        const state = await rollbackFixture();
        state.request.backupApproval.expiresAt = '2026-07-13T00:00:00.000Z';
        const now = vi.spyOn(Date, 'now')
            .mockReturnValue(Date.parse('2026-07-13T00:00:01.000Z'));
        try {
            await expect(rollbackApprovedBackup(state.request))
                .rejects.toThrow('embedding_repair_backup_approval_expired');
        } finally {
            now.mockRestore();
        }
        expect(state.dependencies.startSession).not.toHaveBeenCalled();
        expect(state.dependencies.updateMetadata).not.toHaveBeenCalled();
    });

    it('rejects synchronized non-target drift before rollback target reads', async () => {
        const state = await rollbackFixture();
        state.nonTargetUser.language = 'en';
        const replay = buildRegisteredUserColdStartEmbedding(state.nonTargetUser);
        const document = state.documents.user_feature_vectors['user-vector-2'];
        document.twoTowerEmbedding = [...replay];
        document.phoenixEmbedding = [...replay];
        const live = await state.planLiveProposal();
        expect(live.evidence).toEqual(state.expectedPostApplyProposal.evidence);
        expect(live.replay).toEqual(state.expectedPostApplyProposal.replay);
        state.dependencies.rebuildLiveProposal.mockResolvedValue(live);

        await expect(rollbackApprovedBackup(state.request))
            .rejects.toThrow('embedding_repair_live_post_apply_proposal_drift');
        expect(state.dependencies.loadDocument).not.toHaveBeenCalled();
        expect(state.dependencies.updateMetadata).not.toHaveBeenCalled();
    });

    it('restores exact metadata sequentially inside one transaction', async () => {
        const state = await rollbackFixture();

        const result = await rollbackApprovedBackup(state.request);

        expect(result).toMatchObject({ mode: 'rollback', completed: true, operations: 2 });
        expect(state.dependencies.updateMetadata).toHaveBeenCalledTimes(2);
        for (const call of state.dependencies.updateMetadata.mock.calls) {
            expect(call[4]).toMatchObject({ timestamps: false });
        }
    });

    it('aborts rollback when writer-pause evidence expires after the final staged write', async () => {
        let currentTime = Date.parse('2026-07-12T23:59:59.000Z');
        const state = await rollbackFixture({
            afterLastStagedWrite: () => {
                currentTime = Date.parse('2026-07-13T00:00:01.000Z');
            },
        });
        state.request.writerPauseEvidence.expiresAt = '2026-07-13T00:00:00.000Z';
        const now = vi.spyOn(Date, 'now').mockImplementation(() => currentTime);
        try {
            await expect(rollbackApprovedBackup(state.request))
                .rejects.toThrow('embedding_repair_writer_pause_expired');
        } finally {
            now.mockRestore();
        }
        expect(state.dependencies.updateMetadata).toHaveBeenCalledTimes(2);
        expect(state.visibleWrites).toEqual([]);
        expect(state.session.withTransaction).toHaveBeenCalledOnce();
    });

    it('fails closed without fallback on unsupported transaction or write conflict', async () => {
        const unsupported = await rollbackFixture();
        unsupported.dependencies.startSession.mockResolvedValue({ endSession: vi.fn() });
        await expect(rollbackApprovedBackup(unsupported.request))
            .rejects.toThrow('embedding_repair_transaction_unsupported');
        expect(unsupported.dependencies.updateMetadata).not.toHaveBeenCalled();

        const conflict = await rollbackFixture({ transactionError: new Error('write conflict') });
        await expect(rollbackApprovedBackup(conflict.request)).rejects.toThrow('write conflict');
        expect(conflict.visibleWrites).toEqual([]);
        expect(conflict.session.withTransaction).toHaveBeenCalledOnce();
    });
});

function postDocument() {
    const input = {
        _id: 'post-1',
        keywordScores: [{ keyword: 'typescript', weight: 0.8 }],
        clusterScores: [{ clusterId: 7, score: 0.9 }],
        authorProducerClusters: [{ clusterId: 11, score: 0.6 }],
        authorKnownForCluster: 11,
        engagementBucket: 'high' as const,
        freshnessBucket: 'hours_24' as const,
        hasMedia: true,
        mediaTypes: ['image'],
        language: 'en',
    };
    return { ...input, denseEmbedding: buildDensePostEmbedding(input) };
}

function mongoSource(documents: unknown[]) {
    const query = {
        sort: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        lean: vi.fn().mockReturnThis(),
        cursor: vi.fn(() => ({
            async *[Symbol.asyncIterator]() {
                for (const document of documents) yield document;
            },
        })),
    };
    return { model: { find: vi.fn(() => query) }, query };
}

async function transactionFixture(options: {
    secondMatchedCount?: number;
    transactionError?: Error;
    afterLastStagedWrite?: () => void;
} = {}) {
    const order: string[] = [];
    const visibleWrites: string[] = [];
    const stagedWrites: string[] = [];
    const user = { ...userInput };
    const nonTargetUser = {
        ...userInput,
        id: 'user-2',
        username: 'stable_non_target',
    };
    const cold = buildRegisteredUserColdStartEmbedding(user);
    const nonTargetCold = buildRegisteredUserColdStartEmbedding(nonTargetUser);
    const post = postDocument();
    const documents = {
        user_feature_vectors: {
            'user-vector-1': {
                _id: 'user-vector-1',
                userId: user.id,
                twoTowerEmbedding: [...cold],
            phoenixEmbedding: [...cold],
            phoenixEmbeddingContract: REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
            embeddingContract: { legacy: 'v1' },
            },
            'user-vector-2': {
                _id: 'user-vector-2',
                userId: nonTargetUser.id,
                twoTowerEmbedding: [...nonTargetCold],
                twoTowerEmbeddingContract: REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
                phoenixEmbedding: [...nonTargetCold],
                phoenixEmbeddingContract: REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
            },
        },
        post_feature_snapshots: {
            'post-1': { ...post },
        },
    };
    const userSource = mongoSource(Object.values(documents.user_feature_vectors));
    const postSource = mongoSource([documents.post_feature_snapshots['post-1']]);
    const proposal = await planEmbeddingContractRepair({
        models: {
            userFeatureVector: userSource.model,
            postFeatureSnapshot: postSource.model,
        },
        loadUserInput: vi.fn(async (id) => (
            id === user.id ? user : id === nonTargetUser.id ? nonTargetUser : null
        )),
    });
    const session = {
        withTransaction: vi.fn(async (callback: () => Promise<void>) => {
            try {
                await callback();
                if (options.transactionError) throw options.transactionError;
                visibleWrites.push(...stagedWrites);
            } finally {
                stagedWrites.length = 0;
            }
        }),
        endSession: vi.fn(),
    };
    const updateMetadata = vi.fn(async (
        collection: string,
        id: string,
        _patch: unknown,
        _session: unknown,
        _options: unknown,
    ) => {
        order.push(`write:${collection}:${id}`);
        stagedWrites.push(`${collection}:${id}`);
        const matchedCount = updateMetadata.mock.calls.length === 2
            ? options.secondMatchedCount ?? 1
            : 1;
        if (updateMetadata.mock.calls.length === 2) options.afterLastStagedWrite?.();
        return { matchedCount };
    });
    const dependencies: EmbeddingRepairTransactionDependencies = {
        startSession: vi.fn().mockResolvedValue(session),
        rebuildLiveProposal: vi.fn(async () => {
            order.push('live-proposal');
            return proposal;
        }),
        loadDocument: vi.fn(async (collection, id) => {
            order.push(`load:${collection}:${id}`);
            return structuredClone(documents[collection][id]);
        }),
        loadUserInput: vi.fn(async (id) => {
            order.push(`user:${id}`);
            return { ...user };
        }),
        updateMetadata,
    };
    const backup = createEmbeddingMetadataBackup(proposal);
    const evidence = executionEvidence('apply', proposal.proposalDigest, backup.backupDigest);
    const approvals = artifactApprovals(proposal.proposalDigest, backup.backupDigest);
    const request = {
        proposal,
        backup,
        approvedProposalDigest: proposal.proposalDigest,
        approvedQuarantineDigest: proposal.quarantineDigest,
        approvedBackupDigest: backup.backupDigest,
        ...approvals,
        ...evidence,
        dependencies,
    };

    return {
        order,
        visibleWrites,
        user,
        nonTargetUser,
        documents,
        dependencies,
        session,
        request,
        planLiveProposal: () => planEmbeddingContractRepair({
            models: {
                userFeatureVector: mongoSource(
                    Object.values(documents.user_feature_vectors),
                ).model,
                postFeatureSnapshot: mongoSource(
                    Object.values(documents.post_feature_snapshots),
                ).model,
            },
            loadUserInput: async (id) => (
                id === user.id ? user : id === nonTargetUser.id ? nonTargetUser : null
            ),
        }),
    };
}

async function rollbackFixture(options: {
    transactionError?: Error;
    afterLastStagedWrite?: () => void;
} = {}) {
    const state = await transactionFixture(options);
    const expectedPostApplyProposal = postApplyProposal(state.request.proposal);
    state.dependencies.rebuildLiveProposal.mockResolvedValue(expectedPostApplyProposal);
    for (const operation of state.request.proposal.operations) {
        const document = state.documents[operation.collection][operation.id];
        for (const [field, value] of Object.entries(operation.expectedPostApplyMetadata)) {
            document[field] = structuredClone(value);
        }
    }
    const request = {
        proposal: state.request.proposal,
        backup: state.request.backup,
        approvedBackupDigest: state.request.backup.backupDigest,
        approvedSourceProposalDigest: state.request.backup.sourceProposalDigest,
        approvedSourceQuarantineDigest: state.request.backup.sourceQuarantineDigest,
        proposalApproval: state.request.proposalApproval,
        backupApproval: state.request.backupApproval,
        ...executionEvidence(
            'rollback',
            state.request.proposal.proposalDigest,
            state.request.backup.backupDigest,
        ),
        dependencies: state.dependencies,
    };
    return { ...state, expectedPostApplyProposal, request };
}

function artifactApprovals(proposalDigest: string, backupDigest: string) {
    const common = {
        approvedBy: 'release-operator',
        approvedAt: '2026-07-12T23:00:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z',
    };
    return {
        proposalApproval: {
            schemaVersion: 1 as const,
            artifact: 'proposal' as const,
            approvedDigest: proposalDigest,
            ...common,
        },
        backupApproval: {
            schemaVersion: 1 as const,
            artifact: 'backup' as const,
            approvedDigest: backupDigest,
            ...common,
        },
    };
}

function postApplyProposal(proposal: Awaited<ReturnType<typeof planEmbeddingContractRepair>>) {
    const { proposalDigest: _ignored, ...input } = proposal;
    const postApplyInput = { ...input, operations: [] };
    return { ...postApplyInput, proposalDigest: computeProposalDigest(postApplyInput) };
}

function executionEvidence(
    operation: 'apply' | 'rollback',
    proposalDigest: string,
    backupDigest: string,
) {
    return {
        productionAuthorization: {
            schemaVersion: 1 as const,
            operation,
            sourceProposalDigest: proposalDigest,
            sourceBackupDigest: backupDigest,
            mongodbUriSha256: '6'.repeat(64),
            authorizedBy: 'production-owner',
            authorizedAt: '2026-07-12T23:00:00.000Z',
            expiresAt: '2099-01-01T00:00:00.000Z',
        },
        writerPauseEvidence: {
            schemaVersion: 1 as const,
            scope: 'recommendation_embedding_contract_and_user_replay_input_writers' as const,
            paused: true as const,
            sourceProposalDigest: proposalDigest,
            sourceBackupDigest: backupDigest,
            pausedBy: 'writer-owner',
            pausedAt: '2026-07-12T23:00:00.000Z',
            expiresAt: '2099-01-01T00:00:00.000Z',
        },
    };
}
