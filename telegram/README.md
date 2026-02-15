# Telegram Clone — 工业级全栈聊天 & 社交平台

> 一个面向生产环境的 Telegram 克隆应用，拥有完整的**实时通讯**、**X/Twitter 风格推荐系统**、**AI 智能助手**、**社交动态 (Space)**、**新闻聚合**和**端到端加密**能力。三服务微架构 (React 前端 + Node.js 后端 + Python ML 服务)，对标 Telegram-TT 与 X-Algorithm 的工程深度。

## 项目亮点

| 领域 | 特性 |
|------|------|
| **实时通讯** | Socket.IO 双向通信 · Redis Adapter 多节点扩展 · PTS/QTS Gap Recovery（Telegram 协议级同步） |
| **推荐系统** | 7 阶段管道 (Source → Hydrate → Filter → Score → Select → SideEffect) · 7 个召回源 · 12 个过滤器 · 8 个评分器 · SimClusters / RealGraph / UserSignal 全套 |
| **ML 服务** | Two-Tower ANN 召回 (FAISS) · Phoenix Transformer 精排（多任务 18+ 行为预测） · 三层内容安全审核 |
| **AI 助手** | Google Gemini 多模态（文本 + 图片理解） · 多会话管理 · 流式回复 · 智能建议 |
| **社交平台** | Space 动态 Feed · 帖子/评论/点赞/转发 · 关注体系 · 趋势标签 · 个人主页 |
| **新闻聚合** | RSS 爬虫 (BBC/Reuters/CNN) · SentenceTransformer 聚类 · 主题卡片 |
| **安全** | JWT 双令牌 + JTI 轮换 · Signal Protocol E2E 加密 · 三层内容审核 (规则 + ML + LLM) |
| **性能** | Web Worker 架构 (Comlink) · Rust/WASM 加速 · LRU 缓存 · 虚拟列表 · IndexedDB 离线 · PWA |
| **可观测性** | Web Vitals · Long Task Observer · Performance Marks · Sentry · Bundle Budget CI |

---

## 系统架构

<p align="center">
  <img src="docs/images/system-architecture.png" alt="System Architecture" width="100%" />
</p>

---

## 技术栈

### 前端

| 类别 | 技术 |
|------|------|
| **框架** | React 19 · TypeScript 5.8 · Vite 7 |
| **状态管理** | Zustand 5 (persist / immer) · Web Worker 投影层 |
| **实时通信** | Socket.IO Client 4.8 |
| **离线存储** | Dexie 4 (IndexedDB ORM) · idb-keyval |
| **虚拟化** | @tanstack/react-virtual 3 |
| **加密** | TweetNaCl (X25519 / XSalsa20-Poly1305) |
| **Worker** | Comlink 4 · Rust/WASM (wasm-bindgen + wasm-pack) |
| **UI/动画** | framer-motion · lucide-react · CSS 变量主题 · Glassmorphism |
| **Markdown** | react-markdown · remark-gfm · rehype-raw |
| **图表** | Recharts 3 (Admin Dashboard) |
| **PWA** | vite-plugin-pwa · Workbox 7 |
| **性能** | web-vitals · Performance Marks · Bundle Budget CI |
| **测试** | Vitest · @testing-library/react · v8 覆盖率 |

### 后端

| 类别 | 技术 |
|------|------|
| **运行时** | Node.js 18+ · TypeScript 5.8 |
| **框架** | Express 4 · Socket.IO 4.8 |
| **数据库** | MongoDB (Mongoose 8) · PostgreSQL (Sequelize 6) · Redis (ioredis 5) |
| **消息队列** | BullMQ 5 (Redis-backed) |
| **认证** | JWT (jsonwebtoken) · bcryptjs · Signal Protocol (libsignal) |
| **文件处理** | Multer 2 · Sharp (图片处理/缩略图) |
| **定时任务** | node-cron |
| **验证** | Zod 4 |
| **监控** | Sentry · Morgan |
| **AI 集成** | Google Gemini (多模态) |

### ML 服务

| 类别 | 技术 |
|------|------|
| **框架** | FastAPI · Python 3.11 |
| **深度学习** | PyTorch · Transformer Encoder |
| **向量检索** | FAISS (Flat / IVF / HNSW / IVF+PQ) |
| **NLP** | SentenceTransformer (all-MiniLM-L6-v2) · newspaper3k |
| **安全** | HuggingFace transformers (多标签分类器) |
| **调度** | APScheduler |
| **存储** | Google Cloud Storage (模型产物/行为归档) |
| **监控** | Sentry · StatSD |

