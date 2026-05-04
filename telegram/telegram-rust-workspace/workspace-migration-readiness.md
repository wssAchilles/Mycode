# Rust Workspace 真实迁移准备清单

状态：Phase 6H 准备完成，尚未创建真实 Cargo workspace。

## 当前边界

当前仍保持两个独立 Rust 服务：

- `../telegram-rust-recommendation`
- `../telegram-rust-gateway`

当前仍保留两个独立 lockfile：

- `../telegram-rust-recommendation/Cargo.lock`
- `../telegram-rust-gateway/Cargo.lock`

本阶段不修改：

- `../ml-services/**`
- `../telegram-light-jobs/**`

## 不能立即创建 root workspace 的原因

- 两个 Rust 服务当前独立构建，直接创建 root workspace 会改变 lockfile 归属。
- `telegram-rust-recommendation` 与 `telegram-rust-gateway` 的 `redis` 版本不同，直接统一依赖可能产生行为变化。
- 推荐算法 contract 还在 Rust recommendation 内部快速收敛，过早抽 crate 会增加迁移噪音。
- 本阶段目标是为后续迁移准备清晰边界，不是一次性搬迁目录。

## 第一批建议抽取的 shared crates

1. `telegram-recommendation-contracts`
   - 来源：`telegram-rust-recommendation/src/contracts/`
   - 内容：query、candidate、algorithm contract、runtime ops contract 的稳定类型。
   - 迁移前置条件：Node/Rust contract fixtures 稳定，runtime contract version 已显式升级。

2. `telegram-recommendation-fixtures`
   - 来源：`telegram-rust-recommendation/tests/fixtures/`
   - 内容：algorithm contract sample、replay scenarios、user state matrix。
   - 迁移前置条件：Rust replay harness 可以从 crate 读取 fixtures，Node 只消费共享 fixture 副本或稳定路径。

3. `telegram-ranking-primitives`
   - 来源：`telegram-rust-recommendation/src/pipeline/local/ranking/` 与小型 scoring helpers。
   - 内容：ranking stage kind、score role、权重版本锚点、纯函数 scoring primitive。
   - 迁移前置条件：ranking ladder replay 已固定 stage order、score role 和 selector-facing final score。

4. `telegram-rust-http-types`
   - 来源：Rust recommendation 与 Rust gateway 之间可能复用的 HTTP/client payload。
   - 内容：只放跨服务真正复用的 transport 类型。
   - 迁移前置条件：不能把推荐算法业务语义放入通用 HTTP crate。

## 迁移顺序

1. 先建立真实 root workspace，但只纳入新 shared crates，不移动现有服务。
2. 将 `telegram-recommendation-contracts` 加入 workspace，并让 recommendation 服务以 path dependency 消费。
3. 跑 `cargo test -p telegram-rust-recommendation`，确认推荐服务行为不变。
4. 再让 gateway 消费真正共享的 contract，不做无意义复用。
5. 最后再评估是否把两个服务本身加入 root workspace。

## 迁移前必须验证

- `cargo test` 在 `telegram-rust-recommendation` 内通过。
- `cargo test` 在 `telegram-rust-gateway` 内通过。
- Node contract/replay 相关测试通过。
- `ml-services/**` 和 `telegram-light-jobs/**` 无改动。
- 新 workspace 不改变运行时 endpoint、环境变量或 GCP 相关路径。

## 与优秀仓库的对齐点

`claw-code` 的 Rust workspace 使用 `members = ["crates/*"]`、workspace 级依赖和 workspace lints。当前项目不直接照搬目录，而是先采用同样的治理思想：

- workspace root 只做共享治理，不承载业务大文件。
- shared crate 先按职责拆分，而不是按语言文件名堆平。
- lints 与依赖版本统一必须在 lockfile 归属明确后再执行。

## 当前结论

Phase 6H 当前只完成真实迁移前的准备。下一步可以先抽 `telegram-recommendation-contracts`，但只有在用户确认可以接受 workspace lockfile 变化后，才应该创建真实 root Cargo workspace。
