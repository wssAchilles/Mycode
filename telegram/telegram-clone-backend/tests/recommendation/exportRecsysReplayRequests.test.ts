import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
    connectReadOnlyMongo: vi.fn(),
    disconnectReadOnlyMongo: vi.fn(),
    traceFind: vi.fn(),
    userActionFind: vi.fn(),
}));

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));
vi.mock('../../src/services/recommendation/training/readOnlyMongo', () => ({
    connectReadOnlyMongo: runtime.connectReadOnlyMongo,
    disconnectReadOnlyMongo: runtime.disconnectReadOnlyMongo,
}));
vi.mock('../../src/models/RecommendationTrace', () => ({
    default: { find: runtime.traceFind },
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

function query<T>(rows: T[]) {
    const cursor = {
        select: vi.fn(),
        sort: vi.fn(),
        limit: vi.fn(),
        lean: vi.fn().mockResolvedValue(rows),
    };
    cursor.select.mockReturnValue(cursor);
    cursor.sort.mockReturnValue(cursor);
    cursor.limit.mockReturnValue(cursor);
    return cursor;
}

describe('strict replay request exporter', () => {
    it('attributes only canonical served actions without datastore writes', async () => {
        const fixture = JSON.parse(readFileSync(path.resolve(
            __dirname,
            '../../../telegram-rust-workspace/crates/telegram-recommendation-fixtures/fixtures/decision_log_v1.json',
        ), 'utf8'));
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
        const { candidatePoolSha256 } = await import(
            '../../src/services/recommendation/decisionLog/contracts'
        );
        decisionLogV1.candidatePool.candidatePoolSha256 = candidatePoolSha256(
            decisionLogV1.candidatePool.candidates,
        );
        runtime.traceFind.mockReturnValue(query([{
            requestId: decisionLogV1.requestId,
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
            candidates: [{
                postId: servedPostId,
                modelPostId: servedPostId,
                authorId: 'served-author',
                rank: 1,
                recallSource: 'FollowingSource',
                inNetwork: true,
                isNews: false,
            }],
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
        }]));
        runtime.userActionFind.mockReturnValue(query([
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
        ]));

        const outputDirectory = mkdtempSync(path.join(tmpdir(), 'recsys-replay-export-'));
        const output = path.join(outputDirectory, 'requests.ndjson');
        const originalArgv = process.argv;
        const originalExitCode = process.exitCode;
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        process.argv = [
            'node',
            'exportRecsysReplayRequests.ts',
            '--days',
            '1',
            '--windowHours',
            '1',
            '--output',
            output,
        ];
        process.exitCode = undefined;

        try {
            await import('../../src/scripts/exportRecsysReplayRequests');
            await vi.waitFor(() => expect(runtime.disconnectReadOnlyMongo).toHaveBeenCalledOnce());
            await vi.waitFor(() => expect(readFileSync(output, 'utf8').trim()).not.toBe(''));

            expect(runtime.traceFind.mock.calls[0][0]).toHaveProperty(
                'decisionLogV1.decisionAt',
            );
            expect(runtime.traceFind.mock.calls[0][0]).not.toHaveProperty('createdAt');
            expect(runtime.userActionFind.mock.calls[0][0]).toMatchObject({
                'metadata.decisionId': { $in: [decisionLogV1.decisionId] },
            });
            expect(runtime.userActionFind.mock.calls[0][0]).not.toHaveProperty('targetPostId');
            expect(runtime.userActionFind.mock.calls[0][0]).not.toHaveProperty('userId');

            const request = JSON.parse(readFileSync(output, 'utf8'));
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
            expect(error).not.toHaveBeenCalled();
            expect(process.exitCode).toBeUndefined();
        } finally {
            process.argv = originalArgv;
            process.exitCode = originalExitCode;
            error.mockRestore();
            log.mockRestore();
            rmSync(outputDirectory, { recursive: true, force: true });
        }
    });
});