### 基础设施

| 类别 | 技术 |
|------|------|
| **前端部署** | Vercel (SPA rewrite) |
| **后端部署** | Render |
| **ML 部署** | Google Cloud Run (4Gi / 1200s timeout) |
| **CI/CD** | Cloud Build (Docker cache / Artifact Registry) |
| **容器** | Docker · Python 3.11 Slim · 非 root 运行 |

---

## 项目结构

```
telegram/
├── telegram-clone-frontend/         # 🎨 React 前端 (SPA + PWA)
│   ├── src/
│   │   ├── core/                   # ⭐ 核心架构层
│   │   │   ├── workers/            #    Web Worker 聊天引擎 (1030行)
│   │   │   ├── bridge/             #    Comlink RPC 桥接
│   │   │   ├── chat/store/         #    LRU 消息缓存 + IDB 持久化
│   │   │   └── wasm/chat_wasm/     #    Rust/WASM 排序加速模块
│   │   ├── pages/                  #    路由页面 (Chat/Space/News/Admin)
│   │   ├── components/             #    UI 组件 (chat/space/ai/admin/common)
│   │   ├── features/chat/          #    聊天功能模块 + Store
│   │   ├── stores/                 #    Zustand 全局状态
│   │   ├── services/               #    API/Socket/加密/ML/分析
│   │   ├── hooks/                  #    自定义 Hooks
│   │   ├── perf/                   #    性能监控 (Web Vitals)
│   │   ├── pwa/                    #    Service Worker 注册
│   │   └── test/                   #    单元测试
│   ├── scripts/check-budgets.mjs   #    构建产物体积卡关
│   ├── vite.config.ts              #    Vite + PWA + Worker 配置
│   └── vercel.json                 #    Vercel 部署配置
│
├── telegram-clone-backend/          # 🔧 Node.js 后端
│   ├── src/
│   │   ├── controllers/            #    6 个控制器 (auth/message/group/ai/user/upload)
│   │   ├── models/                 #    31 个数据模型 (Sequelize + Mongoose)
│   │   ├── routes/                 #    15 个路由模块 (~80 API 端点)
│   │   ├── services/               #    核心业务服务
│   │   │   ├── recommendation/     #    ⭐ X/Twitter 风格推荐管道
│   │   │   │   ├── sources/        #       7 个召回源
│   │   │   │   ├── filters/        #       12 个过滤器
│   │   │   │   ├── scorers/        #       8 个评分器
│   │   │   │   ├── hydrators/      #       数据填充
│   │   │   │   ├── selectors/      #       候选集筛选
│   │   │   │   ├── sideeffects/    #       行为记录
│   │   │   │   └── framework/      #       管道编排
│   │   │   ├── experiment/         #    A/B 实验平台
│   │   │   ├── jobs/               #    定时任务 (SimClusters/RealGraph/特征导出)
│   │   │   └── ...                 #    消息/联系人/新闻/缓存/队列/同步/密钥
│   │   ├── middleware/             #    认证/CORS/限流/日志/错误处理
│   │   ├── workers/                #    BullMQ Fanout Worker
│   │   └── config/                 #    数据库/Redis/Sequelize 配置
│   ├── docs/                       #    API/推荐系统文档
│   └── tests/                      #    推荐系统/Space 测试
│
├── ml-services/                     # 🧠 Python ML 微服务
│   ├── app.py                      #    FastAPI 主服务 (2229行)
│   ├── recsys_dedup.py             #    推荐去重逻辑
│   ├── crawler/                    #    新闻 RSS 爬虫 + NLP 聚类
│   ├── scripts/                    #    训练/预处理/索引/部署脚本
│   │   ├── model_arch.py           #       Two-Tower 双塔模型定义
│   │   ├── phoenix_model.py        #       Phoenix Transformer 排序模型
│   │   ├── train_two_tower.py      #       Two-Tower 训练 (面向 H100)
│   │   ├── train_phoenix.py        #       Phoenix 训练 (AMP 混合精度)
│   │   ├── build_faiss_index.py    #       FAISS 向量索引构建
│   │   ├── safety_module.py        #       三层内容安全模块 (448行)
│   │   ├── auto_retrain.py         #       自动增量重训练
│   │   ├── refresh_features.py     #       用户特征向量刷新
│   │   └── publish_artifacts.py    #       模型产物发布到 GCS
│   ├── Dockerfile                  #    生产镜像 (Python 3.11 Slim)
│   └── cloudbuild.yaml             #    Cloud Build CI/CD
│
├── design-system/                   # 📐 UI 设计系统文档
├── PERFORMANCE_UPGRADE_PLAN.md      # 📊 4–6月性能优化路线图 (1144行)
└── 工业级聊天应用性能优化借鉴.md      # 📚 五大 IM 应用底层技术深度分析
```

