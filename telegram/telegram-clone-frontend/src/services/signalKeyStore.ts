/**
 * SignalKeyStore - IndexedDB 密钥存储
 * 使用 idb-keyval 存储 Signal Protocol 密钥
 */
import { get, set, del, keys, createStore } from 'idb-keyval';

// 创建专用的 IndexedDB store
const keyStore = createStore('signal-keys', 'keystore');

// 密钥类型定义
export interface IdentityKeyPair {
    publicKey: Uint8Array;
    privateKey: Uint8Array;
}

export interface SignedPreKey {
    keyId: number;
    keyPair: {
        publicKey: Uint8Array;
        privateKey: Uint8Array;
    };
    signature: Uint8Array;
}

export interface PreKey {
    keyId: number;
    keyPair: {
        publicKey: Uint8Array;
        privateKey: Uint8Array;
    };
}

export interface SessionRecord {
    recipientId: string;
    deviceId: number;
    session: string; // 序列化的会话状态
}

/**
 * 密钥存储服务
 */
class SignalKeyStore {
    // ========== Registration ID ==========

    async getRegistrationId(): Promise<number | undefined> {
        return get<number>('registrationId', keyStore);
    }

    async setRegistrationId(id: number): Promise<void> {
        await set('registrationId', id, keyStore);
    }

    // ========== Identity Key ==========

    async getIdentityKeyPair(): Promise<IdentityKeyPair | undefined> {
        return get<IdentityKeyPair>('identityKey', keyStore);
    }

    async setIdentityKeyPair(keyPair: IdentityKeyPair): Promise<void> {
        await set('identityKey', keyPair, keyStore);
    }

    // ========== Signed PreKey ==========

    async getSignedPreKey(keyId: number): Promise<SignedPreKey | undefined> {
        return get<SignedPreKey>(`signedPreKey:${keyId}`, keyStore);
    }

    async setSignedPreKey(key: SignedPreKey): Promise<void> {
        await set(`signedPreKey:${key.keyId}`, key, keyStore);
    }

    async getAllSignedPreKeyIds(): Promise<number[]> {
        const allKeys = await keys(keyStore);
        return allKeys
            .filter((k) => String(k).startsWith('signedPreKey:'))
            .map((k) => parseInt(String(k).split(':')[1], 10));
    }

    // ========== One-Time PreKeys ==========

    async getPreKey(keyId: number): Promise<PreKey | undefined> {
        return get<PreKey>(`preKey:${keyId}`, keyStore);
    }

    async setPreKey(key: PreKey): Promise<void> {
        await set(`preKey:${key.keyId}`, key, keyStore);
    }

    async removePreKey(keyId: number): Promise<void> {
        await del(`preKey:${keyId}`, keyStore);
    }

    async getAllPreKeyIds(): Promise<number[]> {
        const allKeys = await keys(keyStore);
        return allKeys
            .filter((k) => String(k).startsWith('preKey:'))
            .map((k) => parseInt(String(k).split(':')[1], 10));
    }

    // ========== Sessions ==========

    async getSession(recipientId: string, deviceId: number): Promise<string | undefined> {
        return get<string>(`session:${recipientId}:${deviceId}`, keyStore);
    }

    async setSession(recipientId: string, deviceId: number, session: string): Promise<void> {
        await set(`session:${recipientId}:${deviceId}`, session, keyStore);
    }

    async removeSession(recipientId: string, deviceId: number): Promise<void> {
        await del(`session:${recipientId}:${deviceId}`, keyStore);
    }

    async hasSession(recipientId: string, deviceId: number): Promise<boolean> {
        const session = await this.getSession(recipientId, deviceId);
        return !!session;
    }

    // ========== Trusted Identity Keys ==========

    async getTrustedIdentity(userId: string): Promise<Uint8Array | undefined> {
        return get<Uint8Array>(`identity:${userId}`, keyStore);
    }

    async setTrustedIdentity(userId: string, identityKey: Uint8Array): Promise<void> {
        await set(`identity:${userId}`, identityKey, keyStore);
    }

    // ========== 工具方法 ==========

    /**
     * 检查是否已初始化密钥
     */
    async isInitialized(): Promise<boolean> {
        const [regId, identity] = await Promise.all([
            this.getRegistrationId(),
            this.getIdentityKeyPair(),
        ]);
        return !!regId && !!identity;
    }

    /**
     * 清除所有密钥 (登出时使用)
     */
    async clearAll(): Promise<void> {
        const allKeys = await keys(keyStore);
        for (const key of allKeys) {
            await del(key, keyStore);
        }
    }
}

// 导出单例
export const signalKeyStore = new SignalKeyStore();
export default signalKeyStore;
