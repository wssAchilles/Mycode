import { createHash } from 'crypto';

import {
  canonicalDecisionJson,
  decisionLogSha256,
  recommendationDecisionLogSchema,
} from '../decisionLog/contracts';
import {
  DECISION_CONTEXT_EVIDENCE_VERSION,
  DECISION_CONTEXT_LIMITS,
  DECISION_CONTEXT_LIMITS_VERSION,
  decisionContextVerificationInputV1Schema,
  verifiedDecisionContextDecisionV1Schema,
  type DecisionContextEvidenceV1,
  type VerifiedDecisionContextDecisionV1,
} from './contracts';

const verifiedDecisionContextEvidence = Symbol('verifiedDecisionContextEvidenceV1');
const verifiedDecisionContextObjects = new WeakSet<object>();
const verifiedDecisionContextDigests = new WeakMap<object, string>();

export type VerifiedDecisionContextEvidenceV1 = DecisionContextEvidenceV1 & {
  readonly [verifiedDecisionContextEvidence]: true;
};

export type VerifyDecisionContextEvidenceResultV1 =
  | { status: 'verified'; evidence: VerifiedDecisionContextEvidenceV1 }
  | { status: 'not_evaluable'; blocker: string };

const digest = (value: unknown): string => createHash('sha256')
  .update(canonicalDecisionJson(value))
  .digest('hex');

export function isVerifiedDecisionContextEvidenceV1(
  value: unknown,
): value is VerifiedDecisionContextEvidenceV1 {
  try {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<VerifiedDecisionContextEvidenceV1>;
    const evidenceSha256 = decisionContextEvidenceSha256V1(value);
    return verifiedDecisionContextObjects.has(value)
      && candidate[verifiedDecisionContextEvidence] === true
      && recursivelyFrozen(value)
      && candidate.decisionContextEvidenceSha256 === evidenceSha256
      && verifiedDecisionContextDigests.get(value) === evidenceSha256;
  } catch {
    return false;
  }
}

export function decisionContextEvidenceSha256V1(value: unknown): string {
  const evidence = record(value);
  if (!evidence) throw new Error('decision context evidence must be an object');
  const { decisionContextEvidenceSha256: _ignored, ...preimage } = evidence;
  return digest(preimage);
}

export function verifyDecisionContextEvidenceV1(
  input: unknown,
): VerifyDecisionContextEvidenceResultV1 {
  try {
    return verifyDecisionContextEvidenceUnchecked(input);
  } catch {
    return { status: 'not_evaluable', blocker: 'decision_context_contract_invalid' };
  }
}

