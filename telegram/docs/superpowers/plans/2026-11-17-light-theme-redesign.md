# Telegram & Space 全站淡色极简重构实施计划

> **给执行代理**: 严格遵循 `superpowers:executing-plans` 按模块分 Task 逐块实施、验证并做增量 Git Commit。

**Goal:** 将前端从暗黑玻璃拟态彻底重构为对标 X (Twitter) Light 与 Telegram Light 的纯净淡色高对比度极简设计体系。

**Architecture:** 先更新全局 CSS Token 与通用基础组件（确保 `color-scheme: light` 与深色高对比文字 `#0F1419` / `#536471` 生效），随后分别重构 Space 核心三栏主页（去套娃边框 + X 式顶栏下划线 + 右侧无粗进度条浅灰面板）、Space 派生页（个人主页无缝封面与详情页）、Chat 聊天全链路（去遮挡 FAB、修复顶栏断层、纯白气泡与清晰浅蓝选中态），最后完成认证/引导/AI/管理后台页统一换肤、残留扫描、Firebase 发布与 Chrome DevTools 实机逐页截图验收。

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, CSS Modules/BEM Stylesheets, Vite, Vitest, Firebase Hosting

**Spec:** [2026-11-17-light-theme-redesign.md](file:///Users/achilles/Documents/telegram_code/telegram/docs/superpowers/specs/2026-11-17-light-theme-redesign.md)

## 全局约束 (Global Constraints)
- 主背景画布：`#FFFFFF`；次级面板：`#F7F9F9` / `#EFF3F4`；分割线：`#EFF3F4`。
- 正文文本：`#0F1419`（与白底对比度 >= 15:1）；次级文本：`#536471`（>= 5.9:1）；弱提示：`#64748B`（>= 4.7:1）。
- 主 CTA：实心深黑胶囊 `#0F1419`（白字 `#FFFFFF`），Hover `#272C30`；品牌交互强调色：`#1D9BF0`（天蓝）。
- 严禁白底浅字、严禁多层圆角套娃边框、严禁紫蓝霓虹光晕与大面积虚线框。
- 所有注释与 Commit Message 使用简体中文。

---

### Task 1: 全局淡色 Token 体系与通用基础组件重构
**Files:**
- Modify: `telegram-clone-frontend/src/index.css`
- Modify: `telegram-clone-frontend/src/App.css`
- Modify: `telegram-clone-frontend/src/routes/index.tsx`
- Modify: `telegram-clone-frontend/src/components/common/*.css`
- Modify: `telegram-clone-frontend/src/components/design-system/StateBlock.css`
- Modify: `telegram-clone-frontend/src/components/ui/Toast.css`
- Modify: `telegram-clone-frontend/src/components/ErrorBoundary.css`
- [ ] 更新 `index.css` 为 Light Mode 语义变量并移除全局 `body::before` 暗黑噪点遮罩与深色玻璃阴影。
- [ ] 更新 `routes/index.tsx` 404 页面和加载占位为淡色纯白界面 + 深黑/天蓝胶囊按钮。
- [ ] 更新通用组件 (`Button`, `GlassCard`, `StateBlock`, `Toast`, `ErrorBoundary`, `Avatar`, `MessageBubble`, `ProgressiveImage`) 样式。
- [ ] 运行 `npx tsc --noEmit` 与通用组件 Vitest 验证并 commit。

### Task 2: Space 首页三栏、时间线与发帖核心组件（对标 X 参考图）
**Files:**
- Modify: `telegram-clone-frontend/src/pages/SpacePage.css`
- Modify: `telegram-clone-frontend/src/pages/SpacePage.tsx`
- Modify: `telegram-clone-frontend/src/components/space/SpaceAsideWidgets.tsx`
- Modify: `telegram-clone-frontend/src/components/space/RecommendationRefreshStatusCard.tsx`
- Modify: `telegram-clone-frontend/src/components/space/SpaceTimeline.css`
- Modify: `telegram-clone-frontend/src/components/space/SpacePost.css`
- Modify: `telegram-clone-frontend/src/components/space/PostComposer.css`
- Modify: `telegram-clone-frontend/src/components/space/NewsHomeSection.css`
- Modify: `telegram-clone-frontend/src/components/space/NewsBrief.css`
- Modify: `telegram-clone-frontend/src/components/space/NewsPostsList.css`
- Modify: `telegram-clone-frontend/src/components/space/NewsFeed.css`
- Modify: `telegram-clone-frontend/src/components/space/NewsTopicCard.css`
- Modify: `telegram-clone-frontend/src/components/space/RecommendationReason.css`
- Modify: `telegram-clone-frontend/src/components/space/SensitiveContentOverlay.css`
- [ ] 重构 `SpacePage` 为全高无边框三栏布局，采用 `1px solid #EFF3F4` 竖线分隔，左栏实心黑胶囊“发布动态”。
- [ ] 重构 `SpaceTimeline` 顶部为磨砂白 + 底部 `3px` 蓝色下划线指示器，动态卡片去边框以 `1px solid #EFF3F4` 横线分割。
- [ ] 改造 `SpaceAsideWidgets` 与 `RecommendationRefreshStatusCard`：去除刺眼粗蓝进度条，采用 `#F7F9F9` 无边框圆角（`16px`）面板、`tabular-nums` 等宽数字、黑胶囊关注按钮。
- [ ] 运行 Space 相关单测与 `tsc --noEmit` 验证并 commit。

### Task 3: Space 个人主页、探索、通知与详情页重构
**Files:**
- Modify: `telegram-clone-frontend/src/pages/SpaceProfilePage.css`
- Modify: `telegram-clone-frontend/src/pages/SpaceProfilePage.tsx`
- Modify: `telegram-clone-frontend/src/components/space/SpaceExplore.css`
- Modify: `telegram-clone-frontend/src/components/space/SpaceNotifications.css`
- Modify: `telegram-clone-frontend/src/components/space/SpaceCommentDrawer.css`
- Modify: `telegram-clone-frontend/src/components/space/SharePostModal.css`
- Modify: `telegram-clone-frontend/src/pages/SpacePostDetailPage.css`
- Modify: `telegram-clone-frontend/src/pages/NewsDetailPage.css`
- [ ] 重构 `SpaceProfilePage` 为一体化无裂隙布局（取消浮空胶囊与虚线边框），封面平铺+白边头像半重叠压角+蓝色下划线 Tab。
- [ ] 清洗 `SpaceExplore`、`SpaceNotifications`、`SpaceCommentDrawer`、`SharePostModal` 与详情页的硬编码暗黑底与白字。
- [ ] 运行 `SpaceProfilePage.likesError.test.tsx` 等单测并 commit。

### Task 4: Chat 即时通讯全链路淡色重构
**Files:**
- Modify: `telegram-clone-frontend/src/pages/ChatPage.css`
- Modify: `telegram-clone-frontend/src/pages/chat/ChatSidebar.tsx`
- Modify: `telegram-clone-frontend/src/pages/chat/GroupDetailPanel.css`
- Modify: `telegram-clone-frontend/src/features/chat/components/ChatHeader.css`
- Modify: `telegram-clone-frontend/src/features/chat/components/ChatList.css`
- Modify: `telegram-clone-frontend/src/features/chat/components/ChatListItem.css`
- Modify: `telegram-clone-frontend/src/features/chat/components/ChatHistory.css`
- Modify: `telegram-clone-frontend/src/features/chat/components/MessageInput.css`
- Modify: `telegram-clone-frontend/src/features/chat/components/CreateGroupModal.css`
- Modify: `telegram-clone-frontend/src/components/chat/*.css` & `Avatar.tsx`
- Modify: `telegram-clone-frontend/src/components/layout/*.css`
- Modify: `telegram-clone-frontend/src/components/AddContactModal.css`
- Modify: `telegram-clone-frontend/src/components/ChatList.css`
- [ ] 去除聊天外圈间隙与深色氛围球；移除左下角遮挡巨型渐变 FAB 与虚线“新建群组”框，将入口优雅整合至侧边栏顶部。
- [ ] 修复 `ChatHeader` 左侧断层色块，统一磨砂白顶栏；会话选中态采用淡天蓝底 + 深炭黑高对比文本。
- [ ] 优化对方纯白气泡 + 轻阴影与己方天蓝气泡对比度，保留已读徽章防裁切保护。
- [ ] 运行 Chat 相关单测并 commit。

### Task 5: 认证/引导/AI/管理后台适配 + 全站硬编码审计、构建发布与 Chrome DevTools 验收
**Files:**
- Modify: `telegram-clone-frontend/src/pages/AuthPages.css`
- Modify: `telegram-clone-frontend/src/pages/LoginPage.tsx` / `RegisterPage.tsx` (如涉及局部类名微调)
- Modify: `telegram-clone-frontend/src/pages/OnboardingPage.css`
- Modify: `telegram-clone-frontend/src/components/AiChatComponent.css`
- Modify: `telegram-clone-frontend/src/components/AiConversationList.css`
- Modify: `telegram-clone-frontend/src/components/ai/*.css`
- Modify: `telegram-clone-frontend/src/components/admin/*.css`
- [ ] 重构登录/注册页为洁净亮色布局，消除背景错位框与紫蓝发光球；适配 AI 对话与 Admin 监控看板为淡色高对比界面。
- [ ] 全量扫描硬编码暗色残留并修正，执行 `tsc --noEmit`、全量 `vitest run` 与 `npm run build`。
- [ ] Commit 并运行 `npx firebase-tools deploy --only hosting` 部署至 `https://telegram-467705.web.app`。
- [ ] 使用 `chrome-devtools` 实机访问并截图验收登录页、Space 首页、探索页、个人主页与 Chat 会话页，确保视觉与零控制台错误达标。
