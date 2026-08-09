import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../../../../decisionLog/contracts';
import {
  evaluateSequentialDrSlotV1,
  type SequentialDrSlotResultV1,
  type SequentialDrTargetQValueV1,
} from '../../../../core/sequentialDr';
import type { ClusterScoreV1 } from '../../../contracts';
import {
  MULTIWAY_DGP_ACTIONS_V2,
  MULTIWAY_DGP_DRAW_DOMAINS_V2,
  MULTIWAY_DGP_REPLICATION_SEED_VERSION_V2,
  MULTIWAY_DGP_RESOURCE_LIMITS_V2,
  MULTIWAY_DGP_SUPPORT_ACTIONS_V2,
  SYNTHETIC_MULTIWAY_DR_DGP_V2,
  VERIFIED_MULTIWAY_DGP_REPLICATION_V2,
  type FrozenMultiwayDgpScenarioV2,
  type MultiwayDgpBoundaryRecordV2,
  type MultiwayDgpCellRecordV2,
  type MultiwayDgpDecisionRecordV2,
  type MultiwayDgpMembershipV2,
  type MultiwayDgpPreflightResultV2,
  type MultiwayDgpProbabilityVectorV2,
  type MultiwayDgpRecordV2,
  type MultiwayDgpReplicationCountsV2,
  type MultiwayDgpReplicationResultV2,
  type MultiwayDgpScoreV2,
  type MultiwayDgpShockProvenanceV2,
  type MultiwayDgpSlotRecordV2,
  type MultiwayDgpTestHooksV2,
  type MultiwayDgpTimeRecordV2,
  type MultiwayDgpViewerRecordV2,
  type VerifiedFrozenMultiwayDgpReplicationV2,
} from './contracts';
import {
  behaviorProbabilityV2,
  centeredShockV2,
  deriveKnownTruthFromDgpV2,
  deriveMultiwayDgpResourcePlanV2,
  meanRewardV2,
  qHatValuesV2,
  rotateProbabilityV2,
  selectActionV2,
  targetProbabilityV2,
  type MultiwayDgpShockVectorV2,
} from './math';
import {
  canonicalMultiwayDgpBytesV2,
  freezeMultiwayDgpV2,
  isMultiwayDgpFrozenV2,
  isVerifiedFrozenMultiwayDgpProtocolV2,
  multiwayDgpDigestV2,
  safeMultiwayDgpGet,
  type VerifiedFrozenMultiwayDgpProtocolV2,
} from './protocol';

const verifiedReplication = Symbol('verifiedFrozenMultiwayDgpReplicationV2');
const verifiedReplications = new WeakSet<object>();
const verifiedDigests = new WeakMap<object, string>();
const verifiedOwners = new WeakMap<object, VerifiedFrozenMultiwayDgpProtocolV2>();

let testHooks: MultiwayDgpTestHooksV2 | undefined;

export function setMultiwayDgpTestHooksV2(hooks?: MultiwayDgpTestHooksV2): void {
  testHooks = hooks;
}

export const setFrozenMultiwayDgpTestHooksV2 = setMultiwayDgpTestHooksV2;

export function preflightFrozenMultiwayDgpV2(
  protocol: unknown,
): MultiwayDgpPreflightResultV2 {
  try {
    if (!isVerifiedFrozenMultiwayDgpProtocolV2(protocol)) {
      return { status: 'not_evaluable', blocker: 'multiway_dgp_protocol_invalid' };
    }
    const expected = deriveMultiwayDgpResourcePlanV2(protocol.scenarios);
    if (canonicalDecisionJson(protocol.resources) !== canonicalDecisionJson(expected)) {
      return { status: 'not_evaluable', blocker: 'resource_limit_exceeded' };
    }
    if (!withinLimits(expected)
      || protocol.scenarios.some((scenario) => !validScenarioDimensions(scenario))) {
      return { status: 'not_evaluable', blocker: 'resource_limit_exceeded' };
    }
    return {
      status: 'ready',
      protocolSha256: protocol.protocolSha256,
      resources: expected,
    };
  } catch {
    return { status: 'not_evaluable', blocker: 'multiway_dgp_protocol_invalid' };
  }
}

export const preflightMultiwayDgpV2 = preflightFrozenMultiwayDgpV2;