---

## 核心功能

### 1. 实时聊天

- **私聊 & 群组聊天** — 完整的 1:1 和多人实时通讯
- **消息类型** — text / image / file / document / audio / video / system
- **seq 级已读回执** — 精确到每条消息的已读追踪
- **在线状态** — 实时 presence 订阅与推送
- **正在输入** — 实时 typing indicator
- **Reactions** — 表情反应选择器
- **GIPHY** — GIF 搜索与发送
- **群组管理** — 创建/加入/离开/成员管理 · owner/admin/member 角色体系
- **文件上传** — 图片/文件/视频 + Sharp 自动缩略图生成
- **PTS/QTS 同步** — Telegram 协议级 Gap Recovery，断线后精确补齐缺失消息

### 2. 推荐系统（X/Twitter Algorithm 级别）

完整复刻 X (Twitter) 的推荐管道架构：

```
┌────────────────────────────────────────────────────────────┐
│                    Recommendation Pipeline                  │
│                                                            │
│  ┌─────────┐  ┌──────────┐  ┌────────┐  ┌───────┐        │
│  │ Sources  │→│ Hydrators │→│ Filters │→│Scorers │        │
│  │ (7个)    │  │ (数据填充) │  │ (12个)  │  │ (8个)  │        │
│  └─────────┘  └──────────┘  └────────┘  └───────┘        │
│       │                                      │             │
│       ▼                                      ▼             │
│  ┌──────────────┐                    ┌──────────────┐     │
│  │ Cold Start    │                    │ Selector     │     │
│  │ Following     │                    │ (候选集筛选)   │     │
│  │ Graph (2-hop) │                    └──────┬───────┘     │
│  │ Popular       │                           │             │
│  │ TwoTower ANN  │                    ┌──────▼───────┐     │
│  │ NewsANN       │                    │ Side Effects │     │
│  │ Timeline Cache│                    │ (行为记录)    │     │
│  └──────────────┘                    └──────────────┘     │
└────────────────────────────────────────────────────────────┘
```

**召回源 (7个)**：Following · FollowingTimelineCache · Graph (2-hop 社交图) · Popular · TwoTower ANN · NewsANN · ColdStart

**过滤器 (12个)**：Age · BlockedUser · ConversationDedup · Duplicate · MutedKeyword · NewsExternalIdDedup · PreviouslyServed · RetweetDedup · Safety · SeenPost · SelfPost · VF (ML 安全)

**评分器 (8个)**：AuthorAffinity · AuthorDiversity · ContentQuality · Engagement · OON 降权 · Phoenix (ML 精排) · Recency · Weighted (加权融合)

**核心服务**：SimClusters (兴趣聚类) · RealGraph (社交亲密度) · UserSignal (行为信号) · FeatureCache (三层缓存)

### 3. ML 模型

#### Two-Tower 双塔召回模型
- NewsEncoder + UserEncoder → L2 归一化 → 余弦相似度
- 768 维 embedding，100 历史长度
- FAISS 向量索引 (支持 Flat / IVF / HNSW / IVF+PQ)
- 训练配置：BATCH_SIZE=65536 (面向 H100 80GB)

#### Phoenix Transformer 精排模型
- **Candidate Isolation Mask** — 候选项之间不能互相 Attend，防止信息泄漏
- **多任务头** — click / like / reply / repost × 4 基础任务 → 推导 18+ 行为预测
- 768 维 · 12 heads · 12 layers · Pre-Norm Transformer

#### 加权评分公式
```
score = like×2.0 + reply×5.0 + repost×4.0 + quote×4.5 + click×0.5 + share×2.5
        + shareViaDm×2.0 + shareViaCopy×1.5 + profileClick×1.0 + photoExpand×1.0
        + dwell×0.3 + dwellTime×0.05 + followAuthor×2.0
        - notInterested×5.0 - blockAuthor×10.0 - muteAuthor×4.0 - report×8.0
```

