import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../../../../decisionLog/contracts';
import {
  PHASE19_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1,
  isVerifiedPhase19SameProcessNoCandidateHandoffV1,
  type Phase19SameProcessOfflineDiagnosticHandoffV1,
} from '../../v9/handoff';
import {
  FROZEN_MULTIWAY_DGP_PROTOCOL_V2,
  SYNTHETIC_MULTIWAY_DR_DGP_V2,
  isVerifiedFrozenMultiwayDgpProtocolV2,
  type VerifiedFrozenMultiwayDgpProtocolV2,
} from '../dgp';
import {
  VERIFIED_SYNTHETIC_MULTIWAY_SCORE_SURFACE_V1,
  isVerifiedMultiwayScoreSurfaceV1,
  type VerifiedMultiwayScoreSurfaceV1,
} from '../scoreSurface';
import {
  PHASE20_HANDOFF_BLOCKERS_V1,
  PHASE20_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1,
  type Phase20HandoffBlockerV1,
  type Phase20HandoffBuildResultV1,
  type Phase20SameProcessOfflineDiagnosticHandoffV1,
} from './contracts';

export * from './contracts';

const verifiedHandoff = Symbol('verifiedPhase20SameProcessOfflineDiagnosticHandoffV1');
const verifiedObjects = new WeakSet<object>();
const verifiedDigests = new WeakMap<object, string>();
const verifiedOwners = new WeakMap<object, Readonly<{
  phase19Handoff: Phase19SameProcessOfflineDiagnosticHandoffV1;
  dgpProtocol: VerifiedFrozenMultiwayDgpProtocolV2;
  scoreSurface: VerifiedMultiwayScoreSurfaceV1;
}>>();

type BrandedHandoff = Phase20SameProcessOfflineDiagnosticHandoffV1 & {
  readonly [verifiedHandoff]: true;
};

type Phase20SourceBindingsV1 = Readonly<{
  phase19HandoffSha256: string;
  dgpProtocolSha256: string;
  scoreSurfaceSha256: string;
}>;

