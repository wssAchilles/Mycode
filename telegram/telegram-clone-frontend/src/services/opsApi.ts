import apiClient from './apiClient';

export type ChatRuntimeOpsRequestTrace = {
  at: string;
  requestId: string;
  chatTraceId?: string;
  method: string;
  route: string;
  status: number;
  durationMs: number;
};

export type ChatRuntimeOpsGauge = {
  value: number;
  max: number;
  updatedAt: number;
};

export type ChatRuntimeOpsDuration = {
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  sampleCount: number;
};

export type ChatRuntimeOpsSnapshot = {
  startedAt: string;
  updatedAt: string;
  counters: Record<string, number>;
  gauges: Record<string, ChatRuntimeOpsGauge>;
  durations: Record<string, ChatRuntimeOpsDuration>;
  requestTrail: ChatRuntimeOpsRequestTrace[];
};

const OPS_TOKEN = String(import.meta.env.VITE_OPS_TOKEN || '').trim();

function wrapOpsHeaders(headers?: Record<string, string>): Record<string, string> {
  const next: Record<string, string> = {
    ...(headers || {}),
  };
  if (OPS_TOKEN) {
    next['X-Ops-Token'] = OPS_TOKEN;
  }
  return next;
}

export const opsAPI = {
  async getChatRuntimeSnapshot(): Promise<ChatRuntimeOpsSnapshot> {
    const response = await apiClient.get('/api/ops/chat-runtime', {
      headers: wrapOpsHeaders(),
    });
    const body = response.data;
    if (body?.success === true && body?.data) {
      return body.data as ChatRuntimeOpsSnapshot;
    }
    return body as ChatRuntimeOpsSnapshot;
  },

  async resetChatRuntimeSnapshot(): Promise<{ reset: boolean; at: string }> {
    const response = await apiClient.post('/api/ops/chat-runtime/reset', null, {
      headers: wrapOpsHeaders(),
    });
    const body = response.data;
    if (body?.success === true && body?.data) {
      return body.data as { reset: boolean; at: string };
    }
    return body as { reset: boolean; at: string };
  },
};

export default opsAPI;

