import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../decisionLog/contracts';
import {
  DIAGNOSTIC_CI_BOOTSTRAP_DOMAIN_V1,
  THRESHOLD_BOOTSTRAP_DOMAIN_V1,
  type ClusterScoreSummaryV1,
} from './contracts';

export type BootstrapPopulation = {
  center: number;
  scores: number[];
  purposeSeedSha256: string;
};

export type BootstrapStatisticsDiagnosticV2 =
  | { status: 'evaluated'; values: number[] }
  | {
    status: 'not_evaluable';
    reason: 'resample_studentizer_degenerate' | 'resample_numeric_invalid';
  };

export function thresholdBootstrapTV1(
  summary: ClusterScoreSummaryV1,
  threshold: number,
  replicates: number,
  seedMaterial: string,
  inputSha256: string,
  segment: string,
) {
  const purposeSeedSha256 = bootstrapPurposeSeedV1(
    THRESHOLD_BOOTSTRAP_DOMAIN_V1,
    seedMaterial,
    inputSha256,
    summary.estimator,
    segment,
    threshold,
  );
  const population = {
    center: threshold,
    scores: summary.clusters.map((cluster) => cluster.y - cluster.a * threshold),
    purposeSeedSha256,
  };
  const observedStatistic = (summary.thetaHat - threshold) / summary.standardError;
  const values = bootstrapStatistics(summary, population, replicates);
  if (!Number.isFinite(observedStatistic) || !values) return { status: 'not_evaluable' as const, blocker: 'bootstrap_replicate_invalid' };
  const exceedances = values.filter((value) => Math.abs(value) >= Math.abs(observedStatistic)).length;
  return { status: 'evaluated' as const, observedStatistic, pValue: (1 + exceedances) / (replicates + 1), purposeSeedSha256 };
}

export function diagnosticCiBootstrapTV1(
  summary: ClusterScoreSummaryV1,
  level: number,
  replicates: number,
  seedMaterial: string,
  inputSha256: string,
  segment: string,
) {
  const purposeSeedSha256 = bootstrapPurposeSeedV1(
    DIAGNOSTIC_CI_BOOTSTRAP_DOMAIN_V1,
    seedMaterial,
    inputSha256,
    summary.estimator,
    segment,
    level,
  );
  const population = { center: summary.thetaHat, scores: summary.clusters.map((cluster) => cluster.score), purposeSeedSha256 };
  const values = bootstrapStatistics(summary, population, replicates);
  if (!values) return { status: 'not_evaluable' as const, blocker: 'bootstrap_replicate_invalid' };
  values.sort((left, right) => left - right);
  const alpha = 1 - level;
  const lowerQuantile = nearestRankV1(values, alpha / 2);
  const upperQuantile = nearestRankV1(values, 1 - alpha / 2);
  const lower = summary.thetaHat - upperQuantile * summary.standardError;
  const upper = summary.thetaHat - lowerQuantile * summary.standardError;
  if (![lowerQuantile, upperQuantile, lower, upper].every(Number.isFinite) || lower > upper) return { status: 'not_evaluable' as const, blocker: 'bootstrap_replicate_invalid' };
  return { status: 'evaluated' as const, level, lower, upper, standardError: summary.standardError, lowerQuantile, upperQuantile, purposeSeedSha256 };
}

export function bootstrapStatistics(summary: ClusterScoreSummaryV1, population: BootstrapPopulation, replicates: number): number[] | undefined {
  const result = bootstrapStatisticsDiagnosticV2(summary, population, replicates);
  return result.status === 'evaluated' ? result.values : undefined;
}

export function bootstrapStatisticsDiagnosticV2(
  summary: ClusterScoreSummaryV1,
  population: BootstrapPopulation,
  replicates: number,
): BootstrapStatisticsDiagnosticV2 {
  const values: number[] = [];
  const gCorrection = summary.clusters.length / (summary.clusters.length - 1);
  for (let replicate = 0; replicate < replicates; replicate += 1) {
    const signedScores = summary.clusters.map((cluster, index) => rademacher(population.purposeSeedSha256, replicate, cluster.inferenceClusterId) * population.scores[index]!);
    const delta = sum(signedScores) / summary.a;
    const thetaStar = population.center + delta;
    const starScores = signedScores.map((score, index) => score - summary.clusters[index]!.a * delta);
    const variance = gCorrection * sum(starScores.map((score) => score * score)) / (summary.a * summary.a);
    const standardError = Math.sqrt(variance);
    const statistic = (thetaStar - population.center) / standardError;
    if (![thetaStar, variance, standardError].every(Number.isFinite)) {
      return { status: 'not_evaluable', reason: 'resample_numeric_invalid' };
    }
    if (standardError <= 0) {
      return { status: 'not_evaluable', reason: 'resample_studentizer_degenerate' };
    }
    if (!Number.isFinite(statistic)) {
      return { status: 'not_evaluable', reason: 'resample_numeric_invalid' };
    }
    values.push(statistic);
  }
  return { status: 'evaluated', values };
}

export function bootstrapPurposeSeedV1(domain: string, seedMaterial: string, inputSha256: string, estimator: string, segment: string, levelOrThreshold: number): string {
  return sha256(`${domain}${seedMaterial}${inputSha256}${estimator}${segment}${canonicalDecisionJson(levelOrThreshold)}`);
}

function rademacher(seed: string, replicate: number, clusterId: string): 1 | -1 {
  const byte = createHash('sha256').update(seed).update('\0').update(String(replicate)).update('\0').update(clusterId).digest()[0]!;
  return byte & 1 ? 1 : -1;
}

export function nearestRankV1(sorted: readonly number[], probability: number): number {
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(probability * sorted.length)));
  return sorted[rank - 1]!;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
