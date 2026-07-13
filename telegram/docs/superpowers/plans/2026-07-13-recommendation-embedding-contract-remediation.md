# Recommendation Embedding Contract Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to execute this plan. Each task uses a fresh implementer, followed by specification review and code-quality review.

**Goal:** 让用户与帖子向量的生产者契约真实、可审计、不可被稀疏写入误覆盖，并在任何生产数据变更前形成完整只读证据与独立授权包。

**Architecture:** 保留现有 `EmbeddingContract` 值类型，为用户的 Two-Tower 与 Phoenix 向量增加独立 sidecar，并由一个纯证据分类模块统一 writer、consumer、audit 与 ops 的判断。现有 audit/backfill 入口原地收敛为 fail-closed 工具，不引入第二套迁移框架。

**Tech Stack:** TypeScript、Node.js、Mongoose、Sequelize、MongoDB、Redis、Vitest、现有 release shell scripts。Python 仅作为只读外部依赖，不修改、不测试。

---

## Execution Rules

- 每个任务开始前并行派出 code verifier、research verifier、plan/scope verifier。
- Research verifier 使用 `agent-reach`，核对工业实践与论文结论，区分直接证据、类比证据和本项目策略。
- 主线程在 verifier 运行期间继续做只读代码图谱、调用链和测试基线检查。
- 每个实现任务使用新的 implementer agent，并严格执行 RED、验证 RED、最小 GREEN、验证 GREEN。
- 实现后依次进行规格符合性审查和代码质量审查；任何重要问题未关闭前不得进入下一任务。
- 计划只描述修改方向、模块边界和验收条件。具体代码由 implementer 根据当前源码与测试完成。
- 不修改、格式化、生成或测试 `ml-services/**`。
- Task 9 的 Mongo、Redis、scheduler 和进程操作需要单独、明确的生产授权；完成代码和 dry-run 不等于获得该授权。

## Research Guardrails

- 每向量独立契约参考 named-vector 系统的独立维度和距离配置，但不宣称当前项目等同于任何特定向量数据库实现。
- Lineage 判断遵循 W3C PROV 与 ML Metadata 的原则：维度和标签不能替代生产者证据。
- 确定性 replay 只能证明与当前实现和完整输入一致，不能证明历史生产过程。
- Mongo `_id` 游标只提供稳定顺序，不提供时间点快照；权威 apply 证据必须在 writer pause 或 snapshot read concern 下生成。
- Dry-run/apply 采用 Terraform saved-plan 类似的摘要绑定思想：apply 必须绑定已审阅的完整 proposal digest。
- 跨代 embedding 兼容需要专门训练，本阶段不得通过 metadata 重标宣称兼容。

## Scope

主要修改范围：

- 向量契约与证据分类边界。
- 用户向量 writer、cold-start、repair 与缓存一致性边界。
- Serving、export、ANN 与相似度消费边界。
- Audit、daily ops、dry-run/apply、rollback 与 release gate。
- 对应的少量高价值测试和协调文档。

本阶段不扩展 Rust、frontend、Go、C++ 或 Python 的向量 sidecar 契约。

## Task 1: Known Contracts And Evidence Classification

修改方向：

- 建立已知本地契约、每向量 sidecar 与统一的五态证据分类。
- 缺少权威 semantic manifest 时保持 `semantic_ready` 不可达，默认 sentinel 不得被提升。
- 对未知 lineage、非法结构和不受支持的 quarantine 证据一律 fail-closed。
- 形成可跨 audit、ops 与 repair 复用的确定性 checksum 和 digest 语义。

验收：

- 默认 sentinel 单独存在时不能产生 semantic-ready。
- 冷启动契约与默认语义契约不兼容。
- NaN、Infinity、非数字和错误维度均为 invalid。
- quarantine 身份或向量变化会改变 digest。

## Task 2: Writer Boundary And Sparse-Update Protection

修改方向：

- 明确 sparse 与 dense writer 的字段所有权，禁止稀疏写入隐式改写向量契约。
- Dense write 必须携带结构一致的对应 sidecar；legacy shared contract 只读兼容。
- 写入成功后维护现有 embedding 缓存的一致性。
- Demo writer 遵守同一非语义契约边界。

验收：

- Sparse update 的写集合不含任何 dense 或 contract 字段。
- 错误维度、非有限值、缺少 sidecar 的 dense write 被拒绝。
- 两套 cache invalidation 都被验证。
- Demo Two-Tower/Phoenix 向量各自携带正确非语义契约。

## Task 3: Non-Destructive Cold-Start Creation And Repair

修改方向：

- 复用确定性 cold-start 语义，并为新记录写入独立的非语义 sidecar。
- Repair 只处理缺失或已被可信证据标记为本地 cold-start 的损坏槽位。
- 不根据维度、版本标签或 legacy contract 推断生产者。
- Mixed-lineage 与未知 lineage 的已有向量保持非破坏性处理。
- 旧迁移与补齐路径不得重新引入 shared legacy contract。

验收：

