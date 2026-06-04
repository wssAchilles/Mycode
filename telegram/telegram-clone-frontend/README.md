# Telegram Clone Frontend

React + Vite 前端。该项目包含聊天、Space 动态、AI 助手、认证引导和后台运营面板。

## 动画治理

本项目采用增量动画治理：

- Framer Motion 继续负责现有页面级路由切换和已稳定的挂载/卸载动画。
- Anime.js 只作为局部交互动画层，用于短促反馈、抽屉/弹窗进出、有限列表 stagger、KPI 更新提示。
- CSS 继续负责 spinner、skeleton、typing indicator、ripple、hover 和简单状态样式。

## Anime.js 使用规则

- 组件必须通过 `src/core/animation` 接入 Anime.js。
- 禁止从业务组件直接导入 `animejs` 或任何 `animejs/*` 子路径。
- 禁止根包导入 `animejs`；仅核心层允许使用 `animejs/scope`、`animejs/waapi`、`animejs/timeline`、`animejs/utils`。
- 所有 React 动画必须有组件级 `rootRef`，并通过 `useAnimeScope` 在卸载时执行 scope cleanup。
- 大面积抽屉和弹窗可以标记为 heavy animation；按钮、徽标、点赞、未读数等微交互不得阻塞调度。
- `prefers-reduced-motion: reduce` 下，JS 动画时长必须降为 0 或直接跳过。

## 性能边界

- `ChatHistory` 和 `SpaceTimeline` 是虚拟列表边界，不能直接导入 Anime.js。
- 虚拟列表内禁止动画行高、宽度、top、left、absolute 定位、测量容器或虚拟行 wrapper。
- 允许在消息气泡、徽标、按钮、计数和局部内容节点上使用 `transform`、`opacity`、短暂 `box-shadow`。
- 避免长期循环装饰动画；只保留有状态含义的加载动画。

## 常用命令

```bash
npm run build
npm run check:motion-boundary
npm run check:ui-guards
npm run check:budgets
```

`check:budgets` 当前可能因既有 Worker、WASM 和总 JS 预算失败。动画改动的验收重点是不得扩大这些既有问题，并保持 Anime.js chunk、ChatPage JS/CSS 和 Framer Motion chunk 在既定增量范围内。
