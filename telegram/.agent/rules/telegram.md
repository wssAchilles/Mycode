---
trigger: always_on
---

## 运行依赖与端口

- Node.js ≥ 18 / npm ≥ 9（前后端）。
- Python 3.11（ML）。
- 数据层：MongoDB Atlas、PostgreSQL（Supabase 或本地）、Redis（Upstash 或本地）。
- 默认端口：后端 HTTP `5000`（Render 上 `10000`），AI Socket `5850`（可禁用），前端 Vite Dev `5173`，ML FastAPI `8000`。

## 环境变量

> 建议集中放在根目录 `.env`，前端需以 `VITE_` 前缀暴露。下面给出按服务拆分的清单（均需自行填值，未写默认则为必填）。

### 当前生产配置（源自项目根目录 `.env`，敏感值已打码）

- 运行环境：`NODE_ENV=production`，`PORT=10000`
- PostgreSQL：`postgresql://postgres.cozmwcslflwnzvcydmgb:%40********@aws-0-us-west-2.pooler.supabase.com:5432/postgres`
- Redis：`rediss://default:********@true-filly-39588.upstash.io:6379`
- MongoDB：`mongodb+srv://Telegram:******@telegram.wtcymhw.mongodb.net/telegram_clone?...`
- JWT：`JWT_SECRET=<64-byte hex>`，`JWT_EXPIRES_IN=7d`
- AI：`AI_SOCKET_ENABLED=false`（Socket 已禁用，走 HTTP）
- Gemini：`GEMINI_API_KEY=AIzaSy***************`
- ML 服务：`ANN_ENDPOINT / PHOENIX_ENDPOINT / VF_ENDPOINT` 指向 `https://telegram-ml-services.onrender.com/*`
- 前端/后端域名：`FRONTEND_URL=https://telegram-liart-rho.vercel.app`，`BACKEND_URL=https://telegram-clone-backend-88ez.onrender.com`
- 前端运行时：`VITE_API_BASE_URL=https://telegram-clone-backend-88ez.onrender.com`，`VITE_SOCKET_URL=https://telegram-clone-backend-88ez.onrender.com`

### 后端必需

| 变量               | 说明               | 默认 / 备注                                                        |
| ------------------ | ------------------ | ------------------------------------------------------------------ |
| `NODE_ENV`       | 运行环境           | `development`（Render 为 `production`）                        |
| `PORT`           | HTTP 端口          | 5000（Render `10000`）                                           |
| `MONGODB_URI`    | Mongo 连接串       | 必填，支持 `mongodb+srv://`                                      |
| `DATABASE_URL`   | PostgreSQL 直连串  | 若缺省则走 `PG_HOST/PG_PORT/PG_USERNAME/PG_PASSWORD/PG_DATABASE` |
| `REDIS_URL`      | Redis 连接         | 用于 BullMQ、Pub/Sub、事件流等                                     |
| `JWT_SECRET`     | ≥16 字符签名秘钥  | 必填                                                               |
| `GEMINI_API_KEY` | Google Gemini 密钥 | AI 聊天必需                                                        |

### 后端可选 / 调优

