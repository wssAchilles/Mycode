# 工业级聊天应用前端性能优化升级方案

> 基于 Telegram-TT、Telegram Desktop、TDLib、Matrix-Rust-SDK、Zulip 五大开源项目的深度代码分析
> 
> 预计总投入：**4-6 个月**

---

## 目录

1. [现有架构评估](#1-现有架构评估)
2. [Phase 1 — 渲染层重构（月 1-2）](#2-phase-1--渲染层重构月-1-2)
3. [Phase 2 — Worker 引擎升级（月 2-3）](#3-phase-2--worker-引擎升级月-2-3)
4. [Phase 3 — 存储与同步层（月 3-4）](#4-phase-3--存储与同步层月-3-4)
5. [Phase 4 — 网络与协议层（月 4-5）](#5-phase-4--网络与协议层月-4-5)
6. [Phase 5 — 高级优化与度量（月 5-6）](#6-phase-5--高级优化与度量月-5-6)
7. [性能预算与 KPI](#7-性能预算与-kpi)
8. [里程碑规划](#8-里程碑规划)

---

## 1. 现有架构评估

### 1.1 现有优势（已实现）

| 模式 | 实现位置 | 参考源 |
|------|---------|--------|
| 三层存储（Zustand → Worker LRU → IndexedDB） | chatCoreStore / messageStore / db.ts | Telegram-TT cache.ts |
| 微任务批处理 `onTickEnd` | schedulers.ts | Telegram-TT schedulers.ts |
| WASM 加速合并排序 | wasm.ts `merge_sorted_unique_u32` | 自研 |
| Worker 内 LRU 缓存（30 chats） | lru.ts | — |
| 虚拟列表 | ChatHistory.tsx (@tanstack/react-virtual) | 通用最佳实践 |
| 单实体订阅 `StoreMessageBubble` | messageStore selector | Zulip singleton 模式 |
| Hover 预取 | ChatListItem.tsx `onMouseEnter` | Telegram-TT |
| `messageIdsVersion` 版本号驱动最小渲染 | messageStore.ts | Zulip pointer 模式 |
| ChatPatch 联合类型 delta 传输 | types.ts | Matrix VectorDiff |

### 1.2 与工业级标杆的差距矩阵

| 维度 | 标杆实现 | 你的项目现状 | 差距等级 |
|------|---------|------------|---------|
| DOM 读写分离（防布局抖动） | Telegram-TT `fasterdom.ts`: requestMeasure/requestMutation 分帧 | 无 | 🔴 高 |
| 重动画阻塞 | Telegram-TT `heavyAnimation.ts`: 动画期间冻结组件更新 | 无 | 🔴 高 |
| DOM 节点上限裁剪 | Zulip `message_list_view.ts`: 仅保留可视区 ± 缓冲的 DOM 节点 | @tanstack/react-virtual 仅做虚拟化，但无离屏 DOM 回收 | 🟡 中 |
| 聊天切换 Abort 取消 + 骨架屏 | Telegram-TT MessageList: `beginHeavyAnimation` + Content.Loading 状态机 | 有 AbortController 但无骨架屏/过渡态 | 🟡 中 |
| 全局状态 IDB 缓存 + 缩减策略 | Telegram-TT `cache.ts`: `reduceGlobal` + 5s 节流 + `onFullyIdle` 延迟 | 有 `saveSyncPts` 但无全局状态缓存与缩减 | 🔴 高 |
| 滑动同步（Sliding Sync） | Matrix SDK: 窗口化 room list、按需加载 timeline | 一次拉取全部 contacts + groups | 🔴 高 |
| 消息解析 Worker 卸载 | Telegram-TT: Markdown/emoji 在 Worker 内预处理 | Markdown 在主线程解析 | 🟡 中 |
| CSS Containment | Telegram-TT: `contain: content` on message rows | ChatHistory.css 有 `contain: content`（✅），但 ChatList 无 | 🟢 低 |
| framer-motion 开销 | — | ChatList.tsx 每个虚拟行包裹 `<motion.div>` | 🔴 高 |
| 自定义渲染框架 | Telegram-TT Teact: 自定义虚拟 DOM、`runUpdatePassOnRaf` 批量更新 | React 19 标准 reconciler | 🟡 中（不建议完全仿制） |
| 响应式 Store 流式更新 | Matrix `eyeball` crate: Observable + VectorDiff stream | Zustand selectors（已较优） | 🟢 低 |
| 数据库索引优化 | TDLib: SQLite PRAGMA journal_mode=WAL, page_size=4096 | Dexie 默认配置 | 🟡 中 |
| 内存压力监控 | tdesktop: `registerHeavyViewPart` / `unloadHeavyViewParts` | 无 | 🔴 高 |
| 图片渐进式加载 | Telegram-TT: blurhash → thumb → full，三阶段加载 | 无渐进式，直接 `<img src>` | 🟡 中 |

---

## 2. Phase 1 — 渲染层重构（月 1-2）

### 2.1 引入 `fasterdom` DOM 读写分离系统

**参考**: Telegram-TT `src/lib/fasterdom/fasterdom.ts`

**原理**: 在一帧内先批量执行所有 DOM 读取（measure），再批量执行所有 DOM 写入（mutation），避免 forced reflow（布局抖动）。Telegram-TT 使用 Promise 链实现帧内阶段排序。

**实施方案**:

```
src/core/dom/
├── fasterdom.ts          // requestMeasure() / requestMutation() / requestForcedReflow()
├── throttleWithRaf.ts    // RAF 级节流 + fallback
└── index.ts
```

**核心 API 设计**:
```typescript
// 类似 Telegram-TT 实现
let pendingMeasure: (() => void)[] = [];
let pendingMutation: (() => void)[] = [];

export function requestMeasure(cb: () => void): void;    // 读 DOM
export function requestMutation(cb: () => void): void;   // 写 DOM
export function requestForcedReflow(cb: () => [
  () => void       // measure 回调
]): void;            // 需要立即 reflow 的特殊场景
```

**改造范围**:
- `ChatHistory.tsx`: 滚动位置计算 → `requestMeasure`，`scrollTo` → `requestMutation`
- `ChatList.tsx`: 列表更新 → `requestMutation`
- 所有 `getBoundingClientRect()` / `offsetHeight` / `scrollTop` 调用 → `requestMeasure`
- 所有 `style.xxx = ` / `classList.add` / `scrollTo` → `requestMutation`

**预期收益**: 消除布局抖动，滚动/切换帧率从可能的 30-40fps → 稳定 60fps

---

### 2.2 重动画阻塞系统 `heavyAnimation`

**参考**: Telegram-TT `src/lib/teact/heavyAnimation.ts`

**原理**: 使用计数器追踪正在运行的重动画（路由切换、聊天切换动画、面板滑入）。当 `isBlockingAnimating === true` 时，冻结所有非关键组件更新。

**实施方案**:

```typescript
// src/core/animation/heavyAnimation.ts
let counter = 0;
const observers = new Set<(blocking: boolean) => void>();

export function beginHeavyAnimation(duration = 500): () => void {
  counter++;
  notifyObservers();
  
  // 返回 end 函数
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    counter--;
    notifyObservers();
  };
  
  setTimeout(end, duration); // 安全兜底
  return end;
}

export function isBlockingAnimating(): boolean { return counter > 0; }
export function onFullyIdle(cb: () => void): void { /* 当 counter=0 且 requestIdleCallback 时执行 */ }
```

**使用场景**:
- 聊天切换 `setActiveContact()` → 调用 `beginHeavyAnimation(400)`
- 侧边栏打开/关闭
- 路由动画
- 消息列表滚动到底部的大跳跃

**组件侧集成**: 创建 `useHeavyAnimationGuard()` hook，在 `isBlocking` 期间跳过 re-render

---

### 2.3 移除 ChatList 中的 framer-motion

**问题**: `ChatList.tsx` 中每个虚拟列表行使用 `<motion.div>`，导致：
- 每帧额外的 style 计算（transform compositing）
- 虚拟化和动画框架的双重 layout 开销
- 大量动画实例占内存

**方案**:
- 替换 `<motion.div>` 为原生 `<div>` + CSS `transition` / `will-change: transform`
- 入场动画使用纯 CSS `@keyframes` + `animation-fill-mode: both`
- 删除操作使用 `requestMutation` + CSS `transition: height 200ms, opacity 200ms`
- 聊天列表重排序使用 FLIP 动画技术（First-Last-Invert-Play），不依赖 framer-motion

---

### 2.4 强化虚拟列表策略

**参考**: Zulip `message_list_view.ts` DOM 节点管理 + tdesktop `HistoryInner` 枚举模式

**当前问题**:
- `ChatHistory.tsx` `overscan: 8`，应根据视口大小动态计算
- `estimateSize` 硬编码逻辑，缺少基于历史数据的自适应
- 无 DOM 节点回收机制

**方案**:

```
A) 动态 overscan = Math.ceil(viewportHeight / avgRowHeight) * 1.5

B) 自适应 estimateSize:
   - 维护全局 heightCache: Map<messageId, measuredHeight>
   - 首次估算用启发式（文本长度、是否有附件、是否是系统消息）
   - 渲染后通过 ResizeObserver 更新 heightCache
   - 缓存持久化到 IDB（可选，切换聊天后保留）

C) DOM 回收（仿 Zulip _visible_divs 模式）:
   - 对于离开可视区超过 3 个视口距离的 DOM 节点，替换为占位 <div> 
   - 重新进入可视区时恢复真实内容
   - 配合 content-visibility: auto (CSS) 自动跳过离屏渲染

D) 消息组分组渲染（仿 Telegram-TT messageGroups）:
   - 相邻同发送者消息合并为一个虚拟行
   - 减少虚拟列表项数（10条连续消息 → 1个组项）
   - 组内消息共享 sender 头像和时间戳
```

---

### 2.5 CSS Containment 全面覆盖

**方案**:
```css
/* 每个消息行 */
.message-row {
  contain: content;      /* 已有 ✅, 确保覆盖所有行 */
  content-visibility: auto;
  contain-intrinsic-size: auto 60px;  /* 新增: 预估高度，加速跳过 */
}

/* 聊天列表项 */
.chat-list-item {
  contain: strict;       /* 新增 */
  content-visibility: auto;
  contain-intrinsic-size: auto 72px;
}

/* 侧边栏 */
.sidebar-panel {
  contain: layout style paint;
}

/* 输入框区域 */
.compose-area {
  contain: layout style;
}
```

---

### 2.6 图片渐进式加载流水线

**参考**: Telegram-TT 三阶段加载 + tdesktop `CloudFile` 渐进下载

**方案**:
```
Stage 1: Blurhash placeholder (< 100 bytes, inline 在消息体里)
         → 立即渲染 <canvas> 模糊背景
Stage 2: 缩略图 (thumbnail, 约 2-5KB, WebP)  
         → 替换 blurhash，CSS transition fade-in
Stage 3: 原图/适配分辨率图
         → IntersectionObserver 触发懒加载
         → 下载完成后 crossfade 替换缩略图
```

**实现要点**:
- 后端返回消息时附带 `thumbHash` / `blurhash` 字段
- Worker 侧预解码 blurhash → 传入主线程渲染
- 使用 `<picture>` + `srcset` 适配不同 DPR

---

## 3. Phase 2 — Worker 引擎升级（月 2-3）

### 3.1 消息格式化 Worker 卸载

**参考**: Telegram-TT 在自定义渲染器内处理文本实体

**当前问题**: Markdown/Emoji/链接解析在主线程进行，阻塞渲染

**方案**: 在 `chatCore.worker.ts` 中新增消息预处理管道

```
src/core/workers/
├── chatCore.worker.ts         // 已有: 消息获取、同步
├── messageParser.worker.ts    // 新增: 文本解析 Worker
└── parsePipeline.ts           // 解析管道定义
```

```typescript
// messageParser.worker.ts
export interface ParsedContent {
  html: string;              // 预渲染 HTML 片段
  plainText: string;         // 纯文本（搜索用）
  hasEmoji: boolean;
  emojiOnlyCount: number;    // 仿 Telegram-TT 模式
  entities: ParsedEntity[];  // 链接、@提及、#话题 等结构化数据
  estimatedHeight: number;   // 预估渲染高度（给虚拟列表用）
}

// 处理流程:
// 1. Markdown → HTML (使用轻量 parser, 如 markdown-it 子集)
// 2. Emoji 短码 → Unicode / 自定义 emoji <img> 标签
// 3. URL 检测 + 链接实体化
// 4. @mention / #channel 实体化
// 5. 代码块语法高亮 (可选, 大消息)
// 6. 高度预估算
```

**集成方式**:
- 消息到达 worker 后，先经过 `parsePipeline` 处理
- 解析结果附加到 `ChatPatch` 的 message 数据上
- 主线程 `MessageBubble` 直接使用 `dangerouslySetInnerHTML={{ __html: msg.parsedHtml }}` 
- 旧消息从 IDB 加载时按需解析（惰性）

---

### 3.2 Worker 内 fasterdom 调度协调

**当前 Worker 调度**: `throttleWithTickEnd` 单一策略

**改进为多级调度层次**（仿 Telegram-TT 完整调度层级）:

```typescript
// src/core/workers/schedulers.ts 扩展

// Level 1: 微任务 — 当前帧末尾（已有）
export function onTickEnd(cb: () => void): void;

// Level 2: RAF — 下一帧开始（新增）  
export function onNextFrame(cb: () => void): void {
  requestAnimationFrame(cb);
}

// Level 3: 双 RAF — 确保浏览器已完成 paint（新增）
export function afterPaint(cb: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(cb));
}

// Level 4: Idle — 空闲时执行（已有 onIdle，增强版）
export function onIdle(cb: () => void, timeout = 500): void;

// Level 5: 完全空闲 — 无动画 + Idle（新增）
export function onFullyIdle(cb: () => void): void {
  // 等待 heavyAnimation 结束 + requestIdleCallback
  if (isBlockingAnimating()) {
    subscribeHeavyAnimation(() => {
      if (!isBlockingAnimating()) requestIdleCallback(cb, { timeout: 1000 });
    });
  } else {
    requestIdleCallback(cb, { timeout: 1000 });
  }
}
```

**应用场景**:
| 调度级别 | 使用场景 |
|---------|---------|
| `onTickEnd` | ChatPatch 批量分发 |
| `onNextFrame` | 滚动位置更新、DOM measure |
| `afterPaint` | 延迟加载非关键 UI 元素 |
| `onIdle` | IDB 持久化、预取下一屏数据 |
| `onFullyIdle` | 全局状态缓存、stats 上报、后台索引构建 |

---

### 3.3 WASM 扩展

**当前**: `merge_sorted_unique_u32` / `diff_sorted_unique_u32`

**扩展方案**:

```
src/core/wasm/chat_wasm/src/
├── lib.rs
├── merge.rs          // 已有: 合并排序
├── diff.rs           // 已有: 差集
├── search.rs         // 新增: 二分查找、前缀搜索
├── compress.rs       // 新增: 消息文本 LZ4 压缩/解压
└── crypto.rs         // 新增: 加密加速 (可选)
```

**新增 WASM 函数**:
- `binary_search_seq(sorted_seqs: &[u32], target: u32) -> Option<usize>` — 替代 JS `Array.findIndex`
- `filter_by_range(seqs: &[u32], min: u32, max: u32) -> Vec<u32>` — 范围过滤
- `lz4_compress(input: &[u8]) -> Vec<u8>` — 消息内容压缩入 IDB
- `lz4_decompress(input: &[u8]) -> Vec<u8>` — 出 IDB 解压

---

### 3.4 Worker 健康检查与自动恢复

**当前**: `workerBridge.ts` 有 `ping` 检查（400ms 超时），但无自动恢复

**增强方案**:

```typescript
// src/core/bridge/workerBridge.ts 增强
class WorkerLifecycle {
  private heartbeatInterval: number;
  private missedBeats = 0;
  private readonly MAX_MISSED = 3;

  startHeartbeat(intervalMs = 5000) {
    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.ping(400);
        this.missedBeats = 0;
      } catch {
        this.missedBeats++;
        if (this.missedBeats >= this.MAX_MISSED) {
          console.error('[WorkerBridge] Worker unresponsive, restarting...');
          await this.restart();
        }
      }
    }, intervalMs);
  }

  async restart() {
    // 1. 终止旧 worker
    this.terminate();
    // 2. 创建新 worker
    await this.createWorker();
    // 3. 重新初始化（带 IDB 恢复）
    await this.init(this.lastConfig);
    // 4. 重新订阅当前活跃聊天
    if (this.activeChat) {
      await this.switchChat(this.activeChat);
    }
    // 5. 通知 UI 层重载
    this.emitReconnect();
  }
}
```

---

## 4. Phase 3 — 存储与同步层（月 3-4）

### 4.1 全局状态 IDB 缓存系统

**参考**: Telegram-TT `src/global/cache.ts`

**原理**: 将整个应用状态快照（聊天列表、未读数、用户信息）序列化到 IDB，冷启动时先加载缓存再连接服务器。

**方案**:

```typescript
// src/services/globalCache.ts

interface CachedState {
  version: number;          // 缓存版本号（处理迁移）
  timestamp: number;        // 缓存时间
  chatList: CachedChat[];   // 精简聊天列表（最近 100 个）
  userProfiles: Record<string, CachedUser>;
  syncPts: number;          // 同步游标
  settings: AppSettings;
}

// 写入策略（仿 Telegram-TT）:
// 1. 每 5 秒节流写入
// 2. 仅在 onFullyIdle 时执行
// 3. 写入前调用 reduceState() 裁剪非必要数据
const CACHE_THROTTLE = 5000;

function reduceState(state: GlobalState): CachedState {
  return {
    chatList: state.chats.slice(0, 100).map(chat => ({
      id: chat.id,
      title: chat.title,
      lastMessage: chat.lastMessage ? {
        id: chat.lastMessage.id,
        text: chat.lastMessage.text?.slice(0, 100), // 截断
        timestamp: chat.lastMessage.timestamp,
      } : null,
      unreadCount: chat.unreadCount,
      avatarUrl: chat.avatarUrl,
      isGroup: chat.isGroup,
    })),
    // ... 其他精简字段
  };
}

// 冷启动流程:
// 1. 读取 IDB cached state
// 2. 渲染 UI（快速可见）
// 3. 后台发起 sync 补齐差量
// 4. 差量覆盖缓存数据
```

**预期收益**: 冷启动到可交互从 2-3s → < 500ms（有缓存情况下）

---

### 4.2 IndexedDB 批量操作优化

**参考**: TDLib SQLite PRAGMA 配置 + Zulip 批量消息处理

**当前问题**: `saveMessages` 每次单条 put 操作

**方案**:

```typescript
// src/core/chat/persist/idb.ts 优化

// 1. 批量写入 — 使用 Dexie bulkPut
export async function saveMessagesBatch(messages: Message[]): Promise<void> {
  if (!messages.length) return;
  await db.messages.bulkPut(messages);  // 单事务批量写
}

// 2. 分页读取 — 使用游标而非 toArray()
export async function loadMessagesPage(
  chatId: string, 
  beforeSeq: number, 
  limit: number
): Promise<Message[]> {
  return db.messages
    .where('[chatId+seq]')
    .between([chatId, Dexie.minKey], [chatId, beforeSeq], false, false)
    .reverse()
    .limit(limit)
    .toArray();
}

// 3. 定期压缩 — 删除超出上限的旧消息
export async function compactChatMessages(chatId: string, keepCount = 5000): Promise<void> {
  const count = await db.messages.where('chatId').equals(chatId).count();
  if (count <= keepCount) return;
  
  const oldest = await db.messages
    .where('chatId').equals(chatId)
    .sortBy('seq');
  
  const toDelete = oldest.slice(0, count - keepCount);
  await db.messages.bulkDelete(toDelete.map(m => m.id));
}

// 4. 索引优化 — 增加复合索引
// db.ts 版本升级:
// messages: '++id, chatId, seq, timestamp, senderId, [chatId+seq], [chatId+timestamp]'
//                                                                   ^--- 新增时间戳索引
```

---

### 4.3 自适应 LRU 缓存

**当前**: 固定 30 chats 的 LRU

**改进**:

```typescript
// src/core/chat/store/adaptiveLru.ts

class AdaptiveLRU<K, V> {
  private cache: Map<K, V>;
  private maxSize: number;
  private readonly MIN_SIZE = 10;
  private readonly MAX_SIZE = 100;

  constructor(initialSize = 30) {
    this.maxSize = initialSize;
    this.cache = new Map();
  }

  // 根据内存压力动态调整
  adjustCapacity(): void {
    if ('memory' in performance) {
      const memory = (performance as any).memory;
      const usageRatio = memory.usedJSHeapSize / memory.jsHeapSizeLimit;
      
      if (usageRatio > 0.8) {
        // 内存压力高 → 缩小缓存
        this.maxSize = Math.max(this.MIN_SIZE, Math.floor(this.maxSize * 0.7));
        this.evictToSize();
      } else if (usageRatio < 0.4 && this.maxSize < this.MAX_SIZE) {
        // 内存充裕 → 扩大缓存
        this.maxSize = Math.min(this.MAX_SIZE, Math.floor(this.maxSize * 1.3));
      }
    }
  }

  // 每 30 秒检测一次
  startMonitoring(): void {
    setInterval(() => this.adjustCapacity(), 30_000);
  }
}
```

---

### 4.4 内存压力监控与资源卸载

**参考**: tdesktop `data_session.h` 的 `registerHeavyViewPart()` / `unloadHeavyViewParts()`

**方案**:

```typescript
// src/core/memory/pressure.ts

class MemoryPressureManager {
  private heavyParts = new Set<{ unload: () => void; priority: number }>();
  
  register(part: { unload: () => void; priority: number }): () => void {
    this.heavyParts.add(part);
    return () => this.heavyParts.delete(part);
  }

  // 内存紧张时按优先级卸载
  async releasePressure(level: 'moderate' | 'critical'): Promise<void> {
    const sorted = [...this.heavyParts].sort((a, b) => a.priority - b.priority);
    const toUnload = level === 'critical' ? sorted : sorted.slice(0, Math.ceil(sorted.length / 2));
    
    for (const part of toUnload) {
      part.unload();
    }
  }
}

// 使用场景:
// - 每个 Image/Video/Audio 组件挂载时 register，卸载时 unregister
// - 离开视口的媒体 revoke ObjectURL
// - 监听 'memory-pressure' 事件 (Chrome) 或定期检查 performance.memory
// - 后台标签页时主动卸载所有离屏媒体

// Hook:
function useHeavyPart(unloadFn: () => void, priority = 5) {
  useEffect(() => {
    return memoryManager.register({ unload: unloadFn, priority });
  }, []);
}
```

---

## 5. Phase 4 — 网络与协议层（月 4-5）

### 5.1 滑动窗口聊天列表（Sliding Window）

**参考**: Matrix Sliding Sync (MSC3575) — 核心理念

**当前问题**: `loadChats()` 一次性拉取所有 contacts + groups，然后客户端排序

**方案**: 实现类似 Sliding Sync 的窗口化聊天列表

```typescript
// 概念模型:
// 
// 服务端有 N 个排序好的聊天（按最后消息时间倒序）
// 客户端只请求可见窗口 [start, end] 范围的聊天
// 当用户滚动时，客户端更新窗口范围
// 服务端增量推送窗口内变化

// 前端实现:
interface SlidingWindowConfig {
  ranges: [number, number][];  // 可见范围
  sort: 'recency' | 'alphabetical';
  filters?: {
    isDM?: boolean;
    isGroup?: boolean;
    isUnread?: boolean;
  };
}

// 请求:
// POST /api/sync/sliding
// { ranges: [[0, 19]], sort: 'recency' }
//
// 响应:
// { 
//   count: 500,           // 总数
//   ops: [
//     { op: 'SYNC', range: [0, 19], items: [...] },
//     { op: 'INSERT', index: 2, item: {...} },   // 实时变更
//     { op: 'DELETE', index: 15 },
//   ]
// }

// 前端滚动处理:
const WINDOW_SIZE = 30;
const BUFFER = 10;

function onChatListScroll(scrollIndex: number) {
  const start = Math.max(0, scrollIndex - BUFFER);
  const end = scrollIndex + WINDOW_SIZE + BUFFER;
  slidingSync.updateRange([[start, end]]);
}
```

**注意**: 这需要后端配合。如果后端无法短期改造，可以先在前端做「虚拟滑动窗口」——仍然一次拉取但增量排序、分页显示。

---

### 5.2 消息同步增量优化

**参考**: TDLib `getChannelDifference` + Telegram-TT gap recovery

**当前**: Worker 内 `syncLoop` 使用 30s 长轮询

**优化方案**:

```
A) Gap Recovery 增强:
   当前: 检测到 seq 断点时全量重拉
   改进: 
   1. 记录已知 seq 范围 [min, max]
   2. gap 检测: 如果收到 seq 不在 [max+1] 范围内
   3. 精确请求缺失范围: GET /api/messages/gap?chatId=X&fromSeq=Y&toSeq=Z
   4. 如果 gap > 1000 条，切换为 "重置模式" (clear + reload latest)

B) 同步策略分级:
   - 活跃聊天: 实时 WebSocket 推送
   - 最近 10 个聊天: 30s 轮询
   - 其他聊天: 仅在打开时按需同步（滑动窗口）
   - 后台标签页: 暂停同步，恢复时一次性补齐

C) 压缩传输:
   - 启用 Socket.IO perMessageDeflate (WebSocket permessage-deflate)
   - 消息列表请求结果使用服务端 gzip/brotli
   - 二进制消息编码 (MessagePack 替代 JSON) — 长期考虑
```

---

### 5.3 预取策略增强

**当前**: `ChatListItem` hover 预取

**扩展**:

```typescript
// src/services/prefetch.ts

class PrefetchManager {
  private prefetched = new Set<string>();
  private queue: string[] = [];
  private isProcessing = false;

  // 1. Hover 预取（已有，保持）
  onHover(chatId: string): void { /* 已实现 */ }

  // 2. 可视区预取：预取可见聊天列表上下各 5 个聊天的最新消息
  onViewportChange(visibleChatIds: string[], allChatIds: string[]): void {
    const firstVisible = allChatIds.indexOf(visibleChatIds[0]);
    const lastVisible = allChatIds.indexOf(visibleChatIds[visibleChatIds.length - 1]);
    
    const prefetchRange = allChatIds.slice(
      Math.max(0, firstVisible - 5),
      Math.min(allChatIds.length, lastVisible + 6)
    );
    
    for (const id of prefetchRange) {
      if (!this.prefetched.has(id)) {
        this.queue.push(id);
      }
    }
    
    this.processQueue();
  }

  // 3. 空闲预取：空闲时预取 top-10 聊天的完整历史
  scheduleIdlePrefetch(topChatIds: string[]): void {
    onFullyIdle(() => {
      for (const id of topChatIds.slice(0, 10)) {
        if (!this.prefetched.has(id)) {
          this.prefetchChat(id);
        }
      }
    });
  }

  // 4. 预测性预取：基于用户行为模式
  // - 如果用户经常在聊天 A → B → C 之间切换，预取 B 和 C
  // - 简单的频率计数：最近 50 次切换中出现频率 top 5
  
  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    
    while (this.queue.length > 0) {
      const chatId = this.queue.shift()!;
      if (this.prefetched.has(chatId)) continue;
      
      await this.prefetchChat(chatId);
      this.prefetched.add(chatId);
      
      // 每个预取之间等待一帧，避免阻塞
      await new Promise(r => requestAnimationFrame(r));
    }
    
    this.isProcessing = false;
  }
}
```

---

### 5.4 WebSocket 重连增强

**当前**: Socket.IO 5 次重连

**优化**:

```typescript
// src/services/socketService.ts 增强

const RECONNECT_STRATEGY = {
  initialDelay: 1000,
  maxDelay: 30000,
  factor: 2,            // 指数退避
  jitter: 0.3,          // 30% 随机抖动防雷鸟效应
  maxAttempts: Infinity, // 永不放弃
};

// 网络状态感知:
navigator.connection?.addEventListener('change', () => {
  const { effectiveType, downlink } = navigator.connection;
  
  if (effectiveType === '4g' && downlink > 5) {
    // 高速网络: 激进重连
    socket.io.opts.reconnectionDelay = 500;
  } else if (effectiveType === '2g' || effectiveType === 'slow-2g') {
    // 低速网络: 保守重连、减少数据量
    socket.io.opts.reconnectionDelay = 5000;
    // 切换为仅同步文本消息
  }
});

// 后台/前台切换:
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // 后台: 降级为长轮询 / 减少频率
    socket.io.opts.transports = ['polling'];
  } else {
    // 前台: 恢复 WebSocket + 立即补齐差量
    socket.io.opts.transports = ['websocket', 'polling'];
    triggerImmediateSync();
  }
});
```

---

## 6. Phase 5 — 高级优化与度量（月 5-6）

### 6.1 性能度量体系

**参考**: Telegram-TT `DEBUG renderTime > 7ms warning` + 你已有的 `marks.ts`

**扩展方案**:

```typescript
// src/perf/metrics.ts

interface PerformanceMetrics {
  // 聊天切换
  chatSwitchTime: number;        // 目标: < 100ms
  chatSwitchToInteractive: number; // 目标: < 200ms
  
  // 消息渲染
  messageRenderTime: number;      // 单条, 目标: < 3ms
  messageGroupRenderTime: number; // 10条组批, 目标: < 16ms (一帧)
  
  // 滚动性能
  scrollFPS: number;              // 目标: >= 55fps
  scrollJankCount: number;        // 长帧 (>50ms) 数量
  
  // 网络
  messageSendLatency: number;     // 发送到确认, 目标: < 500ms
  syncDeltaLatency: number;       // 增量同步延迟
  
  // 内存
  jsHeapUsedMB: number;           // 目标: < 150MB
  domNodeCount: number;           // 目标: < 3000
  
  // Worker
  workerPatchLatency: number;     // Worker → 主线程 patch 延迟
  idbWriteLatency: number;        // IDB 写入延迟
}

// 采集方式:
class PerfMonitor {
  // 1. Long Frame 检测
  private longFrameObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.duration > 50) {
        this.reportJank(entry);
      }
    }
  });
  
  // 2. 滚动 FPS 采样
  measureScrollFPS(duration = 2000): Promise<number> { /* RAF 计数 */ }
  
  // 3. 聊天切换计时 (增强现有 marks.ts)
  markChatSwitch(chatId: string): void {
    performance.mark(`chat-switch-start-${chatId}`);
  }
  
  measureChatSwitch(chatId: string): number {
    performance.mark(`chat-switch-end-${chatId}`);
    const measure = performance.measure(
      `chat-switch-${chatId}`,
      `chat-switch-start-${chatId}`,
      `chat-switch-end-${chatId}`
    );
    return measure.duration;
  }
  
  // 4. 内存快照
  captureMemorySnapshot(): MemorySnapshot {
    return {
      jsHeap: (performance as any).memory?.usedJSHeapSize,
      domNodes: document.querySelectorAll('*').length,
      workerAlive: workerBridge.isAlive(),
      lruSize: chatCoreClient.getCacheSize(),
    };
  }
}
```

---

### 6.2 构建时性能预算

**方案**: 利用已有的 `scripts/check-budgets.mjs` 扩展

```javascript
// scripts/check-budgets.mjs 增强

const BUDGETS = {
  // JS 包大小预算
  'main.js': { maxGzip: 120_000 },       // 120KB gzip
  'vendor.js': { maxGzip: 200_000 },      // 200KB gzip
  'worker.js': { maxGzip: 30_000 },       // 30KB gzip
  'wasm.wasm': { maxRaw: 100_000 },       // 100KB raw
  
  // 首次加载预算
  totalInitialJS: { maxGzip: 350_000 },   // 350KB total JS gzip
  
  // 代码拆分检查
  lazyChunks: {
    minCount: 5,                           // 至少 5 个懒加载 chunk
    maxChunkSize: 80_000,                  // 每个 chunk < 80KB gzip
  },
  
  // 图片资源
  maxInlineImageSize: 10_000,              // 内联图片 < 10KB
};
```

---

### 6.3 Service Worker 离线优先策略

**当前**: workbox + vite-plugin-pwa（基础配置）

**增强**:

```typescript
// 策略分层:
// 
// 1. App Shell (HTML/CSS/JS): Cache-First + 后台更新
//    → 确保离线可启动
//
// 2. API 数据: Network-First, 超时回退缓存
//    → GET /api/messages/chat/:id → 缓存最近结果
//    → 离线时返回 IDB 本地数据
//
// 3. 媒体文件: Cache-First, 按 LRU 淘汰
//    → 缩略图: 缓存 500 张
//    → 原图: 最近 100 张
//    → 视频: 不缓存（空间占用大）
//
// 4. 离线消息队列:
//    → 发送失败的消息存入 IndexedDB
//    → 网络恢复时自动重发（仿 Matrix send_queue）
//    → 保持发送顺序
```

---

### 6.4 Web Worker 池化

**当前**: 单 Worker (`chatCore.worker.ts`)

**长期方案**: Worker Pool

```
Worker Pool Architecture:
┌─────────────────────────────────────────────┐
│                Main Thread                    │
│  ┌─────────┐  ┌──────────┐  ┌────────────┐ │
│  │ UI React │  │ Zustand  │  │ Socket.IO  │ │
│  └────┬─────┘  └────┬─────┘  └─────┬──────┘ │
│       │             │              │         │
│  ┌────▼─────────────▼──────────────▼───────┐ │
│  │           Worker Dispatcher              │ │
│  └────┬─────────────┬──────────────┬───────┘ │
└───────┼─────────────┼──────────────┼─────────┘
        │             │              │
   ┌────▼────┐  ┌─────▼─────┐  ┌────▼────┐
   │ Worker 1 │  │ Worker 2  │  │ Worker 3│
   │ Chat     │  │ Message   │  │ Crypto  │
   │ Sync     │  │ Parse     │  │ E2E     │
   │ Engine   │  │ Search    │  │ Hash    │
   └──────────┘  └───────────┘  └─────────┘
```

**实施步骤**:
1. 月 5: 拆分 `messageParser.worker.ts`（文本解析独立）
2. 月 6: 拆分搜索功能为独立 Worker（全文搜索不阻塞聊天同步）
3. 可选: 加密操作独立 Worker（TweetNaCl 运算密集）

---

### 6.5 React 渲染优化全面检查

**方案**:

```
A) Selector 粒度审计:
   - 检查所有 useMessageStore / useChatStore 调用
   - 确保 selector 返回值是原始类型或稳定引用
   - 使用 zustand/shallow 进行浅比较
   - 消灭返回 .filter() / .map() 新数组的 selector（每次新引用）

B) 组件边界优化:
   - 每个消息组件必须 React.memo + 稳定 props
   - 消息内部的 Avatar / Time / Status 子组件独立 memo
   - 聊天列表项的 badge / typing indicator 使用独立订阅

C) Key 策略:
   - 消息列表: key={messageId} (已有 ✅)
   - 聊天列表: key={chatId} (检查是否稳定)
   - 避免使用 index 作为 key

D) 条件渲染优化:
   - 将不可见面板（设置、搜索、转发面板）使用 React.lazy
   - 使用 startTransition 包裹非紧急 UI 更新
   - 消息状态变化（已读 ✓✓）使用 useDeferredValue

E) 事件处理器稳定化:
   - 所有 onXxx 回调使用 useCallback 或 useLastCallback 模式
   - 避免在 render 中创建箭头函数作为 props
```

---

## 7. 性能预算与 KPI

### 7.1 核心指标

| 指标 | 当前估计值 | 目标值 | 标杆值 (Telegram-TT) |
|------|----------|--------|---------------------|
| 冷启动到可交互 (TTI) | 2-3s | < 1s | < 800ms |
| 聊天切换延迟 | 200-500ms | < 100ms | < 50ms |
| 消息列表滚动 FPS | 45-55fps | >= 58fps | 60fps |
| 消息发送到显示 | 300-600ms | < 200ms | < 100ms |
| JS Bundle (gzip) | 未知 | < 350KB | ~300KB |
| DOM 节点数 | 未知 | < 3000 | < 2000 |
| JS Heap 峰值 | 未知 | < 150MB | ~100MB |
| Worker Patch 延迟 | 未知 | < 5ms | — |
| IDB 读取 (50条消息) | 未知 | < 30ms | — |
| 长帧事件 (>50ms) / min | 未知 | < 5 | < 2 |

### 7.2 自动化测试

```
CI Pipeline 新增:
1. Lighthouse CI 
   - Performance score ≥ 90
   - TTI < 1.5s
   - TBT < 200ms

2. Bundle Size Bot
   - PR 评论显示包大小变化
   - 超出预算自动阻止合并

3. 性能回归测试
   - Playwright + Chrome DevTools Protocol
   - 聊天切换计时 < 100ms (P95)
   - 滚动 500条消息无长帧

4. 内存泄漏检测
   - 重复打开/关闭 50 个聊天后 heap 不超过初始 2 倍
```

---

## 8. 里程碑规划

### Month 1: 基础渲染层
- [ ] 实现 `fasterdom.ts` (requestMeasure/requestMutation)
- [ ] 实现 `heavyAnimation.ts` 
- [ ] 移除 ChatList framer-motion，改用 CSS 动画
- [ ] CSS containment 全面覆盖
- [ ] 聊天切换骨架屏 / Loading 状态机

### Month 2: 虚拟列表 + 消息渲染
- [ ] 动态 overscan 计算
- [ ] 消息高度缓存 + 自适应 estimateSize
- [ ] 消息组分组渲染
- [ ] 图片渐进式加载（blurhash → thumbnail → full）
- [ ] React 渲染优化审计（selector/memo/key）

### Month 3: Worker 增强
- [ ] 消息格式化 Worker 卸载（messageParser.worker.ts）
- [ ] 多级调度系统（5 级优先级）
- [ ] WASM 扩展（搜索、压缩）
- [ ] Worker 健康检查 + 自动恢复

### Month 4: 存储与缓存
- [ ] 全局状态 IDB 缓存系统
- [ ] IDB 批量操作优化 (bulkPut)
- [ ] 自适应 LRU 缓存
- [ ] 内存压力监控 + 资源卸载
- [ ] 消息数据库压缩（定期清理旧消息）

### Month 5: 网络层
- [ ] 滑动窗口聊天列表（前端虚拟版）
- [ ] Gap Recovery 增强
- [ ] 同步策略分级 + 后台降级
- [ ] 预取策略增强（可视区/空闲/预测性）
- [ ] WebSocket 重连增强 + 网络感知

### Month 6: 度量与打磨
- [ ] 完整性能度量体系
- [ ] 构建时性能预算卡关
- [ ] Service Worker 离线优先
- [ ] Worker Pool 拆分（解析、搜索独立）
- [ ] CI 性能回归测试
- [ ] 内存泄漏检测自动化
- [ ] 端到端性能报告

---

## 附录 A: 关键参考文件索引

| 文件 | 项目 | 关键模式 |
|------|------|---------|
| `src/util/schedulers.ts` | telegram-tt | debounce/throttle/fastRaf/onTickEnd/onIdle 全家族 |
| `src/lib/teact/teact.ts` | telegram-tt | 自定义 Virtual DOM、runUpdatePassOnRaf 批量更新 |
| `src/lib/teact/heavyAnimation.ts` | telegram-tt | 计数器动画阻塞、onFullyIdle |
| `src/lib/fasterdom/fasterdom.ts` | telegram-tt | DOM 读写分帧、requestMeasure/requestMutation |
| `src/global/cache.ts` | telegram-tt | IDB 全局状态缓存、reduceGlobal、5s 节流 |
| `src/global/reducers/messages.ts` | telegram-tt | 不可变状态更新、viewport/listed/pinned id 分离 |
| `src/components/middle/MessageList.tsx` | telegram-tt | 消息列表完整实现、Content 状态枚举、分组渲染 |
| `web/src/message_store.ts` | zulip | Map<id, Message> 单例存储 |
| `web/src/message_list_data.ts` | zulip | _all_items/_items/_hash 三层数据、mute 过滤 |
| `web/src/message_list_view.ts` | zulip | MessageGroup 分组渲染、DOM 增量更新 |
| `web/src/message_viewport.ts` | zulip | 可视区计算、_visible_divs 性能优化 |
| `crates/matrix-sdk/src/sliding_sync/` | matrix-rust-sdk | Sliding Sync MSC3575、窗口化列表、Growing/Paging 模式 |
| `crates/matrix-sdk-ui/src/timeline/mod.rs` | matrix-rust-sdk | Timeline VectorDiff 流式更新、send_queue 离线队列 |
| `td/telegram/MessagesManager.h` | tdlib | 频道差异同步、Actor 模型、WaitFreeHashMap |
| `Telegram/SourceFiles/history/history_widget.h` | tdesktop | 滚动预加载、延迟显示、历史加载状态机 |
| `Telegram/SourceFiles/history/history_inner_widget.h` | tdesktop | enumerateItems 模板方法、heavy view part 管理 |
| `Telegram/SourceFiles/data/data_session.h` | tdesktop | 响应式 rpl::producer 模式、视图重绘请求系统 |

---

## 附录 B: 技术风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| fasterdom 引入后 DOM 操作时序变化导致 bug | 中 | 中 | 逐组件迁移、每次迁移后回归测试 |
| framer-motion 移除导致动画体验下降 | 低 | 低 | 用 CSS transition + FLIP 技巧覆盖所有动画场景 |
| Worker 消息解析导致消息显示延迟 | 中 | 中 | 先渲染原始文本、解析完成后更新 |
| IDB 批量写入在低端设备上仍慢 | 中 | 低 | 动态降低持久化频率、仅保存关键数据 |
| Sliding Sync 需后端改造 | 高 | 中 | 先做前端虚拟版本、后端慢慢跟进 |
| 内存压力 API 兼容性 | 中 | 低 | Chrome-only feature detect, 其他浏览器回退到定时检查 |
