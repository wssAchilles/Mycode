# Phase 27: 统一多语言契约 Codegen 与 Wire 协议漂移防御方案

**编制时间**：2026-09-17  
**对标生态**：Google Protobuf/TAP、Uber Schema Registry (`buf breaking`)、Twitter/X 推荐体系 (`x-algorithm`)、Discord 实时网关、Rich Hickey Spec 规范理论、`AGENTS.md` 铁律  
**状态**：待用户审核 (Plan Ready for Review)

---

## 1. 目标与价值阐述 (Executive Summary)

大型即时通讯系统跨越 **Rust**（推荐引擎与实时边缘网关）、**TypeScript/Node.js**（业务主后端与轻量任务）、**Go**（消息扇出投递消费引擎）与 **C++**（高性能图计算内核）四大多语言技术栈，通过 **Redis Streams**（消息与平台事件总线）、**内部 HTTP REST**（推荐与图计算物化）以及 **Socket.IO/WebSocket**（客户端接入）形成高并发紧密互联。

### 1.1 核心矛盾与痛点诊断
目前各服务独立维护其 Wire 数据结构与反序列化逻辑，缺乏跨语言自动化契约真理源（SSOT）与严格门禁，导致多处协议出现隐蔽漂移：
1. **P0 级跨端序列化崩溃**：`Demographics.ageRange` 在 Node 端为字符串（如 `"18-24"`），而在 Rust 端强类型反序列化为 `Option<(u32, u32)>`（对应 JSON 数组 `[18, 24]`），在生产混合流量下直接引发反序列化致命崩溃；
2. **P1 级特征信号静默丢失**：`RecommendationCandidatePayload` 在 Rust 侧扩充的 10 个关键字段（如 `topicIds`、`hasMedia`、`mediaType`、`postType`、`mutualFollowJaccard` 等）在 Node 端 Zod Schema 中漏声明，被 Zod `.strip()` 行为静默剥离丢弃；`RankingSignalsPayload` 在 Rust 侧扩充的 3 个信号（`content_kind`、`trend`、`source_quality`）在 Node 端缺失；
3. **P1 级推荐决策指纹失步**：字段丢失导致跨端计算的 `candidate_pool_sha256` 指纹哈希失配，彻底破坏离线 OPE 策略评估、确定性回放与反事实推断的审计可信度；
4. **P1 级 Go 消费端协议穿透与零值污染**：Go 端 `decoder.go` 缺失 `specVersion` 门禁校验；`ProjectionPayload` 多个可选字段未标注 `omitempty`，序列化时产生空字符串或 0 污染；
5. **门禁脆弱**：现有 `check-recommendation-contract-schema.mjs` 仅使用脆弱正则检查 9 个图谱字段，无法覆盖核心 Candidate、Query 与 Delivery 事件。

### 1.2 Phase 27 核心使命
- **彻底修复 12 项重大协议漂移**，消除全仓所有跨语言类型违约与静默丢弃隐患；
- **确立 Rust 核心契约 crate (`telegram-recommendation-contracts`) 作为真理源 (SSOT)**，建立向后兼容且具备自愈能力的多语言契约体系；
- **构建跨语言黄金测试向量（Golden Test Vectors）**，在 Rust、TypeScript/Node、Go 三端落地 Golden Roundtrip 确定性哈希与双向编解码校验；
- **研发全自动化 CI 阻断门禁脚本 (`cross-language-contract-drift-gate.sh`)**，将静态 AST 校验、Schema 比对与 Roundtrip 测试固化为提交前强约束，杜绝未来任何静默漂移。

---

## 2. 学术与工程双向调研裁决矩阵

