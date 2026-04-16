import axios, { type AxiosInstance } from 'axios';
import {
  agentRespondResponseSchema,
  type AgentRespondRequestPayload,
  type AgentRespondResponsePayload,
} from '../contracts/payloads';

export class AgentPlaneClient {
  private readonly client: AxiosInstance;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, timeoutMs: number) {
    this.timeoutMs = timeoutMs;
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: timeoutMs,
    });
  }

  async respond(payload: AgentRespondRequestPayload): Promise<AgentRespondResponsePayload> {
    const response = await this.client.post('/agent/respond', payload, {
      timeout: this.timeoutMs,
    });
    const parsed = agentRespondResponseSchema.safeParse(response.data);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 10)
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ');
      throw new Error(`agent_plane_contract_violation: ${issues}`);
    }
    return parsed.data;
  }
}

export function getDefaultAgentPlaneBaseUrl(): string {
  return String(
    process.env.ML_SERVICE_URL ||
      process.env.ML_SERVICE_BASE_URL ||
      'https://telegram-ml-services-22619257282.us-central1.run.app',
  ).trim();
}

export function getAiAgentExecutionMode(): 'agent_primary' | 'direct_only' {
  const value = String(process.env.AI_AGENT_EXECUTION_MODE || 'agent_primary')
    .trim()
    .toLowerCase();
  return value === 'direct_only' ? 'direct_only' : 'agent_primary';
}
