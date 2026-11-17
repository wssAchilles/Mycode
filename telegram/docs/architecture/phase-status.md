# 阶段状态总览

各能力线历史上使用独立 phase 编号，本文做 **统一索引**。新阶段合入时请更新本表，不要只改 env 注释或 commit message。

> 状态截取自仓库当前实现与 `deploy/vps/backend.env.example`；若与线上 env 冲突，以线上为准并回写本文。

## 1. 总表

| 能力线 | 当前 Phase / 模式 | 运行时证据 | 备注 |
| --- | --- | --- | --- |
| 消息投递 | **Phase 13 / full_primary** | `DELIVERY_EXECUTION_MODE=go_primary`；private+group rollout 100% | Node 保留 fallback/replay |
| 实时边界 | **Phase 23 / rust_edge_primary** | `GATEWAY_REALTIME_ROLLOUT_STAGE=rust_edge_primary` | socket terminator 仍为 `node`（2A） |
| Socket 终结 | **Phase 26 / 2B rust** | `GATEWAY_REALTIME_SOCKET_TERMINATOR=rust`；`GATEWAY_REALTIME_SESSION_LEASE_TTL_SECS=100` | 修复 await 遗失并引入 100s 租约，40+4 测试全绿 |
| 图数据面 | **Phase 28D / 实时增量断边** | `CPP_GRAPH_KERNEL_ENABLED=true`；`GRAPH_KERNEL_REDIS_STREAM_ENABLED=true` | `hiredis` 消费 `recsys:events:v1` + `DeltaEdgeOverlay` 秒级断边 + `AuthorCredScore` |
| 推荐管道 | **Phase 28A–28G / V3 全栈闭环收官** | `ML_SERVICE_URL` 纯 ONNXRT Revision (`telegram-ml-services-00046-lur`)；Rust 15 crates；`RECOMMENDATION_DECISION_LOG_V1_ENABLED=true`；`check_phase28_rollout_readiness.sh` | 完成 Phase 28C 训练+Manifest SHA256、Phase 28D 全量帖子回刷(`semantic_ready`)、Phase 28E Rust X-Algorithm V3 主引擎重构、Phase 28F 离线信任根对齐+`logged_randomized` 解锁及 Phase 28G 灰度放量门禁 |
| Rust Workspace | **16A–16C 完成** | `workspace-transition.json`：`recommendation_service_migrated` | 15 shared crates |
| Embedding 契约修复 | **Phase 0.5** | `reports/recommendation/embedding-contract-remediation/` | packet：`CODE_AND_DRY_RUN_READY` / 生产 **NOT GRANTED**；本地 18 文件 gate 已复验通过（2026-07-16）；Task 9 待 operator 授权 |
| 推荐研究文档 | 至 phase155 | `docs/research/phase*.md` | 算法证据矩阵，非运行时 phase |
| 外部索引命名 | phase164 | codebase-memory 项目名 | 仓库内无 phase164 正式文档 |

## 2. 推荐运行时关键开关

| 开关 | 当前示例值 | 含义 |
| --- | --- | --- |
| `RUST_RECOMMENDATION_MODE` | `shadow`（env example）/ 生产可 `primary` | Node feed 是否以 Rust 为 serving owner |
| `RUST_RECOMMENDATION_STAGE` | `retrieval_ranking_v2` | 管道阶段代际 |
| `RUST_RECOMMENDATION_RETRIEVAL_MODE` | `source_orchestrated_graph_v2` | 召回编排模式 |
| `RUST_RECOMMENDATION_SOURCE_ORDER` | Following → Graph → EmbeddingAuthor → Popular → TwoTower → ColdStart | source 优先级 |
| `RECOMMENDATION_DECISION_LOG_V1_ENABLED` | `true`（env example） | 决策日志落盘与 `logged_randomized` 证据签发 |
| `VF_*`（Rust 声明式安全兜底） | `VF_DEGRADE_ALLOW_NEWS_COLD_START=true` / `VF_IN_NETWORK_ALLOW_LOW_RISK=true` / `VF_OON_ALLOW_LOW_RISK=false` | Visibility Filtering 兜底策略开关 |
| `space_feed` 实验参数 | `enable_page_rl_exploration=true`、`page_rl_exploration_epsilon=0.05`、`dpp_theta=0.65`、`dpp_sid_lambda=0.35` | 控制 10% → 50% → 100% 灰度放量、DPP 重排核与 ε-Plackett-Luce 在线探索 |
| `NEWS_TRENDS_RUST_MODE` | `primary` | 新闻趋势 owner |

所有权契约：`telegram-clone-backend/src/services/recommendation/contracts/runtimeOwnership.ts`  
- `RECOMMENDATION_CANONICAL_ALGORITHM_OWNER = 'rust'`  
- Node 角色：`legacy_baseline_fallback`

## 3. 投递与平台事件

