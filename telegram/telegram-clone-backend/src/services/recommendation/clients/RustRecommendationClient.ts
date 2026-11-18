import axios, { type AxiosInstance } from 'axios';
import {
  recommendationResultPayloadSchema,
  type RecommendationQueryPayload,
  type RecommendationResultPayload,
} from '../rust/contracts';

export const DEFAULT_RUST_RECOMMENDATION_TIMEOUT_MS = 9000;

export interface RustRecommendationRequestOptions {
  /** 可选外部中止信号，上游超时或取消时级联中断请求 */
  signal?: AbortSignal;
  /** 可选单次调用超时覆盖（毫秒） */
  timeoutMs?: number;
}

// Rust 返回对象中必填的数值字段集合，遇到 null/NaN 时兜底为 0 而非删除成 undefined
const REQUIRED_FINITE_NUMBER_KEYS = new Set<string>([
  'averageScore',
  'scoreStddev',
  'uniqueAuthorRatio',
  'sourceEntropy',
  'laneEntropy',
  'poolEntropy',
  'negativePressureAverage',
  'authorDiversity',
  'replyRatio',
  'durationMs',
  'click',
  'like',
  'reply',
  'repost',
  'dwell',
  'negative',
]);

export class RustRecommendationClient {
  private readonly client: AxiosInstance;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, timeoutMs: number) {
    this.timeoutMs = timeoutMs;
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: timeoutMs,
    });
  }

  async getCandidates(
    query: RecommendationQueryPayload,
    options?: RustRecommendationRequestOptions,
  ): Promise<RecommendationResultPayload> {
    const effectiveTimeoutMs =
      options?.timeoutMs && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? Math.round(options.timeoutMs)
        : this.timeoutMs;
    const deadlineEpochMs = Date.now() + effectiveTimeoutMs;

    const response = await this.client.post('/recommendation/candidates', query, {
      timeout: effectiveTimeoutMs,
      signal: options?.signal,
      headers: {
        ...rustRecommendationInternalHeaders(),
        'x-recommendation-deadline-ms': String(deadlineEpochMs),
      },
    });
    const parsed = recommendationResultPayloadSchema.safeParse(
      normalizeRustRecommendationPayload(response.data),
    );
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 10)
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ');
      throw new Error(`rust_recommendation_contract_violation: ${issues}`);
    }
    if (
      parsed.data.requestId !== query.requestId
      || parsed.data.summary.requestId !== query.requestId
      || (
        parsed.data.summary.trace !== undefined
        && parsed.data.summary.trace.requestId !== query.requestId
      )
    ) {
      throw new Error('rust_recommendation_contract_violation: request_id_mismatch');
    }
    return parsed.data;
  }
}

function rustRecommendationInternalHeaders(): Record<string, string> {
  const token = String(process.env.RECOMMENDATION_INTERNAL_TOKEN || '').trim();
  if (!token) {
    return {};
  }
  return {
    authorization: `Bearer ${token}`,
    'x-recommendation-internal-token': token,
  };
}

export function normalizeRustRecommendationPayload(
  value: unknown,
  parentKey?: string,
): unknown {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (Array.isArray(value)) {
    // 语义 ID 数组固定 6 位，异常元素回退为 -1 以维持定长契约
    if (parentKey === 'semanticIds') {
      return value.map((item) =>
        typeof item === 'number' && Number.isFinite(item)
          ? Math.max(-1, Math.min(255, Math.trunc(item)))
          : -1,
      );
    }
    return value
      .filter((item) => item !== null && item !== undefined && !(typeof item === 'number' && !Number.isFinite(item)))
      .map((item) => normalizeRustRecommendationPayload(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const entries: Array<[string, unknown]> = [];
  for (const [key, entryValue] of Object.entries(value)) {
    if (entryValue === null || (typeof entryValue === 'number' && !Number.isFinite(entryValue))) {
      if (REQUIRED_FINITE_NUMBER_KEYS.has(key)) {
        entries.push([key, 0]);
      }
      continue;
    }
    entries.push([key, normalizeRustRecommendationPayload(entryValue, key)]);
  }
  return Object.fromEntries(entries);
}

export function getDefaultRustRecommendationBaseUrl(): string {
  return String(process.env.RUST_RECOMMENDATION_URL || 'http://recommendation:4200').trim();
}

export function getRustRecommendationTimeoutMs(): number {
  const parsed = Number.parseInt(
    String(process.env.RUST_RECOMMENDATION_TIMEOUT_MS || DEFAULT_RUST_RECOMMENDATION_TIMEOUT_MS),
    10,
  );
  return parsed > 0 ? parsed : DEFAULT_RUST_RECOMMENDATION_TIMEOUT_MS;
}

export function getRustRecommendationMode(): 'off' | 'shadow' | 'primary' {
  const mode = String(process.env.RUST_RECOMMENDATION_MODE || 'off').trim().toLowerCase();
  if (mode === 'shadow' || mode === 'primary') {
    return mode;
  }
  return 'off';
}
