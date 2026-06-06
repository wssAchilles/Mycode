# Telegram Clone Frontend

React + Vite 前端。该项目包含聊天、Space 动态、AI 助手、认证引导和后台运营面板。

## 动画治理

本项目采用增量动画治理：

- Framer Motion 继续负责现有页面级路由切换和已稳定的挂载/卸载动画。
- Anime.js 只作为局部交互动画层，用于短促反馈、抽屉/弹窗进出、有限列表 stagger、KPI 更新提示。
- CSS 继续负责 spinner、skeleton、typing indicator、ripple、hover 和简单状态样式。

### 动效分层决策表

| 层级 | 默认技术 | 允许用途 | 禁止项 |
| --- | --- | --- | --- |
| Route/Page | Framer Motion | 路由切换、页面级 presence | 高频列表、store/service/worker 动画 |
| Overlay/Dialog | Anime.js + WAAPI | modal/drawer enter/exit、focus 完成后的短动画 | 不带 focus trap 的抽屉/弹窗 |
| Local feedback | Anime.js + WAAPI | 点赞、未读徽标、KPI flash、发送反馈 | layout/reorder 动画 |
| State/loading | CSS | spinner、typing dots、skeleton/shimmer | 装饰性 pulse/ring/thinking loop |
| Hover/focus | CSS | 按钮、chip、输入框状态 | `transition: all` |

## Anime.js 使用规则

- 组件必须通过 `src/core/animation` 接入 Anime.js。
- 禁止从业务组件直接导入 `animejs` 或任何 `animejs/*` 子路径。
- 禁止根包导入 `animejs`；仅核心层允许使用 `animejs/scope`、`animejs/waapi`、`animejs/timeline`、`animejs/utils`。
- 所有 React 动画必须有组件级 `rootRef`，并通过 `useAnimeScope` 在卸载时执行 scope cleanup。
- 大面积抽屉和弹窗可以标记为 heavy animation；按钮、徽标、点赞、未读数等微交互不得阻塞调度。
- `prefers-reduced-motion: reduce` 下，JS 动画时长必须降为 0 或直接跳过。
- 业务样式禁止新增 `transition: all`；必须显式列出 `transform`、`opacity`、`background-color`、`border-color`、`box-shadow`、`color` 等属性。
- 长期循环动画必须有明确状态含义，并通过 `check:motion-contract` 白名单约束。

## 性能边界

- `ChatHistory` 和 `SpaceTimeline` 是虚拟列表边界，不能直接导入 Anime.js。
- 虚拟列表内禁止动画行高、宽度、top、left、absolute 定位、测量容器或虚拟行 wrapper。
- 允许在消息气泡、徽标、按钮、计数和局部内容节点上使用 `transform`、`opacity`、短暂 `box-shadow`。
- 避免长期循环装饰动画；只保留有状态含义的加载动画。
- `check:budgets` 使用分层预算：
  - 硬预算会阻断：Anime.js chunk、Framer/animation chunk、ChatPage JS/CSS。
  - 软预算只报告：worker、WASM、total initial JS、大型 lazy chunk。
  - 软预算代表历史体积债务，应单独开任务处理，例如拆懒 `CartesianChart`、分析 WASM/worker、重新定义 initial/lazy 口径。

## 常用命令

```bash
npm run build
npm run check:motion-boundary
npm run check:motion-contract
npm run check:ui-guards
npm run check:budgets
```

`check:budgets` 的硬预算必须通过。软预算会输出 `[budget:soft]`，用于持续暴露既有体积债务，但不阻断本次动画治理类改动。