### 4. 内容安全审核（三层架构）

| 层级 | 引擎 | 策略 |
|------|------|------|
| **Layer 1** | 规则引擎 | 高危关键词直接拦截 · 中危触发 ML 复审 · 正则模式 · URL 黑名单 · 用户黑名单 |
| **Layer 2** | ML 分类器 | HuggingFace transformers 多标签分类 (spam/nsfw/violence/hate/harassment/misinfo) |
| **Layer 3** | LLM (预留) | 复杂场景的 LLM 审核 |

**Surface-aware 策略**：In-Network 允许 SAFE + LOW_RISK，Out-of-Network 仅允许 SAFE

### 5. AI 智能助手

- **Google Gemini** — 多模态对话（文本 + 图片理解）
- **Dual-Channel 通信** — Socket.IO 优先，自动降级到 HTTP REST
- **多会话管理** — 创建/切换/删除/归档
- **流式回复** — Socket 实时推送 AI 回复
- **Markdown 渲染** — react-markdown + GFM 语法支持
- **智能建议** — AI 对话建议芯片
- **独立 Socket 服务** — 端口 5850，与主聊天服务隔离

### 6. Space 社交平台

- **Feed 时间线** — ML 推荐驱动 · 无限滚动 · cursor 分页
- **发帖** — 文本 + 多媒体（图片/视频/GIF）
- **互动** — 评论 (抽屉式) · 点赞 · 转发 · 分享
- **个人主页** — 资料编辑 · 关注/粉丝
- **发现页** — 热门内容 · 推荐用户 · 趋势标签
- **通知** — 点赞/回复/转发/引用通知
- **推荐解释** — 展示每条推荐的理由
- **敏感内容** — 安全等级标签 + 模糊遮罩

### 7. 新闻聚合

- **RSS 爬虫** — 自动抓取 BBC / Reuters / CNN · 每小时运行
- **NLP 处理** — SentenceTransformer 标题嵌入 · K-Means 聚类分组
- **Topic 聚合** — 主题卡片 · 新闻简报
- **行为追踪** — impression / click / dwell / share 事件

### 8. 端到端加密

- **Signal Protocol (简化版)** — X25519 密钥交换 + XSalsa20-Poly1305 加密
- **PreKey Bundle** — Identity Key / Signed PreKey / One-Time PreKeys
- **密钥存储** — IndexedDB 专用 store (idb-keyval)

### 9. A/B 实验平台

- **实验管理** — 创建/暂停/恢复实验 · 流量分配
- **实验日志** — 行为归因与指标追踪
- **Admin Dashboard** — Recharts 可视化数据看板

---

## 前端性能架构

### Worker-Driven ChatCore

```
┌─────────────────┐    Comlink RPC     ┌────────────────────────┐
│   Main Thread    │  ←── ChatPatch ──  │   chatCore.worker.ts   │
│   (React UI)     │  ── setActive ──→  │        (1030行)         │
│                  │  ── ingest ────→   │                        │
│  ┌─────────────┐ │                    │  ┌──────────────────┐  │
│  │ messageStore│ │                    │  │ ChatCoreStore    │  │
│  │ (projection)│ │                    │  │ ├ LRU Cache (30) │  │
│  └─────────────┘ │                    │  │ ├ API Fetch      │  │
│                  │                    │  │ ├ IDB Persist    │  │
│                  │                    │  │ ├ PTS Sync       │  │
│                  │                    │  │ └ WASM (Rust)    │  │
└─────────────────┘                    └────────────────────────┘
```

### 性能优化清单

