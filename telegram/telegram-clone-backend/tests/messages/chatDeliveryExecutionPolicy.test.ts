import { afterEach, describe, expect, it } from 'vitest';

import {
  getChatDeliveryExecutionPolicySummary,
  shouldNodeExecuteFanoutProjection,
} from '../../src/services/chatDelivery/executionPolicy';
import type { MessageFanoutCommand } from '../../src/services/chatDelivery/contracts';

const ORIGINAL_ENV = { ...process.env };

describe('chat delivery execution policy', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('enables Go canary while keeping Node as the primary projection executor', () => {
    process.env.DELIVERY_EXECUTION_MODE = 'go_canary';
    process.env.DELIVERY_CANARY_SEGMENT = 'projection_bookkeeping';
    process.env.DELIVERY_CANARY_MISMATCH_THRESHOLD = '3';
    process.env.DELIVERY_CANARY_DLQ_THRESHOLD = '2';

    const summary = getChatDeliveryExecutionPolicySummary();

    expect(summary.mode).toBe('go_canary');
    expect(summary.takeoverStage).toBe('go_canary');
    expect(summary.nodePrimary).toBe(true);
    expect(summary.nodeFallbackOnly).toBe(false);
    expect(summary.goShadow).toBe(true);
    expect(summary.goCanary).toBe(true);
    expect(summary.goPrimary).toBe(false);
    expect(summary.rollbackActive).toBe(false);
    expect(summary.canary.segment).toBe('projection_bookkeeping');
    expect(summary.canary.mismatchThreshold).toBe(3);
    expect(summary.canary.deadLetterThreshold).toBe(2);
    expect(shouldNodeExecuteFanoutProjection(summary).execute).toBe(true);
  });

  it('forces Node execution when rollback mode is requested', () => {
    process.env.DELIVERY_EXECUTION_MODE = 'rollback_node';

    const summary = getChatDeliveryExecutionPolicySummary();
    const decision = shouldNodeExecuteFanoutProjection(summary);

    expect(summary.mode).toBe('rollback_node');
    expect(summary.takeoverStage).toBe('rollback_node');
    expect(summary.rollbackActive).toBe(true);
    expect(summary.nodePrimary).toBe(true);
    expect(summary.goCanary).toBe(false);
    expect(decision.execute).toBe(true);
    expect(decision.reason).toBe('rollback_node');
  });

  it('hands only eligible private fanout to Go primary when the hard gate is ready', () => {
    process.env.DELIVERY_EXECUTION_MODE = 'go_primary';
    process.env.DELIVERY_GO_PRIMARY_READY = 'true';
    process.env.DELIVERY_GO_PRIMARY_PRIVATE_ENABLED = 'true';
    process.env.DELIVERY_GO_PRIMARY_GROUP_ENABLED = 'false';
    process.env.DELIVERY_GO_PRIMARY_MAX_RECIPIENTS = '2';

    const summary = getChatDeliveryExecutionPolicySummary();
    const privateCommand: MessageFanoutCommand = {
      messageId: 'msg-1',
      chatId: 'chat-1',
      chatType: 'private',
      seq: 1,
      senderId: 'u1',
      recipientIds: ['u1', 'u2'],
      emittedAt: new Date(0).toISOString(),
      metadata: { topology: 'eager' },
    };
    const groupCommand: MessageFanoutCommand = {
      ...privateCommand,
      messageId: 'msg-2',
      chatId: 'g:group-1',
      chatType: 'group',
      recipientIds: ['u1', 'u2'],
    };

    expect(summary.takeoverStage).toBe('private_primary');
    expect(summary.nodePrimary).toBe(false);
    expect(summary.nodeFallbackOnly).toBe(true);
    expect(shouldNodeExecuteFanoutProjection(summary, privateCommand)).toMatchObject({
      execute: false,
      reason: 'go_primary',
      segment: 'private',
    });
    expect(shouldNodeExecuteFanoutProjection(summary, groupCommand)).toMatchObject({
      execute: true,
      reason: 'go_primary_segment_not_enabled',
    });
  });

  it('surfaces rollout policy details and keeps traffic on Node when the rollout percentage excludes the chat bucket', () => {
    process.env.DELIVERY_EXECUTION_MODE = 'go_primary';
    process.env.DELIVERY_GO_PRIMARY_READY = 'true';
    process.env.DELIVERY_GO_PRIMARY_PRIVATE_ENABLED = 'true';
    process.env.DELIVERY_GO_PRIMARY_PRIVATE_ROLLOUT_PERCENT = '0';

    const summary = getChatDeliveryExecutionPolicySummary();
    const command: MessageFanoutCommand = {
      messageId: 'msg-10',
      chatId: 'chat-rollout-0',
      chatType: 'private',
      seq: 10,
      senderId: 'u1',
      recipientIds: ['u1', 'u2'],
      emittedAt: new Date(0).toISOString(),
      metadata: { topology: 'eager' },
    };

    expect(summary.rollout.privatePercent).toBe(0);
    expect(summary.rollout.bucketStrategy).toBe('chat_id_hash_mod_100');
    expect(summary.takeoverStage).toBe('private_primary');
    expect(shouldNodeExecuteFanoutProjection(summary, command)).toMatchObject({
      execute: true,
      reason: 'go_primary_rollout_not_selected',
      segment: 'private',
      rolloutPercent: 0,
    });
  });

  it('honors chat allowlists before promoting a command into Go primary', () => {
    process.env.DELIVERY_EXECUTION_MODE = 'go_primary';
    process.env.DELIVERY_GO_PRIMARY_READY = 'true';
    process.env.DELIVERY_GO_PRIMARY_PRIVATE_ENABLED = 'true';
    process.env.DELIVERY_GO_PRIMARY_PRIVATE_ROLLOUT_PERCENT = '100';
    process.env.DELIVERY_GO_PRIMARY_ALLOW_CHAT_IDS = 'chat-allow-1';

    const summary = getChatDeliveryExecutionPolicySummary();
    const blockedCommand: MessageFanoutCommand = {
      messageId: 'msg-11',
      chatId: 'chat-blocked',
      chatType: 'private',
      seq: 11,
      senderId: 'u1',
      recipientIds: ['u1', 'u2'],
      emittedAt: new Date(0).toISOString(),
      metadata: { topology: 'eager' },
    };
    const allowedCommand: MessageFanoutCommand = {
      ...blockedCommand,
      messageId: 'msg-12',
      chatId: 'chat-allow-1',
    };

    expect(summary.rollout.chatAllowlistCount).toBe(1);
    expect(summary.takeoverStage).toBe('private_primary');
    expect(shouldNodeExecuteFanoutProjection(summary, blockedCommand)).toMatchObject({
      execute: true,
      reason: 'go_primary_chat_not_allowlisted',
      segment: 'private',
    });
    expect(shouldNodeExecuteFanoutProjection(summary, allowedCommand)).toMatchObject({
      execute: false,
      reason: 'go_primary',
      segment: 'private',
      rolloutPercent: 100,
    });
  });
});
