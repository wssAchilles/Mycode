import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('repair job CLI epoch', () => {
  it.each(['realgraph', 'simclusters'])('rejects %s before connecting when --epoch is missing', (job) => {
    const backendRoot = path.resolve(__dirname, '../..');
    const result = spawnSync(
      process.execPath,
      ['-r', 'ts-node/register', 'src/scripts/triggerJobs.ts', '--job', job],
      {
        cwd: backendRoot,
        encoding: 'utf8',
        env: { ...process.env, MONGODB_URI: '' },
        timeout: 10_000,
      },
    );

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/--epoch/);
  });
});
