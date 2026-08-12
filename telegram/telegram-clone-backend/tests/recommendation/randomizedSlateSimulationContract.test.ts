import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  candidatePoolSha256,
  canonicalDecisionJson,
  decisionLogSha256,
} from '../../src/services/recommendation/decisionLog/contracts';
import {
  MAX_CANDIDATE_POOL_SIZE,
  MAX_SLATE_SIZE,
  randomizedSlateSimulationInputSchema,
  randomizedSlateSimulationSchema,
  type RandomizedSlateSimulationV1,
} from '../../src/services/recommendation/randomizedSlate/contracts';
import { verifyRandomizedSlateSimulationV1 } from '../../src/services/recommendation/randomizedSlate/verify';

const FIXTURE_PATH = path.resolve(
  __dirname,
  '../../../telegram-rust-workspace/crates/telegram-recommendation-fixtures/fixtures/randomized_slate_simulation_v1.json',
);
const SOURCE_ROOT = path.resolve(__dirname, '../../src');
const AUDITED_OFFLINE_RANDOMIZED_SLATE_IMPORTS = [
  'services/recommendation/offlinePrediction/streamingV2/contracts.ts',
  'services/recommendation/offlinePrediction/streamingV2/trajectory.ts',
];
const SERVING_CALLER_PATTERNS = {
  route: /(^|\/)routes?(\/|$)/i,
  worker: /(^|\/)[^/]*workers?[^/]*(\/|\.ts$)/i,
  scheduler: /(^|\/)[^/]*schedulers?[^/]*(\/|\.ts$)/i,
  SpaceService: /(^|\/)spaceService\.ts$/i,
  selector: /(^|\/)[^/]*selectors?[^/]*(\/|\.ts$)/i,
  runtime: /(^|\/)[^/]*runtime[^/]*(\/|\.ts$)/i,
  serving: /(^|\/)[^/]*serving[^/]*(\/|\.ts$)/i,
};
const randomizedSlateFixtureSchema = z.object({
  fixtureVersion: z.literal('randomized_slate_simulation_fixture_v1'),
  input: randomizedSlateSimulationInputSchema,
  expected: randomizedSlateSimulationSchema,
}).strict();

function fixture() {
  const parsed = randomizedSlateFixtureSchema.parse(
    JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')),
  );
  return { input: parsed.input, output: parsed.expected };
}

function rehash(output: RandomizedSlateSimulationV1): void {
  const { simulationSha256: _, ...preimage } = output;
  output.simulationSha256 = createHash('sha256')
    .update(canonicalDecisionJson(preimage))
    .digest('hex');
}

function rebindSource(
  input: ReturnType<typeof fixture>['input'],
  output: RandomizedSlateSimulationV1,
): void {
  const source = input.sourceDecisionLog;
  source.candidatePool.candidatePoolSha256 = candidatePoolSha256(source.candidatePool.candidates);
  input.sourceDecisionLogSha256 = decisionLogSha256(source);
  output.decisionFingerprint.sha256 = input.sourceDecisionLogSha256;
  output.candidatePoolFingerprint.sha256 = source.candidatePool.candidatePoolSha256;
  rehash(output);
}

