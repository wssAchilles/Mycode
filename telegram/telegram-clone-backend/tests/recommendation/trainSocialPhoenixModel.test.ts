import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const VALID_LABELS = {
  labelClick: 0,
  labelLike: 0,
  labelReply: 0,
  labelRepost: 0,
  labelQuote: 0,
  labelShare: 0,
  labelEngagement: 1,
  labelNegative: 0,
};

describe('Social Phoenix training CLI', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('trains only from rows with complete binary labels', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'social-phoenix-train-'));
    const inputPath = path.join(directory, 'samples.ndjson');
    const outputPath = path.join(directory, 'model.json');
    writeFileSync(inputPath, `${JSON.stringify({
      trainingFeatures: { bias: 1, in_network: 1 },
      ...VALID_LABELS,
    })}\n`, 'utf8');
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.argv = [
      'node',
      'trainSocialPhoenixModel.ts',
      '--input',
      inputPath,
      '--output',
      outputPath,
      '--epochs',
      '1',
      '--minFeatureCount',
      '1',
    ];
    process.exitCode = undefined;

    try {
      await import('../../src/scripts/trainSocialPhoenixModel');
      await vi.waitFor(() => expect(existsSync(outputPath)).toBe(true));

      expect(error).not.toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();
      expect(JSON.parse(readFileSync(outputPath, 'utf8')).metadata.rows).toBe(1);
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
      error.mockRestore();
      log.mockRestore();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects a quarantined row instead of treating null as a negative label', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'social-phoenix-quarantine-'));
    const inputPath = path.join(directory, 'samples.ndjson');
    const outputPath = path.join(directory, 'model.json');
    writeFileSync(inputPath, `${JSON.stringify({
      trainingFeatures: { bias: 1 },
      ...VALID_LABELS,
      labelClick: null,
      quarantineReasons: ['label_window_incomplete'],
    })}\n`, 'utf8');
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.argv = [
      'node',
      'trainSocialPhoenixModel.ts',
      '--input',
      inputPath,
      '--output',
      outputPath,
    ];
    process.exitCode = undefined;

    try {
      await import('../../src/scripts/trainSocialPhoenixModel');
      await vi.waitFor(() => expect(error).toHaveBeenCalled());

      expect(process.exitCode).toBe(1);
      expect(error).toHaveBeenCalledWith(
        '[TrainSocialPhoenixModel] failed:',
        expect.objectContaining({ message: 'training_row_label_invalid:labelClick' }),
      );
      expect(existsSync(outputPath)).toBe(false);
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
      error.mockRestore();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
