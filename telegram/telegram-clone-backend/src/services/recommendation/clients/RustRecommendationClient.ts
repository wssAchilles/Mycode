import axios, { type AxiosInstance } from 'axios';
import {
  recommendationResultPayloadSchema,
  type RecommendationQueryPayload,
  type RecommendationResultPayload,
} from '../rust/contracts';

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

export function getRustRecommendationMode(): 'off' | 'shadow' | 'primary' {
  const mode = String(process.env.RUST_RECOMMENDATION_MODE || 'off').trim().toLowerCase();
  if (mode === 'shadow' || mode === 'primary') {
    return mode;
  }
  return 'off';
}
