import { createHash } from 'crypto';

import {
  canonicalDecisionJson,
  decisionLogSha256,
} from '../decisionLog/contracts';
import type {
  BehaviorSupportEvidenceV1,
  PredictionArtifactV1,
} from '../ope/contracts';
import {
  MAX_MULTI_OBJECTIVE_SHADOW_POLICY_CANDIDATE_POOL,
  MAX_MULTI_OBJECTIVE_SHADOW_POLICY_DECISION_ACTIONS,
  MAX_MULTI_OBJECTIVE_SHADOW_POLICY_OBJECTIVES,
  MAX_MULTI_OBJECTIVE_SHADOW_POLICY_OBJECTIVE_EVIDENCE_PER_CANDIDATE,
  MAX_MULTI_OBJECTIVE_SHADOW_POLICY_PREDICTION_ARTIFACTS,
  MAX_MULTI_OBJECTIVE_SHADOW_POLICY_PREDICTIONS_PER_ARTIFACT,
  MAX_MULTI_OBJECTIVE_SHADOW_POLICY_SUPPORT_ACTIONS,
  MULTI_OBJECTIVE_SHADOW_POLICY_VERSION,
  multiObjectiveShadowPolicyInputSchema,
  type MultiObjectiveShadowPolicyInputV1,
  type MultiObjectiveShadowPolicyResultV1,
  type ShadowConstraintDiagnosticsV1,
  type ShadowPolicyActionKeyV1,
  type ShadowPolicyFingerprintV1,
  type ShadowRankedActionV1,
} from './contracts';

type ParsedInput = MultiObjectiveShadowPolicyInputV1;
type BoundEvidence = BehaviorSupportEvidenceV1 | PredictionArtifactV1;
type ScoredAction = Omit<ShadowRankedActionV1, 'shadowRank'> & { canonicalActionKey: string };
type FeasibleSlateSearchResult =
  | { status: 'found'; selected: ScoredAction[]; selectedMeanPrediction: number }
  | { status: 'exhausted' }
  | { status: 'non_finite' }
  | { status: 'not_found' };

const unevaluatedDiagnostics = (): ShadowConstraintDiagnosticsV1 => ({
  candidateSafetyLimit: { status: 'not_evaluated' },
  slateSafetyConstraint: { status: 'not_evaluated' },
});

export function evaluateMultiObjectiveShadowPolicyV1(
  input: unknown,
): MultiObjectiveShadowPolicyResultV1 {
  if (isInputTooLarge(input)) return oversizedInputResult();
  let parsed: ReturnType<typeof multiObjectiveShadowPolicyInputSchema.safeParse>;
  try {
    parsed = multiObjectiveShadowPolicyInputSchema.safeParse(input);
  } catch {
    return invalidInputResult(input);
  }
  if (!parsed.success) return invalidInputResult(input);

  try {
    return evaluateParsed(parsed.data);
  } catch {
    return blockedResult(parsed.data, ['evaluation_failed'], unevaluatedDiagnostics());
  }
}