| 类别 | 技术 | 说明 |
|------|------|------|
| **线程分离** | Web Worker + Comlink | 聊天核心逻辑完全离主线程，零阻塞 |
| **计算加速** | Rust/WASM | `merge_sorted_unique_u32`、`diff_sorted_unique_u32` · opt-level="z" + LTO |
| **差量更新** | ChatPatch 系统 | 5 种 patch 类型 (reset/append/prepend/delete/update/meta) |
| **微任务调度** | Tick-end Scheduler | Telegram-TT 风格，合并同 tick 内多次更新 |
| **虚拟化** | @tanstack/react-virtual | overscan=5 · 动态高度估算 |
| **LRU 缓存** | Worker 内 LRU 30 聊天 | 自动淘汰最久未访问 |
| **离线存储** | Dexie IndexedDB | 复合索引 `[chatId+seq]` · 全文搜索 |
| **请求去重** | useApiQuery | 全局缓存 + pending 请求合并 |
| **路由分割** | React.lazy + Suspense | 全路由代码分割 + AnimatePresence 页面动画 |
| **Feed 去重** | seen/served 滑窗 | 200 条滑窗 · sessionStorage 持久化 |
| **分析批量** | 缓冲上报 | 10 条/批 · 5 秒定时 · visibilitychange 兜底 |
| **构建检查** | Bundle Budget CI | Worker ≤160KB · WASM ≤64KB · 主 JS ≤550KB |
| **监控** | Web Vitals + Long Task | CLS/FCP/INP/LCP/TTFB + `chat_switch` 打点 |
| **PWA** | Workbox + vite-plugin-pwa | 预缓存 + StaleWhileRevalidate 图片缓存 (200张/7天) |

---

## 数据模型

### PostgreSQL (31 个 Sequelize 模型)

用户与社交：`User` · `Contact` · `SpaceProfile` · `UserSettings` · `UserMongo`

群组：`Group` · `GroupMember` · `GroupState`

消息同步：`ChatCounter` · `ChatMemberState` · `UpdateCounter` · `UpdateLog`

加密密钥：`UserKey` · `OneTimePreKey`

Space 社交：`Post` · `Comment` · `Like` · `Repost` · `SpaceUpload`

推荐系统：`UserAction` · `UserFeatureVector` · `UserSignal` · `RealGraphEdge` · `ClusterDefinition` · `NewsUserVector` · `NewsUserEvent`

新闻：`NewsArticle` · `NewsSource`

实验：`Experiment`

### MongoDB (Mongoose)

消息存储：`Message` · `AiConversation`

### Redis

- 会话缓存 · 在线状态 · Socket.IO Adapter
- BullMQ 任务队列 · Pub/Sub
- FeatureCache (三层缓存：内存 → Redis → MongoDB)

---

## API 端点概览

| 模块 | 路由前缀 | 端点数 | 说明 |
|------|----------|--------|------|
| 认证 | `/api/auth` | ~6 | 注册/登录/刷新/登出/Token轮换 |
| 用户 | `/api/users` | ~5 | 资料/搜索/在线状态 |
| 联系人 | `/api/contacts` | ~6 | 添加/接受/拒绝/列表/阻止 |
| 消息 | `/api/messages` | ~8 | 发送/历史/已读/搜索/删除 |
| 群组 | `/api/groups` | ~14 | 完整 CRUD + 成员管理 + 角色 |
| 文件上传 | `/api/upload` | ~3 | 图片/文件/缩略图 |
| AI 聊天 | `/api/ai` | ~6 | 会话 CRUD/归档/发送消息 |
| Space | `/api/space` | ~20 | Feed/帖子/评论/关注/搜索/通知/趋势 |
| 新闻 | `/api/news` | ~8 | Feed/文章/主题/注入/事件追踪 |
| 分析 | `/api/analytics` | ~5 | Dashboard/指标/事件上报 |
| 特征 | `/api/features` | ~3 | 用户特征向量/刷新 |
| ML 代理 | `/api/ml` | ~5 | ANN/Phoenix/VF 安全检测代理 |
| 密钥 | `/api/keys` | ~4 | PreKey Bundle/Signal 密钥交换 |
| 同步 | `/api/sync` | ~3 | PTS/QTS 差量同步 |

### ML 服务端点 (FastAPI)

| 端点 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查（模型状态/FAISS/缓存） |
| `/ann/retrieve` | POST | Two-Tower ANN 召回 |
| `/phoenix/predict` | POST | Phoenix 多任务排序 |
| `/feed/recommend` | POST | 一体化推荐（ANN→Phoenix→VF，单次调用） |
| `/vf/check` | POST | 内容安全过滤 v1 |
| `/vf/check/v2` | POST | 增强版安全过滤（风险等级/分数/违规类型） |
| `/vf/blacklist/*` | POST | 动态黑名单管理 |
| `/vf/rules/add` | POST | 动态关键词规则 |
| `/jobs/crawl` | POST | 触发新闻爬取 |
| `/jobs/refresh-features` | POST | 触发用户特征刷新 |
| `/jobs/archive-user-actions` | POST | 行为日志归档到 GCS |
| `/jobs/import-news-corpus` | POST | MIND 语料导入 |

