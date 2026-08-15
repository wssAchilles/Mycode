import crypto from 'crypto';
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  loadSocialPhoenixDevelopmentModel,
  type SocialPhoenixLinearModel,
  type SocialPhoenixTask,
} from '../../src/services/recommendation/socialPhoenix';

const TASKS: SocialPhoenixTask[] = [
  'click',
  'like',
  'reply',
  'repost',
  'quote',
  'share',
  'engagement',
  'negative',
];

function model(): SocialPhoenixLinearModel {
  return {
    version: 1,
    trainedAt: '2026-08-15T00:00:00.000Z',
    features: ['bias', 'retrieval_dense'],
    tasks: Object.fromEntries(TASKS.map((task) => [task, {
      bias: task === 'negative' ? -1 : 0,
      weights: { bias: 0, retrieval_dense: 0.5 },
    }])) as SocialPhoenixLinearModel['tasks'],
    metadata: { rows: 1 },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Social Phoenix model store', () => {
  it('loads only a structurally valid model pinned by its raw SHA-256', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'social-phoenix-model-'));
    const modelPath = path.join(directory, 'model.json');
    const raw = JSON.stringify(model());
    const sha256 = crypto.createHash('sha256').update(raw).digest('hex');
    writeFileSync(modelPath, raw, 'utf8');

    try {
      expect(loadSocialPhoenixDevelopmentModel(modelPath, sha256)).toEqual(model());
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('falls back when the digest is missing, mismatched, or the model is invalid', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'social-phoenix-invalid-'));
    const modelPath = path.join(directory, 'model.json');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const invalid = { ...model(), features: ['retrieval_dense', 'bias'] };
    const raw = JSON.stringify(invalid);
    const sha256 = crypto.createHash('sha256').update(raw).digest('hex');
    writeFileSync(modelPath, raw, 'utf8');

    try {
      expect(loadSocialPhoenixDevelopmentModel(modelPath, undefined)).toBeNull();
      expect(loadSocialPhoenixDevelopmentModel(modelPath, '0'.repeat(64))).toBeNull();
      expect(loadSocialPhoenixDevelopmentModel(modelPath, sha256)).toBeNull();
      expect(warning).toHaveBeenCalledTimes(3);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects an oversized model before reading its contents', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'social-phoenix-oversized-'));
    const modelPath = path.join(directory, 'model.json');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    writeFileSync(modelPath, '');
    truncateSync(modelPath, 8 * 1024 * 1024 + 1);

    try {
      expect(loadSocialPhoenixDevelopmentModel(modelPath, '0'.repeat(64))).toBeNull();
      expect(warning).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
