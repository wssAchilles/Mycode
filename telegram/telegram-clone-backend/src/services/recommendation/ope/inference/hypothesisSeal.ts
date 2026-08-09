import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../decisionLog/contracts';
import {
  HYPOTHESIS_SEAL_RECEIPT_V1,
  ROBUST_INFERENCE_CONFIG_V1,
  ROBUST_INFERENCE_METHOD_V1,
  ROBUST_INFERENCE_SYNTHETIC_ABLATION_V1,
  VERIFIED_HYPOTHESIS_SEAL_V1,
  type FrozenOpeHypothesisManifestV1,
  type RobustInferenceExperimentalConfigV1,
  type SyntheticAblationPlanV1,
} from './contracts';

const verifiedSeal = Symbol('verifiedFrozenHypothesisSealV1');
const verifiedSeals = new WeakSet<object>();
const verifiedSealDigests = new WeakMap<object, string>();
const REVIEWED_CONFIG_SHA256 = '7fb37a39fa2867e1d104457fb9c4a995bc982e614776a0c37c7a3cf25b0c5111';
const REVIEWED_SCENARIO_SET_SHA256 = '09f0b47a0d9e1be1777682b8ad346063df6bc6193c6910d42fa240d0df5c595b';
const REVIEWED_SEAL_RECEIPT_SHA256 = '92339c9d9e32095a3f1f8ffa05544b92095b3fe90c93b55caf483ca923463470';
const REVIEWED_ROOT_SHA256 = '0608089817623e05a601d0a73cc29ba8ed0a638befa618530dcc0e776cb33263';

export const SYNTHETIC_FIXTURE_ROBUST_CONFIG_V1: RobustInferenceExperimentalConfigV1 = recursivelyFreeze({
  contractVersion: ROBUST_INFERENCE_CONFIG_V1,
  configVersion: 'phase10-synthetic-candidate-v1',
  method: ROBUST_INFERENCE_METHOD_V1,
  bootstrapReplicates: 127,
  maximumBootstrapWorkUnits: 5_000,
  confidenceLevel: 0.95,
  minimumClusters: 2,
  minimumClusterEss: 1,
  maximumScoreShare: 1,
  selfNormalizedBoundAssumptions: { status: 'unavailable' },
});

export const SYNTHETIC_FIXTURE_ABLATION_PLAN_V1: SyntheticAblationPlanV1 = recursivelyFreeze({
  contractVersion: ROBUST_INFERENCE_SYNTHETIC_ABLATION_V1,
  gates: {
    minimumNominalCoverage: 0.5,
    maximumFalsePromotionRate: 0.25,
    maximumInvalidReplicateRate: 0.2,
  },
  scenarios: [
    { scenarioId: 'heavy-tail-v1', scenarioKind: 'heavy_tail', knownTruth: 2.75, threshold: 1, promotionOperator: 'gte', projectionSha256: '8f7323ca6c6313ff9cb4baf7d586de3c39675de861e1565f75d0d9ddd041a4f7' },
    { scenarioId: 'nominal-v1', scenarioKind: 'nominal', knownTruth: 2.5, threshold: 1, promotionOperator: 'gte', projectionSha256: 'eccccec2f8888fdad563c8e8a9d76bcb3ad1f4a4de4f79d5e7cf602e74c50983' },
    { scenarioId: 'null-v1', scenarioKind: 'null', knownTruth: 0.5, threshold: 1, promotionOperator: 'gte', projectionSha256: 'c036dd95d2c5194ec8100093a310a5c086f50e805c0e5d72a21858a7d3963ea4' },
    { scenarioId: 'invalid-studentizer-v1', scenarioKind: 'invalid_studentizer', knownTruth: 1, threshold: 1, promotionOperator: 'gte', projectionSha256: '8287cab54ac4e5224605b21e890e55b225c2011e0bc9d0732a225279cc49fb8e' },
  ],
});

