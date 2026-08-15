import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import mongoose from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
    connectReadOnlyMongo: vi.fn(),
    disconnectReadOnlyMongo: vi.fn(),
    startSession: vi.fn(),
    session: {
        snapshotEnabled: true,
        endSession: vi.fn(),
    },
    traceAggregate: vi.fn(),
    userActionFind: vi.fn(),
}));

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));
vi.mock('../../src/services/recommendation/training/readOnlyMongo', () => ({
    connectReadOnlyMongo: runtime.connectReadOnlyMongo,
    disconnectReadOnlyMongo: runtime.disconnectReadOnlyMongo,
}));
vi.mock('../../src/models/RecommendationTrace', () => ({
    default: { aggregate: runtime.traceAggregate },
}));
vi.mock('../../src/models/UserAction', () => ({
    default: { find: runtime.userActionFind },
    ActionType: {
        IMPRESSION: 'impression',
        CLICK: 'click',
        LIKE: 'like',
        REPLY: 'reply',
        REPOST: 'repost',
        QUOTE: 'quote',
        SHARE: 'share',
        DISMISS: 'dismiss',
        BLOCK_AUTHOR: 'block_author',
        REPORT: 'report',
        DWELL: 'dwell',
    },
}));

function query<T>(value: T) {
    const cursor = {
        select: vi.fn(),
        sort: vi.fn(),
        limit: vi.fn(),
        session: vi.fn(),
        lean: vi.fn().mockResolvedValue(value),
    };
    cursor.select.mockReturnValue(cursor);
    cursor.sort.mockReturnValue(cursor);
    cursor.limit.mockReturnValue(cursor);
    cursor.session.mockReturnValue(cursor);
    return cursor;
}

function aggregation<T>(rows: T[]) {
    const cursor = {
        close: vi.fn(),
        async *[Symbol.asyncIterator]() {
            for (const row of rows) yield row;
        },
    };
    const aggregate = {
        session: vi.fn(),
        cursor: vi.fn().mockReturnValue(cursor),
    };
    aggregate.session.mockReturnValue(aggregate);
    return aggregate;
}

beforeEach(() => {
    runtime.connectReadOnlyMongo.mockClear();
    runtime.disconnectReadOnlyMongo.mockClear();
    runtime.traceAggregate.mockReset();
    runtime.userActionFind.mockReset();
    runtime.session.endSession.mockReset();
    runtime.startSession.mockReset().mockResolvedValue(runtime.session);
    vi.spyOn(mongoose, 'startSession').mockImplementation(runtime.startSession as never);
});

afterEach(() => {
    vi.restoreAllMocks();
});

async function minimalTrace(candidateCount: number) {
    const fixture = JSON.parse(
        readFileSync(
            path.resolve(
                __dirname,
                '../../../telegram-rust-workspace/crates/telegram-recommendation-fixtures/fixtures/decision_log_v1.json',
            ),
            'utf8',
        ),
    );
    const decisionAt = new Date(Date.now() - 60_000).toISOString();
    const servedPostId = '507f191e810c19729de87091';
    const decisionLogV1 = { ...fixture.decisionLog, decisionAt };
    decisionLogV1.actions[0].actionKey.candidateId = servedPostId;
    decisionLogV1.candidatePool.candidates[0].candidateId = servedPostId;
    const { candidatePoolSha256 } = await import('../../src/services/recommendation/decisionLog/contracts');
    decisionLogV1.candidatePool.candidatePoolSha256 = candidatePoolSha256(decisionLogV1.candidatePool.candidates);
    return {
        decisionLogV1,
        trace: {
            requestId: decisionLogV1.requestId,
            decisionId: decisionLogV1.decisionId,
            decisionLogV1Sha256: (
                await import('../../src/services/recommendation/decisionLog/contracts')
            ).decisionLogSha256(decisionLogV1),
            userId: 'user-minimal',
            productSurface: 'space_feed',
            decisionLogV1,
            experimentKeys: [],
            replayPool: {
                poolKind: 'pre_selector_scored_topk_v1',
                totalCount: candidateCount,
                truncated: false,
                candidates: Array.from({ length: candidateCount }, (_, index) => ({
                    postId: index === 0 ? servedPostId : `pool-post-${index}`,
                    modelPostId: index === 0 ? servedPostId : `pool-post-${index}`,
                    authorId: `author-${index}`,
                    rank: index + 1,
                    recallSource: 'PopularSource',
                    inNetwork: false,
                    isNews: false,
                })),
            },
        },
    };
}

