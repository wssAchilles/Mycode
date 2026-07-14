import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import {
    createEmbeddingMetadataBackup,
    computeBackupDigest,
    computeProposalDigest,
    readJsonFileDurably,
    validateEmbeddingMetadataBackup,
    validateEmbeddingRepairProposal,
    writeJsonFileDurably,
} from '../../src/services/ops/recommendation/embeddingRepair/artifacts';
import {
    assertMetadataOnlyOperations,
    assertMetadataPatch,
} from '../../src/services/ops/recommendation/embeddingRepair/metadataPolicy';
import {
    loadApprovedApplyRequest,
    loadApprovedRollbackRequest,
} from '../../src/services/ops/recommendation/embeddingRepair/authorization';
import type {
    EmbeddingContractRepairProposal,
    EmbeddingContractRepairProposalInput,
} from '../../src/services/ops/recommendation/embeddingRepair/contracts';
import {
    HEURISTIC_POST_HASH_EMBEDDING_CONTRACT,
    REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
} from '../../src/services/recommendation/contracts/embeddingContract';
import {
    LEGACY_SERVING_LITE_MIXED_LINEAGE_QUARANTINE_REASON,
} from '../../src/services/recommendation/contracts/embeddingContractEvidence';

const invalidAuthorizationChronology = [
    ['proposal approval before writer pause', 'proposal.approval.json', 'approvedAt', '2026-07-12T22:59:00.000Z'],
    ['backup approval before writer pause', 'backup.approval.json', 'approvedAt', '2026-07-12T22:59:00.000Z'],
    ['production authorization before proposal approval', 'proposal.approval.json', 'approvedAt', '2026-07-12T23:01:00.000Z'],
    ['production authorization before backup approval', 'backup.approval.json', 'approvedAt', '2026-07-12T23:01:00.000Z'],
] as const;

const invalidAuthorizationLoadChronology = (['apply', 'rollback'] as const).flatMap(
    (operation) => invalidAuthorizationChronology.map((entry) => [operation, ...entry] as const),
);