### 2.1 学术理论推导结论
- **裁决结论**：**CONDITIONAL GO（有条件推进）**。
- **类型同构与退化理论**：
  在类型论中，Rust 代数数据类型（ADT: Sum/Product Type）向 TypeScript 结构化子类型（Discriminated Union / Structural Type）及 Go 组合类型映射时，存在信息熵损失边界。针对可选字段 $\tau?$ 与未定义值 $\bot$，形式化推导要求：双向序列化映射必须满足同胚可逆单射（Injective Roundtrip）：
  $$\forall x \in \mathcal{T}_{\text{Rust}}, \quad \text{decode}_{\text{Rust}}(\text{encode}_{\text{TS}}(\text{decode}_{\text{TS}}(\text{encode}_{\text{Rust}}(x)))) \equiv x$$
- **稳健性原则（Postel's Law）与 Rich Hickey 规范理论**：
  - 接收端（Ingress）：遵循宽松原则（逆变兼容），未知字段无损保留，宽松容忍类型形式（如 `ageRange` 同时宽容接收字符串 `"18-24"` 与数组 `[18, 24]`）；
  - 发送端（Egress）：遵循严格原则（协变保证），输出标准规范化结构。
- **漂移度量与必然性定理**：
  基于马尔可夫决策链证明，多语言独立手工维护契约在时间演进下的漂移概率满足 $\lim_{t \to \infty} P(\text{Consensus}) = 0$。单真理源（SSOT）同态映射是唯一在数学上保证漂移距离 $D_{\text{drift}} \equiv 0$ 的完备解。

### 2.2 工业级工程对标与架构选型裁决
- **对标标杆**：Google Protobuf/TAP、Uber Schema Registry、Twitter/X 推荐事件与重排指纹架构 (`x-algorithm`)、Discord 实时网关。
- **架构选型裁决**：
  - 针对当前微服务集群运行在 Redis Streams、HTTP REST 与轻量内存快照的现状，全面切换为二进制 Protobuf 会带来巨大的破坏性迁移成本与日志可读性丧失；
  - 决定采用 **「以 Rust 核心契约为定义基准 + 规范化 JSON Schema 导出 + 跨语言 AST 静态语义门禁 + 黄金向量双向 Roundtrip 校验」** 的渐进治理体系。保持现有 Wire JSON 格式 100% 稳定，同时达成工业级防漂移治理。

---

## 3. 12 项重大跨语言契约漂移清册与修复矩阵