export function generateFrozenMultiwayDgpReplicationV2(
  protocol: VerifiedFrozenMultiwayDgpProtocolV2,
  scenarioOrId: FrozenMultiwayDgpScenarioV2 | string,
  replicationIndex: number,
  hooks?: MultiwayDgpTestHooksV2,
): MultiwayDgpReplicationResultV2 {
  try {
    const preflight = preflightFrozenMultiwayDgpV2(protocol);
    if (preflight.status !== 'ready') return preflight;
    const scenario = resolveScenario(protocol, scenarioOrId);
    if (!scenario || !Number.isSafeInteger(replicationIndex)
      || replicationIndex < 0 || replicationIndex >= protocol.replicationsPerScenario
      || scenario.knownTruth !== deriveKnownTruthFromDgpV2(scenario)) {
      return { status: 'not_evaluable', blocker: 'multiway_dgp_protocol_invalid' };
    }
    const activeHooks = hooks ?? testHooks;
    activeHooks?.beforeGenerateReplication?.(scenario.scenarioId, replicationIndex);
    if (!activeHooks?.beforeGenerateReplication) {
      activeHooks?.beforeGenerate?.(scenario.scenarioId, replicationIndex);
    }
    const replicationSeedSha256 = replicationSeedV2(protocol, scenario, replicationIndex);
    const dimensions = dimensionsFor(scenario);
    const viewerShocks = dimensions.viewerIndices.map((viewerIndex) => centeredShockV2(draw53(
      MULTIWAY_DGP_DRAW_DOMAINS_V2.viewerShock,
      replicationSeedSha256,
      [scenario.scenarioId, replicationIndex, viewerIndex],
      activeHooks,
    )));
    const timeShocks = dimensions.timeIndices.map((timeIndex) => centeredShockV2(draw53(
      MULTIWAY_DGP_DRAW_DOMAINS_V2.timeShock,
      replicationSeedSha256,
      [scenario.scenarioId, replicationIndex, timeIndex],
      activeHooks,
    )));
    const cellShocks = dimensions.cellIndices.map((cellIndex) => centeredShockV2(draw53(
      MULTIWAY_DGP_DRAW_DOMAINS_V2.cellShock,
      replicationSeedSha256,
      [scenario.scenarioId, replicationIndex, cellIndex],
      activeHooks,
    )));

    const slotRecords: MultiwayDgpSlotRecordV2[] = [];
    const decisionRecords: MultiwayDgpDecisionRecordV2[] = [];
    const decisionScores: MultiwayDgpScoreV2[] = [];
    const decisionShocks: number[] = [];
    const cellTotals = new Map<number, Aggregate>();
    const viewerTotals = new Map<number, Aggregate>();
    const timeTotals = new Map<number, Aggregate>();
    const decisionMembership: MultiwayDgpMembershipV2[] = [];
    const slotMembership: MultiwayDgpMembershipV2[] = [];
    const cellMembership = dimensions.cellIndices.map((cellIndex) => {
      const viewerIndex = Math.floor(cellIndex / scenario.h);
      const timeIndex = cellIndex % scenario.h;
      return membership(replicationSeedSha256, viewerIndex, timeIndex, cellIndex);
    });
    const viewerMembership = dimensions.viewerIndices.map((viewerIndex) => ({
      viewerClusterId: viewerId(replicationSeedSha256, viewerIndex),
      viewerIndex,
    }));
    const timeMembership = dimensions.timeIndices.map((timeIndex) => ({
      timeClusterId: timeId(replicationSeedSha256, timeIndex),
      timeIndex,
    }));
    let decisionIndex = 0;
    for (const viewerIndex of dimensions.viewerIndices) {
      const recordsForViewer = scenario.baseR * scenario.viewerRecordMultipliers[viewerIndex]!;
      for (const timeIndex of dimensions.timeIndices) {
        const cellIndex = viewerIndex * scenario.h + timeIndex;
        const cellShock = cellShocks[cellIndex]!;
        for (let localRecord = 0; localRecord < recordsForViewer; localRecord += 1) {
          const decisionId = decisionIdFor(
            replicationSeedSha256,
            viewerIndex,
            timeIndex,
            localRecord,
          );
          const decisionShock = centeredShockV2(draw53(
            MULTIWAY_DGP_DRAW_DOMAINS_V2.decisionShock,
            replicationSeedSha256,
            [scenario.scenarioId, replicationIndex, viewerIndex, timeIndex, localRecord],
            activeHooks,
          ));
          decisionShocks.push(decisionShock);
          const shocks: MultiwayDgpShockVectorV2 = {
            viewer: viewerShocks[viewerIndex]!,
            time: timeShocks[timeIndex]!,
            cell: cellShock,
            decision: decisionShock,
          };
          const decisionMembershipEntry = membership(
            replicationSeedSha256,
            viewerIndex,
            timeIndex,
            cellIndex,
            decisionIndex,
            undefined,
            decisionId,
          );
          decisionMembership.push(decisionMembershipEntry);
          const behaviorBase = behaviorProbabilityV2(scenario, viewerIndex);
          const targetBase = targetProbabilityV2(scenario);
          const firstAction = selectActionV2(behaviorBase, draw53(
            MULTIWAY_DGP_DRAW_DOMAINS_V2.behaviorAction,
            replicationSeedSha256,
            [scenario.scenarioId, replicationIndex, viewerIndex, timeIndex, localRecord, 1],
            activeHooks,
          ));
          const first = buildSlot(
            scenario,
            replicationIndex,
            replicationSeedSha256,
            viewerIndex,
            timeIndex,
            cellIndex,
            decisionIndex,
            0,
            decisionId,
            firstAction,
            firstAction,
            targetBase[firstAction]!,
            behaviorBase[firstAction]!,
            1,
            0,
            shocks,
            activeHooks,
          );
          if (!first) return nonFinite();
          const secondBehavior = rotateProbabilityV2(behaviorBase, firstAction);
          const secondTarget = rotateProbabilityV2(targetBase, firstAction);
          const secondAction = selectActionV2(secondBehavior, draw53(
            MULTIWAY_DGP_DRAW_DOMAINS_V2.behaviorAction,
            replicationSeedSha256,
            [scenario.scenarioId, replicationIndex, viewerIndex, timeIndex, localRecord, 2, firstAction],
            activeHooks,
          ));
          const second = buildSlot(
            scenario,
            replicationIndex,
            replicationSeedSha256,
            viewerIndex,
            timeIndex,
            cellIndex,
            decisionIndex,
            1,
            decisionId,
            firstAction,
            secondAction,
            secondTarget[secondAction]!,
            secondBehavior[secondAction]!,
            first.result.status === 'evaluated' ? first.result.weight : Number.NaN,
            first.result.status === 'evaluated' ? first.result.logWeight : Number.NaN,
            shocks,
            activeHooks,
          );
          if (!second) return nonFinite();
          const slots = [first, second] as const;
          for (const built of slots) {
            slotRecords.push(built.record);
            slotMembership.push(built.record.membership);
          }
          const firstResult = first.result;
          const secondResult = second.result;
          if (firstResult.status !== 'evaluated' || secondResult.status !== 'evaluated') {
            return nonFinite();
          }
          const drContribution = (firstResult.drContribution ?? Number.NaN)
            + (secondResult.drContribution ?? Number.NaN);
          const ipsContribution = firstResult.ipsContribution + secondResult.ipsContribution;
          const importanceMass = firstResult.weight + secondResult.weight;
          if (![drContribution, ipsContribution, importanceMass].every(Number.isFinite)) return nonFinite();
          const decisionRecord = freezeMultiwayDgpV2({
            recordKind: 'decision' as const,
            membership: decisionMembershipEntry as MultiwayDgpDecisionRecordV2['membership'],
            firstAction,
            actions: [firstAction, secondAction] as [number, number],
            reward: [first.record.reward, second.record.reward] as [0 | 1, 0 | 1],
            mu: [first.record.mu, second.record.mu] as [number, number],
            drContribution,
            ipsContribution,
            importanceMass,
          });
          decisionRecords.push(decisionRecord);
          const score = scoreFor('decision', `decision-${decisionId}`, drContribution, ipsContribution, 2, importanceMass, {
            viewerClusterId: viewerId(replicationSeedSha256, viewerIndex),
            timeClusterId: timeId(replicationSeedSha256, timeIndex),
            cellId: cellIdFor(replicationSeedSha256, viewerIndex, timeIndex),
            decisionId,
          });
          decisionScores.push(score);
          addAggregate(cellTotals, cellIndex, drContribution, ipsContribution, 2, importanceMass);
          addAggregate(viewerTotals, viewerIndex, drContribution, ipsContribution, 2, importanceMass);
          addAggregate(timeTotals, timeIndex, drContribution, ipsContribution, 2, importanceMass);
          decisionIndex += 1;
        }
      }
    }

    activeHooks?.beforeAggregation?.();
    const cellScores = buildGroupedScores('cell', cellTotals, (index) => {
      const viewerIndex = Math.floor(index / scenario.h);
      const timeIndex = index % scenario.h;
      return {
        viewerClusterId: viewerId(replicationSeedSha256, viewerIndex),
        timeClusterId: timeId(replicationSeedSha256, timeIndex),
        cellId: cellIdFor(replicationSeedSha256, viewerIndex, timeIndex),
      };
    });
    const viewerScores = buildGroupedScores('viewer', viewerTotals, (index) => ({
      viewerClusterId: viewerId(replicationSeedSha256, index),
    }));
    const timeScores = buildGroupedScores('time', timeTotals, (index) => ({
      timeClusterId: timeId(replicationSeedSha256, index),
    }));
    const cellRecords = cellScores.map((score) => freezeMultiwayDgpV2({
      recordKind: 'cell' as const,
      membership: cellMembership.find((item) => item.cellId === score.cellId)!,
      decisionCount: cellTotals.get(cellIndexFromScore(score, scenario))!.a / 2,
      slotCount: cellTotals.get(cellIndexFromScore(score, scenario))!.a,
      drContribution: score.y,
      ipsContribution: score.ipsContribution,
      importanceMass: score.importanceMass,
    }));
    const viewerRecords = viewerScores.map((score) => freezeMultiwayDgpV2({
      recordKind: 'viewer' as const,
      membership: { viewerClusterId: score.viewerClusterId!, viewerIndex: indexFromId(score.viewerClusterId!) },
      decisionCount: viewerTotals.get(indexFromId(score.viewerClusterId!))!.a / 2,
      drContribution: score.y,
      ipsContribution: score.ipsContribution,
      importanceMass: score.importanceMass,
    }));
    const timeRecords = timeScores.map((score) => freezeMultiwayDgpV2({
      recordKind: 'time' as const,
      membership: { timeClusterId: score.timeClusterId!, timeIndex: indexFromId(score.timeClusterId!) },
      decisionCount: timeTotals.get(indexFromId(score.timeClusterId!))!.a / 2,
      drContribution: score.y,
      ipsContribution: score.ipsContribution,
      importanceMass: score.importanceMass,
    }));
    const qHatSnapshots = slotRecords.map((record) => ({
      slotId: record.membership.slotId,
      qHat: record.qHat,
      mode: scenario.qHatMode,
    }));
    const qHatProvenance = freezeMultiwayDgpV2({
      contractVersion: 'frozen_multiway_dgp_qhat_provenance_v2' as const,
      mode: scenario.qHatMode,
      source: 'frozen_multiway_dgp_v2' as const,
      dgpVersion: SYNTHETIC_MULTIWAY_DR_DGP_V2,
      muDefinition: 'base_plus_centered_viewer_time_cell_decision_shocks_v2' as const,
      qHatSha256: multiwayDgpDigestV2(qHatSnapshots),
    });
    const shockProvenance: MultiwayDgpShockProvenanceV2 = freezeMultiwayDgpV2({
      viewer: viewerShocks,
      time: timeShocks,
      cell: cellShocks,
      decision: decisionShocks,
      shockSha256: multiwayDgpDigestV2({
        viewer: viewerShocks,
        time: timeShocks,
        cell: cellShocks,
        decision: decisionShocks,
      }),
    });
    const reboundSlots = slotRecords.map((record) => freezeMultiwayDgpV2({
      ...record,
      qHatProvenance,
    }));
    const reboundDecisions = decisionRecords.map((record) => freezeMultiwayDgpV2(record));
    const memberships = {
      viewer: viewerMembership,
      time: timeMembership,
      cell: cellMembership,
      decision: decisionMembership,
      slot: slotMembership,
    };
    const countsBase = replicationCounts(scenario, dimensions, reboundSlots.length);
    const aggregation = freezeMultiwayDgpV2({
      decisionScores: decisionScores.sort(compareScore),
      cellScores: cellScores.sort(compareScore),
      viewerScores: viewerScores.sort(compareScore),
      timeScores: timeScores.sort(compareScore),
      aggregationWorkUnits: countsBase.aggregationWorkUnits,
    });
    const dgpRootSha256 = multiwayDgpDigestV2({
      dgpVersion: SYNTHETIC_MULTIWAY_DR_DGP_V2,
      scenarioId: scenario.scenarioId,
      replicationSeedSha256,
      memberships,
      shockProvenance,
      qHatProvenance,
    });
    const contentRecords: MultiwayDgpRecordV2[] = [
      ...reboundSlots,
      ...reboundDecisions,
      ...cellRecords,
      ...viewerRecords,
      ...timeRecords,
    ];
    const records = withBoundaries(scenario, replicationIndex, replicationSeedSha256, contentRecords);
    const byteCount = records.reduce((sum, record) => sum + canonicalMultiwayDgpBytesV2(record), 0);
    if (records.length !== countsBase.recordsPerReplication || byteCount > MULTIWAY_DGP_RESOURCE_LIMITS_V2.maximumQualificationBytes
      || records.some((record) => canonicalMultiwayDgpBytesV2(record) > MULTIWAY_DGP_RESOURCE_LIMITS_V2.maximumCanonicalRecordBytes)) {
      return { status: 'not_evaluable', blocker: 'resource_limit_exceeded' };
    }
    const counts: MultiwayDgpReplicationCountsV2 = freezeMultiwayDgpV2({
      ...countsBase,
      recordCount: records.length,
      byteCount,
    });
    const preimage = {
      contractVersion: VERIFIED_MULTIWAY_DGP_REPLICATION_V2,
      dgpVersion: SYNTHETIC_MULTIWAY_DR_DGP_V2,
      protocolSha256: protocol.protocolSha256,
      scenarioId: scenario.scenarioId,
      replicationIndex,
      replicationSeedSha256,
      knownTruth: scenario.knownTruth,
      scenario,
      counts,
      records,
      slotRecords: reboundSlots,
      decisionRecords: reboundDecisions,
      cellRecords,
      viewerRecords,
      timeRecords,
      viewerMembership: memberships.viewer,
      timeMembership: memberships.time,
      cellMembership: memberships.cell,
      decisionMembership: memberships.decision,
      slotMembership: memberships.slot,
      shockProvenance,
      qHatProvenance,
      aggregation,
      clusterScores: aggregation.viewerScores,
      viewerMembershipSha256: multiwayDgpDigestV2(memberships.viewer),
      timeMembershipSha256: multiwayDgpDigestV2(memberships.time),
      cellMembershipSha256: multiwayDgpDigestV2(memberships.cell),
      decisionMembershipSha256: multiwayDgpDigestV2(memberships.decision),
      slotMembershipSha256: multiwayDgpDigestV2(memberships.slot),
      dgpRootSha256,
      syntheticOnly: true as const,
      realDatasetEligible: false as const,
      candidateEvidenceEligible: false as const,
      qualificationEvidenceEligible: false as const,
      ciGenerated: false as const,
      inferenceGenerated: false as const,
      candidateGenerated: false as const,
      servable: false as const,
    };
    const candidate = {
      ...preimage,
      replicationSha256: multiwayDgpDigestV2(preimage),
    } as unknown as VerifiedFrozenMultiwayDgpReplicationV2 & { readonly [verifiedReplication]: true };
    Object.defineProperty(candidate, verifiedReplication, {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });
    freezeMultiwayDgpV2(candidate);
    verifiedDigests.set(candidate, candidate.replicationSha256);
    verifiedOwners.set(candidate, protocol);
    verifiedReplications.add(candidate);
    activeHooks?.afterGenerateReplication?.(scenario.scenarioId, replicationIndex);
    if (!activeHooks?.afterGenerateReplication) {
      activeHooks?.afterGenerate?.(scenario.scenarioId, replicationIndex);
    }
    return { status: 'generated', replication: candidate };
  } catch {
    return { status: 'not_evaluable', blocker: 'multiway_dgp_non_finite' };
  }
}

