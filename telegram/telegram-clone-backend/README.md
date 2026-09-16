# Telegram Clone Backend

Node.js 公开 API 与控制面（Public API / Control Plane 的 canonical owner）。

技术栈：Express + Socket.IO + MongoDB (Mongoose) + PostgreSQL (Sequelize) + Redis (缓存 / BullMQ / PubSub)。

## 职责边界

- 认证与用户、消息、群组、联系人、上传、Space、News 等公开 HTTP API
- Socket.IO 实时面（当前以 `realtimeBatch` 统一信封）
- 推荐 **fallback adapter** 与 `/internal/recommendation` provider（供 Rust 反向调用）
- 决策日志、OPE、promotion、实验与控制面（capability owners / runtime control plane / policy engine）
- ML 代理、图核 client、投递与平台事件总线生产者

**算法所有权**：推荐算法 canonical owner 为 Rust。Node 冻结 sources/filters/selectors/scorers/ranking_weights 的增长，仅保留 adapter / fallback / hydration 角色。见 `src/services/recommendation/contracts/runtimeOwnership.ts`。

## 启动

```bash
cp deploy/vps/backend.env.example .env   # 按本机地址修改 Mongo/PG/Redis
npm ci
npm run dev
```

启动顺序（`src/index.ts`）：中间件 → `/health` `/ready` → 路由 → 数据库连接 → Socket + BullMQ + fanout worker → cron → listen（默认 5000）。

- Mongo：阻塞连接；dev 失败可降级，prod fatal
- PG / Redis：非阻塞；失败进入 degraded / compat
- 队列失败：整链降级同步 fanout

## 目录结构

```text
src/
├── index.ts                 # 进程入口
├── bootstrap/               # database / routes / socket / scheduler
├── config/                  # mongo / sequelize / redis / origins
├── middleware/              # auth / error / logger / cors / rateLimit / validate
├── controllers/             # 业务控制器
├── routes/                  # HTTP 路由（含 space/ ops/ internal/）
├── schemas/                 # zod 请求校验
├── models/                  # PG + Mongo 模型
├── services/
│   ├── recommendation/      # 管道 fallback、契约、decisionLog、OPE、promotion
│   ├── chatDelivery/        # outbox / fanout / 投递总线契约
│   ├── platformBus/         # 平台事件
│   ├── realtimeProtocol/    # Node/Rust 实时协议
│   ├── controlPlane/        # capabilityOwners / runtimeControlPlane / policyEngine
│   ├── socket/              # Socket.IO handlers
│   ├── graphKernel/         # 图核 client 与快照 generation
│   └── ...
├── workers/fanoutWorker.ts
└── utils/
```

## 关键 API 面

| 前缀 | 说明 |
| --- | --- |
| `/api/auth` | 注册登录；PG 不可用时可回退 Mongo 控制器 |
| `/api/messages`、`/api/contacts`、`/api/groups` | 聊天域 |
| `/api/sync` | 差量同步（协议 v2，水位 updateId） |
| `/api/space/*` | 动态 Feed、互动、资料、搜索 |
| `/api/news` | 新闻 |
| `/api/ml` | Python ML 代理 |
| `/api/ops/*` | 运维控制面 |
| `/internal/recommendation/*` | Rust 推荐阶段化 provider |
| `/internal/graph-kernel/*` | C++ 快照拉取 |
| `/health`、`/ready` | 探活与就绪 |

## 推荐链路（简图）

```text
POST /api/space/feed
  → spaceService.getFeedPage
  → resolveFeedRuntime
       ├─ primary: RustRecommendationClient → :4200 /recommendation/candidates
       │            (zod 校验；失败 → fallback)
       └─ fallback: SpaceFeedMixer baseline pipeline
  → decisionLog (canonicalDecisionJson 指纹)
```

## 门禁

```bash
npm run build
npm test
```

## 已知结构债

- `src/services/spaceService.ts` 过大，应继续按域拆分
- `User` / `UserMongo` 双轨认证
- `src/grpc/` 空目录、部分 legacy 路由门禁仍在切换期

## 相关文档

- [系统总览](../docs/architecture/system-overview.md)
- [跨服务契约](../docs/architecture/cross-service-contracts.md)
- [运行时开关](../docs/architecture/runtime-switches.md)
- `docs/api.md`、`docs/recommendation/`