| 变量                                                            | 用途                                                                                                                                                                                                    | 默认                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `AI_SOCKET_ENABLED`                                           | 是否启用 AI Socket 服务器                                                                                                                                                                               | `true`（生产建议 `false`） |
| `AI_SOCKET_PORT`                                              | AI Socket 端口                                                                                                                                                                                          | `5850`                       |
| `JWT_EXPIRES_IN`                                              | 访问令牌有效期                                                                                                                                                                                          | `15m`                        |
| `JWT_REFRESH_EXPIRES_IN`                                      | 刷新令牌有效期                                                                                                                                                                                          | `7d`                         |
| `ANN_ENDPOINT`                                                | Two-Tower 召回服务 URL                                                                                                                                                                                  | 若未设则本地回退               |
| `PHOENIX_ENDPOINT`                                            | Phoenix 排序服务 URL                                                                                                                                                                                    | 未设则停用打分器               |
| `VF_ENDPOINT`                                                 | 安全过滤服务 URL                                                                                                                                                                                        | 未设则仅用 `isNsfw` 回退     |
| `MONGODB_*`                                                   | 连接调优：`SERVER_SELECTION_TIMEOUT_MS`/`SOCKET_TIMEOUT_MS`/`CONNECT_TIMEOUT_MS`/`MAX_POOL_SIZE`/`FORCE_IPV4`/`TLS_ALLOW_INVALID_CERTIFICATES`/`DIRECT_CONNECTION`/`RECONNECT_DELAY_MS` | 见 `src/config/db.ts`        |
| `PG_HOST/PG_PORT/PG_USERNAME/PG_PASSWORD/PG_DATABASE`         | 分别指定 PostgreSQL 连接                                                                                                                                                                                | 仅当未提供 `DATABASE_URL`    |
| `REDIS_HOST/REDIS_PORT/REDIS_PASSWORD`                        | 本地 Redis 配置                                                                                                                                                                                         | 仅当未提供 `REDIS_URL`       |
| `UPSTASH_REDIS_REST_URL`                                      | 事件流可选 REST 端点                                                                                                                                                                                    | 事件聚合回退日志               |
| `EXPERIMENTS_ENABLED` / `EXPERIMENT_LOG_ENDPOINT`           | A/B 实验开关与日志上报                                                                                                                                                                                  | 可选                           |
| `METRICS_STATSD_HOST` / `METRICS_STATSD_PORT`               | StatsD 指标上报                                                                                                                                                                                         | 可选                           |
| `NEO4J_ENDPOINT/NEO4J_USERNAME/NEO4J_PASSWORD/NEO4J_DATABASE` | 图召回客户端                                                                                                                                                                                            | 未配置则跳过图召回             |
| `FAISS_EXPORT_DIR`                                            | 特征导出目录                                                                                                                                                                                            | 可选                           |

### 前端（Vite）

> `.env.example` 提供了基础项，但代码同时读取下列变量；请补齐命名保持一致（可与后端共用同一份 `.env`）。

| 变量                      | 作用                                          | 默认值                                                        |
| ------------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| `VITE_API_BASE_URL`     | REST API 基址（不含 `/api`）                | `https://telegram-clone-backend-88ez.onrender.com`          |
| `VITE_SOCKET_URL`       | 主 Socket.IO 地址                             | 同上                                                          |
| `VITE_AI_SOCKET_URL`    | AI Socket.IO 地址                             | （AI Socket 生产已禁用；如启用请填写云端 AI Socket 域名）     |
| `VITE_ANN_ENDPOINT`     | ML 召回服务                                   | `https://telegram-ml-services.onrender.com/ann/retrieve`    |
| `VITE_PHOENIX_ENDPOINT` | ML 排序服务                                   | `https://telegram-ml-services.onrender.com/phoenix/predict` |
| `VITE_VF_ENDPOINT`      | ML 安全过滤                                   | `https://telegram-ml-services.onrender.com/vf/check`        |
| `VITE_API_URL`          | （仅智能回复回退）API 完整前缀（含 `/api`） | `https://telegram-clone-backend-88ez.onrender.com/api`      |

> 备注：`frontend/.env.example` 使用 `VITE_WS_URL`，实际代码读取 `VITE_SOCKET_URL`，建议同时设置两者或更新示例文件。

### ML 服务

