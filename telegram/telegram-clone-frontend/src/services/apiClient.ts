import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import type {
  LoginCredentials,
  RegisterCredentials,
  AuthResponse,
  User
} from '../types/auth';

// API 基础配置
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://telegram-clone-backend-88ez.onrender.com';

// 创建 axios 实例
const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器 - 自动添加认证头
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器 - 处理错误和 token 刷新
apiClient.interceptors.response.use(
  (response: AxiosResponse) => {
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    // 如果是 401 错误且不是刷新 token 请求
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = localStorage.getItem('refreshToken');
        if (refreshToken) {
          const response = await axios.post(`${API_BASE_URL}/api/auth/refresh`, {
            refreshToken,
          });

          const { accessToken, refreshToken: newRefreshToken } = response.data.tokens;

          // 更新存储的 token
          localStorage.setItem('accessToken', accessToken);
          localStorage.setItem('refreshToken', newRefreshToken);

          // 重试原始请求
          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
          return apiClient(originalRequest);
        }
      } catch (refreshError) {
        // 刷新 token 失败，清除存储并重定向到登录
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

// 认证 API
export const authAPI = {
  // 用户登录
  login: async (credentials: LoginCredentials): Promise<AuthResponse> => {
    try {
      const response = await apiClient.post<AuthResponse>('/api/auth/login', credentials);

      // 存储 token 和用户信息
      const { user, tokens } = response.data;
      localStorage.setItem('accessToken', tokens.accessToken);
      localStorage.setItem('refreshToken', tokens.refreshToken);
      localStorage.setItem('user', JSON.stringify(user));

      return response.data;
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || '登录失败，请重试';
      throw new Error(errorMessage);
    }
  },

  // 用户注册
  register: async (credentials: RegisterCredentials): Promise<AuthResponse> => {
    try {
      // 验证密码确认
      if (credentials.password !== credentials.confirmPassword) {
        throw new Error('密码和确认密码不匹配');
      }

      const { confirmPassword, ...registerData } = credentials;
      const response = await apiClient.post<AuthResponse>('/api/auth/register', registerData);

      // 存储 token 和用户信息
      const { user, tokens } = response.data;
      localStorage.setItem('accessToken', tokens.accessToken);
      localStorage.setItem('refreshToken', tokens.refreshToken);
      localStorage.setItem('user', JSON.stringify(user));

      return response.data;
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || '注册失败，请重试';
      throw new Error(errorMessage);
    }
  },

  // 获取当前用户信息
  getCurrentUser: async (): Promise<User> => {
    try {
      const response = await apiClient.get<{ user: User }>('/api/auth/me');
      return response.data.user;
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || '获取用户信息失败';
      throw new Error(errorMessage);
    }
  },

  // 用户登出
  logout: async (): Promise<void> => {
    try {
      await apiClient.post('/api/auth/logout');
    } catch (error) {
      console.warn('登出请求失败，但将继续清除本地存储');
    } finally {
      // 清除本地存储
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
    }
  },

  // 刷新 token
  refreshToken: async (): Promise<{ accessToken: string; refreshToken: string }> => {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) {
      throw new Error('没有刷新令牌');
    }

    try {
      const response = await apiClient.post('/api/auth/refresh', { refreshToken });
      const tokens = response.data.tokens;

      localStorage.setItem('accessToken', tokens.accessToken);
      localStorage.setItem('refreshToken', tokens.refreshToken);

      return tokens;
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || '刷新令牌失败';
      throw new Error(errorMessage);
    }
  },
};

// 工具函数
export const authUtils = {
  // 检查是否已登录
  isAuthenticated: (): boolean => {
    const token = localStorage.getItem('accessToken');
    const user = localStorage.getItem('user');
    return !!(token && user);
  },

  // 获取当前用户
  getCurrentUser: (): User | null => {
    try {
      const userStr = localStorage.getItem('user');
      return userStr ? JSON.parse(userStr) : null;
    } catch {
      return null;
    }
  },

  // 获取访问令牌
  getAccessToken: (): string | null => {
    return localStorage.getItem('accessToken');
  },
};

// 消息 API
export const messageAPI = {
  // 获取与特定用户的聊天记录
  getConversation: async (
    receiverId: string,
    page: number = 1,
    limit: number = 50
  ): Promise<{
    messages: any[];
    pagination: {
      currentPage: number;
      totalPages: number;
      totalMessages: number;
      hasMore: boolean;
      limit: number;
    };
  }> => {
    try {
      const response = await apiClient.get(
        `/api/messages/conversation/${receiverId}?page=${page}&limit=${limit}`
      );
      return response.data;
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || '获取聊天记录失败';
      throw new Error(errorMessage);
    }
  },

  // 获取群聊消息
  getGroupMessages: async (
    groupId: string,
    page: number = 1,
    limit: number = 50
  ): Promise<{
    messages: any[];
    pagination: {
      currentPage: number;
      totalPages: number;
      totalMessages: number;
      hasMore: boolean;
      limit: number;
    };
  }> => {
    try {
      const response = await apiClient.get(
        `/api/messages/group/${groupId}?page=${page}&limit=${limit}`
      );
      return response.data;
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || '获取群聊消息失败';
      throw new Error(errorMessage);
    }
  },

  // 发送消息 (HTTP API)
  sendMessage: async (data: {
    receiverId: string;
    content: string;
    type?: string;
    isGroupChat?: boolean;
  }): Promise<any> => {
    try {
      const response = await apiClient.post('/api/messages/send', data);
      return response.data;
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || '发送消息失败';
      throw new Error(errorMessage);
    }
  },

  // 标记消息为已读
  markAsRead: async (messageIds: string[]): Promise<void> => {
    try {
      await apiClient.put('/api/messages/read', { messageIds });
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || '标记已读失败';
      throw new Error(errorMessage);
    }
  },

  // 删除消息
  deleteMessage: async (messageId: string): Promise<void> => {
    try {
      await apiClient.delete(`/api/messages/${messageId}`);
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || '删除消息失败';
      throw new Error(errorMessage);
    }
  },

  // 编辑消息
  editMessage: async (messageId: string, content: string): Promise<any> => {
    try {
      const response = await apiClient.put(`/api/messages/${messageId}`, { content });
      return response.data;
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || '编辑消息失败';
      throw new Error(errorMessage);
    }
  },

  // 获取未读消息数量
  getUnreadCount: async (): Promise<number> => {
    try {
      const response = await apiClient.get('/api/messages/unread-count');
      return response.data.unreadCount || 0;
    } catch (error: any) {
      console.warn('获取未读消息数量失败:', error);
      return 0;
    }
  },

  // 搜索消息
  searchMessages: async (keyword: string, targetId?: string, limit: number = 50) => {
    const params = new URLSearchParams({ q: keyword, limit: String(limit) });
    if (targetId) params.append('targetId', targetId);
    const response = await apiClient.get(`/api/messages/search?${params.toString()}`);
    return response.data;
  },
};

// 联系人 API
export const contactAPI = {
  // 添加联系人
  addContact: async (contactId: string, message?: string) => {
    try {
      const response = await apiClient.post('/api/contacts/add', { contactId, message });
      return response.data;
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || '添加联系人失败';
      throw new Error(errorMessage);
    }
  },

  // 获取联系人列表
  getContacts: async (status = 'accepted') => {
    try {
      const response = await apiClient.get(`/api/contacts?status=${status}`);
      return response.data;
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || '获取联系人列表失败';
      throw new Error(errorMessage);
    }
  },

  // 获取待处理请求
  getPendingRequests: async () => {
    try {
      const response = await apiClient.get('/api/contacts/pending-requests');
      return response.data;
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || '获取待处理请求失败';
      throw new Error(errorMessage);
    }
  },

  // 处理联系人请求
  handleRequest: async (requestId: string, action: 'accept' | 'reject') => {
    try {
      const response = await apiClient.put(`/api/contacts/requests/${requestId}`, { action });
      return response.data;
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || '处理请求失败';
      throw new Error(errorMessage);
    }
  },

  // 搜索用户
  searchUsers: async (query: string, limit = 20) => {
    try {
      const response = await apiClient.get(`/api/contacts/search?query=${encodeURIComponent(query)}&limit=${limit}`);
      return response.data;
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || '搜索用户失败';
      throw new Error(errorMessage);
    }
  }
};

// 群组 API
export const groupAPI = {
  // 创建群组
  createGroup: async (data: {
    name: string;
    description?: string;
    type?: 'public' | 'private';
    maxMembers?: number;
  }) => {
    try {
      const response = await apiClient.post('/api/groups', data);
      return response.data;
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || '创建群组失败';
      throw new Error(errorMessage);
    }
  },

  // 获取用户群组
  getUserGroups: async () => {
    try {
      const response = await apiClient.get('/api/groups/my');
      return response.data;
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || '获取群组列表失败';
      throw new Error(errorMessage);
    }
  },

  // 搜索群组
  searchGroups: async (query: string, limit = 20) => {
    try {
      const response = await apiClient.get(`/api/groups/search?query=${encodeURIComponent(query)}&limit=${limit}`);
      return response.data;
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || '搜索群组失败';
      throw new Error(errorMessage);
    }
  }
};

export default apiClient;
