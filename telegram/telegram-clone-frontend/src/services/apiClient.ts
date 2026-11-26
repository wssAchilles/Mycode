import axios, { type AxiosInstance, type AxiosResponse, type AxiosError } from 'axios';
import type {
  LoginCredentials,
  RegisterCredentials,
  AuthResponse,
  User
} from '../types/auth';
import { authStorage } from '../utils/authStorage';
import { API_BASE_URL, withApiBase } from '../utils/apiUrl';

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const axiosErr = error as AxiosError<{
      message?: string;
      error?: string | { message?: string; code?: string };
    }>;
    const data = axiosErr.response?.data;
    const nestedError = data?.error;
    return (
      data?.message ||
      (typeof nestedError === 'string' ? nestedError : nestedError?.message) ||
      fallback
    );
  }
  if (error instanceof Error) return error.message;
  return fallback;
}
const LEGACY_MESSAGE_PATH_RE = /^\/api\/messages\/(conversation|group)\//i;

function isLegacyMessageEndpoint(url?: string): boolean {
  if (!url) return false;
  try {
    const path = new URL(url, API_BASE_URL).pathname;
    return LEGACY_MESSAGE_PATH_RE.test(path);
  } catch {
    return LEGACY_MESSAGE_PATH_RE.test(url);
  }
}

// 创建 axios 实例
const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
});

// 全局 Single-Flight Token 刷新并发锁，防止并发 401 触发 Refresh Storm 互踢登出
let refreshTokenPromise: Promise<string> | null = null;
// 共享完整刷新结果 Promise，供响应拦截器与 authAPI.refreshToken 复用
let refreshTokenResultPromise: Promise<{ accessToken: string; refreshToken: string }> | null = null;

function dispatchAuthTokensUpdated(accessToken: string, refreshToken: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('auth:tokens-updated', {
      detail: { accessToken, refreshToken },
    })
  );
}

function getRequestAuthHeader(headers: unknown): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  const record = headers as Record<string, unknown> & { get?: (name: string) => unknown };
  if (typeof record.get === 'function') {
    const val = record.get('Authorization');
    if (typeof val === 'string') return val;
  }
  if (typeof record.Authorization === 'string') return record.Authorization;
  if (typeof record.authorization === 'string') return record.authorization;
  return undefined;
}

function requestTokensSingleFlight(): Promise<{ accessToken: string; refreshToken: string }> {
  if (refreshTokenResultPromise) {
    return refreshTokenResultPromise;
  }

  const refreshToken = authStorage.getRefreshToken();
  if (!refreshToken) {
    return Promise.reject(new Error('没有刷新令牌'));
  }

  // 使用原生 axios.post，避免刷新请求自身返回 401 时再次进入拦截器
  refreshTokenResultPromise = axios
    .post<{ success: boolean; data: { tokens: { accessToken: string; refreshToken: string } } }>(
      `${API_BASE_URL}/api/auth/refresh`,
      { refreshToken }
    )
    .then((response) => {
      // 后端返回 { success: true, data: { tokens } }
      const { accessToken, refreshToken: newRefreshToken } = response.data.data.tokens;
      authStorage.setTokens(accessToken, newRefreshToken);
      dispatchAuthTokensUpdated(accessToken, newRefreshToken);
      return { accessToken, refreshToken: newRefreshToken };
    })
    .finally(() => {
      refreshTokenResultPromise = null;
    });

  return refreshTokenResultPromise;
}

/**
 * 全局单飞刷新访问令牌，供 Socket 鉴权失效恢复与请求拦截器复用
 */
export function refreshAccessTokenSingleFlight(): Promise<{ accessToken: string; refreshToken: string }> {
  return requestTokensSingleFlight();
}

