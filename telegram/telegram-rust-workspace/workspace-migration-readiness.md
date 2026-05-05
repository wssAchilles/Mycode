# Rust Workspace 真实迁移准备清单

状态：推荐服务已纳入真实 Cargo workspace；gateway 仍保持外部独立服务。

## 当前边界

当前 Rust 服务边界：

- `crates/telegram-rust-recommendation`
- `../telegram-rust-gateway`

当前 lockfile 边界：

- `Cargo.lock`
- `../telegram-rust-gateway/Cargo.lock`

本阶段不修改：

- `../ml-services/**`
- `../telegram-light-jobs/**`

当前已创建过渡 workspace：

- `Cargo.toml`
- `crates/telegram-rust-recommendation`
- `crates/telegram-component-primitives`
- `crates/telegram-filter-primitives`
- `crates/telegram-pipeline-primitives`
- `crates/telegram-recommendation-contracts`
- `crates/telegram-recommendation-fixtures`
- `crates/telegram-ranking-primitives`
- `crates/telegram-runtime-primitives`
- `crates/telegram-selector-primitives`
- `crates/telegram-rust-http-types`
- `crates/telegram-serving-primitives`
- `crates/telegram-source-primitives`

当前 workspace 只管理 shared crates，不直接管理两个服务 crate。

## Phase 9 迁移前新增锚点

Phase 9 的目标不是移动目录，而是先把后续 workspace 迁移依赖的代码基础固定下来。

当前新增的迁移前锚点：

- `workspaceMigrationState`：`recommendation_service_migrated`
- `migrationPrepVersion`：`rust_workspace_migration_prep_v1`
- `runtimeContractVersion`：`recommendation_runtime_contract_v7`
- `contractVersionCatalogVersion`：`recommendation_contract_version_catalog_v1`
- `pipelineBoundaryVersion`：`pipeline_boundary_contract_v1`

对应代码产物：

- `crates/telegram-rust-recommendation/src/candidate_pipeline/boundary.rs`
  - 校验 Rust owner、Node baseline role、manifest 组件完整性、provider scorer 与 Rust local scorer owner 边界。
- `crates/telegram-rust-recommendation/src/runtime/versions.rs`
  - 统一导出迁移前 runtime/version 状态。
- `crates/telegram-rust-recommendation/src/contracts/mod.rs`
  - 不再编译本地 contract 实现，只转发 `telegram-recommendation-contracts`。
- `../telegram-rust-workspace/crates/telegram-recommendation-contracts`
  - 当前第一批 shared crate，承载 query、candidate、algorithm、pipeline、ops、graph provider 和 rescue provider contract。
- `../telegram-rust-workspace/crates/telegram-recommendation-fixtures`
  - 当前第二批 shared crate，承载 replay fixtures、replay scenario manifest 与 replay fixture schema。
- `../telegram-rust-workspace/crates/telegram-recommendation-fixtures/src/replay_contracts.rs`
  - 当前 replay schema 收口产物，承载 deterministic replay payload、manifest entry 与 expected/assertion payload。
- `../telegram-rust-workspace/crates/telegram-ranking-primitives`
  - 当前第三批 shared crate，承载 ranking stage kind、score role、ladder spec 与 ladder 校验。
- `../telegram-rust-workspace/crates/telegram-selector-primitives`
  - 当前第四批 shared crate，承载 selector 版本锚点、target size、policy/report primitive 和 constraint verdict。
- `../telegram-rust-workspace/crates/telegram-rust-http-types`
  - 当前第五批 shared crate，承载通用 HTTP transport envelope；当前只包含 `SuccessEnvelope<T>`。
- `../telegram-rust-workspace/crates/telegram-source-primitives`
  - 当前第六批 shared crate，承载稳定 source identity、retrieval lane、source registry、source cost class 与 readiness impact。
- `crates/telegram-rust-recommendation/src/replay/evaluator.rs`
  - replay stage detail 现在固定 `selectorScoreSourceVersion`，保护 selector 只消费 final score。
- `../telegram-clone-backend/src/services/recommendation/feed/pageResult.ts`
  - feed page result 与 served context token 生成从 `spaceService.ts` 下沉到 recommendation feed adapter。
- `../deploy/vps/recommendation_runtime_contract.env`
  - readiness 期望版本同步到 runtime contract v7。

这批锚点让后续抽 shared crate 前可以先回答三个问题：

1. 当前推荐 pipeline 是否仍由 Rust 持有算法主职责。
2. Node 是否仍只是 provider/fallback/adapter，而不是重新承载 ranking 逻辑。
3. Replay 是否能发现 selector 分数来源、stage detail 和 contract version 的漂移。

## 不能立即创建 root workspace 的原因

