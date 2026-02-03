import { Router, Request, Response } from 'express';
import { newsService } from '../services/newsService';

const router = Router();

router.post('/ingest', async (req: Request, res: Response) => {
  try {
    const { articles } = req.body;
    if (!Array.isArray(articles)) {
      return res.status(400).json({ error: 'articles must be an array' });
    }
    const count = await newsService.ingestArticles(articles);
    return res.json({ success: true, count });
  } catch (error) {
    console.error('新闻入库失败:', error);
    return res.status(500).json({ error: '新闻入库失败' });
  }
});

router.get('/feed', async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId?: string }).userId;
    if (!userId) {
      return res.status(401).json({ error: '未授权' });
    }
    const limit = parseInt(req.query.limit as string) || 10;
    const cursorRaw = req.query.cursor as string | undefined;
    const cursor = cursorRaw ? new Date(cursorRaw) : undefined;
    const safeCursor = cursor && !isNaN(cursor.getTime()) ? cursor : undefined;
    const result = await newsService.getFeed(userId, limit, safeCursor);
    return res.json(result);
  } catch (error) {
    console.error('获取新闻 Feed 失败:', error);
    return res.status(500).json({ error: '获取新闻 Feed 失败' });
  }
});

router.get('/articles/:id', async (req: Request, res: Response) => {
  try {
    const article = await newsService.getArticle(req.params.id);
    if (!article) {
      return res.status(404).json({ error: '新闻不存在' });
    }
    return res.json({ article });
  } catch (error) {
    console.error('获取新闻详情失败:', error);
    return res.status(500).json({ error: '获取新闻详情失败' });
  }
});

router.get('/topics', async (_req: Request, res: Response) => {
  try {
    const topics = await newsService.getTopics();
    return res.json({ topics });
  } catch (error) {
    console.error('获取新闻话题失败:', error);
    return res.status(500).json({ error: '获取新闻话题失败' });
  }
});

router.post('/events', async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId?: string }).userId;
    if (!userId) {
      return res.status(401).json({ error: '未授权' });
    }
    const { newsId, eventType, dwellMs } = req.body as { newsId?: string; eventType?: string; dwellMs?: number };
    if (!newsId || !eventType) {
      return res.status(400).json({ error: 'newsId and eventType required' });
    }
    await newsService.logEvent(userId, newsId, eventType as any, dwellMs);
    return res.status(201).json({ success: true });
  } catch (error) {
    console.error('记录新闻事件失败:', error);
    return res.status(500).json({ error: '记录新闻事件失败' });
  }
});

export default router;
