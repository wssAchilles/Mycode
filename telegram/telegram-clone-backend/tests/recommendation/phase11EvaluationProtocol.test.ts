import { createHash } from 'crypto';

import { describe, expect, it } from 'vitest';

import { canonicalDecisionJson } from '../../src/services/recommendation/decisionLog/contracts';
import { canonicalWireJsonV1 } from '../../src/services/recommendation/offlinePrediction/artifacts/canonical';
import {
  HOLDOUT_LEDGER_LIMITS_V1,
  isVerifiedFrozenEvaluationFamilyV1,
  isVerifiedHoldoutUseLedgerReceiptV1,
  loadSyntheticFixtureEvaluationProtocolV1,
  verifyFrozenEvaluationFamilyV1,
  verifyHoldoutUseLedgerV1,
} from '../../src/services/recommendation/promotion/evaluationProtocol';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const selfDigest = (value: Record<string, unknown>, field: string): string => {
  const preimage = { ...value };
  delete preimage[field];
  return sha256(canonicalDecisionJson(preimage));
};
const stream = (raw: string) => async function* chunks(): AsyncIterable<Uint8Array> {
  const bytes = Buffer.from(raw);
  for (let offset = 0; offset < bytes.length; offset += 17) {
    yield bytes.subarray(offset, offset + 17);
  }
};

function familyInput(overrides: Record<string, unknown> = {}) {
  const preimage = {
    contractVersion: 'frozen_evaluation_family_v1' as const,
    familyId: 'phase11-synthetic-evaluation-family-v1',
    candidatePolicies: [{
      policyId: 'candidate-policy',
      policyVersion: 'v1',
      policyConfigSha256: '1'.repeat(64),
    }],
    objectives: [{ objective: 'engagement_utility_v1', estimator: 'dr' as const, operator: 'gte' as const, threshold: 0 }],
    segments: [{
      segmentKey: 'country',
      segmentValue: 'US',
      contextSourceVersion: 'verified_decision_context_set_v1',
      contextSourceSha256: '2'.repeat(64),
      pitBoundary: 'context_at_lte_available_at_lte_decision_at_v1' as const,
    }],
    estimand: 'mean_reward_per_logged_slot_v1' as const,
    dataset: { datasetId: 'phase11-synthetic-dataset-v1', datasetSha256: '3'.repeat(64) },
    holdout: { holdoutId: 'phase11-synthetic-holdout-v1', holdoutSha256: '4'.repeat(64) },
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
    ...overrides,
  };
  return { ...preimage, familySha256: sha256(canonicalDecisionJson(preimage)) };
}

type UseInput = {
  useId: string;
  revealedAt: string;
  usedAt: string;
  priorChainHead?: string;
};

function ledgerFixture(
  familySha256: string,
  uses: UseInput[] = [{
    useId: 'phase11-synthetic-holdout-use-1',
    revealedAt: '2026-07-20T08:00:00.000Z',
    usedAt: '2026-07-20T08:30:00.000Z',
  }],
) {
  const ledgerId = 'phase11-synthetic-holdout-ledger-v1';
  const holdoutSha256 = '4'.repeat(64);
  const initialRoot = 'a'.repeat(64);
  const start = {
    recordType: 'ledger_start' as const,
    contractVersion: 'holdout_use_ledger_v1' as const,
    ledgerId,
    familySha256,
    holdoutSha256,
    initialRoot,
    expectedUseCount: uses.length,
    realDatasetEligible: false as const,
  };
  let chainHead = initialRoot;
  const records = uses.map((input, index) => {
    const preimage = {
      recordType: 'holdout_use' as const,
      contractVersion: 'holdout_use_ledger_v1' as const,
      sequence: index + 1,
      useId: input.useId,
      familySha256,
      holdoutSha256,
      purpose: 'offline_policy_evaluation_v1' as const,
      revealedAt: input.revealedAt,
      usedAt: input.usedAt,
      priorChainHead: input.priorChainHead ?? chainHead,
    };
    const record = { ...preimage, recordSha256: sha256(canonicalDecisionJson(preimage)) };
    chainHead = record.recordSha256;
    return record;
  });
  const end = {
    recordType: 'ledger_end' as const,
    contractVersion: 'holdout_use_ledger_v1' as const,
    ledgerId,
    actualUseCount: records.length,
    finalChainHead: chainHead,
  };
  const raw = `${[start, ...records, end].map(canonicalWireJsonV1).join('\n')}\n`;
  const manifestPreimage = {
    contractVersion: 'holdout_use_ledger_manifest_v1' as const,
    ledgerId,
    familySha256,
    holdoutSha256,
    rawSha256: sha256(raw),
    recordCount: records.length + 2,
    useCount: records.length,
    initialRoot,
    finalChainHead: chainHead,
    realDatasetEligible: false as const,
  };
  const manifest = {
    ...manifestPreimage,
    manifestSha256: sha256(canonicalDecisionJson(manifestPreimage)),
  };
  return { raw, manifest, manifestRaw: `${canonicalWireJsonV1(manifest)}\n`, records };
}