| 编号 | 严重级 | 涉及链路 | 根因描述 | 修复与加固方案 |
| :--- | :---: | :--- | :--- | :--- |
| **D-01** | **P0** | Node ↔ Rust (Query) | `Demographics.ageRange` 类型冲突：Node 产生字符串 `"18-24"`，Rust 解析期待 `(u32, u32)` 数组，导致反序列化崩溃 | 在 Rust 端实现灵活反序列化器，同时支持字符串格式（`"18-24"`）与元组（`[18, 24]`）；在 Node 端完善类型对齐与标准化转换。 |
| **D-02** | **P1** | Node ↔ Rust (Scoring) | `RankingSignalsPayload` 信号失步：Rust 新增 `content_kind`、`trend`、`source_quality`，Node 接口未声明 | 在 Node 端 TypeScript 接口及 Zod Schema 中补齐 3 项关键排名信号，并赋予强类型约束。 |
| **D-03** | **P1** | Node ↔ Rust (Candidate) | `RecommendationCandidatePayload` 10 字段漏声明：Zod `.strip()` 静默丢弃 `topicIds`, `hasMedia`, `mediaType`, `videoDurationMs`, `authorBlocksViewer`, `languageCode`, `isSubscriptionOnly`, `postType`, `mutualFollowJaccard`, `followingReplied` | 在 Node 端补齐全部 10 项字段的 TypeScript 接口声明与 Zod Schema 规则，确保跨端无损透传。 |
| **D-04** | **P1** | Node → Go (Delivery) | `FanoutRequestedPayload` 字段失步：Go 缺失 `projection` 和 `skippedReason` 字段；`OutboxID` 缺失 `omitempty` | 在 Go 端结构体补充对应字段及 JSON 标签，为 `OutboxID` 增加 `omitempty`。 |
| **D-05** | **P2** | Go 内部投递 (Delivery) | `ProjectionPayload` 零值污染：`OutboxID`、`JobID`、`AttemptCount`、`ReplayCount` 未标记 `omitempty`，序列化产生默认空值 | 为 Go 端可选字段全面补齐 `omitempty` 标签，防止重放或转发时零值覆盖下游。 |
| **D-06** | **P1** | Go 消费端 (Delivery) | `decoder.go` 缺失版本门禁：未校验 `specVersion` 是否符合 `DeliveryEventSpecVersion` (`chat.delivery.v1`) 与 `PlatformEventSpecVersion` | 在 `DecodeEnvelope` 与 `DecodePlatformEnvelope` 中引入严格的版本断言，遇到非法/不支持版本立即报错拒收。 |
| **D-07** | **P2** | Rust ↔ Node (Gateway) | `RealtimeTopic` 枚举多端同步：Rust 端枚举 7 种 Topic，需确保 Node 端常量与派发器完全对齐 | 固化双端 Topic 枚举与映射，并在 CI 静态门禁中建立互斥对齐校验。 |
| **D-08** | **P2** | Rust ↔ Node (Ops) | `GatewayRealtimeSummaryResponse` 监控统计字段缺失：Rust 扩充的队列溢出与恢复统计需在 Node 端感知 | 对齐双端监控诊断响应体结构（`outboundQueueSize` 等 4 项字段）。 |
| **D-09** | **P2** | C++ 图引擎 (Kernel) | C++ 反序列化脆弱性：`from_json` 中直接使用 `json.at()` 硬取，字段缺失将抛出未捕获的 `out_of_range` 崩溃 | 改用带有安全默认值的 `json.value(...)` 或添加异常安全防护，提升内核健壮性。 |
| **D-10** | **P2** | 跨全语言 (Diagnostics) | `emptyReason` 字段在各端表示不一致（部分为 `None`，部分为 `""`） | 统一规范空字符串与 null/none 的序列化语义。 |
| **D-11** | **P1** | Node ↔ Rust (Fingerprint) | `candidate_pool_sha256` 跨语言指纹一致性：受 D-02、D-03 字段缺失影响，跨端计算生成的 SHA-256 无法对齐 | 修复字段后，通过跨语言黄金测试向量验证 Rust 与 Node 端计算出的十六进制指纹 100% 绝对一致。 |
| **D-12** | **P1** | 研发基础设施 (CI Gate) | 契约防漂移门禁脆弱：旧脚本仅针对 9 个图谱字段匹配正则，形同虚设 | 研发全新的全自动 CI 阻断门禁脚本，结合跨语言 AST 语义扫描与黄金测试向量 Roundtrip。 |

---

## 4. 详细实施路径与改动文件清册

### 4.1 阶段一：TDD 跨语言黄金测试向量先行（红灯基准）
在代码修改前，先行确立权威黄金测试数据与跨端断言：
1. **新建统一黄金测试向量文件**：
   - `fixtures/contracts/golden_candidate_v1.json`：包含具有完整字段、极端值、多媒体及复杂排名信号的候选卡片；
   - `fixtures/contracts/golden_query_v1.json`：包含多种 `ageRange` 格式（`"18-24"` 字符串与 `[18, 24]` 数组）的查询载荷；
   - `fixtures/contracts/golden_delivery_envelope_v1.json`：包含标准规范的投递事件信封。
2. **在三端构建 Roundtrip 测试套件**：
   - **Node.js**: `telegram-clone-backend/tests/contracts/crossLanguageRoundtrip.test.ts`
   - **Rust**: `telegram-rust-workspace/crates/telegram-recommendation-contracts/tests/cross_language_golden_test.rs`
   - **Go**: `telegram-go-delivery-consumer/internal/contracts/golden_roundtrip_test.go`
   - 执行测试，验证当前存在漂移的断言处于预期红灯状态。

