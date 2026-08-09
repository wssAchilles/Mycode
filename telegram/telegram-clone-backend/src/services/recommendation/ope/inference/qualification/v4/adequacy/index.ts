import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../../../../decisionLog/contracts';
import {
  deriveSyntheticDgpEnvelopeV1,
  type SyntheticDgpEnvelopeV1,
} from '../../v2/dgpMath';
import {
  isVerifiedFrozenInferenceQualificationProtocolV1,
  type VerifiedFrozenInferenceQualificationProtocolV1,
} from '../../v2/protocol';
import {
  isVerifiedFrozenInferenceDiagnosticDomainV1,
  type FrozenInferenceDiagnosticDomainV1,
} from '../../v3/diagnosticDomain';
import {
  type VerifiedPhase12FailureAttributionSourceV1,
} from '../../v3/failureAttribution/contracts';
import { isVerifiedPhase12FailureAttributionSourceV1 } from '../../v3/failureAttribution/source';
import {
  type HonestInferenceDiagnosticResultV1,
  isVerifiedHonestInferenceDiagnosticResultV1,
} from '../../v3/honestResult';
import { auditExactSignRandomizationResolutionV1 } from '../../v3/sensitivity';
import {
  PHASE14_DATA_ADEQUACY_EVIDENCE_GAPS_V1,
  VERIFIED_PHASE14_DATA_ADEQUACY_ASSESSMENT_V1,
  type Phase14DataAdequacyAssessmentResultV1,
  type Phase14ExactSignResolutionAuditV1,
  type Phase14ResearchFamilyEvidenceV1,
  type VerifiedPhase14DataAdequacyAssessmentV1,
} from './contracts';

export * from './contracts';

const verifiedAssessment = Symbol('verifiedPhase14DataAdequacyAssessmentV1');
const verifiedAssessments = new WeakSet<object>();
const verifiedDigests = new WeakMap<object, string>();

type BrandedAssessment = VerifiedPhase14DataAdequacyAssessmentV1 & {
  readonly [verifiedAssessment]: true;
};