export const generateMultiwayDgpReplicationV2 = generateFrozenMultiwayDgpReplicationV2;

export function isVerifiedFrozenMultiwayDgpReplicationV2(
  value: unknown,
): value is VerifiedFrozenMultiwayDgpReplicationV2 {
  try {
    if (!value || typeof value !== 'object' || !verifiedReplications.has(value)) return false;
    const candidate = value as VerifiedFrozenMultiwayDgpReplicationV2 & { readonly [verifiedReplication]: true };
    const owner = verifiedOwners.get(candidate);
    if (!owner || !isVerifiedFrozenMultiwayDgpProtocolV2(owner)) return false;
    const replicationSha256 = safeMultiwayDgpGet(candidate, 'replicationSha256');
    const preimage = { ...candidate } as Record<string, unknown>;
    delete preimage.replicationSha256;
    return safeMultiwayDgpGet(candidate, verifiedReplication) === true
      && isMultiwayDgpFrozenV2(candidate)
      && candidate.protocolSha256 === owner.protocolSha256
      && typeof replicationSha256 === 'string'
      && replicationSha256 === multiwayDgpDigestV2(preimage)
      && verifiedDigests.get(candidate) === replicationSha256;
  } catch {
    return false;
  }
}

export const isVerifiedMultiwayDgpReplicationV2 = isVerifiedFrozenMultiwayDgpReplicationV2;

