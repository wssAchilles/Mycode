import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../../decisionLog/contracts';
import {
  directionalTestResolutionV2,
  HOLM_STEP_DOWN_V1,
  thresholdBootstrapTV2,
  type DirectionalThresholdTestResultV2,
} from '../../../ope/inference/directionalV2';
import { summarizeClusterScoresV1 } from '../../../ope/inference/clusterScores';
import {
  isVerifiedFrozenPolicyEvaluationFamilyV2,
  type VerifiedFrozenPolicyEvaluationFamilyV2,
} from './family';

type PValue = { hypothesisId: string; pValue: number };
type BoundTest = {
  hypothesisId: string;
  objective: string;
  segment: string;
  test: DirectionalThresholdTestResultV2;
};
type DirectionalHypothesisTestSetV2 = {
  contractVersion: 'verified_directional_hypothesis_test_set_v2';
  familySha256: string;
  qualificationProtocolSha256: string;
  datasetSha256: string;
  holdoutSha256: string;
  bootstrapSeedMaterialSha256: string;
  tests: readonly BoundTest[];
  realDatasetEligible: false;
  testSetSha256: string;
};

const testSetBrand = Symbol('verifiedDirectionalHypothesisTestSetV2');
const verifiedTestSets = new WeakSet<object>();
const testSetDigests = new WeakMap<object, string>();
type VerifiedDirectionalHypothesisTestSetV2 = DirectionalHypothesisTestSetV2 & {
  readonly [testSetBrand]: true;
};

export function intersectionUnionAllMustPassV1(values: readonly PValue[], alpha: number) {
  if (!valid(values, alpha)) return blocked('directional_hypothesis_test_set_invalid');
  const ordered = canonicalPValues(values).map((entry) => ({
    ...entry,
    threshold: alpha,
    rejected: entry.pValue <= alpha,
  }));
  return { status: 'evaluated' as const, passed: ordered.every((entry) => entry.rejected), ordered };
}

export function holmStepDownV1(values: readonly PValue[], alpha: number) {
  if (!valid(values, alpha)) return blocked('directional_hypothesis_test_set_invalid');
  let stopped = false;
  const ordered = canonicalPValues(values).map((entry, index) => {
    const threshold = alpha / (values.length - index);
    const rejected = !stopped && entry.pValue <= threshold;
    if (!rejected) stopped = true;
    return { ...entry, threshold, rejected };
  });
  return { status: 'evaluated' as const, passed: ordered.every((entry) => entry.rejected), ordered };
}

export function evaluateFrozenDirectionalFamilyV2(
  family: VerifiedFrozenPolicyEvaluationFamilyV2,
  testSet: unknown,
) {
  if (!isVerifiedFrozenPolicyEvaluationFamilyV2(family)) {
    return blocked('frozen_policy_evaluation_family_unverified');
  }
  const resolution = directionalTestResolutionV2({
    bootstrapReplicates: family.bootstrapReplicates,
    familyAlpha: family.familyAlpha,
    hypothesisCount: family.hypotheses.length,
    procedure: family.procedure,
  });
  if (resolution.status !== 'reachable') return resolution;
  if (!isVerifiedDirectionalHypothesisTestSetV2(testSet)
    || !verifiedMembership(family, testSet)) {
    return blocked('directional_hypothesis_test_set_invalid');
  }
  const pValues = testSet.tests.map(({ hypothesisId, test }) => ({
    hypothesisId,
    pValue: test.pValue,
  }));
  const evaluated = family.procedure === HOLM_STEP_DOWN_V1
    ? holmStepDownV1(pValues, family.familyAlpha)
    : intersectionUnionAllMustPassV1(pValues, family.familyAlpha);
  if (evaluated.status !== 'evaluated') return evaluated;
  const preimage = {
    contractVersion: 'synthetic_directional_family_evaluation_v2' as const,
    familySha256: family.familySha256,
    procedure: family.procedure,
    passed: evaluated.passed,
    ordered: evaluated.ordered,
    realDatasetEligible: false as const,
  };
  return { status: 'evaluated' as const, ...preimage, evaluationSha256: digest(preimage) };
}

