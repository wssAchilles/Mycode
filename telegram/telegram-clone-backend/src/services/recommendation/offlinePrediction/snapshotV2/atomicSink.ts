import { createHash, randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { link, lstat, open, unlink } from 'fs/promises';
import path from 'path';

import { canonicalWireJsonV1 } from '../artifacts/canonical';
import type {
  AtomicCanonicalNdjsonPublishInputV1,
  AtomicCanonicalNdjsonPublishResultV1,
} from './contracts';

const MAX_LINE_BYTES = 1 << 20;
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_RECORDS = 4_000_000;

type AtomicSinkTestHooksV1 = {
  beforeCreateOnlyPublish?: (targetPath: string) => Promise<void> | void;
  unlinkTemporary?: (temporaryPath: string) => Promise<void> | void;
  syncParentDirectory?: (directory: string) => Promise<void> | void;
};

let testHooks: AtomicSinkTestHooksV1 | undefined;

// Deliberately not re-exported from the bounded-context index.
export function setAtomicSinkTestHooksV1(hooks?: AtomicSinkTestHooksV1): void {
  testHooks = hooks;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function syncParentDirectory(directory: string): Promise<void> {
  if (testHooks?.syncParentDirectory) {
    await testHooks.syncParentDirectory(directory);
    return;
  }
  const parent = await open(directory, 'r');
  try { await parent.sync(); } finally { await parent.close(); }
}

export async function verifyCanonicalNdjsonFileV1(
  filePath: string,
  expectedSha256: string,
  expectedRecordCount: number,
): Promise<{ sha256: string; recordCount: number }> {
  const hash = createHash('sha256');
  let pending = Buffer.alloc(0);
  let totalBytes = 0;
  let recordCount = 0;
  for await (const rawChunk of createReadStream(filePath)) {
    const chunk = Buffer.from(rawChunk);
    totalBytes += chunk.length;
    if (totalBytes > MAX_FILE_BYTES) throw new Error('resource_limit_exceeded');
    hash.update(chunk);
    pending = pending.length === 0
      ? chunk
      : Buffer.concat([pending, chunk], pending.length + chunk.length);
    while (true) {
      const newline = pending.indexOf(0x0a);
      if (newline < 0) break;
      const line = pending.subarray(0, newline);
      pending = pending.subarray(newline + 1);
      if (line.length === 0 || line.length > MAX_LINE_BYTES || line[line.length - 1] === 0x0d) {
        throw new Error(line.length > MAX_LINE_BYTES
          ? 'resource_limit_exceeded'
          : 'atomic_artifact_contract_invalid');
      }
      recordCount += 1;
      if (recordCount > MAX_RECORDS) throw new Error('resource_limit_exceeded');
      let parsed: unknown;
      const wire = new TextDecoder('utf-8', { fatal: true }).decode(line);
      try { parsed = JSON.parse(wire); } catch { throw new Error('atomic_artifact_contract_invalid'); }
      if (wire !== canonicalWireJsonV1(parsed)) {
        throw new Error('atomic_artifact_contract_invalid');
      }
    }
    if (pending.length > MAX_LINE_BYTES) throw new Error('resource_limit_exceeded');
  }
  if (pending.length !== 0) throw new Error('atomic_artifact_contract_invalid');
  const sha256 = hash.digest('hex');
  if (
    sha256 !== expectedSha256
    || recordCount !== expectedRecordCount
  ) {
    throw new Error('atomic_artifact_validation_mismatch');
  }
  return { sha256, recordCount };
}

export async function publishAtomicCanonicalNdjsonV1(
  input: AtomicCanonicalNdjsonPublishInputV1,
): Promise<AtomicCanonicalNdjsonPublishResultV1> {
  const directory = path.dirname(input.targetPath);
  const lockPath = `${input.targetPath}.publish.lock`;
  const temporaryPath = path.join(
    directory,
    `.${path.basename(input.targetPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const hash = createHash('sha256');
  let count = 0;
  let totalBytes = 0;
  let file: Awaited<ReturnType<typeof open>> | undefined;
  let lockFile: Awaited<ReturnType<typeof open>> | undefined;
  let temporaryOwned = false;
  try {
    if (await pathExists(input.targetPath)) throw new Error('atomic_artifact_target_exists');
    try {
      lockFile = await open(lockPath, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error('atomic_artifact_publish_locked');
      }
      throw error;
    }
    if (await pathExists(input.targetPath)) throw new Error('atomic_artifact_target_exists');
    file = await open(temporaryPath, 'wx', 0o600);
    temporaryOwned = true;
    for await (const record of input.records) {
      const line = `${canonicalWireJsonV1(record)}\n`;
      if (Buffer.byteLength(line) - 1 > MAX_LINE_BYTES) throw new Error('resource_limit_exceeded');
      const bytes = Buffer.from(line);
      totalBytes += bytes.length;
      if (totalBytes > MAX_FILE_BYTES || count >= MAX_RECORDS) {
        throw new Error('resource_limit_exceeded');
      }
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesWritten } = await file.write(bytes, offset, bytes.length - offset);
        if (bytesWritten === 0) throw new Error('atomic_artifact_write_failed');
        offset += bytesWritten;
      }
      hash.update(bytes);
      count += 1;
    }
    const sha256 = hash.digest('hex');
    await file.sync();
    await file.close();
    file = undefined;
    const verified = await verifyCanonicalNdjsonFileV1(
      temporaryPath,
      input.expectedSha256,
      input.expectedRecordCount,
    );
    if (sha256 !== verified.sha256 || count !== verified.recordCount) {
      throw new Error('atomic_artifact_validation_mismatch');
    }
    await testHooks?.beforeCreateOnlyPublish?.(input.targetPath);
    if (await pathExists(input.targetPath)) throw new Error('atomic_artifact_target_exists');
    try {
      await link(temporaryPath, input.targetPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error('atomic_artifact_target_exists');
      }
      throw error;
    }
    let temporaryCleanupFailed = false;
    try {
      await testHooks?.unlinkTemporary?.(temporaryPath);
      await unlink(temporaryPath);
      temporaryOwned = false;
    } catch {
      temporaryCleanupFailed = true;
    }
    let directorySyncFailed = false;
    try {
      await syncParentDirectory(directory);
    } catch {
      directorySyncFailed = true;
    }
    if (temporaryCleanupFailed || directorySyncFailed) {
      const reason = temporaryCleanupFailed
        ? directorySyncFailed
          ? 'temporary_cleanup_and_parent_directory_sync_failed' as const
          : 'temporary_cleanup_failed' as const
        : 'parent_directory_sync_failed' as const;
      return {
        status: 'published_durability_unconfirmed',
        durability: 'unconfirmed',
        reason,
        ...verified,
      };
    }
    return { status: 'published', durability: 'confirmed', ...verified };
  } catch (error) {
    if (file) await file.close().catch(() => undefined);
    if (temporaryOwned) await unlink(temporaryPath).catch(() => undefined);
    throw error;
  } finally {
    if (temporaryOwned) await unlink(temporaryPath).catch(() => undefined);
    if (lockFile) {
      await lockFile.close().catch(() => undefined);
      await unlink(lockPath).catch(() => undefined);
    }
  }
}
