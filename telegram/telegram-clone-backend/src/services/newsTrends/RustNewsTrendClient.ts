import axios, { type AxiosInstance } from 'axios';
import {
  newsTrendResponsePayloadSchema,
  type NewsTrendRequestPayload,
  type NewsTrendResponsePayload,
} from './contracts';

export class RustNewsTrendClient {
  private readonly client: AxiosInstance;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, timeoutMs: number) {
    this.timeoutMs = timeoutMs;
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: timeoutMs,
    });
  }

  async getTrends(request: NewsTrendRequestPayload): Promise<NewsTrendResponsePayload> {
    const response = await this.client.post('/news/trends', request, {
      timeout: this.timeoutMs,
      headers: rustRecommendationInternalHeaders(),
    });
    const parsed = newsTrendResponsePayloadSchema.safeParse(
      normalizeRustNewsTrendPayload(response.data),
    );
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 10)
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ');
      throw new Error(`rust_news_trends_contract_violation: ${issues}`);
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

export function normalizeRustNewsTrendPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeRustNewsTrendPayload);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== null)
      .map(([key, entryValue]) => [key, normalizeRustNewsTrendPayload(entryValue)]),
  );
}

export function getDefaultRustNewsTrendBaseUrl(): string {
  return String(process.env.RUST_RECOMMENDATION_URL || 'http://recommendation:4200').trim();
}
