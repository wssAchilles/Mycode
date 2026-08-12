# Phase 9：Cross-Fitted Reward Modeling、Full-Support Target Distribution 与 Decision-Clustered OPE Inference 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans；每个写入 owner 完成后依次做规格审查和代码质量审查。

**Goal:** 在不改变 Phase 1-8 已验收合同和生产默认值的前提下，增加完整 target-policy support、按 decision cluster 交叉拟合的 qHat artifact、OPE v2 置信区间和证据型 promotion v2。

**Architecture:** Rust 继续拥有 epsilon-Plackett-Luce 数学和 target distribution 选择语义；Node 新增独立 offline prediction bounded context，并通过严格 projection 接入既有 PredictionArtifactV1/OPE。OPE v1、Shadow v1、Promotion v1 保持原样，Phase 9 所有新入口均为离线、servable:false、无生产 caller。

**Tech Stack:** Rust/Serde/SHA-256、TypeScript/Zod/Vitest、Node crypto canonical JSON、现有 outcome_contract_v1、现有 OPE clustered variance；不修改或测试 ml-services/**。

---

## 状态与固定边界

- Phase 9 offline development：GO。
- 真实 logged-randomized 数据采集、policy promotion、runtime exploration/cutover：NO-GO。
- Production Task 9：UNAUTHORIZED；Phase 9 promotion verdict 必须仍包含 task9_unauthorized。本文后续的 Integration Gate 只是开发验证，不能改变该授权状态。
- 不运行 tools/release/verify_all.sh，不执行生产写入、DDL、migration、worker enablement 或主切。
- 不修改 .env，不读取、打印或记录其中的 URI、密码、token 或摘要。
- 不修改或测试 ml-services/**。
- 不覆盖、回退或重写工作树中 Phase 1-8 未提交改动；不 commit、push 或创建 PR。

## 已确认事实与必要调整

| 事实 | 计划约束 |
|---|---|
| buildSocialPhoenixFeatureMap 的 freshness 当前调用 Date.now() | 新增显式 referenceAt 的纯函数路径；cross-fitting 只传 decisionAt，禁止 wall-clock 特征。既有 serving caller 保持行为不变。 |
| trainSocialPhoenixModel.ts 顺序拟合并写入 trainedAt | 不复用、不修改该脚本作为 Phase 9 producer；新增确定性 offline producer 和薄 CLI。 |
| OPE v1 的 target schema 是单 slot，CI 固定 unavailable_v1 | v1 不变；v2 用 adapter 将完整 target steps 投影为单 slot，再独立计算 CI。 |
| PredictionArtifactV1 已存在但没有可信 producer | 新 artifact 先严格校验 crossFitted:true、servable:false 和完整 support，再投影到既有类型。 |
| Phase 8 kernel 只返回被选 action | 新增 target_policy_distribution_v1，输出每个 prefix/position 的全部剩余 eligible actions；绝不转成 behavior propensity。 |

## 依赖与 owner

| Owner | 写入面 | 依赖 | 完成门 |
|---|---|---|---|
| Rust 9A owner | Rust contract、target kernel、共享 fixture | 无 | Rust focused tests、fixture digest、规格审查、质量审查 |
| Node 9A verifier owner | target distribution Zod/verifier、Node fixture test | Rust fixture 定稿后做跨运行时验收 | Node focused tests、TypeScript compile、两轮审查 |
| Node 9B owner | offline prediction bounded context、cross-fit artifact、projection | Phase 3 valid observed samples；可与 9A 并行设计，集成测试等待 9A contract | producer/projection tests、TypeScript compile、两轮审查 |
| Node 9C owner | OPE v2、promotion v2 | 9A target projection、9B artifact projection | OPE/promotion tests、两轮审查 |
| Root integration owner | 图谱、跨运行时、回归和最终门禁 | 所有 owner 返回 | scoped tests、cargo、diff、无 runtime caller |

执行顺序：9A Rust contract/kernel → 9A Node verifier 集成；9B 可并行实现但不得复制 Rust 数学；9C 在 9A/9B projection 定稿后实现；最后统一回归和 codebase-memory 检查。

---

## Task 1：只读 preflight 与合同冻结

**Files:** 不修改文件；只读取现有实现和图谱。

- [ ] Step 1: 核对调用关系

使用项目 telegram-phase8-current 的 codebase-memory：

~~~text
search_graph(name_pattern="^buildSocialPhoenixFeatureMap$", include_connected=true)
search_graph(name_pattern="^evaluateOpeV1$", include_connected=true)
search_graph(name_pattern="^evaluateMultiObjectiveShadowPolicyV1$", include_connected=true)
search_graph(name_pattern="^evaluateRankingPromotionPolicyV1$", include_connected=true)
trace_path(function_name="verifyRandomizedSlateSimulationV1", direction="inbound")
trace_path(function_name="simulate", direction="inbound", include_tests=true)
~~~

记录：OPE/Shadow/Promotion 仍无生产 caller；Phase 8 Rust simulator 只有测试 caller；ml-services/** 不在写入面。

- [ ] Step 2: 建立不覆盖改动的基线

运行：

~~~bash
rtk git status --short
rtk git diff --stat
rtk git diff --cached --name-only
rtk git status --short -- .env ml-services
~~~

预期：工作树保持 dirty；.env 和 ml-services/** 无本阶段改动；没有 staged Phase 9 文件。

- [ ] Step 3: 冻结版本化配置

在后续 contract 中固定以下 literal：

~~~text
target_policy_distribution_v1
cross_fitted_reward_prediction_artifact_v1
ope_evaluation_v2
decision_cluster_robust_wald_v1
ranking_promotion_policy_v2
fold_assignment_version = decision_sha256_mod_k_v1
feature_encoding_version = social_phoenix_sparse_zero_v1
~~~

不把阈值、fold 数、CI level 或训练参数散落在算法代码中；所有值进入 canonical config 并参与 digest。

---

## Task 2：9A Target Distribution Rust 合同

**Files:**
- Create: telegram-rust-workspace/crates/telegram-recommendation-contracts/src/contracts/target_distribution.rs
- Modify: telegram-rust-workspace/crates/telegram-recommendation-contracts/src/contracts/mod.rs
- Create: telegram-rust-workspace/crates/telegram-recommendation-contracts/tests/target_distribution_contract.rs

- [ ] Step 1: 写失败的 Serde/digest 测试

测试覆盖：literal contract/evidence、1-based prefix、完整 action list、strict unknown fields、servable:false、target digest 排除自身、candidate/decision fingerprint 绑定、概率范围和每步诊断。

最小输出形状固定为：

~~~rust
// Serde wire literals:
// input contract: target_policy_distribution_input_v1
// output contract: target_policy_distribution_v1
// status: simulated
// evidenceKind: simulated_target_distribution

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetPolicyDistributionInputV1 {
    pub contract_version: TargetPolicyDistributionInputContractVersion,
    pub source_decision_log: serde_json::Value,
    pub source_decision_log_sha256: String,
    pub config: RandomizedSlateConfigV1,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetPolicyActionProbability {
    pub action_key: DecisionActionKey,
    pub deterministic_top: bool,
    pub plackett_luce_probability: f64,
    pub conditional_selection_probability: f64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetPolicyDistributionStep {
    pub served_position: NonZeroU32,
    pub prefix: Vec<DecisionActionKey>,
    pub probabilities: Vec<TargetPolicyActionProbability>,
    pub remaining_candidate_count: u32,
    pub prefix_length: u32,
    pub plackett_luce_probability_mass: f64,
    pub plackett_luce_mass_error: f64,
    pub mixed_probability_mass: f64,
    pub mixed_mass_error: f64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetDistributionSupportDiagnostics {
    pub source_candidate_count: u32,
    pub eligible_candidate_count: u32,
    pub logged_action_count: u32,
    pub step_count: u32,
    pub complete_support: bool,
    pub without_replacement: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetPolicyDistributionV1 {
    pub contract_version: TargetPolicyDistributionContractVersion,
    pub status: TargetPolicyDistributionStatus,
    pub decision_id: String,
    pub policy: RandomizedSlateConfigV1,
    pub baseline_order_version: BaselineOrderVersion,
    pub probability_semantics: ProbabilitySemantics,
    pub decision_fingerprint: DecisionFingerprint,
    pub candidate_pool_fingerprint: CandidatePoolFingerprint,
    pub steps: Vec<TargetPolicyDistributionStep>,
    pub support_diagnostics: TargetDistributionSupportDiagnostics,
    pub evidence_kind: TargetPolicyDistributionEvidenceKind,
    pub servable: bool,
    pub target_distribution_sha256: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetPolicyDistributionManifestV1 {
    pub contract_version: TargetPolicyDistributionManifestContractVersion,
    pub producer_version: TargetPolicyDistributionProducerVersion,
    pub dataset_version: String,
    pub source_dataset_manifest_sha256: String,
    pub policy_config_sha256: String,
    pub distribution_count: u64,
    pub distribution_ndjson_sha256: String,
    pub created_from_immutable_inputs: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetPolicyDistributionVerificationReceiptV1 {
    pub contract_version: TargetPolicyDistributionVerificationReceiptContractVersion,
    pub verifier_version: TargetPolicyDistributionVerifierVersion,
    pub status: TargetPolicyDistributionVerificationStatus,
    pub source_decision_ndjson_sha256: String,
    pub source_dataset_manifest_sha256: String,
    pub policy_config_sha256: String,
    pub distribution_ndjson_sha256: String,
    pub target_manifest_sha256: String,
    pub verified_distribution_count: u64,
    pub verification_receipt_sha256: String,
}
~~~

decisionId 沿用现有合同风格的 String，但 validate() 必须把它解析为 UUID、规范为 lowercase，并要求与 source decision log 和 decisionFingerprint 中的 canonical decisionId 完全相等，禁止同一 identity 的大小写双表示。每个 probability 的 actionKey.servedPosition 必须等于所属 step.servedPosition；probabilities 按公开的 compare_decision_pool_baseline 顺序输出。第一步 prefix 为空，第 k 步 prefix 精确等于按 servedPosition 排序后的前 k-1 个 source action keys。

- [ ] Step 2: 实现严格输入/输出校验

输入复用 RandomizedSlateConfigV1 和 Phase 7 decision log；源日志 actions 是 canonical logged slate，输出为每个已记录 position 物化的 prefix steps。基数固定为 `0 < source.actions.len <= config.slateSize`、source positions 连续为 `1..N`、`output.steps.len == N`、每步 `prefix.len == servedPosition - 1`；允许真实 logged slate 短于配置 slateSize，但禁止短于真实 logged actions。拒绝：

- source support incomplete、truncated 或 totalCount 不一致；
- candidate/decision digest 漂移；
- prefix 非连续、重复，或 identity tuple `(namespace, candidateId)` 不在 source slate；合法 mixed namespace 必须允许；
- eligible candidate 数不足、重复 identity、缺失 score、非有限数；
- steps 缺 position、概率缺失、remainingCandidateCount/prefixLength 不匹配、PL mass 或 mixed mass 的独立误差超过 1e-12；
- 输出 evidence 试图使用 logged_randomized 或 servable:true。

每步 probabilities 必须恰好覆盖删除 prefix 后的 remaining eligible set，无重复、无遗漏、保持 baseline 顺序。PL probabilities 与 mixed conditional probabilities 必须分别求和并独立满足 `abs(1 - mass) <= 1e-12`，不能让小 epsilon 掩盖 PL mass 错误。Rust validate_against 必须用公开 comparator 证明恰好一个 deterministicTop:true 且身份正确；不能只从 mixture 概率反推，尤其 epsilon=1 时仍必须可验证。

摘要必须调用既有 canonical_json/sha256_hex：

~~~rust
target_distribution_sha256 =
    SHA256(canonical_json(output_without_target_distribution_sha256));
~~~

sourceDecisionLog 保持 raw serde_json::Value：先 parse/validate typed decision，再对原始 Value 做 canonical hash，避免 timestamp offset/`.000Z` 重序列化漂移。实现 compute/verify_target_distribution_sha256、强制 self-hash 的 validate()，以及绑定 input policy、fingerprints、support、prefix/actions 的 validate_against()。manifest literal 固定为 `target_policy_distribution_manifest_v1`，producerVersion 固定为 `telegram_recommendation_policy_offline_v1`。摘要 preimage 固定为：sourceDatasetManifestSha256 对 source manifest 原始文件字节计算；policyConfigSha256 对 strict parse 后的 config canonical JSON 计算；distribution NDJSON 按 canonical lowercase decisionId 排序，每行是完整 distribution 的 canonical JSON，使用 LF 分隔且文件末尾恰好一个 LF，distributionNdjsonSha256 对这些最终原始字节计算。verification receipt literal 固定为 `target_policy_distribution_verification_receipt_v1`，status 只能是 `verified`，receipt 摘要 preimage 是去掉 verificationReceiptSha256 后的 canonical JSON；targetManifestSha256 对 canonical manifest JSON 加末尾 LF 的原始文件字节计算。Node 必须按同一规则重算全部摘要。manifest 或 receipt 自身都不充当 behavior evidence，receipt 只证明指定 Rust verifier 对绑定的 source/config/output bytes 完成了重算。

- [ ] Step 3: 运行 contract tests

~~~bash
cd telegram-rust-workspace
rtk cargo test -p telegram-recommendation-contracts --test target_distribution_contract
~~~

预期：所有新 contract 测试通过；不修改 Phase 8 randomized_slate contract 的 wire shape。

---

## Task 3：9A Rust Canonical Full-Support Kernel 与 Fixture

**Files:**
- Modify: telegram-rust-workspace/Cargo.toml
- Modify: telegram-rust-workspace/Cargo.lock
- Create: telegram-rust-workspace/crates/telegram-randomized-policy-primitives/Cargo.toml
- Create: telegram-rust-workspace/crates/telegram-randomized-policy-primitives/src/lib.rs
- Create: telegram-rust-workspace/crates/telegram-randomized-policy-primitives/src/epsilon_plackett_luce.rs
- Create: telegram-rust-workspace/crates/telegram-recommendation-policy-offline/Cargo.toml
- Create: telegram-rust-workspace/crates/telegram-recommendation-policy-offline/src/lib.rs
- Create: telegram-rust-workspace/crates/telegram-recommendation-policy-offline/src/target_distribution/mod.rs
- Create: telegram-rust-workspace/crates/telegram-recommendation-policy-offline/src/target_distribution/build.rs
- Create: telegram-rust-workspace/crates/telegram-recommendation-policy-offline/src/target_distribution/verify.rs
- Create: telegram-rust-workspace/crates/telegram-recommendation-policy-offline/src/main.rs
- Modify: telegram-rust-workspace/crates/telegram-rust-recommendation/Cargo.toml
- Modify: telegram-rust-workspace/crates/telegram-rust-recommendation/src/serving/policy/randomized_slate/mod.rs
- Modify: telegram-rust-workspace/crates/telegram-recommendation-fixtures/fixtures/cross_runtime_manifest.json
- Create: telegram-rust-workspace/crates/telegram-recommendation-fixtures/fixtures/target_policy_distribution_v1.json
- Modify: telegram-rust-workspace/crates/telegram-recommendation-fixtures/tests/cross_runtime_contract.rs

- [ ] Step 1: 抽出 Rust-only 共享数学，不改变 Phase 8 行为

公开的 compare_decision_pool_baseline 继续作为唯一 baseline 排序定义。新建低层 telegram-randomized-policy-primitives crate，只承载 stable softmax、加号 mixture、mass diagnostics 和无副作用的 `compute_full_distribution(remaining, epsilon, temperature)`；返回每个 remaining identity 的 PL/mixed probability 与两种 mass diagnostics，不做 draw、I/O 或 serving。它不依赖 server/runtime 类型。Phase 8 私有 simulation orchestration和 telegram-recommendation-policy-offline library 都调用该 Rust primitive，Node 不依赖它也不复制它。纯 `build_target_policy_distribution_v1` 只定义一次，位于 offline crate 的 target_distribution/build.rs；main.rs 是薄 CLI，verify.rs 调同一 builder 重算。serving crate 不定义、不 re-export target builder，policy/mod.rs 继续只声明私有 mod randomized_slate，不新增 runtime caller。

核心公式保持：

~~~text
p_i = (1 - epsilon) * I(i = deterministic top)
    + epsilon * softmax((logit_i - maxLogit) / temperature)
~~~

- [ ] Step 2: 实现 prefix-conditioned distribution

算法固定为：

~~~text
remaining = eligible candidates sorted by (poolRank, namespace, candidateId)
for step in logged actions ordered by servedPosition:
    validate step prefix == already consumed logged actions
    compute PL and mixture over remaining
    emit every remaining candidate probability
    remove the logged action candidate from remaining
~~~

只要 logged action 不在 remaining eligible set，整次输出返回稳定 blocker；禁止输出部分 steps。每个 step 的 PL/mixed 概率和、候选计数、prefix 长度和 1-based position 都写入 diagnostics。

- [ ] Step 3: 写 Rust kernel focused tests

覆盖：完整 support、prefix 删除、without replacement、每步概率和 <=1e-12、epsilon=1、固定 identity tie-break、极端 logit 下 fail closed、incomplete/truncated/duplicate/missing score、logged action 不在 eligible、simulation evidence 与 behavior evidence 隔离。

- [ ] Step 4: 建立离线 Rust producer/verifier 边界

telegram-recommendation-policy-offline library 是 canonical prefix orchestration owner，main.rs 是唯一可批量生成 target-policy distribution 的离线入口，提供显式子命令：

~~~text
build --input <decision-ndjson> --dataset-manifest <manifest.json>
      --config <policy.json> --output <distribution.ndjson>
      --manifest-output <target-manifest.json>
verify --input <distribution.ndjson> --manifest <target-manifest.json>
       --source <decision-ndjson> --dataset-manifest <manifest.json>
       --config <policy.json> --receipt-output <verification-receipt.json>
~~~

所有路径参数必填且无默认输出；build 先完整验证 immutable dataset manifest、逐 decision 重算 Rust full-support distribution，成功后才原子写 NDJSON 与 target manifest。verify 必须对显式 `--config` 做 canonical hash 并匹配 manifest.policyConfigSha256，再以该 config 对同一 source 重算数学、逐条 self-hash 和最终 raw-file digest；成功后原子写 verification receipt。只做 self-hash、只解析 manifest 或从待验证 distribution 反推 config 都不算通过。该 crate 不导入 server、SpaceService 等价 runtime、scheduler、Mongo/Redis client，也不注册生产命令。

Rust build/verify 在 open/parse 前执行与 Node 相同或更严格的 hard caps：每个输入文件最多 512 MiB、合计最多 1 GiB、单行/对象最多 1 MiB、流式 NDJSON 不允许全文件读入、最多 1,000,000 decisions/distributions、每 decision 最多 2,048 candidates 和 64 logged actions。config/manifest/receipt JSON 各最多 1 MiB。任一超限返回稳定 resource_limit_exceeded，不创建或覆盖 output/manifest/receipt；focused tests 覆盖 stat oversize、single-line oversize、aggregate rows、per-decision candidates/actions 和失败无部分文件。

- [ ] Step 5: 生成小型共享 fixture

fixture 由 Rust owner 生成并同时包含 input 和 canonical expected。更新 manifest domain 数量到 8，并用原始文件 SHA-256 校验；禁止创建大型 JSON 或新的 fixture 平台。

运行：

~~~bash
cd telegram-rust-workspace
rtk cargo test -p telegram-rust-recommendation randomized_slate
rtk cargo test -p telegram-randomized-policy-primitives
rtk cargo test -p telegram-recommendation-policy-offline
rtk cargo test -p telegram-recommendation-fixtures --test cross_runtime_contract
~~~

---

## Task 4：9A Node Strict Verifier 与跨运行时验收

**Files:**
- Create: telegram-clone-backend/src/services/recommendation/targetDistribution/contracts.ts
- Create: telegram-clone-backend/src/services/recommendation/targetDistribution/verify.ts
- Create: telegram-clone-backend/tests/recommendation/targetPolicyDistributionContract.test.ts
- Modify: telegram-clone-backend/tests/recommendation/crossRuntimeGoldenContract.test.ts

- [ ] Step 1: 定义 strict Zod contract

policyId 复用 eligible_pool_epsilon_plackett_luce_v1，但 contract/evidence 必须是 target distribution 专属 literal。Zod 同时定义 target_policy_distribution_manifest_v1 和 target_policy_distribution_verification_receipt_v1，拒绝未知字段、非 1-based position、非有限概率、servable:true、logged_randomized evidence、producer/verifier version 漂移、receipt self-hash 漂移和任一 raw/source/config/manifest 摘要不一致。

- [ ] Step 2: 实现 verifier，但不复制 Rust 选择算法

verifier 只做：

1. source decision/candidate-pool digest 重算；
2. output target digest 重算；
3. fingerprint/policy/position/prefix/support 绑定；
4. 每步 action identity 唯一、集合完整；Node 允许镜像公开且版本化的 contract-level comparator `(poolRank, namespace, candidateId)` 来验证 baseline 顺序，但不得实现 policy selection；
5. 每步恰好一个 deterministicTop:true 且必须是首项，mixture 公式与该标志一致。

Node 分别求和 fixture 已给出的 PL/mixed probabilities 并校验两个 mass 误差不超过 1e-12，但不重算 softmax、CDF、采样 draw 或 target distribution。Node 的 strict verifier 只能证明 shape/digest/binding，不能单独证明数学由 Rust kernel 生成，也不能授权 OPE 输入。

- [ ] Step 3: 等 Rust fixture 定稿后做同一 fixture 验收

~~~bash
cd telegram-clone-backend
rtk npx vitest run tests/recommendation/targetPolicyDistributionContract.test.ts tests/recommendation/crossRuntimeGoldenContract.test.ts
rtk npx tsc --noEmit
~~~

必须增加断言：target distribution 不被任何 SpaceService、selector、runtime serving 文件导入。

生产数据规模的 Node offline producer 只能接受 target NDJSON + target manifest + Rust verification receipt 三元组：manifest 和 receipt 固定 `producerVersion/verifierVersion:telegram_recommendation_policy_offline_v1`，distribution raw-file digest、source dataset manifest、policy config、target manifest raw digest 和 verified count 全部互相一致，receipt self-hash 通过。缺任一证据只能返回 not_evaluable；共享 fixture 仅用于合同测试，不替代数据集级 Rust verification。receipt 仍不是 production authorization 或真实 behavior evidence。

---

## Task 5：9B Offline Prediction 输入边界与确定性 Fold

**Files:**
- Create: telegram-clone-backend/src/services/recommendation/offlinePrediction/contracts.ts
- Create: telegram-clone-backend/src/services/recommendation/offlinePrediction/folds.ts
- Create: telegram-clone-backend/src/services/recommendation/socialPhoenix/math.ts
- Modify: telegram-clone-backend/src/services/recommendation/socialPhoenix/featureEngineering.ts
- Modify: telegram-clone-backend/src/services/recommendation/socialPhoenix/modelStore.ts
- Create: telegram-clone-backend/tests/recommendation/crossFittedFeatureBoundary.test.ts
- Create: telegram-clone-backend/tests/recommendation/socialPhoenixModelStoreRegression.test.ts

- [ ] Step 1: 固定 feature schema 与 as-of 时间

先在 offlinePrediction/contracts.ts 定义严格、可验证的 PIT 输入；producer 只接受该类型，不直接接受裸 SocialPhoenixFeatureInput：

~~~ts
type PitFeatureProvenanceInputV1 = {
  contractVersion: "pit_feature_provenance_input_v1";
  featureAt: string;
  referenceAt: string;
  datasetVersion: string;
  datasetManifestSha256: string;
  immutableSourceVersion: string;
  immutable: true;
  sourceSha256: string;
};

type OfflinePredictionActionSnapshotInputV1 = {
  contractVersion: "offline_prediction_action_snapshot_input_v1";
  decisionId: string;
  actionKey: DecisionActionKey;
  decisionAt: string;
  featureInput: SocialPhoenixFeatureInput;
  provenance: PitFeatureProvenanceInputV1;
};

declare const verifiedPitSnapshot: unique symbol;
type VerifiedPitPredictionSnapshot =
  OfflinePredictionActionSnapshotInputV1 & {
    readonly [verifiedPitSnapshot]: true;
  };
~~~

wire input 不接受 `verified` 状态。`verifyPitPredictionSnapshot(input, datasetManifest)` 使用 strict Zod 拒绝未知字段，验证 UUID/ISO timestamp/SHA-256、`featureAt <= decisionAt`、`referenceAt == decisionAt`、`immutable:true`、datasetVersion 与输入 manifest 一致，以及 immutableSourceVersion 非空。sourceSha256 preimage 固定为 canonical JSON：lowercase decisionId、actionKey、featureInput、featureAt、referenceAt、datasetVersion、datasetManifestSha256、immutableSourceVersion、immutable:true；verifier 必须重算并比较。只有该函数能返回内部 branded VerifiedPitPredictionSnapshot，调用方不能靠 wire 字段自我声明 verified。随后将 freshness 计算拆成可测试的纯路径：

~~~ts
export function buildSocialPhoenixFeatureMapAt(
  input: SocialPhoenixFeatureInput,
  referenceAt: Date | string,
): SocialPhoenixFeatureMap;
~~~

已有 serving buildSocialPhoenixFeatureMap 保持现有 Date.now() 行为；cross-fitting 只能从 branded snapshot 调用 buildSocialPhoenixFeatureMapAt(snapshot.featureInput, snapshot.decisionAt)。缺失或未验证的 provenance 返回 blocker，不填 0，也不把当前状态包装成 immutable evidence。

先用 socialPhoenixModelStoreRegression.test.ts 锁定现有 behavior：缺 task 返回 0；bias=0 返回 0.5；bias=1000/-1000 返回 1/0；zero、NaN 和 Infinity feature 均按当前实现跳过并保持 0.5。再把 modelStore 里现有数值稳定 sigmoid 原样移动到 socialPhoenix/math.ts，modelStore 和 offlinePrediction/logistic.ts 共同导入；不复制第二套 sigmoid。有限输入要求 bit-equivalent，非有限/缺 task 行为也不得改变。

禁止作为 feature 的字段：impressionAt、任何 outcome/label、selected、served、behavior/target probability、qHat、post-decision action history。

- [ ] Step 2: 固定 fold assignment

实现：

~~~ts
export function assignDecisionFold(
  decisionId: string,
  foldCount: number,
): number {
  const canonicalDecisionId = canonicalLowercaseUuid(decisionId);
  const digest = sha256("decision_sha256_mod_k_v1:" + canonicalDecisionId);
  const prefix = BigInt("0x" + digest.slice(0, 16));
  return Number(prefix % BigInt(foldCount));
}
~~~

校验 foldCount >= 2；decisionId 必须先解析并规范为 lowercase UUID，fold hash、排序、Map key 和一致性检查全部使用同一 canonical UUID，禁止大小写变体跨 fold。所有同 decisionId rows 的 fold 必须一致。输入排序固定为 (decisionId, candidateNamespace, candidateId, servedPosition)，feature keys、head names 和 coefficient keys 均按字节序排列。feature encoding 固定为 social_phoenix_sparse_zero_v1：同一 schema 内缺省 key 表示 builder 明确产生的零值；缺整条 action feature map、缺 schema key evidence 或跨 action 猜测补值仍然 fail closed。

- [ ] Step 3: 写边界测试

测试证明：同 decision 永远同 fold；同一 UUID 的大小写变体得到同一 canonical identity/fold；输入乱序不改变 assignment；Date.now() 改变不改变 as-of 特征；serving wrapper 仍使用现有 wall-clock 行为；sourceSha256 preimage 任一字段漂移都被拒绝；缺 feature/evidence、`featureAt > decisionAt`、referenceAt 不等于 decisionAt、使用 label/selected/served 或 fold 冲突时 fail closed。重构 sigmoid 前后复跑 serving scorer characterization vectors。

---

## Task 6：9B Cross-Fitted Multi-Head qHat Producer 与 Artifact Projection

**Files:**
- Modify: telegram-clone-backend/src/services/recommendation/offlinePrediction/contracts.ts
- Create: telegram-clone-backend/src/services/recommendation/offlinePrediction/logistic.ts
- Create: telegram-clone-backend/src/services/recommendation/offlinePrediction/produce.ts
- Create: telegram-clone-backend/src/services/recommendation/offlinePrediction/projection.ts
- Create: telegram-clone-backend/src/scripts/buildCrossFittedRewardArtifact.ts
- Create: telegram-clone-backend/tests/recommendation/crossFittedRewardArtifact.test.ts

- [ ] Step 1: 定义 artifact wire shape

cross_fitted_reward_prediction_artifact_v1 的 wire shape 固定为：

~~~ts
type CrossFittedRewardPredictionArtifactV1 = {
  contractVersion: "cross_fitted_reward_prediction_artifact_v1";
  datasetVersion: string;
  outcomeContractVersion: "outcome_contract_v1";
  objective: string;
  rewardDefinitionVersion: string;
  rewardDefinitionSha256: string;
  horizonMs: number;
  featureSchemaVersion: string;
  modelVersion: string;
  foldAssignmentVersion: "decision_sha256_mod_k_v1";
  foldCount: number;
  decisionId: string;
  decisionLogSha256: string;
  candidatePoolSha256: string;
  targetDistributionSha256: string;
  targetDistributionNdjsonSha256: string;
  targetDistributionManifestSha256: string;
  targetDistributionVerificationReceiptSha256: string;
  targetDistributionVerifierVersion: "telegram_recommendation_policy_offline_v1";
  predictions: Array<{
    actionKey: DecisionActionKey;
    foldId: number;
    qHat: number;
    primitivePredictions: {
      click: number;
      like: number;
      reply: number;
      repost: number;
      quote: number;
      share: number;
      dismiss: number;
      blockAuthor: number;
      report: number;
      dwell: number;
    };
  }>;
  foldDiagnostics: Array<{
    foldId: number;
    trainDecisionCount: number;
    holdoutDecisionCount: number;
    trainingDecisionSetSha256: string;
    holdoutDecisionSetSha256: string;
    modelSha256: string;
  }>;
  trainingConfigSha256: string;
  modelSha256: string;
  artifactSha256: string;
  crossFitted: true;
  servable: false;
};

type ProduceCrossFittedRewardArtifactResult =
  | { status: "produced"; artifact: CrossFittedRewardPredictionArtifactV1 }
  | {
      status: "not_evaluable";
      blockers: Array<{
        code:
          | "invalid_input"
          | "pit_provenance_missing"
          | "feature_after_decision"
          | "fold_training_complement_empty"
          | "fold_leakage_detected"
          | "target_support_incomplete"
          | "digest_mismatch"
          | "version_mismatch"
          | "resource_limit_exceeded"
          | "numerical_error";
        decisionId?: string;
        actionKey?: DecisionActionKey;
      }>;
    };
~~~

artifact hash 的 preimage 是 canonical artifact 去掉 artifactSha256；它必须绑定 per-decision targetDistributionSha256、dataset-level raw NDJSON/manifest/receipt digests 和 verifier version。顶层 model hash 覆盖排序后的每个 fold/head 系数和每 fold modelSha256；training config hash 覆盖 fold、epoch、learning rate、L2、feature/reward versions。每 fold diagnostics 必须把 canonical lowercase decisionId 排序后的训练集/留出集摘要、数量和 fold model digest 一起纳入 artifact digest。primitivePredictions 是上面的严格 10-head 对象，禁止缺 head 或未知 head。producer 的公开返回值只能是 `produced | not_evaluable`；失败分支不得携带 artifact、predictions 或 model coefficients。

- [ ] Step 2: 实现确定性 multi-head logistic

head 固定为 click/like/reply/repost/quote/share/dismiss/blockAuthor/report/dwell。前 9 个 label 转成 0/1；dwell target 为：

~~~text
min(labels.dwellTimeMs, rewardDefinition.dwell.capMs)
/ rewardDefinition.dwell.capMs
~~~

使用稳定 sigmoid、固定 full-batch L2 梯度下降；每个 epoch 先按 canonical identity 累加梯度，再统一更新，避免输入顺序影响结果。qHat 固定为：

~~~text
sum(binaryWeight[head] * prediction[head])
+ dwellWeight * dwellPrediction * dwell.capMs / dwell.scaleMs
~~~

训练 rows 只接收 outcome_contract_v1 的 status:'observed'、完整窗口和有效 immutable/version evidence；rewardDefinition.dwell.capMs 和 scaleMs 必须有限且大于 0，所有 reward weights 必须有限，所有 primitive predictions 必须在 [0,1]。prediction rows 可以是未曝光、无 label 的 candidate，但 logged action 和 target positive-support 每个 action 都必须有完整 feature/provenance。held-out decision 的所有 action 都只能使用其他 folds 训练的模型；当前 decision 的 outcome、target probability、selected/served 状态不得进入 feature 或训练 fold。

producer 先在原始 canonical decisionId 集合上构造并验证每个 fold：`holdout_f = {d | assignDecisionFold(d) = f}`、`train_f = allDecisionIds - holdout_f`、两集合交集为空且并集等于 allDecisionIds；完成集合 membership 校验后才计算各自 digest，禁止从 SHA-256 反推 membership。foldDiagnostics 必须按 foldId 排序、唯一且恰好覆盖 `0..foldCount-1`，每 fold 的 trainDecisionCount 和 holdoutDecisionCount 都必须大于 0；否则整次 producer 返回 not_evaluable。所有 prediction.foldId 必须在范围内，且同一 decision 的 predictions 使用同一 held-out foldId。不能把零初始化模型标记为 crossFitted:true；每 fold train/holdout counts、decision-set digests 和 modelSha256 都参与顶层 digest。

- [ ] Step 3: 强制完整 support 与 projection

训练 examples 和 prediction requests 分开：训练 examples 必须有 observed outcome；prediction requests 只要求经过验证的 PIT snapshot/provenance，并覆盖当前 decision 的完整 target support。每个 artifact 必须覆盖 logged action 和 target distribution 中所有 probability > 0 的 action，并绑定同一个 targetDistributionSha256。缺任一 feature、fold evidence、decision/candidate/target-distribution digest 或 support 时整 artifact 返回 not_evaluable，不生成部分 predictions。

projectToPredictionArtifactV1 只允许在上述校验通过后生成既有 PredictionArtifactV1：

~~~ts
{
  decisionId,
  decisionLogSha256,
  candidatePoolSha256,
  datasetVersion,
  artifactVersion: artifactSha256,
  objective: artifact.objective,
  rewardDefinitionVersion: artifact.rewardDefinitionVersion,
  horizonMs: artifact.horizonMs,
  predictions: predictions.map(({ actionKey, qHat }) => ({ actionKey, qHat })),
}
~~~

- [ ] Step 4: 添加有界离线 CLI，但不接生产调度

buildCrossFittedRewardArtifact.ts 必须显式要求 `--examples`、`--prediction-requests`、`--dataset-manifest`、`--target-distributions`、`--target-manifest`、`--target-verification-receipt` 和 `--output`；`--output` 没有默认值。CLI 只读取版本化 valid NDJSON/target distribution 输入并写指定本地输出；先重算并绑定 receipt/manifest/source/config/target raw digests，再完成 producer，仅在 status=produced 时写临时文件并原子重命名，not_evaluable 不留下部分 artifact。禁止 Mongo 写入、模型注册、runtime import 或 ml-services 调用。保留现有 trainSocialPhoenixModel.ts 不变。

资源上限作为版本化 config 参与 trainingConfigSha256，并在解析边界 fail closed。读取前先 stat：每个输入文件最多 512 MiB、全部输入合计最多 1 GiB；使用流式 NDJSON reader，单行/单对象最多 1 MiB，禁止 readFileSync 后再检查。`rows <= 1_000_000` 指 examples、prediction requests 和 target steps 解码后的合计对象数；global feature schema 与每 row 的 feature entries 都分别 `<= 4_096`；另有 `2 <= folds <= 32`、`1 <= epochs <= 1_000`。CLI 参数不得放宽 hard cap；测试覆盖 oversize stat、oversize single line、aggregate rows、global/per-row features、缺 `--output` 和 not_evaluable 无输出文件。

- [ ] Step 5: 运行 producer tests

~~~bash
cd telegram-clone-backend
rtk npx vitest run tests/recommendation/crossFittedFeatureBoundary.test.ts tests/recommendation/crossFittedRewardArtifact.test.ts
rtk npx tsc --noEmit
~~~

覆盖手算 sigmoid/qHat、fold leakage、UUID 大小写规范化、空训练 complement、训练/留出 decision-set digest、每 fold modelSha256、同 decision fold 一致性、乱序字节一致 artifact、非法 dwell scale/primitive prediction、缺 support/evidence/版本 fail closed、produced/not_evaluable 原子结果、CLI 资源上限、crossFitted:true 与 servable:false。

---

## Task 7：9C OPE v2 与 Decision-Cluster Robust Wald CI

**Files:**
- Create: telegram-clone-backend/src/services/recommendation/ope/v2/contracts.ts
- Create: telegram-clone-backend/src/services/recommendation/ope/v2/project.ts
- Create: telegram-clone-backend/src/services/recommendation/ope/v2/evaluate.ts
- Create: telegram-clone-backend/tests/recommendation/opeEvaluatorV2.test.ts

- [ ] Step 1: 保留 v1，定义 v2 输入/输出

ope_evaluation_v2 接收完整 target distribution、cross-fitted artifact、现有 observed outcome 和 behavior support；先严格验证版本/digest/support，再投影为既有 v1 slot observations，调用现有 evaluateOpeV1 的 estimator 逻辑。每个 logged servedPosition 必须且只能投影一条 observation。

校验分两级，不能互相扩大阻断面：

1. cluster structural gate：distribution.decisionId 匹配 observation、step.servedPosition 匹配 logged action、step.prefix 与 decision log 在该位置之前的 action prefix 完全一致、behavior evidence 声明的完整 eligible support 覆盖 step 的全部正概率 actions并提供真实 logged-action probability。任一失败则该 decision cluster 对全部 estimator fail closed。
2. DR prediction gate：artifact.targetDistributionSha256、dataset-level target NDJSON/manifest/verification-receipt digests、verifier version、artifactSha256、decision/candidate/reward versions 全部绑定，且 step 的全部正概率 actions 都有 qHat。任一失败则不向 v1 projection 传 predictionArtifact，记录稳定 DR blocker，使 DR/DR CI 为 not_evaluable；IPS、clipped IPS、SNIPS 仍保留该 cluster 并独立计算。

不得修改 evaluateOpeV1 或其 unavailable_v1 输出。

每条 observation 的 target policy 必须包含匹配 step 的全部 positive-support actions，不能只投影 logged action。DR 固定为：

~~~text
sum_a targetProbability(a | prefix) * qHat(a)
+ targetProbability(logged | prefix) / behaviorProbability(logged | prefix)
  * (observedReward - qHat(logged))
~~~

simulated_target_distribution 只能作为 target evidence；behavior 仍必须来自真实 logged_randomized evidence。deterministic behavior 继续硬阻断全部 estimator。

CI 类型固定为：

~~~ts
type DecisionClusterConfidenceInterval =
  | {
      status: "evaluated";
      method: "decision_cluster_robust_wald_v1";
      level: 0.9 | 0.95 | 0.99;
      estimate: number;
      standardError: number;
      criticalValue: number;
      lowerBound: number;
      upperBound: number;
      halfWidth: number;
      decisionClusters: number;
    }
  | { status: "unavailable"; reason: string };
~~~

- [ ] Step 2: 固定 critical values 与 fail-closed 规则

版本化映射：

~~~text
0.90 -> 1.6448536269514722
0.95 -> 1.959963984540054
0.99 -> 2.5758293035489004
~~~

standardError = sqrt(clusteredVariance.variance)。配置的 minDecisionClusters、level 和 segmentKeys 参与 config digest；maxHalfWidth 只属于 promotion policy，不参与 OPE 估计。cluster 数不足、variance 缺失/负数/非有限、coverage/support/version 漂移时对应 estimator CI 为 unavailable。DR 缺 qHat 只阻断 DR CI，IPS/clipped IPS/SNIPS 独立计算。

每个 segment 生成同一组 estimator CI；segment identity 和版本绑定沿用 v1 report。

- [ ] Step 3: 写 OPE v2 focused tests

覆盖：每个 logged position 恰好一条 observation、target step 全部 positive-support actions、手算完整 DR/IPS/SNIPS、targetDistributionSha256 与 artifactSha256 漂移只阻断 DR、手算 90/95/99 CI、标准误差、cluster 数门槛、segment CI、同 position 但错误 prefix 阻断全部 estimator、DR-only unavailable、负/非有限 variance、缺 target full support，以及 deterministic behavior 仍硬阻断。

~~~bash
cd telegram-clone-backend
rtk npx vitest run tests/recommendation/opeEvaluatorV2.test.ts tests/recommendation/opeEvaluatorV1.test.ts
~~~

---

## Task 8：Promotion v2 证据校验

**Files:**
- Create: telegram-clone-backend/src/services/recommendation/promotion/v2/contracts.ts
- Create: telegram-clone-backend/src/services/recommendation/promotion/v2/evaluate.ts
- Create: telegram-clone-backend/tests/recommendation/rankingPromotionPolicyV2.test.ts

- [ ] Step 1: 保留 v1 policy，建立 v2 contract

v2 policy 绑定 ope_evaluation_v2、CI method/level、dataset/outcome/reward/behavior/target/pipeline/model/artifact/index versions、minimum support coverage、minimum ESS、maxHalfWidth、quality/safety constraints 和 segment guardrails。不要修改 ranking_promotion_policy_v1 的 schema 或固定 blocker 数组。

- [ ] Step 2: 实现 evidence-first evaluation

校验顺序固定：

1. strict parse 与 canonical policy/evidence digest；
2. report objective/target fingerprint/dataset/reward/version 全部一致；
3. report coverage、ESS、CI level/method，并对每个全局及 segment required estimator 校验 `requiredCI.halfWidth <= policy.maxHalfWidth`；report 本身不存在 maxHalfWidth 字段；
4. constraint 使用 inclusive 语义：gte 仅在 `lowerBound >= threshold` 时通过，lte 仅在 `upperBound <= threshold` 时通过；
5. 每个 segment guardrail 都必须存在对应 CI、ESS 和 coverage；
6. rollback evidence、independent approval 和 production Task 9 授权状态。

missing_ci 仅在所需 estimator/segment CI 实际缺失时加入；不再无条件添加。task9_unauthorized 是 v2 evaluator 内部固定 blocker，不能由 input boolean、环境变量或调用者字段移除；最终 verdict 始终 blocked，ops 只返回 blockers/digests，不写配置、不改 mode、不生成审批材料。

- [ ] Step 3: 运行 promotion tests

focused tests 必须覆盖 `lowerBound == threshold` 与 `upperBound == threshold` 都通过，以及相差一个可表示浮点步长时按方向阻断；不得使用 epsilon 偷换 inclusive 合同。

~~~bash
cd telegram-clone-backend
rtk npx vitest run tests/recommendation/rankingPromotionPolicyV2.test.ts tests/recommendation/rankingPromotionPolicyV1.test.ts
~~~

---

## Integration Gate：集成验证、审查与发布门

**Files:**
- Modify only focused test/manifest files required by Tasks 2-8.
- Create: telegram-clone-backend/tests/recommendation/phase9OfflineImportBoundary.test.ts
- Do not add runtime imports under SpaceService、selector、serving route or production scheduler.

- [ ] Step 1: 运行完整 Phase 9 focused Node suite

~~~bash
cd telegram-clone-backend
rtk npx vitest run \
  tests/recommendation/targetPolicyDistributionContract.test.ts \
  tests/recommendation/crossFittedFeatureBoundary.test.ts \
  tests/recommendation/crossFittedRewardArtifact.test.ts \
  tests/recommendation/opeEvaluatorV2.test.ts \
  tests/recommendation/rankingPromotionPolicyV2.test.ts \
  tests/recommendation/phase9OfflineImportBoundary.test.ts \
  tests/recommendation/decisionLogContract.test.ts \
  tests/recommendation/opeEvaluatorV1.test.ts \
  tests/recommendation/multiObjectiveShadowPolicyV1.test.ts \
  tests/recommendation/rankingPromotionPolicyV1.test.ts
rtk npx tsc --noEmit
~~~

预期：新合同和既有 v1 regression 全部通过；任何失败先修 root cause，不放宽断言。

- [ ] Step 2: 运行 Rust focused chain

~~~bash
cd telegram-rust-workspace
rtk cargo test -p telegram-recommendation-contracts --test target_distribution_contract
rtk cargo test -p telegram-randomized-policy-primitives
rtk cargo test -p telegram-recommendation-policy-offline
rtk cargo test -p telegram-rust-recommendation target_distribution
rtk cargo test -p telegram-rust-recommendation randomized_slate
rtk cargo test -p telegram-recommendation-fixtures --test cross_runtime_contract
rtk cargo check -p telegram-recommendation-contracts -p telegram-randomized-policy-primitives -p telegram-recommendation-policy-offline -p telegram-recommendation-fixtures -p telegram-rust-recommendation
rtk cargo clippy -p telegram-recommendation-contracts -p telegram-randomized-policy-primitives -p telegram-recommendation-policy-offline -p telegram-recommendation-fixtures -p telegram-rust-recommendation --all-targets -- -D warnings
rtk cargo fmt --all -- --check
~~~

对准备交给 Node producer 的任意 dataset-level target NDJSON，必须先运行 Rust offline `verify` 子命令并把同一 raw-file SHA-256、target manifest 和 verification receipt 交给 Node；Node artifact 必须绑定三者摘要与 verifier version。fixture test 只覆盖小型 golden，不替代该 dataset-level gate。

- [ ] Step 3: 更新 codebase-memory 并确认无生产 caller

对本仓库重新做 fast 索引，项目名固定为 telegram-phase9-current，persistence=false，不持久化图或 secrets。先用 search_graph 取得精确 qualified_name，再用 include_tests=true 查询：

~~~text
index_repository(repo_path="/Users/achilles/Documents/telegram_code/telegram", name="telegram-phase9-current", mode="fast", persistence=false)
search_graph(name_pattern="^(compute_full_distribution|build_target_policy_distribution_v1|produceCrossFittedRewardArtifact|verifyTargetPolicyDistributionV1|evaluateOpeV2|evaluateRankingPromotionPolicyV2)$")
trace_path(function_name=<qualified_name_from_search>, direction="inbound", include_tests=true, depth=12)
~~~

为每个 qualified symbol 建立独立 allowlist：Rust primitive 只允许 Phase 8 私有 simulator、target kernel、offline Rust CLI 和 tests；buildTargetPolicyDistributionV1 只允许 offline Rust CLI/tests；Node verifier 允许 targetDistribution bounded context、offline projection/OPE v2/tests；producer 只允许显式 offline CLI/tests；OPE v2 只允许 promotion v2、离线 report/tests；promotion v2 只允许离线 evidence/tests。直接 caller 不必全部是 tests/CLI，但 codebase-memory 不得发现从 SpaceService、selector、serving route、scheduler、runtime owner 等 production roots 到任一新 symbol 的传递路径。

phase9OfflineImportBoundary.test.ts 使用 TypeScript compiler API 建完整模块图，不做字符串 grep。它必须遍历 ImportDeclaration、ExportDeclaration（含 `export * from`）、dynamic ImportExpression 和静态字符串 require()，解析相对路径与转接 re-export，再从所有 production runtime roots 计算传递依赖闭包；任何路径到 targetDistribution、offlinePrediction producer/projection、ope/v2、promotion/v2 都失败。非 literal dynamic import/require 出现在 protected 或 runtime roots 时也失败。受保护 bounded contexts 之间、tests 和显式 offline CLI 是唯一允许 caller。

- [ ] Step 4: 执行规格审查与质量审查

每个 owner 的顺序固定为：

1. owner 自检 focused tests；
2. 独立规格审查：逐条对照本计划、版本/位置/support/PIT/授权边界；
3. 独立代码质量审查：重复逻辑、digest preimage、数值稳定性、资源上限、caller 边界；
4. Critical/Important 必须修复并复跑相关测试；Minor 记录但不扩 Phase 9 范围。

- [ ] Step 5: 最终安全门

~~~bash
rtk git diff --check
rtk git diff --cached --name-only
rtk git status --short -- .env ml-services
~~~

最终状态只能报告：

~~~text
Phase 9 offline development: GO
real logged randomized data collection: NO-GO
policy promotion: NO-GO (task9_unauthorized and approval/rollback gates)
runtime exploration/cutover: NO-GO
~~~

不得将 simulated target distribution 写入 behaviorPropensity，不得启用 logged_randomized，不得改变任何 Phase 1-8 默认关闭状态。

## 计划自审清单

以下复选框只表示后续实现的验收项，不是当前 readiness 或 production authorization 证据：

- [ ] Full-support target distribution 有独立 contract、Rust canonical owner、Node verifier 和共享 fixture。
- [ ] Cross-fitting 以 decisionId 分 fold，排序和 digest 确定，held-out prediction 无训练泄漏。
- [ ] PIT snapshot/provenance 先验证再投影，Date.now() 不进入 offline feature cutoff。
- [ ] qHat 覆盖 logged action 与 target positive-support 全部 actions，缺失时 producer 原子 fail closed。
- [ ] OPE v1、Shadow v1、Promotion v1 行为不变；v2 通过 adapter/新 contract 接入。
- [ ] CI 使用 decision-cluster variance、固定 critical value、cluster/coverage/variance 门槛。
- [ ] Promotion gte/lte 使用 inclusive CI 上下界，missing_ci 证据化，production Task 9 仍固定阻断。
- [ ] 没有新增 production caller、在线探索、模型服务或 ml-services 改动。
- [ ] 没有真实数据质量、校准或 production readiness 声明。