// Deliberately not exported by the v2 bounded-context index. This is a synthetic
// multiplicity fixture, not a way for callers to self-attest production tests.
export function issueSyntheticDirectionalHypothesisTestSetFixtureV2(
  family: VerifiedFrozenPolicyEvaluationFamilyV2,
): { status: 'verified'; testSet: VerifiedDirectionalHypothesisTestSetV2 }
  | { status: 'not_evaluable'; blocker: string } {
  try {
    if (!isVerifiedFrozenPolicyEvaluationFamilyV2(family)) {
      return blocked('frozen_policy_evaluation_family_unverified');
    }
    const tests: BoundTest[] = [];
    for (const hypothesis of family.hypotheses) {
      const sign = hypothesis.direction === 'greater' ? 1 : -1;
      const scores = [0.1, 0.2, 0.3, 0.4].map((offset, index) => ({
        inferenceClusterId: `synthetic-cluster-${index}`,
        y: 2 * (hypothesis.nullThreshold + sign * offset),
        a: 2,
        importanceMass: 1 + index / 10,
      }));
      if (scores.some((score) => !Number.isFinite(score.y))) {
        return blocked('directional_hypothesis_test_set_invalid');
      }
      const summary = summarizeClusterScoresV1('dr', scores);
      if (summary.status !== 'evaluated') {
        return blocked('directional_hypothesis_test_set_invalid');
      }
      const inputSha256 = digest({
        fixture: 'synthetic_directional_family_fixture_v1',
        familySha256: family.familySha256,
        qualificationProtocolSha256: family.qualificationProtocolSha256,
        hypothesis,
        dataset: family.dataset,
        holdout: family.holdout,
        configBindings: family.configBindings,
      });
      const test = thresholdBootstrapTV2({
        summary: summary.summary,
        nullThreshold: hypothesis.nullThreshold,
        direction: hypothesis.direction,
        bootstrapReplicates: family.bootstrapReplicates,
        seedMaterial: family.bootstrapSeedMaterial,
        inputSha256,
        segment: hypothesis.segment,
      });
      if (test.status !== 'evaluated') {
        return blocked('directional_hypothesis_test_set_invalid');
      }
      tests.push({
        hypothesisId: hypothesis.hypothesisId,
        objective: hypothesis.objective,
        segment: hypothesis.segment,
        test,
      });
    }
    const preimage = {
      contractVersion: 'verified_directional_hypothesis_test_set_v2' as const,
      familySha256: family.familySha256,
      qualificationProtocolSha256: family.qualificationProtocolSha256,
      datasetSha256: family.dataset.datasetSha256,
      holdoutSha256: family.holdout.holdoutSha256,
      bootstrapSeedMaterialSha256: digest(family.bootstrapSeedMaterial),
      tests,
      realDatasetEligible: false as const,
    };
    const candidate = {
      ...preimage,
      testSetSha256: digest(preimage),
    } as unknown as VerifiedDirectionalHypothesisTestSetV2;
    Object.defineProperty(candidate, testSetBrand, { value: true, enumerable: false });
    verifiedTestSets.add(candidate);
    recursivelyFreeze(candidate);
    testSetDigests.set(candidate, candidate.testSetSha256);
    return { status: 'verified', testSet: candidate };
  } catch {
    return blocked('directional_hypothesis_test_set_invalid');
  }
}

function isVerifiedDirectionalHypothesisTestSetV2(
  value: unknown,
): value is VerifiedDirectionalHypothesisTestSetV2 {
  try {
    if (!value || typeof value !== 'object' || !verifiedTestSets.has(value)) return false;
    const testSet = value as VerifiedDirectionalHypothesisTestSetV2;
    const { testSetSha256: _sha256, ...preimage } = testSet;
    return testSet[testSetBrand] === true
      && recursivelyFrozen(testSet)
      && testSetDigests.get(testSet) === testSet.testSetSha256
      && digest(preimage) === testSet.testSetSha256;
  } catch {
    return false;
  }
}

function verifiedMembership(
  family: VerifiedFrozenPolicyEvaluationFamilyV2,
  testSet: VerifiedDirectionalHypothesisTestSetV2,
): boolean {
  if (testSet.familySha256 !== family.familySha256
    || testSet.qualificationProtocolSha256 !== family.qualificationProtocolSha256
    || testSet.datasetSha256 !== family.dataset.datasetSha256
    || testSet.holdoutSha256 !== family.holdout.holdoutSha256
    || testSet.bootstrapSeedMaterialSha256 !== digest(family.bootstrapSeedMaterial)) return false;
  const supplied = testSet.tests;
  if (supplied.length !== family.hypotheses.length
    || new Set(supplied.map((entry) => entry.hypothesisId)).size !== supplied.length) return false;
  const byId = new Map(supplied.map((entry) => [entry.hypothesisId, entry]));
  return family.hypotheses.every((hypothesis) => {
    const bound = byId.get(hypothesis.hypothesisId);
    if (!bound || bound.test.status !== 'evaluated') return false;
    const { status: _status, thresholdTestSha256: _sha256, ...preimage } = bound.test;
    const test = bound.test;
    return test.direction === hypothesis.direction
      && test.alternative === hypothesis.alternative
      && test.nullThreshold === hypothesis.nullThreshold
      && test.bootstrapReplicates === family.bootstrapReplicates
      && bound.objective === hypothesis.objective
      && bound.segment === hypothesis.segment
      && test.thresholdTestSha256 === digest(preimage);
  });
}

function canonicalPValues(values: readonly PValue[]): PValue[] {
  return [...values].sort((left, right) => left.pValue - right.pValue
    || Buffer.compare(Buffer.from(left.hypothesisId), Buffer.from(right.hypothesisId)));
}

function valid(values: readonly PValue[], alpha: number): boolean {
  return values.length > 0
    && Number.isFinite(alpha) && alpha > 0 && alpha < 1
    && new Set(values.map((entry) => entry.hypothesisId)).size === values.length
    && values.every((entry) => entry.hypothesisId.length > 0
      && Number.isFinite(entry.pValue) && entry.pValue >= 0 && entry.pValue <= 1);
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalDecisionJson(value)).digest('hex');
}

function recursivelyFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => recursivelyFreeze(Reflect.get(value, key), seen));
  return Object.freeze(value);
}

function recursivelyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value)
    && Reflect.ownKeys(value).every((key) => recursivelyFrozen(Reflect.get(value, key), seen));
}

const blocked = (blocker: string) => ({ status: 'not_evaluable' as const, blocker });
