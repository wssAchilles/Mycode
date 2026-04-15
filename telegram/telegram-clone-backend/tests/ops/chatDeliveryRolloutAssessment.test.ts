import { describe, expect, it } from 'vitest';

import { assessChatDeliveryRollout } from '../../src/services/chatDelivery/rolloutAssessment';

describe('chat delivery rollout assessment', () => {
  it('recommends promoting private go_primary traffic when canary is stable', () => {
    const assessment = assessChatDeliveryRollout({
      rollout: {
        mode: 'go_canary',
        takeoverStage: 'go_canary',
        requestedMode: 'go_canary',
        nodePrimary: true,
        nodeFallbackOnly: false,
        goShadow: true,
        goCanary: true,
        goPrimary: false,
        goPrimaryReady: false,
        rollbackActive: false,
        streamKey: 'chat:delivery:bus:v1',
        dlqStreamKey: 'chat:delivery:bus:dlq:v1',
        maxRecipientsPerChunk: 1500,
        primary: {
          privateEnabled: true,
          groupEnabled: false,
          maxRecipients: 2,
        },
        rollout: {
          bucketStrategy: 'chat_id_hash_mod_100',
          privatePercent: 25,
          groupPercent: 0,
          chatAllowlistCount: 0,
          senderAllowlistCount: 0,
        },
        canary: {
          enabled: true,
          segment: 'projection_bookkeeping',
          mismatchThreshold: 5,
          deadLetterThreshold: 3,
          fallbackMode: 'shadow_go',
        },
      },
      consumer: {
        available: true,
        summary: {
          executionMode: 'canary',
          shadowCompared: 12,
          shadowMismatches: 0,
          deadLetters: 0,
          canaryExecutions: 12,
        },
      },
      canary: {
        available: true,
        streamLength: 12,
        lastResult: 'matched',
      },
      consistency: {
        scannedRecords: 20,
        staleThresholdMinutes: 15,
        aggregateDriftCount: 0,
        staleRecordCount: 0,
        repairableCount: 0,
        countsByIssueKind: {},
        recentIssues: [],
        lastScannedAt: new Date('2026-04-15T00:00:00Z').toISOString(),
      },
      fallback: {
        scannedRecords: 0,
        staleThresholdMinutes: 15,
        eligibleCount: 0,
        failedEligibleCount: 0,
        staleEligibleCount: 0,
        blockedCount: 0,
        recentCandidates: [],
        lastScannedAt: new Date('2026-04-15T00:00:00Z').toISOString(),
      },
    });

    expect(assessment.overallStatus).toBe('healthy');
    expect(assessment.recommendations[0]).toMatchObject({
      action: 'promote_private_primary',
    });
  });

  it('prioritizes rollback and repair when canary mismatch or consistency drift exceeds the threshold', () => {
    const assessment = assessChatDeliveryRollout({
      rollout: {
        mode: 'go_canary',
        takeoverStage: 'go_canary',
        requestedMode: 'go_canary',
        nodePrimary: true,
        nodeFallbackOnly: false,
        goShadow: true,
        goCanary: true,
        goPrimary: false,
        goPrimaryReady: false,
        rollbackActive: false,
        streamKey: 'chat:delivery:bus:v1',
        dlqStreamKey: 'chat:delivery:bus:dlq:v1',
        maxRecipientsPerChunk: 1500,
        primary: {
          privateEnabled: true,
          groupEnabled: false,
          maxRecipients: 2,
        },
        rollout: {
          bucketStrategy: 'chat_id_hash_mod_100',
          privatePercent: 25,
          groupPercent: 0,
          chatAllowlistCount: 0,
          senderAllowlistCount: 0,
        },
        canary: {
          enabled: true,
          segment: 'projection_bookkeeping',
          mismatchThreshold: 3,
          deadLetterThreshold: 2,
          fallbackMode: 'shadow_go',
        },
      },
      consumer: {
        available: true,
        summary: {
          executionMode: 'canary',
          shadowCompared: 4,
          shadowMismatches: 3,
          deadLetters: 2,
        },
      },
      canary: {
        available: true,
        streamLength: 4,
        lastResult: 'mismatch',
      },
      consistency: {
        scannedRecords: 20,
        staleThresholdMinutes: 15,
        aggregateDriftCount: 2,
        staleRecordCount: 1,
        repairableCount: 2,
        countsByIssueKind: {
          aggregate_drift: 2,
          stale_record: 1,
        },
        recentIssues: [],
        lastScannedAt: new Date('2026-04-15T00:00:00Z').toISOString(),
      },
      fallback: {
        scannedRecords: 1,
        staleThresholdMinutes: 15,
        eligibleCount: 1,
        failedEligibleCount: 1,
        staleEligibleCount: 0,
        blockedCount: 0,
        recentCandidates: [],
        lastScannedAt: new Date('2026-04-15T00:00:00Z').toISOString(),
      },
    });

    expect(assessment.overallStatus).toBe('blocked');
    expect(assessment.recommendations.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['rollback_to_node', 'repair_outbox']),
    );
  });

  it('activates legacy fallback and recommends group canary only after private primary is stable', () => {
    const baseInput = {
      rollout: {
        mode: 'go_primary',
        takeoverStage: 'private_primary',
        requestedMode: 'go_primary',
        nodePrimary: false,
        nodeFallbackOnly: true,
        goShadow: true,
        goCanary: true,
        goPrimary: true,
        goPrimaryReady: true,
        rollbackActive: false,
        streamKey: 'chat:delivery:bus:v1',
        dlqStreamKey: 'chat:delivery:bus:dlq:v1',
        maxRecipientsPerChunk: 1500,
        primary: {
          privateEnabled: true,
          groupEnabled: false,
          maxRecipients: 2,
        },
        rollout: {
          bucketStrategy: 'chat_id_hash_mod_100',
          privatePercent: 100,
          groupPercent: 0,
          chatAllowlistCount: 0,
          senderAllowlistCount: 0,
        },
        canary: {
          enabled: true,
          segment: 'projection_bookkeeping',
          mismatchThreshold: 3,
          deadLetterThreshold: 2,
          fallbackMode: 'shadow_go',
        },
      },
      consumer: {
        available: true,
        summary: {
          executionMode: 'primary',
          primarySucceeded: 8,
          primaryFailed: 0,
          derived: {
            primarySuccessRate: 1,
          },
        },
      },
      canary: {
        available: true,
        streamLength: 5,
        lastResult: 'matched',
      },
      consistency: {
        scannedRecords: 10,
        staleThresholdMinutes: 15,
        aggregateDriftCount: 0,
        staleRecordCount: 0,
        repairableCount: 0,
        countsByIssueKind: {},
        recentIssues: [],
        lastScannedAt: new Date('2026-04-15T00:00:00Z').toISOString(),
      },
      fallback: {
        scannedRecords: 2,
        staleThresholdMinutes: 15,
        eligibleCount: 2,
        failedEligibleCount: 1,
        staleEligibleCount: 1,
        blockedCount: 0,
        recentCandidates: [],
        lastScannedAt: new Date('2026-04-15T00:00:00Z').toISOString(),
      },
    } as const;

    const degraded = assessChatDeliveryRollout(baseInput);

    expect(degraded.overallStatus).toBe('degraded');
    expect(degraded.recommendations[0]).toMatchObject({
      action: 'activate_legacy_fallback',
    });

    const healthy = assessChatDeliveryRollout({
      ...baseInput,
      fallback: {
        scannedRecords: 0,
        staleThresholdMinutes: 15,
        eligibleCount: 0,
        failedEligibleCount: 0,
        staleEligibleCount: 0,
        blockedCount: 0,
        recentCandidates: [],
        lastScannedAt: new Date('2026-04-15T00:00:00Z').toISOString(),
      },
      consumer: {
        available: true,
        summary: {
          executionMode: 'primary',
          primarySucceeded: 12,
          primaryFailed: 0,
          derived: {
            primarySuccessRate: 1,
          },
        },
      },
    });

    expect(healthy.recommendations[0]).toMatchObject({
      action: 'promote_group_canary',
    });
  });
});
