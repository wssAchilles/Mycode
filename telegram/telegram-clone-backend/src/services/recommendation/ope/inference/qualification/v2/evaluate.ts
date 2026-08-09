import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../../../decisionLog/contracts';
import { canonicalWireJsonV1 } from '../../../../offlinePrediction/artifacts/canonical';
import { diagnosticCiBootstrapTV1 } from '../../bootstrap';
import { summarizeClusterScoresV1 } from '../../clusterScores';
import { DIAGNOSTICS_ONLY_ABSTENTION_V1 } from '../../contracts';
import { thresholdBootstrapTV2 } from '../../directionalV2';
import {
  PHASE12_CRITICAL_SCENARIO_IDS_V1,
  PHASE12_QUALIFICATION_RESULT_V1,
  type FrozenSyntheticScenarioV1,
  type SyntheticInferenceQualificationResultV1,
} from './contracts';
import {
  generateSyntheticClusterScoreReplicationV1,
  isVerifiedSyntheticClusterScoreReplicationV1,
} from './dgp';
import {
  isVerifiedFrozenInferenceQualificationProtocolV1,
  verifyFrozenInferenceQualificationProtocolV1,
  type VerifiedFrozenInferenceQualificationProtocolV1,
} from './protocol';

const FINITE_SAMPLE_BLOCKER = 'finite_sample_inference_unavailable';
const MULTIPLICITY_BLOCKER = 'multiplicity_control_unavailable';
const verifiedResult = Symbol('verifiedSyntheticInferenceQualificationResultV1');
const verifiedResults = new WeakSet<object>();
const verifiedResultDigests = new WeakMap<object, string>();

type BrandedResult = SyntheticInferenceQualificationResultV1 & {
  readonly [verifiedResult]: true;
};

type QualificationRecordSinkV1 = (record: unknown) => Promise<void> | void;

type QualificationTestHooksV1 = {
  beforeGenerateReplication?: (
    scenario: FrozenSyntheticScenarioV1,
    replicationIndex: number,
  ) => void;
};

let testHooks: QualificationTestHooksV1 | undefined;

// Deliberately not exported by the bounded-context index.
export function setQualificationTestHooksV1(hooks?: QualificationTestHooksV1): void {
  testHooks = hooks;
}

export async function runSyntheticSequentialDrQualificationV1(
  protocol: unknown,
): Promise<BrandedResult> {
  return executeSyntheticSequentialDrQualificationV1(protocol);
}