describe('embedding repair artifacts', () => {
    it('hashes object keys canonically while requiring canonical operation and slot order', () => {
        const input = proposalInput();
        const reorderedKeys = {
            ...input,
            scanned: {
                postFeatureSnapshots: input.scanned.postFeatureSnapshots,
                users: input.scanned.users,
            },
            writeCounters: {
                python: 0 as const,
                process: 0 as const,
                scheduler: 0 as const,
                redis: 0 as const,
                mongo: 0 as const,
            },
        };

        expect(computeProposalDigest(reorderedKeys)).toBe(computeProposalDigest(input));
        expect(() => validateEmbeddingRepairProposal(withDigest({
            ...input,
            operations: [...input.operations].reverse(),
        }))).toThrow('embedding_repair_operations_not_canonical');
        expect(() => validateEmbeddingRepairProposal(withDigest({
            ...input,
            operations: input.operations.map((operation, index) => index === 1 ? {
                ...operation,
                expectedVectors: [...operation.expectedVectors].reverse(),
            } : operation),
        }))).toThrow('embedding_repair_expected_vectors_not_canonical');
    });

    it.each([
        ['tamper', (proposal: EmbeddingContractRepairProposal) => ({
            ...proposal,
            operations: proposal.operations.map((operation, index) => (
                index === 0 ? { ...operation, id: 'tampered' } : operation
            )),
        }), 'embedding_repair_proposal_digest_mismatch'],
        ['duplicate target', (proposal: EmbeddingContractRepairProposal) => ({
            ...proposal,
            operations: [proposal.operations[0], proposal.operations[0]],
            proposalDigest: '',
        }), 'embedding_repair_operation_duplicate'],
        ['duplicate slot', (proposal: EmbeddingContractRepairProposal) => ({
            ...proposal,
            operations: proposal.operations.map((operation, index) => index === 0 ? {
                ...operation,
                expectedVectors: [operation.expectedVectors[0], operation.expectedVectors[0]],
            } : operation),
            proposalDigest: '',
        }), 'embedding_repair_expected_vector_duplicate'],
    ])('rejects %s', (_case, mutate, message) => {
        const valid = withDigest(proposalInput());
        const mutated = mutate(valid);
        if (mutated.proposalDigest === '') {
            mutated.proposalDigest = computeProposalDigest(mutated);
        }
        expect(() => validateEmbeddingRepairProposal(mutated)).toThrow(message);
    });

    it.each([
        ['unknown schema', { schemaVersion: 2 }, 'embedding_repair_proposal_schema_invalid'],
        ['diagnostic proposal', { mode: 'diagnostic', fullScan: false }, 'embedding_repair_proposal_not_authorizable'],
        ['nonzero counters', {
            writeCounters: { mongo: 1, redis: 0, scheduler: 0, process: 0, python: 0 },
        }, 'embedding_repair_write_counters_nonzero'],
        ['semantic evidence', {
            evidence: evidence({ verified_local_fallback: 2, semantic_ready: 1 }),
        }, 'embedding_repair_classification_not_authorizable'],
        ['invalid evidence', {
            evidence: evidence({ verified_local_fallback: 2, invalid: 1 }),
        }, 'embedding_repair_classification_not_authorizable'],
        ['unclassified evidence', {
            evidence: evidence({ verified_local_fallback: 2, unclassified: 1 }),
        }, 'embedding_repair_classification_not_authorizable'],
        ['replay mismatch', {
            replay: {
                user: { matched: 1, mismatched: 1, inputMissing: 0 },
                post: { matched: 1, mismatched: 0 },
            },
        }, 'embedding_repair_replay_not_authorizable'],
        ['missing user replay input', {
            replay: {
                user: { matched: 1, mismatched: 0, inputMissing: 1 },
                post: { matched: 1, mismatched: 0 },
            },
        }, 'embedding_repair_replay_not_authorizable'],
        ['post replay mismatch', {
            replay: {
                user: { matched: 2, mismatched: 0, inputMissing: 0 },
                post: { matched: 0, mismatched: 1 },
            },
        }, 'embedding_repair_replay_not_authorizable'],
    ])('rejects %s for apply', (_case, patch, message) => {
        const proposal = withDigest({ ...proposalInput(), ...patch } as EmbeddingContractRepairProposalInput);
        expect(() => validateEmbeddingRepairProposal(proposal, { forApply: true })).toThrow(message);
    });

    it('authorizes only user replay mismatches covered by user-vector quarantine evidence', () => {
        const allowed = proposalInput();
        allowed.evidence = {
            aggregate: counts({ verified_local_fallback: 2, quarantined: 1 }),
            cohorts: {
                userVectors: counts({ verified_local_fallback: 1, quarantined: 1 }),
                postFeatureSnapshots: counts({ verified_local_fallback: 1 }),
            },
        };
        allowed.replay.user = { matched: 1, mismatched: 1, inputMissing: 0 };
        allowed.operations[1].expectedVectors[1].classification = 'quarantined';
        allowed.operations[1].patch = {
            set: {
                twoTowerEmbeddingQuarantineReason:
                    LEGACY_SERVING_LITE_MIXED_LINEAGE_QUARANTINE_REASON,
            },
            unset: [],
        };
        allowed.operations[1].expectedPostApplyMetadata = {
            ...allowed.operations[1].currentMetadata,
            twoTowerEmbeddingQuarantineReason:
                LEGACY_SERVING_LITE_MIXED_LINEAGE_QUARANTINE_REASON,
        };
        allowed.operations[1].restorePatch = {
            set: {},
            unset: ['twoTowerEmbeddingQuarantineReason'],
        };

        expect(() => validateEmbeddingRepairProposal(withDigest(allowed), { forApply: true }))
            .not.toThrow();

        const excessMismatch = structuredClone(allowed);
        excessMismatch.replay.user = { matched: 0, mismatched: 2, inputMissing: 0 };
        expect(() => validateEmbeddingRepairProposal(
            withDigest(excessMismatch),
            { forApply: true },
        )).toThrow('embedding_repair_replay_not_authorizable');

        const postQuarantineSubstitution = structuredClone(allowed);
        postQuarantineSubstitution.evidence = {
            aggregate: counts({ verified_local_fallback: 2, quarantined: 1 }),
            cohorts: {
                userVectors: counts({ verified_local_fallback: 2 }),
                postFeatureSnapshots: counts({ quarantined: 1 }),
            },
        };
        expect(() => validateEmbeddingRepairProposal(
            withDigest(postQuarantineSubstitution),
            { forApply: true },
        )).toThrow('embedding_repair_replay_not_authorizable');
    });

    it('binds a canonical exact-inverse backup to proposal, quarantine, slots, replay, and metadata', () => {
        const proposal = withDigest(proposalInput());
        const backup = createEmbeddingMetadataBackup(proposal);

        expect(validateEmbeddingMetadataBackup(backup)).toEqual(backup);
        expect(backup.sourceProposalDigest).toBe(proposal.proposalDigest);
        expect(backup.sourceQuarantineDigest).toBe(proposal.quarantineDigest);
        expect(backup.expectedPostApplyProposalDigest).toBe(postApplyProposal(proposal).proposalDigest);
        expect(backup.operations[1]).toMatchObject({
            expectedVectors: proposal.operations[1].expectedVectors,
            replayInputDigest: proposal.operations[1].replayInputDigest,
            expectedPostApplyMetadata: proposal.operations[1].expectedPostApplyMetadata,
            restorePatch: proposal.operations[1].restorePatch,
        });

        const tampered = {
            ...backup,
            sourceQuarantineDigest: 'f'.repeat(64),
        };
        expect(computeBackupDigest(tampered)).not.toBe(backup.backupDigest);
        expect(() => validateEmbeddingMetadataBackup(tampered))
            .toThrow('embedding_repair_backup_digest_mismatch');
    });

    it('refuses to create rollback authority from a diagnostic proposal', () => {
        const diagnostic = withDigest({
            ...proposalInput(),
            mode: 'diagnostic',
            fullScan: false,
        });

        expect(() => createEmbeddingMetadataBackup(diagnostic))
            .toThrow('embedding_repair_proposal_not_authorizable');
    });

    it('publishes artifacts durably without overwriting an existing reviewed file', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'embedding-repair-'));
        const path = join(directory, 'proposal.json');
        const proposal = withDigest(proposalInput());
        try {
            await writeJsonFileDurably(path, proposal);
            expect(await readJsonFileDurably(path)).toEqual(proposal);
            await expect(writeJsonFileDurably(path, proposal)).rejects.toMatchObject({ code: 'EEXIST' });
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    it('loads every saved artifact and external approval before returning an apply request', async () => {
        const proposal = withDigest(proposalInput());
        const backup = createEmbeddingMetadataBackup(proposal);
        const files = approvalFiles(proposal, backup);
        const readArtifact = vi.fn(async (path: string) => structuredClone(files[path]));

        const request = await loadApprovedApplyRequest(applyOptions(proposal, backup), {
            readArtifact,
            now: Date.parse('2026-07-13T00:00:00.000Z'),
        });

        expect(readArtifact.mock.calls.map(([path]) => path)).toEqual([
            'proposal.json',
            'backup.json',
            'proposal.approval.json',
            'backup.approval.json',
            'production.json',
            'pause.json',
        ]);
        expect(request).toMatchObject({
            proposal,
            backup,
            approvedProposalDigest: proposal.proposalDigest,
            approvedBackupDigest: backup.backupDigest,
            proposalApproval: files['proposal.approval.json'],
            backupApproval: files['backup.approval.json'],
            productionAuthorization: files['production.json'],
            writerPauseEvidence: files['pause.json'],
        });
    });

    it.each([
        ['missing backup', (files: Record<string, unknown>) => delete files['backup.json'], 'embedding_repair_artifact_file_missing'],
        ['proposal approval', (files: Record<string, any>) => {
            files['proposal.approval.json'].approvedDigest = '0'.repeat(64);
        }, 'embedding_repair_proposal_approval_mismatch'],
        ['backup approval', (files: Record<string, any>) => {
            files['backup.approval.json'].approvedDigest = '0'.repeat(64);
        }, 'embedding_repair_backup_approval_mismatch'],
        ['production source', (files: Record<string, any>) => {
            files['production.json'].sourceProposalDigest = '0'.repeat(64);
        }, 'embedding_repair_production_authorization_mismatch'],
        ['writer pause source', (files: Record<string, any>) => {
            files['pause.json'].sourceBackupDigest = '0'.repeat(64);
        }, 'embedding_repair_writer_pause_mismatch'],
    ])('rejects %s before caller can connect', async (_case, mutate, message) => {
        const proposal = withDigest(proposalInput());
        const backup = createEmbeddingMetadataBackup(proposal);
        const files = approvalFiles(proposal, backup);
        mutate(files);

        await expect(loadApprovedApplyRequest(applyOptions(proposal, backup), {
            readArtifact: async (path) => {
                if (!(path in files)) throw new Error('ENOENT');
                return structuredClone(files[path]);
            },
            now: Date.parse('2026-07-13T00:00:00.000Z'),
        })).rejects.toThrow(message);
    });

    it.each([
        ['future proposal approval', 'proposal.approval.json', 'approvedAt', '2026-07-13T00:01:00.000Z', 'embedding_repair_proposal_approval_issued_in_future'],
        ['future backup approval', 'backup.approval.json', 'approvedAt', '2026-07-13T00:01:00.000Z', 'embedding_repair_backup_approval_issued_in_future'],
        ['future production authorization', 'production.json', 'authorizedAt', '2026-07-13T00:01:00.000Z', 'embedding_repair_production_authorization_issued_in_future'],
        ['future writer pause', 'pause.json', 'pausedAt', '2026-07-13T00:01:00.000Z', 'embedding_repair_writer_pause_issued_in_future'],
        ['inverted proposal approval', 'proposal.approval.json', 'approvedAt', '2099-01-02T00:00:00.000Z', 'embedding_repair_proposal_approval_window_invalid'],
        ['inverted backup approval', 'backup.approval.json', 'approvedAt', '2099-01-02T00:00:00.000Z', 'embedding_repair_backup_approval_window_invalid'],
        ['inverted production authorization', 'production.json', 'authorizedAt', '2099-01-02T00:00:00.000Z', 'embedding_repair_production_authorization_window_invalid'],
        ['inverted writer pause', 'pause.json', 'pausedAt', '2099-01-02T00:00:00.000Z', 'embedding_repair_writer_pause_window_invalid'],
    ])('rejects %s', async (_case, path, field, value, message) => {
        const proposal = withDigest(proposalInput());
        const backup = createEmbeddingMetadataBackup(proposal);
        const files = approvalFiles(proposal, backup);
        files[path][field] = value;

        await expect(loadApprovedApplyRequest(applyOptions(proposal, backup), {
            readArtifact: async (file) => structuredClone(files[file]),
            now: Date.parse('2026-07-13T00:00:00.000Z'),
        })).rejects.toThrow(message);
    });

    it.each(invalidAuthorizationLoadChronology)(
        'rejects %s request with %s chronology before caller can connect',
        async (operation, _case, path, field, value) => {
            const proposal = withDigest(proposalInput());
            const backup = createEmbeddingMetadataBackup(proposal);
            const files = approvalFiles(proposal, backup);
            files['production.json'].operation = operation;
            files[path][field] = value;
            const loadRequest = operation === 'apply'
                ? loadApprovedApplyRequest
                : loadApprovedRollbackRequest;

            await expect(loadRequest({
                ...applyOptions(proposal, backup),
                mode: operation,
            }, {
                readArtifact: async (file) => structuredClone(files[file]),
                now: Date.parse('2026-07-13T00:00:00.000Z'),
            })).rejects.toThrow('embedding_repair_authorization_chronology_invalid');
        },
    );

    it('loads a pre-existing externally approved rollback backup without generating a new artifact', async () => {
        const proposal = withDigest(proposalInput());
        const backup = createEmbeddingMetadataBackup(proposal);
        const files = approvalFiles(proposal, backup);
        files['production.json'].operation = 'rollback';
        const readArtifact = vi.fn(async (path: string) => structuredClone(files[path]));

        const request = await loadApprovedRollbackRequest({
            mode: 'rollback',
            batchSize: 200,
            proposalFile: 'proposal.json',
            backupFile: 'backup.json',
            proposalApprovalFile: 'proposal.approval.json',
            backupApprovalFile: 'backup.approval.json',
            productionAuthorizationFile: 'production.json',
            writerPauseEvidenceFile: 'pause.json',
            approvedProposalDigest: proposal.proposalDigest,
            approvedQuarantineDigest: proposal.quarantineDigest,
            approvedBackupDigest: backup.backupDigest,
        }, {
            readArtifact,
            now: Date.parse('2026-07-13T00:00:00.000Z'),
        });

        expect(request).toMatchObject({
            proposal,
            backup,
            approvedSourceProposalDigest: proposal.proposalDigest,
            approvedSourceQuarantineDigest: proposal.quarantineDigest,
            proposalApproval: files['proposal.approval.json'],
            backupApproval: files['backup.approval.json'],
            productionAuthorization: files['production.json'],
            writerPauseEvidence: files['pause.json'],
        });
        expect(readArtifact.mock.calls.map(([path]) => path)).toEqual([
            'proposal.json',
            'backup.json',
            'proposal.approval.json',
            'backup.approval.json',
            'production.json',
            'pause.json',
        ]);
    });

    it('rejects a fabricated diagnostic-derived backup as rollback authority', async () => {
        const fullProposal = withDigest(proposalInput());
        const diagnosticProposal = withDigest({
            ...proposalInput(),
            mode: 'diagnostic',
            fullScan: false,
        });
        const backup = createEmbeddingMetadataBackup(fullProposal);
        const fabricatedBackup = {
            ...backup,
            sourceProposalDigest: diagnosticProposal.proposalDigest,
        };
        fabricatedBackup.backupDigest = computeBackupDigest(fabricatedBackup);
        const files = approvalFiles(diagnosticProposal, fabricatedBackup);
        files['production.json'].operation = 'rollback';

        await expect(loadApprovedRollbackRequest({
            mode: 'rollback',
            batchSize: 200,
            proposalFile: 'proposal.json',
            backupFile: 'backup.json',
            proposalApprovalFile: 'proposal.approval.json',
            backupApprovalFile: 'backup.approval.json',
            productionAuthorizationFile: 'production.json',
            writerPauseEvidenceFile: 'pause.json',
            approvedProposalDigest: diagnosticProposal.proposalDigest,
            approvedQuarantineDigest: diagnosticProposal.quarantineDigest,
            approvedBackupDigest: fabricatedBackup.backupDigest,
        }, {
            readArtifact: async (path) => structuredClone(files[path]),
            now: Date.parse('2026-07-13T00:00:00.000Z'),
        })).rejects.toThrow('embedding_repair_proposal_not_authorizable');
    });
});

