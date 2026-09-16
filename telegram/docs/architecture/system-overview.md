# 系统总览（As-built）

> 本文描述当前仓库实现的真实边界，而不是目标态。目标态与阶段计划见 `docs/superpowers/` 与 [phase-status.md](phase-status.md)。

## 1. 项目定位

Telegram Clone 是多语言实时通信与智能社交平台：私聊/群聊、Space 动态、个性化推荐、AI 对话、新闻聚合，以及围绕发布、回退、可观测性的运行时控制面。

## 2. 能力归属（Canonical Owner）

| 边界 | Owner | 职责 |
| --- | --- | --- |
| Web Client | React 19 + TypeScript | Chat / Space / News / Admin / PWA / Worker / 本地投影 |
| Public API / Control Plane | Node.js + Express + Socket.IO | 认证、公开 API、上传、数据 provider、fallback adapter、OPE/promotion 控制面 |
| Realtime Edge | Rust Gateway | HTTP/Socket 入口、限流、JWT 预校验、实时协议兼容边界 |
| Recommendation Runtime | Rust Workspace | 候选管道编排、排序、选择、共享契约 |
| Platform Delivery | Go Consumer | Redis Streams 消费、投递投影、重试、回放、DLQ |
| Graph Data Plane | C++ Graph Kernel | 图快照、邻居检索、重叠计算、运行时诊断 |
| ML / Offline Jobs | Python | ANN、Phoenix 排序、内容安全、训练、爬取与归档 |
| Data Platform | MongoDB + PostgreSQL + Redis | 业务状态、关系数据、缓存、队列与事件流 |

**所有权硬约束（推荐）**：算法 canonical owner 为 `rust`。Node 侧 `NODE_RECOMMENDATION_FROZEN_GROWTH_AREAS` 冻结 new_sources / filters / selectors / scorers / ranking_weights / multi_source_fusion 的增长；Node 保留 `feed_api_adapter`、`rust_recommendation_call`、`legacy_baseline_fallback`、`response_hydration`、`legacy_response_shape`。

## 3. 逻辑架构

```text
React Client (Firebase Hosting / 本地 Vite)
        │
        ▼
Nginx (api.xuziqi.tech)
  ├─ /socket.io/  ──► Node Backend :5000   (Phase 2A socket terminator)
  └─ /*           ──► Rust Gateway :4000   (全量反代 + 分级限流 + JWT 预校验)

Node Backend :5000
  ├──HTTP──► Rust Recommendation :4200 ──HTTP──► Node /internal/recommendation
  │                    │
  │                    └──HTTP──► C++ Graph Kernel :4300
  ├──HTTP──► C++ Graph Kernel :4300 (kernelClient / realgraph batch)
  ├──HTTP ops──► Go Delivery Consumer :4100
  ├──Redis Streams──► chat:delivery:bus:v1 / platform:events:v1 ──► Go Consumer
  └──HTTP──► Python ML (Cloud Run，经 mlProxy / FeedRecommendClient / VFClient)

Go Delivery Consumer
  ├── Mongo 投递投影 (chatmemberstates / updatecounters / updatelogs / outbox)
  └── PubSub ──► sync:update:wake:v1 / user:online|offline / notification
                    └── Node Realtime 层订阅后推 WebSocket

C++ Graph Kernel
  └── 从 Node /internal/graph-kernel/snapshot 拉取快照（generation 协议）
```

## 4. 运行时拓扑

### 4.1 本地 smoke profile

文件：`deploy/vps/docker-compose.yml`

| 服务 | 语言 | 端口（127.0.0.1） | 说明 |
| --- | --- | --- | --- |
| redis | — | 6379（内网） | 缓存 / Streams / PubSub / 队列 |
| backend | Node | 5000 | 公开 API 与控制面 |
| gateway | Rust | 4000 | 入口反代与实时边界 |
| delivery_consumer | Go | 4100 | 投递与平台事件执行 |
| recommendation | Rust | 4200 | 推荐候选管道 |

不在本地 profile：前端、Python ML、C++ graph_kernel。

### 4.2 生产 profile

文件：`deploy/vps/docker-compose.prod.yml`

在本地 5 服务基础上增加 `graph_kernel:4300`。镜像来自 GHCR：

- `ghcr.io/wssachilles/mycode-telegram-backend`
- `ghcr.io/wssachilles/mycode-telegram-rust-gateway`
- `ghcr.io/wssachilles/mycode-telegram-go-delivery-consumer`
- `ghcr.io/wssachilles/mycode-telegram-rust-recommendation`
- `ghcr.io/wssachilles/mycode-telegram-cpp-graph-service`

镜像 tag = commit 前 7 位 + `master-latest`。

### 4.3 外部依赖

| 依赖 | 用途 |
| --- | --- |
| MongoDB Atlas | 消息、Space、推荐轨迹、图边、会话状态 |
| PostgreSQL (Supabase) | 权威用户账号、实验存储 |
| Redis (compose 内) | Streams、PubSub、缓存、BullMQ、presence |
| Firebase Hosting | 前端静态托管 |
| GCP Cloud Run | Python ML 服务 |
| GCS | 模型 artifact 与行为归档 |

