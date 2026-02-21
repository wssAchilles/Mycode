import { expect, test } from '@playwright/test';

const USERNAME = process.env.PERF_CHAT_USERNAME || '';
const PASSWORD = process.env.PERF_CHAT_PASSWORD || '';

const SELECTORS = {
  loginUsername:
    process.env.PERF_LOGIN_USERNAME_SELECTOR ||
    'input[name="usernameOrEmail"], input[name="username"], input[name="email"], #usernameOrEmail',
  loginPassword: process.env.PERF_LOGIN_PASSWORD_SELECTOR || 'input[name="password"], #password',
  loginSubmit:
    process.env.PERF_LOGIN_SUBMIT_SELECTOR ||
    'button[type="submit"], button:has-text("登录"), button:has-text("Log in")',
  chatContainer: '.chat-container',
  sidebar: '.chat-sidebar, .tg-chat-list, [data-chat-sidebar]',
  chatHeader: '.chat-header, .tg-chat-header, .tg-chat-area__header, [class*="chat-header"], [data-chat-header]',
  history: '.chat-history, .tg-chat-area__messages, [data-message-list]',
  messageInput:
    'textarea, input[type="text"][aria-label="输入消息内容"], input[type="text"][placeholder*="Message"], [data-message-input]',
  chatItem: '.tg-chat-item, .chat-item, [data-chat-id]',
};

test('chat UI contract guard (desktop + mobile)', async ({ page, baseURL }) => {
  test.skip(!USERNAME || !PASSWORD, 'Missing PERF_CHAT_USERNAME / PERF_CHAT_PASSWORD');
  test.skip(!baseURL, 'Missing Playwright baseURL');

  await page.goto('/login');
  await page.fill(SELECTORS.loginUsername, USERNAME);
  await page.fill(SELECTORS.loginPassword, PASSWORD);
  await Promise.all([
    page.waitForURL(/chat|dashboard|\/$/i, { timeout: 30_000 }),
    page.click(SELECTORS.loginSubmit),
  ]);

  await expect(page.locator(SELECTORS.chatContainer).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(SELECTORS.sidebar).first()).toBeVisible({ timeout: 20_000 });

  const openChatButtons = page.getByRole('button', { name: /打开会话/i });
  const buttonCount = await openChatButtons.count();
  if (buttonCount > 0) {
    await openChatButtons.first().click({ timeout: 10_000 });
  } else {
    const item = page.locator(SELECTORS.chatItem).first();
    await item.click({ timeout: 10_000 });
  }

  await expect(page.locator(SELECTORS.chatHeader).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(SELECTORS.history).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(SELECTORS.messageInput).first()).toBeVisible({ timeout: 20_000 });

  // Mobile UI guard: container remains mounted and interactive shell still visible.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(SELECTORS.chatContainer).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(SELECTORS.messageInput).first()).toBeVisible({ timeout: 20_000 });
});
