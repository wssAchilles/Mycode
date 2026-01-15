/**
 * CryptoService - 端到端加密服务
 * 使用 TweetNaCl 实现 X25519 密钥交换和 XSalsa20-Poly1305 加密
 */
import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } from 'tweetnacl-util';
import { signalKeyStore } from './signalKeyStore';
import type { IdentityKeyPair, SignedPreKey, PreKey } from './signalKeyStore';
import apiClient from './apiClient';

// 密钥包接口
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

// 加密消息接口
export interface EncryptedMessage {
    type: number;       // 1 = 首条消息 (包含密钥材料), 3 = 后续消息
    body: string;       // Base64 编码的密文
    registrationId: number;
}

// 会话状态接口
interface SessionState {
    sharedKey: Uint8Array;
    sendingChainKey: Uint8Array;
    receivingChainKey: Uint8Array;
    sendCounter: number;
    receiveCounter: number;
    remoteIdentityKey: Uint8Array;
}

/**
 * 加密服务类
 */
class CryptoService {
    /**
     * 生成初始密钥 (注册时调用)
     */
    async generateInitialKeys(): Promise<{
        registrationId: number;
        identityKey: IdentityKeyPair;
        signedPreKey: SignedPreKey;
        preKeys: PreKey[];
    }> {
        // 生成 Registration ID (1 到 16380 之间)
        const registrationId = Math.floor(Math.random() * 16380) + 1;

        // 生成 Identity Key (长期密钥对)
        const identityKeyPair = nacl.box.keyPair();
        const identityKey: IdentityKeyPair = {
            publicKey: identityKeyPair.publicKey,
            privateKey: identityKeyPair.secretKey,
        };

        // 生成 Signed PreKey (中期密钥对)
        const signedPreKeyPair = nacl.box.keyPair();
        const signedPreKeyId = 1;

        // 使用 Ed25519 签名 (这里用 box key 模拟，实际应使用 sign key)
        const signKeyPair = nacl.sign.keyPair();
        const signature = nacl.sign.detached(signedPreKeyPair.publicKey, signKeyPair.secretKey);

        const signedPreKey: SignedPreKey = {
            keyId: signedPreKeyId,
            keyPair: {
                publicKey: signedPreKeyPair.publicKey,
                privateKey: signedPreKeyPair.secretKey,
            },
            signature,
        };

        // 生成 100 个 One-Time PreKeys
        const preKeys: PreKey[] = [];
        for (let i = 1; i <= 100; i++) {
            const preKeyPair = nacl.box.keyPair();
            preKeys.push({
                keyId: i,
                keyPair: {
                    publicKey: preKeyPair.publicKey,
                    privateKey: preKeyPair.secretKey,
                },
            });
        }

        // 存储到 IndexedDB
        await signalKeyStore.setRegistrationId(registrationId);
        await signalKeyStore.setIdentityKeyPair(identityKey);
        await signalKeyStore.setSignedPreKey(signedPreKey);
        for (const preKey of preKeys) {
            await signalKeyStore.setPreKey(preKey);
        }

        return {
            registrationId,
            identityKey,
            signedPreKey,
            preKeys,
        };
    }

    /**
     * 上传密钥到服务器
     */
    async uploadKeysToServer(): Promise<void> {
        const [registrationId, identityKey, signedPreKeyIds, preKeyIds] = await Promise.all([
            signalKeyStore.getRegistrationId(),
            signalKeyStore.getIdentityKeyPair(),
            signalKeyStore.getAllSignedPreKeyIds(),
            signalKeyStore.getAllPreKeyIds(),
        ]);

        if (!registrationId || !identityKey) {
            throw new Error('密钥未初始化');
        }

        const signedPreKey = await signalKeyStore.getSignedPreKey(signedPreKeyIds[0]);
        if (!signedPreKey) {
            throw new Error('Signed PreKey 不存在');
        }

        // 获取所有 PreKeys
        const oneTimePreKeys: Array<{ keyId: number; publicKey: string }> = [];
        for (const keyId of preKeyIds) {
            const preKey = await signalKeyStore.getPreKey(keyId);
            if (preKey) {
                oneTimePreKeys.push({
                    keyId: preKey.keyId,
                    publicKey: encodeBase64(preKey.keyPair.publicKey),
                });
            }
        }

        // 上传到服务器
        await apiClient.put('/api/keys', {
            registrationId,
            identityKey: encodeBase64(identityKey.publicKey),
            signedPreKeyId: signedPreKey.keyId,
            signedPreKey: encodeBase64(signedPreKey.keyPair.publicKey),
            signedPreKeySig: encodeBase64(signedPreKey.signature),
            oneTimePreKeys,
        });
    }

