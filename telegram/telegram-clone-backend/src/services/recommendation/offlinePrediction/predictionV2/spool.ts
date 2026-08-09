import { createHash, randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { mkdtemp, open, rm } from 'fs/promises';
import os from 'os';
import path from 'path';

import {
  copyBoundedByteStreamChunkV1,
  maximumByteStreamChunksV1,
} from '../artifacts/byteStream';
import { canonicalWireJsonV1 } from '../artifacts/canonical';
import type { ByteStreamFactoryV2 } from '../targetEvidence';
import type { PredictionSpoolDiagnosticsV2, PredictionSpoolLimitsV2 } from './contracts';

export const DEFAULT_PREDICTION_SPOOL_LIMITS_V2 = Object.freeze({
  maxLineBytes: 1 << 20,
  maxFileBytes: 512 * 1024 * 1024,
  maxRecords: 4_000_000,
});

export type CanonicalSpoolV2 = {
  directory: string;
  filePath: string;
  sha256: string;
  recordCount: number;
  byteCount: number;
  peakLineBytes: number;
  stream: ByteStreamFactoryV2;
  cleanup: () => Promise<void>;
};

export type CanonicalSpoolWriterV2 = {
  write: (record: unknown) => Promise<void>;
  finish: () => Promise<CanonicalSpoolV2>;
  abort: () => Promise<void>;
  diagnostics: () => Pick<PredictionSpoolDiagnosticsV2, 'peakLineBytes' | 'records' | 'bytes'>;
};

export async function createCanonicalSpoolWriterV2(
  limits: PredictionSpoolLimitsV2 = DEFAULT_PREDICTION_SPOOL_LIMITS_V2,
): Promise<CanonicalSpoolWriterV2> {
  validateLimits(limits);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'telegram-prediction-v2-'));
  const filePath = path.join(directory, `${randomUUID()}.ndjson`);
  let file: Awaited<ReturnType<typeof open>>;
  try {
    file = await open(filePath, 'wx', 0o600);
  } catch {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw new Error('prediction_spool_io_failed');
  }
  const hash = createHash('sha256');
  let records = 0;
  let bytes = 0;
  let peakLineBytes = 0;
  let terminal = false;

  const cleanup = async () => { await rm(directory, { recursive: true, force: true }); };
  return {
    write: async (record) => {
      if (terminal) throw new Error('prediction_spool_closed');
      const raw = `${canonicalWireJsonV1(record)}\n`;
      const lineBytes = Buffer.byteLength(raw) - 1;
      const chunk = Buffer.from(raw);
      if (
        lineBytes > limits.maxLineBytes
        || records >= limits.maxRecords
        || bytes + chunk.length > limits.maxFileBytes
      ) throw new Error('prediction_spool_resource_limit_exceeded');
      let offset = 0;
      try {
        while (offset < chunk.length) {
          const result = await file.write(chunk, offset, chunk.length - offset);
          if (result.bytesWritten === 0) throw new Error('prediction_spool_io_failed');
          offset += result.bytesWritten;
        }
      } catch (error) {
        if ((error as Error).message === 'prediction_spool_resource_limit_exceeded') throw error;
        throw new Error('prediction_spool_io_failed');
      }
      hash.update(chunk);
      records += 1;
      bytes += chunk.length;
      peakLineBytes = Math.max(peakLineBytes, lineBytes);
    },
    finish: async () => {
      if (terminal) throw new Error('prediction_spool_closed');
      terminal = true;
      try {
        await file.sync();
        await file.close();
      } catch {
        await file.close().catch(() => undefined);
        await cleanup().catch(() => undefined);
        throw new Error('prediction_spool_io_failed');
      }
      return {
        directory,
        filePath,
        sha256: hash.digest('hex'),
        recordCount: records,
        byteCount: bytes,
        peakLineBytes,
        stream: () => createReadStream(filePath),
        cleanup,
      };
    },
    abort: async () => {
      if (!terminal) {
        terminal = true;
        await file.close().catch(() => undefined);
      }
      await cleanup().catch(() => undefined);
    },
    diagnostics: () => ({ peakLineBytes, records, bytes }),
  };
}

export async function* readCanonicalSpoolRecordsV2(
  stream: ByteStreamFactoryV2,
  limits: PredictionSpoolLimitsV2 = DEFAULT_PREDICTION_SPOOL_LIMITS_V2,
): AsyncGenerator<{ value: unknown; raw: string }> {
  validateLimits(limits);
  const pending = Buffer.allocUnsafe(limits.maxLineBytes);
  let pendingLength = 0;
  let totalBytes = 0;
  let records = 0;
  let chunks = 0;
  const maximumChunks = maximumByteStreamChunksV1(limits.maxRecords);
  for await (const rawChunk of stream()) {
    const copied = copyBoundedByteStreamChunkV1(
      rawChunk,
      limits.maxFileBytes - totalBytes,
      maximumChunks - chunks,
    );
    if (copied.status === 'invalid') throw new Error('prediction_spool_contract_invalid');
    if (copied.status === 'resource_limit_exceeded') {
      throw new Error('prediction_spool_resource_limit_exceeded');
    }
    chunks += 1;
    const chunk = copied.chunk;
    totalBytes += copied.byteLength;
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(0x0a, offset);
      const segmentEnd = newline < 0 ? chunk.length : newline;
      const segmentLength = segmentEnd - offset;
      if (pendingLength + segmentLength > limits.maxLineBytes) {
        throw new Error('prediction_spool_resource_limit_exceeded');
      }
      chunk.copy(pending, pendingLength, offset, segmentEnd);
      pendingLength += segmentLength;
      offset = newline < 0 ? segmentEnd : newline + 1;
      if (newline < 0) break;
      if (
        pendingLength === 0
        || pending[pendingLength - 1] === 0x0d
      ) {
        throw new Error('prediction_spool_contract_invalid');
      }
      records += 1;
      if (records > limits.maxRecords) throw new Error('prediction_spool_resource_limit_exceeded');
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(
        pending.subarray(0, pendingLength),
      );
      let value: unknown;
      try { value = JSON.parse(raw); } catch { throw new Error('prediction_spool_contract_invalid'); }
      if (canonicalWireJsonV1(value) !== raw) throw new Error('prediction_spool_contract_invalid');
      pendingLength = 0;
      yield { value, raw };
    }
  }
  if (pendingLength !== 0) throw new Error('prediction_spool_contract_invalid');
}

function validateLimits(limits: PredictionSpoolLimitsV2): void {
  if ([limits.maxLineBytes, limits.maxFileBytes, limits.maxRecords].some((value) => (
    !Number.isSafeInteger(value) || value < 1
  )) || limits.maxLineBytes > DEFAULT_PREDICTION_SPOOL_LIMITS_V2.maxLineBytes
    || limits.maxFileBytes > DEFAULT_PREDICTION_SPOOL_LIMITS_V2.maxFileBytes
    || limits.maxRecords > DEFAULT_PREDICTION_SPOOL_LIMITS_V2.maxRecords
  ) throw new Error('prediction_spool_resource_config_invalid');
}
