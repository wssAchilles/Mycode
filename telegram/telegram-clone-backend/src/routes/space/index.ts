/**
 * Space API router — aggregates all sub-route modules.
 *
 * Preserves every original route path under /api/space/ without breaking
 * existing API contracts.
 */

import { Router } from 'express';
import postsRouter from './posts';
import feedRouter from './feed';
import interactionsRouter from './interactions';
import profilesRouter from './profiles';
import socialRouter from './social';
import newsRouter from './news';
import searchRouter from './search';

const router = Router();

// Disable caching for all Space APIs
router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    next();
});

// Mount sub-routers (order matters — more specific paths first)
router.use('/', newsRouter);        // /posts/batch-news, /news/*, /news/cluster/:id
router.use('/', postsRouter);       // /posts, /posts/batch, /posts/:id, /posts/:id/pin
router.use('/', interactionsRouter); // /posts/:id/like, /repost, /comments, /not-interested, /hide, /report
router.use('/', feedRouter);        // /feed
router.use('/', profilesRouter);    // /users/:id/profile, /posts, /likes, /cover, /avatar
router.use('/', socialRouter);      // /users/:id/follow, /block, /mute
router.use('/', searchRouter);      // /search, /topics/:tag/posts, /trends, /recommend/users, /notifications

export default router;
