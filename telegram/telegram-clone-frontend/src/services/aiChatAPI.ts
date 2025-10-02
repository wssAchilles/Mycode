import { authUtils } from './apiClient';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

// AI聊天API服务
export const aiChatAPI = {
  // 获取AI聊天记录
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

  // 清空AI聊天记录
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

  // 新建AI聊天（清空当前记录）
  async startNewAiChat() {
    try {
      return await this.clearAiMessages();
    } catch (error: any) {
      console.error('新建AI聊天失败:', error);
      throw error;
    }
  }
};

export default aiChatAPI;