export function uniform53V2(
  domain: string,
  replicationSeed: string,
  indices: unknown,
): number {
  const bytes = createHash('sha256')
    .update(domain)
    .update('\0')
    .update(replicationSeed)
    .update('\0')
    .update(canonicalDecisionJson(indices))
    .digest();
  let value = 0n;
  for (const byte of bytes.subarray(0, 7)) value = (value << 8n) | BigInt(byte);
  return Number(value >> 3n) / 2 ** 53;
}

export const syntheticUniform53V2 = uniform53V2;

function buildSlot(
  scenario: FrozenMultiwayDgpScenarioV2,
  replicationIndex: number,
  replicationSeedSha256: string,
  viewerIndex: number,
  timeIndex: number,
  cellIndex: number,
  decisionIndex: number,
  slotIndex: number,
  decisionId: string,
  firstAction: number,
  loggedAction: number,
  targetProbability: number,
  behaviorProbability: number,
  prefixWeight: number,
  prefixLogWeight: number,
  shocks: MultiwayDgpShockVectorV2,
  hooks?: MultiwayDgpTestHooksV2,
): { record: MultiwayDgpSlotRecordV2; result: SequentialDrSlotResultV1 } | null {
  if (!Number.isFinite(prefixWeight) || prefixWeight <= 0 || !Number.isFinite(prefixLogWeight)) return null;
  const slot = (slotIndex + 1) as 1 | 2;
  const qHat = qHatValuesV2(scenario, slot, firstAction, shocks);
  for (let action = 0; action < MULTIWAY_DGP_SUPPORT_ACTIONS_V2; action += 1) {
    hooks?.beforeQHatEvaluation?.();
    if (!hooks?.beforeQHatEvaluation) hooks?.beforeQHat?.();
  }
  const mu = meanRewardV2(scenario, slot, firstAction, loggedAction, shocks);
  const reward = draw53(
    MULTIWAY_DGP_DRAW_DOMAINS_V2.rewardDraw,
    replicationSeedSha256,
    [scenario.scenarioId, replicationIndex, viewerIndex, timeIndex, decisionIndex, slotIndex, loggedAction],
    hooks,
  ) < mu ? 1 : 0;
  const targetQValues: SequentialDrTargetQValueV1[] = qHat.map((qValue, action) => ({
    probability: slot === 1
      ? targetProbabilityV2(scenario)[action]!
      : rotateProbabilityV2(targetProbabilityV2(scenario), firstAction)[action]!,
    qValue,
  }));
  const result = evaluateSequentialDrSlotV1({
    prefixLogWeight: prefixLogWeight,
    behaviorProbability,
    targetProbability,
    reward,
    targetQValues,
    loggedQ: qHat[loggedAction],
  });
  if (result.status !== 'evaluated') return null;
  hooks?.beforeScoreEvaluation?.();
  if (!hooks?.beforeScoreEvaluation) hooks?.beforeScore?.();
  const slotId = `${decisionId}-s${slotIndex + 1}`;
  const record = freezeMultiwayDgpV2({
    recordKind: 'slot' as const,
    membership: {
      ...membership(
        replicationSeedSha256,
        viewerIndex,
        timeIndex,
        cellIndex,
        decisionIndex,
        slotIndex,
        decisionId,
      ),
      decisionId,
      slotId,
      decisionIndex,
      slotIndex,
    },
    firstAction,
    loggedAction,
    behaviorProbability,
    targetProbability,
    reward: reward as 0 | 1,
    mu,
    qHat,
    loggedQHat: qHat[loggedAction]!,
    qHatProvenance: undefined as never,
    prefixWeight: result.prefixWeight,
    prefixLogWeight: result.prefixLogWeight,
    atom: {
      targetTerm: result.drContribution! - result.weight * (reward - qHat[loggedAction]!),
      residualTerm: result.weight * (reward - qHat[loggedAction]!),
      drContribution: result.drContribution!,
      ipsContribution: result.ipsContribution,
      prefixWeight: result.prefixWeight,
      weight: result.weight,
      prefixLogWeight: result.prefixLogWeight,
      logWeight: result.logWeight,
    },
  });
  return { record, result };
}