- 相同用户输入 replay 完全一致。
- 新用户拥有两组非语义 sidecar。
- Repair 不覆盖未知或 quarantined 的非空向量。
- 两个向量槽位独立修复；修复一个槽位不会改变另一个非空 unknown、quarantined 或 mixed-lineage 槽位。
- Daily refresh 回归路径保持可用。

## Task 4: Serving, Export And Similarity Boundaries

修改方向：

- Serving、export 与 ANN 统一消费同一 evidence status，并对非 semantic-ready 输入 fail-closed。
- Cold-start、sentinel-only、quarantined 与 unknown lineage 不得伪装成语义向量。
- 相似度计算必须遵守完整维度契约，不允许前缀比较掩盖不兼容。

验收：

- Default、cold-start、quarantine 三类输入均不调用 ANN。
- 不合格用户不进入导出。
- 不等长向量相似度为零，并在真实 retrieval policy 测试中生效。

## Task 5: Shared Audit And Daily-Ops Semantics

修改方向：

- Strict audit 与 daily ops 复用同一分类、计数、checksum 和 quarantine 身份语义。
- 用户与帖子向量均以持久化 producer evidence 或确定性 replay 证明来源。
- Full scan 不得有静默上限，并必须明确一致性能力与限制。
- Strict gate 只接受预先批准且身份稳定的 quarantine 集合。

验收：

- Audit 与 daily ops 对同一 fixture 的五态计数完全一致。
- 四条 quarantine 记录任一 ID、向量或 reason 变化都会阻断 strict。
- Post replay mismatch 被归类为 invalid。
- 普通游标不会被描述为 snapshot 证据。

## Task 6: Fail-Closed Repair CLI

修改方向：

- Repair 工具默认全量 dry-run，并对所有不完整、漂移或未经批准的证据 fail-closed。
- Proposal 必须覆盖目标记录、期望 metadata 与写前向量身份，并形成可审阅的 canonical digest。
- Apply 必须绑定独立批准的 proposal 与 quarantine 证据，且任何验证差异都在零写入状态停止。
- Dry-run、apply、backup 与 rollback 均保持 metadata-only，不修改向量数组。

验收：

- 默认 dry-run 不产生持久化、缓存、调度或进程变更。
- 任一 mismatch、unclassified 或 digest 漂移时 apply 写入次数为零。
- Apply/rollback 操作不含 Two-Tower、Phoenix 或 post dense vector 字段。
- Backup 可重复验证，rollback 遇到 vector drift 时零写入。

## Task 7: Release Gate And Master-Plan Wiring

修改方向：

- Release gate 使用全量 strict evidence，并禁止同一次运行自我批准 digest。
- Live evidence 前必须先通过确定性契约与 repair 行为验证。
- 主协调计划将后续阶段同时绑定 Phase 0 与 Phase 0.5 的完成证据。

验收：

- Shell syntax 检查通过。
- Digest 缺失或不匹配时 release gate 失败。
- Python 目录无任何改动。

## Task 8: Code Verification And Authorization Packet

修改方向：

- 完成相关代码验证、类型检查、release script 检查与全量只读证据采集。
- 使用原始机器可读输出记录 dry-run 与 strict audit 的真实结果。
- 由独立规格 reviewer 和质量 reviewer 检查全部可达验收标准。
- 生成足以独立审阅 writer pause、metadata apply、rollback 与恢复条件的生产授权包。

验收：

- Dry-run 覆盖全部 user/post 记录，无静默上限。
- 历史基线仅作为对照，授权包必须报告真实 live totals。
- Dry-run 证明零 Mongo/Redis/scheduler/process/Python mutation。
- 到此必须停止并请求生产操作的单独授权。

## Task 9: Separately Authorized Production Apply

执行边界：

- 仅在用户明确批准生产 mutation、writer pause 与失败回滚后执行。
- Writer pause 后重新生成权威证据，并只执行 digest-bound metadata apply。
- Apply 后完成缓存与进程一致性处理；任一验证失败都执行 metadata-only rollback。
- 只有严格验证通过后才恢复获批准的 Node jobs，Python writer 保持禁用。

验收：

- 向量数组 apply 前后 checksum 不变。
- 每个 live user dense vector 有 verified per-vector contract 或 approved quarantine。
- Replay-verified post 拥有正确 heuristic non-semantic contract。
- Quarantine count 与 approved digest 保持一致。
- Python 代码未修改，Python writer 未恢复。

## Completion Protocol

- 每个 Task 的实现、规格审查、质量审查和验证证据都必须记录。
- Task 1-4 完成后执行 writer/consumer integration gate。
- Task 5-7 完成后执行 audit/CLI/release integration gate。
- Task 8 完成后执行全量只读 gate，并生成授权包。
- Task 9 未获单独授权时，计划状态只能是 code-and-dry-run ready，不能声明 production complete。
- 全部获授权任务完成后，使用 `superpowers:verification-before-completion` 和 `superpowers:finishing-a-development-branch` 收尾。