function evaluateParsed(input: ParsedInput): MultiObjectiveShadowPolicyResultV1 {
  const gateBlockers = validateBindingsAndSupport(input);
  if (gateBlockers.length > 0) {
    return blockedResult(input, gateBlockers, unevaluatedDiagnostics());
  }

  const artifacts = new Map(input.predictionArtifacts.map((artifact) => [
    artifact.objective,
    new Map(artifact.predictions.map((prediction) => [
      actionKeyString(prediction.actionKey),
      prediction.qHat,
    ])),
  ]));
  const scored: ScoredAction[] = [];
  for (const actionKey of input.behaviorSupport.actions) {
    let utility = 0;
    const objectivePredictions: ShadowRankedActionV1['objectivePredictions'] = [];
    for (const objective of input.config.objectives) {
      const qHat = artifacts.get(objective.objective)?.get(actionKeyString(actionKey));
      if (qHat === undefined) {
        return blockedResult(input, ['prediction_coverage_mismatch'], unevaluatedDiagnostics());
      }
      const term = objective.weight * qHat;
      utility += term;
      if (
        !Number.isFinite(term)
        || !Number.isFinite(utility)
        || (objective.weight !== 0 && qHat !== 0 && term === 0)
      ) {
        return blockedResult(input, ['non_finite_utility'], unevaluatedDiagnostics());
      }
      objectivePredictions.push({ objective: objective.objective, qHat });
    }
    scored.push({
      actionKey,
      utility,
      objectivePredictions,
      canonicalActionKey: actionKeyString(actionKey),
    });
  }

  const candidateLimit = input.config.candidateSafetyLimit;
  const excluded = scored.filter((action) => (
    predictionFor(action, candidateLimit.objective) > candidateLimit.maxPrediction
  ));
  const safe = scored.filter((action) => (
    predictionFor(action, candidateLimit.objective) <= candidateLimit.maxPrediction
  ));
  excluded.sort(compareCanonicalActionKey);
  safe.sort(compareScoredActions);
  const candidateDiagnostics: ShadowConstraintDiagnosticsV1['candidateSafetyLimit'] = {
    status: 'evaluated',
    objective: candidateLimit.objective,
    maxPrediction: candidateLimit.maxPrediction,
    excludedActions: excluded.map((action) => ({
      actionKey: action.actionKey,
      prediction: predictionFor(action, candidateLimit.objective),
    })),
    safeActionCount: safe.length,
  };
  if (safe.length < input.config.slateSize) {
    return blockedResult(input, ['candidate_safety_insufficient'], {
      candidateSafetyLimit: candidateDiagnostics,
      slateSafetyConstraint: { status: 'not_evaluated' },
    });
  }

  const slateConstraint = input.config.slateSafetyConstraint;
  const search = findBestFeasibleSlate(
    safe,
    input.config.slateSize,
    slateConstraint.objective,
    slateConstraint.maxMeanPrediction,
    input.config.maxSearchStates,
  );
  if (search.status === 'exhausted') {
    return blockedResult(input, ['feasible_slate_search_exhausted'], {
      candidateSafetyLimit: candidateDiagnostics,
      slateSafetyConstraint: { status: 'not_evaluated' },
    });
  }
  if (search.status === 'non_finite') {
    return blockedResult(input, ['non_finite_search_arithmetic'], {
      candidateSafetyLimit: candidateDiagnostics,
      slateSafetyConstraint: { status: 'not_evaluated' },
    });
  }
  if (search.status === 'not_found') {
    return blockedResult(input, ['slate_safety_no_feasible_slate'], {
      candidateSafetyLimit: candidateDiagnostics,
      slateSafetyConstraint: { status: 'not_evaluated' },
    });
  }
  const { selected, selectedMeanPrediction } = search;
  if (!Number.isFinite(selectedMeanPrediction)) {
    return blockedResult(input, ['non_finite_slate_mean'], {
      candidateSafetyLimit: candidateDiagnostics,
      slateSafetyConstraint: { status: 'not_evaluated' },
    });
  }
  const satisfied = selectedMeanPrediction <= slateConstraint.maxMeanPrediction;
  const diagnostics: ShadowConstraintDiagnosticsV1 = {
    candidateSafetyLimit: candidateDiagnostics,
    slateSafetyConstraint: {
      status: 'evaluated',
      objective: slateConstraint.objective,
      maxMeanPrediction: slateConstraint.maxMeanPrediction,
      selectedMeanPrediction,
      satisfied,
    },
  };

  const rankedActions = selected.map(({ canonicalActionKey: _canonical, ...action }, index) => ({
    actionKey: action.actionKey,
    shadowRank: index + 1,
    utility: action.utility,
    objectivePredictions: action.objectivePredictions,
  }));
  const result = {
    contractVersion: MULTI_OBJECTIVE_SHADOW_POLICY_VERSION,
    status: 'evaluated' as const,
    servable: false as const,
    rankedActions,
    constraintDiagnostics: diagnostics,
  };
  return {
    ...result,
    fingerprint: parsedFingerprint(input, result),
  };
}

