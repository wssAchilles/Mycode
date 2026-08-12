import { createHash } from 'crypto';

import {
  candidatePoolSha256,
  canonicalDecisionJson,
  decisionLogSha256,
} from '../decisionLog/contracts';
import {
  RANDOMIZED_SLATE_PROBABILITY_MASS_TOLERANCE,
  MAX_CANDIDATE_POOL_SIZE,
  MAX_SLATE_SIZE,
  randomizedSlateSimulationInputSchema,
  randomizedSlateSimulationSchema,
  type RandomizedSlateSimulationInputV1,
  type RandomizedSlateSimulationV1,
} from './contracts';

export type RandomizedSlateVerificationResult =
  | { status: 'verified' }
  | { status: 'rejected'; blockers: string[] };

function actionIdentity(action: {
  candidateNamespace: string;
  candidateId: string;
}): string {
  return `${action.candidateNamespace}\u0000${action.candidateId}`;
}

function simulationSha256(output: RandomizedSlateSimulationV1): string {
  const { simulationSha256: _, ...preimage } = output;
  return createHash('sha256').update(canonicalDecisionJson(preimage)).digest('hex');
}

function reject(blockers: string[]): RandomizedSlateVerificationResult {
  return { status: 'rejected', blockers: [...new Set(blockers)].sort() };
}

function probabilityMatches(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= RANDOMIZED_SLATE_PROBABILITY_MASS_TOLERANCE;
}

type EligibleCandidate = RandomizedSlateSimulationInputV1[
  'sourceDecisionLog'
]['candidatePool']['candidates'][number];

function compareBaseline(left: EligibleCandidate, right: EligibleCandidate): number {
  return left.poolRank - right.poolRank
    || Buffer.compare(Buffer.from(left.candidateNamespace), Buffer.from(right.candidateNamespace))
    || Buffer.compare(Buffer.from(left.candidateId), Buffer.from(right.candidateId));
}

function computeDistribution(
  candidates: EligibleCandidate[],
  epsilon: number,
  temperature: number,
): {
  probabilities: Array<{ plackettLuce: number; mixed: number }>;
  plackettLuceMass: number;
  mixedMass: number;
  probabilityMassError: number;
} | null {
  const scores = candidates.map((candidate) => candidate.score);
  if (scores.length === 0 || scores.some((score) => score === null || !Number.isFinite(score))) {
    return null;
  }
  const finiteScores = scores.filter((score): score is number => score !== null);
  const maxScore = Math.max(...finiteScores);
  const weights = finiteScores.map((score) => Math.exp((score - maxScore) / temperature));
  if (weights.some((weight) => weight === 0 || !Number.isFinite(weight))) return null;
  const denominator = weights.reduce((sum, weight) => sum + weight, 0);
  if (!Number.isFinite(denominator) || denominator <= 0) return null;

  const probabilities = weights.map((weight, index) => {
    const plackettLuce = weight / denominator;
    const mixed = (index === 0 ? 1 - epsilon : 0) + epsilon * plackettLuce;
    return { plackettLuce, mixed };
  });
  if (probabilities.some(({ plackettLuce, mixed }) => (
    !Number.isFinite(plackettLuce)
    || !Number.isFinite(mixed)
    || plackettLuce <= 0
    || mixed <= 0
  ))) return null;

  const plackettLuceMass = probabilities.reduce((sum, value) => sum + value.plackettLuce, 0);
  const mixedMass = probabilities.reduce((sum, value) => sum + value.mixed, 0);
  const probabilityMassError = Math.max(
    Math.abs(plackettLuceMass - 1),
    Math.abs(mixedMass - 1),
  );
  if (
    !Number.isFinite(plackettLuceMass)
    || !Number.isFinite(mixedMass)
    || probabilityMassError > RANDOMIZED_SLATE_PROBABILITY_MASS_TOLERANCE
  ) return null;
  return { probabilities, plackettLuceMass, mixedMass, probabilityMassError };
}

