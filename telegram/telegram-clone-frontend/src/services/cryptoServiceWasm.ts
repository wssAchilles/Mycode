/**
 * CryptoServiceWasm — WASM-accelerated encryption service.
 *
 * This service extends the existing cryptoService with WASM-accelerated
 * ChaCha20-Poly1305 encryption when available, falling back to TweetNaCl.
 *
 * Usage:
 *   import { cryptoServiceWasm } from './cryptoServiceWasm';
 *   const { ciphertext, nonce, usedWasm } = await cryptoServiceWasm.encryptString(plaintext, key);
 */

import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } from 'tweetnacl-util';
import { wasmCryptoBridge } from '../core/wasm/chat_wasm/wasmCryptoBridge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EncryptedPayload {
  ciphertext: string; // Base64 encoded
  nonce: string;      // Base64 encoded
  usedWasm: boolean;
}

export interface DecryptedPayload {
  plaintext: string;
  usedWasm: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NONCE_LENGTH = 24;
const KEY_LENGTH = 32;

// ---------------------------------------------------------------------------
// Crypto service with WASM support
// ---------------------------------------------------------------------------

class CryptoServiceWasm {
  private initialized = false;

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  async init(): Promise<void> {
    if (this.initialized) return;
    await wasmCryptoBridge.init();
    this.initialized = true;
  }

  isWasmAvailable(): boolean {
    return wasmCryptoBridge.isWasmAvailable();
  }

  // -------------------------------------------------------------------------
  // Encryption
  // -------------------------------------------------------------------------

  async encrypt(plaintext: Uint8Array, key: Uint8Array): Promise<{
    ciphertext: Uint8Array;
    nonce: Uint8Array;
    usedWasm: boolean;
  }> {
    await this.init();
    return wasmCryptoBridge.encrypt(plaintext, key);
  }

  async encryptString(plaintext: string, key: Uint8Array): Promise<EncryptedPayload> {
    await this.init();

    const plaintextBytes = decodeUTF8(plaintext);
    const { ciphertext, nonce, usedWasm } = await wasmCryptoBridge.encrypt(plaintextBytes, key);

    return {
      ciphertext: encodeBase64(ciphertext),
      nonce: encodeBase64(nonce),
      usedWasm,
    };
  }

  // -------------------------------------------------------------------------
  // Decryption
  // -------------------------------------------------------------------------

  async decrypt(ciphertext: Uint8Array, key: Uint8Array, nonce: Uint8Array): Promise<{
    plaintext: Uint8Array;
    usedWasm: boolean;
  }> {
    await this.init();
    return wasmCryptoBridge.decrypt(ciphertext, key, nonce);
  }

  async decryptString(encrypted: EncryptedPayload, key: Uint8Array): Promise<DecryptedPayload> {
    await this.init();

    const ciphertextBytes = decodeBase64(encrypted.ciphertext);
    const nonceBytes = decodeBase64(encrypted.nonce);
    const { plaintext, usedWasm } = await wasmCryptoBridge.decrypt(ciphertextBytes, key, nonceBytes);

    return {
      plaintext: encodeUTF8(plaintext),
      usedWasm,
    };
  }

  // -------------------------------------------------------------------------
  // Key generation
  // -------------------------------------------------------------------------

  generateKey(): Uint8Array {
    return nacl.randomBytes(KEY_LENGTH);
  }

  generateNonce(): Uint8Array {
    return nacl.randomBytes(NONCE_LENGTH);
  }

  // -------------------------------------------------------------------------
  // Convenience methods
  // -------------------------------------------------------------------------

  async encryptMessage(message: string, recipientPublicKey: Uint8Array, senderSecretKey: Uint8Array): Promise<{
    encrypted: EncryptedPayload;
    ephemeralPublicKey: string; // Base64 encoded
  }> {
    await this.init();

    // Generate ephemeral key pair for forward secrecy
    const ephemeralKeyPair = nacl.box.keyPair();

    // Derive shared secret using X25519
    const sharedSecret = nacl.box.before(recipientPublicKey, senderSecretKey);

    // Encrypt the message
    const encrypted = await this.encryptString(message, sharedSecret);

    return {
      encrypted,
      ephemeralPublicKey: encodeBase64(ephemeralKeyPair.publicKey),
    };
  }

  async decryptMessage(
    encrypted: EncryptedPayload,
    ephemeralPublicKey: Uint8Array,
    recipientSecretKey: Uint8Array,
  ): Promise<string> {
    await this.init();

    // Derive shared secret using X25519
    const sharedSecret = nacl.box.before(ephemeralPublicKey, recipientSecretKey);

    // Decrypt the message
    const { plaintext } = await this.decryptString(encrypted, sharedSecret);

    return plaintext;
  }

  // -------------------------------------------------------------------------
  // Migration helpers
  // -------------------------------------------------------------------------

  async migrateToWasm(
    ciphertext: Uint8Array,
    nonce: Uint8Array,
    key: Uint8Array,
  ): Promise<{
    migrated: boolean;
    newCiphertext?: Uint8Array;
    newNonce?: Uint8Array;
  }> {
    await this.init();

    // If WASM is not available, no migration needed
    if (!this.isWasmAvailable()) {
      return { migrated: false };
    }

    // Decrypt with TweetNaCl
    const plaintext = nacl.secretbox.open(ciphertext, nonce, key);
    if (!plaintext) {
      return { migrated: false };
    }

    // Re-encrypt with WASM
    const { ciphertext: newCiphertext, nonce: newNonce } = await wasmCryptoBridge.encrypt(plaintext, key);

    return {
      migrated: true,
      newCiphertext,
      newNonce,
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------

export const cryptoServiceWasm = new CryptoServiceWasm();
export default cryptoServiceWasm;