export function buildPhase20SameProcessNoCandidateHandoffV1(
  input: unknown,
): Phase20HandoffBuildResultV1 {
  try {
    if (!isInputRecord(input)) return reject('phase20_handoff_source_unverified');

    const phase19Read = readProperty(input, 'phase19Handoff');
    if (!phase19Read.ok
      || !isVerifiedPhase19SameProcessNoCandidateHandoffV1(phase19Read.value)) {
      return reject('phase20_handoff_source_unverified');
    }
    const phase19Handoff = phase19Read.value;

    const dgpRead = readFirstProperty(input, 'dgpProtocol', 'protocol');
    if (!dgpRead.ok || !isVerifiedFrozenMultiwayDgpProtocolV2(dgpRead.value)) {
      return reject('phase20_handoff_source_unverified');
    }
    const dgpProtocol = dgpRead.value;

    const surfaceRead = readFirstProperty(input, 'scoreSurface', 'surface');
    if (!surfaceRead.ok || !isVerifiedMultiwayScoreSurfaceV1(surfaceRead.value)) {
      return reject('phase20_handoff_source_unverified');
    }
    const scoreSurface = surfaceRead.value;

    const sourceBindings = readSourceBindings(phase19Handoff, dgpProtocol, scoreSurface);
    if (!sourceBindings) return reject('phase20_handoff_source_unverified');

    if (!sourcesBind(phase19Handoff, dgpProtocol, scoreSurface)) {
      return reject('phase20_handoff_binding_mismatch');
    }

    const preimage = {
      contractVersion: PHASE20_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1,
      handoffScope: 'same_process_offline_diagnostic_v1' as const,
      developmentStatus: 'completed_frozen_multiway_dgp_v2_no_candidate_selected' as const,
      dgpV2Status: 'verified_synthetic_development_only' as const,
      multiwayScoreSurfaceStatus: 'verified_synthetic_only' as const,
      commonTimeShockScenarioPresent: true as const,
      commonTimeShockHandlingVerified: false as const,
      multiwayQHatQualityStatus:
        'not_assessed_prediction_v4_mechanical_fixture_only' as const,
      researchCandidateMethod: null,
      candidateSelectionStatus: 'no_candidate_selected' as const,
      candidateQualificationStatus: 'not_run' as const,
      candidateApplicabilityStatus: 'not_assessed_no_candidate_selected' as const,
      selectedMethod: 'diagnostics_only_abstention_v1' as const,
      qualificationEvidenceEligible: false as const,
      candidateEvidenceEligible: false as const,
      realDatasetEligible: false as const,
      servable: false as const,
      sealedQualificationStatus: 'not_ready' as const,
      nextPhaseHandoff: 'ready_to_research_candidate_on_frozen_dgp_v2' as const,
      ...sourceBindings,
      blockers: PHASE20_HANDOFF_BLOCKERS_V1,
    };
    const handoffSha256 = digest(preimage);
    const candidate = {
      ...preimage,
      handoffSha256,
    } as unknown as BrandedHandoff;
    Object.defineProperty(candidate, verifiedHandoff, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    recursivelyFreeze(candidate);
    verifiedDigests.set(candidate, handoffSha256);
    verifiedOwners.set(candidate, Object.freeze({ phase19Handoff, dgpProtocol, scoreSurface }));
    verifiedObjects.add(candidate);
    return { status: 'verified', handoff: candidate };
  } catch {
    return reject('phase20_handoff_source_unverified');
  }
}

export function isVerifiedPhase20SameProcessNoCandidateHandoffV1(
  value: unknown,
): value is BrandedHandoff {
  try {
    if (!isObjectLike(value) || !verifiedObjects.has(value)) return false;
    const candidate = value as BrandedHandoff;
    const owners = verifiedOwners.get(candidate);
    if (!owners) return false;
    const phase19Handoff = safeGet(owners, 'phase19Handoff');
    const dgpProtocol = safeGet(owners, 'dgpProtocol');
    const scoreSurface = safeGet(owners, 'scoreSurface');
    if (!isVerifiedPhase19SameProcessNoCandidateHandoffV1(phase19Handoff)
      || !isVerifiedFrozenMultiwayDgpProtocolV2(dgpProtocol)
      || !isVerifiedMultiwayScoreSurfaceV1(scoreSurface)) return false;
    const sourceBindings = readSourceBindings(phase19Handoff, dgpProtocol, scoreSurface);
    if (!sourceBindings) return false;
    const handoffSha256 = safeGet(candidate, 'handoffSha256');
    const preimage = { ...candidate } as Record<string, unknown>;
    if (!Reflect.deleteProperty(preimage, 'handoffSha256')) return false;
    return safeGet(candidate, verifiedHandoff) === true
      && fixedHandoffState(candidate)
      && recursivelyFrozen(candidate)
      && typeof handoffSha256 === 'string'
      && handoffSha256 === digest(preimage)
      && verifiedDigests.get(candidate) === handoffSha256
      && sourcesBind(phase19Handoff, dgpProtocol, scoreSurface)
      && safeGet(candidate, 'phase19HandoffSha256')
        === sourceBindings.phase19HandoffSha256
      && safeGet(candidate, 'dgpProtocolSha256') === sourceBindings.dgpProtocolSha256
      && safeGet(candidate, 'scoreSurfaceSha256') === sourceBindings.scoreSurfaceSha256;
  } catch {
    return false;
  }
}

function sourcesBind(
  phase19Handoff: Phase19SameProcessOfflineDiagnosticHandoffV1,
  dgpProtocol: VerifiedFrozenMultiwayDgpProtocolV2,
  scoreSurface: VerifiedMultiwayScoreSurfaceV1,
): boolean {
  return safeGet(phase19Handoff, 'contractVersion')
      === PHASE19_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1
    && safeGet(phase19Handoff, 'handoffScope') === 'same_process_offline_diagnostic_v1'
    && safeGet(phase19Handoff, 'developmentStatus')
      === 'completed_multiway_qhat_retraining_no_candidate_selected'
    && safeGet(phase19Handoff, 'multiwayQHatProvenanceStatus')
      === 'verified_synthetic_only'
    && safeGet(phase19Handoff, 'trainingApplied') === true
    && safeGet(phase19Handoff, 'trainingEvidenceScope') === 'mechanical_training_e2e_only'
    && safeGet(phase19Handoff, 'dgpV2LaunchReadiness') === 'ready_for_frozen_design'
    && safeGet(phase19Handoff, 'commonTimeShockHandlingVerified') === false
    && safeGet(phase19Handoff, 'researchCandidateMethod') === null
    && safeGet(phase19Handoff, 'candidateSelectionStatus') === 'no_candidate_selected'
    && safeGet(phase19Handoff, 'candidateQualificationStatus') === 'not_run'
    && safeGet(phase19Handoff, 'selectedMethod') === 'diagnostics_only_abstention_v1'
    && safeGet(phase19Handoff, 'candidateApplicabilityStatus')
      === 'not_assessed_no_candidate_selected'
    && safeGet(phase19Handoff, 'qualificationEvidenceEligible') === false
    && safeGet(phase19Handoff, 'candidateEvidenceEligible') === false
    && safeGet(phase19Handoff, 'realDatasetEligible') === false
    && safeGet(phase19Handoff, 'servable') === false
    && safeGet(phase19Handoff, 'sealedQualificationStatus') === 'not_ready'
    && safeGet(phase19Handoff, 'nextPhaseHandoff') === 'ready_to_design_frozen_dgp_v2'
    && safeGet(dgpProtocol, 'contractVersion') === FROZEN_MULTIWAY_DGP_PROTOCOL_V2
    && safeGet(dgpProtocol, 'dgpVersion') === SYNTHETIC_MULTIWAY_DR_DGP_V2
    && safeGet(dgpProtocol, 'commonTimeShockScenarioPresent') === true
    && safeGet(dgpProtocol, 'syntheticOnly') === true
    && safeGet(dgpProtocol, 'realDatasetEligible') === false
    && safeGet(dgpProtocol, 'ciGenerated') === false
    && safeGet(dgpProtocol, 'inferenceGenerated') === false
    && safeGet(dgpProtocol, 'candidateGenerated') === false
    && safeGet(dgpProtocol, 'servable') === false
    && safeGet(scoreSurface, 'contractVersion')
      === VERIFIED_SYNTHETIC_MULTIWAY_SCORE_SURFACE_V1
    && safeGet(scoreSurface, 'protocolSha256') === safeGet(dgpProtocol, 'protocolSha256')
    && safeGet(scoreSurface, 'dgpProtocolSha256') === safeGet(dgpProtocol, 'protocolSha256')
    && safeGet(scoreSurface, 'dgpV2Status') === 'verified_synthetic_development_only'
    && safeGet(scoreSurface, 'multiwayScoreSurfaceStatus') === 'verified_synthetic_only'
    && safeGet(scoreSurface, 'multiwayQHatQualityStatus')
      === 'not_assessed_prediction_v4_mechanical_fixture_only'
    && safeGet(scoreSurface, 'commonTimeShockHandlingVerified') === false
    && safeGet(scoreSurface, 'candidateSelectionStatus') === 'no_candidate_selected'
    && safeGet(scoreSurface, 'candidateQualificationStatus') === 'not_run'
    && safeGet(scoreSurface, 'selectedMethod') === 'diagnostics_only_abstention_v1'
    && safeGet(scoreSurface, 'candidateEvidenceEligible') === false
    && safeGet(scoreSurface, 'qualificationEvidenceEligible') === false
    && safeGet(scoreSurface, 'realDatasetEligible') === false
    && safeGet(scoreSurface, 'servable') === false
    && safeGet(scoreSurface, 'nextPhaseHandoff')
      === 'ready_to_research_candidate_on_frozen_dgp_v2';
}

function readSourceBindings(
  phase19Handoff: Phase19SameProcessOfflineDiagnosticHandoffV1,
  dgpProtocol: VerifiedFrozenMultiwayDgpProtocolV2,
  scoreSurface: VerifiedMultiwayScoreSurfaceV1,
): Phase20SourceBindingsV1 | null {
  const phase19HandoffSha256 = safeGet(phase19Handoff, 'handoffSha256');
  const dgpProtocolSha256 = safeGet(dgpProtocol, 'protocolSha256');
  const scoreSurfaceSha256 = safeGet(scoreSurface, 'surfaceSha256');
  if (!isSha256(phase19HandoffSha256)
    || !isSha256(dgpProtocolSha256)
    || !isSha256(scoreSurfaceSha256)) return null;
  return { phase19HandoffSha256, dgpProtocolSha256, scoreSurfaceSha256 };
}

function fixedHandoffState(candidate: BrandedHandoff): boolean {
  return safeGet(candidate, 'contractVersion')
      === PHASE20_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1
    && safeGet(candidate, 'handoffScope') === 'same_process_offline_diagnostic_v1'
    && safeGet(candidate, 'developmentStatus')
      === 'completed_frozen_multiway_dgp_v2_no_candidate_selected'
    && safeGet(candidate, 'dgpV2Status') === 'verified_synthetic_development_only'
    && safeGet(candidate, 'multiwayScoreSurfaceStatus') === 'verified_synthetic_only'
    && safeGet(candidate, 'commonTimeShockScenarioPresent') === true
    && safeGet(candidate, 'commonTimeShockHandlingVerified') === false
    && safeGet(candidate, 'multiwayQHatQualityStatus')
      === 'not_assessed_prediction_v4_mechanical_fixture_only'
    && safeGet(candidate, 'researchCandidateMethod') === null
    && safeGet(candidate, 'candidateSelectionStatus') === 'no_candidate_selected'
    && safeGet(candidate, 'candidateQualificationStatus') === 'not_run'
    && safeGet(candidate, 'candidateApplicabilityStatus')
      === 'not_assessed_no_candidate_selected'
    && safeGet(candidate, 'selectedMethod') === 'diagnostics_only_abstention_v1'
    && safeGet(candidate, 'qualificationEvidenceEligible') === false
    && safeGet(candidate, 'candidateEvidenceEligible') === false
    && safeGet(candidate, 'realDatasetEligible') === false
    && safeGet(candidate, 'servable') === false
    && safeGet(candidate, 'sealedQualificationStatus') === 'not_ready'
    && safeGet(candidate, 'nextPhaseHandoff')
      === 'ready_to_research_candidate_on_frozen_dgp_v2'
    && stableBlockerOrder(candidate);
}

function stableBlockerOrder(value: unknown): boolean {
  const blockers = safeGet(value, 'blockers');
  try {
    return Array.isArray(blockers)
      && safeGet(blockers, 'length') === PHASE20_HANDOFF_BLOCKERS_V1.length
      && PHASE20_HANDOFF_BLOCKERS_V1.every(
        (blocker, index) => safeGet(blockers, index) === blocker,
      );
  } catch {
    return false;
  }
}

function reject(blocker: Phase20HandoffBlockerV1): Phase20HandoffBuildResultV1 {
  return { status: 'not_evaluable', blocker };
}

function isObjectLike(value: unknown): value is object {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function isInputRecord(value: unknown): value is object {
  try {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  } catch {
    return false;
  }
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function readProperty(
  value: object,
  key: PropertyKey,
): Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false }> {
  try {
    return { ok: true, value: Reflect.get(value, key) };
  } catch {
    return { ok: false };
  }
}

function readFirstProperty(
  value: object,
  primary: PropertyKey,
  alias: PropertyKey,
): Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false }> {
  const first = readProperty(value, primary);
  if (!first.ok || first.value !== undefined) return first;
  return readProperty(value, alias);
}

function safeGet(value: unknown, key: PropertyKey): unknown {
  if (!isObjectLike(value)) return undefined;
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function recursivelyFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!isObjectLike(value) || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) recursivelyFreeze(Reflect.get(value, key), seen);
  return Object.freeze(value);
}

function recursivelyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!isObjectLike(value) || seen.has(value)) return true;
  seen.add(value);
  try {
    return Object.isFrozen(value)
      && Reflect.ownKeys(value).every((key) => recursivelyFrozen(Reflect.get(value, key), seen));
  } catch {
    return false;
  }
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalDecisionJson(value)).digest('hex');
}
