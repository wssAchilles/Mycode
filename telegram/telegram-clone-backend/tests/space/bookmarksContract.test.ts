import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import PostBookmark from '../../src/models/PostBookmark';
import interactionsRouter from '../../src/routes/space/interactions';

describe('PostBookmark model & Space bookmark routes contract', () => {
    it('defines unique userId + postId compound index on PostBookmark schema', () => {
        const indexes = PostBookmark.schema.indexes();
        const hasUniqueComposite = indexes.some(
            ([fields, options]) =>
                fields.userId === 1 &&
                fields.postId === 1 &&
                options?.unique === true,
        );
        expect(hasUniqueComposite).toBe(true);

        const doc = new PostBookmark({
            userId: 'user-1',
            postId: new mongoose.Types.ObjectId('507f191e810c19729de89011'),
        });
        expect(doc.userId).toBe('user-1');
    });

    it('registers POST/DELETE /posts/:id/bookmark and GET /bookmarks on interactions router', () => {
        const routes = (interactionsRouter as any).stack
            .filter((layer: any) => layer.route)
            .map((layer: any) => ({
                path: layer.route.path,
                methods: Object.keys(layer.route.methods),
            }));

        expect(routes).toContainEqual({ path: '/posts/:id/bookmark', methods: ['post'] });
        expect(routes).toContainEqual({ path: '/posts/:id/bookmark', methods: ['delete'] });
        expect(routes).toContainEqual({ path: '/bookmarks', methods: ['get'] });
    });
});