// Artifact publishing imports this internal seam so generation/bootstrap run once.
export async function executeSyntheticSequentialDrQualificationV1(
  protocol: unknown,
  sink?: QualificationRecordSinkV1,
): Promise<BrandedResult> {
  if (!isVerifiedFrozenInferenceQualificationProtocolV1(protocol)) {
    const verified = verifyFrozenInferenceQualificationProtocolV1(protocol);
    return verified.status === 'verified'
      ? executeSyntheticSequentialDrQualificationV1(verified.protocol, sink)
      : makeResult(null, 'not_evaluable', [verified.blocker]);
  }
  const preflight = resourcePreflight(protocol);
  if (preflight !== null) return makeResult(protocol, 'not_evaluable', [preflight]);
  if (!protocol.reachability.reachable) {
    return makeResult(protocol, 'not_evaluable', ['qualification_gate_resolution_insufficient']);
  }

  const artifact = new ArtifactAccumulator(protocol, sink);
  await artifact.emit({
    record: 'artifact_start',
    version: 'synthetic_qualification_artifact_v1',
    protocolSha256: protocol.protocolSha256,
    actions: [0, 1, 2, 3],
    slotsPerCluster: 2,
    expectedRecordCount: protocol.resources.plannedRecordCount,
  });

  let coverageSuccesses = 0;
  let falsePromotions = 0;
  let invalidReplicates = 0;
  let actualClusterScoreCount = 0;
  let actualBootstrapWorkUnits = 0;
  let peakBufferedClusters = 0;
  const dynamicBlockers: string[] = [];

  for (const scenario of protocol.scenarios) {
    for (let replicationIndex = 0;
      replicationIndex < protocol.resources.criticalReplicationsPerScenario;
      replicationIndex += 1) {
      testHooks?.beforeGenerateReplication?.(scenario, replicationIndex);
      const generated = generateSyntheticClusterScoreReplicationV1(
        protocol, scenario, replicationIndex,
      );
      if (generated.status !== 'generated') {
        invalidReplicates += 1;
        addBlocker(dynamicBlockers, `critical_replication_not_evaluable:${scenario.scenarioId}`);
        await emitUnavailableReplication(artifact, scenario, replicationIndex, generated.blocker);
        continue;
      }
      if (!isVerifiedSyntheticClusterScoreReplicationV1(generated.replication)) {
        invalidReplicates += 1;
        addBlocker(dynamicBlockers, `critical_replication_not_evaluable:${scenario.scenarioId}`);
        await emitUnavailableReplication(
          artifact, scenario, replicationIndex, 'synthetic_dgp_contract_invalid',
        );
        continue;
      }
      const replication = generated.replication;
      peakBufferedClusters = Math.max(peakBufferedClusters, replication.clusterScores.length);
      actualClusterScoreCount += replication.clusterScores.length;
      await artifact.emit({
        record: 'replication_start',
        version: 'synthetic_qualification_replication_v1',
        scenarioKind: scenario.scenarioKind,
        scenarioId: scenario.scenarioId,
        replicationIndex,
        replicationSha256: replication.replicationSha256,
        expectedClusterCount: scenario.clusterCount,
      });
      for (const cluster of replication.clusterScores) {
        await artifact.emit({
          record: 'cluster_score',
          version: 'synthetic_qualification_cluster_score_v1',
          scenarioKind: scenario.scenarioKind,
          scenarioId: scenario.scenarioId,
          replicationIndex,
          clusterId: cluster.inferenceClusterId,
          y: cluster.y,
          a: cluster.a,
          importanceMass: cluster.importanceMass,
        });
      }

      const summary = summarizeClusterScoresV1('dr', replication.clusterScores);
      let threshold: ReturnType<typeof thresholdBootstrapTV2> | null = null;
      let interval: ReturnType<typeof diagnosticCiBootstrapTV1> | null = null;
      if (summary.status === 'evaluated') {
        actualBootstrapWorkUnits += scenario.clusterCount * protocol.bootstrapReplicates * 2;
        const inputSha256 = digest({
          protocolSha256: protocol.protocolSha256,
          replicationSha256: replication.replicationSha256,
          purpose: 'synthetic_qualification_replication_v1',
        });
        threshold = thresholdBootstrapTV2({
          summary: summary.summary,
          nullThreshold: scenario.threshold,
          direction: scenario.direction,
          bootstrapReplicates: protocol.bootstrapReplicates,
          seedMaterial: protocol.bootstrapSeedMaterial,
          inputSha256,
          segment: '__all__',
        });
        interval = diagnosticCiBootstrapTV1(
          summary.summary,
          protocol.confidenceLevel,
          protocol.bootstrapReplicates,
          protocol.bootstrapSeedMaterial,
          inputSha256,
          '__all__',
        );
      }
      const valid = summary.status === 'evaluated'
        && threshold?.status === 'evaluated'
        && interval?.status === 'evaluated';
      if (summary.status !== 'evaluated'
        || threshold?.status !== 'evaluated'
        || interval?.status !== 'evaluated') {
        invalidReplicates += 1;
        addBlocker(dynamicBlockers, `critical_replication_not_evaluable:${scenario.scenarioId}`);
      } else {
        if (interval.lower <= scenario.knownTruth && scenario.knownTruth <= interval.upper) {
          coverageSuccesses += 1;
        }
        if (scenario.truthClass !== 'beneficial'
          && threshold.pValue <= protocol.familyAlpha) falsePromotions += 1;
      }
      await artifact.emit({
        record: 'replication_end',
        version: 'synthetic_qualification_replication_end_v1',
        scenarioKind: scenario.scenarioKind,
        scenarioId: scenario.scenarioId,
        replicationIndex,
        status: valid ? 'evaluated' : 'not_evaluable',
        blocker: valid ? null : summary.status === 'evaluated'
          ? 'bootstrap_replicate_invalid'
          : summary.blocker,
        thresholdTestSha256: threshold?.status === 'evaluated'
          ? threshold.thresholdTestSha256
          : null,
        diagnosticCiSha256: interval?.status === 'evaluated'
          ? digest(interval)
          : null,
      });
    }
  }

  const invalidControl = summarizeClusterScoresV1('dr', [
    { inferenceClusterId: 'cluster-a', y: 0, a: 1, importanceMass: 2 },
    { inferenceClusterId: 'cluster-b', y: 2, a: 1, importanceMass: 1 },
  ]);
  await artifact.emit({
    record: 'replication_start',
    version: 'synthetic_qualification_replication_v1',
    scenarioKind: 'fail_closed_control',
    scenarioId: 'invalid_studentizer_control',
    replicationIndex: 0,
    replicationSha256: digest({ protocolSha256: protocol.protocolSha256, control: 'invalid_studentizer' }),
    expectedClusterCount: 2,
  });
  for (const cluster of [
    { inferenceClusterId: 'cluster-a', y: 0, a: 1, importanceMass: 2 },
    { inferenceClusterId: 'cluster-b', y: 2, a: 1, importanceMass: 1 },
  ]) {
    await artifact.emit({
      record: 'cluster_score',
      version: 'synthetic_qualification_cluster_score_v1',
      scenarioKind: 'fail_closed_control',
      scenarioId: 'invalid_studentizer_control',
      replicationIndex: 0,
      clusterId: cluster.inferenceClusterId,
      y: cluster.y,
      a: cluster.a,
      importanceMass: cluster.importanceMass,
    });
  }
  actualClusterScoreCount += 2;
  peakBufferedClusters = Math.max(peakBufferedClusters, 2);
  let invalidControlPassed = false;
  if (invalidControl.status === 'evaluated') {
    actualBootstrapWorkUnits += 2 * protocol.bootstrapReplicates * 2;
    const inputSha256 = digest({ protocolSha256: protocol.protocolSha256, control: 'invalid_studentizer' });
    const threshold = thresholdBootstrapTV2({
      summary: invalidControl.summary,
      nullThreshold: invalidControl.summary.thetaHat,
      direction: 'greater',
      bootstrapReplicates: protocol.bootstrapReplicates,
      seedMaterial: protocol.bootstrapSeedMaterial,
      inputSha256,
      segment: '__all__',
    });
    const interval = diagnosticCiBootstrapTV1(
      invalidControl.summary, 0.95, protocol.bootstrapReplicates,
      protocol.bootstrapSeedMaterial, inputSha256, '__all__',
    );
    invalidControlPassed = threshold.status === 'not_evaluable'
      && threshold.blocker === 'bootstrap_replicate_invalid'
      && interval.status === 'not_evaluable'
      && interval.blocker === 'bootstrap_replicate_invalid';
  }
  if (!invalidControlPassed) addBlocker(dynamicBlockers, 'invalid_studentizer_control_failed');
  await artifact.emit({
    record: 'replication_end',
    version: 'synthetic_qualification_replication_end_v1',
    scenarioKind: 'fail_closed_control',
    scenarioId: 'invalid_studentizer_control',
    replicationIndex: 0,
    status: invalidControlPassed ? 'expected_failure_observed' : 'control_failed',
    blocker: invalidControlPassed ? 'bootstrap_replicate_invalid' : 'invalid_studentizer_control_failed',
    thresholdTestSha256: null,
    diagnosticCiSha256: null,
  });

  const assumptionReasons = {
    viewer_dependence: ['viewer_or_session_clustering_present'],
    unhandled_time_shock: ['common_shock_dependence_present'],
    propensity_bound_unverified: ['positive_propensity_floor_unverified'],
    adaptive_selection_holdout_reuse: [
      'adaptive_policy_selection_present',
      'holdout_reuse_present',
    ],
  } as const;
  for (const control of protocol.assumptionControlKinds) {
    for (let replicationIndex = 0;
      replicationIndex < protocol.resources.assumptionReplicationsPerKind;
      replicationIndex += 1) {
      await artifact.emit({
        record: 'assumption_control',
        version: 'synthetic_qualification_assumption_control_v1',
        control,
        replicationIndex,
        status: 'not_applicable',
        reasons: assumptionReasons[control],
      });
    }
  }

  const reachability = protocol.reachability;
  const coverageLowerBound = coverageSuccesses / reachability.coverageDenominator
    - reachability.coverageMargin;
  const falsePromotionUpperBound = falsePromotions / reachability.falsePromotionDenominator
    + reachability.falsePromotionMargin;
  const invalidRateUpperBound = invalidReplicates / reachability.invalidRateDenominator
    + reachability.invalidRateMargin;
  if (coverageLowerBound < reachability.minimumCoverage) addBlocker(dynamicBlockers, 'coverage_gate_failed');
  if (falsePromotionUpperBound > reachability.maximumFalsePromotionRate) {
    addBlocker(dynamicBlockers, 'false_promotion_gate_failed');
  }
  if (invalidRateUpperBound > reachability.maximumInvalidReplicateRate) {
    addBlocker(dynamicBlockers, 'invalid_replicate_gate_failed');
  }
  if (actualClusterScoreCount !== protocol.resources.totalClusterScores
    || !Number.isSafeInteger(actualBootstrapWorkUnits)
    || actualBootstrapWorkUnits > protocol.resources.bootstrapWorkUnits) {
    addBlocker(dynamicBlockers, 'resource_accounting_mismatch');
  }
  if (artifact.recordCountSoFar() + 1 !== protocol.resources.plannedRecordCount) {
    addBlocker(dynamicBlockers, 'resource_accounting_mismatch');
  }
  const candidateStatus = dynamicBlockers.length === 0
    ? 'synthetic_mixture_gates_passed' as const
    : 'failed' as const;
  await artifact.emit({
    record: 'artifact_end',
    version: 'synthetic_qualification_artifact_end_v1',
    protocolSha256: protocol.protocolSha256,
    candidateStatus,
    expectedRecordCount: protocol.resources.plannedRecordCount,
    recordsBeforeEndSha256: artifact.digestSoFar(),
  });
  const artifactDiagnostics = artifact.finish();

  return makeResult(protocol, dynamicBlockers.length === 0
    ? 'synthetic_mixture_gates_passed'
    : 'failed', dynamicBlockers, {
    coverageSuccesses,
    falsePromotions,
    invalidReplicates,
    coverageLowerBound,
    falsePromotionUpperBound,
    invalidRateUpperBound,
    actualRecordCount: artifactDiagnostics.recordCount,
    actualClusterScoreCount,
    actualBootstrapWorkUnits,
    artifactSha256: artifactDiagnostics.sha256,
    peakBufferedClusters,
  });
}

