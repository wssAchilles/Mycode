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
});