describe('embedding repair metadata policy', () => {
    it.each([
        ['vector root', { set: { twoTowerEmbedding: [1] }, unset: [] }, 'embedding_repair_vector_field_forbidden'],
        ['vector descendant', { set: { 'twoTowerEmbedding.0': 1 }, unset: [] }, 'embedding_repair_metadata_dotted_path_forbidden'],
        ['unknown field', { set: { modelVersion: 'x' }, unset: [] }, 'embedding_repair_metadata_field_forbidden'],
        ['legacy shared contract', { set: {}, unset: ['embeddingContract'] }, 'embedding_repair_legacy_contract_write_forbidden'],
        ['overlap', {
            set: { twoTowerEmbeddingContract: REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT },
            unset: ['twoTowerEmbeddingContract'],
        }, 'embedding_repair_metadata_patch_overlap'],
        ['incomplete contract', {
            set: { twoTowerEmbeddingContract: { semantic: false } },
            unset: [],
        }, 'embedding_repair_contract_incomplete'],
    ])('rejects %s', (_case, patch, message) => {
        const operation = {
            ...proposalInput().operations[1],
            patch,
        };
        expect(() => assertMetadataOnlyOperations([operation])).toThrow(message);
    });

    it('allows only expected per-vector user and post contract metadata with exact inverse patches', () => {
        expect(() => assertMetadataOnlyOperations(proposalInput().operations)).not.toThrow();
    });

    it.each([
        ['unknown nested key', { unknown: true }],
        ['dotted nested key', { 'producer.extra': 'x' }],
        ['vector-named nested key', { twoTowerEmbedding: [0.1] }],
    ])('rejects an approved contract carrying an extra %s', (_case, extra) => {
        const operation = structuredClone(proposalInput().operations[1]);
        const contract = {
            ...REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
            ...extra,
        };
        operation.patch.set.twoTowerEmbeddingContract = contract;
        operation.expectedPostApplyMetadata.twoTowerEmbeddingContract = contract;

        expect(() => assertMetadataOnlyOperations([operation]))
            .toThrow('embedding_repair_contract_not_allowed:twoTowerEmbeddingContract');
    });

    it('allows only the fixed quarantine reason as a forward metadata repair', () => {
        const approved = structuredClone(proposalInput().operations[1]);
        approved.patch = {
            set: {
                twoTowerEmbeddingQuarantineReason:
                    LEGACY_SERVING_LITE_MIXED_LINEAGE_QUARANTINE_REASON,
            },
            unset: [],
        };
        approved.expectedPostApplyMetadata = {
            ...approved.currentMetadata,
            twoTowerEmbeddingQuarantineReason:
                LEGACY_SERVING_LITE_MIXED_LINEAGE_QUARANTINE_REASON,
        };
        approved.restorePatch = {
            set: {},
            unset: ['twoTowerEmbeddingQuarantineReason'],
        };
        expect(() => assertMetadataOnlyOperations([approved])).not.toThrow();

        const unsupported = structuredClone(approved);
        unsupported.patch = {
            set: { twoTowerEmbeddingQuarantineReason: 'manual-review' },
            unset: [],
        };
        unsupported.expectedPostApplyMetadata = {
            ...unsupported.currentMetadata,
            twoTowerEmbeddingQuarantineReason: 'manual-review',
        };

        expect(() => assertMetadataOnlyOperations([unsupported]))
            .toThrow('embedding_repair_quarantine_forward_write_forbidden');
        expect(() => assertMetadataPatch('user_feature_vectors', {
            set: {},
            unset: ['twoTowerEmbeddingQuarantineReason'],
        })).toThrow('embedding_repair_quarantine_forward_write_forbidden');
    });

    it('restores a captured legacy post contract without treating it as a new forward contract', () => {
        const operation = structuredClone(proposalInput().operations[0]);
        const legacy = {
            ...HEURISTIC_POST_HASH_EMBEDDING_CONTRACT,
            producer: 'legacy-post-writer',
        };
        operation.currentMetadata = { embeddingContract: legacy };
        operation.restorePatch = {
            set: { embeddingContract: legacy },
            unset: [],
        };

        expect(() => assertMetadataOnlyOperations([operation])).not.toThrow();
    });

    it.each([
        [
            'vector field',
            { set: { denseEmbedding: [0.1] }, unset: [] },
            'embedding_repair_vector_field_forbidden',
        ],
        [
            'dotted field',
            { set: { 'embeddingContract.producer': 'legacy' }, unset: [] },
            'embedding_repair_metadata_dotted_path_forbidden',
        ],
        [
            'unknown field',
            { set: { modelVersion: 'legacy' }, unset: [] },
            'embedding_repair_metadata_field_forbidden',
        ],
    ])('rejects a restore patch containing a %s', (_case, patch, message) => {
        expect(() => assertMetadataPatch(
            'post_feature_snapshots',
            patch,
            { direction: 'restore' },
        )).toThrow(message);
    });
});

