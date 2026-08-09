import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../../../../decisionLog/contracts';
import {
  isVerifiedFrozenInferenceQualificationProtocolV1,
  type VerifiedFrozenInferenceQualificationProtocolV1,
} from '../../v2/protocol';
import {
  PHASE13_FAILURE_ATTRIBUTION_CLASSIFICATION_V1,
  type VerifiedPhase12FailureAttributionSourceV1,
} from '../failureAttribution/contracts';
import { isVerifiedPhase12FailureAttributionSourceV1 } from '../failureAttribution/source';

export const FROZEN_INFERENCE_DIAGNOSTIC_DOMAIN_V1 =
  'frozen_inference_diagnostic_domain_v1' as const;

export type FrozenInferenceDiagnosticDomainV1 = {
  contractVersion: typeof FROZEN_INFERENCE_DIAGNOSTIC_DOMAIN_V1;
  protocolSha256: string;
  dgpVersion: 'synthetic_sequential_dr_dgp_v1';
  dgpSha256: string;
  scoreGeneratorVersion: 'synthetic_sequential_dr_cluster_score_v1';
  scoreGeneratorSha256: string;
  methodId: 'cluster_score_multiplier_bootstrap_t_v1';
  methodSha256: string;
  methodConfigSha256: string;
  revealedSeedDigests: {
    generatorSeedSha256: string;
    bootstrapSeedSha256: string;
  };
  canonicalScenarios: readonly {
    scenarioId: string;
    role: 'diagnostic_baseline' | 'fail_closed_control';
  }[];
  failureClassificationVersion: typeof PHASE13_FAILURE_ATTRIBUTION_CLASSIFICATION_V1;
  sourceAttributionReceiptSha256: string;
  qualificationEvidenceEligible: false;
  applicabilityStatus: 'not_assessed_no_candidate_selected';
  diagnosticDomainSha256: string;
};

const verifiedDomain = Symbol('verifiedFrozenInferenceDiagnosticDomainV1');
const verifiedDomains = new WeakSet<object>();
const verifiedDigests = new WeakMap<object, string>();

type BrandedDomain = FrozenInferenceDiagnosticDomainV1 & { readonly [verifiedDomain]: true };

export function buildFrozenInferenceDiagnosticDomainV1(input: unknown): { status: 'verified'; domain: BrandedDomain }
  | { status: 'not_evaluable'; blocker: 'failure_attribution_source_unverified' } {
  const fields = domainInput(input);
  if (!fields
    || !isVerifiedFrozenInferenceQualificationProtocolV1(fields.protocol)
    || !isVerifiedPhase12FailureAttributionSourceV1(fields.source)
    || fields.source.protocolSha256 !== fields.protocol.protocolSha256) {
    return { status: 'not_evaluable', blocker: 'failure_attribution_source_unverified' };
  }
  const preimage = domainPreimage(fields.protocol, fields.source);
  const candidate = {
    ...preimage, diagnosticDomainSha256: digest(preimage),
  } as unknown as BrandedDomain;
  Object.defineProperty(candidate, verifiedDomain, {
    value: true, enumerable: false, configurable: false, writable: false,
  });
  verifiedDomains.add(candidate);
  recursivelyFreeze(candidate);
  verifiedDigests.set(candidate, candidate.diagnosticDomainSha256);
  return { status: 'verified', domain: candidate };
}

function domainInput(value: unknown): { protocol: unknown; source: unknown } | null {
  if (!value || typeof value !== 'object') return null;
  try {
    return { protocol: Reflect.get(value, 'protocol'), source: Reflect.get(value, 'source') };
  } catch {
    return null;
  }
}

export function isVerifiedFrozenInferenceDiagnosticDomainV1(
  value: unknown,
): value is BrandedDomain {
  try {
    if (!value || typeof value !== 'object' || !verifiedDomains.has(value)) return false;
    const candidate = value as BrandedDomain;
    const { diagnosticDomainSha256, ...preimage } = candidate;
    return candidate[verifiedDomain] === true
      && recursivelyFrozen(candidate)
      && diagnosticDomainSha256 === digest(preimage)
      && verifiedDigests.get(candidate) === diagnosticDomainSha256;
  } catch {
    return false;
  }
}

function domainPreimage(
  protocol: VerifiedFrozenInferenceQualificationProtocolV1,
  source: VerifiedPhase12FailureAttributionSourceV1,
) {
  return {
    contractVersion: FROZEN_INFERENCE_DIAGNOSTIC_DOMAIN_V1,
    protocolSha256: protocol.protocolSha256,
    dgpVersion: protocol.dgpVersion,
    dgpSha256: digest({
      protocolSha256: protocol.protocolSha256,
      dgpVersion: protocol.dgpVersion,
    }),
    scoreGeneratorVersion: protocol.scoreGeneratorVersion,
    scoreGeneratorSha256: digest({
      protocolSha256: protocol.protocolSha256,
      scoreGeneratorVersion: protocol.scoreGeneratorVersion,
      seedDerivationVersion: protocol.seedDerivationVersion,
      metricDenominatorVersion: protocol.metricDenominatorVersion,
    }),
    methodId: 'cluster_score_multiplier_bootstrap_t_v1' as const,
    methodSha256: digest({
      methodId: 'cluster_score_multiplier_bootstrap_t_v1',
      directionalThresholdVersion: 'directional_threshold_test_v2',
      diagnosticCiVersion: 'diagnostic_ci_bootstrap_t_v1',
    }),
    methodConfigSha256: digest({
      methodId: 'cluster_score_multiplier_bootstrap_t_v1',
      bootstrapReplicates: protocol.bootstrapReplicates,
      confidenceLevel: protocol.confidenceLevel,
      directionalThresholdVersion: 'directional_threshold_test_v2',
      diagnosticCiVersion: 'diagnostic_ci_bootstrap_t_v1',
    }),
    revealedSeedDigests: {
      generatorSeedSha256: source.generatorSeedSha256,
      bootstrapSeedSha256: source.bootstrapSeedSha256,
    },
    canonicalScenarios: [
      ...protocol.scenarios.map((scenario) => ({
        scenarioId: scenario.scenarioId,
        role: 'diagnostic_baseline' as const,
      })),
      ...protocol.assumptionControlKinds.map((scenarioId) => ({
        scenarioId,
        role: 'fail_closed_control' as const,
      })),
      { scenarioId: 'invalid_studentizer_control', role: 'fail_closed_control' as const },
    ],
    failureClassificationVersion: PHASE13_FAILURE_ATTRIBUTION_CLASSIFICATION_V1,
    sourceAttributionReceiptSha256: source.sourceReceiptSha256,
    qualificationEvidenceEligible: false as const,
    applicabilityStatus: 'not_assessed_no_candidate_selected' as const,
  };
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