// 请求拦截器 - 自动添加认证头
apiClient.interceptors.request.use(
  (config) => {
    if (isLegacyMessageEndpoint(config.url)) {
      throw new Error('LEGACY_MESSAGE_ENDPOINT_BLOCKED: use /api/messages/chat/:chatId cursor API');
    }

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
      delete config.headers?.['Content-Type'];
      delete config.headers?.['content-type'];
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
  async (error: unknown) => {
    const axiosError = error as AxiosError;
    const originalRequest = axiosError.config;
    const retryableRequest = originalRequest as (typeof originalRequest & { _retry?: boolean }) | undefined;
    const isRefreshRequest = Boolean(originalRequest?.url && originalRequest.url.includes('/api/auth/refresh'));

    // 如果是 401 错误且不是刷新 token 请求
    if (axiosError.response?.status === 401 && retryableRequest && !retryableRequest._retry && !isRefreshRequest) {
      retryableRequest._retry = true;

      // 若并发请求发送时的旧 token 已被刚刚完成的刷新替换，直接复用新 token 重试
      const latestAccessToken = authStorage.getAccessToken();
      const requestAuthHeader = getRequestAuthHeader(retryableRequest.headers);
      if (
        !refreshTokenPromise &&
        latestAccessToken &&
        requestAuthHeader &&
        requestAuthHeader.startsWith('Bearer ') &&
        requestAuthHeader !== `Bearer ${latestAccessToken}`
      ) {
        retryableRequest.headers = retryableRequest.headers ?? ({} as typeof retryableRequest.headers);
        retryableRequest.headers.Authorization = `Bearer ${latestAccessToken}`;
        return apiClient(retryableRequest);
      }

      if (!refreshTokenPromise) {
        const refreshToken = authStorage.getRefreshToken();
        if (!refreshToken) {
          return Promise.reject(error);
        }

        // 所有并发 401 共用同一个 refreshTokenPromise，仅在确认刷新失败后统一清理并跳转
        refreshTokenPromise = requestTokensSingleFlight()
          .then((tokens) => tokens.accessToken)
          .catch((refreshError) => {
            authStorage.clear();
            if (typeof window !== 'undefined') {
              window.location.href = '/login';
            }
            return Promise.reject(refreshError);
          })
          .finally(() => {
            refreshTokenPromise = null;
          });
      }

      try {
        const nextAccessToken = await refreshTokenPromise;
        retryableRequest.headers = retryableRequest.headers ?? ({} as typeof retryableRequest.headers);
        retryableRequest.headers.Authorization = `Bearer ${nextAccessToken}`;
        return apiClient(retryableRequest);
      } catch (refreshError) {
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
      const response = await apiClient.post<{ success: boolean; data: AuthResponse }>('/api/auth/login', credentials);

      // 后端返回 { success: true, data: { message, user, tokens } }
      const { user, tokens } = response.data.data;
      const normalizedUser = authAPI.normalizeUser(user);
      authStorage.setSession(normalizedUser, tokens.accessToken, tokens.refreshToken);

      return { ...response.data.data, user: normalizedUser };
    } catch (error: unknown) {
      const errorMessage = (error as AxiosError<{ message?: string }>)?.response?.data?.message || '登录失败，请重试';
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

      const registerData: Partial<RegisterCredentials> = { ...credentials };
      delete registerData.confirmPassword;
      const response = await apiClient.post<{ success: boolean; data: AuthResponse }>('/api/auth/register', registerData);

      // 后端返回 { success: true, data: { message, user, tokens } }
      const { user, tokens } = response.data.data;
      const normalizedUser = authAPI.normalizeUser(user);
      authStorage.setSession(normalizedUser, tokens.accessToken, tokens.refreshToken);

      return { ...response.data.data, user: normalizedUser };
    } catch (error: unknown) {
      const errorMessage = (error as AxiosError<{ message?: string }>)?.response?.data?.message || '注册失败，请重试';
      throw new Error(errorMessage);
    }
  },

  // 获取当前用户信息
  getCurrentUser: async (): Promise<User> => {
    try {
      const response = await apiClient.get<{ success: boolean; data: { user: User } }>('/api/auth/me');
      // 后端返回 { success: true, data: { user } }
      const normalizedUser = authAPI.normalizeUser(response.data.data.user);
      // Best-effort: keep local snapshot fresh (avatars/covers updated from other surfaces).
      authStorage.setUser(normalizedUser);
      return normalizedUser;
    } catch (error: unknown) {
      const errorMessage = (error as AxiosError<{ message?: string }>)?.response?.data?.message || '获取用户信息失败';
      throw new Error(errorMessage);
    }
  },

  // 用户登出
  logout: async (): Promise<void> => {
    try {
      await apiClient.post('/api/auth/logout');
    } catch {
      console.warn('登出请求失败，但将继续清除本地存储');
    } finally {
      // 清除本地存储
      authStorage.clear();
    }
  },

  // 更新用户资料 (demographics + 冷启动兴趣)
  updateProfile: async (data: {
    birthDate?: string;
    region?: string;
    language?: string;
    interests?: string[];
  }): Promise<User> => {
    try {
      const response = await apiClient.put<{ success?: boolean; data?: { user: User }; user?: User }>('/api/users/profile', data);
      const rawUser = response.data.data?.user || response.data.user;
      if (rawUser) {
        const normalizedUser = authAPI.normalizeUser(rawUser);
        authStorage.setUser(normalizedUser);
        return normalizedUser;
      }
      const existing = authStorage.getUser();
      if (existing) return existing;
      throw new Error('更新资料响应缺少用户信息');
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, '更新资料失败'));
    }
  },

  // 刷新 token
  refreshToken: async (): Promise<{ accessToken: string; refreshToken: string }> => {
    const refreshToken = authStorage.getRefreshToken();
    if (!refreshToken) {
      throw new Error('没有刷新令牌');
    }

    try {
      return await requestTokensSingleFlight();
    } catch (error: unknown) {
      const errorMessage = (error as AxiosError<{ message?: string }>)?.response?.data?.message || '刷新令牌失败';
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
  // 获取聊天消息（统一 cursor API）
  getChatMessages: async (
    chatId: string,
    opts?: { beforeSeq?: number; afterSeq?: number; limit?: number },
  ): Promise<{
    messages: Record<string, unknown>[];
    paging: {
      hasMore: boolean;
      nextBeforeSeq?: number | null;
      latestSeq?: number | null;
      limit: number;
    };
  }> => {
    try {
      const params = new URLSearchParams({ limit: String(opts?.limit ?? 50) });
      if (typeof opts?.beforeSeq === 'number') params.append('beforeSeq', String(opts.beforeSeq));
      if (typeof opts?.afterSeq === 'number') params.append('afterSeq', String(opts.afterSeq));
      const response = await apiClient.get(`/api/messages/chat/${encodeURIComponent(chatId)}?${params.toString()}`);
      return response.data;
    } catch (error: unknown) {
      const errorMessage = (error as AxiosError<{ message?: string }>)?.response?.data?.message || '获取聊天消息失败';
      throw new Error(errorMessage);
    }
  },

  // 发送消息 (HTTP API)
  sendMessage: async (data: {
    clientTempId?: string;
    receiverId?: string;
    content: string;
    type?: string;
    chatType: 'private' | 'group';
    groupId?: string;
    replyTo?: string;
    fileUrl?: string;
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
    thumbnailUrl?: string;
  }): Promise<Record<string, unknown>> => {
    try {
      const response = await apiClient.post('/api/messages/send', data);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, '发送消息失败'));
    }
  },

  // 标记消息为已读
  markAsRead: async (messageIds: string[]): Promise<void> => {
    try {
      await apiClient.put('/api/messages/read', { messageIds });
    } catch (error: unknown) {
      const errorMessage = (error as AxiosError<{ message?: string }>)?.response?.data?.message || '标记已读失败';
      throw new Error(errorMessage);
    }
  },

  // 按聊天 seq 标记已读。使用 keepalive 覆盖用户读完后立即刷新/关闭页面的场景。
  markChatRead: async (chatId: string, seq: number): Promise<void> => {
    if (!chatId || typeof seq !== 'number' || seq <= 0) return;

    const token = authStorage.getAccessToken();
    const res = await fetch(`${API_BASE_URL}/api/messages/chat/${encodeURIComponent(chatId)}/read`, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ seq: Math.max(1, Math.floor(seq)) }),
    });

    if (!res.ok) {
      let message = '标记聊天已读失败';
      try {
        const json = await res.json();
        message = json?.message || json?.error?.message || json?.error || message;
      } catch {
        // ignore malformed error bodies
      }
      throw new Error(message);
    }
  },

  // 删除消息
  deleteMessage: async (messageId: string): Promise<void> => {
    try {
      await apiClient.delete(`/api/messages/${messageId}`);
    } catch (error: unknown) {
      const errorMessage = (error as AxiosError<{ message?: string }>)?.response?.data?.message || '删除消息失败';
      throw new Error(errorMessage);
    }
  },

  // 编辑消息
  editMessage: async (messageId: string, content: string): Promise<Record<string, unknown>> => {
    try {
      const response = await apiClient.put(`/api/messages/${messageId}`, { content });
      return response.data;
    } catch (error: unknown) {
      const errorMessage = (error as AxiosError<{ message?: string }>)?.response?.data?.message || '编辑消息失败';
      throw new Error(errorMessage);
    }
  },

  // 切换消息表情回应
  toggleReaction: async (
    messageId: string,
    emoji: string,
  ): Promise<{ messageId: string; reactions: Array<{ emoji: string; userIds: string[] }> }> => {
    try {
      const response = await apiClient.post<{
        success?: boolean;
        data?: { messageId: string; reactions: Array<{ emoji: string; userIds: string[] }> };
        messageId?: string;
        reactions?: Array<{ emoji: string; userIds: string[] }>;
      }>(`/api/messages/${messageId}/reactions`, { emoji });
      const data = response.data.data || response.data;
      return {
        messageId: data.messageId || messageId,
        reactions: Array.isArray(data.reactions) ? data.reactions : [],
      };
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, '表情回应失败'));
    }
  },

  // 获取未读消息数量
  getUnreadCount: async (): Promise<number> => {
    try {
      const response = await apiClient.get('/api/messages/unread-count');
      // 后端返回 { success: true, data: { unreadCount } }
      return response.data.data?.unreadCount || 0;
    } catch (error: unknown) {
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
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, '添加联系人失败'));
    }
  },

  // 获取联系人列表
  getContacts: async (status = 'accepted') => {
    try {
      const response = await apiClient.get(`/api/contacts?status=${status}`);
      // 后端返回 { success: true, data: [...] }
      return { contacts: response.data.data };
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, '获取联系人列表失败'));
    }
  },

  // 获取待处理请求
  getPendingRequests: async () => {
    try {
      const response = await apiClient.get('/api/contacts/pending-requests');
      const payload = response.data;
      const list = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.pendingRequests)
          ? payload.pendingRequests
          : Array.isArray(payload?.requests)
            ? payload.requests
            : [];
      return {
        ...payload,
        pendingRequests: list,
        data: list,
      };
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, '获取待处理请求失败'));
    }
  },

  // 处理联系人请求
  handleRequest: async (requestId: string, action: 'accept' | 'reject') => {
    try {
      const response = await apiClient.put(`/api/contacts/requests/${requestId}`, { action });
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, '处理请求失败'));
    }
  },

  // 搜索用户
  searchUsers: async (query: string, limit = 20) => {
    try {
      const response = await apiClient.get(`/api/contacts/search?query=${encodeURIComponent(query)}&limit=${limit}`);
      return {
        users: response.data.data ?? response.data.users ?? [],
        meta: response.data.meta,
      };
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error, '搜索用户失败');
      throw new Error(errorMessage);
    }
  },

  // 更新联系人备注名
  updateAlias: async (contactId: string, alias: string): Promise<void> => {
    try {
      await apiClient.put(`/api/contacts/${contactId}/alias`, { alias });
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, '修改备注失败'));
    }
  },

  // 删除联系人
  removeContact: async (contactId: string): Promise<void> => {
    try {
      await apiClient.delete(`/api/contacts/${contactId}`);
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, '删除联系人失败'));
    }
  },

  // 屏蔽联系人
  blockContact: async (contactId: string): Promise<void> => {
    try {
      await apiClient.post(`/api/contacts/${contactId}/block`);
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, '屏蔽联系人失败'));
    }
  },
};

