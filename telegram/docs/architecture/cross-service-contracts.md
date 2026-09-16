# 跨服务契约

契约真相来源在各服务代码内；本文是索引与对照表。修改 wire 格式时必须同步更新对应 owner 侧契约类型与本文。

## 1. Redis Streams

### 1.1 投递总线（Node → Go）

| Stream | 默认 Key | Producer | Consumer | 用途 |
| --- | --- | --- | --- | --- |
| 投递主总线 | `chat:delivery:bus:v1` | Node `chatDelivery/busContracts` | Go delivery consumer | `fanout_requested` 等 |
| 投递 DLQ | `chat:delivery:bus:dlq:v1` | Go | 人工/外部 | 毒消息 |
| Canary | `chat:delivery:canary:v1` | Go | Node 对账 | 投影 canary 记账 |

Envelope：`DeliveryEventEnvelope`（`specVersion / producer / eventId / topic / emittedAt / partitionKey / payload`）。

主要 topic：`fanout_requested`、`fanout_replay_queued`、`fanout_projection_completed`、`fanout_projection_failed`。

### 1.2 平台事件（Node → Go）

| Stream / Channel | 默认 Key | 用途 |
| --- | --- | --- |
| 平台事件主总线 | `platform:events:v1` | `sync_wake_requested`、`presence_fanout_requested`、`notification_dispatch_requested` |
| 平台 DLQ | `platform:events:dlq:v1` | 平台毒消息 |
| 平台回放 | `platform:events:replay:v1` | 未识别 topic / shadow 未 publish 的回放队列 |
| 回放完成标记 | `platform:events:replay:v1:completed` | hash，field=`topic:eventId` |
| Wake PubSub | `sync:update:wake:v1` | Go → Node Realtime 唤醒 |
| Wake 修复 | `sync:update:wake:repair:v1` | 修复路径 |
| 在线/离线 | `user:online` / `user:offline` | presence 广播 |
| 通知 | `notification` | 通知派发 |

Envelope：`PlatformEventEnvelope`。

### 1.3 实时边界（Gateway）

| Stream / Channel | 默认 Key | 用途 |
| --- | --- | --- |
| Ingress | `realtime:ingress:v1` | 会话/命令进入实时边界（group `gateway-realtime-boundary`） |
| Delivery | `realtime:delivery:v1` | 实时投递事件（group `gateway-realtime-delivery`） |
| DLQ | `realtime:dlq:v1` | 实时边界毒消息 |
| Compat dispatch | `realtime:compat:dispatch:v1` | Rust → Node 兼容派发（Pub/Sub） |

信封契约（Gateway `realtime/contracts`）：

- `realtime.event.v1`：SessionOpened/Closed/Heartbeat、PresenceUpdated、TypingUpdated、MessageCommandRequested、ReadAckRequested
- `realtime.delivery.v1`：Message / Presence / Typing / ReadReceipt / GroupUpdate
- `realtime.compat.dispatch.v1`

### 1.4 推荐与特征

| Key 模式 | 用途 |
| --- | --- |
| `recommendation:serve:v1:{fingerprint}` | Serve 二级缓存 |
| `recommendation:source:v1` | Source 缓存 |
| `news:trends:rust:v1` | 新闻趋势缓存 |
| `rf:user:{id}:recent_actions` | 实时用户特征 ZSET（当前生产链路未闭合） |

## 2. HTTP 内部 API

### 2.1 Backend Internal（供 Rust Recommendation / Graph Kernel）

Base：`http://backend:5000/internal`

| 路径 | 调用方 | 用途 |
| --- | --- | --- |
| `/internal/recommendation/query` | Rust rec | 整批 query hydrate |
| `/internal/recommendation/query-hydrators/{name\|batch}` | Rust rec | 单/批 hydrator patch |
| `/internal/recommendation/sources/{name\|batch}` | Rust rec | source 召回 |
| `/internal/recommendation/retrieval` | Rust rec | 旧式整体 retrieval |
| `/internal/recommendation/hydrate` | Rust rec | 候选水合 |
| `/internal/recommendation/score` | Rust rec | 模型打分（Phoenix/Engagement） |
| `/internal/recommendation/ranking` | Rust rec | ranking 阶段 |
| `/internal/recommendation/post-selection/*` | Rust rec | 选择后再水合/过滤 |
| `/internal/recommendation/providers/graph/authors` | Rust rec | 图谱作者物化 |
| `/internal/graph-kernel/snapshot` | C++ | 快照分页拉取（v1/v2 generation） |

