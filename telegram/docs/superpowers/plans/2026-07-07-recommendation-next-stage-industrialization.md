# Recommendation Next-Stage Industrialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` for every implementation phase. Plans describe direction and acceptance gates; implementers derive concrete code changes from current source using TDD.

**Goal:** 将现有多语言推荐系统收敛为可回放、可诊断、可灰度、可阻断错误发布的工业化主路径，并在 release evidence 稳定后逐步完善跨运行时契约、Node 证据、PIT 数据、C++ 图快照、ANN telemetry 与 runtime ownership。

**Architecture:** Rust 是 canonical recommendation owner；Node/backend 负责产品入口、适配、fallback、ops 与 materialization；frontend 负责请求与反馈契约；Go 负责 delivery/ops/replay 相关路径；C++ 负责 graph kernel。Python ML endpoint 在本轮始终是只读依赖，不修改 `ml-services/**`。

**Tech Stack:** Rust、TypeScript/Node、React frontend、Go、C++、MongoDB、Redis、现有 replay/ops/release scripts、Vitest/Cargo/Go/C++ test targets、`agent-reach`、Superpowers workflow。

---

## Global Execution Rules

- 每个阶段开始前并行派出 code verifier、research verifier、plan/scope verifier。
- Research verifier 使用 `agent-reach` 阅读权威工业资料和顶会/顶刊论文，并给出 claim-to-source 映射。
- 主线程在 verifier 运行期间继续做代码图谱、调用链、dirty-worktree 和最小测试基线检查。
- 验证结论为阻塞时不得启动实现；需要调整但不阻塞时，先修正阶段方向再实现。
- 每个任务使用 fresh implementer，执行 TDD；随后依次做规格审查和代码质量审查。
- 不并行运行会编辑重叠文件的 implementer。
- 计划文件只记录方向、范围、研究依据和验收门，不记录逐行代码或大段实现片段。
- Python 仅可用于只读依赖说明；不得编辑、测试、格式化或生成 `ml-services/**`。
- 任何 Mongo/Redis/scheduler/process 生产变更都需要独立授权。

## Current Ownership Baseline

- Rust recommendation workspace：canonical retrieval/filter/scorer/selector/serving/replay pipeline。
- Node backend：public feed entry、Rust rollout/fallback、internal adapter、trace/ops、feature materialization。
- Frontend：Space/feed 请求、曝光/点击/停留反馈和 recommendation context 消费。
- Go delivery consumer：delivery stream、ops/replay 相关下游能力。
- C++ graph service：graph snapshot/kernel 查询。
- Python ML service：ANN/Phoenix/VF endpoint，只读依赖。

## Research Basis

- Product Mixer/Home Mixer：阶段化 candidate source、hydrator、filter、scorer、selector 与可观测发布门。
- YouTube/Instagram/LinkedIn/Pinterest：多源召回、两阶段排序、版本化特征和线上反馈闭环。
- Open Bandit Dataset/Pipeline：logging completeness、propensity 与离线反事实评估前置条件。
- Feature-store/PVLDB/Feast：event time、feature time、version 与 point-in-time join。
- GraphJet/Pixie/RealGraph：实时图召回、快照一致性、random walk/pruning 与 affinity。
- FAISS/ANN evaluation：exact-vs-ANN、recall@K、latency 与 index version 切片。
- BCT/FCT：跨代 embedding 兼容需要训练设计，不能通过 metadata 重标实现。

## Phase 0: Fail-Closed Release Evidence Gates

状态：代码改动已存在于当前工作分支，仍需与 Phase 0.5 集成后做 fresh final verification。

修改方向：

- Trace summary 真实产出 replay logging readiness 与 embedding incompatibility evidence。
- Recommendation ops readiness 在证据缺失、replay 未就绪或 embedding incompatible 时 fail-closed。
- Embedding audit 提供确定性 strict failure 路径，并接入 release verification。
- Release script 保留 C++、Go、performance、Node、Rust 的现有验证顺序，不绕过失败步骤。
- Minimal fixture 仅在无法通过现有确定性测试覆盖 release-gate surface 时增加。