function validateBindingsAndSupport(input: ParsedInput): string[] {
  const blockers: string[] = [];
  if (decisionLogSha256(input.decisionLog) !== input.decisionLogSha256) {
    blockers.push('decision_log_digest_mismatch');
  }
  for (const key of Object.keys(input.config.decisionVersions) as Array<
    keyof ParsedInput['config']['decisionVersions']
  >) {
    const evidence = input.decisionLog.versions[key];
    if (
      evidence.status !== 'bound'
      || evidence.version !== input.config.decisionVersions[key]
    ) blockers.push('decision_version_mismatch');
  }
  if (input.behaviorSupport.status !== 'complete') {
    blockers.push('behavior_support_incomplete');
  }
  if (!bindingMatches(input.behaviorSupport, input)) {
    blockers.push('behavior_support_binding_mismatch');
  }

  const supportKeys = input.behaviorSupport.actions.map(actionKeyString);
  if (new Set(supportKeys).size !== supportKeys.length) {
    blockers.push('behavior_support_action_duplicate');
  }
  if (input.behaviorSupport.actions.some((action) => !input.decisionLog.candidatePool.candidates.some(
    (candidate) => candidate.eligible
      && candidate.candidateNamespace === action.candidateNamespace
      && candidate.candidateId === action.candidateId,
  ))) blockers.push('behavior_support_candidate_ineligible_or_missing');

  const artifactCounts = new Map<string, number>();
  for (const artifact of input.predictionArtifacts) {
    artifactCounts.set(artifact.objective, (artifactCounts.get(artifact.objective) ?? 0) + 1);
  }
  const configuredObjectives = new Set(input.config.objectives.map(({ objective }) => objective));
  if (
    input.predictionArtifacts.some(({ objective }) => !configuredObjectives.has(objective))
    || input.config.objectives.some(({ objective }) => artifactCounts.get(objective) !== 1)
  ) blockers.push('prediction_artifact_set_mismatch');

  const supportSet = new Set(supportKeys);
  for (const objective of input.config.objectives) {
    const matches = input.predictionArtifacts.filter(({ objective: name }) => (
      name === objective.objective
    ));
    if (matches.length !== 1) continue;
    const artifact = matches[0];
    if (
      !bindingMatches(artifact, input)
      || artifact.horizonMs !== input.config.horizonMs
      || artifact.artifactVersion !== objective.predictionArtifactVersion
      || artifact.rewardDefinitionVersion !== objective.rewardDefinitionVersion
    ) blockers.push('prediction_artifact_binding_mismatch');
    const predictionKeys = artifact.predictions.map(({ actionKey }) => actionKeyString(actionKey));
    if (new Set(predictionKeys).size !== predictionKeys.length) {
      blockers.push('prediction_action_duplicate');
    }
    if (
      predictionKeys.length !== supportSet.size
      || predictionKeys.some((key) => !supportSet.has(key))
    ) blockers.push('prediction_coverage_mismatch');
  }
  return stableBlockers(blockers);
}

function bindingMatches(binding: BoundEvidence, input: ParsedInput): boolean {
  return binding.decisionId === input.decisionLog.decisionId
    && binding.decisionLogSha256 === input.decisionLogSha256
    && binding.candidatePoolSha256 === input.decisionLog.candidatePool.candidatePoolSha256
    && binding.datasetVersion === input.config.datasetVersion;
}

function predictionFor(action: ScoredAction, objective: string): number {
  return action.objectivePredictions.find((prediction) => (
    prediction.objective === objective
  ))!.qHat;
}

function compareScoredActions(left: ScoredAction, right: ScoredAction): number {
  if (left.utility !== right.utility) return left.utility > right.utility ? -1 : 1;
  return compareCanonicalActionKey(left, right);
}

function compareCanonicalActionKey(
  left: Pick<ScoredAction, 'canonicalActionKey'>,
  right: Pick<ScoredAction, 'canonicalActionKey'>,
): number {
  if (left.canonicalActionKey < right.canonicalActionKey) return -1;
  if (left.canonicalActionKey > right.canonicalActionKey) return 1;
  return 0;
}