function replicationSeedV2(
  protocol: VerifiedFrozenMultiwayDgpProtocolV2,
  scenario: FrozenMultiwayDgpScenarioV2,
  replicationIndex: number,
): string {
  return createHash('sha256')
    .update(MULTIWAY_DGP_REPLICATION_SEED_VERSION_V2)
    .update('\0')
    .update(protocol.protocolSha256)
    .update('\0')
    .update(protocol.generatorSeedMaterial)
    .update('\0')
    .update(canonicalDecisionJson([scenario.scenarioId, replicationIndex]))
    .digest('hex');
}

function draw53(
  domain: string,
  seed: string,
  indices: unknown,
  hooks?: MultiwayDgpTestHooksV2,
): number {
  hooks?.beforeRandomDraw?.(domain);
  if (!hooks?.beforeRandomDraw) hooks?.beforeRandom?.(domain);
  return uniform53V2(domain, seed, indices);
}

function dimensionsFor(scenario: FrozenMultiwayDgpScenarioV2) {
  return {
    viewerIndices: Array.from({ length: scenario.g }, (_, index) => index),
    timeIndices: Array.from({ length: scenario.h }, (_, index) => index),
    cellIndices: Array.from({ length: scenario.g * scenario.h }, (_, index) => index),
  };
}

