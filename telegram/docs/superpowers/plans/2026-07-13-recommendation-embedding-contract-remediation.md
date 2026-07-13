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

- `telegram-clone-backend/src/services/recommendation/contracts/`
- `telegram-clone-backend/src/models/UserFeatureVector.ts`
- `telegram-clone-backend/src/services/recommendation/users/registeredUserFeatureBootstrap.ts`
- `telegram-clone-backend/src/services/recommendation/hydrators/UserEmbeddingQueryHydrator.ts`
- `telegram-clone-backend/src/services/recommendation/sources/TwoTowerSource.ts`
- `telegram-clone-backend/src/services/jobs/FeatureExportJob.ts`
- `telegram-clone-backend/src/services/recommendation/contentFeatures/denseEmbedding.ts`
- `telegram-clone-backend/src/services/ops/recommendation/dailyRefreshOps.ts`
- `telegram-clone-backend/src/scripts/auditEmbeddingContracts.ts`
- `telegram-clone-backend/src/scripts/backfillEmbeddingContracts.ts`
- `telegram-clone-backend/src/scripts/demo/prepareInterviewDemo.ts`
- 对应的少量高价值 Vitest 测试
- `tools/release/verify_all.sh`
- 主协调计划文档

本阶段不扩展 Rust、frontend、Go、C++ 或 Python 的向量 sidecar 契约。

## Task 1: Known Contracts And Evidence Classification

修改方向：

- 增加注册用户 cold-start 非语义契约。
- 增加纯证据分类模块，统一输出 local fallback、semantic ready、quarantined、invalid、unclassified 五态。
- 当前没有权威 semantic manifest，因此 `semantic_ready` 在 Phase 0.5 中保持不可达；默认 sentinel 不得被提升。
- 固定 mixed-lineage quarantine reason，未知 reason 归类为 invalid。
- 向量结构校验同时检查维度、数值类型和有限性。
- 在用户模型中增加 Two-Tower 与 Phoenix 独立 sidecar，保留 legacy shared field 仅用于兼容读取。
- 将向量 checksum 和 quarantine digest 放入共享纯模块，使用确定性字节序和 UTF-8 排序。

验收：

- 默认 sentinel 单独存在时不能产生 semantic-ready。
- 冷启动契约与默认语义契约不兼容。
- NaN、Infinity、非数字和错误维度均为 invalid。
- quarantine 身份或向量变化会改变 digest。

## Task 2: Writer Boundary And Sparse-Update Protection

修改方向：

- 移除稀疏 SimClusters 更新对 legacy semantic contract 的隐式写入。
- 所有 dense write 必须携带对应 sidecar，且向量与 sidecar 结构匹配。
- Sparse-only update 不得触碰 dense vectors、per-vector sidecars 或 legacy shared contract。
- SimClusters 写入后失效两套现有用户 embedding cache namespace。
- 直接写入 dense vectors 的 demo seed 脚本改为显式非语义 sidecar，并使纯构造逻辑可测试、CLI entrypoint 可安全导入。

验收：

- Sparse update 的写集合不含任何 dense 或 contract 字段。
- 错误维度、非有限值、缺少 sidecar 的 dense write 被拒绝。
- 两套 cache invalidation 都被验证。
- Demo Two-Tower/Phoenix 向量各自携带正确非语义契约。

## Task 3: Non-Destructive Cold-Start Creation And Repair

修改方向：

- 暴露现有确定性 cold-start generator 供 replay 与测试复用，不改变算法输出。
- 新用户创建时原子写入两组 cold-start sidecar，不再写 shared semantic contract。
- Repair 只填补缺失槽位，或修复已被 sidecar 明确标记为 cold-start 且结构损坏的槽位。
- 不根据维度、model profile、model version 或 legacy contract 猜测生产者。
- Mixed-lineage Two-Tower 数组必须逐元素保留。

验收：

- 相同用户输入 replay 完全一致。
- 新用户拥有两组非语义 sidecar。
- Repair 不覆盖未知或 quarantined 的非空向量。
- Daily refresh 回归路径保持可用。

## Task 4: Serving, Export And Similarity Boundaries

修改方向：

- Hydrator 只读取 Two-Tower sidecar 和 quarantine 状态，并输出共享 evidence status。
- `TwoTowerSource` 只有在 evidence status 为 semantic-ready 时才能调用 ANN；Phase 0.5 默认保持 fail-closed。
- Feature export 使用同一分类器，不再凭 default sentinel 或 `semantic: true` 直接放行。
- Cold-start、sentinel-only 和 quarantined 用户都不得进入 ANN 或用户向量导出。
- Dense cosine 对不同维度直接拒绝，不再比较公共前缀。

验收：

- Default、cold-start、quarantine 三类输入均不调用 ANN。
- 不合格用户不进入导出。
- 不等长向量相似度为零，并在真实 retrieval policy 测试中生效。

