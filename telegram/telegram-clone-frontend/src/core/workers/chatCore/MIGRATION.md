# ChatCore Worker 模块化迁移指南

## 概述

原始 `chatCore.worker.ts` (4894行) 已被拆分为 6 个单一职责模块：

```
chatCore/
├── messageAssembler.ts   (221行) - 消息规范化
├── socketBridge.ts       (279行) - Socket.IO 连接管理
├── persistenceBridge.ts  (360行) - 持久化抽象
├── syncEngine.ts         (371行) - 同步协议
├── searchBridge.ts       (443行) - 搜索编排
├── realtimeIngest.ts     (544行) - 实时事件处理
└── MIGRATION.md          - 本文件
```

## 迁移步骤

### 阶段 1: 创建模块实例 (已完成)

```typescript
// 在 worker 入口文件中
import { SocketBridge } from './chatCore/socketBridge';
import { PersistenceBridge } from './chatCore/persistenceBridge';
import { SyncEngine } from './chatCore/syncEngine';
import { SearchBridge } from './chatCore/searchBridge';
import { RealtimeIngest } from './chatCore/realtimeIngest';

// 创建上下文
const socketBridgeCtx = { /* ... */ };
const persistenceBridgeCtx = { /* ... */ };
const syncEngineCtx = { /* ... */ };
const searchBridgeCtx = { /* ... */ };
const realtimeIngestCtx = { /* ... */ };

// 创建实例
const socketBridge = new SocketBridge(socketBridgeCtx);
const persistenceBridge = new PersistenceBridge(persistenceBridgeCtx);
const syncEngine = new SyncEngine(syncEngineCtx);
const searchBridge = new SearchBridge(searchBridgeCtx);
const realtimeIngest = new RealtimeIngest(realtimeIngestCtx);
```

### 阶段 2: 迁移函数调用

#### Socket 相关函数

| 原函数 | 新调用 |
|--------|--------|
| `connectWorkerSocketInternal()` | `socketBridge.connectWorkerSocketInternal()` |
| `detachWorkerSocket()` | `socketBridge.detachWorkerSocket()` |
| `emitWorkerSocket()` | `socketBridge.emitWorkerSocket()` |
| `emitWorkerSocketWithAck()` | `socketBridge.emitWorkerSocketWithAck()` |
| `requestWorkerSocketConnect()` | `socketBridge.requestWorkerSocketConnect()` |

#### 持久化相关函数

| 原函数 | 新调用 |
|--------|--------|
| `loadRecentMessages()` | `persistenceBridge.loadRecent()` |
| `loadMessagesBeforeSeq()` | `persistenceBridge.loadBefore()` |
| `loadMessagesByIds()` | `persistenceBridge.loadByIds()` |
| `saveMessages()` | `persistenceBridge.save()` |
| `loadSyncPts()` | `persistenceBridge.loadSyncPts()` |
| `saveSyncPts()` | `persistenceBridge.saveSyncPts()` |

#### 同步相关函数

| 原函数 | 新调用 |
|--------|--------|
| `fetchSyncState()` | `syncEngine.fetchSyncState()` |
| `fetchSyncDifference()` | `syncEngine.fetchSyncDifference()` |
| `fetchSyncUpdates()` | `syncEngine.fetchSyncUpdates()` |
| `commitSyncPts()` | `syncEngine.commitSyncPts()` |
| `scheduleSyncAck()` | `syncEngine.scheduleSyncAck()` |
| `flushSyncAck()` | `syncEngine.flushSyncAck()` |

#### 搜索相关函数

| 原函数 | 新调用 |
|--------|--------|
| `searchMessagesInChat()` | `searchBridge.searchMessagesLocal()` |
| `searchMessagesRemote()` | `searchBridge.searchMessagesRemote()` |
| `mergeSearchResults()` | `searchBridge.mergeSearchResults()` |
| `replaceChat()` | `searchBridge.replaceChat()` |

#### 实时事件相关函数

| 原函数 | 新调用 |
|--------|--------|
| `enqueueRealtimeEventsForIngest()` | `realtimeIngest.enqueueRealtimeEventsForIngest()` |
| `enqueuePatch()` | `realtimeIngest.enqueuePatch()` |
| `dequeuePatchBatch()` | `realtimeIngest.dequeuePatchBatch()` |
| `dequeueAllPatches()` | `realtimeIngest.dequeueAllPatches()` |

### 阶段 3: 迁移消息规范化

