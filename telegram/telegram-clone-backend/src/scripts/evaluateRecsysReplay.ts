/**
 * 基于 request 级 replay 样本做 served-set replay evaluator。
 *
 * 用法：
 *   npx ts-node src/scripts/evaluateRecsysReplay.ts --input ./tmp/replay_requests.ndjson --variant hybrid_signal_blend_v1 --topK 10
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';

import {
    evaluateReplayRequests,
} from '../services/recommendation/replay/evaluator';
import type {
    ReplayRequestSnapshot,
    ReplayVariantName,
} from '../services/recommendation/replay/contracts';

function parseArgs() {
    const args = process.argv.slice(2);
    const kv: Record<string, string> = {};
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (!arg.startsWith('--')) continue;
        const key = arg.slice(2);
        const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true';
        kv[key] = value;
    }

    return {
        input: kv.input || './tmp/replay_requests.ndjson',
        topK: Math.max(1, parseInt(kv.topK || '10', 10) || 10),
        variant: (kv.variant || 'hybrid_signal_blend_v1') as ReplayVariantName,
        output: kv.output || '',
    };
}

async function main() {
    const args = parseArgs();
    const inputPath = path.resolve(process.cwd(), args.input);
    if (!fs.existsSync(inputPath)) {
        throw new Error(`input_not_found:${inputPath}`);
    }

    const stream = fs.createReadStream(inputPath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    const requests: ReplayRequestSnapshot[] = [];

    for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const row = JSON.parse(trimmed) as ReplayRequestSnapshot;
        if (!row.requestId || !Array.isArray(row.candidates) || row.candidates.length === 0) continue;
        requests.push(row);
    }

    const summary = evaluateReplayRequests(requests, args.topK, args.variant);
    const output = JSON.stringify(summary, null, 2);

    if (args.output) {
        const outputPath = path.resolve(process.cwd(), args.output);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, `${output}\n`, 'utf8');
        console.log(`[EvaluateRecsysReplay] wrote ${outputPath}`);
        return;
    }

    console.log(output);
}

main().catch((error) => {
    console.error('[EvaluateRecsysReplay] failed:', error);
    process.exitCode = 1;
});