---

## 定时任务

| 任务 | 频率 | 触发方式 | 说明 |
|------|------|----------|------|
| 新闻爬取 | 每小时 | APScheduler + Cloud Scheduler | RSS → NLP 聚类 → 推送后端 |
| 用户特征刷新 | 每日 | `/jobs/refresh-features` | 重算用户嵌入写 MongoDB |
| Phoenix 自动重训练 | 每日 03:00 | cron + `auto_retrain.py` | 微调 Phoenix (LR=1e-5) |
| SimClusters 批处理 | 定时 | node-cron | 兴趣聚类更新 |
| RealGraph 衰减 | 定时 | node-cron | 社交亲密度时间衰减 |
| 特征导出 | 定时 | node-cron | 特征向量 Redis → GCS |
| 行为归档 | 按需 | `/jobs/archive-user-actions` | MongoDB → GCS JSONL.GZ (按日期分区) |

---

## 快速开始

### 环境要求

- **Node.js** 18+ · **npm** 9+
- **Python** 3.11+
- **PostgreSQL** 15+
- **MongoDB Atlas** (云端集群)
- **Redis** 7+
- **Rust + wasm-pack** (可选，用于 WASM 构建)

### 1. 克隆项目

```bash
git clone https://github.com/wssAchilles/Mycode.git
cd telegram
```

### 2. 后端配置

```bash
cd telegram-clone-backend
cp .env.example .env
```

编辑 `.env`：

```env
# 服务器
PORT=5000
NODE_ENV=development

# MongoDB Atlas
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/telegram_clone

# PostgreSQL
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=telegram_clone
PG_USERNAME=postgres
PG_PASSWORD=your_password

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your_super_secret_key
JWT_EXPIRES_IN=7d

# AI
GEMINI_API_KEY=your_gemini_api_key

# ML 服务
ML_SERVICE_URL=http://localhost:8000

# 文件上传
UPLOAD_PATH=./uploads
MAX_FILE_SIZE=10485760
```

### 3. 前端配置

```bash
cd ../telegram-clone-frontend
```

创建 `.env`：

```env
VITE_API_URL=http://localhost:5000
VITE_SOCKET_URL=http://localhost:5000
```

### 4. ML 服务配置

```bash
cd ../ml-services
pip install -r requirements.txt
```

### 5. 安装依赖 & 启动

```bash
# 后端
cd telegram-clone-backend
npm install
npm run dev          # → http://localhost:5000

# 前端 (新终端)
cd telegram-clone-frontend
npm install
npm run dev          # → http://localhost:5173

# ML 服务 (新终端)
cd ml-services
uvicorn app:app --reload --port 8000  # → http://localhost:8000
```

### 6. 可选：构建 WASM

```bash
cd telegram-clone-frontend
npm run wasm:build   # Rust → WASM (需要 wasm-pack)
```

---

## 脚本命令

### 后端

```bash
npm run dev                    # 开发模式 (nodemon)
npm run build                  # TypeScript 编译
npm run start                  # 生产启动
npm run test                   # Vitest 测试
npm run seed:all               # 填充示例数据
npm run seed:clusters          # 初始化 SimClusters
npm run clear:data             # 清除推荐数据
npm run job:simclusters        # 手动触发 SimClusters 批处理
npm run job:realgraph          # 手动触发 RealGraph 衰减
npm run job:backfill-timelines # 回填作者时间线 (近7天)
npm run report:recall-source   # 召回源指标报告
npm run export:recsys-samples  # 导出推荐训练样本
```

### 前端

```bash
npm run dev                    # Vite 开发服务器
npm run build                  # tsc + vite build
npm run lint                   # ESLint 检查
npm run preview                # 构建预览
npm run wasm:build             # Rust/WASM 发布构建
npm run wasm:dev               # Rust/WASM 开发构建
npm run test                   # Vitest 测试
npm run test:coverage          # 覆盖率报告
npm run perf:ci                # 构建 + Bundle Budget 校验
npm run check:budgets          # 仅检查产物体积
```

### ML 服务

```bash
python scripts/train_two_tower.py    # 训练 Two-Tower
python scripts/train_phoenix.py      # 训练 Phoenix
python scripts/build_faiss_index.py  # 构建 FAISS 索引
python scripts/auto_retrain.py       # 增量重训练
python scripts/refresh_features.py   # 刷新用户特征
python scripts/publish_artifacts.py  # 发布模型到 GCS
python scripts/preprocess_mind.py    # 预处理 MIND 数据集
```

