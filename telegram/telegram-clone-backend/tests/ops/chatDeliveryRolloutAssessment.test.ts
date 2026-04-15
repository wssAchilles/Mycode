import { describe, expect, it } from 'vitest';

import { assessChatDeliveryRollout } from '../../src/services/chatDelivery/rolloutAssessment';

describe('chat delivery rollout assessment', () => {
  it('recommends promoting private go_primary traffic when canary is stable', () => {
    const assessment = assessChatDeliveryRollout({
      rollout: {
        mode: 'go_canary',
        requestedMode: 'go_canary',
        nodePrimary: true,
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
        requestedMode: 'go_canary',
        nodePrimary: true,
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
    });

    expect(assessment.overallStatus).toBe('blocked');
    expect(assessment.recommendations.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['rollback_to_node', 'repair_outbox']),
    );
  });
});