验收：

- Ops readiness 不再因字段缺失而误判 ready。
- Strict audit 有确定性证据证明失败分支。
- Release verification 在 live evidence 不兼容时明确失败。
- Phase 0 不修改 Python、Go 或 C++ 业务代码。

## Phase 0.5: Embedding Contract Remediation

设计：`docs/superpowers/specs/2026-07-13-recommendation-embedding-contract-remediation-design.md`

执行计划：`docs/superpowers/plans/2026-07-13-recommendation-embedding-contract-remediation.md`

修改方向：

- 拆分用户 Two-Tower/Phoenix per-vector contracts。
- 修复 sparse writer clobber、destructive cold-start repair、legacy consumer trust 与 prefix cosine。
- Audit、daily ops、dry-run/apply 共享 producer-contract evidence。
- 形成 canonical proposal/quarantine digests、metadata-only backup/rollback 与 digest-bound apply。
- Python 代码保持不变，现有 Python dense writer 在生产 apply 后保持禁用。

验收：

- 每个 live dense vector 有 verified contract 或 approved quarantine。
- Full dry-run 覆盖全部 user/post 记录且证明零写入。
- Phase 0.5 production apply 必须单独授权。

## Phase 1: Cross-Runtime Golden Contracts

入口：Phase 0 release evidence 与 Phase 0.5 storage evidence gate 均通过。

修改方向：

- 选择最小高价值 contract surfaces：feed query、candidate evidence、weighted score、graph diagnostics、replay result。
- Rust 与 Node 是主要对齐对象；frontend、Go、C++ 只覆盖实际消费的字段。
- 使用少量 canonical JSON fixtures 或等价结构化契约测试，避免建立大型 fixture 平台。
- 优先解决 Rust/Node weighted scorer drift；无法对齐的实现明确标记 fallback/shadow。
- Python drift 只记录为外部依赖，不修改 Python。

研究验证：Product Mixer contract boundaries、YouTube two-stage contracts、schema evolution 与 golden-test 实践。

验收：

- 相同 fixture 在相关 runtime 产生一致的关键字段和解释。
- Contract drift 在 CI/release gate 中可见。
- Runtime-specific fallback 不伪装成 canonical parity。

## Phase 2: Node Main-Path Evidence Retention

入口：Code verifier 明确 `SpaceFeedMixer` 与 Rust adapter 的责任边界。

修改方向：

- Source batches 先合并证据再做 duplicate filtering。
- 保留 primary/secondary sources、recall evidence、source confidence、stage detail 和 light-rank score。
- Replay pool 在 selector 前有界保留候选证据。
- Query hydration 使用依赖感知顺序或显式 staged groups，避免依赖字段尚未生成时跳过。
- Node 只增强 fallback/adapter evidence，不新增与 Rust 竞争的 canonical 算法能力。

研究验证：CR-Mixer source coordination、Product Mixer stage ownership、multi-source attribution。

验收：

- 重复候选保留 secondary evidence。
- 依赖型 hydrator 不再因初始空字段失效。
- Trace/replay 能重建 Node 主路径的关键选择依据。

## Phase 3: Point-In-Time Training And Feature Export

入口：Research verifier 确认最小 PIT/ASOF 范围，不引入完整 feature-store 平台。

修改方向：

- 训练样本携带 event timestamp、feature timestamp、feature/model/index/embedding/graph versions。
- 无法证明 point-in-time 的样本进入 quarantine 或明确标记不可训练。
- Export 与 feedback join 使用稳定 ID 空间和版本证据。
- 仅修改 Node/Rust/前后端/Go/C++ 相关边界；Python training/export 代码保持不变。

研究验证：PVLDB feature store、Feast entity/event timestamp、Open Bandit logging completeness。

验收：

- Export 能显示 PIT provenance。
- 缺失 provenance 的样本不会静默进入训练数据。
- ID/版本漂移在 ops evidence 中可定位。