function replicationCounts(
  scenario: FrozenMultiwayDgpScenarioV2,
  dimensions: ReturnType<typeof dimensionsFor>,
  slotCount: number,
): MultiwayDgpReplicationCountsV2 {
  const decisionCount = scenario.h * scenario.viewerRecordMultipliers
    .reduce((sum, multiplier) => sum + scenario.baseR * multiplier, 0);
  const cellCount = dimensions.cellIndices.length;
  const recordsPerReplication = 2 + slotCount + decisionCount + cellCount
    + dimensions.viewerIndices.length + dimensions.timeIndices.length;
  return {
    viewerCount: dimensions.viewerIndices.length,
    timeCount: dimensions.timeIndices.length,
    cellCount,
    decisionCount,
    slotCount,
    recordsPerReplication,
    recordCount: recordsPerReplication,
    byteCount: 0,
    hashWorkUnits: 10 + dimensions.viewerIndices.length + dimensions.timeIndices.length
      + cellCount + 5 * decisionCount,
    actionDrawWorkUnits: slotCount,
    actionSelectionComparisonWorkUnits: slotCount * MULTIWAY_DGP_SUPPORT_ACTIONS_V2,
    rewardDrawWorkUnits: slotCount,
    qHatEvaluationWorkUnits: slotCount * MULTIWAY_DGP_SUPPORT_ACTIONS_V2,
    scoreWorkUnits: slotCount,
    aggregationWorkUnits: 5 * slotCount + decisionCount + cellCount
      + dimensions.viewerIndices.length + dimensions.timeIndices.length + 1,
  };
}

