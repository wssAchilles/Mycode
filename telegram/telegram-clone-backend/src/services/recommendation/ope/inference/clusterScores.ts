import { canonicalDecisionJson } from '../../decisionLog/contracts';
import { VIEWER_CLUSTER_UNIT_VERSION } from '../../decisionContext/contracts';
import { isVerifiedProjectedOpeInputV2, type VerifiedProjectedOpeInputV2 } from '../v2/project';
import {
  buildDrContributionsV2,
  buildOpeContributionRowsV2,
  type OpeContributionRowV2,
} from '../v2/evaluate';
import type { ClusterScoreSummaryV1, ClusterScoreV1, ExperimentalEstimatorV1 } from './contracts';

type BuildResult = { status: 'evaluated'; summary: ClusterScoreSummaryV1 } | { status: 'not_evaluable'; blocker: string };

export function buildVerifiedClusterScoreSummaryV1(
  input: VerifiedProjectedOpeInputV2,
  estimator: ExperimentalEstimatorV1,
  segment: string,
): BuildResult {
  if (!isVerifiedProjectedOpeInputV2(input)) return { status: 'not_evaluable', blocker: 'unverified_projection' };
  const rows = buildOpeContributionRowsV2(input);
  if (!rows) return { status: 'not_evaluable', blocker: 'non_finite_aggregate' };
  const selected = segment === '__all__' ? rows : rows.filter((row) => hasSegment(row, segment));
  if (selected.length === 0) return { status: 'not_evaluable', blocker: 'empty_segment' };
  if (selected.some((row) => !row.slot.binding.inferenceClusterId)) return { status: 'not_evaluable', blocker: 'inference_cluster_missing' };
  if (selected.some((row) => row.slot.binding.clusterUnitVersion !== VIEWER_CLUSTER_UNIT_VERSION)) return { status: 'not_evaluable', blocker: 'viewer_cluster_unit_required' };

  const contributions = contributionValues(selected, estimator);
  if ('blocker' in contributions) return { status: 'not_evaluable', blocker: contributions.blocker };
  const grouped = new Map<string, ClusterScoreV1>();
  selected.forEach((row, index) => {
    const id = row.slot.binding.inferenceClusterId;
    const current = grouped.get(id) ?? { inferenceClusterId: id, y: 0, a: 0, importanceMass: 0 };
    current.y += contributions.values[index]!;
    current.a += estimator === 'snips' ? row.weight! : 1;
    current.importanceMass += estimator === 'clippedIps' ? row.clipped! : row.weight!;
    grouped.set(id, current);
  });
  return summarizeClusterScoresV1(estimator, [...grouped.values()]);
}

export function summarizeClusterScoresV1(
  estimator: ExperimentalEstimatorV1,
  clusters: readonly ClusterScoreV1[],
): BuildResult {
  if (clusters.length < 2 || new Set(clusters.map((cluster) => cluster.inferenceClusterId)).size !== clusters.length || clusters.some((cluster) => !cluster.inferenceClusterId || !finitePositive(cluster.a) || !finiteNonnegative(cluster.importanceMass) || !Number.isFinite(cluster.y))) {
    return { status: 'not_evaluable', blocker: 'cluster_score_invalid' };
  }
  const a = sum(clusters.map((cluster) => cluster.a));
  const y = sum(clusters.map((cluster) => cluster.y));
  const mass = sum(clusters.map((cluster) => cluster.importanceMass));
  const massSquares = sum(clusters.map((cluster) => cluster.importanceMass ** 2));
  if (!finitePositive(a) || !finitePositive(mass) || !finitePositive(massSquares)) return { status: 'not_evaluable', blocker: 'cluster_mass_invalid' };
  const thetaHat = y / a;
  const scored = clusters.map((cluster) => ({ ...cluster, score: cluster.y - cluster.a * thetaHat }));
  const scoreSquares = sum(scored.map((cluster) => cluster.score ** 2));
  if (!Number.isFinite(thetaHat) || !finitePositive(scoreSquares)) return { status: 'not_evaluable', blocker: 'cluster_score_degenerate' };
  const variance = clusters.length / (clusters.length - 1) * scoreSquares / (a * a);
  const clusterEss = mass * mass / massSquares;
  const maximumScoreShare = Math.max(...scored.map((cluster) => cluster.score ** 2)) / scoreSquares;
  if (!finitePositive(variance) || !finitePositive(clusterEss) || !finitePositive(maximumScoreShare)) return { status: 'not_evaluable', blocker: 'cluster_diagnostics_invalid' };
  return { status: 'evaluated', summary: { estimator, thetaHat, a, clusters: scored.sort((left, right) => utf8Compare(left.inferenceClusterId, right.inferenceClusterId)), standardError: Math.sqrt(variance), clusterEss, maximumScoreShare } };
}

function contributionValues(rows: OpeContributionRowV2[], estimator: ExperimentalEstimatorV1): { values: number[] } | { blocker: string } {
  if (estimator === 'dr') {
    const result = buildDrContributionsV2(rows);
    return 'blocker' in result ? result : { values: result.contributions };
  }
  const values = rows.map((row) => estimator === 'clippedIps' ? row.clippedIps : row.ips);
  if (values.some((value) => value === undefined || !Number.isFinite(value))) return { blocker: 'importance_contribution_unavailable' };
  if ((estimator === 'snips' || estimator === 'ips') && rows.some((row) => row.weight === undefined || !Number.isFinite(row.weight))) return { blocker: 'importance_weight_unavailable' };
  if (estimator === 'clippedIps' && rows.some((row) => row.clipped === undefined || !Number.isFinite(row.clipped))) return { blocker: 'clipped_weight_unavailable' };
  return { values: values as number[] };
}

function hasSegment(row: OpeContributionRowV2, segment: string): boolean {
  return Object.entries(row.slot.segments ?? {}).some(([key, value]) => canonicalDecisionJson([key, value]) === segment);
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const finitePositive = (value: number) => Number.isFinite(value) && value > 0;
const finiteNonnegative = (value: number) => Number.isFinite(value) && value >= 0;
const utf8Compare = (left: string, right: string) => Buffer.compare(Buffer.from(left), Buffer.from(right));