function findBestFeasibleSlate(
  actions: ScoredAction[],
  slateSize: number,
  safetyObjective: string,
  maxMeanPrediction: number,
  maxSearchStates: number,
): FeasibleSlateSearchResult {
  let searchStates = 0;
  let exhausted = false;
  let bestSelected: ScoredAction[] | undefined;
  let bestUtility = Number.NEGATIVE_INFINITY;
  let bestCanonicalSequence: string | undefined;
  let bestMeanPrediction = 0;
  let nonFiniteArithmetic = false;
  const selected: ScoredAction[] = [];
  const selectedCandidates = new Set<string>();
  const selectedPositions = new Set<number>();

  const visit = (index: number, meanUtility: number, meanSafetyPrediction: number): void => {
    if (searchStates >= maxSearchStates) {
      exhausted = true;
      return;
    }
    searchStates += 1;

    const needed = slateSize - selected.length;
    if (needed === 0) {
      if (!Number.isFinite(meanUtility) || !Number.isFinite(meanSafetyPrediction)) {
        nonFiniteArithmetic = true;
        return;
      }
      if (meanSafetyPrediction <= maxMeanPrediction) {
        const canonicalSequence = canonicalDecisionJson(
          selected.map(({ actionKey }) => actionKey),
        );
        if (
          meanUtility > bestUtility
          || (meanUtility === bestUtility && (
            bestCanonicalSequence === undefined || canonicalSequence < bestCanonicalSequence
          ))
        ) {
          bestSelected = [...selected];
          bestUtility = meanUtility;
          bestCanonicalSequence = canonicalSequence;
          bestMeanPrediction = meanSafetyPrediction;
        }
      }
      return;
    }
    if (actions.length - index < needed) return;

    let utilityUpperBound = meanUtility;
    for (let offset = 0; offset < needed; offset += 1) {
      const utilityTerm = scaledSearchTerm(actions[index + offset].utility, slateSize);
      if (utilityTerm === undefined) {
        nonFiniteArithmetic = true;
        return;
      }
      utilityUpperBound += utilityTerm;
      if (!Number.isFinite(utilityUpperBound)) {
        nonFiniteArithmetic = true;
        return;
      }
    }
    if (bestSelected !== undefined && utilityUpperBound < bestUtility) return;

    const action = actions[index];
    const candidateKey = canonicalDecisionJson([
      action.actionKey.candidateNamespace,
      action.actionKey.candidateId,
    ]);
    if (
      !selectedCandidates.has(candidateKey)
      && !selectedPositions.has(action.actionKey.servedPosition)
    ) {
      const utilityTerm = scaledSearchTerm(action.utility, slateSize);
      const safetyTerm = scaledSearchTerm(predictionFor(action, safetyObjective), slateSize);
      if (utilityTerm === undefined || safetyTerm === undefined) {
        nonFiniteArithmetic = true;
        return;
      }
      const nextMeanUtility = meanUtility + utilityTerm;
      const nextMeanSafetyPrediction = meanSafetyPrediction + safetyTerm;
      if (
        !Number.isFinite(nextMeanUtility)
        || !Number.isFinite(nextMeanSafetyPrediction)
      ) {
        nonFiniteArithmetic = true;
        return;
      }
      selected.push(action);
      selectedCandidates.add(candidateKey);
      selectedPositions.add(action.actionKey.servedPosition);
      visit(
        index + 1,
        nextMeanUtility,
        nextMeanSafetyPrediction,
      );
      selected.pop();
      selectedCandidates.delete(candidateKey);
      selectedPositions.delete(action.actionKey.servedPosition);
      if (exhausted || nonFiniteArithmetic) return;
    }
    visit(index + 1, meanUtility, meanSafetyPrediction);
  };

  visit(0, 0, 0);
  if (nonFiniteArithmetic) return { status: 'non_finite' };
  if (exhausted) return { status: 'exhausted' };
  if (bestSelected === undefined) return { status: 'not_found' };
  return {
    status: 'found',
    selected: bestSelected,
    selectedMeanPrediction: bestMeanPrediction,
  };
}

function scaledSearchTerm(source: number, slateSize: number): number | undefined {
  const scaled = source / slateSize;
  if (!Number.isFinite(scaled) || (source !== 0 && scaled === 0)) return undefined;
  return scaled;
}

function actionKeyString(actionKey: ShadowPolicyActionKeyV1): string {
  return canonicalDecisionJson(actionKey);
}

function blockedResult(
  input: ParsedInput,
  blockers: string[],
  constraintDiagnostics: ShadowConstraintDiagnosticsV1,
): MultiObjectiveShadowPolicyResultV1 {
  const result = {
    contractVersion: MULTI_OBJECTIVE_SHADOW_POLICY_VERSION,
    status: 'not_evaluable' as const,
    servable: false as const,
    blockers: stableBlockers(blockers),
    rankedActions: [] as [],
    constraintDiagnostics,
  };
  return {
    ...result,
    fingerprint: parsedFingerprint(input, result),
  };
}

function invalidInputResult(input: unknown): MultiObjectiveShadowPolicyResultV1 {
  const result = {
    contractVersion: MULTI_OBJECTIVE_SHADOW_POLICY_VERSION,
    status: 'not_evaluable' as const,
    servable: false as const,
    blockers: ['invalid_input'],
    rankedActions: [] as [],
    constraintDiagnostics: unevaluatedDiagnostics(),
  };
  return {
    ...result,
    fingerprint: rawFingerprint(input, result),
  };
}

