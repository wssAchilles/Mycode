import axios, { type AxiosInstance } from 'axios';
import {
  recommendationResultPayloadSchema,
  type RecommendationQueryPayload,
  type RecommendationResultPayload,
} from '../rust/contracts';

export const DEFAULT_RUST_RECOMMENDATION_TIMEOUT_MS = 9000;

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

  async getCandidates(query: RecommendationQueryPayload): Promise<RecommendationResultPayload> {
    const response = await this.client.post('/recommendation/candidates', query, {
      timeout: this.timeoutMs,
      headers: rustRecommendationInternalHeaders(),
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

export function normalizeRustRecommendationPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeRustRecommendationPayload);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== null)
      .map(([key, entryValue]) => [key, normalizeRustRecommendationPayload(entryValue)]),
  );
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
