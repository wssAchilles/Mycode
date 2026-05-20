/**
 * 运行时配置端点
 * - GET /api/ops/log-level — 获取当前日志级别
 * - PUT /api/ops/log-level — 调整日志级别（需 admin auth）
 */
import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { createChildLogger } from '../../utils/logger';

const log = createChildLogger('routes:ops:runtime');
const router = Router();

// 允许的日志级别
const VALID_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
type LogLevel = typeof VALID_LEVELS[number];

/**
 * GET /api/ops/log-level
 * 获取当前日志级别
 */
router.get('/log-level', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      level: logger.level,
      validLevels: VALID_LEVELS,
    },
  });
});

/**
 * PUT /api/ops/log-level
 * 运行时调整日志级别（需 admin auth）
 * Body: { "level": "debug" }
 */
router.put('/log-level', (req: Request, res: Response) => {
  const { level } = req.body;

  if (!level || !VALID_LEVELS.includes(level as LogLevel)) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_LEVEL',
        message: `无效的日志级别，允许值: ${VALID_LEVELS.join(', ')}`,
      },
    });
  }

  const previousLevel = logger.level;
  logger.level = level;

  log.info({ previousLevel, newLevel: level }, '日志级别已调整');

  res.json({
    success: true,
    data: {
      previousLevel,
      currentLevel: level,
    },
  });
});

export default router;
