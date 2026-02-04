/**
 * Key Routes - Signal Protocol 密钥管理 API
 */
import { Router, Request, Response, NextFunction } from 'express';
import { keyService } from '../services/keyService';
import { sendSuccess, errors } from '../utils/apiResponse';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

// 所有密钥路由需要认证
router.use(authenticateToken);

/**
 * PUT /api/keys
 * 上传/更新用户密钥包
 */
router.put('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = (req as any).user.id;
        const {
            registrationId,
            identityKey,
            signedPreKeyId,
            signedPreKey,
            signedPreKeySig,
            oneTimePreKeys,
        } = req.body;

        // 验证必填字段
        if (!registrationId || !identityKey || !signedPreKey || !signedPreKeySig) {
            return errors.badRequest(res, '缺少必要的密钥字段');
        }

        const result = await keyService.uploadKeys({
            userId,
            registrationId,
            identityKey,
            signedPreKeyId: signedPreKeyId || 1,
            signedPreKey,
            signedPreKeySig,
            oneTimePreKeys,
        });

        return sendSuccess(res, result, {
            message: '密钥上传成功',
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/keys/:userId
 * 获取指定用户的密钥包 (用于建立会话)
 */
router.get('/:userId', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { userId } = req.params;
        const requesterId = (req as any).user.id;

        // 不能获取自己的密钥包
        if (userId === requesterId) {
            return errors.badRequest(res, '不能获取自己的密钥包');
        }

        const bundle = await keyService.getPreKeyBundle(userId);

        if (!bundle) {
            return errors.notFound(res, '用户密钥');
        }

        return sendSuccess(res, bundle);
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/keys/count/me
 * 获取当前用户的预密钥数量
 */
router.get('/count/me', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = (req as any).user.id;
        const result = await keyService.getPreKeyCount(userId);

        return sendSuccess(res, result);
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/keys/prekeys
 * 补充一次性预密钥
 */
router.post('/prekeys', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = (req as any).user.id;
        const { preKeys } = req.body;

        if (!preKeys || !Array.isArray(preKeys) || preKeys.length === 0) {
            return errors.badRequest(res, '缺少预密钥数组');
        }

        const addedCount = await keyService.replenishPreKeys(userId, preKeys);

        return sendSuccess(res, {
            added: addedCount,
            total: (await keyService.getPreKeyCount(userId)).count,
        }, {
            message: `成功添加 ${addedCount} 个预密钥`,
        });
    } catch (err) {
        next(err);
    }
});

/**
 * PUT /api/keys/signed-prekey
 * 更新 Signed PreKey
 */
router.put('/signed-prekey', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = (req as any).user.id;
        const { signedPreKeyId, signedPreKey, signedPreKeySig } = req.body;

        if (!signedPreKey || !signedPreKeySig) {
            return errors.badRequest(res, '缺少签名预密钥字段');
        }

        const updated = await keyService.updateSignedPreKey(
            userId,
            signedPreKeyId || 1,
            signedPreKey,
            signedPreKeySig
        );

        if (!updated) {
            return errors.notFound(res, '用户密钥');
        }

        return sendSuccess(res, { updated: true }, {
            message: 'Signed PreKey 更新成功',
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/keys/status/me
 * 检查当前用户的密钥状态
 */
router.get('/status/me', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = (req as any).user.id;

        const [hasKeys, preKeyStatus] = await Promise.all([
            keyService.hasKeys(userId),
            keyService.getPreKeyCount(userId),
        ]);

        return sendSuccess(res, {
            hasIdentityKey: hasKeys,
            preKeyCount: preKeyStatus.count,
            needsRefill: preKeyStatus.needsRefill,
        });
    } catch (err) {
        next(err);
    }
});

export default router;