- 两个 Rust 服务当前独立构建，直接创建 root workspace 会改变 lockfile 归属。
- `telegram-rust-recommendation` 与 `telegram-rust-gateway` 的 `redis` 版本不同，直接统一依赖可能产生行为变化。
- 推荐算法 contract 还在 Rust recommendation 内部快速收敛，过早抽 crate 会增加迁移噪音。
- 本阶段目标是为后续迁移准备清晰边界，不是一次性搬迁目录。

## 第一批建议抽取的 shared crates

1. `telegram-recommendation-contracts`
   - 来源：`telegram-rust-workspace/crates/telegram-rust-recommendation/src/contracts/`
   - 内容：query、candidate、algorithm contract、runtime ops contract 的稳定类型。
   - 迁移前置条件：Node/Rust contract fixtures 稳定，runtime contract version 已显式升级。

2. `telegram-recommendation-fixtures`
   - 来源：`telegram-rust-workspace/crates/telegram-rust-recommendation/tests/fixtures/`
   - 内容：replay scenarios、user state matrix、replay manifest 与 replay fixture schema。
   - 迁移前置条件：Rust replay harness 可以从 crate 读取 fixtures，Node 只消费共享 fixture 副本或稳定路径。

3. `telegram-ranking-primitives`
   - 来源：`telegram-rust-workspace/crates/telegram-rust-recommendation/src/pipeline/local/ranking/` 与小型 scoring helpers。
   - 内容：ranking stage kind、score role、权重版本锚点、纯函数 scoring primitive。
   - 迁移前置条件：ranking ladder replay 已固定 stage order、score role 和 selector-facing final score。

4. `telegram-rust-http-types`
   - 来源：Rust recommendation 与 Rust gateway 之间可能复用的 HTTP/client payload。
   - 内容：只放跨服务真正复用的 transport 类型。
   - 迁移前置条件：不能把推荐算法业务语义放入通用 HTTP crate。

5. `telegram-source-primitives`
   - 来源：`telegram-rust-workspace/crates/telegram-rust-recommendation/src/sources/mod.rs`。
   - 内容：source 名称、retrieval lane、descriptor registry、cost class 与 readiness impact。
   - 迁移前置条件：只抽 source identity，不抽 source 执行、预算、融合、graph materialization 或 telemetry。

## 迁移顺序

1. 已建立真实 Rust workspace，并将 shared crates 纳入 `crates/*`。
2. 已将 `telegram-rust-recommendation` 移动为 `crates/telegram-rust-recommendation`。
3. 已由 workspace dependency 统一 recommendation 服务与 shared crates 的依赖关系。
4. 下一步只评估 gateway 是否有真实共享 contract 需求，不做无意义复用。

## 迁移前必须验证

- `cargo test -p telegram-rust-recommendation` 在 workspace root 通过。
- `cargo test` 在 `telegram-rust-gateway` 内通过。
- Node contract/replay 相关测试通过。
- `npx tsc --noEmit` 在 `telegram-clone-backend` 内通过。
- `deploy/vps/check_recommendation_readiness.sh` 语法检查通过。
- `ml-services/**` 和 `telegram-light-jobs/**` 无改动。
- 新 workspace 不改变运行时 endpoint、环境变量或 GCP 相关路径。

## 推荐服务迁移后的硬门槛

只有同时满足以下条件，才继续下一批真实 workspace 拆分：

- `pipeline_boundaries` readiness check 为 ready。
- `/ops/recommendation/summary` 输出 `workspaceMigrationState=recommendation_service_migrated`。
- `telegram-rust-recommendation` replay 全部通过。
- `telegram-rust-gateway` 可以独立通过 `cargo test`。
- contract、fixtures、ranking primitives、selector primitives 与 source primitives crate 继续由 recommendation service 通过 workspace dependency 消费。
- `telegram-recommendation-contracts` 继续通过 path dependency 消费 `telegram-rust-http-types` 并 re-export `SuccessEnvelope`。
- 下一批工作只允许做迁移后的构建、CI、release 路径收口，不能触碰 `ml-services/**` 或 `telegram-light-jobs/**`。

## 与优秀仓库的对齐点

`claw-code` 的 Rust workspace 使用 `members = ["crates/*"]`、workspace 级依赖和 workspace lints。当前项目已采用同样的治理思想：

- workspace root 只做共享治理，不承载业务大文件。
- shared crate 先按职责拆分，而不是按语言文件名堆平。
- lints 与依赖版本统一必须在 lockfile 归属明确后再执行。

## 当前结论

当前推荐服务已完成真实 workspace 迁移。下一步应继续收口 CI、Docker、release 与 gateway 共享 contract 的真实需求，`telegram-rust-gateway` 暂时保持独立构建。
