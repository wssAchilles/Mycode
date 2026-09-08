# Phase 150：Selector 窗口补位合同

更新时间：2026-08-30

## 范围与结论

本阶段处理 Rust top-k selector 在有限窗口外直接追加候选的问题。该追加没有经过
`SelectionState`，会绕过作者、主题、来源、媒体、OON 与 lane 约束，并把候选误记为
relaxed selection。

结论为 `CONDITIONAL GO`：

- 删除窗口外的直追加，让输出只包含状态机实际选择的窗口候选；underfill 由既有
  `fail_closed_selection` 与 page-underfilled 诊断如实呈现。
- Rust 是 selector 的 canonical owner；不改 Node 镜像、HTTP 合同、候选资格、策略版本、
  utility/OPE 或 promotion 开关。
- 未来若需要更高填充率，必须让尾部候选重新进入同一个状态机，并先定义 tail/rescue
  报告字段、资源上限和回滚合同；本阶段不做。

全局边界保持不变：

```text
selectedMethod = diagnostics_only_abstention_v1
candidateQualificationStatus = not_run
realDatasetEligible = false
real finite-sample inference = UNAVAILABLE
production randomized serving = disabled
```

## 当前代码事实

| 文件与符号 | 事实 | 风险 |
|---|---|---|
| `telegram-rust-workspace/crates/telegram-rust-recommendation/src/selectors/top_k/mod.rs`，`select_candidates_with_report` | 先按 `window_factor` 截断，再只把 `window` 交给 required/relaxed phases；报告的阶段计数来自 `SelectionState`。 | 窗口外候选不属于状态机的可选集合。 |
| `telegram-rust-workspace/crates/telegram-rust-recommendation/src/selectors/top_k/state.rs`，`constraint_verdict` / `apply_candidate` | 作者、主题、来源、媒体、domain、OON、lane 与 trend/news 计数在状态机中统一判断和更新。 | 任何绕过 `apply_candidate` 的候选都没有约束或计数语义。 |
| `telegram-rust-workspace/crates/telegram-rust-recommendation/src/selectors/top_k/output.rs`，`build_selector_output` | 旧实现用 `sorted.iter().skip(window_size)` 直接补到 `target_size`，之后才标注 selection metadata。 | 可超过软上限；`relaxed_selected_count` 只能用总数差值猜测，报告与实际阶段漂移。 |
| `telegram-rust-workspace/crates/telegram-selector-primitives/src/lib.rs` 与 `candidate_pipeline/manifest.rs` | 报告合同只允许 `selected_count <= window_size`；manifest 声明 selector fallback 为 `fail_closed_selection`。 | 直接补位是未定义的 fallback，不应被当作受控 rescue。 |
| live pipeline serving/post-selection | serving 只能重排已经选出的候选；rescue 只处理空选择，不能恢复 selector 丢弃的尾部 ID。 | 尾部删除会暴露真实 underfill，但不会破坏既有恢复语义。 |

## 研究问题

1. selector window 是约束状态机的硬 eligibility 边界，还是仅用于性能优化？
2. downstream serving 对 partial underfill 的既有合同是否允许 fail-closed 输出？
3. 若要处理尾部，应该复用 required、relaxed，还是新增明确的 rescue phase？
4. 报告如何区分状态机选择、尾部补位与受控 rescue，才能避免诊断误读？

## Evidence matrix

阅读状态：`full_text` 表示已阅读仓库源码/合同或官方页面；`abstract_or_public_description`
表示只使用官方摘要或公开描述。

| 问题 | 来源（精确标题、作者/机构、年份、出处、官方链接、状态） | 关键约束 | 仓库决定 |
|---|---|---|---|
| Q1/Q2 | `SelectionState`、selector report contract、pipeline manifest（本仓库，当前源码，`full_text`） | 约束判断和计数只在 `next_candidate_index`/`apply_candidate`；报告要求选择数不超过窗口，selector fallback 是 fail-closed。 | 采用窗口作为本阶段硬边界；移除未定义尾部路径。 |
| Q1 | **Evaluating Top-k Selection Queries** — Surajit Chaudhuri、Luis Gravano，1999，VLDB 1999，官方 [条目](https://www.vldb.org/dblp/db/conf/vldb/ChaudhuriG99.html)，`abstract_or_public_description` | top-k 截断依赖排序/筛选谓词；改变候选边界会改变集合，不只是展示顺序。 | 为窗口边界添加集合与报告回归；不把 synthetic 结果解释为 utility。 |
| Q2 | **Paginate search results** — Elastic Documentation Team，living Elasticsearch Reference，官方 [文档](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/paginate-search-results)，`full_text` | 分页/排序需要明确的稳定边界；受限窗口与资源成本是独立合同，不能靠隐式追加伪造结果。 | 保持有限窗口和现有 underfill 观测；不扩展在线资源或状态。 |

## 方案比较

| 方案 | 所需合同与失败模式 | 决定 |
|---|---|---|
| A. 删除窗口外直追加 | 只输出状态机选择；候选不足时显式 underfill，报告计数天然真实。 | **采用**，最小 Rust 修复。 |
| B. 尾部重新走 relaxed 状态机 | 需要跨窗口索引、phase 归因、无限/大输入资源上限和新的报告语义；若仍只用计数差值会继续漂移。 | **拒绝本阶段**，合同改动过大。 |
| C. 新增 tail/rescue phase | 需要定义是否可绕过哪些约束、单独计数、provenance、回滚和跨运行时合同；当前没有调用方或授权。 | **拒绝本阶段**，不能把未定义 fallback 伪装成 rescue。 |

## 可行性与验收边界

- 输入规模和窗口计算保持不变；删除尾部循环不会增加延迟、内存或跨进程状态。
- 回归夹具使用 `limit=6`、窗口内 18 个同作者候选、作者上限 2，证明旧实现会返回 6
  个而状态机只选择 3 个；修复后输出为 3，`required=2`、`relaxed=1`。
- 只断言候选数量、作者约束和阶段计数；不产生 CTR、utility、propensity、support、
  qualification 或 promotion 证据。
- selector policy version 升级为 `rust_top_k_selector_policy_v3`，仅用于隔离已有 serve-cache
  结果；不代表排序策略或线上资格升级。
