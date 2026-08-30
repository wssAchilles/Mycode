# Phase 155：Replay Pool Rank 与 Canonical Selector 顺序

## 范围与结论

本阶段只修复 Rust trace replay pool 的 `rank` 与 Rust selector/serving canonical 顺序不一致，
以及 Node 将旧 rank 提升为 `poolRank` / `baselineRank` 时错误声明完整证据的问题。在线 selector、
served slate、随机策略数学、propensity、OPE、cursor 与生产开关均不改变。

定向研究复用 Phase 52 与 Phase 136 已核验的一手资料；这里是既有排序合同的传播与版本隔离，
没有引入新的 ranker、utility 假设或统计推断，因此不重复扩展外部检索。

结论为 `CONDITIONAL GO`：

- replay rank 必须复用 Rust `serving::stable_order::compare_candidates`，使其表示实际的
  canonical pre-selector baseline order。
- 新语义发布为 `pre_selector_canonical_order_v2`；不得在
  `pre_selector_scored_topk_v1` 下静默换 comparator。
- legacy/未知 pool 继续可读和分桶，但 Decision Log support 与 replay strict metrics 必须
  fail closed。
- parent `rust_candidate_trace_v1` 不升级：父 schema 未变，嵌套 `poolKind` 已精确版本化排序语义；
  旧 serve-cache 结果仍携带 v1 kind，消费端会拒绝其完整性声明。

全局状态保持：`selectedMethod=diagnostics_only_abstention_v1`、
`candidateQualificationStatus=not_run`、`realDatasetEligible=false`、real finite-sample inference
`UNAVAILABLE`、Promotion/exploration `NO-GO`、Task 9 `UNAUTHORIZED`。

## 当前代码事实与调用链

```text
Rust ranking.scored_candidates
  -> build_recommendation_trace
  -> trace_replay_pool
  -> RecommendationTrace.replayPool
     -> buildRustCandidatePool -> DecisionLog candidatePool.poolRank
     -> exportRecsysReplayRequests -> baselineRank
        -> evaluateReplayRequests / randomized-slate baseline order
```

- canonical owner 是 `serving/stable_order.rs::compare_candidates`。in-network 按
  `createdAt DESC -> postId DESC -> authorId DESC`；general 按
  `finite final score DESC -> createdAt DESC -> postId DESC -> authorId DESC`。
- Rust selector 已直接复用该 comparator；trace 仍独立使用
  `score -> weightedScore -> pipelineScore DESC -> postId ASC`。
- 因而高 weighted fallback、in-network 新旧冲突及同分 ID tie 都可产生不同 rank；top-K
  边界会改变被下游当作 baseline 的集合或位置。
- Node receipt 不重排 Rust rank。export 把它同时写成 `rank` 与 `baselineRank`；evaluator 再按
  `baselineRank` 计算 overlap、NDCG、Recall 与 rank lift。
- serve cache 的旧结果原样携带 nested pool kind。只要 consumer 校验 kind，就不需要为了一个
  diagnostics 子合同刷新在线 selector cache namespace。

## 研究问题

1. replay pool rank 是独立 trace-score proxy，还是实际 selector baseline 的可重放顺序？
2. 当前 comparator 差异是否会在 in-network、缺 final score 和 tie 三类输入上改变 rank？
3. 哪些下游把 rank 当作 baseline，而不是仅作展示字段？
4. 如何隔离旧缓存和历史 trace，避免同一版本名承载两种排序语义？
5. 在不复制 Rust 算法到 Node 的前提下，最小消费端拒答边界是什么？

## Evidence matrix

