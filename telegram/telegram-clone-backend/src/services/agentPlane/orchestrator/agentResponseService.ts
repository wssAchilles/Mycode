import {
  AgentPlaneClient,
  getAiAgentExecutionMode,
  getDefaultAgentPlaneBaseUrl,
} from '../client/agentPlaneClient';
import {
  callDirectGeminiAI,
  type DirectGeminiHistoryItem,
  type DirectGeminiImagePayload,
} from '../client/directGeminiClient';
import { buildAgentContextSnapshot } from '../context/contextSnapshotService';
import { resolveAgentContextScopes } from '../context/scopeResolver';

const agentPlaneClient = new AgentPlaneClient(getDefaultAgentPlaneBaseUrl(), 12000);

export interface UserAgentReplyRequest {
  userId: string;
  message: string;
  imageData?: DirectGeminiImagePayload;
  conversationHistory?: DirectGeminiHistoryItem[];
  conversationId?: string;
}

export interface UserAgentReplyResult {
  message: string;
  usedScopes: Array<'feed' | 'notifications' | 'news'>;
  model: string;
  mode: 'agent_primary' | 'direct_only' | 'direct_fallback';
  fallback: boolean;
  suggestions: string[];
}

function buildDirectFallbackSystemInstruction(): string {
  return [
    '你是一名中文 AI 助手。',
    '回答要简洁、具体、实用。',
    '如果缺少用户个性化上下文，就明确说明你当前只能基于通用知识回答。',
  ].join(' ');
}

export async function generateUserAgentReply(
  request: UserAgentReplyRequest,
): Promise<UserAgentReplyResult> {
  if (getAiAgentExecutionMode() === 'direct_only') {
    const fallback = await callDirectGeminiAI({
      message: request.message,
      imageData: request.imageData,
      conversationHistory: request.conversationHistory,
      systemInstruction: buildDirectFallbackSystemInstruction(),
    });

    return {
      message: fallback.message,
      usedScopes: [],
      model: fallback.model,
      mode: 'direct_only',
      fallback: true,
      suggestions: [],
    };
  }

  const requestedScopes = resolveAgentContextScopes(request.message);
  const contextSnapshot = await buildAgentContextSnapshot({
    userId: request.userId,
    requestedScopes,
  });

  try {
    const response = await agentPlaneClient.respond({
      userId: request.userId,
      message: request.message,
      imageData: request.imageData,
      conversationHistory: request.conversationHistory,
      conversationId: request.conversationId,
      contextSnapshot,
    });

    return {
      message: response.data.message,
      usedScopes: response.data.usedScopes,
      model: response.data.model,
      mode: 'agent_primary',
      fallback: response.data.fallback,
      suggestions: response.data.suggestions,
    };
  } catch (error) {
    console.warn('[AgentPlane] Falling back to direct Gemini:', error);
    const fallback = await callDirectGeminiAI({
      message: request.message,
      imageData: request.imageData,
      conversationHistory: request.conversationHistory,
      systemInstruction: buildDirectFallbackSystemInstruction(),
    });

    return {
      message: fallback.message,
      usedScopes: requestedScopes,
      model: fallback.model,
      mode: 'direct_fallback',
      fallback: true,
      suggestions: [],
    };
  }
}