## 5. 关键数据路径

### 5.1 消息投递（Go primary）

1. Node 写 `chat:delivery:bus:v1`（topic `fanout_requested` 等）。
2. Go Consumer 状态机消费：`Spawning → Connecting → EnsuringGroup → DrainingPEL → Running`。
3. Primary：`ExecuteFanout` 分 chunk 写 Mongo 投递投影，完成 chunk 幂等跳过。
4. 失败：`DecidePrimaryFailure` → Handled / QueueRetry（XAdd 回主总线）/ Terminal。
5. 毒消息：写 DLQ 后 XAck，不留在 PEL。
6. 副作用：PubSub `sync:update:wake:v1` / `user:online|offline` / `notification`，由 Node Realtime 推给客户端。

### 5.2 实时边界（Rust Edge）

- Rollout：`GATEWAY_REALTIME_ROLLOUT_STAGE` ∈ `shadow | compat_primary | rust_edge_primary`。
- Socket 终结：`GATEWAY_REALTIME_SOCKET_TERMINATOR` ∈ `node | rust`（仅 rust_edge_primary 下生效）。
- 业务上游仍是 Node（鉴权、发消息、已读、群组）；Rust 负责连接生命周期与事件桥。
- Streams：`realtime:ingress:v1`、`realtime:delivery:v1`、`realtime:dlq:v1`；兼容派发 `realtime:compat:dispatch:v1`。

### 5.3 推荐 Feed

1. 前端 `POST /api/space/feed` → Node `spaceService` → `resolveFeedRuntime`。
2. mode=`primary`：调 Rust `POST /recommendation/candidates`（默认 9s 超时，zod 契约校验）。
3. Rust 管道：Query Hydration → Source Retrieval → Hydrate/Filter/Score（回调 Node `/internal/recommendation`）→ Local Scorers → Selector → PostSelection → Rescue → Serving → SideEffects。
4. 图召回可走 C++ `/graph/batch`（支持 shadow compare）。
5. 失败/空：回落 Node `SpaceFeedMixer` baseline；特殊弃权 `ranked_cursor_abstention_v1` / `safety_context_abstention_v1`。
6. 决策日志：`recommendation_decision_log_v1` + `canonicalDecisionJson` 指纹，供 OPE / promotion / shadowPolicy。

### 5.4 前端实时投影

1. chat-core Worker 内 Socket.IO：`authenticate` → `realtimeBatch` 批量信封。
2. Worker 内 `realtimeIngest` 切片、背压、产出 ChatPatch（p0/p1/p2 QoS）。
3. Comlink 推回主线程 `messageStore`，entity LRU + 投影数组触发虚拟列表重渲染。
4. 本地持久化默认 SQLite-OPFS，可回退 Dexie IndexedDB 并做 shadow compare。
5. WASM 加速：seq 合并、并行搜索、patch 压缩、ChaCha20-Poly1305。

## 6. 控制面与发布

| 能力 | 落点 |
| --- | --- |
| 健康检查 | 各服务 `/health`；backend 另有 `/ready`（Mongo/PG/Redis/AI + controlPlane） |
| Capability ownership | Node `services/controlPlane/capabilityOwners.ts` 输出四能力 owner 与 fallback |
| 生命周期控制面 | Node `runtimeControlPlane` + `policyEngine`；Gateway 另有 `/gateway/ops/*` |
| 投递 replay | `POST /api/ops/chat-delivery/replay`；Go `/ops/platform/replay/*` |
| DLQ | `chat:delivery:bus:dlq:v1` / `platform:events:dlq:v1` / `realtime:dlq:v1` |
| Canary | `chat:delivery:canary:v1`，mismatch/DLQ 阈值可配 |
| 发布 | `release_backend.sh` + `release_gate.sh`；回滚 = 切换 `/opt/telegram/current` 软链 |
| 灰度回退 | env 翻转：`DELIVERY_EXECUTION_MODE`、`GATEWAY_REALTIME_SOCKET_TERMINATOR`、`RUST_RECOMMENDATION_MODE`、`CPP_GRAPH_KERNEL_ENABLED` |

## 7. 已知文档/实现缺口（as-built）

1. embedding Phase 0.5 代码与 dry-run 就绪，**生产未授权**；`tools/release/verify_all.sh` 依赖外部 digest 且 live audit 可 fail-closed。
2. Rust 侧 ThunderStore / ImpressionBloomFilter / RealtimeFeatureProvider 已实现但主路径未接线。
3. 前端离线队列只写不重放；生产 Worker 仍为单体 `chatCore.worker.ts`。
4. Python `ml-services/app.py` 与 `telegram-light-jobs` 存在 crawl/archive 双实现。
5. gateway / recommendation 的 compose 服务无 healthcheck（依赖 ops HTTP / 人工确认）。

Capability readiness 检查：`deploy/vps/check_*_readiness.sh`，输出契约见 [phase-status.md](phase-status.md) 与 `deploy/vps/README.md`。
