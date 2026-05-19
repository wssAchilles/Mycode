// 用户相关类型定义
export interface User {
  id: string;
  username: string;
  email?: string;
  avatarUrl?: string;
  birthDate?: string | null;
  region?: string | null;
  language?: string | null;
  createdAt: string;
  updatedAt?: string;
}

// 认证相关类型
export interface LoginCredentials {
  usernameOrEmail: string;
  password: string;
}

export interface RegisterCredentials {
  username: string;
  email?: string;
  password: string;
  confirmPassword: string;
  birthDate?: string;
  region?: string;
  language?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse {
  message: string;
  user: User;
  tokens: AuthTokens;
}

// API 响应类型
export interface ApiResponse<T = any> {
  message?: string;
  error?: string;
  data?: T;
}

// 错误响应类型
export interface ApiError {
  error: string;
  message: string;
  timestamp?: string;
}
