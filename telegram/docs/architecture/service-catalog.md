# 服务目录

端口默认值与 compose 绑定以 `deploy/vps/docker-compose*.yml`、`deploy/vps/backend.env.example` 为准。生产端口仅监听 localhost / 私网。

## 核心服务

| 服务 | 目录 | 语言 | 默认端口 | 健康检查 | 镜像 |
| --- | --- | --- | --- | --- | --- |
| Backend | `telegram-clone-backend/` | Node.js | 5000 | `GET /health`、`GET /ready` | `mycode-telegram-backend` |
| Gateway | `telegram-rust-gateway/` | Rust | 4000 | `GET /health` | `mycode-telegram-rust-gateway` |
| Recommendation | `telegram-rust-workspace/crates/telegram-rust-recommendation` | Rust | 4200 | `GET /health`、`GET /readiness` | `mycode-telegram-rust-recommendation` |
| Delivery Consumer | `telegram-go-delivery-consumer/` | Go | 4100 | `GET /health` | `mycode-telegram-go-delivery-consumer` |
| Graph Kernel | `telegram-cpp-graph-service/` | C++ | 4300 | `GET /health`、`GET /ready`、`GET /ops/graph` | `mycode-telegram-cpp-graph-service` |

## 外围运行时

| 服务 | 目录 | 语言 | 部署位置 | 说明 |
| --- | --- | --- | --- | --- |
| Web Client | `telegram-clone-frontend/` | React 19 + TS | Firebase Hosting | PWA；生产不进 VPS compose |
| ML Services | `ml-services/` | Python | GCP Cloud Run (8000) | ANN / Phoenix / VF / jobs / agent |
| Light Jobs | `telegram-light-jobs/` | Python | Cloud Run / 外部 cron | crawl / archive 轻任务 |
| Frontend WASM | `telegram-clone-frontend/src/core/wasm/chat_wasm` | Rust → WASM | 随前端构建 | seq/search/patch/crypto 加速 |

## 数据与中间件

| 组件 | 用途 | 关键键 / 集合 |
| --- | --- | --- |
| Redis | Streams、PubSub、缓存、BullMQ、presence、session | 见 [cross-service-contracts.md](cross-service-contracts.md) |
| MongoDB | 消息、Space、推荐轨迹、图边、会话投影 | `messages`、`posts`、`user_actions`、`chatmemberstates`、`updatelogs` 等 |
| PostgreSQL | 权威用户、实验 | `User`（Sequelize）、实验存储 |
| GCS | 模型 artifact、行为归档 | bucket `telegram-467705-recsys` |

## 各服务入口速查

### Backend
- 进程入口：`src/index.ts`
- 路由挂载：`src/bootstrap/routes.ts`
- Internal provider（供 Rust 调用）：`/internal/recommendation/*`、`/internal/graph-kernel/*`
- Ops：`/api/ops/*`

### Gateway
- 进程入口：`src/main.rs`
- 全量反代目标：`GATEWAY_UPSTREAM_HTTP`（默认 `http://backend:5000`）
- Ops：`/gateway/ops/*`

### Recommendation
- 进程入口：`crates/telegram-rust-recommendation/src/main.rs`
- 主 API：`POST /recommendation/candidates`
- Ops：`/ops/recommendation`、`/ops/recommendation/summary`
- 回调 Node：`RUST_RECOMMENDATION_BACKEND_URL`（默认 `http://backend:5000/internal/recommendation`）

### Delivery Consumer
- 进程入口：`cmd/delivery-consumer/main.go`
- Ops：`/health`、`/ops/summary`、`/ops/platform/replay/summary`、`POST /ops/platform/replay/drain`

### Graph Kernel
- 进程入口：`src/main.cpp`
- 查询：`POST /graph/batch` 等
- Ops：`/ops/graph`、`/ops/graph/summary`、`GET /metrics`

### ML Services
- 进程入口：`ml-services/app.py`
- 主 API：`/ann/retrieve`、`/phoenix/predict`、`/vf/check[/v2]`、`/feed/recommend`、`/jobs/*`、`/agent/*`

### Light Jobs
- 进程入口：`telegram-light-jobs/app.py`
- API：`/health`、`POST /jobs/crawl`、`POST /jobs/archive-user-actions`

## 最小门禁（按边界）

见根 `README.md`「高价值门禁」表。新增服务时请同步补充该表与本文件。
