# Phase 26 隐私、保留与证据捕获研究矩阵

更新时间：2026-08-15

## 范围与结论

Phase 26 只处理开发期证据链的隐私边界、密钥域分离和默认关闭。当前结论为
`CONDITIONAL GO`：采用私有、同进程、development-only 的 HKDF/HMAC viewer pseudonym
原语，并把 `RecommendationTrace` 改为显式 `RECOMMENDATION_TRACE_ENABLED=true` 才采集。
不把它作为 randomized evidence、viewer provenance 或生产 admission 的证明。

以下事项本阶段明确不实施：MongoDB TTL/retention job、append-only completeness ledger、
生产 capture sink、可反解 token、真实用户数据导出、runtime randomized serving、
Decision Log activation、Promotion、exploration 和 Task 9。保留窗口、Outcome join horizon、
删除/擦除语义和密钥生命周期尚未获得 owner 合同，不能先写成代码承诺。

## 代码边界

| 边界 | 当前事实 | Phase 26 映射 |
|---|---|---|
| RecommendationTrace | 记录原始 `userId`、候选/作者 ObjectId、解释和 replay 字段；此前默认开启，无 TTL | 仅显式 opt-in；不把既有 trace 当随机日志或 OPE 证据 |
| viewer identity | OPE/decision context 有 `viewer_account_pseudonym_v1` 名称，但没有真实 pseudonymizer 或 viewer provenance stream | 私有 HKDF/HMAC 伪名；`realDatasetEligible=false`、不可服务 |
| Phase 22 real intake | roots、PIT、viewer/time provenance、support 和 qHat 证据仍 `not_ready` | 不伪造 readiness wrapper，不修改真实 intake |
| Decision Log | 只有严格环境变量 `true` 才启用，且当前 deterministic-only | 保持 default-off，不能因隐私原语而激活 |

## 研究问题

1. 如何在用途、密钥版本和捕获 epoch 间做不可逆且可轮换的 viewer 伪名域分离？
2. 在真实 Outcome join horizon 和擦除要求未冻结时，TTL 是否会误删或延迟删除？
3. 既有 RecommendationTrace 能否证明 capture completeness，还是只能作为普通业务观测？
4. 哪些 PIT、viewer/time membership、purpose 和 key-root 字段必须绑定，才能避免把伪名误当 provenance？

## Evidence Matrix

| 来源 | 前提与失败模式 | 仓库映射 | 决策 |
|---|---|---|---|
| Simson Garfinkel 等，*De-Identifying Government Datasets: Techniques and Governance*，2023，NIST SP 800-188，DOI [10.6028/NIST.SP.800-188](https://doi.org/10.6028/NIST.SP.800-188)，`full_text` | 去标识化必须先定义发布目标、攻击/重识别风险、治理责任和生命周期；伪名不自动等于匿名。 | `RecommendationTrace` 含原始 ID，且没有用途/保留合同。 | 采用风险和生命周期边界；只实现开发期不可逆伪名，不声称匿名或真实 provenance。 |
| Hugo Krawczyk、Mihir Bellare、Ran Canetti，*HMAC: Keyed-Hashing for Message Authentication*，1997，IETF RFC 2104，[官方 RFC](https://www.rfc-editor.org/rfc/rfc2104.html)，`full_text` | 需要保密密钥和安全哈希；密钥暴露、复用或错误域编码会破坏不可伪造性/分离性。 | 新 privacy primitive 使用 HMAC-SHA-256；不输出 master key 或原始 viewer ID。 | 采用 HMAC 作为 keyed pseudonym construction；不把未加密 SHA-256 当伪名。 |
| Hugo Krawczyk、Pasi Eronen，*HMAC-based Extract-and-Expand Key Derivation Function (HKDF)*，2010，IETF RFC 5869，[官方 RFC](https://www.rfc-editor.org/rfc/rfc5869.html)，`full_text` | Extract/Expand 的 salt、info、长度和上下文编码必须固定；HKDF 不证明 seed commitment、coverage 或授权。 | `evidenceCapture/privacy` 绑定 purpose、key version、capture epoch 的 HKDF-SHA-256 context。 | 采用固定长度/用途分离；不把 HKDF 误作完整 capture receipt 或 production logger。 |
| Lily Chen、Elaine Barker、Allen Roginsky、Robert Keyes、Richard Lee、Angela Coker，*Recommendation for Key Management: Part 1 — General*，2020，NIST SP 800-57 Part 1 Rev.5，[官方](https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final)，`full_text` | 密钥需生命周期、访问控制、轮换、销毁和责任边界；只写 hash 不替代 key management。 | 当前仓库没有 production key store、rotation schedule、consent 或 erasure owner。 | 仅记录 keyVersion 输入并保持私有 development-only；推迟真实密钥生命周期实现。 |
| NIST，*NIST Privacy Framework: A Tool for Improving Privacy through Enterprise Risk Management, Version 1.0*，2020，NIST，[官方](https://www.nist.gov/privacy-framework)，`full_text` | 需要 identify-P/治理、控制、沟通和保护风险的闭环；单一技术字段不能证明合规。 | trace 的用途、访问、保留和删除边界尚未冻结。 | 采用“purpose/风险先于捕获”的约束；不声明合规或匿名化完成。 |
| MongoDB，*TTL Indexes* 与 *Expire Data from Collections by Setting TTL*，MongoDB Documentation，`full_text`，[TTL indexes](https://www.mongodb.com/docs/manual/core/index-ttl/)、[expire data](https://www.mongodb.com/docs/manual/tutorial/expire-data/) | TTL 删除由后台线程处理，存在延迟；TTL 不是即时擦除、Outcome join 保证或审计完整性。 | `RecommendationTrace` 当前无 TTL；真实 retention horizon、join 和擦除合同未批准。 | 本阶段拒绝新增 TTL/retention job；待窗口、索引和删除语义冻结后单独实施。 |
| Ben Laurie、Adam Langley、Emil Eiksson、Aram Hovsepyan，*Certificate Transparency Version 2.0*，2021，IETF RFC 9162，[官方 RFC](https://www.rfc-editor.org/rfc/rfc9162.html)，`full_text` | Append-only Merkle log 可提供一致性/包含证明，但需要 durable log、operator、checkpoint 和监控治理。 | 当前没有授权的 capture sink、root、持久 ledger 或 completeness consumer。 | 仅作为未来 ledger 比较；本阶段不创建 Merkle/append-only ledger。 |

## 采用与拒绝

采用：私有 `recommendation_viewer_pseudonym_v1`，HKDF-SHA-256 + HMAC-SHA-256，purpose/key
version/capture epoch 分域，预检输入和资源上限，输出固定为 development-only、不可服务、
不可证明真实数据资格；`RecommendationTrace` 默认关闭。

拒绝：unkeyed hash、可逆 tokenization、调用者布尔 assumption、把 raw trace 当 OPE/randomized
receipt、未经批准的 TTL、Merkle completeness ledger、生产 randomized serving 或任何
candidate/Promotion 授权。未来只有在 retention/erasure、真实 viewer/time provenance、PIT
和 key lifecycle 合同齐备后，才重新评估 capture sink 与 production evidence。

## Phase 26 状态

| 范围 | 状态 |
|---|---|
| Privacy primitive | `GO / private development-only` |
| RecommendationTrace capture | `GO / explicit opt-in` |
| Retention/TTL | `NO-GO / contract missing` |
| Completeness ledger | `NO-GO / sink and root missing` |
| Randomized production evidence | `NO-GO` |
| Real finite-sample inference / Promotion / Task 9 | `UNAVAILABLE / NO-GO / UNAUTHORIZED` |