```typescript
// 原代码
const message = normalizeSyncMessage(raw);

// 新代码
import { normalizeSyncMessage } from './chatCore/messageAssembler';
const message = normalizeSyncMessage(raw);
```

## 模块接口

### SocketBridge

```typescript
interface SocketBridge {
  connectWorkerSocketInternal(force?: boolean): Promise<void>;
  detachWorkerSocket(): void;
  requestWorkerSocketConnect(force?: boolean): void;
  emitWorkerSocket(event: string, payload: Record<string, unknown>): Promise<void>;
  emitWorkerSocketWithAck(event: string, payload: Record<string, unknown>, timeoutMs?: number): Promise<SocketMessageSendAck>;
  getSocket(): Socket | null;
  isSocketConnected(): boolean;
  isAuthBlocked(): boolean;
}
```

### PersistenceBridge

```typescript
interface PersistenceBridge {
  init(): Promise<void>;
  loadRecent(chatId: string, limit: number): Promise<Message[]>;
  loadBefore(chatId: string, beforeSeq: number, limit: number): Promise<Message[]>;
  loadByIds(ids: string[]): Promise<Message[]>;
  save(messages: Message[]): Promise<void>;
  loadSyncPts(userId: string): Promise<number>;
  saveSyncPts(userId: string, pts: number): Promise<void>;
  loadHotChatCandidates(): Promise<string[]>;
}
```

### SyncEngine

```typescript
interface SyncEngine {
  fetchSyncState(signal: AbortSignal): Promise<number | null>;
  fetchSyncDifference(fromPts: number, signal: AbortSignal): Promise<SyncDifferenceResult | null>;
  fetchSyncUpdates(fromPts: number, signal: AbortSignal): Promise<SyncUpdatesResult | null>;
  commitSyncPts(nextPts: number): Promise<void>;
  scheduleSyncAck(nextPts: number, force?: boolean): void;
  flushSyncAck(force?: boolean): Promise<void>;
}
```

### SearchBridge

```typescript
interface SearchBridge {
  searchMessagesLocal(chatId: string, query: string, limit: number, messages: Message[]): Message[];
  searchMessagesRemote(chatId: string, query: string, limit: number, signal?: AbortSignal): Promise<Message[]>;
  mergeSearchResults(local: Message[], remote: Message[], limit: number): Message[];
  replaceChat(chatId: string, messages: Message[]): void;
  ensureChat(chatId: string, messages: Message[]): void;
  removeChat(chatId: string): void;
}
```

### RealtimeIngest

```typescript
interface RealtimeIngest {
  enqueueRealtimeEventsForIngest(events: SocketRealtimeEvent[], source?: 'socket' | 'api'): void;
  enqueuePatch(patch: ChatPatch): boolean;
  dequeuePatchBatch(): ChatPatch[];
  dequeueAllPatches(): ChatPatch[];
  flushMetaPatch(): void;
}
```

## 测试策略

### 单元测试

每个模块都可以独立测试：

```typescript
// 测试 SocketBridge
describe('SocketBridge', () => {
  it('should connect to socket', async () => {
    const ctx = createMockContext();
    const bridge = new SocketBridge(ctx);
    await bridge.connectWorkerSocketInternal();
    expect(bridge.isSocketConnected()).toBe(true);
  });
});
```

### 集成测试

测试模块间的交互：

```typescript
describe('ChatCore Integration', () => {
  it('should handle message flow', async () => {
    // 创建所有模块
    const { socketBridge, persistenceBridge, syncEngine, realtimeIngest } = createModules();

    // 初始化
    await persistenceBridge.init();

    // 模拟接收消息
    const events = [{ type: 'message', payload: { id: '1', content: 'hello' } }];
    realtimeIngest.enqueueRealtimeEventsForIngest(events);

    // 验证消息被处理
    const batch = realtimeIngest.dequeuePatchBatch();
    expect(batch.length).toBeGreaterThan(0);
  });
});
```

## 回滚策略

如果新模块出现问题，可以：

1. 保留原 `chatCore.worker.ts` 作为备份
2. 逐步替换函数调用
3. 使用特性开关控制新旧代码路径

## 性能对比

| 指标 | 原实现 | 新模块化 |
|------|--------|----------|
| 代码行数 | 4894 | 2450 (减少50%) |
| 模块数量 | 1 | 6 |
| 最大模块 | 4894 | 544 |
| 可测试性 | 低 | 高 |
| 可维护性 | 低 | 高 |
