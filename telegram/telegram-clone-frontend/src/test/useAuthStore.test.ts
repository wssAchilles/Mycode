/**
 * useAuthStore 测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from '../stores/useAuthStore';

describe('useAuthStore', () => {
    beforeEach(() => {
        // 重置 store 状态
        useAuthStore.setState({
            user: null,
            accessToken: null,
            refreshToken: null,
            isAuthenticated: false,
            isLoading: true,
        });
        localStorage.clear();
        sessionStorage.clear();
    });

    it('should have initial state', () => {
        const state = useAuthStore.getState();
        expect(state.user).toBeNull();
        expect(state.isAuthenticated).toBe(false);
        expect(state.isLoading).toBe(true);
    });

    it('should login successfully', () => {
        const user = { id: '1', username: 'testuser', email: 'test@example.com' };
        const accessToken = 'access-token';
        const refreshToken = 'refresh-token';

        useAuthStore.getState().login(user as any, accessToken, refreshToken);

        const state = useAuthStore.getState();
        expect(state.user).toEqual(user);
        expect(state.accessToken).toBe(accessToken);
        expect(state.refreshToken).toBe(refreshToken);
        expect(state.isAuthenticated).toBe(true);
        expect(state.isLoading).toBe(false);

        // 检查 localStorage
        expect(localStorage.getItem('accessToken')).toBe(accessToken);
        expect(localStorage.getItem('refreshToken')).toBe(refreshToken);
    });

    it('should logout successfully', () => {
        // 先登录
        const user = { id: '1', username: 'testuser', email: 'test@example.com' };
        useAuthStore.getState().login(user as any, 'token', 'refresh');

        // 然后登出
        useAuthStore.getState().logout();

        const state = useAuthStore.getState();
        expect(state.user).toBeNull();
        expect(state.accessToken).toBeNull();
        expect(state.isAuthenticated).toBe(false);

        // 检查 localStorage 被清除
        expect(localStorage.getItem('accessToken')).toBeNull();
    });

    it('should update user', () => {
        const user = { id: '1', username: 'testuser', email: 'test@example.com' };
        useAuthStore.getState().login(user as any, 'token', 'refresh');

        useAuthStore.getState().updateUser({ username: 'newname' });

        const state = useAuthStore.getState();
        expect(state.user?.username).toBe('newname');
        expect(state.user?.email).toBe('test@example.com');
    });

    it('should set loading state', () => {
        useAuthStore.getState().setLoading(true);
        expect(useAuthStore.getState().isLoading).toBe(true);

        useAuthStore.getState().setLoading(false);
        expect(useAuthStore.getState().isLoading).toBe(false);
    });
});