## Phase 4: C++ Graph Snapshot Pinning And Diagnostics

入口：Code verifier 确认 backend snapshot provider 的 cursor/version contract。

修改方向：

- 第一页固定 snapshot version，后续页必须携带并验证同一版本。
- 优先 cursor，offset 仅作为兼容 fallback。
- Snapshot mismatch 阻断或整批重试，不混合不同版本页面。
- Graph diagnostics 保留 budget exhaustion、caps、seed weight、recency window 与 empty reason。
- 诊断进入 Node/Rust trace/replay；Go 仅在实际消费面需要时调整。

研究验证：GraphJet、Pixie、RealGraph/WTF、snapshot consistency practices。

验收：

- 跨页不会混合 snapshot version。
- Graph empty/fallback 原因可在 trace/replay 中区分。
- C++ targeted tests 与现有 release/ASan checks 通过。

## Phase 5: ANN Evaluation And Telemetry

入口：Research verifier 确认第一版只需 exact-vs-ANN、recall@K、latency 与 version slicing。

修改方向：

- Node/Rust trace 区分 ANN success、contract mismatch、timeout、recency/keyword fallback。
- 记录 model version、index version、embedding space、dimension、source score 和 fallback reason。
- 建立 held-out positives 与 exact-vs-ANN 评测，按 index version 汇总 recall@K 和 latency。
- 使用现有 Python endpoint 的响应作为只读观测，不修改 Python 实现。
- ANN fallback 不计为 ANN success。

研究验证：FAISS、YouTube candidate generation、sampling-bias-corrected two-tower evaluation。

验收：

- Ops/replay 可按 index/model version 区分真实 ANN 与 fallback。
- Recall 与 latency 指标具有稳定分母和版本切片。
- 无 Python 代码或测试变更。

## Phase 6: Runtime Ownership Consolidation

入口：前述 evidence 足以判断各 runtime 的真实能力与 fallback parity。

修改方向：

- 固化 Rust canonical、Node fallback/adapter、C++ graph kernel、Go delivery/ops、Python read-only ML endpoint。
- Rust primary promotion 依赖 trace completeness、fallback rate、latency、graph diagnostics、replay logging 和 embedding contract。
- Node 不新增 canonical ranking/retrieval 能力，只维护 fallback parity。
- Python `/feed/recommend` 保持 shadow/diagnostic；现有细粒度 ML endpoints 作为依赖。
- Flags、ops gates、runbooks 和 ownership 文档保持一致。

研究验证：Home Mixer/Product Mixer ownership、Instagram/YouTube multi-stage service boundaries。

验收：

- Runtime flags、文档与 ops gate 不矛盾。
- 没有把 Python feed endpoint 提升为 canonical。
- Promotion/rollback 条件可由 release evidence 直接判断。

## Cross-Phase Verification

- Backend/Frontend：运行相关 contract、rollout、fallback、trace、ops tests 与 TypeScript checks。
- Rust：运行受影响 crate 的 targeted tests，再运行 recommendation replay/contract tests。
- Go：仅在实际修改时运行受影响 package 与 `go test ./...`。
- C++：运行受影响 graph target、release build 和现有 sanitizer gate。
- Shell：验证 release scripts syntax，并运行允许范围内的 release verification。
- Python：不运行 Python tests、formatters、generators 或 endpoint implementation checks。
- 每阶段结束前检查 `git diff --check`、工作树范围和无 `ml-services/**` 变更。

## Completion Protocol

- 每个阶段必须拥有 code/research/scope 三方进入证据。
- 每个实现任务必须完成 implementer、spec reviewer、quality reviewer 三段闭环。
- 阶段完成声明必须基于 fresh verification output。
- 生产 mutation 与代码完成分开授权、分开报告。
- 全部阶段完成后使用 `superpowers:verification-before-completion` 与 `superpowers:finishing-a-development-branch`，再决定合并、保留或继续修复。