export function buildPhase14DataAdequacyAssessmentV1(
  input: unknown,
): Phase14DataAdequacyAssessmentResultV1 {
  const fields = assessmentInput(input);
  if (!fields
    || !isVerifiedFrozenInferenceQualificationProtocolV1(fields.protocol)
    || !isVerifiedPhase12FailureAttributionSourceV1(fields.source)
    || !isVerifiedFrozenInferenceDiagnosticDomainV1(fields.domain)
    || !isVerifiedHonestInferenceDiagnosticResultV1(fields.honestResult)) {
    return { status: 'not_evaluable', blocker: 'adequacy_source_unverified' };
  }
  const verifiedFields = fields as VerifiedAssessmentInput;
  if (verifiedFields.honestResult.diagnosticStatus !== 'attributed') {
    return { status: 'not_evaluable', blocker: 'adequacy_source_not_attributed' };
  }
  if (!bindingsMatch(verifiedFields)) {
    return { status: 'not_evaluable', blocker: 'adequacy_binding_mismatch' };
  }

  let envelope: SyntheticDgpEnvelopeV1;
  try {
    envelope = deriveSyntheticDgpEnvelopeV1(verifiedFields.protocol);
  } catch {
    return { status: 'not_evaluable', blocker: 'synthetic_dgp_envelope_unavailable' };
  }
  const exactSignResolutionAudits = exactSignAudits(verifiedFields.protocol);
  if (!exactSignResolutionAudits) {
    return { status: 'not_evaluable', blocker: 'synthetic_dgp_envelope_unavailable' };
  }

  const preimage = assessmentPreimage(verifiedFields, envelope, exactSignResolutionAudits);
  const candidate = {
    ...preimage,
    assessmentSha256: digest(preimage),
  } as unknown as BrandedAssessment;
  Object.defineProperty(candidate, verifiedAssessment, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  verifiedAssessments.add(candidate);
  recursivelyFreeze(candidate);
  verifiedDigests.set(candidate, candidate.assessmentSha256);
  return { status: 'verified', assessment: candidate };
}

export function isVerifiedPhase14DataAdequacyAssessmentV1(
  value: unknown,
): value is BrandedAssessment {
  try {
    if (!value || typeof value !== 'object' || !verifiedAssessments.has(value)) return false;
    const candidate = value as BrandedAssessment;
    const { assessmentSha256, ...preimage } = candidate;
    return candidate[verifiedAssessment] === true
      && recursivelyFrozen(candidate)
      && assessmentSha256 === digest(preimage)
      && verifiedDigests.get(candidate) === assessmentSha256;
  } catch {
    return false;
  }
}

type VerifiedAssessmentInput = {
  protocol: VerifiedFrozenInferenceQualificationProtocolV1;
  source: VerifiedPhase12FailureAttributionSourceV1;
  domain: FrozenInferenceDiagnosticDomainV1;
  honestResult: HonestInferenceDiagnosticResultV1;
};

function assessmentInput(value: unknown): {
  protocol: unknown;
  source: unknown;
  domain: unknown;
  honestResult: unknown;
} | null {
  if (!value || typeof value !== 'object') return null;
  try {
    return {
      protocol: Reflect.get(value, 'protocol'),
      source: Reflect.get(value, 'source'),
      domain: Reflect.get(value, 'domain'),
      honestResult: Reflect.get(value, 'honestResult'),
    };
  } catch {
    return null;
  }
}

function bindingsMatch(fields: VerifiedAssessmentInput): boolean {
  const { protocol, source, domain, honestResult } = fields;
  return honestResult.diagnosticDomainSha256 === domain.diagnosticDomainSha256
    && domain.protocolSha256 === protocol.protocolSha256
    && domain.sourceAttributionReceiptSha256 === source.sourceReceiptSha256
    && source.protocolSha256 === protocol.protocolSha256
    && domain.dgpVersion === protocol.dgpVersion
    && domain.scoreGeneratorVersion === protocol.scoreGeneratorVersion
    && domain.revealedSeedDigests.generatorSeedSha256 === source.generatorSeedSha256
    && domain.revealedSeedDigests.bootstrapSeedSha256 === source.bootstrapSeedSha256
    && domain.failureClassificationVersion === source.failureClassificationVersion;
}

function exactSignAudits(
  protocol: VerifiedFrozenInferenceQualificationProtocolV1,
): readonly Phase14ExactSignResolutionAuditV1[] | null {
  const clusterCounts = [...new Set(protocol.scenarios.map((scenario) => scenario.clusterCount))]
    .sort((left, right) => left - right);
  const audits: Phase14ExactSignResolutionAuditV1[] = [];
  for (const clusterCount of clusterCounts) {
    const audit = auditExactSignRandomizationResolutionV1({ clusterCount });
    if (audit.status !== 'evaluated') return null;
    audits.push(audit);
  }
  return audits;
}

function assessmentPreimage(
  fields: VerifiedAssessmentInput,
  envelope: SyntheticDgpEnvelopeV1,
  exactSignResolutionAudits: readonly Phase14ExactSignResolutionAuditV1[],
) {
  const { protocol, source, domain, honestResult } = fields;
  return {
    contractVersion: VERIFIED_PHASE14_DATA_ADEQUACY_ASSESSMENT_V1,
    estimand: 'mean_reward_per_logged_slot_v1' as const,
    dataAdequacyStatus: 'current_evidence_insufficient' as const,
    candidateApplicabilityStatus: 'not_assessed_no_candidate_selected' as const,
    researchDisposition: 'current_evidence_insufficient_to_select_candidate' as const,
    qualificationEvidenceEligible: false as const,
    realDatasetEligible: false as const,
    sourceBindings: {
      protocolSha256: protocol.protocolSha256,
      qualificationSha256: source.qualificationSha256,
      generatorSeedSha256: source.generatorSeedSha256,
      bootstrapSeedSha256: source.bootstrapSeedSha256,
      rawArtifactSha256: source.rawArtifactSha256,
      rawArtifactRecordCount: source.rawArtifactRecordCount,
      rawArtifactByteCount: source.rawArtifactByteCount,
      sourceReceiptSha256: source.sourceReceiptSha256,
      attributionSha256: source.attributionSha256,
      attributionRecordCount: source.attributionRecordCount,
      diagnosticDomainSha256: domain.diagnosticDomainSha256,
      honestResultSha256: honestResult.resultSha256,
      dgpSha256: domain.dgpSha256,
      scoreGeneratorSha256: domain.scoreGeneratorSha256,
      diagnosticMethodSha256: domain.methodSha256,
      diagnosticMethodConfigSha256: domain.methodConfigSha256,
    },
    observedSyntheticEnvelope: {
      ...envelope,
      syntheticRewardSupport: [0, 1] as const,
      clusterUnitVersionPresent: false as const,
      viewerClusterProvenancePresent: false as const,
      crossFitProvenance: 'synthetic_direct_qhat_not_cross_fitted' as const,
      revealedDevelopmentEvidence: true as const,
      exactSignResolutionAudits,
    },
    researchEvidenceGaps: researchEvidenceGaps(),
    evidenceGaps: PHASE14_DATA_ADEQUACY_EVIDENCE_GAPS_V1,
  };
}

function researchEvidenceGaps(): readonly Phase14ResearchFamilyEvidenceV1[] {
  return [
    {
      researchFamily: 'cluster_multiplier_wild_bootstrap',
      unmetEvidence: [
        'viewer_cluster_provenance_unavailable',
        'independent_viewer_cluster_count_unverified',
      ],
    },
    {
      researchFamily: 'small_number_large_cluster_wild_bootstrap',
      unmetEvidence: [
        'viewer_cluster_provenance_unavailable',
        'within_viewer_cluster_observation_count_unverified',
      ],
    },
    {
      researchFamily: 'ibragimov_muller_group_t',
      unmetEvidence: [
        'viewer_cluster_provenance_unavailable',
        'independent_viewer_cluster_count_unverified',
        'within_viewer_cluster_observation_count_unverified',
      ],
    },
    {
      researchFamily: 'exact_sign_randomization',
      unmetEvidence: [
        'viewer_cluster_provenance_unavailable',
        'joint_sign_symmetry_unverified',
      ],
    },
    {
      researchFamily: 'bounded_self_normalized_robust_mean',
      unmetEvidence: [
        'viewer_cluster_provenance_unavailable',
        'real_randomized_propensity_evidence_unavailable',
        'real_full_support_evidence_unavailable',
        'real_reward_bounds_not_bound_to_assessment',
        'real_prefix_weight_bound_evidence_unavailable',
      ],
    },
    {
      researchFamily: 'off_policy_confidence_sequence',
      unmetEvidence: [
        'sequential_prefix_mapping_unverified',
        'common_time_shock_handling_unverified',
        'real_randomized_propensity_evidence_unavailable',
        'stopping_rule_unverified',
      ],
    },
  ];
}

function recursivelyFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) recursivelyFreeze(Reflect.get(value, key), seen);
  return Object.freeze(value);
}

function recursivelyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value)
    && Reflect.ownKeys(value).every((key) => recursivelyFrozen(Reflect.get(value, key), seen));
}

const digest = (value: unknown) => createHash('sha256')
  .update(canonicalDecisionJson(value)).digest('hex');
