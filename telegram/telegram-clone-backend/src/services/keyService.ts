/**
 * KeyService - Signal Protocol 密钥管理服务
 * 处理用户密钥包的上传、获取和管理
 */
import UserKey, { IUserKey } from '../models/UserKey';
import OneTimePreKey, { IOneTimePreKey } from '../models/OneTimePreKey';

// 密钥包接口 (用于 X3DH 密钥协商)
export interface PreKeyBundle {
    registrationId: number;
    identityKey: string;
    signedPreKeyId: number;
    signedPreKey: string;
    signedPreKeySig: string;
    oneTimePreKey?: {
        keyId: number;
        publicKey: string;
    };
}

// 上传密钥包参数
export interface UploadKeysParams {
    userId: string;
    registrationId: number;
    identityKey: string;
    signedPreKeyId: number;
    signedPreKey: string;
    signedPreKeySig: string;
    oneTimePreKeys?: Array<{
        keyId: number;
        publicKey: string;
    }>;
}

// 预密钥数量警告阈值
const LOW_PREKEY_THRESHOLD = 20;

class KeyService {
    /**
     * 上传/更新用户密钥包
     */
    async uploadKeys(params: UploadKeysParams): Promise<{
        success: boolean;
        preKeyCount: number;
    }> {
        // 更新或创建 UserKey
        await UserKey.upsert({
            userId: params.userId,
            registrationId: params.registrationId,
            identityKey: params.identityKey,
            signedPreKeyId: params.signedPreKeyId,
            signedPreKey: params.signedPreKey,
            signedPreKeySig: params.signedPreKeySig,
        });

        // 添加一次性预密钥
        let preKeyCount = 0;
        if (params.oneTimePreKeys && params.oneTimePreKeys.length > 0) {
            await OneTimePreKey.addKeys(params.userId, params.oneTimePreKeys);
        }

        preKeyCount = await OneTimePreKey.countKeys(params.userId);

        return {
            success: true,
            preKeyCount,
        };
    }

    /**
     * 获取用户密钥包 (用于建立会话)
     * 会消费一个一次性预密钥
     */
    async getPreKeyBundle(targetUserId: string): Promise<PreKeyBundle | null> {
        const userKey = await UserKey.findOne({
            where: { userId: targetUserId },
        });

        if (!userKey) {
            return null;
        }

        // 尝试消费一个一次性预密钥
        const oneTimeKey = await OneTimePreKey.consumeKey(targetUserId);

        const bundle: PreKeyBundle = {
            registrationId: userKey.registrationId,
            identityKey: userKey.identityKey,
            signedPreKeyId: userKey.signedPreKeyId,
            signedPreKey: userKey.signedPreKey,
            signedPreKeySig: userKey.signedPreKeySig,
        };

        if (oneTimeKey) {
            bundle.oneTimePreKey = {
                keyId: oneTimeKey.keyId,
                publicKey: oneTimeKey.publicKey,
            };
        }

        return bundle;
    }

    /**
     * 获取用户剩余预密钥数量
     */
    async getPreKeyCount(userId: string): Promise<{
        count: number;
        needsRefill: boolean;
    }> {
        const count = await OneTimePreKey.countKeys(userId);
        return {
            count,
            needsRefill: count < LOW_PREKEY_THRESHOLD,
        };
    }

    /**
     * 检查用户是否已上传密钥
     */
    async hasKeys(userId: string): Promise<boolean> {
        const userKey = await UserKey.findOne({
            where: { userId },
            attributes: ['id'],
        });
        return !!userKey;
    }

    /**
     * 更新 Signed PreKey
     */
    async updateSignedPreKey(
        userId: string,
        signedPreKeyId: number,
        signedPreKey: string,
        signedPreKeySig: string
    ): Promise<boolean> {
        const [updated] = await UserKey.update(
            {
                signedPreKeyId,
                signedPreKey,
                signedPreKeySig,
            },
            {
                where: { userId },
            }
        );

        return updated > 0;
    }

    /**
     * 补充一次性预密钥
     */
    async replenishPreKeys(
        userId: string,
        keys: Array<{ keyId: number; publicKey: string }>
    ): Promise<number> {
        return OneTimePreKey.addKeys(userId, keys);
    }

    /**
     * 删除用户所有密钥 (账号删除时调用)
     */
    async deleteAllKeys(userId: string): Promise<void> {
        await Promise.all([
            UserKey.destroy({ where: { userId } }),
            OneTimePreKey.destroy({ where: { userId } }),
        ]);
    }
}

// 导出单例
export const keyService = new KeyService();
export default keyService;
