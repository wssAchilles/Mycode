import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  candidatePoolSha256,
  canonicalDecisionJson,
  decisionCandidateSchema,
  decisionLogSha256,
  recommendationDecisionLogSchema,
} from '../../src/services/recommendation/decisionLog/contracts';

const fixture = JSON.parse(readFileSync(path.resolve(
  __dirname,
  '../../../telegram-rust-workspace/crates/telegram-recommendation-fixtures/fixtures/decision_log_v1.json',
), 'utf8'));

describe('recommendation decision log contract', () => {
  it('parses the shared fixture and produces canonical SHA-256 digests', () => {
    const decision = recommendationDecisionLogSchema.parse(fixture.decisionLog);

    expect(decision.positionContractVersion).toBe('served_position_1_based_v1');
    expect(decision.servingOwner).toBe('rust');
    expect(decision.behaviorPolicyKind).toBe('deterministic_top_k');
    expect(decision.versions.strategy.status).toBe('bound');
    expect(decision.candidatePool.totalCount).toBe(2);
    expect(decision.candidatePool.truncated).toBe(false);
    expect(decision.actions[0].actionKey.servedPosition).toBe(1);
    expect(candidatePoolSha256(decision.candidatePool.candidates)).toBe(
      fixture.expectedCandidatePoolSha256,
    );
    expect(decisionLogSha256(decision)).toBe(fixture.expectedDecisionSha256);
  });

  it('rejects invalid server identities and candidate namespaces', () => {
    for (const field of ['requestId', 'decisionId'] as const) {
      expect(() => recommendationDecisionLogSchema.parse({
        ...fixture.decisionLog,
        [field]: 'client-controlled-id',
      })).toThrow();
    }

    expect(() => recommendationDecisionLogSchema.parse({
      ...fixture.decisionLog,
      candidatePool: {
        ...fixture.decisionLog.candidatePool,
        candidates: [{
          ...fixture.decisionLog.candidatePool.candidates[0],
          candidateNamespace: 'unversioned_id',
        }, fixture.decisionLog.candidatePool.candidates[1]],
      },
    })).toThrow();
  });

  it('rejects inconsistent selection, serving, pool support, and pool digests', () => {
    const candidate = fixture.decisionLog.candidatePool.candidates[0];
    const invalidCandidates = [
      { ...candidate, selected: false, selectionRank: 1 },
      { ...candidate, served: false, servedPosition: 1 },
      { ...candidate, selected: false, selectionRank: null, served: true },
      { ...candidate, eligible: false },
    ];

    for (const invalidCandidate of invalidCandidates) {
      expect(() => decisionCandidateSchema.parse(invalidCandidate)).toThrow();
    }

    for (const candidatePool of [
      { ...fixture.decisionLog.candidatePool, totalCount: -1 },
      { ...fixture.decisionLog.candidatePool, totalCount: 1 },
      { ...fixture.decisionLog.candidatePool, totalCount: 3, truncated: false },
      { ...fixture.decisionLog.candidatePool, truncated: true },
      { ...fixture.decisionLog.candidatePool, candidatePoolSha256: '0'.repeat(64) },
    ]) {
      expect(() => recommendationDecisionLogSchema.parse({
        ...fixture.decisionLog,
        candidatePool,
      })).toThrow();
    }
  });

  it('enforces behavior policy kind against logged propensity evidence', () => {
    const deterministicAction = fixture.decisionLog.actions[0];
    expect(() => recommendationDecisionLogSchema.parse({
      ...fixture.decisionLog,
      actions: [{
        ...deterministicAction,
        behaviorPropensity: { status: 'logged_randomized', selectionProbability: 0.5 },
      }],
    })).toThrow();
    expect(() => recommendationDecisionLogSchema.parse({
      ...fixture.decisionLog,
      behaviorPolicyKind: 'logged_randomized',
    })).toThrow();
    expect(recommendationDecisionLogSchema.parse({
      ...fixture.decisionLog,
      behaviorPolicyKind: 'logged_randomized',
      actions: [{
        ...deterministicAction,
        behaviorPropensity: { status: 'unknown_support', reason: 'pool_truncated' },
      }],
    }).actions[0].behaviorPropensity.status).toBe('unknown_support');
  });

  it('canonicalizes object keys and f64 values identically across runtimes', () => {
    const edgeCase = fixture.canonicalizationCase;

    expect(canonicalDecisionJson(edgeCase.left)).toBe(edgeCase.expectedCanonical);
    expect(canonicalDecisionJson(edgeCase.right)).toBe(edgeCase.expectedCanonical);
  });

  it('rejects missing, duplicate, and mismatched served actions', () => {
    const action = fixture.decisionLog.actions[0];
    for (const actions of [
      [],
      [action, action],
      [{ ...action, selectionRank: 2 }],
      [{ ...action, actionKey: { ...action.actionKey, candidateId: 'missing-candidate' } }],
      [{ ...action, actionKey: { ...action.actionKey, servedPosition: 2 } }],
    ]) {
      expect(() => recommendationDecisionLogSchema.parse({
        ...fixture.decisionLog,
        actions,
      })).toThrow();
    }
  });

  it('rejects zero-based positions and invalid logged probabilities', () => {
    const decision = recommendationDecisionLogSchema.parse(fixture.decisionLog);

    expect(() => recommendationDecisionLogSchema.parse({
      ...decision,
      actions: [{
        ...decision.actions[0],
        actionKey: { ...decision.actions[0].actionKey, servedPosition: 0 },
      }],
    })).toThrow();

    for (const selectionProbability of [0, 1.01]) {
      expect(() => recommendationDecisionLogSchema.parse({
        ...decision,
        actions: [{
          ...decision.actions[0],
          behaviorPropensity: { status: 'logged_randomized', selectionProbability },
        }],
      })).toThrow();
    }
  });

  it('preserves deterministic behavior as explicitly not evaluable', () => {
    const decision = recommendationDecisionLogSchema.parse(fixture.decisionLog);

    expect(decision.actions[0].behaviorPropensity).toEqual({
      status: 'not_evaluable_deterministic',
      reason: 'deterministic_top_k_no_logged_probability',
    });
  });
});
