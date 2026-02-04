import { authUtils } from './apiClient';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://telegram-clone-backend-88ez.onrender.com';

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

// AI聊天API服务
export const aiChatAPI = {
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
    } catch (error: any) {
      console.error('获取AI会话列表失败:', error);
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
    } catch (error: any) {
      console.error('获取AI会话详情失败:', error);
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
    } catch (error: any) {
      console.error('删除AI会话失败:', error);
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
    } catch (error: any) {
      console.error('获取AI聊天记录失败:', error);
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
    } catch (error: any) {
      console.error('清空AI聊天记录失败:', error);
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
    } catch (error: any) {
      console.error('归档AI会话失败:', error);
      throw error;
    }
  }
};

export default aiChatAPI;
