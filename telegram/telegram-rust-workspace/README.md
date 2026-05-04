# Telegram Rust Workspace 迁移过渡说明

状态：过渡规划，当前不影响 Cargo 构建。

当前迁移状态：`selector_primitives_extracted`。

本目录用于记录长期 Rust workspace 边界，但不会一次性移动现有服务。

当前 Rust 服务 crate：

- `../telegram-rust-recommendation`
- `../telegram-rust-gateway`

本次过渡暂不纳入：

- `../telegram-clone-frontend/src/core/wasm/chat_wasm`

## 当前决策

已创建只承载 shared crates 的过渡 Cargo workspace。

当前两个 Rust 服务仍各自拥有独立的 `Cargo.lock`，也可以独立构建和测试。过渡 workspace 只管理 `crates/*` 下的共享 crate，不把 `telegram-rust-recommendation` 或 `telegram-rust-gateway` 直接纳入 workspace 成员。

## 目标共享 Crate

长期候选 shared crates：

1. `telegram-recommendation-contracts`
2. `telegram-recommendation-fixtures`
3. `telegram-ranking-primitives`
4. `telegram-selector-primitives`
5. `telegram-rust-http-types`

当前已经抽取：

- `crates/telegram-recommendation-contracts`
- `crates/telegram-recommendation-fixtures`
- `crates/telegram-ranking-primitives`
- `crates/telegram-selector-primitives`

当前消费方：

- `../telegram-rust-recommendation` 通过 path dependency 消费上述四个 shared crates。
- 具体 scorer、pipeline 执行和服务本体仍保留在推荐服务内。

抽取规则：

- Recommendation algorithm contracts 先于 runtime code 移动。
- Replay fixtures 先于 shared scorer primitives 移动。
- Gateway-facing HTTP types 只在 recommendation contracts 稳定后移动。
- 任何 shared crate 都不能依赖 `ml-services/**` 或 `telegram-light-jobs/**`。

## 迁移关口

只有在满足以下条件时，才把服务本体纳入真实 Cargo workspace：

- shared contract types 已准备好从单一服务中移出；
- 两个 Rust 服务都可以消费 shared contract，且不再重复定义；
- lockfile 归属已经被明确接受；
- CI/build 命令已经更新为可以从 workspace root 运行。

## Phase 6H 准备文件

- `workspace-transition.json`：机器可读的过渡边界。
- `workspace-migration-readiness.md`：真实 workspace 迁移前的中文检查清单。

## Phase 9E 迁移前准备

Phase 9E 已补齐迁移前代码基础，但仍未创建真实 root Cargo workspace：

- Rust 推荐服务新增 `pipeline_boundary_contract_v1`，用于校验 pipeline owner、组件 manifest 和 scorer owner 边界。
- Rust runtime contract 升级到 `recommendation_runtime_contract_v7`，并暴露 contract catalog、pipeline boundary 与 workspace migration prep 状态。
- Replay 固定 `selector_final_score_source_v1`，保护 selector 只消费 final score。
- Node feed page result 适配从 `spaceService.ts` 下沉到 recommendation feed adapter。

## Phase 10A-10B 第一批真实拆分

已完成第一批真实拆分：

- 新增 `Cargo.toml`，workspace members 使用 `crates/*`。
- 新增 `crates/telegram-recommendation-contracts`。
- `telegram-rust-recommendation/src/contracts/mod.rs` 只转发 shared crate。
- 原 `telegram-rust-recommendation/src/contracts/*.rs` 实现文件已删除，避免两套 Rust contract 并存。
- `algorithm_contract_sample.json` 迁移到 shared crate，Node contract 测试也读取该位置。

服务本体仍未移动；后续才评估 fixtures crate 与 ranking primitives。

## Phase 11A-11C Replay Fixtures 拆分

已完成第二批真实拆分：

- 新增 `crates/telegram-recommendation-fixtures`。
- `replay_warm_user.json`、`replay_user_state_matrix.json`、`replay_scenarios.json` 已从 `telegram-rust-recommendation/tests/fixtures` 迁移到 fixtures crate。
- `telegram-rust-recommendation/src/replay/tests.rs` 通过 shared fixtures crate 读取 replay 样本。
- replay evaluator 和推荐服务本体仍保留在 `telegram-rust-recommendation`，没有被移动。

## Phase 12A-12C Ranking Primitives 拆分

已完成第三批真实拆分：

- 新增 `crates/telegram-ranking-primitives`。
- `RankingStageKind`、`RankingScoreRole`、`RankingStageSpec`、`validate_ranking_ladder` 迁移到 shared crate。
- `telegram-rust-recommendation/src/pipeline/local/ranking/mod.rs` 只转发 shared crate。
- 具体 scorer、权重计算和服务 pipeline 仍保留在 `telegram-rust-recommendation`。

## Phase 13A-13C Selector Primitives 拆分

已完成第四批真实拆分：

- 新增 `crates/telegram-selector-primitives`。
- selector 版本锚点、`selector_target_size`、`SelectorPolicySnapshot`、`SelectorSelectionReport`、`SelectionLimits`、`ConstraintVerdict` 和 `first_blocking_reason` 迁移到 shared crate。
- Top-K selector 的候选排序、约束生成、选择状态和填充流程仍保留在 `telegram-rust-recommendation`。

下一步才评估真正跨服务复用的 HTTP types；不得直接移动服务目录。
