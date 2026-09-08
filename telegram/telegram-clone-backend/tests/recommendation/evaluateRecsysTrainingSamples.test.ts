import {
  existsSync,
  mkdtempSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TASKS = ['click', 'like', 'reply', 'repost', 'quote', 'share', 'engagement', 'negative'] as const;

function validModel() {
  return {
    version: 1,
    trainedAt: '2026-08-15T00:00:00.000Z',
    features: ['bias'],
    tasks: Object.fromEntries(TASKS.map((task) => [task, { bias: 0, weights: { bias: 0 } }])),
    metadata: { rows: 1 },
  };
}

describe('Social Phoenix evaluation CLI', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps diagnostic output honest and dynamic grouping keys isolated', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'social-phoenix-eval-'));
    const inputPath = path.join(directory, 'samples.ndjson');
    writeFileSync(inputPath, `${JSON.stringify({
      requestId: 'request-1',
      postId: 'post-1',
      rank: 1,
      targetAuthorId: 'author-1',
      recallSource: '__proto__',
      userState: 'constructor',
      requestPipeline: '__proto__',
      labelClick: 1,
      labelEngagement: 1,
      labelNegative: 0,
      inNetwork: true,
    })}\n`, 'utf8');
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.argv = ['node', 'evaluateRecsysTrainingSamples.ts', '--input', inputPath, '--topK', '1'];
    process.exitCode = undefined;

    try {
      await import('../../src/scripts/evaluateRecsysTrainingSamples');
      await vi.waitFor(() => expect(log).toHaveBeenCalled());

      const raw = log.mock.calls[log.mock.calls.length - 1]?.[0];
      const summary = JSON.parse(String(raw));
      expect(error).not.toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();
      expect(summary.evaluationScope).toBe('offline_diagnostic_v1');
      expect(summary.modelSelectionEligible).toBe(false);
      expect(summary.qualificationEvidenceEligible).toBe(false);
      expect(summary.realDatasetEligible).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(summary.bySource, '__proto__')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(summary.byUserState, 'constructor')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(summary.byPipeline, '__proto__')).toBe(true);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
      error.mockRestore();
      log.mockRestore();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('fails closed when an explicitly requested model cannot be verified', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'social-phoenix-eval-model-'));
    const inputPath = path.join(directory, 'samples.ndjson');
    const modelPath = path.join(directory, 'model.json');
    writeFileSync(inputPath, `${JSON.stringify({ requestId: 'request-1', rank: 1 })}\n`, 'utf8');
    const modelBytes = Buffer.from(JSON.stringify(validModel()), 'utf8');
    writeFileSync(modelPath, modelBytes, 'utf8');
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.argv = [
      'node',
      'evaluateRecsysTrainingSamples.ts',
      '--input',
      inputPath,
      '--model',
      modelPath,
      '--modelSha256',
      '0'.repeat(64),
    ];
    process.exitCode = undefined;

    try {
      await import('../../src/scripts/evaluateRecsysTrainingSamples');
      await vi.waitFor(() => expect(error).toHaveBeenCalled());

      expect(process.exitCode).toBe(1);
      expect(warning).toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(
        '[EvaluateRecsysSamples] failed:',
        expect.objectContaining({ message: 'social_phoenix_development_model_unavailable' }),
      );
      expect(log).not.toHaveBeenCalled();
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
      error.mockRestore();
      warning.mockRestore();
      log.mockRestore();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects an oversized input from its fstat snapshot before parsing', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'social-phoenix-eval-limit-'));
    const inputPath = path.join(directory, 'samples.ndjson');
    writeFileSync(inputPath, '');
    truncateSync(inputPath, 128 * 1024 * 1024 + 1);
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.argv = ['node', 'evaluateRecsysTrainingSamples.ts', '--input', inputPath];
    process.exitCode = undefined;

    try {
      await import('../../src/scripts/evaluateRecsysTrainingSamples');
      await vi.waitFor(() => expect(error).toHaveBeenCalled());

      expect(process.exitCode).toBe(1);
      expect(error).toHaveBeenCalledWith(
        '[EvaluateRecsysSamples] failed:',
        expect.objectContaining({ message: 'evaluation_input_resource_limit_exceeded' }),
      );
      expect(log).not.toHaveBeenCalled();
      expect(existsSync(inputPath)).toBe(true);
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
      error.mockRestore();
      log.mockRestore();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