### 2.2 Rust Recommendation 对外

| 路径 | 调用方 | 说明 |
| --- | --- | --- |
| `POST /recommendation/candidates` | Node feed | 主候选 API；需 internal token（未配置时放行，依赖网络隔离） |
| `POST /news/trends` | Node newsTrends | 新闻趋势 |
| `GET /health`、`GET /readiness` | 运维 | |
| `GET /ops/recommendation[/summary]` | 运维 | |

### 2.3 C++ Graph Kernel

| 路径 | 调用方 | 说明 |
| --- | --- | --- |
| `POST /graph/batch` | Rust rec、Node kernelClient | 一次返回多类邻居/桥接/共现 |
| `POST /graph/neighbors` 等 | 同上 | 单类查询 |
| `POST /graph/overlap` | 同上 | A/B 共同邻居 |
| `GET /health`、`/ready`、`/ops/graph`、`/metrics` | 运维 | |

### 2.4 Go Delivery Ops

| 路径 | 说明 |
| --- | --- |
| `GET /health` | 依赖 replay worker readiness |
| `GET /ops/summary` | 消费统计 |
| `GET /ops/platform/replay/summary` | 回放摘要 |
| `POST /ops/platform/replay/drain` | 手动 drain，需 `X-Internal-Token` |

### 2.5 Python ML（经 Node 代理）

Node `mlProxy` / client 转发：

| ML 路径 | Node 入口 |
| --- | --- |
| `POST /ann/retrieve` | `/api/ml/ann/retrieve` 等 |
| `POST /phoenix/predict` | `/api/ml/phoenix/predict` |
| `POST /vf/check`、`/vf/check/v2` | VFClient（v1→v2 可降级） |
| `POST /feed/recommend` | FeedRecommendClient |
| `POST /agent/respond` | agentPlaneClient |
| `POST /jobs/*` | Cloud Scheduler / 内部 cron（`CRON_SECRET`） |

前端 **不直连** Python。

## 3. Socket.IO 协议（客户端可见）

定义：Backend `src/services/socket/types.ts`；Gateway 兼容面事件名同构。

**Client → Server**：`authenticate`、`sendMessage`(ack)、`joinRoom`、`leaveRoom`、`updateStatus`、`typingStart`、`typingStop`、`presenceSubscribe`、`presenceUnsubscribe`、`readChat`

**Server → Client**：`authenticated` / `authError`、`message`、`userOnline` / `userOffline` / `onlineUsers` / `userStatusChanged` / `presenceUpdate`、`typingStart` / `typingStop` / `userTyping`、`readReceipt`、`groupUpdate`、**`realtimeBatch`**（统一批量信封）

当前 `emitLegacyRealtimeEvents = false`，生产以 `realtimeBatch` 为准。

同步兼容面：`/api/sync/*`（`SYNC_PROTOCOL_VERSION=2`，水位 `updateId`）。

## 4. 推荐结果与决策日志

| 契约 | Owner | 说明 |
| --- | --- | --- |
| `RecommendationQueryPayload` / `CandidatePayload` / `ResultPayload` | Rust contracts + Node zod | Feed 主契约 |
| `recommendation_decision_log_v1` | Node `decisionLog/contracts.ts` | 含 candidatePoolSha256、propensity |
| `canonicalDecisionJson` | Node | 全仓指纹基元（键排序 + f64 hex） |
| Randomized slate v1/v2 | Rust contracts | 确定性可重放 RNG（ChaCha20+HKDF） |
| 实时协议 | Node `realtimeProtocol/contracts.ts` | `REALTIME_PROTOCOL_VERSION=1` |

## 5. 版本与兼容策略

1. wire 契约变更必须 bump 版本字段或 path，并保留至少一个兼容读路径。
2. Node↔Rust 推荐契约以 zod schema + Rust serde 类型双侧校验；违约抛 `rust_recommendation_contract_violation`。
3. 实时 rollout 以 stage 字段切换 owner，禁止在无 stage 的情况下直接改 terminator。
4. 决策日志与 OPE 输入必须可指纹复现；未验证投影 fail-closed（`evaluateOpeV2`）。