### 4.2 阶段二：核心业务契约修复与多端代码对齐
1. **Rust 端修复与弹性反序列化**：
   - 修改 `crates/telegram-recommendation-contracts/src/contracts/query.rs`：
     - 为 `Demographics.age_range` 引入自定义反序列化模块 `flexible_age_range`，完美支持字符串与整数元组双模式；
   - 保持 `candidate.rs`、`canonical.rs` 的强类型约束。
2. **Node.js 端契约加固**：
   - 修改 `telegram-clone-backend/src/services/recommendation/rust/contracts.ts`：
     - 在 `RecommendationCandidatePayload` 接口与 `recommendationCandidatePayloadSchema` 中补齐全部 10 项遗漏字段；
     - 在 `recommendationRankingSignalsPayloadSchema` 中补齐 `content_kind`、`trend`、`source_quality` 3 项信号；
   - 修改 `telegram-clone-backend/src/services/recommendation/types/FeedQuery.ts`：
     - 允许 `ageRange` 支持 `string | [number, number]` 联合形态。
3. **Go 端契约加固与门禁强化**：
   - 修改 `telegram-go-delivery-consumer/internal/contracts/delivery_payloads.go`：
     - 为 `FanoutRequestedPayload` 增加 `Projection` 与 `SkippedReason`；
     - 为 `ProjectionPayload` 的可选字段全面标注 `omitempty`；
   - 修改 `telegram-go-delivery-consumer/internal/contracts/decoder.go`：
     - 在 `DecodeEnvelope` 与 `DecodePlatformEnvelope` 中增加 `specVersion` 门禁断言。
4. **C++ 端反序列化健壮性增强**：
   - 修改 `telegram-cpp-graph-service/src/contracts/types.h`：
     - 将关键属性的 `json.at(...)` 解析升级为 `json.value(...)`，杜绝未捕获异常。

### 4.3 阶段三：全自动化 CI 契约阻断门禁体系建设
1. **实现多语言静态 AST / 字段对齐检查工具**：
   - 新建 `telegram-rust-workspace/scripts/check-cross-language-contracts.mjs`：
     - 遍历解析 Rust 结构体字段与 TypeScript 接口/Zod 字段，自动计算对称差集；
     - 任何一方擅自添加或删除 wire 字段未同步时，直接非零退出并输出精细差异报告。
2. **实现 CI 阻断总控脚本**：
   - 新建 `telegram-rust-workspace/scripts/cross-language-contract-drift-gate.sh`：
     - 第一关：运行静态跨语言契约对齐检查；
     - 第二关：执行 Node 跨语言 Roundtrip 测试套件；
     - 第三关：执行 Rust 契约 crate 黄金测试套件；
     - 第四关：执行 Go 契约解码与版本门禁测试套件。
   - 赋予执行权限并集成至项目验证流。

---

## 5. 验证计划与防御策略 (Verification Plan)

### 5.1 自动化测试矩阵
1. **契约静态对齐门禁**：
   ```bash
   node telegram-rust-workspace/scripts/check-cross-language-contracts.mjs
   ```
2. **Node 侧 Golden Roundtrip 测试**：
   ```bash
   cd telegram-clone-backend && npm test -- tests/contracts/crossLanguageRoundtrip.test.ts
   ```
3. **Rust 侧 Golden Roundtrip 测试**：
   ```bash
   cargo test -p telegram-recommendation-contracts --test cross_language_golden_test
   ```
4. **Go 侧 Golden Roundtrip 测试**：
   ```bash
   cd telegram-go-delivery-consumer && go test -v ./internal/contracts/...
   ```
5. **CI 阻断门禁总体验证**：
   ```bash
   bash telegram-rust-workspace/scripts/cross-language-contract-drift-gate.sh
   ```

### 5.2 安全性与回退保障
- **零破坏性协议变更**：所有改动严格遵循 Postel 稳健原则，仅涉及缺失字段补齐、弹性反序列化与可选字段 `omitempty` 修正，不改变已有合法字段的 wire 语义。
- **全端向后兼容**：新旧版本消息混跑时，旧版字段在新版解析中均有默认值，新版扩展字段在旧版中亦不会引发解析崩溃。