// 群组 API
export const groupAPI = {
  // 上传群组头像（返回可持久化到群组的 URL）
  uploadGroupAvatar: async (file: File): Promise<string> => {
    try {
      const formData = new FormData();
      formData.append('avatar', file);
      const response = await apiClient.post('/api/groups/avatar', formData);
      const avatarUrl = response.data?.data?.avatarUrl || response.data?.avatarUrl;
      if (typeof avatarUrl !== 'string' || !avatarUrl.trim()) {
        throw new Error('群组头像上传未返回有效地址');
      }
      return avatarUrl.trim();
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, '上传群组头像失败'));
    }
  },

  // 创建群组
  createGroup: async (data: {
    name: string;
    description?: string;
    type?: 'public' | 'private';
    maxMembers?: number;
    avatarUrl?: string | null;
  }) => {
    try {
      const response = await apiClient.post('/api/groups', data);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, '创建群组失败'));
    }
  },

  // 获取用户群组
  getUserGroups: async () => {
    try {
      const response = await apiClient.get('/api/groups/my');
      // 后端返回 { success: true, data: [...], meta: {...} }
      return { groups: response.data.data, meta: response.data.meta };
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, '获取群组列表失败'));
    }
  },

  // 获取群组详情（含成员列表）
  getGroupDetails: async (groupId: string) => {
    try {
      const response = await apiClient.get(`/api/groups/${groupId}`);
      return response.data.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, '获取群组详情失败'));
    }
  },

  // 搜索群组
  searchGroups: async (query: string, limit = 20) => {
    try {
      const response = await apiClient.get(`/api/groups/search?query=${encodeURIComponent(query)}&limit=${limit}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, '搜索群组失败'));
    }
  },

  // 添加群组成员
  addMembers: async (groupId: string, userIds: string[]) => {
    try {
      const response = await apiClient.post(`/api/groups/${groupId}/members`, { userIds });
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, '添加群组成员失败'));
    }
  },

  // 移除群组成员
  removeMember: async (groupId: string, memberId: string) => {
    try {
      const response = await apiClient.delete(`/api/groups/${groupId}/members/${memberId}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, '移除成员失败'));
    }
  },

  // 退出群组
  leaveGroup: async (groupId: string) => {
    try {
      const response = await apiClient.post(`/api/groups/${groupId}/leave`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, '退出群组失败'));
    }
  },

  // 更新群组信息
  updateGroup: async (
    groupId: string,
    data: {
      name?: string;
      description?: string;
      type?: 'public' | 'private';
      maxMembers?: number;
      avatarUrl?: string | null;
    }
  ) => {
    try {
      const response = await apiClient.put(`/api/groups/${groupId}`, data);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, '更新群组失败'));
    }
  },

  // 禁言成员
  muteMember: async (groupId: string, memberId: string, durationHours?: number) => {
    try {
      const response = await apiClient.post(`/api/groups/${groupId}/members/${memberId}/mute`, {
        durationHours
      });
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, '禁言成员失败'));
    }
  },

  // 解除禁言
  unmuteMember: async (groupId: string, memberId: string) => {
    try {
      const response = await apiClient.post(`/api/groups/${groupId}/members/${memberId}/unmute`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, '解除禁言失败'));
    }
  },

  // 提升管理员
  promoteMember: async (groupId: string, memberId: string) => {
    try {
      const response = await apiClient.post(`/api/groups/${groupId}/members/${memberId}/promote`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, '提升管理员失败'));
    }
  },

  // 降级管理员
  demoteMember: async (groupId: string, memberId: string) => {
    try {
      const response = await apiClient.post(`/api/groups/${groupId}/members/${memberId}/demote`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, '降级管理员失败'));
    }
  },

  // 解散群组
  deleteGroup: async (groupId: string) => {
    try {
      const response = await apiClient.delete(`/api/groups/${groupId}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, '解散群组失败'));
    }
  },

  // 转让群主
  transferOwnership: async (groupId: string, newOwnerId: string) => {
    try {
      const response = await apiClient.put(`/api/groups/${groupId}/transfer-ownership`, { newOwnerId });
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, '转让群主失败'));
    }
  }
};

export default apiClient;
