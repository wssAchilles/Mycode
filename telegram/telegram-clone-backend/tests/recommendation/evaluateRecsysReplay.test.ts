import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
    evaluateReplayRequests: vi.fn(),
}));

vi.mock('../../src/services/recommendation/replay/evaluator', () => ({
    evaluateReplayRequests: runtime.evaluateReplayRequests,
}));

describe('replay evaluation CLI input bounds', () => {
    beforeEach(() => {
        vi.resetModules();
        runtime.evaluateReplayRequests.mockReset().mockReturnValue({ requests: 1 });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('evaluates bounded requests after skipping malformed rows', async () => {
        const directory = mkdtempSync(path.join(tmpdir(), 'recsys-replay-eval-'));
        const inputPath = path.join(directory, 'requests.ndjson');
        const outputPath = path.join(directory, 'summary.json');
        const request = { requestId: 'request-1', candidates: [{ postId: 'post-1' }] };
        writeFileSync(inputPath, [
            '',
            JSON.stringify({ requestId: '', candidates: [{ postId: 'skipped' }] }),
            JSON.stringify(request),
            '',
        ].join('\n'), 'utf8');
        const originalArgv = process.argv;
        const originalExitCode = process.exitCode;
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        process.argv = [
            'node',
            'evaluateRecsysReplay.ts',
            '--input',
            inputPath,
            '--output',
            outputPath,
            '--topK',
            '2',
            '--variant',
            'baseline_rank_v1',
        ];
        process.exitCode = undefined;

        try {
            await import('../../src/scripts/evaluateRecsysReplay');
            await vi.waitFor(() => expect(runtime.evaluateReplayRequests).toHaveBeenCalledOnce());

            expect(runtime.evaluateReplayRequests).toHaveBeenCalledWith([request], 2, 'baseline_rank_v1');
            expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toEqual({ requests: 1 });
            expect(error).not.toHaveBeenCalled();
            expect(process.exitCode).toBeUndefined();
        } finally {
            process.argv = originalArgv;
            process.exitCode = originalExitCode;
            error.mockRestore();
            log.mockRestore();
            rmSync(directory, { recursive: true, force: true });
        }
    });

    it('rejects oversized candidate sets before evaluation', async () => {
        const directory = mkdtempSync(path.join(tmpdir(), 'recsys-replay-eval-limit-'));
        const inputPath = path.join(directory, 'requests.ndjson');
        writeFileSync(inputPath, `${JSON.stringify({
            requestId: 'request-too-large',
            candidates: Array.from({ length: 2_049 }, (_, index) => ({ postId: `post-${index}` })),
        })}\n`, 'utf8');
        const originalArgv = process.argv;
        const originalExitCode = process.exitCode;
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        process.argv = ['node', 'evaluateRecsysReplay.ts', '--input', inputPath];
        process.exitCode = undefined;

        try {
            await import('../../src/scripts/evaluateRecsysReplay');
            await vi.waitFor(() => expect(error).toHaveBeenCalled());

            expect(error).toHaveBeenCalledWith(
                '[EvaluateRecsysReplay] failed:',
                expect.objectContaining({ message: 'evaluation_input_resource_limit_exceeded' }),
            );
            expect(runtime.evaluateReplayRequests).not.toHaveBeenCalled();
            expect(log).not.toHaveBeenCalled();
            expect(process.exitCode).toBe(1);
        } finally {
            process.argv = originalArgv;
            process.exitCode = originalExitCode;
            error.mockRestore();
            log.mockRestore();
            rmSync(directory, { recursive: true, force: true });
        }
    });
});
