import { describe, expect, it } from 'vitest';

import {
  bootstrapStatistics,
  bootstrapStatisticsDiagnosticV2,
} from '../../src/services/recommendation/ope/inference/bootstrap';
import { summarizeClusterScoresV1 } from '../../src/services/recommendation/ope/inference/clusterScores';

function scoreSummary() {
  const result = summarizeClusterScoresV1('dr', [
    { inferenceClusterId: 'cluster-a', y: 2.4, a: 2, importanceMass: 1.1 },
    { inferenceClusterId: 'cluster-b', y: 0.8, a: 2, importanceMass: 0.9 },
    { inferenceClusterId: 'cluster-c', y: 1.6, a: 2, importanceMass: 1.2 },
    { inferenceClusterId: 'cluster-d', y: 2, a: 2, importanceMass: 0.8 },
  ]);
  if (result.status !== 'evaluated') throw new Error(result.blocker);
  return result.summary;
}

describe('Phase 13 structured bootstrap diagnostics', () => {
  it('preserves the V1 multiplier sequence exactly', () => {
    const summary = scoreSummary();
    const population = {
      center: 0.5,
      scores: summary.clusters.map((cluster) => cluster.y - cluster.a * 0.5),
      purposeSeedSha256: 'a'.repeat(64),
    };
    const golden = [
      1.1274690420042432,
      3.098386676965934,
      2.04939015319192,
      -0.19011727515734356,
      -3.098386676965934,
      -0.8401680504168058,
      -0.19011727515734356,
      -3.098386676965934,
    ];

    expect(bootstrapStatisticsDiagnosticV2(summary, population, 8)).toEqual({
      status: 'evaluated',
      values: golden,
    });
    expect(bootstrapStatistics(summary, population, 8)).toEqual(golden);
  });

  it('distinguishes a finite zero studentizer from numeric invalidity', () => {
    const degenerate = summarizeClusterScoresV1('ips', [
      { inferenceClusterId: 'a', y: 0, a: 1, importanceMass: 2 },
      { inferenceClusterId: 'b', y: 2, a: 1, importanceMass: 1 },
    ]);
    expect(degenerate.status).toBe('evaluated');
    if (degenerate.status !== 'evaluated') return;
    const degeneratePopulation = {
      center: 1,
      scores: degenerate.summary.clusters.map((cluster) => cluster.y - cluster.a),
      purposeSeedSha256: 'b'.repeat(64),
    };

    expect(bootstrapStatisticsDiagnosticV2(
      degenerate.summary,
      degeneratePopulation,
      64,
    )).toEqual({
      status: 'not_evaluable',
      reason: 'resample_studentizer_degenerate',
    });
    expect(bootstrapStatistics(degenerate.summary, degeneratePopulation, 64)).toBeUndefined();

    const numericPopulation = {
      center: 0,
      scores: scoreSummary().clusters.map(() => Number.MAX_VALUE),
      purposeSeedSha256: 'c'.repeat(64),
    };
    expect(bootstrapStatisticsDiagnosticV2(
      scoreSummary(),
      numericPopulation,
      1,
    )).toEqual({
      status: 'not_evaluable',
      reason: 'resample_numeric_invalid',
    });
    expect(bootstrapStatistics(scoreSummary(), numericPopulation, 1)).toBeUndefined();
  });
});
