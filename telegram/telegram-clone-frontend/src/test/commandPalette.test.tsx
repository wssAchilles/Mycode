import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from '../components/command/CommandPalette';

const authMocks = vi.hoisted(() => ({
  isAuthenticated: vi.fn(() => true),
  getCurrentUser: vi.fn(() => ({ id: 'u-1', username: 'alice' })),
}));

vi.mock('../services/apiClient', () => ({
  authUtils: authMocks,
}));

describe('CommandPalette Spotlight ⌘K 全局命令面板', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.isAuthenticated.mockReturnValue(true);
    authMocks.getCurrentUser.mockReturnValue({ id: 'u-1', username: 'alice' });
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = vi.fn();
    }
  });

  it('响应 Meta+K 快捷键打开，支持关键词过滤并导航到消息中心', async () => {
    render(
      <MemoryRouter initialEntries={['/space']}>
        <Routes>
          <Route path="/space" element={<div>Space 页面</div>} />
          <Route path="/chat" element={<div>Chat 消息中心页面</div>} />
        </Routes>
        <CommandPalette />
      </MemoryRouter>,
    );

    // 关闭态不渲染面板输入框
    expect(screen.queryByPlaceholderText('搜索页面或快捷指令…')).not.toBeInTheDocument();

    // 触发 ⌘K
    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    const input = await screen.findByPlaceholderText('搜索页面或快捷指令…');
    expect(input).toBeInTheDocument();

    // 搜索并选择“消息中心”
    fireEvent.change(input, { target: { value: '消息中心' } });
    const chatItem = await screen.findByText('消息中心');
    fireEvent.click(chatItem);

    expect(await screen.findByText('Chat 消息中心页面')).toBeInTheDocument();
  });
});
