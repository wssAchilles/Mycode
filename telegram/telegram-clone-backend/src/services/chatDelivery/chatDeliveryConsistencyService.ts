import ChatDeliveryOutbox from '../../models/ChatDeliveryOutbox';
import { chatRuntimeMetrics } from '../chatRuntimeMetrics';
import {
  inspectOutboxConsistency,
  type ChatDeliveryConsistencyIssueKind,
  recomputeOutboxAggregates,
} from './outboxRecord';

export interface ChatDeliveryConsistencyIssueSummary {
  outboxId: string;
  messageId: string;
  chatId: string;
  status: string;
  expectedStatus: string;
  issueKinds: ChatDeliveryConsistencyIssueKind[];
  updatedAt: string;
  repairable: boolean;
  stale: boolean;
}

export interface ChatDeliveryConsistencySummary {
  scannedRecords: number;
  staleThresholdMinutes: number;
  aggregateDriftCount: number;
  staleRecordCount: number;
  repairableCount: number;
  countsByIssueKind: Partial<Record<ChatDeliveryConsistencyIssueKind, number>>;
  recentIssues: ChatDeliveryConsistencyIssueSummary[];
  lastScannedAt: string;
}

export interface ChatDeliveryConsistencyRepairResult extends ChatDeliveryConsistencySummary {
  repairedRecords: number;
  repairedOutboxIds: string[];
}

export interface ChatDeliveryConsistencyOptions {
  limit?: number;
  staleAfterMinutes?: number;
}

function normalizeOptions(options: ChatDeliveryConsistencyOptions = {}) {
  return {
    limit: Math.max(1, Math.min(options.limit || 25, 100)),
    staleAfterMinutes: Math.max(1, Math.min(options.staleAfterMinutes || 15, 24 * 60)),
  };
}

class ChatDeliveryConsistencyService {
  async buildSummary(options: ChatDeliveryConsistencyOptions = {}): Promise<ChatDeliveryConsistencySummary> {
    const normalized = normalizeOptions(options);
    const staleBefore = new Date(Date.now() - normalized.staleAfterMinutes * 60_000);
    const docs = await ChatDeliveryOutbox.find({})
      .sort({ updatedAt: -1 })
      .limit(normalized.limit);
    return this.summarizeDocs(docs, normalized.staleAfterMinutes, staleBefore);
  }

  async repair(options: ChatDeliveryConsistencyOptions = {}): Promise<ChatDeliveryConsistencyRepairResult> {
    const normalized = normalizeOptions(options);
    const staleBefore = new Date(Date.now() - normalized.staleAfterMinutes * 60_000);
    const docs = await ChatDeliveryOutbox.find({})
      .sort({ updatedAt: -1 })
      .limit(normalized.limit);

    const repairedOutboxIds: string[] = [];
    for (const doc of docs) {
      const inspection = inspectOutboxConsistency(doc as any, staleBefore);
      if (!inspection.repairable) continue;
      recomputeOutboxAggregates(doc as any);
      await doc.save();
      repairedOutboxIds.push(doc._id.toString());
    }

    const summary = await this.summarizeDocs(docs, normalized.staleAfterMinutes, staleBefore);
    chatRuntimeMetrics.observeValue('chatDelivery.consistency.repairedRecords', repairedOutboxIds.length);
    return {
      ...summary,
      repairedRecords: repairedOutboxIds.length,
      repairedOutboxIds,
    };
  }

  private async summarizeDocs(
    docs: Array<any>,
    staleThresholdMinutes: number,
    staleBefore: Date,
  ): Promise<ChatDeliveryConsistencySummary> {
    const countsByIssueKind: Partial<Record<ChatDeliveryConsistencyIssueKind, number>> = {};
    const recentIssues: ChatDeliveryConsistencyIssueSummary[] = [];
    let aggregateDriftCount = 0;
    let staleRecordCount = 0;
    let repairableCount = 0;

    for (const doc of docs) {
      const inspection = inspectOutboxConsistency(doc as any, staleBefore);
      if (!inspection.hasIssues) continue;

      if (inspection.issueKinds.includes('aggregate_drift')) {
        aggregateDriftCount += 1;
      }
      if (inspection.stale) {
        staleRecordCount += 1;
      }
      if (inspection.repairable) {
        repairableCount += 1;
      }
      for (const kind of inspection.issueKinds) {
        countsByIssueKind[kind] = (countsByIssueKind[kind] || 0) + 1;
      }

      recentIssues.push({
        outboxId: doc._id.toString(),
        messageId: doc.messageId,
        chatId: doc.chatId,
        status: doc.status,
        expectedStatus: inspection.expectedStatus,
        issueKinds: inspection.issueKinds,
        updatedAt: doc.updatedAt.toISOString(),
        repairable: inspection.repairable,
        stale: inspection.stale,
      });
    }

    chatRuntimeMetrics.observeValue('chatDelivery.consistency.issueCount', recentIssues.length);

    return {
      scannedRecords: docs.length,
      staleThresholdMinutes,
      aggregateDriftCount,
      staleRecordCount,
      repairableCount,
      countsByIssueKind,
      recentIssues,
      lastScannedAt: new Date().toISOString(),
    };
  }
}

export const chatDeliveryConsistencyService = new ChatDeliveryConsistencyService();
