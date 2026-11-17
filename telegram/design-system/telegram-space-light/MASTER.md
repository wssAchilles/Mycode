# Telegram Space Light — 全局设计系统总纲 (MASTER)

本设计系统基于 **UI/UX Pro Max** 规范与 X (Twitter) / Telegram 淡色极简参考标准制定，作为全站所有页面和组件的视觉单一事实来源（Single Source of Truth）。

---

## 1. 核心美学原则

1. **纯白去边框主义（Borderless Crisp Light）**：摒弃多层圆角嵌套边框（Nested Box Soup）、毛玻璃紫蓝霓虹光晕与大面积虚线占位框，利用大面积纯净留白、极细 `1px` 低对比分隔线（Hairline Divider）与轻量浅灰表面色差划分层级。
2. **高对比深色排版（WCAG AAA/AA Text Contrast）**：主背景为纯白 `#FFFFFF`，正文文本采用深炭黑 `#0F1419`（对比度约 `18.3:1`），次级文本与元数据采用石板灰 `#536471`（对比度约 `5.9:1`），杜绝浅灰底浅灰字或任何残余白色字体。
3. **克制的高级交互与强调色**：主行动按钮（发布动态、关注、登录 CTA）采用高辨识度的纯黑胶囊 `#0F1419` 配纯白文字（或 Telegram 经典天蓝 `#1D9BF0` / `#2AABEE` 用于交互指示条、发送气泡、核心链接与聚焦高亮）。

---

## 2. 语义化色彩令牌（CSS Variables）

| 令牌用途 | 变量名 | 推荐色值 | 说明与对比度基准 |
| :--- | :--- | :--- | :--- |
| **主画布背景** | `--color-background` | `#FFFFFF` | 纯白主底色，最大化内容通透感 |
| **次级浅灰表面** | `--color-surface` | `#F7F9F9` | 右侧趋势/推荐卡片、输入槽、气泡对方底色 |
| **悬停交互底色** | `--color-surface-hover` | `#EFF3F4` | 导航项 Hover、胶囊开关底槽、分割线背景 |
| **激活按压底色** | `--color-surface-active` | `#E6EAEC` | 按钮/列表按压态 |
| **浮层/弹窗背景** | `--color-surface-elevated` | `#FFFFFF` | 配合轻量弥散阴影替代粗边框 |
| **粘性半透明顶栏** | `--glass-bg` | `rgba(255, 255, 255, 0.85)` | `backdrop-filter: blur(12px)` 毛玻璃白顶栏 |
| **主文本（强对比）** | `--color-text-primary` | `#0F1419` | 标题、正文、用户名（对比度 `18.3:1`） |
| **次级文本（可读灰）** | `--color-text-secondary` | `#536471` | `@handle`、时间戳、摘要说明（对比度 `5.9:1`） |
| **弱提示/占位文本** | `--color-text-muted` | `#64748B` | 输入框 placeholder、最次要图标（在 `#FFFFFF` 上满足 `4.7:1` AA 对比度） |
| **禁用态文本** | `--color-text-disabled` | `#94A3B8` | 不可用按钮文本 |
| **品牌黑主行动** | `--color-cta-solid` | `#0F1419` | 主 CTA（发布、关注、登录），文字 `#FFFFFF` |
| **品牌黑悬停** | `--color-cta-solid-hover` | `#272C30` | 主 CTA Hover 态 |
| **品牌天蓝强调色** | `--tg-blue` / `--color-cta` | `#1D9BF0` | 选中标签下划线、发送气泡、链接、聚焦框 |
| **天蓝柔和底色** | `--tg-blue-bg` | `rgba(29, 155, 240, 0.10)` | 轻量化激活徽标、选中会话底色 |
| **极细发丝分隔线** | `--color-border` / `--tg-separator` | `#EFF3F4` | 栏间竖线与动态卡片横线分割 |
| **表单输入框描边** | `--color-input-border` | `#CFD9DE` | 搜索框、表单框聚焦前细描边 |
| **成功状态色** | `--color-success` | `#00BA7C` | 在线绿点、转发高亮、健康状态 |
| **警告状态色** | `--color-warning` | `#F59E0B` | 字符数提醒、告警状态 |
| **危险/点赞红** | `--color-error` / `--tg-rose` | `#F91880` / `#E11D48` | 点赞心形高亮、退出/删除等危险操作 |

---

## 3. 排版与间距尺度

- **字体栈**：`-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif`；数据统计与计数器统一启用 `font-variant-numeric: tabular-nums`。
- **字重与行高**：
  - 页面大标题：`20px`, `font-weight: 700`, `color: #0F1419`, `line-height: 1.3`
  - 动态正文 / 聊天消息：`15px`, `font-weight: 400`, `color: #0F1419`, `line-height: 1.5`
  - 元信息（Handle / 时间）：`14px` / `13px`, `color: #536471`
- **圆角克制尺度**：
  - 全站结构区：无圆角外框（`0px`），紧贴视口并由 `1px solid #EFF3F4` 划分列。
  - 次级区块（右侧趋势卡/推荐关注卡/消息气泡）：`16px`。
  - 导航高亮项与 CTA 按钮：全圆角胶囊 `9999px` 或微圆角 `10px~12px`。

---

## 4. 禁止模式（Anti-Patterns）

- **禁止**在淡色背景上保留任何 `color: #fff`、`rgba(255,255,255,0.6)` 或半透明暗黑背景 `rgba(16, 23, 34, ...)`。
- **禁止**使用多层套娃边框、紫蓝霓虹渐变发光阴影、以及超过 2px 的高饱和粗蓝数据进度条。
- **禁止**在主导航或常规操作按钮上使用大虚线边框（如“新建群组”、“更换头像”）。
- **禁止**遮挡内容区的巨型悬浮渐变圆钮。
