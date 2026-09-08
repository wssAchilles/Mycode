import { canonicalDecisionJson } from '../../decisionLog/contracts';
import { canonicalWireJsonV1, sha256Text } from '../../offlinePrediction/artifacts/canonical';
import { verifyFrozenEvaluationFamilyV1 } from './family';
import { verifyHoldoutUseLedgerV1 } from './ledger';

export async function loadSyntheticFixtureEvaluationProtocolV1() {
  const familyPreimage = {
    contractVersion: 'frozen_evaluation_family_v1' as const,
    familyId: 'phase11-synthetic-evaluation-family-v1',
    candidatePolicies: [{
      policyId: 'candidate-policy',
      policyVersion: 'v1',
      policyConfigSha256: '1'.repeat(64),
    }],
    objectives: [{
      objective: 'engagement_utility_v1',
      estimator: 'dr' as const,
      operator: 'gte' as const,
      threshold: 0,
    }],
    segments: [{
      segmentKey: 'country',
      segmentValue: 'US',
      contextSourceVersion: 'verified_decision_context_set_v1',
      contextSourceSha256: '2'.repeat(64),
      pitBoundary: 'context_at_lte_available_at_lte_decision_at_v1' as const,
    }],
    estimand: 'mean_reward_per_logged_slot_v1' as const,
    dataset: {
      datasetId: 'phase11-synthetic-dataset-v1',
      datasetSha256: '3'.repeat(64),
    },
    holdout: {
      holdoutId: 'phase11-synthetic-holdout-v1',
      holdoutSha256: '4'.repeat(64),
    },
    seedMaterial: 'phase11-synthetic-fixed-seed',
    evidenceBindings: [
      { bindingId: 'outcome_evidence', sha256: '5'.repeat(64) },
      { bindingId: 'prediction_set', sha256: '6'.repeat(64) },
      { bindingId: 'target_distribution', sha256: '7'.repeat(64) },
    ],
    configBindings: [
      { bindingId: 'inference_config', sha256: '8'.repeat(64) },
      { bindingId: 'ope_config', sha256: '9'.repeat(64) },
    ],
    frozenAt: '2026-07-20T07:00:00.000Z',
    holdoutRevealNotBefore: '2026-07-20T08:00:00.000Z',
    multiplicityProcedure: 'intersection_union_all_must_pass_v1' as const,
    realDatasetEligible: false as const,
  };
  const familyResult = verifyFrozenEvaluationFamilyV1({
    ...familyPreimage,
    familySha256: digest(familyPreimage),
  });
  if (familyResult.status !== 'verified') {
    throw new Error(`synthetic evaluation family invalid: ${familyResult.blocker}`);
  }

  const ledgerId = 'phase11-synthetic-holdout-ledger-v1';
  const initialRoot = 'a'.repeat(64);
  const start = {
    recordType: 'ledger_start' as const,
    contractVersion: 'holdout_use_ledger_v1' as const,
    ledgerId,
    familySha256: familyResult.family.familySha256,
    holdoutSha256: familyResult.family.holdout.holdoutSha256,
    initialRoot,
    expectedUseCount: 1,
    realDatasetEligible: false as const,
  };
  const usePreimage = {
    recordType: 'holdout_use' as const,
    contractVersion: 'holdout_use_ledger_v1' as const,
    sequence: 1,
    useId: 'phase11-synthetic-holdout-use-1',
    familySha256: familyResult.family.familySha256,
    holdoutSha256: familyResult.family.holdout.holdoutSha256,
    purpose: 'offline_policy_evaluation_v1' as const,
    revealedAt: '2026-07-20T08:00:00.000Z',
    usedAt: '2026-07-20T08:30:00.000Z',
    priorChainHead: initialRoot,
  };
  const use = { ...usePreimage, recordSha256: digest(usePreimage) };
  const end = {
    recordType: 'ledger_end' as const,
    contractVersion: 'holdout_use_ledger_v1' as const,
    ledgerId,
    actualUseCount: 1,
    finalChainHead: use.recordSha256,
  };
  const raw = `${[start, use, end].map(canonicalWireJsonV1).join('\n')}\n`;
  const manifestPreimage = {
    contractVersion: 'holdout_use_ledger_manifest_v1' as const,
    ledgerId,
    familySha256: familyResult.family.familySha256,
    holdoutSha256: familyResult.family.holdout.holdoutSha256,
    rawSha256: sha256Text(raw),
    recordCount: 3,
    useCount: 1,
    initialRoot,
    finalChainHead: use.recordSha256,
    realDatasetEligible: false as const,
  };
  const manifest = {
    ...manifestPreimage,
    manifestSha256: digest(manifestPreimage),
  };
  const ledgerResult = await verifyHoldoutUseLedgerV1({
    trustScope: 'synthetic_fixture',
    family: familyResult.family,
    ledgerStream: async function* ledgerStream() { yield raw; },
    manifestRaw: `${canonicalWireJsonV1(manifest)}\n`,
  });
  if (ledgerResult.status !== 'verified') {
    throw new Error(`synthetic holdout ledger invalid: ${ledgerResult.blocker}`);
  }
  return Object.freeze({ family: familyResult.family, receipt: ledgerResult.receipt });
}

function digest(value: unknown): string {
  return sha256Text(canonicalDecisionJson(value));
}
