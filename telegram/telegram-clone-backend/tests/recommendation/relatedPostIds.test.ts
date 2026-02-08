import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';

import { getRelatedPostIds } from '../../src/services/recommendation/utils/relatedPostIds';

const oid = (hex: string) => new mongoose.Types.ObjectId(hex);

describe('getRelatedPostIds', () => {
    it('returns ids in stable order and removes duplicates', () => {
        const postId = oid('507f191e810c19729de860ea');
        const originalPostId = oid('507f191e810c19729de860eb');
        const replyToPostId = oid('507f191e810c19729de860ec');
        const conversationId = oid('507f191e810c19729de860ed');

        const candidate = {
            postId,
            originalPostId,
            replyToPostId,
            conversationId,
        } as any;

        expect(getRelatedPostIds(candidate)).toEqual([
            postId.toString(),
            originalPostId.toString(),
            replyToPostId.toString(),
            conversationId.toString(),
        ]);
    });

    it('does not include missing fields', () => {
        const postId = oid('507f191e810c19729de860ee');
        const candidate = { postId } as any;
        expect(getRelatedPostIds(candidate)).toEqual([postId.toString()]);
    });

    it('dedups when fields point to the same id', () => {
        const postId = oid('507f191e810c19729de860ef');
        const candidate = {
            postId,
            originalPostId: postId,
            replyToPostId: postId,
            conversationId: postId,
        } as any;
        expect(getRelatedPostIds(candidate)).toEqual([postId.toString()]);
    });
});

