import { authUtils } from './apiClient';
import { API_BASE_URL } from '../utils/apiUrl';

// AI 会话类型
export interface AiConversation {
  conversationId: string;
  title: string;
  updatedAt: string;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
    type: 'text' | 'image';
  }>;
}

export interface AiChatRequestPayload {
  message: string;
  conversationId?: string | null;
  conversationHistory?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  imageData?: {
    mimeType: string;
    base64Data: string;
  };
}

export interface AiChatResponsePayload {
  message: string;
  timestamp: string;
  conversationId?: string;
  agent?: {
    mode: string;
    fallback: boolean;
    usedScopes: string[];
    suggestions: string[];
  };
}

// AI聊天API服务
export const aiChatAPI = {
  // 直接调用 AI agent plane HTTP 接口，避免依赖旧的实时消息回退链
  async sendChatMessage(payload: AiChatRequestPayload): Promise<AiChatResponsePayload> {
    try {
      const token = authUtils.getAccessToken();
      if (!token) throw new Error('用户未认证');

      const response = await fetch(`${API_BASE_URL}/api/ai/chat`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || data.message || 'AI 回复失败');
      }

      return data.data;
    } catch (error: unknown) {
      console.error('AI 聊天请求失败:', error instanceof Error ? error.message : error);
      throw error;
    }
  },

  /**
   * SSE 流式调用 AI 接口：实时推送 delta 片段，404 时优雅回退到普通 POST 接口
   */
  async streamChatMessage(
    payload: AiChatRequestPayload,
    callbacks: {
      onStart?: () => void;
      onDelta: (delta: string) => void;
      onDone?: (result: AiChatResponsePayload) => void;
      signal?: AbortSignal;
    },
  ): Promise<AiChatResponsePayload> {
    const token = authUtils.getAccessToken();
    if (!token) throw new Error('用户未认证');

    const response = await fetch(`${API_BASE_URL}/api/ai/chat/stream`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(payload),
      signal: callbacks.signal,
    });

    if (response.status === 404) {
      const fallback = await this.sendChatMessage(payload);
      if (fallback.message) {
        callbacks.onDelta(fallback.message);
      }
      callbacks.onDone?.(fallback);
      return fallback;
    }

    if (!response.ok || !response.body) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || errorData.message || 'AI 流式回复失败');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let accumulated = '';
    let finalResult: AiChatResponsePayload | null = null;

    const processEventBlock = (block: string) => {
      const lines = block.split(/\r?\n/);
      let eventName = 'message';
      const dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trim());
        }
      }
      if (dataLines.length === 0) return;
      const rawData = dataLines.join('\n');
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(rawData) as Record<string, unknown>;
      } catch {
        return;
      }

      if (eventName === 'start') {
        callbacks.onStart?.();
      } else if (eventName === 'delta') {
        const delta = typeof parsed.delta === 'string' ? parsed.delta : '';
        if (delta) {
          accumulated += delta;
          callbacks.onDelta(delta);
        }
      } else if (eventName === 'done') {
        finalResult = {
          message: typeof parsed.message === 'string' ? parsed.message : accumulated,
          timestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : new Date().toISOString(),
          conversationId: typeof parsed.conversationId === 'string' ? parsed.conversationId : undefined,
          agent: parsed.agent as AiChatResponsePayload['agent'],
        };
        callbacks.onDone?.(finalResult);
      } else if (eventName === 'error') {
        const errMsg = typeof parsed.error === 'string' ? parsed.error : 'AI 生成失败';
        throw new Error(errMsg);
      }
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sepIdx = buffer.indexOf('\n\n');
        while (sepIdx !== -1) {
          const block = buffer.slice(0, sepIdx).trim();
          buffer = buffer.slice(sepIdx + 2);
          if (block) processEventBlock(block);
          sepIdx = buffer.indexOf('\n\n');
        }
      }
      const trailing = buffer.trim();
      if (trailing) {
        processEventBlock(trailing);
      }
    } finally {
      reader.releaseLock();
    }

    if (finalResult) return finalResult;
    return {
      message: accumulated,
      timestamp: new Date().toISOString(),
      conversationId: payload.conversationId ?? undefined,
    };
  },

  // 获取AI会话列表
  async getConversations(): Promise<AiConversation[]> {
    try {
      const token = authUtils.getAccessToken();
      if (!token) throw new Error('用户未认证');

      const response = await fetch(`${API_BASE_URL}/api/ai-chat/conversations`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '获取会话列表失败');
      }

      const data = await response.json();
      return data.data || [];
    } catch (error: unknown) {
      console.error('获取AI会话列表失败:', error instanceof Error ? error.message : error);
      throw error;
    }
  },

  // 获取单个会话详情
  async getConversation(conversationId: string): Promise<AiConversation | null> {
    try {
      const token = authUtils.getAccessToken();
      if (!token) throw new Error('用户未认证');

      const response = await fetch(`${API_BASE_URL}/api/ai-chat/conversations/${conversationId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) return null;
        const errorData = await response.json();
        throw new Error(errorData.message || '获取会话详情失败');
      }

      const data = await response.json();
      return data.data || null;
    } catch (error: unknown) {
      console.error('获取AI会话详情失败:', error instanceof Error ? error.message : error);
      throw error;
    }
  },

  // 删除会话
  async deleteConversation(conversationId: string): Promise<void> {
    try {
      const token = authUtils.getAccessToken();
      if (!token) throw new Error('用户未认证');

      const response = await fetch(`${API_BASE_URL}/api/ai-chat/conversations/${conversationId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '删除会话失败');
      }
    } catch (error: unknown) {
      console.error('删除AI会话失败:', error instanceof Error ? error.message : error);
      throw error;
    }
  },

  // 获取AI聊天记录（旧版兼容）
  async getAiMessages(page: number = 1, limit: number = 50) {
    try {
      const token = authUtils.getAccessToken();
      if (!token) {
        throw new Error('用户未认证');
      }

      const response = await fetch(`${API_BASE_URL}/api/ai-chat/messages?page=${page}&limit=${limit}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '获取AI聊天记录失败');
      }

      const data = await response.json();
      return data;
    } catch (error: unknown) {
      console.error('获取AI聊天记录失败:', error instanceof Error ? error.message : error);
      throw error;
    }
  },

  // 清空AI聊天记录（旧版兼容）
  async clearAiMessages() {
    try {
      const token = authUtils.getAccessToken();
      if (!token) {
        throw new Error('用户未认证');
      }

      const response = await fetch(`${API_BASE_URL}/api/ai-chat/messages`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '清空AI聊天记录失败');
      }

      const data = await response.json();
      return data;
    } catch (error: unknown) {
      console.error('清空AI聊天记录失败:', error instanceof Error ? error.message : error);
      throw error;
    }
  },

  // 新建AI聊天（创建新会话）
  async startNewAiChat() {
    // 新建聊天不再删除旧记录，只是返回空会话标识
    return { success: true, conversationId: null };
  },

  // 归档当前会话并生成标题
  async archiveConversation(messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp?: string; type?: 'text' | 'image'; imageData?: { mimeType: string; fileName: string; fileSize: number } }>) {
    try {
      const token = authUtils.getAccessToken();
      if (!token) throw new Error('用户未认证');

      const response = await fetch(`${API_BASE_URL}/api/ai-chat/conversations/archive`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messages }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || '归档会话失败');
      }

      const data = await response.json();
      return data.data;
    } catch (error: unknown) {
      console.error('归档AI会话失败:', error instanceof Error ? error.message : error);
      throw error;
    }
  }
};

export default aiChatAPI;
