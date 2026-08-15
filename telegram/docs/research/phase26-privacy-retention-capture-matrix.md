# Phase 26 隐私、保留与证据捕获研究矩阵

更新时间：2026-08-15

## 范围与结论

Phase 26 只处理开发期 evidence linkage 的最小隐私边界，以及现有推荐轨迹的默认采集
开关。它不把历史 `RecommendationTrace` 变成 randomized logging evidence，不创建真实
数据 admission、TTL、Merkle completeness ledger、qualification root 或生产 capture sink。

| 范围 | 判定 |
|---|---|
| RecommendationTrace 显式启用 | `GO`，默认关闭 |
| 开发期查看者伪名 | `GO`，私有、不可服务 |
| 真实 viewer-cluster provenance | `NO-GO / unavailable` |
| TTL/保留策略 | `DEFERRED / retention horizon 未批准` |
| completeness ledger | `NO-GO / capture sink 未授权` |
| OPE、Promotion、随机化 serving | `NO-GO` |
| Task 9 | `UNAUTHORIZED` |

## 代码事实

- `recordRecommendationTrace` 由 feed side effect 调用；现在只有
  `RECOMMENDATION_TRACE_ENABLED === "true"` 才写入原始轨迹。
- 原始轨迹含账户、作者和候选 post 标识，不能作为匿名或 randomized policy receipt。
- 新的 `recommendation_viewer_pseudonym_v1` 只接受同进程 typed input，输出
  HKDF-SHA-256 + HMAC-SHA-256 的用途/epoch/key-version 分域伪名。
- 伪名 receipt 通过 `WeakSet/WeakMap`、canonical SHA-256 和递归冻结保护；结果固定
  `developmentEvidenceOnly=true`、`candidateEvidenceEligible=false`、
  `realDatasetEligible=false`、`servable=false`。
- 真实 reward bounds、PIT snapshot、propensity/full-support、viewer/time provenance
  和 qHat 证据仍由 Phase 22/14 的 fail-closed 合同阻断。

## 研究问题

1. 跨 epoch、purpose 和 key rotation 的查看者标识如何避免可链接范围扩大？
2. delayed outcome join 所需保留窗口能否由现有 TTL 语义安全表达？
3. capture completeness 是否有已授权的 append-only sink、根摘要和删除流程？
4. pseudonym、PIT、policy 和 outcome 是否能在不泄露原始 ID 的情况下绑定？
5. 哪些密码学边界能在没有生产 key lifecycle 和真实 provenance 时仍保持 fail-closed？

## Evidence Matrix

| 来源 | 阅读状态与前提 | 失败模式与仓库映射 | 决策 |
|---|---|---|---|
| Simson Garfinkel 等，*De-Identifying Government Datasets: Techniques and Governance*，2023，NIST SP 800-188，[DOI 10.6028/NIST.SP.800-188](https://doi.org/10.6028/NIST.SP.800-188) | `full_text`；去标识目标、攻击者模型、风险评估、生命周期治理。 | 单一哈希不能证明不可链接或删除；RecommendationTrace 仍含原始标识。 | 采用用途、epoch、密钥版本分域和开发专用边界；拒绝宣称匿名。 |
| Hugo Krawczyk、Pasi Eronen，*HMAC-based Extract-and-Expand Key Derivation Function (HKDF)*，2010，IETF RFC 5869，[官方 RFC](https://www.rfc-editor.org/rfc/rfc5869.html) | `full_text`；secret input、salt、info domain、固定输出长度。 | HKDF 不证明密钥轮换、泄露响应或 capture completeness。 | 采用 HKDF-SHA-256 作为用途/epoch 分域原语；生产 key lifecycle 延后。 |
| Hugo Krawczyk、Mihir Bellare、Ran Canetti，*HMAC: Keyed-Hashing for Message Authentication*，1997，IETF RFC 2104，[官方 RFC](https://www.rfc-editor.org/rfc/rfc2104.html) | `full_text`；保密密钥、抗伪造 MAC、固定 hash。 | HMAC 不能替代 consent、PIT 或 viewer provenance，也不能防止密钥误用。 | 采用 HMAC-SHA-256 生成伪名；不把 receipt 当作真实数据证据。 |
| Elaine Barker，*Recommendation for Key Management: Part 1 – General*，2020，NIST SP 800-57 Part 1 Rev.5，[官方页面](https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final) | `full_text`；密钥生命周期、轮换、撤销、访问控制和恢复。 | 仓库当前没有生产密钥托管或撤销合同。 | 伪名 primitive 仅开发期；key version 字段不能解除生产门禁。 |
| NIST，*NIST Privacy Framework: A Tool for Improving Privacy through Enterprise Risk Management*，2020，NIST，[官方页面](https://www.nist.gov/privacy-framework) | `full_text`；识别、治理、控制、沟通和风险响应。 | 代码层 receipt 不等于组织级目的限制、删除或主体权利。 | 保留目的字段与默认关闭；不实现未经批准的 retention policy。 |
| MongoDB，*TTL Indexes*，官方文档，[TTL 说明](https://www.mongodb.com/docs/manual/core/index-ttl/) | `full_text`；后台 TTL 删除、过期检查存在延迟。 | TTL 不是即时删除证明；outcome horizon、legal hold 和恢复语义未冻结。 | 暂缓 TTL/index 变更，直到 retention contract 完成。 |
| RFC 9162，*Certificate Transparency Version 2.0*，2021，IETF，[官方 RFC](https://www.rfc-editor.org/rfc/rfc9162.html) | `full_text`；append-only log、consistency proof、inclusion proof。 | CT 结构不能直接证明 recommendation capture completeness 或删除边界。 | 仅作为未来 completeness ledger 比较材料，不在 Phase 26 实施。 |

## 采用与拒绝

采用的最小合同是：显式 opt-in、固定 purpose、epoch/key-version 分域、HKDF/HMAC、
资源预检、无原始 ID 输出、同进程 private brand 和明确的 non-servable flags。

拒绝 unkeyed SHA、可逆 tokenization、调用者布尔 adequacy、默认开启 trace、未经批准的
TTL、Merkle root、真实 viewer-cluster claim、randomized serving 和 OPE/Promotion 接线。

下一阶段只有在批准 retention/outcome horizon、真实 viewer/time provenance、生产 key
lifecycle 和 capture completeness sink 后，才可重新审查真实 evidence capture；否则继续
保持 `diagnostics_only_abstention_v1`。
