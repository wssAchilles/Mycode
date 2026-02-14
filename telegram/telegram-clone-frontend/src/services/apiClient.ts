import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import type {
  LoginCredentials,
  RegisterCredentials,
  AuthResponse,
  User
} from '../types/auth';
import { authStorage } from '../utils/authStorage';
import { withApiBase } from '../utils/apiUrl';

// API 基础配置
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://telegram-clone-backend-88ez.onrender.com';

// 创建 axios 实例
const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

// 请求拦截器 - 自动添加认证头
apiClient.interceptors.request.use(
  (config) => {
    const token = authStorage.getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Important: do NOT force `Content-Type: application/json` for FormData.
    // If we do, Axios will serialize FormData into `{}` and the backend will
    // receive an empty JSON body, breaking avatar/cover/media uploads.
    const isFormData =
      typeof FormData !== 'undefined' && config.data instanceof FormData;
    if (isFormData) {
      delete (config.headers as any)?.['Content-Type'];
      delete (config.headers as any)?.['content-type'];
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
        const refreshToken = authStorage.getRefreshToken();
        if (refreshToken) {
          const response = await axios.post(`${API_BASE_URL}/api/auth/refresh`, {
            refreshToken,
          });

          const { accessToken, refreshToken: newRefreshToken } = response.data.tokens;

          // 更新存储的 token
          authStorage.setTokens(accessToken, newRefreshToken);

          // 重试原始请求
          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
          return apiClient(originalRequest);
        }
      } catch (refreshError) {
        // 刷新 token 失败，清除存储并重定向到登录
        authStorage.clear();
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

// 认证 API
export const authAPI = {
  // Normalize fields that may come back as relative API paths.
  // If we store relative `/api/...` in the browser, it will be resolved against the
  // frontend origin (Vercel) and images like avatars will 404.
  normalizeUser: (user: User): User => ({
    ...user,
    avatarUrl: withApiBase(user.avatarUrl) ?? undefined,
  }),

  // 用户登录
  login: async (credentials: LoginCredentials): Promise<AuthResponse> => {
    try {
      const response = await apiClient.post<AuthResponse>('/api/auth/login', credentials);

      // 存储 token 和用户信息
      const { user, tokens } = response.data;
      const normalizedUser = authAPI.normalizeUser(user);
      authStorage.setTokens(tokens.accessToken, tokens.refreshToken);
      authStorage.setUser(normalizedUser);

      return { ...response.data, user: normalizedUser };
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
      const normalizedUser = authAPI.normalizeUser(user);
      authStorage.setTokens(tokens.accessToken, tokens.refreshToken);
      authStorage.setUser(normalizedUser);

      return { ...response.data, user: normalizedUser };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || '注册失败，请重试';
      throw new Error(errorMessage);
    }
  },

  // 获取当前用户信息
  getCurrentUser: async (): Promise<User> => {
    try {
      const response = await apiClient.get<{ user: User }>('/api/auth/me');
      const normalizedUser = authAPI.normalizeUser(response.data.user);
      // Best-effort: keep local snapshot fresh (avatars/covers updated from other surfaces).
      authStorage.setUser(normalizedUser);
      return normalizedUser;
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
      authStorage.clear();
    }
  },

  // 刷新 token
  refreshToken: async (): Promise<{ accessToken: string; refreshToken: string }> => {
    const refreshToken = authStorage.getRefreshToken();
    if (!refreshToken) {
      throw new Error('没有刷新令牌');
    }

    try {
      const response = await apiClient.post('/api/auth/refresh', { refreshToken });
      const tokens = response.data.tokens;

      authStorage.setTokens(tokens.accessToken, tokens.refreshToken);

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
    const token = authStorage.getAccessToken();
    const user = authStorage.getUser();
    return !!(token && user);
  },

  // 获取当前用户
  getCurrentUser: (): User | null => {
    return authStorage.getUser();
  },

  // 获取访问令牌
  getAccessToken: (): string | null => {
    return authStorage.getAccessToken();
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
    beforeSeq?: number,
    limit: number = 50
  ): Promise<{
    messages: any[];
    paging: {
      hasMore: boolean;
      nextBeforeSeq?: number | null;
      latestSeq?: number | null;
      limit: number;
    };
  }> => {
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (typeof beforeSeq === 'number') params.append('beforeSeq', String(beforeSeq));
      const response = await apiClient.get(`/api/messages/group/${groupId}?${params.toString()}`);
      return response.data;
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || '获取群聊消息失败';
      throw new Error(errorMessage);
    }
  },

  // 发送消息 (HTTP API)
  sendMessage: async (data: {
    receiverId?: string;
    content: string;
    type?: string;
    chatType: 'private' | 'group';
    groupId?: string;
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

  // 获取消息上下文
  getMessageContext: async (chatId: string, seq: number, limit: number = 30) => {
    const params = new URLSearchParams({
      chatId,
      seq: String(seq),
      limit: String(limit)
    });
    const response = await apiClient.get(`/api/messages/context?${params.toString()}`);
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

  // 获取群组详情（含成员列表）
  getGroupDetails: async (groupId: string) => {
    try {
      const response = await apiClient.get(`/api/groups/${groupId}`);
      return response.data;
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || '获取群组详情失败';
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
  },

  // 添加群组成员
  addMembers: async (groupId: string, userIds: string[]) => {
    try {
      const response = await apiClient.post(`/api/groups/${groupId}/members`, { userIds });
      return response.data;
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || '添加群组成员失败';
      throw new Error(errorMessage);
    }
  },

  // 移除群组成员
  removeMember: async (groupId: string, memberId: string) => {
    try {
      const response = await apiClient.delete(`/api/groups/${groupId}/members/${memberId}`);
      return response.data;
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || '移除成员失败';
      throw new Error(errorMessage);
    }
  },

  // 退出群组
  leaveGroup: async (groupId: string) => {
    try {
      const response = await apiClient.post(`/api/groups/${groupId}/leave`);
      return response.data;
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || '退出群组失败';
      throw new Error(errorMessage);
    }
  },

  // 更新群组信息
  updateGroup: async (groupId: string, data: { name?: string; description?: string; type?: 'public' | 'private'; avatarUrl?: string }) => {
    try {
      const response = await apiClient.put(`/api/groups/${groupId}`, data);
      return response.data;
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || '更新群组失败';
      throw new Error(errorMessage);
    }
  },

  // 禁言成员
  muteMember: async (groupId: string, memberId: string, durationHours?: number) => {
    try {
      const response = await apiClient.post(`/api/groups/${groupId}/members/${memberId}/mute`, {
        durationHours
      });
      return response.data;
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || '禁言成员失败';
      throw new Error(errorMessage);
    }
  },

  // 解除禁言
  unmuteMember: async (groupId: string, memberId: string) => {
    try {
      const response = await apiClient.post(`/api/groups/${groupId}/members/${memberId}/unmute`);
      return response.data;
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || '解除禁言失败';
      throw new Error(errorMessage);
    }
  },

  // 提升管理员
  promoteMember: async (groupId: string, memberId: string) => {
    try {
      const response = await apiClient.post(`/api/groups/${groupId}/members/${memberId}/promote`);
      return response.data;
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || '提升管理员失败';
      throw new Error(errorMessage);
    }
  },

  // 降级管理员
  demoteMember: async (groupId: string, memberId: string) => {
    try {
      const response = await apiClient.post(`/api/groups/${groupId}/members/${memberId}/demote`);
      return response.data;
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || '降级管理员失败';
      throw new Error(errorMessage);
    }
  },

  // 解散群组
  deleteGroup: async (groupId: string) => {
    try {
      const response = await apiClient.delete(`/api/groups/${groupId}`);
      return response.data;
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || '解散群组失败';
      throw new Error(errorMessage);
    }
  },

  // 转让群主
  transferOwnership: async (groupId: string, newOwnerId: string) => {
    try {
      const response = await apiClient.put(`/api/groups/${groupId}/transfer-ownership`, { newOwnerId });
      return response.data;
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || '转让群主失败';
      throw new Error(errorMessage);
    }
  }
};

export default apiClient;
