/**
 * WasmCryptoBridge — WASM-accelerated encryption with TweetNaCl fallback.
 *
 * Single responsibility: provide ChaCha20-Poly1305 encryption via WASM when available,
 * falling back to XSalsa20-Poly1305 (TweetNaCl) when WASM is unavailable.
 *
 * This module is the TypeScript-side integration point for WASM encryption.
 * The Rust-side functions (encrypt_message, decrypt_message) must be added to
 * the WASM module and exported via wasm.ts.
 */

import nacl from 'tweetnacl';
import { getChatWasmApi, type ChatWasmApi } from './wasm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WasmCryptoApi {
  encrypt_message?: (plaintext: Uint8Array, key: Uint8Array, nonce: Uint8Array) => Uint8Array;
  decrypt_message?: (ciphertext: Uint8Array, key: Uint8Array, nonce: Uint8Array) => Uint8Array;
}

export interface CryptoBridgeConfig {
  preferWasm: boolean;
  fallbackToTweetNaCl: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: CryptoBridgeConfig = {
  preferWasm: true,
  fallbackToTweetNaCl: true,
};

const NONCE_LENGTH = 24; // XSalsa20-Poly1305 nonce size
const KEY_LENGTH = 32;   // 256-bit key

// ---------------------------------------------------------------------------
// Wasm crypto bridge
// ---------------------------------------------------------------------------

export class WasmCryptoBridge {
  private wasmApi: ChatWasmApi | null = null;
  private wasmAvailable = false;
  private initAttempted = false;
  private readonly config: CryptoBridgeConfig;

  constructor(config: Partial<CryptoBridgeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  async init(): Promise<void> {
    if (this.initAttempted) return;
    this.initAttempted = true;

    try {
      this.wasmApi = await getChatWasmApi();
      this.wasmAvailable = !!this.wasmApi?.encrypt_message;
    } catch {
      this.wasmAvailable = false;
    }
  }

  isWasmAvailable(): boolean {
    return this.wasmAvailable;
  }

  // -------------------------------------------------------------------------
  // Encryption
  // -------------------------------------------------------------------------

  async encrypt(plaintext: Uint8Array, key: Uint8Array, nonce?: Uint8Array): Promise<{
    ciphertext: Uint8Array;
    nonce: Uint8Array;
    usedWasm: boolean;
  }> {
    await this.init();

    const actualNonce = nonce ?? nacl.randomBytes(NONCE_LENGTH);

    // Try WASM first
    if (this.config.preferWasm && this.wasmAvailable && this.wasmApi?.encrypt_message) {
      try {
        const ciphertext = this.wasmApi.encrypt_message(plaintext, key, actualNonce);
        return { ciphertext, nonce: actualNonce, usedWasm: true };
      } catch {
        // Fall through to TweetNaCl
      }
    }

    // Fallback to TweetNaCl (XSalsa20-Poly1305)
    if (this.config.fallbackToTweetNaCl) {
      const ciphertext = nacl.secretbox(plaintext, actualNonce, key);
      return { ciphertext, nonce: actualNonce, usedWasm: false };
    }

    throw new Error('ENCRYPTION_FAILED: no available encryption method');
  }

  // -------------------------------------------------------------------------
  // Decryption
  // -------------------------------------------------------------------------

  async decrypt(ciphertext: Uint8Array, key: Uint8Array, nonce: Uint8Array): Promise<{
    plaintext: Uint8Array;
    usedWasm: boolean;
  }> {
    await this.init();

    // Try WASM first
    if (this.config.preferWasm && this.wasmAvailable && this.wasmApi?.decrypt_message) {
      try {
        const plaintext = this.wasmApi.decrypt_message(ciphertext, key, nonce);
        return { plaintext, usedWasm: true };
      } catch {
        // Fall through to TweetNaCl
      }
    }

    // Fallback to TweetNaCl (XSalsa20-Poly1305)
    if (this.config.fallbackToTweetNaCl) {
      const plaintext = nacl.secretbox.open(ciphertext, nonce, key);
      if (!plaintext) {
        throw new Error('DECRYPTION_FAILED: invalid ciphertext or key');
      }
      return { plaintext, usedWasm: false };
    }

    throw new Error('DECRYPTION_FAILED: no available decryption method');
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

  async encryptString(plaintext: string, key: Uint8Array): Promise<{
    ciphertext: string; // Base64 encoded
    nonce: string;      // Base64 encoded
    usedWasm: boolean;
  }> {
    const encoder = new TextEncoder();
    const plaintextBytes = encoder.encode(plaintext);
    const { ciphertext, nonce, usedWasm } = await this.encrypt(plaintextBytes, key);

    return {
      ciphertext: this.toBase64(ciphertext),
      nonce: this.toBase64(nonce),
      usedWasm,
    };
  }

  async decryptString(ciphertext: string, key: Uint8Array, nonce: string): Promise<{
    plaintext: string;
    usedWasm: boolean;
  }> {
    const ciphertextBytes = this.fromBase64(ciphertext);
    const nonceBytes = this.fromBase64(nonce);
    const { plaintext, usedWasm } = await this.decrypt(ciphertextBytes, key, nonceBytes);

    const decoder = new TextDecoder();
    return {
      plaintext: decoder.decode(plaintext),
      usedWasm,
    };
  }

  // -------------------------------------------------------------------------
  // Base64 helpers
  // -------------------------------------------------------------------------

  private toBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private fromBase64(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}

// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------

export const wasmCryptoBridge = new WasmCryptoBridge();
export default wasmCryptoBridge;