const configSha256 = digest(SYNTHETIC_FIXTURE_ROBUST_CONFIG_V1);
const scenarioSetSha256 = digest(SYNTHETIC_FIXTURE_ABLATION_PLAN_V1);
const manifestPreimage = {
  contractVersion: 'frozen_ope_hypothesis_manifest_v1' as const,
  hypothesisId: 'phase10-synthetic-ablation-v1',
  objective: 'r',
  estimator: 'dr' as const,
  segment: '__all__',
  threshold: 1,
  bootstrapSeedMaterial: 'phase10-fixed-seed-material',
  inferenceConfigSha256: REVIEWED_CONFIG_SHA256,
  syntheticScenarioSetSha256: REVIEWED_SCENARIO_SET_SHA256,
  frozenAt: '2026-07-16T07:00:00.000Z',
};
const hypothesis: FrozenOpeHypothesisManifestV1 = recursivelyFreeze({
  ...manifestPreimage,
  manifestSha256: digest(manifestPreimage),
});
const receiptPreimage = {
  contractVersion: HYPOTHESIS_SEAL_RECEIPT_V1,
  scope: 'synthetic_fixture' as const,
  sealAuthorityVersion: 'phase10_synthetic_fixture_root_v1' as const,
  hypothesisManifestSha256: hypothesis.manifestSha256,
  inferenceConfigSha256: REVIEWED_CONFIG_SHA256,
  syntheticScenarioSetSha256: REVIEWED_SCENARIO_SET_SHA256,
  sealedAt: '2026-07-16T07:00:00.000Z',
  holdoutNotBefore: '2026-07-16T08:00:00.000Z',
};
const receipt = recursivelyFreeze({ ...receiptPreimage, sealReceiptSha256: digest(receiptPreimage) });
const rootPreimage = {
  contractVersion: 'frozen_hypothesis_trust_root_v1' as const,
  scope: 'synthetic_fixture' as const,
  sealAuthorityVersion: receipt.sealAuthorityVersion,
  expectedSealReceiptSha256: REVIEWED_SEAL_RECEIPT_SHA256,
};
const syntheticRoot = recursivelyFreeze({ ...rootPreimage, rootSha256: digest(rootPreimage) });

export type VerifiedFrozenHypothesisSealV1 = {
  readonly [verifiedSeal]: true;
  contractVersion: typeof VERIFIED_HYPOTHESIS_SEAL_V1;
  trustScope: 'synthetic_fixture';
  hypothesis: FrozenOpeHypothesisManifestV1;
  receipt: typeof receipt;
  hypothesisSealEvidenceSha256: string;
  realDatasetEligible: false;
};

export function loadSyntheticFixtureHypothesisSealV1(): VerifiedFrozenHypothesisSealV1 {
  if (configSha256 !== REVIEWED_CONFIG_SHA256
    || scenarioSetSha256 !== REVIEWED_SCENARIO_SET_SHA256
    || receipt.sealReceiptSha256 !== REVIEWED_SEAL_RECEIPT_SHA256
    || syntheticRoot.rootSha256 !== REVIEWED_ROOT_SHA256) throw new Error('synthetic hypothesis root invalid');
  const preimage = { contractVersion: VERIFIED_HYPOTHESIS_SEAL_V1, trustScope: 'synthetic_fixture' as const, hypothesis, receipt, realDatasetEligible: false as const };
  const evidence = { ...preimage, hypothesisSealEvidenceSha256: digest(preimage) } as VerifiedFrozenHypothesisSealV1;
  Object.defineProperty(evidence, verifiedSeal, { value: true, enumerable: false, configurable: false });
  verifiedSeals.add(evidence);
  recursivelyFreeze(evidence);
  verifiedSealDigests.set(evidence, evidence.hypothesisSealEvidenceSha256);
  return evidence;
}

export function isVerifiedFrozenHypothesisSealV1(value: unknown): value is VerifiedFrozenHypothesisSealV1 {
  try {
    if (!value || typeof value !== 'object' || !verifiedSeals.has(value)) return false;
    const evidence = value as VerifiedFrozenHypothesisSealV1;
    const { hypothesisSealEvidenceSha256: _digest, ...preimage } = evidence;
    return evidence[verifiedSeal] === true
      && recursivelyFrozen(evidence)
      && evidence.realDatasetEligible === false
      && evidence.receipt.sealReceiptSha256 === syntheticRoot.expectedSealReceiptSha256
      && evidence.hypothesisSealEvidenceSha256 === digest(preimage)
      && verifiedSealDigests.get(evidence) === evidence.hypothesisSealEvidenceSha256;
  } catch {
    return false;
  }
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalDecisionJson(value)).digest('hex');
}

function recursivelyFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const property of Reflect.ownKeys(value)) recursivelyFreeze(Reflect.get(value, property), seen);
  Object.freeze(value);
  return value;
}

function recursivelyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value) && Reflect.ownKeys(value).every((property) => recursivelyFrozen(Reflect.get(value, property), seen));
}