function proposalInput(): EmbeddingContractRepairProposalInput {
    const legacy = {
        ...REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
        producer: 'legacy-shared-writer',
    };
    return {
        schemaVersion: 1,
        mode: 'dry-run',
        fullScan: true,
        scanned: { users: 1, postFeatureSnapshots: 1 },
        evidence: evidence({ verified_local_fallback: 3 }),
        replay: {
            user: { matched: 2, mismatched: 0, inputMissing: 0 },
            post: { matched: 1, mismatched: 0 },
        },
        operations: [{
            collection: 'post_feature_snapshots',
            id: 'post-1',
            expectedVectors: [{
                field: 'denseEmbedding',
                vectorChecksum: '1'.repeat(64),
                classification: 'verified_local_fallback',
            }],
            currentMetadata: {},
            expectedPostApplyMetadata: {
                embeddingContract: HEURISTIC_POST_HASH_EMBEDDING_CONTRACT,
            },
            patch: {
                set: { embeddingContract: HEURISTIC_POST_HASH_EMBEDDING_CONTRACT },
                unset: [],
            },
            restorePatch: { set: {}, unset: ['embeddingContract'] },
        }, {
            collection: 'user_feature_vectors',
            id: 'user-vector-1',
            userId: 'user-1',
            replayInputDigest: '2'.repeat(64),
            expectedVectors: [{
                field: 'phoenixEmbedding',
                vectorChecksum: '3'.repeat(64),
                classification: 'verified_local_fallback',
            }, {
                field: 'twoTowerEmbedding',
                vectorChecksum: '4'.repeat(64),
                classification: 'verified_local_fallback',
            }],
            currentMetadata: {
                embeddingContract: legacy,
                phoenixEmbeddingContract: REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
            },
            expectedPostApplyMetadata: {
                embeddingContract: legacy,
                phoenixEmbeddingContract: REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
                twoTowerEmbeddingContract: REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
            },
            patch: {
                set: {
                    twoTowerEmbeddingContract: REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
                },
                unset: [],
            },
            restorePatch: { set: {}, unset: ['twoTowerEmbeddingContract'] },
        }],
        corpusStateDigest: '9'.repeat(64),
        quarantineDigest: '5'.repeat(64),
        writeCounters: { mongo: 0, redis: 0, scheduler: 0, process: 0, python: 0 },
    };
}