export function isVerifiedSyntheticInferenceQualificationResultV1(
  value: unknown,
): value is BrandedResult {
  try {
    if (!value || typeof value !== 'object' || !verifiedResults.has(value)) return false;
    const candidate = value as BrandedResult;
    const { qualificationSha256, ...preimage } = candidate;
    return candidate[verifiedResult] === true
      && recursivelyFrozen(candidate)
      && qualificationSha256 === digest(preimage)
      && verifiedResultDigests.get(candidate) === qualificationSha256;
  } catch {
    return false;
  }
}

function resourcePreflight(protocol: VerifiedFrozenInferenceQualificationProtocolV1): string | null {
  const configuredCounts = PHASE12_CRITICAL_SCENARIO_IDS_V1.map((scenarioId) => (
    protocol.scenarios.find((scenario) => scenario.scenarioId === scenarioId)?.clusterCount
  ));
  if (configuredCounts.some((count) => count === undefined)) return 'resource_limit_exceeded';
  const replications = protocol.resources.criticalReplicationsPerScenario;
  const criticalClusterScores = configuredCounts.reduce((sum, count) => sum + count!, 0)
    * replications;
  const totalClusterScores = criticalClusterScores
    + protocol.resources.invalidControlClusters * protocol.resources.invalidControlReplications;
  const qHatEvaluations = criticalClusterScores * 2 * 4;
  const generatorPrimitiveWorkUnits = criticalClusterScores * (5 + 8 + 8 + 8 + 2)
    + protocol.resources.invalidControlClusters * protocol.resources.invalidControlReplications;
  const bootstrapWorkUnits = totalClusterScores * protocol.bootstrapReplicates * 2;
  const plannedRecordCount = 2
    + replications * configuredCounts.reduce((sum, count) => sum + 2 + count!, 0)
    + protocol.resources.invalidControlReplications
      * (2 + protocol.resources.invalidControlClusters)
    + protocol.resources.assumptionControlKinds
      * protocol.resources.assumptionReplicationsPerKind;
  const plannedBytesUpperBound = plannedRecordCount
    * (protocol.resources.maximumCanonicalRecordBytes + 1);
  const expected = {
    criticalClusterScores,
    totalClusterScores,
    qHatEvaluations,
    generatorPrimitiveWorkUnits,
    bootstrapWorkUnits,
    plannedRecordCount,
    plannedBytesUpperBound,
  };
  if (!Object.values(expected).every(Number.isSafeInteger)
    || configuredCounts.some((count, index) => count !== protocol.resources.criticalClusterCounts[index])
    || Object.entries(expected).some(([key, value]) => (
      protocol.resources[key as keyof typeof expected] !== value
    ))
    || generatorPrimitiveWorkUnits > protocol.resources.maximumGeneratorPrimitiveWorkUnits
    || bootstrapWorkUnits > protocol.resources.maximumBootstrapWorkUnits
    || plannedRecordCount > protocol.resources.maximumQualificationRecords
    || plannedBytesUpperBound > protocol.resources.maximumQualificationBytes) {
    return 'resource_limit_exceeded';
  }
  return null;
}