describe('randomized_slate_simulation_v1', () => {
  it('verifies the Rust golden simulation without changing its source timestamp string', () => {
    const { input, output } = fixture();
    const timestamp = input.sourceDecisionLog.decisionAt;

    expect(verifyRandomizedSlateSimulationV1(input, output)).toEqual({ status: 'verified' });
    expect(input.sourceDecisionLog.decisionAt).toBe(timestamp);
  });

  it('rejects a bad simulation hash', () => {
    const { input, output } = fixture();
    output.simulationSha256 = '0'.repeat(64);

    expect(verifyRandomizedSlateSimulationV1(input, output)).toEqual({
      status: 'rejected',
      blockers: ['simulation_digest_mismatch'],
    });
  });

  it('rejects a conditional probability that omits the deterministic mixture mass', () => {
    const { input, output } = fixture();
    const action = output.orderedActions.find((candidate) => candidate.selectedWasDeterministicTop);
    if (!action) throw new Error('golden fixture must select the deterministic top at least once');
    action.conditionalSelectionProbability =
      output.policy.epsilon * action.plackettLuceProbability;
    rehash(output);

    expect(verifyRandomizedSlateSimulationV1(input, output)).toMatchObject({
      status: 'rejected',
      blockers: expect.arrayContaining(['conditional_probability_mismatch']),
    });
  });

  it('recomputes prefix probabilities from source scores and policy temperature', () => {
    const { input, output } = fixture();
    const eligible = input.sourceDecisionLog.candidatePool.candidates.find(
      (candidate) => candidate.eligible && candidate.score !== null,
    );
    if (!eligible || eligible.score === null) throw new Error('fixture needs a scored candidate');
    eligible.score += 0.5;
    rebindSource(input, output);

    expect(verifyRandomizedSlateSimulationV1(input, output)).toMatchObject({
      status: 'rejected',
      blockers: expect.arrayContaining(['plackett_luce_probability_mismatch']),
    });
  });

  it('recomputes each selected action from the matching uniform draw', () => {
    const { input, output } = fixture();
    input.uniformDraws[0] = 1 - Number.EPSILON;

    expect(verifyRandomizedSlateSimulationV1(input, output)).toMatchObject({
      status: 'rejected',
      blockers: expect.arrayContaining(['uniform_draw_selection_mismatch']),
    });
  });

  it('locks policy and evidence literals and rejects closed uniform draw boundaries', () => {
    const { input, output } = fixture();

    expect(randomizedSlateSimulationInputSchema.safeParse({
      ...input,
      config: { ...input.config, policyId: 'other_policy' },
    }).success).toBe(false);
    expect(randomizedSlateSimulationSchema.safeParse({
      ...output,
      evidenceKind: 'logged_randomized',
    }).success).toBe(false);
    for (const draw of [0, 1]) {
      expect(randomizedSlateSimulationInputSchema.safeParse({
        ...input,
        uniformDraws: input.uniformDraws.map(() => draw),
      }).success).toBe(false);
    }
  });

  it('rejects actions outside the eligible pool and repeated candidate identities', () => {
    const { input, output } = fixture();
    const ineligible = input.sourceDecisionLog.candidatePool.candidates.find(
      (candidate) => !candidate.eligible,
    );
    if (!ineligible) throw new Error('golden fixture must include an ineligible candidate');
    output.orderedActions[0].actionKey = {
      candidateNamespace: ineligible.candidateNamespace,
      candidateId: ineligible.candidateId,
      servedPosition: 1,
    };
    rehash(output);

    expect(verifyRandomizedSlateSimulationV1(input, output)).toMatchObject({
      status: 'rejected',
      blockers: expect.arrayContaining(['action_ineligible_or_missing']),
    });

    const duplicate = fixture();
    expect(duplicate.output.orderedActions.length).toBeGreaterThan(1);
    duplicate.output.orderedActions[1].actionKey = {
      ...duplicate.output.orderedActions[0].actionKey,
      servedPosition: 2,
    };
    rehash(duplicate.output);
    expect(verifyRandomizedSlateSimulationV1(duplicate.input, duplicate.output)).toMatchObject({
      status: 'rejected',
      blockers: expect.arrayContaining(['action_duplicate']),
    });
  });

  it('rejects strict-object additions', () => {
    const { input, output } = fixture();

    expect(randomizedSlateSimulationInputSchema.safeParse({ ...input, unexpected: true }).success)
      .toBe(false);
    expect(randomizedSlateSimulationSchema.safeParse({ ...output, unexpected: true }).success)
      .toBe(false);
  });

  it('requires complete, untruncated source support with an exact candidate count', () => {
    const incomplete = fixture();
    incomplete.input.sourceDecisionLog.candidatePool.supportEvidence = {
      status: 'incomplete',
      reason: 'test_support_gap',
    };
    rebindSource(incomplete.input, incomplete.output);
    expect(verifyRandomizedSlateSimulationV1(incomplete.input, incomplete.output)).toMatchObject({
      status: 'rejected',
      blockers: expect.arrayContaining(['support_incomplete']),
    });

    const truncated = fixture();
    truncated.input.sourceDecisionLog.candidatePool.supportEvidence = {
      status: 'incomplete',
      reason: 'test_truncated_support',
    };
    truncated.input.sourceDecisionLog.candidatePool.truncated = true;
    rebindSource(truncated.input, truncated.output);
    expect(verifyRandomizedSlateSimulationV1(truncated.input, truncated.output)).toMatchObject({
      status: 'rejected',
      blockers: expect.arrayContaining(['candidate_pool_truncated']),
    });

    const countMismatch = fixture();
    countMismatch.input.sourceDecisionLog.candidatePool.supportEvidence = {
      status: 'incomplete',
      reason: 'test_count_mismatch',
    };
    countMismatch.input.sourceDecisionLog.candidatePool.truncated = true;
    countMismatch.input.sourceDecisionLog.candidatePool.totalCount += 1;
    rebindSource(countMismatch.input, countMismatch.output);
    expect(verifyRandomizedSlateSimulationV1(countMismatch.input, countMismatch.output)).toMatchObject({
      status: 'rejected',
      blockers: expect.arrayContaining(['candidate_count_mismatch']),
    });
  });

  it('requires every eligible candidate to carry a finite score', () => {
    const { input, output } = fixture();
    const eligible = input.sourceDecisionLog.candidatePool.candidates.find(
      (candidate) => candidate.eligible,
    );
    if (!eligible) throw new Error('golden fixture must include an eligible candidate');
    eligible.score = null;
    rebindSource(input, output);

    expect(verifyRandomizedSlateSimulationV1(input, output)).toMatchObject({
      status: 'rejected',
      blockers: expect.arrayContaining(['eligible_candidate_logit_missing']),
    });
  });

  it('enforces the Rust candidate-pool and slate-size caps', () => {
    const oversizedPool = fixture();
    const candidates = oversizedPool.input.sourceDecisionLog.candidatePool.candidates;
    const template = structuredClone(candidates[1]);
    for (let index = candidates.length; index < MAX_CANDIDATE_POOL_SIZE + 1; index += 1) {
      candidates.push({
        ...structuredClone(template),
        candidateId: `cap-candidate-${index}`,
        poolRank: index + 1,
      });
    }
    oversizedPool.input.sourceDecisionLog.candidatePool.totalCount = candidates.length;
    rebindSource(oversizedPool.input, oversizedPool.output);
    expect(verifyRandomizedSlateSimulationV1(oversizedPool.input, oversizedPool.output)).toMatchObject({
      status: 'rejected',
      blockers: expect.arrayContaining(['candidate_pool_too_large']),
    });

    const oversizedSlate = fixture();
    oversizedSlate.input.config.slateSize = MAX_SLATE_SIZE + 1;
    oversizedSlate.input.uniformDraws = Array.from(
      { length: MAX_SLATE_SIZE + 1 },
      () => 0.5,
    );
    expect(verifyRandomizedSlateSimulationV1(oversizedSlate.input, oversizedSlate.output)).toMatchObject({
      status: 'rejected',
      blockers: expect.arrayContaining(['slate_too_large']),
    });
  });

  it('requires deterministic top-k source behavior and propensity evidence', () => {
    const { input, output } = fixture();
    input.sourceDecisionLog.behaviorPolicyKind = 'logged_randomized';
    input.sourceDecisionLog.actions = input.sourceDecisionLog.actions.map((action) => ({
      ...action,
      behaviorPropensity: {
        status: 'logged_randomized' as const,
        selectionProbability: 0.5,
      },
    }));
    rebindSource(input, output);

    expect(verifyRandomizedSlateSimulationV1(input, output)).toMatchObject({
      status: 'rejected',
      blockers: expect.arrayContaining(['source_behavior_not_deterministic']),
    });

    const malformedEvidence = fixture();
    malformedEvidence.input.sourceDecisionLog.actions[0].behaviorPropensity = {
      status: 'unknown_support',
      reason: 'test_unknown_support',
    };
    expect(verifyRandomizedSlateSimulationV1(
      malformedEvidence.input,
      malformedEvidence.output,
    )).toMatchObject({
      status: 'rejected',
      blockers: expect.arrayContaining(['invalid_input', 'source_behavior_not_deterministic']),
    });
  });

  it('allows only the audited offline import and has no serving integration', () => {
    const imports = readdirSync(SOURCE_ROOT, { recursive: true })
      .map(String)
      .map((file) => file.split(path.sep).join('/'))
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => !file.startsWith('services/recommendation/randomizedSlate/'))
      .filter((file) => readFileSync(path.join(SOURCE_ROOT, file), 'utf8')
        .includes('randomizedSlate'))
      .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));

    expect(imports).toEqual(AUDITED_OFFLINE_RANDOMIZED_SLATE_IMPORTS);
    for (const [surface, pattern] of Object.entries(SERVING_CALLER_PATTERNS)) {
      expect(imports.filter((file) => pattern.test(file)), `${surface} caller`).toEqual([]);
    }
  });
});