function evidence(aggregatePatch: Partial<ReturnType<typeof counts>>) {
    const aggregate = counts(aggregatePatch);
    return {
        aggregate,
        cohorts: {
            userVectors: counts({ verified_local_fallback: 2 }),
            postFeatureSnapshots: counts({
                verified_local_fallback: aggregate.verified_local_fallback - 2,
                semantic_ready: aggregate.semantic_ready,
                quarantined: aggregate.quarantined,
                invalid: aggregate.invalid,
                unclassified: aggregate.unclassified,
            }),
        },
    };
}

function counts(patch: Partial<{
    verified_local_fallback: number;
    semantic_ready: number;
    quarantined: number;
    invalid: number;
    unclassified: number;
}> = {}) {
    const value = {
        verified_local_fallback: 0,
        semantic_ready: 0,
        quarantined: 0,
        invalid: 0,
        unclassified: 0,
        ...patch,
    };
    return {
        total: value.verified_local_fallback
            + value.semantic_ready
            + value.quarantined
            + value.invalid
            + value.unclassified,
        ...value,
    };
}

function withDigest(input: EmbeddingContractRepairProposalInput): EmbeddingContractRepairProposal {
    return { ...input, proposalDigest: computeProposalDigest(input) };
}

function postApplyProposal(
    proposal: EmbeddingContractRepairProposal,
): EmbeddingContractRepairProposal {
    const { proposalDigest: _ignored, ...input } = proposal;
    const postApplyInput = { ...input, operations: [] };
    return { ...postApplyInput, proposalDigest: computeProposalDigest(postApplyInput) };
}

