import { createHash } from 'crypto';

import {
  canonicalDecisionJson,
  decisionLogSha256,
  type RecommendationDecisionLogV1,
} from '../../decisionLog/contracts';
import {
  TARGET_DISTRIBUTION_MASS_TOLERANCE,
  recommendationDecisionLogSchema,
  targetDistributionManifestSchema,
  targetDistributionPolicyConfigSchema,
  targetDistributionReceiptSchema,
  targetDistributionRecordSchema,
  targetDistributionSourceManifestSchema,
  type TargetDistributionManifestV1,
  type TargetDistributionRecordV1,
  type TargetDistributionVerificationReceiptV1,
} from '../contracts/targetDistribution';
import { canonicalWireJsonV1 } from './canonical';

const verifiedTargetDistribution = Symbol('verifiedTargetDistribution');

export type VerifiedTargetDistributionStepV1 = {
  servedPosition: number;
  prefixActionKeys: Array<{
    candidateNamespace: 'serving_post_id' | 'model_post_id';
    candidateId: string;
    servedPosition: number;
  }>;
  actions: Array<{
    actionKey: {
      candidateNamespace: 'serving_post_id' | 'model_post_id';
      candidateId: string;
      servedPosition: number;
    };
    probability: number;
  }>;
};

export type VerifiedTargetDistributionEvidenceV1 = {
  readonly [verifiedTargetDistribution]: true;
  manifest: TargetDistributionManifestV1;
  receipt: TargetDistributionVerificationReceiptV1;
  targetManifestSha256: string;
  targetReceiptRawSha256: string;
  decisions: Array<{
    decisionId: string;
    decisionLogSha256: string;
    candidatePoolSha256: string;
    steps: VerifiedTargetDistributionStepV1[];
  }>;
};

export function isVerifiedTargetDistributionEvidenceV1(value: unknown): value is VerifiedTargetDistributionEvidenceV1 {
  return Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, verifiedTargetDistribution) && (value as VerifiedTargetDistributionEvidenceV1)[verifiedTargetDistribution] === true);
}

export type VerifyTargetDistributionResultV1 =
  | { status: 'verified'; evidence: VerifiedTargetDistributionEvidenceV1 }
  | { status: 'not_evaluable'; blocker: string };

export type TargetDistributionRawEvidenceV1 = {
  sourceDecisionNdjson: string;
  sourceDatasetManifestRaw: string;
  policyConfigRaw: string;
  distributionNdjson: string;
  targetManifestRaw: string;
  verificationReceiptRaw: string;
};

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const identity = (key: { candidateNamespace: string; candidateId: string }): string => (
  `${key.candidateNamespace}\u0000${key.candidateId}`
);
const compareText = (left: string, right: string): number => Buffer.compare(
  Buffer.from(left),
  Buffer.from(right),
);
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function normalizeWireNumberLexemes(raw: string): string {
  let output = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < raw.length;) {
    const character = raw[index];
    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      index += 1;
      continue;
    }
    if (character === '"') {
      inString = true;
      output += character;
      index += 1;
      continue;
    }
    if (character && /[-0-9]/.test(character)) {
      const match = raw.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (match) {
        const numeric = Number(match[0]);
        if (Number.isFinite(numeric)) {
          output += Object.is(numeric, -0) ? '0' : String(numeric);
          index += match[0].length;
          continue;
        }
      }
    }
    output += character;
    index += 1;
  }
  return output;
}

function jsonLines(raw: string): unknown[] | undefined {
  if (!raw.endsWith('\n')) return undefined;
  const lines = raw.slice(0, -1).split('\n');
  if (lines.length === 1 && lines[0] === '') return [];
  if (lines.some((line) => line.length === 0 || Buffer.byteLength(line) > 1 << 20)) return undefined;
  try {
    return lines.map((line) => JSON.parse(line));
  } catch {
    return undefined;
  }
}

function receiptDigest(receipt: TargetDistributionVerificationReceiptV1): string {
  const { verificationReceiptSha256: _ignored, ...preimage } = receipt;
  return digest(canonicalDecisionJson(preimage));
}