function oversizedInputResult(): MultiObjectiveShadowPolicyResultV1 {
  return {
    contractVersion: MULTI_OBJECTIVE_SHADOW_POLICY_VERSION,
    status: 'not_evaluable',
    servable: false,
    blockers: ['invalid_input'],
    rankedActions: [],
    constraintDiagnostics: unevaluatedDiagnostics(),
    fingerprint: { status: 'unavailable', reason: 'input_too_large' },
  };
}

function isInputTooLarge(input: unknown): boolean {
  try {
    const root = asRecord(input);
    if (!root) return false;
    const config = asRecord(root.config);
    if (exceedsArrayLimit(config?.objectives, MAX_MULTI_OBJECTIVE_SHADOW_POLICY_OBJECTIVES)) {
      return true;
    }
    const artifacts = root.predictionArtifacts;
    if (exceedsArrayLimit(artifacts, MAX_MULTI_OBJECTIVE_SHADOW_POLICY_PREDICTION_ARTIFACTS)) {
      return true;
    }
    if (Array.isArray(artifacts) && artifacts.some((artifact) => (
      exceedsArrayLimit(
        asRecord(artifact)?.predictions,
        MAX_MULTI_OBJECTIVE_SHADOW_POLICY_PREDICTIONS_PER_ARTIFACT,
      )
    ))) return true;

    const support = asRecord(root.behaviorSupport);
    if (exceedsArrayLimit(
      support?.actions,
      MAX_MULTI_OBJECTIVE_SHADOW_POLICY_SUPPORT_ACTIONS,
    )) return true;

    const decision = asRecord(root.decisionLog);
    if (exceedsArrayLimit(decision?.actions, MAX_MULTI_OBJECTIVE_SHADOW_POLICY_DECISION_ACTIONS)) {
      return true;
    }
    const candidates = asRecord(decision?.candidatePool)?.candidates;
    if (exceedsArrayLimit(candidates, MAX_MULTI_OBJECTIVE_SHADOW_POLICY_CANDIDATE_POOL)) {
      return true;
    }
    if (Array.isArray(candidates)) {
      for (let index = 0; index < candidates.length; index += 1) {
        if (exceedsArrayLimit(
          asRecord(candidates[index])?.objectiveEvidence,
          MAX_MULTI_OBJECTIVE_SHADOW_POLICY_OBJECTIVE_EVIDENCE_PER_CANDIDATE,
        )) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function exceedsArrayLimit(value: unknown, limit: number): boolean {
  return Array.isArray(value) && value.length > limit;
}

function parsedFingerprint(input: ParsedInput, result: object): ShadowPolicyFingerprintV1 {
  return fingerprint({
    config: input.config,
    decision: {
      decisionId: input.decisionLog.decisionId,
      decisionLogSha256: input.decisionLogSha256,
      actualDecisionLogSha256: decisionLogSha256(input.decisionLog),
      candidatePoolSha256: input.decisionLog.candidatePool.candidatePoolSha256,
    },
    behaviorSupport: {
      ...input.behaviorSupport,
      actions: [...input.behaviorSupport.actions].sort((left, right) => (
        actionKeyString(left) < actionKeyString(right) ? -1 : 1
      )),
    },
    predictionArtifacts: canonicalArtifacts(input.predictionArtifacts),
    result,
  });
}

function rawFingerprint(input: unknown, result: object): ShadowPolicyFingerprintV1 {
  return fingerprint({ input, result });
}

function fingerprint(value: unknown): ShadowPolicyFingerprintV1 {
  try {
    return {
      status: 'available',
      sha256: createHash('sha256').update(canonicalDecisionJson(value)).digest('hex'),
    };
  } catch {
    return { status: 'unavailable', reason: 'input_not_canonicalizable' };
  }
}

function canonicalArtifacts(artifacts: PredictionArtifactV1[]): PredictionArtifactV1[] {
  return artifacts
    .map((artifact) => ({
      ...artifact,
      predictions: [...artifact.predictions].sort((left, right) => {
        const leftKey = actionKeyString(left.actionKey);
        const rightKey = actionKeyString(right.actionKey);
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      }),
    }))
    .sort((left, right) => {
      const leftKey = `${left.objective}:${left.artifactVersion}:${canonicalDecisionJson(left)}`;
      const rightKey = `${right.objective}:${right.artifactVersion}:${canonicalDecisionJson(right)}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
}

function stableBlockers(blockers: string[]): string[] {
  return [...new Set(blockers)].sort();
}