function sourceBehaviorIsNotDeterministic(rawInput: unknown): boolean {
  if (!rawInput || typeof rawInput !== 'object') return false;
  const source = (rawInput as Record<string, unknown>).sourceDecisionLog;
  if (!source || typeof source !== 'object') return false;
  const sourceRecord = source as Record<string, unknown>;
  if (sourceRecord.behaviorPolicyKind !== 'deterministic_top_k') return true;
  if (!Array.isArray(sourceRecord.actions)) return false;
  return sourceRecord.actions.some((action) => {
    if (!action || typeof action !== 'object') return true;
    const propensity = (action as Record<string, unknown>).behaviorPropensity;
    if (!propensity || typeof propensity !== 'object') return true;
    const evidence = propensity as Record<string, unknown>;
    return evidence.status !== 'not_evaluable_deterministic'
      || evidence.reason !== 'deterministic_top_k_no_logged_probability';
  });
}

function sourceSemanticBlockers(rawInput: unknown): string[] {
  if (!rawInput || typeof rawInput !== 'object') return [];
  const root = rawInput as Record<string, unknown>;
  const source = root.sourceDecisionLog;
  const config = root.config;
  const blockers: string[] = [];

  if (config && typeof config === 'object') {
    const slateSize = (config as Record<string, unknown>).slateSize;
    if (typeof slateSize === 'number' && slateSize > MAX_SLATE_SIZE) {
      blockers.push('slate_too_large');
    }
  }
  if (!source || typeof source !== 'object') return blockers;
  const sourceRecord = source as Record<string, unknown>;
  const pool = sourceRecord.candidatePool;
  if (!pool || typeof pool !== 'object') return blockers;
  const poolRecord = pool as Record<string, unknown>;
  const candidates = poolRecord.candidates;
  if (!Array.isArray(candidates)) return blockers;

  if (poolRecord.supportEvidence && typeof poolRecord.supportEvidence === 'object') {
    if ((poolRecord.supportEvidence as Record<string, unknown>).status !== 'complete') {
      blockers.push('support_incomplete');
    }
  }
  if (poolRecord.truncated === true) blockers.push('candidate_pool_truncated');
  if (
    typeof poolRecord.totalCount === 'number'
    && poolRecord.totalCount !== candidates.length
  ) {
    blockers.push('candidate_count_mismatch');
  }
  if (candidates.length > MAX_CANDIDATE_POOL_SIZE) {
    blockers.push('candidate_pool_too_large');
  }
  if (candidates.some((candidate) => {
    if (!candidate || typeof candidate !== 'object') return false;
    const value = candidate as Record<string, unknown>;
    if (value.eligible !== true) return false;
    return value.score === null
      || typeof value.score !== 'number'
      || !Number.isFinite(value.score);
  })) {
    blockers.push('eligible_candidate_logit_missing');
  }
  return blockers;
}