| 变量                      | 作用                                   | 默认                                                 |
| ------------------------- | -------------------------------------- | ---------------------------------------------------- |
| `PORT`                  | FastAPI 服务端口                       | `8000`（由 Dockerfile 设置，可被 Render 注入）     |
| `FAISS_INDEX_TYPE`      | FAISS 索引类型                         | `ivf_pq`                                           |
| `FAISS_NPROBE`          | IVF nprobe                             | `16`                                               |
| `USE_FAISS`             | 是否启用 FAISS                         | `true`                                             |
| `DRIVE_ID_TWO_TOWER_50` | Google Drive 文件 ID（Two-Tower 权重） | 1PzT1elcXRPjlIswEma7tJK3ciftaLMlY                    |
| `DRIVE_ID_PHOENIX_3`    | Google Drive 文件 ID（Phoenix 权重）   | 1bODZspZX98RLKxzxLOLoe2yxg_QQ3dUf                    |
| `API_ENDPOINT`          | 后端聚合数据接口（自动重训脚本）       | `https://telegram-clone-backend-88ez.onrender.com` |
| `REDIS_URL`             | 事件流/重训练可选                      | 空则仅日志                                           |
| `BACKEND_URL`           | 新闻爬虫推送地址                       | `https://telegram-clone-backend-88ez.onrender.com` |

## 后端服务（telegram-clone-backend）

- 入口：`src/index.ts`；TypeScript 编译到 `dist/`，`npm start` 运行 `dist/index.js`。
- 构建/启动脚本：`npm run dev`（nodemon 热重载）、`npm run build`（先安装 dev 依赖再 `tsc`）、`npm start`（生产）。
- HTTP 配置：`PORT`；JSON 与表单体积上限 50MB；静态文件 `/api/uploads/*` 需 Bearer Token，路径映射 `uploads/`。
- CORS：允许本地 `3000/5173/5174`、Vercel 域及预览（见 `src/middleware/cors.ts`）。
- 健康检查：`GET /health` 并发检测 Mongo / Postgres / Redis / Gemini KEY，异常返回 `206/503`。
- 数据库：
  - MongoDB via `MONGODB_URI`，可调超时、池大小、IPv4 优先、TLS 证书等（`src/config/db.ts`）。
  - PostgreSQL 优先用 `DATABASE_URL` + SSL，或 `PG_*`；启动时 `sequelize.sync`（开发 `alter`，生产仅创建）。
- Redis：`REDIS_URL` 供 BullMQ 队列、Redis Pub/Sub、事件流、缓存；BullMQ 队列名称见 `queueService.ts`。
- AI Socket：单独 HTTP+Socket.IO 服务器（`src/aiSocketServer.ts`），端口 `AI_SOCKET_PORT`，可通过 `AI_SOCKET_ENABLED=false` 关闭。
- 推荐/ML 联动：
  - `ANN_ENDPOINT` -> Two-Tower 召回 HTTP 客户端。
  - `PHOENIX_ENDPOINT` -> PhoenixScorer 远程打分。
  - `VF_ENDPOINT` -> SafetyFilter 远程内容过滤。
- 其他可选：StatsD 指标上报、Neo4j 图召回、实验日志、FAISS 特征导出目录等仅在设置对应环境变量后生效。
- 部署：`render.yaml`（Node runtime、region singapore、build `npm install --include=dev && npm run build`，start `npm start`，健康检查 `/health`，`NODE_OPTIONS=--dns-result-order=ipv4first`）。
- 数据持久化：`uploads/`（用户上传）、数据库自身；无持久化的进程内状态。

## 前端（telegram-clone-frontend）

- 技术栈：React 19 + Vite 7 + TypeScript，状态管理 `zustand`，动画 `framer-motion`，图表 `recharts`，Socket.IO 客户端。
- 脚本：`npm run dev`（默认 `5173`）、`npm run build`、`npm run preview`、`npm run lint`、`npm run test`（Vitest/JSdom）。
- 配置：`vite.config.ts` 设置 `envDir: '..'` 读取根 `.env`；输出目录 `dist/`。ESLint 配置在 `eslint.config.js`。
- 部署：`vercel.json` 设定 `buildCommand: npm run build`，输出 `dist`，并将所有路径重写到 `/index.html`（SPA）。
- 运行时配置入口：各服务文件读取 `VITE_*` 变量；AI Socket 断线会自动回退 HTTP `/api/ai/chat`。

## ML 推理与训练服务（ml-services）

- 核心服务：`app.py` FastAPI，端点 `/health`、`/ann/retrieve`（Two-Tower 召回）、`/pho