async function emitUnavailableReplication(
  artifact: ArtifactAccumulator,
  scenario: FrozenSyntheticScenarioV1,
  replicationIndex: number,
  blocker: string,
): Promise<void> {
  await artifact.emit({
    record: 'replication_start',
    version: 'synthetic_qualification_replication_v1',
    scenarioKind: scenario.scenarioKind,
    scenarioId: scenario.scenarioId,
    replicationIndex,
    replicationSha256: '0'.repeat(64),
    expectedClusterCount: scenario.clusterCount,
  });
  for (let clusterIndex = 0; clusterIndex < scenario.clusterCount; clusterIndex += 1) {
    await artifact.emit({
      record: 'cluster_score',
      version: 'synthetic_qualification_cluster_score_v1',
      scenarioKind: scenario.scenarioKind,
      scenarioId: scenario.scenarioId,
      replicationIndex,
      clusterId: `cluster-${String(clusterIndex).padStart(2, '0')}`,
      y: 0,
      a: 1,
      importanceMass: 0,
    });
  }
  await artifact.emit({
    record: 'replication_end',
    version: 'synthetic_qualification_replication_end_v1',
    scenarioKind: scenario.scenarioKind,
    scenarioId: scenario.scenarioId,
    replicationIndex,
    status: 'not_evaluable',
    blocker,
    thresholdTestSha256: null,
    diagnosticCiSha256: null,
  });
}