function verifyRandomizedSlateSimulationV1Unsafe(
  rawInput: unknown,
  rawOutput: unknown,
): RandomizedSlateVerificationResult {
  const parsedInput = randomizedSlateSimulationInputSchema.safeParse(rawInput);
  const parsedOutput = randomizedSlateSimulationSchema.safeParse(rawOutput);
  const preflightBlockers = sourceSemanticBlockers(rawInput);
  const sourceBehaviorBlocker = sourceBehaviorIsNotDeterministic(rawInput);
  if (!parsedInput.success || !parsedOutput.success) {
    return reject([
      ...(!parsedInput.success ? ['invalid_input'] : []),
      ...(!parsedOutput.success ? ['invalid_output'] : []),
      ...preflightBlockers,
      ...(sourceBehaviorBlocker ? ['source_behavior_not_deterministic'] : []),
    ]);
  }

  const input: RandomizedSlateSimulationInputV1 = parsedInput.data;
  const output: RandomizedSlateSimulationV1 = parsedOutput.data;
  const blockers: string[] = [...preflightBlockers];
  const decision = input.sourceDecisionLog;
  const candidates = decision.candidatePool.candidates;
  const eligible = candidates.filter((candidate) => candidate.eligible);

  if (decision.candidatePool.supportEvidence.status !== 'complete') {
    blockers.push('support_incomplete');
  }
  if (decision.candidatePool.truncated) {
    blockers.push('candidate_pool_truncated');
  }
  if (decision.candidatePool.totalCount !== candidates.length) {
    blockers.push('candidate_count_mismatch');
  }
  if (candidates.length > MAX_CANDIDATE_POOL_SIZE) {
    blockers.push('candidate_pool_too_large');
  }
  if (input.config.slateSize > MAX_SLATE_SIZE) blockers.push('slate_too_large');
  if (eligible.some((candidate) => candidate.score === null || !Number.isFinite(candidate.score))) {
    blockers.push('eligible_candidate_logit_missing');
  }
  if (sourceBehaviorBlocker || decision.behaviorPolicyKind !== 'deterministic_top_k') {
    blockers.push('source_behavior_not_deterministic');
  } else if (decision.actions.some((action) => (
    action.behaviorPropensity.status !== 'not_evaluable_deterministic'
    || action.behaviorPropensity.reason !== 'deterministic_top_k_no_logged_probability'
  ))) {
    blockers.push('source_behavior_not_deterministic');
  }

  if (decisionLogSha256(decision) !== input.sourceDecisionLogSha256) {
    blockers.push('source_decision_digest_mismatch');
  }
  if (candidatePoolSha256(candidates) !== decision.candidatePool.candidatePoolSha256) {
    blockers.push('source_candidate_pool_digest_mismatch');
  }
  if (simulationSha256(output) !== output.simulationSha256) {
    blockers.push('simulation_digest_mismatch');
  }

  if (canonicalDecisionJson(output.policy) !== canonicalDecisionJson(input.config)) {
    blockers.push('policy_binding_mismatch');
  }
  if (
    output.decisionFingerprint.decisionId !== decision.decisionId
    || output.decisionFingerprint.sha256 !== input.sourceDecisionLogSha256
  ) {
    blockers.push('decision_fingerprint_mismatch');
  }
  if (output.candidatePoolFingerprint.sha256 !== decision.candidatePool.candidatePoolSha256) {
    blockers.push('candidate_pool_fingerprint_mismatch');
  }

  const candidateIdentities = candidates.map((candidate) => actionIdentity(candidate));
  if (new Set(candidateIdentities).size !== candidateIdentities.length) {
    blockers.push('source_candidate_identity_duplicate');
  }
  if (eligible.length < input.config.slateSize) {
    blockers.push('eligible_candidate_count_insufficient');
  }
  if (input.uniformDraws.length !== input.config.slateSize) {
    blockers.push('uniform_draw_count_mismatch');
  }

  const support = output.supportDiagnostics;
  if (
    support.sourceCandidateCount !== candidates.length
    || support.eligibleCandidateCount !== eligible.length
    || support.excludedIneligibleCandidateCount !== candidates.length - eligible.length
    || support.sampledCount !== input.config.slateSize
  ) {
    blockers.push('support_binding_mismatch');
  }
  if (output.orderedActions.length !== input.config.slateSize) {
    blockers.push('action_count_mismatch');
  }
  if (output.numericalDiagnostics.steps.length !== input.config.slateSize) {
    blockers.push('numerical_step_count_mismatch');
  }

  const remainingEligible = [...eligible];
  const selectedIdentities = new Set<string>();
  for (const [index, action] of output.orderedActions.entries()) {
    remainingEligible.sort(compareBaseline);
    const identity = actionIdentity(action.actionKey);
    if (action.actionKey.servedPosition !== index + 1) {
      blockers.push('action_position_mismatch');
    }
    if (selectedIdentities.has(identity)) blockers.push('action_duplicate');
    selectedIdentities.add(identity);
    const selectedIndex = remainingEligible.findIndex(
      (candidate) => actionIdentity(candidate) === identity,
    );
    if (selectedIndex === -1) {
      blockers.push('action_ineligible_or_missing');
      continue;
    }

    const distribution = computeDistribution(
      remainingEligible,
      input.config.epsilon,
      input.config.temperature,
    );
    if (!distribution) {
      blockers.push('randomized_policy_recompute_failed');
      continue;
    }
    const expectedProbability = distribution.probabilities[selectedIndex];
    if (action.selectedWasDeterministicTop !== (selectedIndex === 0)) {
      blockers.push('deterministic_top_binding_mismatch');
    }
    if (!probabilityMatches(action.plackettLuceProbability, expectedProbability.plackettLuce)) {
      blockers.push('plackett_luce_probability_mismatch');
    }
    if (!probabilityMatches(action.conditionalSelectionProbability, expectedProbability.mixed)) {
      blockers.push('conditional_probability_mismatch');
    }
    const step = output.numericalDiagnostics.steps[index];
    if (step && (
      !probabilityMatches(step.plackettLuceProbabilityMass, distribution.plackettLuceMass)
      || !probabilityMatches(step.mixedProbabilityMass, distribution.mixedMass)
      || !probabilityMatches(step.probabilityMassError, distribution.probabilityMassError)
    )) {
      blockers.push('numerical_distribution_mismatch');
    }
    let cumulative = 0;
    let drawBoundaryAmbiguous = false;
    const expectedSelectedIndex = distribution.probabilities.findIndex(({ mixed }, candidateIndex) => {
      const terminal = candidateIndex + 1 === distribution.probabilities.length;
      cumulative = terminal ? 1 : cumulative + mixed;
      if (!terminal && probabilityMatches(input.uniformDraws[index], cumulative)) {
        drawBoundaryAmbiguous = true;
      }
      return input.uniformDraws[index] < cumulative;
    });
    if (drawBoundaryAmbiguous) {
      blockers.push('uniform_draw_boundary_ambiguous');
    } else if ((expectedSelectedIndex === -1
      ? distribution.probabilities.length - 1
      : expectedSelectedIndex) !== selectedIndex) {
      blockers.push('uniform_draw_selection_mismatch');
    }
    remainingEligible.splice(selectedIndex, 1);
  }

  let expectedMaxError = 0;
  for (const [index, step] of output.numericalDiagnostics.steps.entries()) {
    if (step.servedPosition !== index + 1) blockers.push('numerical_step_position_mismatch');
    if (step.remainingCandidateCount !== eligible.length - index) {
      blockers.push('remaining_candidate_count_mismatch');
    }
    const expectedError = Math.max(
      Math.abs(step.plackettLuceProbabilityMass - 1),
      Math.abs(step.mixedProbabilityMass - 1),
    );
    if (step.probabilityMassError !== expectedError) {
      blockers.push('probability_mass_error_mismatch');
    }
    expectedMaxError = Math.max(expectedMaxError, expectedError);
  }
  if (output.numericalDiagnostics.maxProbabilityMassError !== expectedMaxError) {
    blockers.push('max_probability_mass_error_mismatch');
  }
  if (
    output.numericalDiagnostics.maxProbabilityMassError
    > RANDOMIZED_SLATE_PROBABILITY_MASS_TOLERANCE
  ) {
    blockers.push('probability_mass_exceeds_tolerance');
  }

  return blockers.length === 0 ? { status: 'verified' } : reject(blockers);
}

export function verifyRandomizedSlateSimulationV1(
  rawInput: unknown,
  rawOutput: unknown,
): RandomizedSlateVerificationResult {
  try {
    return verifyRandomizedSlateSimulationV1Unsafe(rawInput, rawOutput);
  } catch {
    return reject(['invalid_input', 'invalid_output']);
  }
}
