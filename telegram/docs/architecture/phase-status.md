# 阶段状态总览

各能力线历史上使用独立 phase 编号，本文做 **统一索引**。新阶段合入时请更新本表，不要只改 env 注释或 commit message。

> 状态截取自仓库当前实现与 `deploy/vps/backend.env.example`；若与线上 env 冲突，以线上为准并回写本文。

## 1. 总表

| 能力线 | 当前 Phase / 模式 | 运行时证据 | 备注 |
| --- | --- | --- | --- |
| 消息投递 | **Phase 13 / full_primary** | `DELIVERY_EXECUTION_MODE=go_primary`；private+group rollout 100% | Node 保留 fallback/replay |
| 实时边界 | **Phase 23 / rust_edge_primary** | `GATEWAY_REALTIME_ROLLOUT_STAGE=rust_edge_primary` | socket terminator 仍为 `node`（2A） |
| Socket 终结 | **2A node** | `GATEWAY_REALTIME_SOCKET_TERMINATOR=node` | 2B 切 rust |
| 图数据面 | **Phase 20 / 只读快照** | `CPP_GRAPH_KERNEL_ENABLED=true` | 快照从 Node generation 协议拉取 |
| 推荐管道 | **Phase 22** | `RUST_RECOMMENDATION_STAGE=retrieval_ranking_v2`；`retrieval_mode=source_orchestrated_graph_v2`；`ranking_mode=phoenix_standardized` | pipeline v7 / runtime contract v7 |
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
| `RECOMMENDATION_DECISION_LOG_V1_ENABLED` | 按环境 | 决策日志落盘 |
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
| `rust_edge_primary` | node（当前） | Edge 主路径，Socket 仍 Node 终结 |
| `rust_edge_primary` | rust（目标 2B） | Socket 由 Rust 终结 |

回退：将 `GATEWAY_REALTIME_SOCKET_TERMINATOR=node`，必要时 stage 退回 `compat_primary`。

## 5. 未授权 / 阻断项

| 项 | 状态 | 影响 |
| --- | --- | --- |
| Embedding Phase 0.5 生产授权 | **NOT GRANTED** | `verify_all.sh` 可能因 live audit fail-closed 退出；Task9 runbook：`deploy/vps/embedding_phase05_task9_runbook.sh`（默认 dry-run） |
| ThunderStore / ImpressionBloom / RealtimeFeatureProvider 接线 | 骨架已建，主路径未闭环 | 曝光去重与实时特征仍依赖 query 传入 |
| 前端离线发送重放 | 未实现 | 离线消息可能丢失 |
| delivery DLQ 自动回放 | 无 | 需人工或外部工具 |

Capability readiness 脚本已落地：`deploy/vps/check_{realtime,recommendation,graph,platform_replay}_readiness.sh`（由 `gates/ops_readiness_gate.sh` 调用）。

## 6. 如何推进新阶段

1. 在本表新增/更新一行，写清 phase 名、env 键、证据文件。
2. 同步 `deploy/vps/backend.env.example` 注释与推荐值。
3. 若涉及算法语义，先过 `AGENTS.md` Algorithm Research Gate。
4. 变更跨服务 wire 契约时更新 [cross-service-contracts.md](cross-service-contracts.md)。
5. 灰度必须具备可回退 env，并在发布门禁中验证。
