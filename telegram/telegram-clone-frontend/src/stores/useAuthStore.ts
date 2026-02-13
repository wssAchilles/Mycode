/**
 * 认证状态管理 Store
 * 使用 Zustand 进行全局认证状态管理
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { User } from '../types/auth';
import { authStorage } from '../utils/authStorage';

interface AuthState {
    // 状态
    user: User | null;
    accessToken: string | null;
    refreshToken: string | null;
    isAuthenticated: boolean;
    isLoading: boolean;

    // 动作
    setUser: (user: User | null) => void;
    setTokens: (accessToken: string, refreshToken: string) => void;
    login: (user: User, accessToken: string, refreshToken: string) => void;
    logout: () => void;
    updateUser: (updates: Partial<User>) => void;
    setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set) => ({
            // 初始状态
            user: null,
            accessToken: null,
            refreshToken: null,
            isAuthenticated: false,
            isLoading: true,

            // 设置用户
            setUser: (user) =>
                set({
                    user,
                    isAuthenticated: !!user,
                }),

            // 设置令牌
            setTokens: (accessToken, refreshToken) =>
                set({
                    accessToken,
                    refreshToken,
                }),

            // 登录
            login: (user, accessToken, refreshToken) => {
                authStorage.setTokens(accessToken, refreshToken);
                authStorage.setUser(user);

                set({
                    user,
                    accessToken,
                    refreshToken,
                    isAuthenticated: true,
                    isLoading: false,
                });
            },

            // 登出
            logout: () => {
                authStorage.clear();

                set({
                    user: null,
                    accessToken: null,
                    refreshToken: null,
                    isAuthenticated: false,
                    isLoading: false,
                });
            },

            // 更新用户信息
            updateUser: (updates) =>
                set((state) => ({
                    user: state.user ? { ...state.user, ...updates } : null,
                })),

            // 设置加载状态
            setLoading: (loading) =>
                set({
                    isLoading: loading,
                }),
        }),
        {
            name: 'auth-storage',
            // Per-tab isolation: allow two accounts in different tabs without overwriting each other.
            storage: createJSONStorage(() => sessionStorage),
            partialize: (state) => ({
                user: state.user,
                accessToken: state.accessToken,
                refreshToken: state.refreshToken,
                isAuthenticated: state.isAuthenticated,
            }),
        }
    )
);

// 选择器 - 用于性能优化
export const selectUser = (state: AuthState) => state.user;
export const selectIsAuthenticated = (state: AuthState) => state.isAuthenticated;
export const selectIsLoading = (state: AuthState) => state.isLoading;