| 来源 | 精确元数据与阅读状态 | 前提与失败模式 | 仓库映射与结论 |
|---|---|---|---|
| **Evaluating Top-k Selection Queries** — Surajit Chaudhuri、Luis Gravano，1999，VLDB 1999，官方 [VLDB 条目](https://www.vldb.org/dblp/db/conf/vldb/ChaudhuriG99.html)，`abstract_or_public_description` | top-k 集合由排序谓词与截断共同决定；tie 合同改变可改变集合，不只是显示顺序。 | `trace_replay_pool` 在 60 个候选处截断；采用与 selector 相同的完整顺序。 |
| **Paginate search results** — Elastic Documentation Team，living Elasticsearch Reference，官方 [文档](https://www.elastic.co/guide/en/elasticsearch/reference/current/paginate-search-results.html)，`full_text` | 稳定 continuation 要求相同 query/sort 与唯一 tie-break；缺 PIT 时索引变化仍可导致漂移。 | 支持完整、确定 comparator；不据此恢复当前 ranked cursor。 |
| **Row Constructor Comparison** — PostgreSQL Global Development Group，PostgreSQL 15 Reference，官方 [文档](https://www.postgresql.org/docs/15/functions-comparisons.html)，`full_text` | 词典序逐字段比较，只有前缀相等才进入下一字段。 | 直接复用 canonical comparator，拒绝在 trace 中再实现一份近似顺序。 |
| **Cumulated Gain-Based Evaluation of IR Techniques** — Kalervo Järvelin、Jaana Kekäläinen，2002，*ACM TOIS* 20(4):422–446，DOI [10.1145/582415.582418](https://doi.org/10.1145/582415.582418)，`abstract_or_public_description` | DCG/NDCG 依赖已定义的 ranked retrieval function；换 rank 就换被评估对象。 | legacy trace-score rank 不能继续冒充 selector baseline；strict metric 必须拒答。 |
| **PROV-DM: The PROV Data Model** — Luc Moreau、Paolo Missier（编辑），2013，W3C Recommendation，官方 [规范](https://www.w3.org/TR/2013/REC-prov-dm-20130430/)，`full_text` | provenance 能说明派生关系，不能证明 utility、无偏性或资格。 | `poolKind` 标识排序派生合同；即使 v2 完整也仍是 diagnostics-only。 |
| **Unbiased Offline Evaluation of Contextual-bandit-based News Article Recommendation Algorithms** — Lihong Li、Wei Chu、John Langford、Xuanhui Wang，2011，WSDM 2011:297–306，DOI [10.1145/1935826.1935878](https://doi.org/10.1145/1935826.1935878)，`abstract_or_public_description` | 反事实 replay 需要随机/已知 logging probability、support 与 action reward。 | 当前 rank 修复不提供 propensity/PIT/真实 label；拒绝升级为 OPE 或 qualification。 |

外部结果只约束设计，不是本仓库效果证据。

## 方案比较

| 方案 | 优点 | 失败模式 | 决策 |
|---|---|---|---|
| canonical comparator + nested v2 kind | 复用唯一 Rust owner；rank 与 selector/serving 同义；旧记录可识别 | 旧 v1 仍存在，consumer 若忽略 kind 会误读 | **采用**；Node 对非 v2 完整性 fail closed |
| 保留独立 trace-score proxy | 不改变历史 v1 排序 | downstream 必须停止称其 baseline，并新增另一套 selector rank | **拒绝当前路径**；重复 rank 没有必要 |
| 在 v1 内直接换 comparator | diff 最小 | 旧缓存、历史 trace 与新 trace 同名异义 | **拒绝** |
| bump parent trace 与 selector/cache policy | 强制全量 namespace 隔离 | 在线 selector 没变，扩大 rollout 与缓存 blast radius | **拒绝**；nested kind 已足够 |
| diagnostics-only abstention | 不把 trace 误作真实 utility | 不能给出 promotion 或 finite-sample 结论 | **继续采用** |

## 可证伪假设、指标与资源

- 假设：对固定候选数组和 `inNetworkOnly`，v2 replay rank 与
  `compare_candidates` 的全排列完全一致。
- 指标：`rank_mismatch_count == 0`；回归覆盖 in-network 忽略 score、general 只用 final score、
  同 score/time 的 ID DESC tie。该指标只证明合同一致性，不证明质量提升。
- 复杂度：已有 trace sort 为 `O(C log C)`、临时引用为 `O(C)`、输出为
  `O(min(C, 60))`；复用 comparator 不增加渐近资源，也不创建 RNG、模型、propensity 或持久化状态。
- 失败条件：unknown/legacy kind、truncation、count mismatch、缺 selected candidate 任一出现时，
  support/strict metric 均不得声明 complete；Node 不得重算或修补 Rust rank。

## 决定与边界

| 范围 | 状态 |
|---|---|
| Rust canonical replay rank v2 | `CONDITIONAL GO / private diagnostics` |
| legacy v1 read compatibility | `GO / fail-closed completeness` |
| silent v1 semantic change | `NO-GO` |
| parent trace/selector/cache policy bump | `NO-GO / unnecessary blast radius` |
| real utility、OPE、qualification、Promotion、exploration | `UNAVAILABLE / NO-GO` |