type Aggregate = { y: number; ips: number; a: number; importanceMass: number };

function addAggregate(
  map: Map<number, Aggregate>,
  key: number,
  y: number,
  ips: number,
  a: number,
  mass: number,
): void {
  const current = map.get(key) ?? { y: 0, ips: 0, a: 0, importanceMass: 0 };
  current.y += y;
  current.ips += ips;
  current.a += a;
  current.importanceMass += mass;
  map.set(key, current);
}

function scoreFor(
  scoreLevel: MultiwayDgpScoreV2['scoreLevel'],
  id: string,
  y: number,
  ipsContribution: number,
  a: number,
  importanceMass: number,
  bindings: Partial<Pick<MultiwayDgpScoreV2, 'viewerClusterId' | 'timeClusterId' | 'cellId' | 'decisionId'>>,
): MultiwayDgpScoreV2 {
  return freezeMultiwayDgpV2({
    inferenceClusterId: id,
    y,
    ipsContribution,
    a,
    importanceMass,
    scoreLevel,
    ...bindings,
  });
}

function buildGroupedScores(
  scoreLevel: MultiwayDgpScoreV2['scoreLevel'],
  totals: Map<number, Aggregate>,
  bindings: (index: number) => Partial<Pick<MultiwayDgpScoreV2, 'viewerClusterId' | 'timeClusterId' | 'cellId' | 'decisionId'>>,
): MultiwayDgpScoreV2[] {
  return [...totals.entries()].map(([index, aggregate]) => scoreFor(
    scoreLevel,
    `${scoreLevel}-${String(index).padStart(2, '0')}`,
    aggregate.y,
    aggregate.ips,
    aggregate.a,
    aggregate.importanceMass,
    bindings(index),
  ));
}

function withBoundaries(
  scenario: FrozenMultiwayDgpScenarioV2,
  replicationIndex: number,
  seed: string,
  content: readonly MultiwayDgpRecordV2[],
): readonly MultiwayDgpRecordV2[] {
  let byteCount = 0;
  let records: readonly MultiwayDgpRecordV2[] = [];
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const start: MultiwayDgpBoundaryRecordV2 = {
      recordKind: 'replication_start',
      scenarioId: scenario.scenarioId,
      replicationIndex,
      replicationSeedSha256: seed,
      recordCount: content.length + 2,
      byteCount,
    };
    const end: MultiwayDgpBoundaryRecordV2 = {
      recordKind: 'replication_end',
      scenarioId: scenario.scenarioId,
      replicationIndex,
      replicationSeedSha256: seed,
      recordCount: content.length + 2,
      byteCount,
    };
    records = [start, ...content, end];
    const next = records.reduce((sum, record) => sum + canonicalMultiwayDgpBytesV2(record), 0);
    if (next === byteCount) break;
    byteCount = next;
  }
  return freezeMultiwayDgpV2(records);
}