function verifyDecisionContextEvidenceUnchecked(
  input: unknown,
): VerifyDecisionContextEvidenceResultV1 {
  const rawInput = record(input);
  if (
    Array.isArray(rawInput?.decisions)
    && rawInput.decisions.length > DECISION_CONTEXT_LIMITS.maxDecisions
  ) {
    return { status: 'not_evaluable', blocker: 'resource_limit_exceeded' };
  }
  const parsed = decisionContextVerificationInputV1Schema.safeParse(input);
  if (!parsed.success) {
    return { status: 'not_evaluable', blocker: 'decision_context_contract_invalid' };
  }
  if (parsed.data.crossUserDependence.status === 'unhandled_time_shock_v1') {
    return { status: 'not_evaluable', blocker: 'multiway_cluster_inference_unavailable' };
  }

  const decisionIds = new Set<string>();
  const viewerClusters = new Map<string, string>();
  const clusterViewers = new Map<string, string>();
  const syntheticClusters = new Set<string>();
  const decisions: VerifiedDecisionContextDecisionV1[] = [];
  for (const entry of parsed.data.decisions) {
    const decisionResult = recommendationDecisionLogSchema.safeParse(entry.decisionLog);
    if (!decisionResult.success) {
      return { status: 'not_evaluable', blocker: 'decision_context_decision_log_invalid' };
    }
    const decision = decisionResult.data;
    if (decision.behaviorPolicyKind === 'logged_randomized') {
      return { status: 'not_evaluable', blocker: 'randomized_decision_log_unverified' };
    }
    if (decisionIds.has(decision.decisionId)) {
      return { status: 'not_evaluable', blocker: 'decision_context_decision_duplicate' };
    }
    decisionIds.add(decision.decisionId);

    const contextAtMs = Date.parse(entry.contextAt);
    const availableAtMs = Date.parse(entry.availableAt);
    const decisionAtMs = Date.parse(decision.decisionAt);
    if (contextAtMs > availableAtMs || availableAtMs > decisionAtMs) {
      return { status: 'not_evaluable', blocker: 'decision_context_point_in_time_violation' };
    }

    if (entry.subject.kind === 'viewer') {
      const existingCluster = viewerClusters.get(entry.subject.viewerAccountPseudonym);
      const existingViewer = clusterViewers.get(entry.inferenceClusterId);
      if (
        (existingCluster !== undefined && existingCluster !== entry.inferenceClusterId)
        || (existingViewer !== undefined && existingViewer !== entry.subject.viewerAccountPseudonym)
        || syntheticClusters.has(entry.inferenceClusterId)
      ) {
        return { status: 'not_evaluable', blocker: 'decision_context_cluster_mapping_mismatch' };
      }
      viewerClusters.set(entry.subject.viewerAccountPseudonym, entry.inferenceClusterId);
      clusterViewers.set(entry.inferenceClusterId, entry.subject.viewerAccountPseudonym);
    } else {
      if (syntheticClusters.has(entry.inferenceClusterId) || clusterViewers.has(entry.inferenceClusterId)) {
        return { status: 'not_evaluable', blocker: 'decision_context_cluster_mapping_mismatch' };
      }
      syntheticClusters.add(entry.inferenceClusterId);
    }

    const segments = Object.fromEntries(Object.entries(entry.segments).sort(([left], [right]) => (
      compareText(left, right)
    )));
    decisions.push(verifiedDecisionContextDecisionV1Schema.parse({
      datasetVersion: parsed.data.datasetVersion,
      decisionId: decision.decisionId,
      requestId: decision.requestId,
      decisionAt: decision.decisionAt,
      decisionLogSha256: decisionLogSha256(decision),
      candidatePoolSha256: decision.candidatePool.candidatePoolSha256,
      decisionLog: decision,
      subject: entry.subject,
      contextAt: new Date(contextAtMs).toISOString(),
      availableAt: new Date(availableAtMs).toISOString(),
      sourceSha256: entry.sourceSha256,
      sourceVersion: entry.sourceVersion,
      inferenceClusterId: entry.inferenceClusterId,
      clusterUnitVersion: entry.clusterUnitVersion,
      realDatasetEligible: entry.realDatasetEligible,
      segments,
    }));
  }

  decisions.sort((left, right) => compareText(left.decisionId, right.decisionId));
  const evidencePreimage = {
    contractVersion: DECISION_CONTEXT_EVIDENCE_VERSION,
    resourceLimitsVersion: DECISION_CONTEXT_LIMITS_VERSION,
    datasetVersion: parsed.data.datasetVersion,
    crossUserDependence: parsed.data.crossUserDependence,
    decisions,
  };
  const evidence = {
    ...evidencePreimage,
    decisionContextEvidenceSha256: digest(evidencePreimage),
  } as VerifiedDecisionContextEvidenceV1;
  Object.defineProperty(evidence, verifiedDecisionContextEvidence, {
    value: true,
    enumerable: false,
    configurable: false,
  });
  verifiedDecisionContextObjects.add(evidence);
  recursivelyFreeze(evidence);
  verifiedDecisionContextDigests.set(evidence, evidence.decisionContextEvidenceSha256);
  return { status: 'verified', evidence };
}

function compareText(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function record(value: unknown): Record<string, any> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function recursivelyFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const property of Reflect.ownKeys(value)) {
    recursivelyFreeze(Reflect.get(value, property), seen);
  }
  Object.freeze(value);
  return value;
}

function recursivelyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value)
    && Reflect.ownKeys(value).every((property) => recursivelyFrozen(Reflect.get(value, property), seen));
}