function applyOptions(
    proposal: EmbeddingContractRepairProposal,
    backup: ReturnType<typeof createEmbeddingMetadataBackup>,
) {
    return {
        mode: 'apply' as const,
        batchSize: 200,
        proposalFile: 'proposal.json',
        backupFile: 'backup.json',
        proposalApprovalFile: 'proposal.approval.json',
        backupApprovalFile: 'backup.approval.json',
        productionAuthorizationFile: 'production.json',
        writerPauseEvidenceFile: 'pause.json',
        approvedProposalDigest: proposal.proposalDigest,
        approvedQuarantineDigest: proposal.quarantineDigest,
        approvedBackupDigest: backup.backupDigest,
    };
}

function approvalFiles(
    proposal: EmbeddingContractRepairProposal,
    backup: ReturnType<typeof createEmbeddingMetadataBackup>,
): Record<string, any> {
    const common = {
        approvedBy: 'release-operator',
        approvedAt: '2026-07-12T23:00:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z',
    };
    return {
        'proposal.json': proposal,
        'backup.json': backup,
        'proposal.approval.json': {
            schemaVersion: 1,
            artifact: 'proposal',
            approvedDigest: proposal.proposalDigest,
            ...common,
        },
        'backup.approval.json': {
            schemaVersion: 1,
            artifact: 'backup',
            approvedDigest: backup.backupDigest,
            ...common,
        },
        'production.json': {
            schemaVersion: 1,
            operation: 'apply',
            sourceProposalDigest: proposal.proposalDigest,
            sourceBackupDigest: backup.backupDigest,
            mongodbUriSha256: '6'.repeat(64),
            authorizedBy: 'production-owner',
            authorizedAt: '2026-07-12T23:00:00.000Z',
            expiresAt: '2099-01-01T00:00:00.000Z',
        },
        'pause.json': {
            schemaVersion: 1,
            scope: 'recommendation_embedding_contract_and_user_replay_input_writers',
            paused: true,
            sourceProposalDigest: proposal.proposalDigest,
            sourceBackupDigest: backup.backupDigest,
            pausedBy: 'writer-owner',
            pausedAt: '2026-07-12T23:00:00.000Z',
            expiresAt: '2099-01-01T00:00:00.000Z',
        },
    };
}
