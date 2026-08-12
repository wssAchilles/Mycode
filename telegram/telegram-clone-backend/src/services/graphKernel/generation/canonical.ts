import { createHash } from 'node:crypto';

import {
  GENERATION_SIGNAL_COUNT_FIELDS,
  type GenerationEdge,
  type GenerationSignalCounts,
} from './contracts';

export interface CanonicalGeneration {
  edges: GenerationEdge[];
  canonicalSha256: string;
  generationId: string;
  contentVersion: string;
}

function compareUtf8(left: string, right: string): number {
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftScalar = left.codePointAt(leftIndex)!;
    const rightScalar = right.codePointAt(rightIndex)!;
    if (leftScalar !== rightScalar) return leftScalar - rightScalar;
    leftIndex += leftScalar > 0xffff ? 2 : 1;
    rightIndex += rightScalar > 0xffff ? 2 : 1;
  }
  if (leftIndex < left.length) return 1;
  return rightIndex < right.length ? -1 : 0;
}

function requireIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`generation_edge_${field}_required`);
  }
  if (hasUnpairedSurrogate(value)) {
    throw new Error(`generation_edge_${field}_invalid_utf16`);
  }
  return value;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function requireFinite(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`generation_edge_${field}_non_finite`);
  }
  return value;
}

function normalizeCounts(
  value: unknown,
  field: 'daily_signal_counts' | 'rollup_signal_counts',
): GenerationSignalCounts {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`generation_edge_${field}_invalid`);
  }
  const input = value as Record<string, unknown>;
  const normalized = {} as GenerationSignalCounts;
  for (const countField of GENERATION_SIGNAL_COUNT_FIELDS) {
    const snakeField = countField.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    const count = Object.prototype.hasOwnProperty.call(input, countField) ? input[countField] : 0;
    normalized[countField] = requireFinite(count, `${field}_${snakeField}`);
  }
  return normalized;
}

function normalizeTime(value: number | null | undefined, field: string): number | null {
  if (value == null) return null;
  const milliseconds = requireFinite(value, field);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new Error(`generation_edge_${field}_invalid_epoch_ms`);
  }
  return milliseconds;
}

function normalizeEdge(edge: GenerationEdge): GenerationEdge & {
  dailySignalCounts: GenerationSignalCounts;
  rollupSignalCounts: GenerationSignalCounts;
  lastInteractionAtMs: number | null;
  updatedAtMs: number | null;
} {
  const edgeKinds = edge.edgeKinds.map((kind) => requireIdentifier(kind, 'edge_kind'));
  edgeKinds.sort(compareUtf8);
  const decayedSum = requireFinite(edge.decayedSum, 'decayed_sum');
  if (decayedSum < 0) throw new Error('generation_edge_decayed_sum_negative');
  return {
    sourceUserId: requireIdentifier(edge.sourceUserId, 'source_user_id'),
    targetUserId: requireIdentifier(edge.targetUserId, 'target_user_id'),
    edgeId: requireIdentifier(edge.edgeId, 'edge_id'),
    decayedSum,
    interactionProbability: requireFinite(
      edge.interactionProbability,
      'interaction_probability',
    ),
    dailySignalCounts: normalizeCounts(edge.dailySignalCounts, 'daily_signal_counts'),
    rollupSignalCounts: normalizeCounts(edge.rollupSignalCounts, 'rollup_signal_counts'),
    edgeKinds: Array.from(new Set(edgeKinds)),
    lastInteractionAtMs: normalizeTime(edge.lastInteractionAtMs, 'last_interaction_at_ms'),
    updatedAtMs: normalizeTime(edge.updatedAtMs, 'updated_at_ms'),
  };
}

function compareEdges(left: GenerationEdge, right: GenerationEdge): number {
  return compareUtf8(left.sourceUserId, right.sourceUserId)
    || compareUtf8(left.targetUserId, right.targetUserId)
    || compareUtf8(left.edgeId, right.edgeId);
}

export function serializeCanonicalEdge(edge: GenerationEdge): string {
  return JSON.stringify(edge);
}

export function canonicalizeGenerationEdges(input: readonly GenerationEdge[]): CanonicalGeneration {
  const edges = input.map(normalizeEdge).sort(compareEdges);
  for (let index = 1; index < edges.length; index += 1) {
    if (compareEdges(edges[index - 1], edges[index]) === 0) {
      throw new Error('generation_edge_duplicate_keyset');
    }
  }

  const hash = createHash('sha256');
  for (const edge of edges) {
    hash.update(serializeCanonicalEdge(edge));
    hash.update('\n');
  }
  const canonicalSha256 = hash.digest('hex');

  return {
    edges,
    canonicalSha256,
    generationId: `graph_generation_v2:${canonicalSha256}`,
    contentVersion: `sha256:${canonicalSha256}`,
  };
}