class ArtifactAccumulator {
  private readonly hash = createHash('sha256');
  private recordCount = 0;
  private byteCount = 0;

  constructor(
    private readonly protocol: VerifiedFrozenInferenceQualificationProtocolV1,
    private readonly sink?: QualificationRecordSinkV1,
  ) {}

  async emit(record: unknown): Promise<void> {
    const raw = `${canonicalWireJsonV1(record)}\n`;
    const lineBytes = Buffer.byteLength(raw) - 1;
    const bytes = Buffer.byteLength(raw);
    if (lineBytes > this.protocol.resources.maximumCanonicalRecordBytes
      || this.recordCount >= this.protocol.resources.maximumQualificationRecords
      || this.byteCount + bytes > this.protocol.resources.maximumQualificationBytes) {
      throw new Error('resource_limit_exceeded');
    }
    await this.sink?.(record);
    this.hash.update(raw);
    this.recordCount += 1;
    this.byteCount += bytes;
  }

  digestSoFar(): string {
    return this.hash.copy().digest('hex');
  }

  recordCountSoFar(): number {
    return this.recordCount;
  }

  finish(): { sha256: string; recordCount: number; byteCount: number } {
    return { sha256: this.hash.digest('hex'), recordCount: this.recordCount, byteCount: this.byteCount };
  }
}

