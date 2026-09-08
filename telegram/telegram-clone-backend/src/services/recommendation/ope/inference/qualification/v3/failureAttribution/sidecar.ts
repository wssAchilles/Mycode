import { createHash } from 'crypto';

import { canonicalWireJsonV1 } from '../../../../../offlinePrediction/artifacts/canonical';
import type { VerifiedFrozenInferenceQualificationProtocolV1 } from '../../v2/protocol';
import {
  PHASE13_ATTRIBUTION_SIDECAR_V1,
  PHASE13_FAILURE_ATTRIBUTION_RESOURCES_V1,
  PHASE13_PURPOSE_ORDER_V1,
  PHASE13_REASON_ORDER_V1,
  type Phase13AssumptionAttributionRecordV1,
  type Phase13FailureAttributionRecordV1,
  type Phase13ReplicationAttributionRecordV1,
  type Phase13ScenarioSummaryIdV1,
  type Phase13ScenarioSummaryRecordV1,
} from './contracts';
import type { Phase12SemanticReplayStateV1 } from './replicationReplay';

export function buildPhase13SidecarRecordsV1(
  protocol: VerifiedFrozenInferenceQualificationProtocolV1,
  state: Phase12SemanticReplayStateV1,
  bindings: { sourceReceiptSha256: string; qualificationSha256: string },
): Phase13FailureAttributionRecordV1[] {
  const attributions = [...state.criticalAttributions, state.invalidAttribution!];
  const records: Phase13FailureAttributionRecordV1[] = [{
    record: 'attribution_start',
    version: PHASE13_ATTRIBUTION_SIDECAR_V1,
    protocolSha256: protocol.protocolSha256,
    qualificationSha256: bindings.qualificationSha256,
    sourceReceiptSha256: bindings.sourceReceiptSha256,
    purposeOrder: PHASE13_PURPOSE_ORDER_V1,
    reasonOrder: PHASE13_REASON_ORDER_V1,
    expectedRecordCount: 984,
  }, ...attributions, ...state.assumptions];
  const summaryOrder: Phase13ScenarioSummaryIdV1[] = [
    ...protocol.scenarios.map((scenario) => scenario.scenarioId),
    ...protocol.assumptionControlKinds,
    'invalid_studentizer_control',
  ];
  const all = [...attributions, ...state.assumptions];
  for (const scenarioId of summaryOrder) {
    records.push(summarizeAttributions(
      scenarioId, all.filter((record) => record.scenarioId === scenarioId),
    ));
  }
  return records;
}

export function validatePhase13SidecarV1(
  records: readonly Phase13FailureAttributionRecordV1[],
): void {
  if (records.length !== PHASE13_FAILURE_ATTRIBUTION_RESOURCES_V1.sidecarRecordCount
    || records.filter((record) => record.record === 'replication_attribution').length !== 937
    || records.filter((record) => record.record === 'assumption_attribution').length !== 32
    || records.filter((record) => record.record === 'scenario_summary').length !== 13
    || phase13AttributionWorstCaseCanonicalRecordBytesV1()
      > PHASE13_FAILURE_ATTRIBUTION_RESOURCES_V1.maximumCanonicalRecordBytes) {
    throw stableError('qualification_resource_attribution_unavailable');
  }
  let bytes = 0;
  for (const record of records) {
    const lineBytes = Buffer.byteLength(canonicalWireJsonV1(record));
    if (lineBytes > PHASE13_FAILURE_ATTRIBUTION_RESOURCES_V1.maximumCanonicalRecordBytes) {
      throw stableError('resource_limit_exceeded');
    }
    bytes += lineBytes + 1;
  }
  if (bytes > PHASE13_FAILURE_ATTRIBUTION_RESOURCES_V1.maximumSidecarBytes) {
    throw stableError('resource_limit_exceeded');
  }
}

export function phase13AttributionWorstCaseCanonicalRecordBytesV1(): number {
  const digestValue = 'f'.repeat(64);
  const counts = Array.from({ length: PHASE13_REASON_ORDER_V1.length }, () => (
    Number.MAX_SAFE_INTEGER
  ));
  const records: Phase13FailureAttributionRecordV1[] = [{
    record: 'scenario_summary',
    version: 'phase13_scenario_summary_v1',
    scenarioId: 'synthetic_dr_score_misspecification',
    replicationCount: Number.MAX_SAFE_INTEGER,
    invalidReplicationCount: Number.MAX_SAFE_INTEGER,
    purposeReasonCounts: PHASE13_PURPOSE_ORDER_V1.map((purpose) => ({ purpose, counts })),
  }, {
    record: 'attribution_start',
    version: PHASE13_ATTRIBUTION_SIDECAR_V1,
    protocolSha256: digestValue,
    qualificationSha256: digestValue,
    sourceReceiptSha256: digestValue,
    purposeOrder: PHASE13_PURPOSE_ORDER_V1,
    reasonOrder: PHASE13_REASON_ORDER_V1,
    expectedRecordCount: 984,
  }];
  return Math.max(...records.map((record) => Buffer.byteLength(canonicalWireJsonV1(record))));
}

export function ndjsonDigestV1(records: readonly Phase13FailureAttributionRecordV1[]): string {
  const hash = createHash('sha256');
  for (const record of records) hash.update(`${canonicalWireJsonV1(record)}\n`);
  return hash.digest('hex');
}

function summarizeAttributions(
  scenarioId: Phase13ScenarioSummaryIdV1,
  records: readonly (Phase13ReplicationAttributionRecordV1 | Phase13AssumptionAttributionRecordV1)[],
): Phase13ScenarioSummaryRecordV1 {
  const purposeReasonCounts = PHASE13_PURPOSE_ORDER_V1.map((purposeName) => ({
    purpose: purposeName,
    counts: PHASE13_REASON_ORDER_V1.map((reason) => records.reduce((total, record) => {
      const attribution = record.purposes.find((candidate) => candidate.purpose === purposeName)!;
      return total + (attribution.reasons.includes(reason) ? 1 : 0);
    }, 0)),
  }));
  return {
    record: 'scenario_summary',
    version: 'phase13_scenario_summary_v1',
    scenarioId,
    replicationCount: records.length,
    invalidReplicationCount: records.filter((record) => record.replicationInvalid).length,
    purposeReasonCounts,
  };
}

function stableError(blocker: string): Error {
  return Object.assign(new Error(blocker), { blocker });
}