| 开关 | 当前示例值 | 含义 |
| --- | --- | --- |
| `DELIVERY_EXECUTION_MODE` | `go_primary` | Go 为投递执行 owner |
| `DELIVERY_GO_PRIMARY_*` | private/group 100% | Go primary 灰度与人数上限 |
| `DELIVERY_CONSUMER_EXECUTION_MODE` | `primary` | Consumer 自身执行模式（另有 dry-run/shadow） |
| `SYNC_WAKE_EXECUTION_MODE` | `platform_bus` | 唤醒走平台总线 |
| `NOTIFICATION_DISPATCH_EXECUTION_MODE` | `direct_queue` | 通知派发路径 |
| `*_EXECUTION_MODE`（Go handler 级） | `publish` | syncwake/presence/notification 各自开关 |

**注意**：Consumer 级 mode × handler 级 mode 形成多维矩阵，改配置时务必对照 [runtime-switches.md](runtime-switches.md)。

## 4. 实时边界 rollout 建议路径

| Stage | Socket terminator | 说明 |
| --- | --- | --- |
| `shadow` | node | 只观测，不接管 |
| `compat_primary` | node | 默认兼容主路径 |
| `rust_edge_primary` | node | Edge 主路径，Socket 仍 Node 终结（旧 2A） |
| `rust_edge_primary` | rust（Phase 26 落地） | Socket 由 Rust 终结，单连接内存压降 >80% |

回退：将 `GATEWAY_REALTIME_SOCKET_TERMINATOR=node`，必要时 stage 退回 `compat_primary`。

## 5. 未授权 / 阻断项

| 项 | 状态 | 影响 |
| --- | --- | --- |
| Embedding Phase 0.5 生产授权 | **NOT GRANTED** | `verify_all.sh` 可能因 live audit fail-closed 退出；Task9 runbook：`deploy/vps/embedding_phase05_task9_runbook.sh`（默认 dry-run） |
| 前端离线容灾与Worker | **Phase 24 / 完成** | Decorrelated Jitter + Per-Chat FIFO + Worker 委托收敛 | 提交 `d74aeb44`；35/35 测试通过 |
| 推荐对标X闭环接线 | **Phase 25 / 完成** | 对标 x-algorithm: ThunderStore 批量查询 + ImpressionBloom 过滤 + Redis 实时特征 fail-open | 451 单元 + 3 管道集成测试 100% 通过 |
| 实时网关Rust终结与Node退役 | **Phase 26 / 完成** | 彻底修复 10 处 Ingress await 缺失，落地 100s AP 租约与防惊群缓存，具备灰度切流与回退预案 | 40 单元 + 4 契约测试 100% 通过，0 warnings |
| 统一契约Codegen与防漂移门禁 | **Phase 27 / 完成** | 修复 12 项重大跨语言契约漂移，消除 Zod strip 与 ageRange 崩溃，落地 Golden Roundtrip 与全自动 CI 阻断门禁 | 跨语言静态门禁 + 3 端 Golden Roundtrip 100% 通过 |
| Rust 推荐管道 X-Algorithm V3 重构 | **Phase 28E / 完成** | 落地 Thunder 三池+Redis Stream、14 头 V3 价值模型+PIT Debias、SID 前缀索引+Popular/Cached 召回、Hamilton Fair-Share+声明式 VF+Beta-TS、O(KND) Cholesky DPP 与在线 ε-Plackett-Luce | 全工作区 15 crates 771 项测试 + 4 端跨语言防漂移门禁 + boundary-gate 100% 通过，release DPP Top-150 实测 ~0.13-0.29ms |
| V3 节点端决策日志与灰度放量收官 | **Phase 28F–28G / 完成** | 对齐 Node `targetEvidence/stream.ts` 信任根指纹、解锁 `decisionLog/write.ts` 的 `logged_randomized` 写入（Fail-Closed 回落）并落地 `deploy/vps/check_phase28_rollout_readiness.sh` | Node `tests/recommendation/` & `tests/contracts/` 全量门禁全绿，具备 Cloud Run 30 秒流量回滚及 Experiment 一键降级开关 |
| delivery DLQ 自动回放 | 无 | 需人工或外部工具 |

Capability readiness 脚本已落地：`deploy/vps/check_{realtime,recommendation,graph,platform_replay}_readiness.sh`（由 `gates/ops_readiness_gate.sh` 调用）。

## 6. 如何推进新阶段

1. 在本表新增/更新一行，写清 phase 名、env 键、证据文件。
2. 同步 `deploy/vps/backend.env.example` 注释与推荐值。
3. 若涉及算法语义，先过 `AGENTS.md` Algorithm Research Gate。
4. 变更跨服务 wire 契约时更新 [cross-service-contracts.md](cross-service-contracts.md)。
5. 灰度必须具备可回退 env，并在发布门禁中验证。
