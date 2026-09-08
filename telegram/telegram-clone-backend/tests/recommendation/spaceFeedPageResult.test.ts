import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { buildSpaceFeedPageResult } from '../../src/services/recommendation/feed/pageResult';
import type { FeedCandidate } from '../../src/services/recommendation/types/FeedCandidate';

function candidate(overrides: Partial<FeedCandidate> = {}): FeedCandidate {
    return {
        postId: new mongoose.Types.ObjectId(),
        authorId: 'author-a',
        content: 'hello',
        createdAt: new Date('2026-05-04T00:00:00.000Z'),
        isReply: false,
        isRepost: false,
        recallSource: 'GraphSource',
        retrievalLane: 'social_expansion',
        inNetwork: false,
        ...overrides,
    };
}

describe('buildSpaceFeedPageResult', () => {
    it('caps served candidates and context at the requested page limit', () => {
        const postId = new mongoose.Types.ObjectId();
        const overflowPostId = new mongoose.Types.ObjectId();
        const conversationId = new mongoose.Types.ObjectId();
        const page = buildSpaceFeedPageResult(
            [
                candidate({
                    postId,
                    authorId: 'Author-A',
                    recallSource: 'GraphSource',
                    conversationId,
                }),
                candidate({
                    postId: overflowPostId,
                    authorId: 'Author-B',
                    createdAt: new Date('2026-05-03T00:00:00.000Z'),
                }),
            ],
            1,
            {
                requestId: '3bcd1f9b-9800-4bb6-8592-4338d56bf4ae',
                decisionId: 'fd3b9c5a-4208-4181-8f02-a1c20f141625',
                decisionActionCandidateIds: [postId.toString(), overflowPostId.toString()],
                hasMore: false,
                nextCursor: '2026-05-03T00:00:00.000Z',
            },
        );

        expect(page.decisionId).toBe('fd3b9c5a-4208-4181-8f02-a1c20f141625');
        expect(page.candidates).toHaveLength(1);
        expect(page.hasMore).toBe(true);
        expect(page.nextCursor).toBe('2026-05-04T00:00:00.000Z');
        expect(page.decisionActionCandidateIds).toEqual([postId.toString()]);
        expect(page.servedIdsDelta).toEqual([
            postId.toString(),
            conversationId.toString(),
            'author:author-a',
            'source:graphsource',
            `topic:conversation:${conversationId.toString().toLowerCase()}`,
        ]);
    });

    it('does not synthesize a cursor after ranked continuation abstains', () => {
        const page = buildSpaceFeedPageResult(
            [
                candidate(),
                candidate({ createdAt: new Date('2026-05-03T00:00:00.000Z') }),
            ],
            1,
            {
                requestId: '770b3f5a-b5d9-4228-8411-cd7e54b4f955',
                decisionId: '71d48f31-6cd4-4329-bcd2-2e5ca38ac3a1',
                hasMore: true,
                nextCursor: '2026-05-03T00:00:00.000Z',
                continuationAbstained: true,
            },
        );

        expect(page.candidates).toHaveLength(1);
        expect(page.hasMore).toBe(false);
        expect(page.nextCursor).toBeUndefined();
    });

    it('fails closed when metadata claims more without a cursor', () => {
        const page = buildSpaceFeedPageResult(
            [],
            1,
            {
                requestId: 'b44b0ce0-c7f6-4ae4-8f0c-7b4e3645c4e2',
                decisionId: 'd6c8a84a-1110-4fba-9aaf-7d8a3bcf26f0',
                hasMore: true,
            },
        );

        expect(page.hasMore).toBe(false);
        expect(page.nextCursor).toBeUndefined();
    });

    it('strips an orphan cursor when metadata says the page is complete', () => {
        const page = buildSpaceFeedPageResult(
            [candidate()],
            1,
            {
                requestId: 'a4e0de2e-251d-4a6e-91e0-1f4ac9ce6f63',
                decisionId: '4ff4bca0-4f50-46c6-8a88-7df8f88b3c95',
                hasMore: false,
                nextCursor: '2026-05-03T00:00:00.000Z',
            },
        );

        expect(page.hasMore).toBe(false);
        expect(page.nextCursor).toBeUndefined();
    });
});