---

## 部署

### Cloud Build CI/CD (ML 服务)

```yaml
# cloudbuild.yaml 流程:
# 1. Pull 缓存镜像 (层级复用加速)
# 2. Docker build --cache-from
# 3. Push → Artifact Registry (us-central1)
# 4. Deploy → Cloud Run (4Gi / 1200s timeout)
```

### Vercel (前端)

```bash
cd telegram-clone-frontend
vercel --prod    # vercel.json 已配置 SPA rewrite
```

### Render (后端)

后端通过 `render.yaml` 配置自动部署。

### Docker

```bash
# ML 服务
cd ml-services
docker build -t ml-services .
docker run -p 8000:8000 ml-services
```

---

## 测试

```bash
# 后端测试
cd telegram-clone-backend
npm test

# 前端测试
cd telegram-clone-frontend
npm test
npm run test:coverage

# ML 服务测试
cd ml-services
python -m pytest test_feed_recommend_dedup.py
```

### 前端测试覆盖

- `MessageBubble.test.tsx` — 消息气泡组件
- `chatCoreStore.test.ts` — Worker 端 LRU 缓存
- `chatStoreMetaBatch.test.ts` — 元数据批处理
- `spaceApi.searchPosts.test.ts` — Space 搜索 API
- `useAuthStore.test.ts` — 认证状态管理

---

## 安全

| 层面 | 措施 |
|------|------|
| **认证** | JWT 双令牌 (Access + Refresh) · JTI 轮换防重放 · bcrypt 12 轮 |
| **E2E 加密** | X25519 密钥交换 · XSalsa20-Poly1305 · PreKey Bundle |
| **传输** | HTTPS · Socket.IO 认证握手 |
| **内容安全** | 三层审核 (规则→ML→LLM) · Surface-aware 策略 |
| **输入验证** | Zod Schema · 参数化查询 |
| **API 防护** | express-rate-limit · CORS 白名单 |
| **容器** | 非 root 用户运行 · CRON_SECRET Job 鉴权 |
| **前端隔离** | sessionStorage 多标签页用户隔离 |

---

## 性能路线图

项目包含一份 **1144 行的 4–6 月性能优化路线图** (`PERFORMANCE_UPGRADE_PLAN.md`)，目标：

| 指标 | 当前 | 目标 |
|------|------|------|
| 冷启动 TTI | 2–3s | **<1s** |
| 聊天切换 | 200–500ms | **<100ms** |
| 滚动 FPS | 45–55 | **≥58fps** |
| JS Heap | — | **<150MB** |
| DOM 节点 | — | **<3000** |

涉及 `fasterdom` DOM 读写分离、5 级调度系统、WASM 扩展（LZ4 压缩 / 搜索）、滑动窗口同步 (Sliding Sync)、Worker Pool 拆分等工业级优化，参考了 Telegram-TT、TDLib、Matrix-Rust-SDK、Zulip、Discord 五大项目的底层代码。

---

## 贡献指南

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/amazing-feature`
3. 提交更改：`git commit -m 'Add amazing feature'`
4. 推送分支：`git push origin feature/amazing-feature`
5. 创建 Pull Request

### 开发规范

- **TypeScript 严格模式** — `strict: true`，无 `any`
- **ESLint** — Flat config + TypeScript + React Hooks
- **Bundle Budget** — CI 卡关，禁止产物超限
- **测试覆盖** — 新功能必须包含测试
- **文档同步** — 重要更改需更新对应文档

---

## 许可证

MIT License — 详见 [LICENSE](LICENSE)

---

## 参考与致谢

- [Telegram-TT](https://github.com/nicegram/nicegram-web-z) — Web Worker 架构、fasterdom 调度
- [X/Twitter Heavy Ranker](https://blog.twitter.com/engineering/en_us/topics/open-source/2023/twitter-recommendation-algorithm) — 推荐管道、Candidate Isolation Mask
- [Matrix Sliding Sync](https://github.com/nicegram/nicegram-web-z) — 增量同步协议
- [Discord Engineering Blog](https://discord.com/blog/how-discord-stores-billions-of-messages) — 消息存储与渲染优化
- [MIND Dataset](https://msnews.github.io/) — 新闻推荐训练数据