    /**
     * 建立加密会话 (X3DH 简化版)
     */
    async establishSession(recipientId: string): Promise<void> {
        // 检查是否已有会话
        if (await signalKeyStore.hasSession(recipientId, 1)) {
            return;
        }

        // 获取对方的密钥包
        const response = await apiClient.get(`/api/keys/${recipientId}`);
        const bundle: PreKeyBundle = response.data.data;

        // 获取本地 Identity Key
        const localIdentity = await signalKeyStore.getIdentityKeyPair();
        if (!localIdentity) {
            throw new Error('本地密钥未初始化');
        }

        // 解码对方的公钥
        const remoteIdentityKey = decodeBase64(bundle.identityKey);
        const remoteSignedPreKey = decodeBase64(bundle.signedPreKey);

        // 生成临时密钥对
        const ephemeralKeyPair = nacl.box.keyPair();

        // 执行 X25519 密钥交换 (简化版 X3DH)
        // DH1 = DH(IK_A, SPK_B)
        const dh1 = nacl.box.before(remoteSignedPreKey, localIdentity.privateKey);

        // DH2 = DH(EK_A, IK_B)
        const dh2 = nacl.box.before(remoteIdentityKey, ephemeralKeyPair.secretKey);

        // DH3 = DH(EK_A, SPK_B)
        const dh3 = nacl.box.before(remoteSignedPreKey, ephemeralKeyPair.secretKey);

        // 组合得到共享密钥 (简化: 直接 XOR)
        const sharedKey = new Uint8Array(32);
        for (let i = 0; i < 32; i++) {
            sharedKey[i] = dh1[i] ^ dh2[i] ^ dh3[i];
        }

        // 存储会话状态
        const sessionState: SessionState = {
            sharedKey,
            sendingChainKey: sharedKey,
            receivingChainKey: sharedKey,
            sendCounter: 0,
            receiveCounter: 0,
            remoteIdentityKey,
        };

        await signalKeyStore.setSession(
            recipientId,
            1,
            JSON.stringify({
                ...sessionState,
                sharedKey: encodeBase64(sharedKey),
                sendingChainKey: encodeBase64(sharedKey),
                receivingChainKey: encodeBase64(sharedKey),
                remoteIdentityKey: encodeBase64(remoteIdentityKey),
            })
        );

        // 存储对方的 Identity Key 用于身份验证
        await signalKeyStore.setTrustedIdentity(recipientId, remoteIdentityKey);
    }

    /**
     * 加密消息
     */
    async encrypt(recipientId: string, plaintext: string): Promise<EncryptedMessage> {
        // 确保会话存在
        await this.establishSession(recipientId);

        // 获取会话状态
        const sessionJson = await signalKeyStore.getSession(recipientId, 1);
        if (!sessionJson) {
            throw new Error('会话不存在');
        }

        const session = JSON.parse(sessionJson);
        const sendingKey = decodeBase64(session.sendingChainKey);

        // 生成随机 nonce
        const nonce = nacl.randomBytes(24);

        // 加密消息
        const messageBytes = decodeUTF8(plaintext);
        const ciphertext = nacl.secretbox(messageBytes, nonce, sendingKey);

        // 组合 nonce + ciphertext
        const combined = new Uint8Array(nonce.length + ciphertext.length);
        combined.set(nonce);
        combined.set(ciphertext, nonce.length);

        // 更新会话计数器
        session.sendCounter += 1;
        await signalKeyStore.setSession(recipientId, 1, JSON.stringify(session));

        const registrationId = await signalKeyStore.getRegistrationId();

        return {
            type: session.sendCounter === 1 ? 1 : 3, // 首条消息类型为 1
            body: encodeBase64(combined),
            registrationId: registrationId || 0,
        };
    }

    /**
     * 解密消息
     */
    async decrypt(senderId: string, encrypted: EncryptedMessage): Promise<string> {
        // 获取会话状态
        const sessionJson = await signalKeyStore.getSession(senderId, 1);
        if (!sessionJson) {
            throw new Error('会话不存在，无法解密');
        }

        const session = JSON.parse(sessionJson);
        const receivingKey = decodeBase64(session.receivingChainKey);

        // 解码消息
        const combined = decodeBase64(encrypted.body);

        // 分离 nonce 和 ciphertext
        const nonce = combined.slice(0, 24);
        const ciphertext = combined.slice(24);

        // 解密
        const plaintext = nacl.secretbox.open(ciphertext, nonce, receivingKey);
        if (!plaintext) {
            throw new Error('解密失败：消息已损坏或密钥不匹配');
        }

        // 更新会话计数器
        session.receiveCounter += 1;
        await signalKeyStore.setSession(senderId, 1, JSON.stringify(session));

        return encodeUTF8(plaintext);
    }

    /**
     * 检查并补充预密钥
     */
    async replenishPreKeysIfNeeded(): Promise<void> {
        const preKeyIds = await signalKeyStore.getAllPreKeyIds();

        if (preKeyIds.length < 20) {
            // 生成更多预密钥
            const newPreKeys: Array<{ keyId: number; publicKey: string }> = [];
            const startId = Math.max(...preKeyIds, 0) + 1;

            for (let i = 0; i < 50; i++) {
                const keyId = startId + i;
                const keyPair = nacl.box.keyPair();

                await signalKeyStore.setPreKey({
                    keyId,
                    keyPair: {
                        publicKey: keyPair.publicKey,
                        privateKey: keyPair.secretKey,
                    },
                });

                newPreKeys.push({
                    keyId,
                    publicKey: encodeBase64(keyPair.publicKey),
                });
            }

            // 上传到服务器
            await apiClient.post('/api/keys/prekeys', { preKeys: newPreKeys });
        }
    }

    /**
     * 检查是否已初始化
     */
    async isInitialized(): Promise<boolean> {
        return signalKeyStore.isInitialized();
    }

    /**
     * 清除所有密钥 (登出)
     */
    async clearKeys(): Promise<void> {
        await signalKeyStore.clearAll();
    }
}

// 导出单例
export const cryptoService = new CryptoService();
export default cryptoService;