function verifiedFamily(input = familyInput()) {
  const result = verifyFrozenEvaluationFamilyV1(input);
  if (result.status !== 'verified') throw new Error(result.blocker);
  return result.family;
}

describe('Phase 11 frozen evaluation protocol', () => {
  it('verifies only the registered complete synthetic stream and keeps the receipt immutable and blocked', async () => {
    const family = verifiedFamily();
    const fixture = ledgerFixture(family.familySha256);
    const input = {
      trustScope: 'synthetic_fixture' as const,
      family,
      ledgerStream: stream(fixture.raw),
      manifestRaw: fixture.manifestRaw,
    };
    const first = await verifyHoldoutUseLedgerV1(input);
    const replay = await verifyHoldoutUseLedgerV1(input);

    expect(first.status).toBe('verified');
    expect(replay.status).toBe('verified');
    if (first.status !== 'verified' || replay.status !== 'verified') return;
    expect(first.receipt).toEqual(replay.receipt);
    expect(first.receipt).toMatchObject({
      contractVersion: 'holdout_use_ledger_receipt_v1',
      trustScope: 'synthetic_fixture',
      rawSha256: fixture.manifest.rawSha256,
      recordCount: 3,
      finalChainHead: fixture.manifest.finalChainHead,
      trustedRootSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      realDatasetEligible: false,
      blockers: ['multiplicity_control_unavailable'],
    });
    expect(first.receipt.diagnostics).toMatchObject({
      highWaterUseIdCount: 1,
      highWaterHoldoutCount: 1,
    });
    expect(isVerifiedFrozenEvaluationFamilyV1(family)).toBe(true);
    expect(isVerifiedHoldoutUseLedgerReceiptV1(first.receipt)).toBe(true);
    expect(isVerifiedHoldoutUseLedgerReceiptV1(structuredClone(first.receipt))).toBe(false);
    expect(Object.isFrozen(first.receipt.diagnostics)).toBe(true);
    expect(() => { (first.receipt.blockers as string[]).push('removed'); }).toThrow(TypeError);
    const loaded = await loadSyntheticFixtureEvaluationProtocolV1();
    expect(isVerifiedFrozenEvaluationFamilyV1(loaded.family)).toBe(true);
    expect(isVerifiedHoldoutUseLedgerReceiptV1(loaded.receipt)).toBe(true);
    expect(await verifyHoldoutUseLedgerV1({ ...input, trustScope: 'production' })).toMatchObject({
      status: 'not_evaluable',
      blocker: 'holdout_ledger_completeness_unverified',
    });
  });

  it('rejects a caller-resigned prefix and ignores a caller-supplied fake root', async () => {
    const family = verifiedFamily();
    const prefix = ledgerFixture(family.familySha256, []);
    const prefixInput = {
      trustScope: 'synthetic_fixture',
      family,
      ledgerStream: stream(prefix.raw),
      manifestRaw: prefix.manifestRaw,
    } as const;
    expect(await verifyHoldoutUseLedgerV1(prefixInput)).toMatchObject({
      status: 'not_evaluable',
      blocker: 'holdout_ledger_completeness_unverified',
    });
    const result = await verifyHoldoutUseLedgerV1({
      ...prefixInput,
      trustedRoot: {
        rawSha256: prefix.manifest.rawSha256,
        recordCount: prefix.manifest.recordCount,
        initialRoot: prefix.manifest.initialRoot,
        finalChainHead: prefix.manifest.finalChainHead,
        manifestSha256: prefix.manifest.manifestSha256,
      },
    } as never);
    expect(result).toMatchObject({
      status: 'not_evaluable',
      blocker: 'holdout_ledger_completeness_unverified',
      blockers: ['multiplicity_control_unavailable', 'holdout_ledger_completeness_unverified'],
    });
  });

  it('snapshots accessor-backed input before issuing a family-bound receipt', async () => {
    const family = verifiedFamily();
    const adaptive = verifiedFamily(familyInput({ configBindings: [
      { bindingId: 'inference_config', sha256: 'c'.repeat(64) },
      { bindingId: 'ope_config', sha256: '9'.repeat(64) },
    ] }));
    const fixture = ledgerFixture(family.familySha256);
    let familyReads = 0;
    const input = new Proxy({
      trustScope: 'synthetic_fixture' as const,
      family,
      ledgerStream: stream(fixture.raw),
      manifestRaw: fixture.manifestRaw,
    }, {
      get(target, property, receiver) {
        if (property !== 'family') return Reflect.get(target, property, receiver);
        familyReads += 1;
        return familyReads <= 2 ? family : adaptive;
      },
    });

    const result = await verifyHoldoutUseLedgerV1(input);

    expect(result.status).toBe('verified');
    expect(familyReads).toBe(1);
    if (result.status !== 'verified') return;
    expect(result.receipt.familySha256).toBe(family.familySha256);
    expect(result.receipt.familySha256).not.toBe(adaptive.familySha256);
    expect(isVerifiedHoldoutUseLedgerReceiptV1(result.receipt)).toBe(true);
  });

  it('rejects oversized and empty stream chunks before ledger parsing', async () => {
    const family = verifiedFamily();
    const fixture = ledgerFixture(family.familySha256);
    const verifyStream = (ledgerStream: () => AsyncIterable<Uint8Array>) => verifyHoldoutUseLedgerV1({
      trustScope: 'synthetic_fixture',
      family,
      ledgerStream,
      manifestRaw: fixture.manifestRaw,
    });
    let underreportedLengthReads = 0;
    class UnderreportedBytes extends Uint8Array {
      override get byteLength(): number {
        underreportedLengthReads += 1;
        return 1;
      }
    }
    let overreportedLengthReads = 0;
    class OverreportedEmptyBytes extends Uint8Array {
      override get byteLength(): number {
        overreportedLengthReads += 1;
        return 1;
      }
    }
    const oversized = async function* oversized(): AsyncIterable<Uint8Array> {
      yield new UnderreportedBytes(HOLDOUT_LEDGER_LIMITS_V1.maximumFileBytes + 1);
    };
    const empty = async function* empty(): AsyncIterable<Uint8Array> {
      yield new OverreportedEmptyBytes(0);
      yield Buffer.from(fixture.raw);
    };

    expect(await verifyStream(oversized)).toMatchObject({
      status: 'not_evaluable',
      blocker: 'resource_limit_exceeded',
    });
    expect(underreportedLengthReads).toBe(0);
    expect(await verifyStream(empty)).toMatchObject({
      status: 'not_evaluable',
      blocker: 'holdout_ledger_contract_invalid',
    });
    expect(overreportedLengthReads).toBe(0);
  });

  it('fails closed for chain, digest, count, duplicate-use, and duplicate-holdout drift', async () => {
    const family = verifiedFamily();
    const valid = ledgerFixture(family.familySha256);
    const verify = (fixture: ReturnType<typeof ledgerFixture>) => verifyHoldoutUseLedgerV1({
      trustScope: 'synthetic_fixture', family, ledgerStream: stream(fixture.raw), manifestRaw: fixture.manifestRaw,
    });

    const brokenChain = ledgerFixture(family.familySha256, [{
      useId: 'phase11-synthetic-holdout-use-1',
      revealedAt: '2026-07-20T08:00:00.000Z',
      usedAt: '2026-07-20T08:30:00.000Z',
      priorChainHead: 'b'.repeat(64),
    }]);
    expect(await verify(brokenChain)).toMatchObject({ status: 'not_evaluable', blocker: 'holdout_ledger_chain_mismatch' });

    const countDrift = structuredClone(valid.manifest);
    countDrift.recordCount += 1;
    countDrift.manifestSha256 = selfDigest(countDrift, 'manifestSha256');
    expect(await verify({ ...valid, manifest: countDrift, manifestRaw: `${canonicalWireJsonV1(countDrift)}\n` }))
      .toMatchObject({ status: 'not_evaluable', blocker: 'holdout_ledger_count_mismatch' });

    const digestDrift = structuredClone(valid.manifest);
    digestDrift.manifestSha256 = 'f'.repeat(64);
    expect(await verify({ ...valid, manifest: digestDrift, manifestRaw: `${canonicalWireJsonV1(digestDrift)}\n` }))
      .toMatchObject({ status: 'not_evaluable', blocker: 'holdout_ledger_digest_mismatch' });

    const duplicateId = ledgerFixture(family.familySha256, [
      { useId: 'duplicate', revealedAt: '2026-07-20T08:00:00.000Z', usedAt: '2026-07-20T08:30:00.000Z' },
      { useId: 'duplicate', revealedAt: '2026-07-20T08:00:01.000Z', usedAt: '2026-07-20T08:30:01.000Z' },
    ]);
    expect(await verify(duplicateId)).toMatchObject({ status: 'not_evaluable', blocker: 'holdout_use_conflict' });

    const duplicateHoldout = ledgerFixture(family.familySha256, [
      { useId: 'use-1', revealedAt: '2026-07-20T08:00:00.000Z', usedAt: '2026-07-20T08:30:00.000Z' },
      { useId: 'use-2', revealedAt: '2026-07-20T08:00:01.000Z', usedAt: '2026-07-20T08:30:01.000Z' },
    ]);
    expect(await verify(duplicateHoldout)).toMatchObject({ status: 'not_evaluable', blocker: 'holdout_already_used' });
  });

  it('rejects non-frozen or noncanonical families and adaptive family drift cannot reuse the root', async () => {
    const multiple = familyInput({
      candidatePolicies: [
        { policyId: 'candidate-a', policyVersion: 'v1', policyConfigSha256: '1'.repeat(64) },
        { policyId: 'candidate-b', policyVersion: 'v1', policyConfigSha256: '2'.repeat(64) },
      ],
    });
    expect(verifyFrozenEvaluationFamilyV1(multiple)).toMatchObject({
      status: 'not_evaluable', blocker: 'single_candidate_required',
    });
    expect(verifyFrozenEvaluationFamilyV1(familyInput({
      frozenAt: '2026-07-20T08:00:00.000Z',
      holdoutRevealNotBefore: '2026-07-20T08:00:00.000Z',
    }))).toMatchObject({ status: 'not_evaluable', blocker: 'family_not_frozen_before_holdout' });
    expect(verifyFrozenEvaluationFamilyV1(familyInput({
      frozenAt: '2026-07-20T07:00:00+00:00',
    }))).toMatchObject({ status: 'not_evaluable', blocker: 'frozen_evaluation_family_invalid' });
    expect(verifyFrozenEvaluationFamilyV1({
      ...familyInput(), familySha256: 'f'.repeat(64),
    })).toMatchObject({ status: 'not_evaluable', blocker: 'frozen_evaluation_family_digest_mismatch' });
    expect(verifyFrozenEvaluationFamilyV1({
      ...familyInput(), objectives: [
        { objective: 'b', estimator: 'dr', operator: 'gte', threshold: 0 },
        { objective: 'a', estimator: 'dr', operator: 'gte', threshold: 0 },
      ],
    })).toMatchObject({ status: 'not_evaluable', blocker: 'family_array_not_canonical' });
    expect(verifyFrozenEvaluationFamilyV1(familyInput({ objectives: [
      { objective: 'same', estimator: 'ips', operator: 'gte', threshold: 0 },
      { objective: 'same', estimator: 'dr', operator: 'lte', threshold: 1 },
    ] }))).toMatchObject({ status: 'not_evaluable', blocker: 'family_array_duplicate' });

    const adaptiveInput = familyInput({ configBindings: [
      { bindingId: 'inference_config', sha256: 'c'.repeat(64) },
      { bindingId: 'ope_config', sha256: '9'.repeat(64) },
    ] });
    const adaptive = verifiedFamily(adaptiveInput);
    const adaptiveLedger = ledgerFixture(adaptive.familySha256);
    expect(await verifyHoldoutUseLedgerV1({
      trustScope: 'synthetic_fixture',
      family: adaptive,
      ledgerStream: stream(adaptiveLedger.raw),
      manifestRaw: adaptiveLedger.manifestRaw,
    })).toMatchObject({ status: 'not_evaluable', blocker: 'holdout_ledger_completeness_unverified' });
  });
});