describe('strict replay request exporter', () => {
    it('attributes only canonical served actions without datastore writes', async () => {
        const pseudonymKeyHex = 'ab'.repeat(32);
        const keyVersion = 'replay-test-key-v1';
        const captureEpochId = 'replay-test-epoch-v1';
        const fixture = JSON.parse(
            readFileSync(
                path.resolve(
                    __dirname,
                    '../../../telegram-rust-workspace/crates/telegram-recommendation-fixtures/fixtures/decision_log_v1.json',
                ),
                'utf8',
            ),
        );
        const decisionAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        const impressionAt = new Date(Date.parse(decisionAt) + 5_000);
        const servedPostId = '507f191e810c19729de87081';
        const unservedPostId = '507f191e810c19729de87082';
        const decisionLogV1 = {
            ...fixture.decisionLog,
            decisionAt,
        };
        decisionLogV1.actions[0].actionKey.candidateId = servedPostId;
        decisionLogV1.candidatePool.candidates[0].candidateId = servedPostId;
        const { candidatePoolSha256 } = await import('../../src/services/recommendation/decisionLog/contracts');
        decisionLogV1.candidatePool.candidatePoolSha256 = candidatePoolSha256(decisionLogV1.candidatePool.candidates);
        const { decisionLogSha256 } = await import('../../src/services/recommendation/decisionLog/contracts');
        const traceAggregation = aggregation([
            {
                requestId: decisionLogV1.requestId,
                decisionId: decisionLogV1.decisionId,
                decisionLogV1Sha256: decisionLogSha256(decisionLogV1),
                userId: 'user-1',
                productSurface: 'space_feed',
                decisionLogV1,
                createdAt: new Date(Date.parse(decisionAt) - 60_000).toISOString(),
                selectedCount: 1,
                inNetworkCount: 1,
                outOfNetworkCount: 1,
                sourceCounts: [],
                authorDiversity: 1,
                replyRatio: 0,
                averageScore: 0.5,
                experimentKeys: [],
                candidates: [
                    {
                        postId: servedPostId,
                        modelPostId: servedPostId,
                        authorId: 'served-author',
                        rank: 1,
                        recallSource: 'FollowingSource',
                        inNetwork: true,
                        isNews: false,
                    },
                ],
                replayPool: {
                    poolKind: 'pre_selector_scored_topk_v1',
                    totalCount: 2,
                    truncated: false,
                    candidates: [
                        {
                            postId: servedPostId,
                            modelPostId: servedPostId,
                            authorId: 'served-author',
                            rank: 2,
                            recallSource: 'FollowingSource',
                            inNetwork: true,
                            isNews: false,
                        },
                        {
                            postId: unservedPostId,
                            modelPostId: unservedPostId,
                            authorId: 'pool-author',
                            rank: 1,
                            recallSource: 'PopularSource',
                            inNetwork: false,
                            isNews: false,
                        },
                    ],
                },
            },
        ]);
        runtime.traceAggregate.mockReturnValue(traceAggregation);
        const outcomeQuery = query([
            {
                userId: 'user-1',
                requestId: decisionLogV1.requestId,
                action: 'impression',
                rank: 1,
                timestamp: impressionAt,
                metadata: {
                    decisionId: decisionLogV1.decisionId,
                    candidateNamespace: 'serving_post_id',
                    candidateId: servedPostId,
                    positionContractVersion: 'served_position_1_based_v1',
                },
            },
            {
                userId: 'user-1',
                requestId: decisionLogV1.requestId,
                action: 'click',
                rank: 1,
                timestamp: new Date(impressionAt.getTime() + 1_000),
                metadata: {
                    decisionId: decisionLogV1.decisionId,
                    candidateNamespace: 'serving_post_id',
                    candidateId: servedPostId,
                    positionContractVersion: 'served_position_1_based_v1',
                },
            },
        ]);
        runtime.userActionFind.mockReturnValue(outcomeQuery);

        const outputDirectory = mkdtempSync(path.join(tmpdir(), 'recsys-replay-export-'));
        const output = path.join(outputDirectory, 'requests.ndjson');
        const originalArgv = process.argv;
        const originalExitCode = process.exitCode;
        const originalPseudonymKey = process.env.RECOMMENDATION_REPLAY_PSEUDONYM_KEY_HEX;
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        process.env.RECOMMENDATION_REPLAY_PSEUDONYM_KEY_HEX = pseudonymKeyHex;
        process.argv = [
            'node',
            'exportRecsysReplayRequests.ts',
            '--days',
            '1',
            '--windowHours',
            '1',
            '--output',
            output,
            '--limit',
            '64',
            '--keyVersion',
            keyVersion,
            '--captureEpochId',
            captureEpochId,
        ];
        process.exitCode = undefined;

        try {
            await import('../../src/scripts/exportRecsysReplayRequests');
            await vi.waitFor(() => expect(runtime.disconnectReadOnlyMongo).toHaveBeenCalledOnce());
            await vi.waitFor(() => expect(readFileSync(output, 'utf8').trim()).not.toBe(''));

            expect(runtime.traceAggregate.mock.calls[0][0][0].$match).toHaveProperty('decisionLogV1.decisionAt');
            expect(runtime.traceAggregate.mock.calls[0][0][0].$match).not.toHaveProperty('createdAt');
            expect(runtime.startSession).toHaveBeenCalledWith({
                snapshot: true,
                causalConsistency: false,
            });
            expect(runtime.session.endSession).toHaveBeenCalledOnce();
            expect(traceAggregation.session).toHaveBeenCalledWith(runtime.session);
            expect(outcomeQuery.session).toHaveBeenCalledWith(runtime.session);
            expect(runtime.userActionFind.mock.calls[0][0]).toMatchObject({
                'metadata.decisionId': decisionLogV1.decisionId,
            });
            expect(runtime.userActionFind.mock.calls[0][0]).not.toHaveProperty('targetPostId');
            expect(runtime.userActionFind.mock.calls[0][0]).not.toHaveProperty('userId');

            const rawOutput = readFileSync(output, 'utf8');
            const request = JSON.parse(rawOutput);
            const { buildRecommendationViewerPseudonymV1 } =
                await import('../../src/services/recommendation/evidenceCapture/privacy');
            const expectedPseudonym = buildRecommendationViewerPseudonymV1({
                masterKey: Buffer.from(pseudonymKeyHex, 'hex'),
                viewerId: 'viewer:user-1',
                keyVersion,
                captureEpochId,
            });
            expect(expectedPseudonym.status).toBe('verified');
            if (expectedPseudonym.status !== 'verified') throw new Error('fixture_invalid');
            expect(request.userId).toBe(expectedPseudonym.pseudonym.viewerAccountPseudonym);
            expect(rawOutput).not.toContain('user-1');
            expect(rawOutput).not.toContain('served-author');
            expect(rawOutput).not.toContain('pool-author');
            expect(statSync(output).mode & 0o777).toBe(0o600);
            expect(request.requestAt).toBe(decisionAt);
            expect(request.candidates).toHaveLength(2);
            expect(request.candidates[0]).toMatchObject({
                postId: servedPostId,
                rank: 2,
                baselineRank: 2,
                outcomeContractV1: {
                    status: 'observed',
                    impressionAt: impressionAt.toISOString(),
                    actionKey: {
                        servedPosition: 1,
                    },
                },
                labels: {
                    click: true,
                },
            });
            expect(request.candidates[1]).toMatchObject({
                postId: unservedPostId,
                rank: 1,
                baselineRank: 1,
            });
            expect(request.candidates[1]).not.toHaveProperty('outcomeContractV1');
            expect(request.candidates[1]).not.toHaveProperty('labels');
            expect(request.candidates[1]).not.toHaveProperty('feedbackLabel');
            expect(log).toHaveBeenCalledWith('[ExportRecsysReplay] evidenceStatus=diagnostic_only_unverified_source');
            expect(error).not.toHaveBeenCalled();
            expect(process.exitCode).toBeUndefined();
        } finally {
            process.argv = originalArgv;
            process.exitCode = originalExitCode;
            if (originalPseudonymKey === undefined) {
                delete process.env.RECOMMENDATION_REPLAY_PSEUDONYM_KEY_HEX;
            } else {
                process.env.RECOMMENDATION_REPLAY_PSEUDONYM_KEY_HEX = originalPseudonymKey;
            }
            error.mockRestore();
            log.mockRestore();
            rmSync(outputDirectory, { recursive: true, force: true });
        }
    });

    it('rejects a missing pseudonym key before opening MongoDB', async () => {
        const originalArgv = process.argv;
        const originalExitCode = process.exitCode;
        const originalPseudonymKey = process.env.RECOMMENDATION_REPLAY_PSEUDONYM_KEY_HEX;
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        runtime.connectReadOnlyMongo.mockClear();
        runtime.disconnectReadOnlyMongo.mockClear();
        delete process.env.RECOMMENDATION_REPLAY_PSEUDONYM_KEY_HEX;
        process.argv = [
            'node',
            'exportRecsysReplayRequests.ts',
            '--keyVersion',
            'replay-test-key-v1',
            '--captureEpochId',
            'replay-test-epoch-v1',
        ];
        process.exitCode = undefined;

        try {
            vi.resetModules();
            await import('../../src/scripts/exportRecsysReplayRequests');
            await vi.waitFor(() => expect(process.exitCode).toBe(1));
            expect(runtime.connectReadOnlyMongo).not.toHaveBeenCalled();
            expect(error).toHaveBeenCalledWith(
                '[ExportRecsysReplay] failed:',
                expect.objectContaining({
                    message: 'replay_export_pseudonym_key_invalid',
                }),
            );
        } finally {
            process.argv = originalArgv;
            process.exitCode = originalExitCode;
            if (originalPseudonymKey === undefined) {
                delete process.env.RECOMMENDATION_REPLAY_PSEUDONYM_KEY_HEX;
            } else {
                process.env.RECOMMENDATION_REPLAY_PSEUDONYM_KEY_HEX = originalPseudonymKey;
            }
            error.mockRestore();
            log.mockRestore();
        }
    });

    it('does not overwrite an existing target', async () => {
        const outputDirectory = mkdtempSync(path.join(tmpdir(), 'recsys-replay-existing-'));
        const output = path.join(outputDirectory, 'requests.ndjson');
        const originalContent = '{"owner":"existing"}\n';
        const originalArgv = process.argv;
        const originalExitCode = process.exitCode;
        const originalPseudonymKey = process.env.RECOMMENDATION_REPLAY_PSEUDONYM_KEY_HEX;
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        runtime.connectReadOnlyMongo.mockClear();
        runtime.disconnectReadOnlyMongo.mockClear();
        process.env.RECOMMENDATION_REPLAY_PSEUDONYM_KEY_HEX = 'cd'.repeat(32);
        process.argv = [
            'node',
            'exportRecsysReplayRequests.ts',
            '--output',
            output,
            '--keyVersion',
            'replay-test-key-v1',
            '--captureEpochId',
            'replay-test-epoch-v1',
        ];
        process.exitCode = undefined;
        writeFileSync(output, originalContent, { mode: 0o600 });

        try {
            vi.resetModules();
            await import('../../src/scripts/exportRecsysReplayRequests');
            await vi.waitFor(() => expect(process.exitCode).toBe(1));
            expect(runtime.connectReadOnlyMongo).not.toHaveBeenCalled();
            expect(readFileSync(output, 'utf8')).toBe(originalContent);
            expect(error).toHaveBeenCalledWith(
                '[ExportRecsysReplay] failed:',
                expect.objectContaining({ message: 'atomic_artifact_target_exists' }),
            );
        } finally {
            process.argv = originalArgv;
            process.exitCode = originalExitCode;
            if (originalPseudonymKey === undefined) {
                delete process.env.RECOMMENDATION_REPLAY_PSEUDONYM_KEY_HEX;
            } else {
                process.env.RECOMMENDATION_REPLAY_PSEUDONYM_KEY_HEX = originalPseudonymKey;
            }
            error.mockRestore();
            log.mockRestore();
            rmSync(outputDirectory, { recursive: true, force: true });
        }
    });

    it('rejects candidate overflow before loading outcomes or publishing', async () => {
        const { trace } = await minimalTrace(2_049);
        const outputDirectory = mkdtempSync(path.join(tmpdir(), 'recsys-replay-overflow-'));
        const output = path.join(outputDirectory, 'requests.ndjson');
        const originalArgv = process.argv;
        const originalExitCode = process.exitCode;
        const originalPseudonymKey = process.env.RECOMMENDATION_REPLAY_PSEUDONYM_KEY_HEX;
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        runtime.connectReadOnlyMongo.mockClear();
        runtime.disconnectReadOnlyMongo.mockClear();
        runtime.userActionFind.mockClear();
        runtime.traceAggregate.mockReturnValue(aggregation([trace]));
        process.env.RECOMMENDATION_REPLAY_PSEUDONYM_KEY_HEX = 'ef'.repeat(32);
        process.argv = [
            'node',
            'exportRecsysReplayRequests.ts',
            '--output',
            output,
            '--keyVersion',
            'replay-test-key-v1',
            '--captureEpochId',
            'replay-test-epoch-v1',
        ];
        process.exitCode = undefined;

        try {
            vi.resetModules();
            await import('../../src/scripts/exportRecsysReplayRequests');
            await vi.waitFor(() => expect(process.exitCode).toBe(1));
            expect(runtime.userActionFind).not.toHaveBeenCalled();
            expect(existsSync(output)).toBe(false);
            expect(error).toHaveBeenCalledWith(
                '[ExportRecsysReplay] failed:',
                expect.objectContaining({
                    message: 'replay_export_resource_limit_exceeded',
                }),
            );
        } finally {
            process.argv = originalArgv;
            process.exitCode = originalExitCode;
            if (originalPseudonymKey === undefined) {
                delete process.env.RECOMMENDATION_REPLAY_PSEUDONYM_KEY_HEX;
            } else {
                process.env.RECOMMENDATION_REPLAY_PSEUDONYM_KEY_HEX = originalPseudonymKey;
            }
            error.mockRestore();
            log.mockRestore();
            rmSync(outputDirectory, { recursive: true, force: true });
        }
    });

    it('rejects a trace whose persisted decision-log digest does not match', async () => {
        const { trace } = await minimalTrace(1);
        trace.decisionLogV1Sha256 = '0'.repeat(64);
        const outputDirectory = mkdtempSync(path.join(tmpdir(), 'recsys-replay-binding-'));
        const output = path.join(outputDirectory, 'requests.ndjson');
        const originalArgv = process.argv;
        const originalExitCode = process.exitCode;
        const originalPseudonymKey = process.env.RECOMMENDATION_REPLAY_PSEUDONYM_KEY_HEX;
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        runtime.traceAggregate.mockReturnValue(aggregation([trace]));
        process.env.RECOMMENDATION_REPLAY_PSEUDONYM_KEY_HEX = '34'.repeat(32);
        process.argv = [
            'node',
            'exportRecsysReplayRequests.ts',
            '--output',
            output,
            '--keyVersion',
            'replay-test-key-v1',
            '--captureEpochId',
            'replay-test-epoch-v1',
        ];
        process.exitCode = undefined;

        try {
            vi.resetModules();
            await import('../../src/scripts/exportRecsysReplayRequests');
            await vi.waitFor(() => expect(process.exitCode).toBe(1));
            expect(runtime.userActionFind).not.toHaveBeenCalled();
            expect(existsSync(output)).toBe(false);
            expect(error).toHaveBeenCalledWith(
                '[ExportRecsysReplay] failed:',
                expect.objectContaining({ message: 'replay_export_source_binding_invalid' }),
            );
        } finally {
            process.argv = originalArgv;
            process.exitCode = originalExitCode;
            if (originalPseudonymKey === undefined) {
                delete process.env.RECOMMENDATION_REPLAY_PSEUDONYM_KEY_HEX;
            } else {
                process.env.RECOMMENDATION_REPLAY_PSEUDONYM_KEY_HEX = originalPseudonymKey;
            }
            error.mockRestore();
            log.mockRestore();
            rmSync(outputDirectory, { recursive: true, force: true });
        }
    });

    it('rejects per-decision outcome overflow before publishing', async () => {
        const { trace } = await minimalTrace(1);
        const outputDirectory = mkdtempSync(path.join(tmpdir(), 'recsys-replay-action-overflow-'));
        const output = path.join(outputDirectory, 'requests.ndjson');
        const originalArgv = process.argv;
        const originalExitCode = process.exitCode;
        const originalPseudonymKey = process.env.RECOMMENDATION_REPLAY_PSEUDONYM_KEY_HEX;
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        runtime.traceAggregate.mockReturnValue(aggregation([trace]));
        runtime.userActionFind.mockReturnValue(query(Array.from({ length: 4_097 }, () => ({}))));
        process.env.RECOMMENDATION_REPLAY_PSEUDONYM_KEY_HEX = '56'.repeat(32);
        process.argv = [
            'node',
            'exportRecsysReplayRequests.ts',
            '--output',
            output,
            '--keyVersion',
            'replay-test-key-v1',
            '--captureEpochId',
            'replay-test-epoch-v1',
        ];
        process.exitCode = undefined;

        try {
            vi.resetModules();
            await import('../../src/scripts/exportRecsysReplayRequests');
            await vi.waitFor(() => expect(process.exitCode).toBe(1));
            expect(existsSync(output)).toBe(false);
            expect(error).toHaveBeenCalledWith(
                '[ExportRecsysReplay] failed:',
                expect.objectContaining({ message: 'replay_export_resource_limit_exceeded' }),
            );
        } finally {
            process.argv = originalArgv;
            process.exitCode = originalExitCode;
            if (originalPseudonymKey === undefined) {
                delete process.env.RECOMMENDATION_REPLAY_PSEUDONYM_KEY_HEX;
            } else {
                process.env.RECOMMENDATION_REPLAY_PSEUDONYM_KEY_HEX = originalPseudonymKey;
            }
            error.mockRestore();
            log.mockRestore();
            rmSync(outputDirectory, { recursive: true, force: true });
        }
    });

    it('reports reconciliation metadata when publication durability is unconfirmed', async () => {
        const { trace } = await minimalTrace(1);
        const outputDirectory = mkdtempSync(path.join(tmpdir(), 'recsys-replay-reconcile-'));
        const output = path.join(outputDirectory, 'requests.ndjson');
        const originalArgv = process.argv;
        const originalExitCode = process.exitCode;
        const originalPseudonymKey = process.env.RECOMMENDATION_REPLAY_PSEUDONYM_KEY_HEX;
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        runtime.connectReadOnlyMongo.mockClear();
        runtime.disconnectReadOnlyMongo.mockClear();
        runtime.traceAggregate.mockReturnValue(aggregation([trace]));
        runtime.userActionFind.mockReturnValue(query([]));
        process.env.RECOMMENDATION_REPLAY_PSEUDONYM_KEY_HEX = '12'.repeat(32);
        process.argv = [
            'node',
            'exportRecsysReplayRequests.ts',
            '--output',
            output,
            '--keyVersion',
            'replay-test-key-v1',
            '--captureEpochId',
            'replay-test-epoch-v1',
        ];
        process.exitCode = undefined;

        vi.resetModules();
        const { setAtomicSinkTestHooksV1 } =
            await import('../../src/services/recommendation/offlinePrediction/snapshotV2/atomicSink');
        setAtomicSinkTestHooksV1({
            syncParentDirectory: () => {
                throw new Error('forced_parent_sync_failure');
            },
        });
        try {
            await import('../../src/scripts/exportRecsysReplayRequests');
            await vi.waitFor(() => expect(runtime.disconnectReadOnlyMongo).toHaveBeenCalledOnce());
            expect(process.exitCode).toBe(1);
            expect(existsSync(output)).toBe(true);
            expect(statSync(output).mode & 0o777).toBe(0o600);
            expect(error).toHaveBeenCalledWith(
                '[ExportRecsysReplay] reconciliation_required:',
                expect.objectContaining({
                    targetPath: output,
                    finalPathMayBeVisible: true,
                    sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
                    recordCount: 1,
                    reason: 'parent_directory_sync_failed',
                }),
            );
        } finally {
            setAtomicSinkTestHooksV1(undefined);
            process.argv = originalArgv;
            process.exitCode = originalExitCode;
            if (originalPseudonymKey === undefined) {
                delete process.env.RECOMMENDATION_REPLAY_PSEUDONYM_KEY_HEX;
            } else {
                process.env.RECOMMENDATION_REPLAY_PSEUDONYM_KEY_HEX = originalPseudonymKey;
            }
            error.mockRestore();
            log.mockRestore();
            rmSync(outputDirectory, { recursive: true, force: true });
        }
    });
});
