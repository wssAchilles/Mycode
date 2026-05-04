# Telegram Rust Workspace 迁移过渡说明

状态：过渡规划，当前不影响 Cargo 构建。

本目录用于记录长期 Rust workspace 边界，但不会一次性移动现有服务。

当前 Rust 服务 crate：

- `../telegram-rust-recommendation`
- `../telegram-rust-gateway`

本次过渡暂不纳入：

- `../telegram-clone-frontend/src/core/wasm/chat_wasm`

## 当前决策

暂不创建 root Cargo workspace。

当前两个 Rust 服务各自拥有独立的 `Cargo.lock`，也可以独立构建和测试。直接创建 root workspace 会改变 lockfile 归属与依赖解析方式，因此第一步只明确目标 crate 边界，不立即移动 package。

## 目标共享 Crate

计划抽取顺序：

1. `telegram-recommendation-contracts`
2. `telegram-rust-http-types`
3. `telegram-recommendation-fixtures`
4. `telegram-ranking-primitives`

抽取规则：

- Recommendation algorithm contracts 先于 runtime code 移动。
- Replay fixtures 先于 shared scorer primitives 移动。
- Gateway-facing HTTP types 只在 recommendation contracts 稳定后移动。
- 任何 shared crate 都不能依赖 `ml-services/**` 或 `telegram-light-jobs/**`。

## 迁移关口

只有在满足以下条件时，才创建真实 Cargo workspace：

- shared contract types 已准备好从单一服务中移出；
- 两个 Rust 服务都可以消费 shared contract，且不再重复定义；
- lockfile 归属已经被明确接受；
- CI/build 命令已经更新为可以从 workspace root 运行。

## Phase 6H 准备文件

- `workspace-transition.json`：机器可读的过渡边界。
- `workspace-migration-readiness.md`：真实 workspace 迁移前的中文检查清单。
