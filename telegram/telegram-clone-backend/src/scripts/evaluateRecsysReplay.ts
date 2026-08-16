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
import {
    REPLAY_VARIANT_NAMES,
    type ReplayRequestSnapshot,
} from '../services/recommendation/replay/contracts';

const REPLAY_EVALUATION_LIMITS = Object.freeze({
    maximumInputBytes: 32 * 1024 * 1024,
    maximumLineBytes: 1 * 1024 * 1024,
    maximumRequests: 8_192,
    maximumCandidatesPerRequest: 2_048,
    maximumTotalCandidates: 65_536,
    maximumTopK: 1_000,
});

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

    const topK = Number(kv.topK || '10');
    if (
        !Number.isInteger(topK)
        || topK < 1
        || topK > REPLAY_EVALUATION_LIMITS.maximumTopK
    ) throw new Error('evaluation_config_resource_limit_exceeded');

    const requestedVariant = kv.variant || 'hybrid_signal_blend_v1';
    const variant = REPLAY_VARIANT_NAMES.find((name) => name === requestedVariant);
    if (!variant) throw new Error('evaluation_config_variant_invalid');

    return {
        input: kv.input || './tmp/replay_requests.ndjson',
        topK,
        variant,
        output: kv.output || '',
    };
}

async function main() {
    const args = parseArgs();
    const inputPath = path.resolve(process.cwd(), args.input);
    if (!fs.existsSync(inputPath)) {
        throw new Error(`input_not_found:${inputPath}`);
    }

    const requests: ReplayRequestSnapshot[] = [];
    const inputDescriptor = fs.openSync(inputPath, 'r');
    let descriptorOwnedByStream = false;
    let inputStream: fs.ReadStream | undefined;
    let input: readline.Interface | undefined;
    let nonblankRecords = 0;
    let totalCandidates = 0;

    try {
        const inputStat = fs.fstatSync(inputDescriptor);
        if (
            !inputStat.isFile()
            || !Number.isSafeInteger(inputStat.size)
            || inputStat.size <= 0
            || inputStat.size > REPLAY_EVALUATION_LIMITS.maximumInputBytes
        ) throw new Error('evaluation_input_resource_limit_exceeded');

        inputStream = fs.createReadStream(inputPath, {
            autoClose: true,
            encoding: 'utf8',
            end: inputStat.size - 1,
            fd: inputDescriptor,
        });
        descriptorOwnedByStream = true;
        input = readline.createInterface({ input: inputStream, crlfDelay: Infinity });

        for await (const line of input) {
            if (Buffer.byteLength(line, 'utf8') > REPLAY_EVALUATION_LIMITS.maximumLineBytes) {
                throw new Error('evaluation_input_resource_limit_exceeded');
            }
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (nonblankRecords >= REPLAY_EVALUATION_LIMITS.maximumRequests) {
                throw new Error('evaluation_input_resource_limit_exceeded');
            }
            nonblankRecords += 1;

            const row = JSON.parse(trimmed) as ReplayRequestSnapshot | null;
            if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
            if (!Array.isArray(row.candidates) || row.candidates.length === 0) continue;
            if (row.candidates.length > REPLAY_EVALUATION_LIMITS.maximumCandidatesPerRequest) {
                throw new Error('evaluation_input_resource_limit_exceeded');
            }
            totalCandidates += row.candidates.length;
            if (totalCandidates > REPLAY_EVALUATION_LIMITS.maximumTotalCandidates) {
                throw new Error('evaluation_input_resource_limit_exceeded');
            }
            if (!row.requestId) continue;
            requests.push(row);
        }
    } finally {
        input?.close();
        inputStream?.destroy();
        if (!descriptorOwnedByStream) fs.closeSync(inputDescriptor);
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