export function verifyTargetDistributionEvidenceV1(
  raw: TargetDistributionRawEvidenceV1,
): VerifyTargetDistributionResultV1 {
  if (
    Buffer.byteLength(raw.sourceDecisionNdjson) > 512 * 1024 * 1024
    || Buffer.byteLength(raw.distributionNdjson) > 512 * 1024 * 1024
    || Buffer.byteLength(raw.sourceDatasetManifestRaw) > 1 << 20
    || Buffer.byteLength(raw.targetManifestRaw) > 1 << 20
    || Buffer.byteLength(raw.verificationReceiptRaw) > 1 << 20
    || Buffer.byteLength(raw.policyConfigRaw) > 1 << 20
    || Buffer.byteLength(raw.sourceDecisionNdjson)
      + Buffer.byteLength(raw.distributionNdjson) > 1024 * 1024 * 1024
  ) {
    return { status: 'not_evaluable', blocker: 'resource_limit_exceeded' };
  }
  if (
    !raw.sourceDecisionNdjson.endsWith('\n')
    || !raw.sourceDatasetManifestRaw.endsWith('\n')
    || !raw.distributionNdjson.endsWith('\n')
    || !raw.targetManifestRaw.endsWith('\n')
    || !raw.verificationReceiptRaw.endsWith('\n')
  ) {
    return { status: 'not_evaluable', blocker: 'target_contract_invalid' };
  }
  let sourceManifestRaw: unknown;
  let targetManifestRaw: unknown;
  let receiptRaw: unknown;
  let policyConfigRaw: unknown;
  try {
    sourceManifestRaw = JSON.parse(raw.sourceDatasetManifestRaw);
    targetManifestRaw = JSON.parse(raw.targetManifestRaw);
    receiptRaw = JSON.parse(raw.verificationReceiptRaw);
    policyConfigRaw = JSON.parse(raw.policyConfigRaw);
  } catch {
    return { status: 'not_evaluable', blocker: 'target_contract_invalid' };
  }
  const sourceManifest = targetDistributionSourceManifestSchema.safeParse(sourceManifestRaw);
  const targetManifest = targetDistributionManifestSchema.safeParse(targetManifestRaw);
  const receipt = targetDistributionReceiptSchema.safeParse(receiptRaw);
  const policy = targetDistributionPolicyConfigSchema.safeParse(policyConfigRaw);
  const sourceLines = jsonLines(raw.sourceDecisionNdjson);
  const distributionLines = jsonLines(raw.distributionNdjson);
  if (
    !sourceManifest.success
    || !targetManifest.success
    || !receipt.success
    || !policy.success
    || !sourceLines
    || !distributionLines
  ) {
    return { status: 'not_evaluable', blocker: 'target_contract_invalid' };
  }
  if (sourceLines.length > 1_000_000 || distributionLines.length > 2_000_000) {
    return { status: 'not_evaluable', blocker: 'resource_limit_exceeded' };
  }
  if (receiptDigest(receipt.data) !== receipt.data.verificationReceiptSha256) {
    return { status: 'not_evaluable', blocker: 'target_receipt_digest_mismatch' };
  }
  const parsedSource: RecommendationDecisionLogV1[] = [];
  for (const line of sourceLines) {
    const parsed = recommendationDecisionLogSchema.safeParse(line);
    if (!parsed.success) return { status: 'not_evaluable', blocker: 'target_contract_invalid' };
    parsedSource.push(parsed.data);
  }
  const parsedRecords: TargetDistributionRecordV1[] = [];
  const distributionRawLines = raw.distributionNdjson.slice(0, -1).split('\n');
  for (const [index, line] of distributionLines.entries()) {
    const parsed = targetDistributionRecordSchema.safeParse(line);
    if (!parsed.success) return { status: 'not_evaluable', blocker: 'target_contract_invalid' };
    if (normalizeWireNumberLexemes(distributionRawLines[index]!) !== canonicalWireJsonV1(parsed.data)) {
      return { status: 'not_evaluable', blocker: 'target_canonical_wire_mismatch' };
    }
    parsedRecords.push(parsed.data);
  }
  const manifest = targetManifest.data;
  const verifiedReceipt = receipt.data;
  const source = sourceManifest.data;
  if (
    raw.sourceDatasetManifestRaw !== `${canonicalWireJsonV1(source)}\n`
    || raw.targetManifestRaw !== `${canonicalWireJsonV1(manifest)}\n`
    || raw.verificationReceiptRaw !== `${canonicalWireJsonV1(verifiedReceipt)}\n`
  ) {
    return { status: 'not_evaluable', blocker: 'target_canonical_wire_mismatch' };
  }
  const sourceDigest = digest(raw.sourceDecisionNdjson);
  const sourceManifestDigest = digest(raw.sourceDatasetManifestRaw);
  const distributionDigest = digest(raw.distributionNdjson);
  const targetManifestDigest = digest(raw.targetManifestRaw);
  const policyDigest = digest(canonicalDecisionJson(policy.data));
  if (
    source.sourceDecisionNdjsonSha256 !== sourceDigest
    || source.decisionCount !== sourceLines.length
    || manifest.datasetVersion !== source.datasetVersion
    || manifest.sourceDecisionNdjsonSha256 !== sourceDigest
    || manifest.sourceDatasetManifestSha256 !== sourceManifestDigest
    || manifest.policyConfigSha256 !== policyDigest
    || manifest.distributionNdjsonSha256 !== distributionDigest
    || verifiedReceipt.sourceDecisionNdjsonSha256 !== sourceDigest
    || verifiedReceipt.sourceDatasetManifestSha256 !== sourceManifestDigest
    || verifiedReceipt.policyConfigSha256 !== policyDigest
    || verifiedReceipt.distributionNdjsonSha256 !== distributionDigest
    || verifiedReceipt.targetManifestSha256 !== targetManifestDigest
  ) {
    return { status: 'not_evaluable', blocker: 'target_root_digest_mismatch' };
  }

  const sourceByDecision = new Map(parsedSource.map((decision) => [decision.decisionId, decision]));
  if (sourceByDecision.size !== parsedSource.length) {
    return { status: 'not_evaluable', blocker: 'target_source_decision_duplicate' };
  }
  const decisions: VerifiedTargetDistributionEvidenceV1['decisions'] = [];
  let index = 0;
  let stepCount = 0;
  let actionCount = 0;
  while (index < parsedRecords.length) {
    const startRecord = parsedRecords[index];
    if (!startRecord || startRecord.recordType !== 'decision_start') {
      return { status: 'not_evaluable', blocker: 'target_stream_grammar_mismatch' };
    }
    const start = startRecord;
    const decisionSource = sourceByDecision.get(start.decisionId);
    if (
      !decisionSource
      || decisionSource.candidatePool.supportEvidence.status !== 'complete'
      || decisionSource.candidatePool.truncated
      || start.decisionFingerprint.decisionId !== start.decisionId
      || start.decisionFingerprint.sha256 !== decisionLogSha256(decisionSource)
      || start.candidatePoolFingerprint.sha256 !== decisionSource.candidatePool.candidatePoolSha256
      || canonicalDecisionJson(start.policy) !== canonicalDecisionJson(policy.data)
    ) {
      return { status: 'not_evaluable', blocker: 'target_decision_binding_mismatch' };
    }
    const decisionRecords: TargetDistributionRecordV1[] = [start];
    const sourceActionsByPosition = [...decisionSource.actions].sort((left, right) => (
      left.actionKey.servedPosition - right.actionKey.servedPosition
    ));
    if (sourceActionsByPosition.some((action, actionIndex) => (
      action.actionKey.servedPosition !== actionIndex + 1
    ))) {
      return { status: 'not_evaluable', blocker: 'target_source_position_mismatch' };
    }
    const eligibleBaseline = [...decisionSource.candidatePool.candidates]
      .filter((candidate) => candidate.eligible)
      .sort((left, right) => (
        left.poolRank - right.poolRank
        || compareText(left.candidateNamespace, right.candidateNamespace)
        || compareText(left.candidateId, right.candidateId)
      ));
    const eligibleIdentities = new Set(eligibleBaseline.map(identity));
    if (eligibleIdentities.size !== eligibleBaseline.length) {
      return { status: 'not_evaluable', blocker: 'target_source_candidate_duplicate' };
    }
    const steps: VerifiedTargetDistributionStepV1[] = [];
    index += 1;
    while (index < parsedRecords.length) {
      const stepRecord = parsedRecords[index];
      if (!stepRecord || stepRecord.recordType !== 'step_start') break;
      const step = stepRecord;
      if (
        step.decisionId !== start.decisionId
        || step.servedPosition !== steps.length + 1
        || step.prefixActionKeys.length !== step.servedPosition - 1
        || canonicalDecisionJson(step.prefixActionKeys)
          !== canonicalDecisionJson(sourceActionsByPosition
            .slice(0, step.servedPosition - 1)
            .map((action) => action.actionKey))
      ) {
        return { status: 'not_evaluable', blocker: 'target_step_binding_mismatch' };
      }
      decisionRecords.push(step);
      index += 1;
      const actions: VerifiedTargetDistributionStepV1['actions'] = [];
      let plMass = 0;
      let mixedMass = 0;
      const identities = new Set<string>();
      while (index < parsedRecords.length) {
        const actionRecord = parsedRecords[index];
        if (!actionRecord || actionRecord.recordType !== 'action_probability') break;
        const action = actionRecord;
        if (
          action.decisionId !== start.decisionId
          || action.actionKey.servedPosition !== step.servedPosition
          || !identities.add(identity(action.actionKey))
        ) {
          return { status: 'not_evaluable', blocker: 'target_support_mismatch' };
        }
        const actionIndex = actions.length;
        if (action.deterministicTop !== (actionIndex === 0)) {
          return { status: 'not_evaluable', blocker: 'target_deterministic_top_mismatch' };
        }
        const expectedProbability = (actionIndex === 0 ? 1 - start.policy.epsilon : 0)
          + start.policy.epsilon * action.plackettLuceProbability;
        if (
          Math.abs(action.conditionalSelectionProbability - expectedProbability)
          > TARGET_DISTRIBUTION_MASS_TOLERANCE
        ) {
          return { status: 'not_evaluable', blocker: 'target_mixture_mismatch' };
        }
        plMass += action.plackettLuceProbability;
        mixedMass += action.conditionalSelectionProbability;
        actions.push({ actionKey: action.actionKey, probability: action.conditionalSelectionProbability });
        decisionRecords.push(action);
        index += 1;
      }
      const prefixIdentities = new Set(step.prefixActionKeys.map(identity));
      if (
        prefixIdentities.size !== step.prefixActionKeys.length
        || [...prefixIdentities].some((value) => !eligibleIdentities.has(value))
      ) {
        return { status: 'not_evaluable', blocker: 'target_prefix_support_mismatch' };
      }
      const expectedRemaining = eligibleBaseline
        .filter((candidate) => !prefixIdentities.has(identity(candidate)))
        .map(identity);
      if (
        actions.length !== step.expectedActionCount
        || canonicalDecisionJson(actions.map(({ actionKey }) => identity(actionKey)))
          !== canonicalDecisionJson(expectedRemaining)
        || Math.abs(plMass - 1) > TARGET_DISTRIBUTION_MASS_TOLERANCE
        || Math.abs(mixedMass - 1) > TARGET_DISTRIBUTION_MASS_TOLERANCE
        || Math.abs(Math.abs(plMass - 1) - step.plackettLuceMassError) > Number.EPSILON
        || Math.abs(Math.abs(mixedMass - 1) - step.mixedMassError) > Number.EPSILON
      ) {
        return { status: 'not_evaluable', blocker: 'target_probability_mass_mismatch' };
      }
      steps.push({
        servedPosition: step.servedPosition,
        prefixActionKeys: step.prefixActionKeys,
        actions,
      });
      stepCount += 1;
      actionCount += actions.length;
    }
    const end = parsedRecords[index];
    if (!end || end.recordType !== 'decision_end') {
      return { status: 'not_evaluable', blocker: 'target_stream_grammar_mismatch' };
    }
    const recordsDigest = digest(`${decisionRecords.map(canonicalDecisionJson).join('\n')}\n`);
    if (
      end.decisionId !== start.decisionId
      || end.stepCount !== steps.length
      || steps.length !== decisionSource.actions.length
      || end.actionProbabilityCount !== decisionRecords.length - steps.length - 1
      || end.decisionRecordsSha256 !== recordsDigest
    ) {
      return { status: 'not_evaluable', blocker: 'target_decision_digest_mismatch' };
    }
    decisions.push({
      decisionId: start.decisionId,
      decisionLogSha256: start.decisionFingerprint.sha256,
      candidatePoolSha256: start.candidatePoolFingerprint.sha256,
      steps,
    });
    index += 1;
  }
  if (
    manifest.decisionCount !== decisions.length
    || source.decisionCount !== decisions.length
    || manifest.stepCount !== stepCount
    || manifest.actionProbabilityCount !== actionCount
    || manifest.physicalRecordCount !== parsedRecords.length
    || verifiedReceipt.verifiedDecisionCount !== decisions.length
    || verifiedReceipt.verifiedStepCount !== stepCount
    || verifiedReceipt.verifiedActionProbabilityCount !== actionCount
    || verifiedReceipt.verifiedPhysicalRecordCount !== parsedRecords.length
  ) {
    return { status: 'not_evaluable', blocker: 'target_count_mismatch' };
  }
  if (
    new Set(decisions.map((decision) => decision.decisionId)).size !== decisions.length
    || canonicalDecisionJson(decisions.map((decision) => decision.decisionId).sort(compareText))
      !== canonicalDecisionJson(parsedSource.map((decision) => decision.decisionId).sort(compareText))
  ) {
    return { status: 'not_evaluable', blocker: 'target_source_membership_mismatch' };
  }

  return deepFreeze({
    status: 'verified',
    evidence: {
      [verifiedTargetDistribution]: true,
      manifest,
      receipt: verifiedReceipt,
      targetManifestSha256: targetManifestDigest,
      targetReceiptRawSha256: digest(raw.verificationReceiptRaw),
      decisions,
    },
  });
}