function makeResult(
  protocol: VerifiedFrozenInferenceQualificationProtocolV1 | null,
  candidateStatus: SyntheticInferenceQualificationResultV1['candidateStatus'],
  dynamicBlockers: string[],
  actual?: {
    coverageSuccesses: number;
    falsePromotions: number;
    invalidReplicates: number;
    coverageLowerBound: number;
    falsePromotionUpperBound: number;
    invalidRateUpperBound: number;
    actualRecordCount: number;
    actualClusterScoreCount: number;
    actualBootstrapWorkUnits: number;
    artifactSha256: string;
    peakBufferedClusters: number;
  },
): BrandedResult {
  const resources = protocol?.resources ?? {
    criticalClusterCounts: [4, 4, 4, 4, 4, 2, 4, 4] as const,
    criticalReplicationsPerScenario: 117 as const,
    assumptionControlKinds: 4 as const,
    assumptionReplicationsPerKind: 8 as const,
    invalidControlReplications: 1 as const,
    invalidControlClusters: 2 as const,
    criticalClusterScores: 3_510 as const,
    totalClusterScores: 3_512 as const,
    qHatEvaluations: 28_080 as const,
    bootstrapWorkUnits: 892_048 as const,
    generatorPrimitiveWorkUnits: 108_812 as const,
    plannedRecordCount: 5_420 as const,
    plannedBytesUpperBound: 22_205_740 as const,
    maximumGeneratorPrimitiveWorkUnits: 131_072 as const,
    maximumBootstrapWorkUnits: 1_000_000 as const,
    maximumQualificationRecords: 8_192 as const,
    maximumQualificationBytes: 33_554_432 as const,
    maximumCanonicalRecordBytes: 4_096 as const,
  };
  const preimage = {
    contractVersion: PHASE12_QUALIFICATION_RESULT_V1,
    candidateStatus,
    selectedMethod: DIAGNOSTICS_ONLY_ABSTENTION_V1,
    realDatasetEligible: false as const,
    blockers: [FINITE_SAMPLE_BLOCKER, MULTIPLICITY_BLOCKER, ...dynamicBlockers],
    protocolSha256: protocol?.protocolSha256 ?? null,
    metrics: {
      coverageSuccesses: actual?.coverageSuccesses ?? 0,
      coverageDenominator: protocol?.reachability.coverageDenominator ?? 0,
      coverageLowerBound: actual?.coverageLowerBound ?? null,
      falsePromotions: actual?.falsePromotions ?? 0,
      falsePromotionDenominator: protocol?.reachability.falsePromotionDenominator ?? 0,
      falsePromotionUpperBound: actual?.falsePromotionUpperBound ?? null,
      invalidReplicates: actual?.invalidReplicates ?? 0,
      invalidRateDenominator: protocol?.reachability.invalidRateDenominator ?? 0,
      invalidRateUpperBound: actual?.invalidRateUpperBound ?? null,
    },
    diagnostics: {
      resources: {
        ...resources,
        actualRecordCount: actual?.actualRecordCount ?? 0,
        actualClusterScoreCount: actual?.actualClusterScoreCount ?? 0,
        actualBootstrapWorkUnits: actual?.actualBootstrapWorkUnits ?? 0,
      },
      artifactSha256: actual?.artifactSha256 ?? null,
      peakBufferedClusters: actual?.peakBufferedClusters ?? 0,
    },
  };
  const candidate = { ...preimage, qualificationSha256: digest(preimage) } as BrandedResult;
  Object.defineProperty(candidate, verifiedResult, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  verifiedResults.add(candidate);
  recursivelyFreeze(candidate);
  verifiedResultDigests.set(candidate, candidate.qualificationSha256);
  return candidate;
}

function addBlocker(blockers: string[], blocker: string): void {
  if (!blockers.includes(blocker)) blockers.push(blocker);
}

const digest = (value: unknown) => createHash('sha256')
  .update(canonicalDecisionJson(value)).digest('hex');

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