function membership(
  replicationIdentitySha256: string,
  viewerIndex: number,
  timeIndex: number,
  cellIndex: number,
  decisionIndex?: number,
  slotIndex?: number,
  decisionId?: string,
): MultiwayDgpMembershipV2 {
  return {
    viewerClusterId: viewerId(replicationIdentitySha256, viewerIndex),
    timeClusterId: timeId(replicationIdentitySha256, timeIndex),
    cellId: cellIdFor(replicationIdentitySha256, viewerIndex, timeIndex),
    viewerIndex,
    timeIndex,
    cellIndex,
    ...(decisionIndex === undefined ? {} : { decisionIndex }),
    ...(slotIndex === undefined ? {} : { slotIndex }),
    ...(decisionId === undefined ? {} : { decisionId }),
    ...(slotIndex === undefined || decisionId === undefined ? {} : {
      slotId: `${decisionId}-s${slotIndex + 1}`,
    }),
  };
}

function viewerId(replicationIdentitySha256: string, index: number): string {
  return `viewer-${replicationIdentitySha256}-${String(index).padStart(2, '0')}`;
}
function timeId(replicationIdentitySha256: string, index: number): string {
  return `time-${replicationIdentitySha256}-${String(index).padStart(2, '0')}`;
}
function cellIdFor(
  replicationIdentitySha256: string,
  viewerIndex: number,
  timeIndex: number,
): string {
  return `cell-${replicationIdentitySha256}-${String(viewerIndex).padStart(2, '0')}-${String(timeIndex).padStart(2, '0')}`;
}
function decisionIdFor(
  replicationIdentitySha256: string,
  viewerIndex: number,
  timeIndex: number,
  localRecord: number,
): string {
  return `${cellIdFor(replicationIdentitySha256, viewerIndex, timeIndex)}-decision-${String(localRecord).padStart(2, '0')}`;
}
function indexFromId(value: string): number {
  const match = value.match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}
function cellIndexFromScore(score: MultiwayDgpScoreV2, scenario: FrozenMultiwayDgpScenarioV2): number {
  const viewerIndex = indexFromId(score.viewerClusterId ?? 'viewer-00');
  const timeIndex = indexFromId(score.timeClusterId ?? 'time-00');
  return viewerIndex * scenario.h + timeIndex;
}
function compareScore(left: MultiwayDgpScoreV2, right: MultiwayDgpScoreV2): number {
  return Buffer.compare(Buffer.from(left.inferenceClusterId), Buffer.from(right.inferenceClusterId));
}
function resolveScenario(
  protocol: VerifiedFrozenMultiwayDgpProtocolV2,
  value: FrozenMultiwayDgpScenarioV2 | string,
): FrozenMultiwayDgpScenarioV2 | undefined {
  const id = typeof value === 'string' ? value : value.scenarioId;
  return protocol.scenarios.find((scenario) => scenario.scenarioId === id);
}
function nonFinite(): MultiwayDgpReplicationResultV2 {
  return { status: 'not_evaluable', blocker: 'multiway_dgp_non_finite' };
}
function withinLimits(resources: VerifiedFrozenMultiwayDgpProtocolV2['resources']): boolean {
  const limits = MULTIWAY_DGP_RESOURCE_LIMITS_V2;
  return resources.plannedRecordCount <= limits.maximumQualificationRecords
    && resources.plannedBytesUpperBound <= limits.maximumQualificationBytes
    && resources.generatorPrimitiveWorkUnits <= limits.maximumGeneratorPrimitiveWorkUnits
    && resources.hashWorkUnits <= limits.maximumHashWorkUnits
    && resources.actionDrawWorkUnits <= limits.maximumActionDrawWorkUnits
    && resources.actionSelectionComparisonWorkUnits
      <= limits.maximumActionSelectionComparisonWorkUnits
    && resources.rewardDrawWorkUnits <= limits.maximumRewardDrawWorkUnits
    && resources.qHatEvaluationWorkUnits <= limits.maximumQHatEvaluationWorkUnits
    && resources.scoreWorkUnits <= limits.maximumScoreWorkUnits
    && resources.aggregationWorkUnits <= limits.maximumAggregationWorkUnits;
}

function validScenarioDimensions(scenario: FrozenMultiwayDgpScenarioV2): boolean {
  return Number.isSafeInteger(scenario.g) && scenario.g > 0
    && scenario.g <= MULTIWAY_DGP_RESOURCE_LIMITS_V2.maximumG
    && Number.isSafeInteger(scenario.h) && scenario.h > 0
    && scenario.h <= MULTIWAY_DGP_RESOURCE_LIMITS_V2.maximumH
    && Number.isSafeInteger(scenario.r) && scenario.r > 0
    && scenario.r <= MULTIWAY_DGP_RESOURCE_LIMITS_V2.maximumR
    && scenario.slots === MULTIWAY_DGP_RESOURCE_LIMITS_V2.maximumSlots
    && scenario.viewerRecordMultipliers.length === scenario.g
    && scenario.viewerRecordMultipliers.every((multiplier) => multiplier > 0);
}