## Task 5: Shared Audit And Daily-Ops Semantics

修改方向：

- Strict audit 与 daily ops 复用同一 evidence classifier、计数器、checksum 和 quarantine digest。
- User Two-Tower/Phoenix 独立分类；post 必须用持久化输入重新生成 48 维 heuristic embedding 并逐元素比对。
- Full scan 使用稳定 `_id` 顺序且没有静默 limit；报告明确 consistency mode。
- Strict mode 禁止限量扫描，并要求 approved quarantine digest。
- Release gate 要求 quarantined Two-Tower 记录数量固定为 4，身份摘要完全匹配。
- Daily ops 保留其他 action、signal、graph、job-run 查询不变。

验收：

- Audit 与 daily ops 对同一 fixture 的五态计数完全一致。
- 四条 quarantine 记录任一 ID、向量或 reason 变化都会阻断 strict。
- Post replay mismatch 被归类为 invalid。
- 普通游标不会被描述为 snapshot 证据。

## Task 6: Fail-Closed Repair CLI

修改方向：

- 原地改造现有 backfill CLI，默认全量 dry-run，禁止隐式写入。
- 参数解析拒绝未知参数、非法数值、apply without strict、strict/apply with limit。
- Mixed-lineage quarantine 必须同时满足固定 model profile、model version、两组 256 维有限向量、Phoenix replay 匹配、Two-Tower replay 不匹配。
- Post metadata 仅在 48 维 replay 逐元素一致时生成 proposal。
- 生成覆盖全部目标记录、desired metadata 和 before-vector checksum 的 canonical proposal digest。
- Apply 必须绑定 approved proposal/quarantine digests。
- Apply 前完成全量 preflight 和第二次全量 checksum/digest 验证，任何差异都必须在零写入状态停止。
- Dry-run、apply 和 rollback 都不得写入任何 vector array。
- 增加 metadata-only backup artifact；rollback 在全量校验当前 vector checksum 后只恢复 contract/quarantine metadata。
- CLI 使用受保护 entrypoint，测试导入不得连接数据库或启动主流程。

验收：

- 默认 dry-run 不调用 save、bulkWrite、Redis、scheduler 或 process control。
- 任一 mismatch、unclassified 或 digest 漂移时 apply 写入次数为零。
- Apply/rollback 操作不含 Two-Tower、Phoenix 或 post dense vector 字段。
- Backup 可重复验证，rollback 遇到 vector drift 时零写入。

## Task 7: Release Gate And Master-Plan Wiring

修改方向：

- `verify_all.sh` 移除 limited strict audit。
- Release gate 明确要求外部提供 approved quarantine digest 与 approved proposal digest，不能由同一次运行自我批准。
- Live audit 前运行确定性 audit/repair helper tests。
- 主协调计划将 Phase 1 入口同时依赖 Phase 0 与 Phase 0.5。

验收：

- Shell syntax 检查通过。
- Digest 缺失或不匹配时 release gate 失败。
- Python 目录无任何改动。

## Task 8: Code Verification And Authorization Packet

修改方向：

- 运行所有相关 Node tests、TypeScript check 和 release shell syntax check。
- 运行 full-collection read-only repair dry-run，保存原始 JSON 证据，不使用会改写 stdout 的包装器。
- 运行 full strict audit，记录 sidecar 尚未 apply 时的真实阻断结果。
- 独立 final spec reviewer 与 final code-quality reviewer 检查全部可达验收标准。
- 输出生产授权包：精确 cohort 数量、proposal digest、quarantine digest、vector checksums、metadata changes、writer pause、backup、apply、rollback、cache invalidation、Node refresh 和剩余 blocker。

验收：

- Dry-run 覆盖全部 user/post 记录，无静默上限。
- 历史基线 642 cold-start user、1,917 post、4 mixed-lineage 仅作为对照；live 增长必须报告真实数量。
- Dry-run 证明零 Mongo/Redis/scheduler/process/Python mutation。
- 到此必须停止并请求生产操作的单独授权。

## Task 9: Separately Authorized Production Apply

执行边界：

- 本任务只在用户明确授权 writer pause、Mongo apply、失败回滚、Redis 删除和 Node refresh 后执行。
- 先部署 writer fix 并确认没有旧 Node writer，再暂停 Node daily/manual/export 与现有 Python refresh writer。
- Writer pause 后生成最终 backup 和 authoritative full plan，对比已批准的 proposal/quarantine digests 与 checksums。
- Digest-bound apply 只更新 metadata。
- Apply 后失效批准的两类缓存并刷新 Node 进程。
- Full strict audit 与 release verification 通过后，仅恢复批准的 Node jobs；Python writer 保持禁用。
- 任一 post-check 失败时执行 metadata-only rollback，再次失效缓存并刷新 Node。

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
