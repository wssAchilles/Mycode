import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { developmentFixtureSchema } from '../../src/services/recommendation/randomizedSlate/v2/contracts';
import {
  isVerifiedRandomizedSlateDevelopmentTranscriptV2,
  verifyRandomizedSlateDevelopmentFixtureV2,
} from '../../src/services/recommendation/randomizedSlate/v2/verifyDevelopmentFixture';

const FIXTURE_DIR = path.resolve(
  __dirname,
  '../../../telegram-rust-workspace/crates/telegram-recommendation-fixtures/fixtures',
);

function rawFixtures(): { fixture: Buffer; source: Buffer } {
  return {
    fixture: readFileSync(path.join(FIXTURE_DIR, 'randomized_slate_development_v2.json')),
    source: readFileSync(path.join(FIXTURE_DIR, 'randomized_slate_simulation_v1.json')),
  };
}

function mutate(raw: Buffer, update: (value: Record<string, any>) => void): Buffer {
  const value = JSON.parse(raw.toString('utf8')) as Record<string, any>;
  update(value);
  return Buffer.from(JSON.stringify(value));
}

describe('randomized slate development transcript V2', () => {
  it('replays the fixed Rust fixture into a private non-serving brand', () => {
    const { fixture, source } = rawFixtures();
    const result = verifyRandomizedSlateDevelopmentFixtureV2(fixture, source);

    expect(result.status).toBe('verified');
    if (result.status !== 'verified') throw new Error(result.blocker);
    expect(result.evidence).toMatchObject({
      verificationStatus: 'verified_development_fixture_only',
      evidenceKind: 'simulated_propensity',
      servable: false,
      realDatasetEligible: false,
    });
    expect(Object.isFrozen(result.evidence)).toBe(true);
    expect(isVerifiedRandomizedSlateDevelopmentTranscriptV2(result.evidence)).toBe(true);
    expect(isVerifiedRandomizedSlateDevelopmentTranscriptV2(structuredClone(result.evidence)))
      .toBe(false);
  });

  it.each([
    ['seed', (value: Record<string, any>) => { value.revealedDevelopmentSeedHex = 'f'.repeat(64); }],
    ['commitment', (value: Record<string, any>) => { value.seedCommitmentSha256 = '0'.repeat(64); }],
    ['context', (value: Record<string, any>) => { value.expected.rngContextSha256 = '0'.repeat(64); }],
    ['RNG word', (value: Record<string, any>) => { value.expected.orderedActions[0].randomTranscript.rawWordsHex[0] = '0'.repeat(16); }],
    ['joint probability', (value: Record<string, any>) => { value.expected.orderedJointProbability.jointConditionalSelectionProbability = 0.5; }],
    ['resource receipt', (value: Record<string, any>) => { value.expected.resourceReceipt.candidateWorkUnits += 1; }],
  ])('rejects %s drift before it can mint evidence', (_name, update) => {
    const { fixture, source } = rawFixtures();

    expect(verifyRandomizedSlateDevelopmentFixtureV2(mutate(fixture, update), source)).toEqual({
      status: 'rejected',
      blocker: 'fixture_root_mismatch',
    });
  });

  it('rejects source-root drift and oversized or non-byte inputs before JSON parsing', () => {
    const { fixture, source } = rawFixtures();
    const changedSource = Buffer.concat([source, Buffer.from('\n')]);

    expect(verifyRandomizedSlateDevelopmentFixtureV2(fixture, changedSource)).toEqual({
      status: 'rejected',
      blocker: 'source_fixture_root_mismatch',
    });
    expect(verifyRandomizedSlateDevelopmentFixtureV2({}, source)).toEqual({
      status: 'rejected',
      blocker: 'resource_limit_exceeded',
    });
    expect(verifyRandomizedSlateDevelopmentFixtureV2(Buffer.alloc(32 * 1024 * 1024 + 1), source))
      .toEqual({ status: 'rejected', blocker: 'resource_limit_exceeded' });
  });

  it('matches the Rust 128-byte UTF-8 epoch limit', () => {
    const { fixture } = rawFixtures();
    const value = JSON.parse(fixture.toString('utf8')) as Record<string, any>;

    value.epochId = '界'.repeat(42);
    value.expected.epochId = value.epochId;
    expect(developmentFixtureSchema.safeParse(value).success).toBe(true);

    value.epochId = '界'.repeat(43);
    value.expected.epochId = value.epochId;
    expect(developmentFixtureSchema.safeParse(value).success).toBe(false);
  });

  it('keeps policy arithmetic and runtime integration outside the Node V2 verifier', () => {
    const source = readFileSync(
      path.resolve(
        __dirname,
        '../../src/services/recommendation/randomizedSlate/v2/verifyDevelopmentFixture.ts',
      ),
      'utf8',
    );

    expect(source).not.toContain('Math.exp');
    expect(source).not.toContain('Math.log');
    expect(source).not.toContain('computeDistribution');
    expect(source).not.toContain('SpaceService');
    expect(source).not.toContain('logged_randomized');
  });
});
