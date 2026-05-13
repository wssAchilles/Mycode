#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, '../..');
const rustPipelineContractPath = path.join(
  projectDir,
  'telegram-rust-workspace/crates/telegram-recommendation-contracts/src/contracts/pipeline.rs',
);
const nodeContractPath = path.join(
  projectDir,
  'telegram-clone-backend/src/services/recommendation/rust/contracts.ts',
);

const graphFieldPairs = [
  ['per_kernel_candidate_counts', 'perKernelCandidateCounts'],
  ['per_kernel_requested_limits', 'perKernelRequestedLimits'],
  ['per_kernel_available_counts', 'perKernelAvailableCounts'],
  ['per_kernel_returned_counts', 'perKernelReturnedCounts'],
  ['per_kernel_truncated_counts', 'perKernelTruncatedCounts'],
  ['per_kernel_latency_ms', 'perKernelLatencyMs'],
  ['per_kernel_empty_reasons', 'perKernelEmptyReasons'],
  ['per_kernel_errors', 'perKernelErrors'],
  ['budget_exhausted_kernels', 'budgetExhaustedKernels'],
];

function fail(message, detail = '') {
  console.error(`recommendation contract schema check failed: ${message}`);
  if (detail) {
    console.error(detail);
  }
  process.exit(1);
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function blockAfter(source, marker, openChar = '{', closeChar = '}') {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) {
    fail(`missing marker ${marker}`);
  }
  const openIndex = source.indexOf(openChar, markerIndex);
  if (openIndex < 0) {
    fail(`missing block opener after ${marker}`);
  }
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openIndex + 1, index);
      }
    }
  }
  fail(`unterminated block after ${marker}`);
}

const rust = read(rustPipelineContractPath);
const node = read(nodeContractPath);
const rustGraphStruct = blockAfter(rust, 'pub struct RecommendationGraphRetrievalPayload');
const nodeGraphInterface = blockAfter(node, 'export interface RecommendationGraphRetrievalPayload');
const nodeRetrievalSchema = blockAfter(node, 'const recommendationRetrievalSummaryPayloadSchema = z.object(');

const missing = [];
for (const [rustField, nodeField] of graphFieldPairs) {
  if (!new RegExp(`\\bpub\\s+${rustField}\\s*:`).test(rustGraphStruct)) {
    missing.push(`rust:${rustField}`);
  }
  if (!new RegExp(`\\b${nodeField}\\??\\s*:`).test(nodeGraphInterface)) {
    missing.push(`node-interface:${nodeField}`);
  }
  if (!new RegExp(`\\b${nodeField}\\s*:`).test(nodeRetrievalSchema)) {
    missing.push(`node-zod:${nodeField}`);
  }
}

if (missing.length > 0) {
  fail('Rust graph summary fields must be preserved by Node interface and Zod schema', missing.join('\n'));
}

console.log('recommendation contract schema check passed');
