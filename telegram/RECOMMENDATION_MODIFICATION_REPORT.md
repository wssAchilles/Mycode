# 推荐算法修改意见 — 基于 x-algorithm 对标分析

> 本文档以 [xai-org/x-algorithm](https://github.com/xai-org/x-algorithm) 为参考基准，逐模块对比你的实现，指出偏差、缺失和可优化之处。

---

## 一、架构层面差异

### 1.1 Pipeline 评分流程：你的实现过度膨胀

x-algorithm 的评分管线极其精简，只有 **4 个 scorer**：

```
PhoenixScorer → WeightedScorer → AuthorDiversityScorer → OONScorer
```

你的 Rust 层膨胀到 **19 步**，Node 层 **9 个 scorer**。多出来的 scorer（ContentQuality、AuthorAffinity、Recency、ColdStartInterest、TrendAffinity、TrendPersonalization、NewsTrendLink、InterestDecay、Exploration、BanditExploration、Fatigue、SessionSuppression、IntraRequestDiversity、ScoreCalibration）都是你自行扩展的。

**修改建议**：

- 这些扩展 scorer 中，大部分是合理的业务适配（冷启动、趋势、探索），但它们的**乘数范围过于保守**（大多在 [0.9, 1.16]），经过 WeightedScorer 的大范围分数调整后，这些 scorer 的信号几乎被淹没。建议将扩展 scorer 的乘数范围放大到至少 [0.7, 1.5]，或者改为 additive bonus 模式。
- **ScoreCalibrationScorer 在 Node 层和 Rust 层都有实现，且参数不一致**。建议统一到 Rust 层，Node 层不再重复。

### 1.2 Score 字段语义

x-algorithm 的 score 流转非常清晰：

| Scorer | 读取 | 写入 |
|--------|------|------|
| PhoenixScorer | — | `phoenix_scores` |
| WeightedScorer | `phoenix_scores` | `weighted_score` |
| AuthorDiversityScorer | `weighted_score` | `score` |
| OONScorer | `score` | `score`（修改） |

你的 Rust 层有 10 个 scorer 声明 `writes_weighted_score: true`，这意味着它们都在修改同一个 `weighted_score` 字段。这导致**分数语义模糊**——经过 10 次修改后，`weighted_score` 已经不是"加权分数"了，而是包含 calibration、affinity、recency、exploration 等所有信号的混合物。

**修改建议**：

- 严格遵循 x-algorithm 的两阶段模式：**weighted_score 阶段**（仅 WeightedScorer 写入）和 **score 阶段**（AuthorDiversityScorer 写入最终 score）。
- 扩展 scorer 应该读取 `weighted_score` 并写入 `score`，而不是反复修改 `weighted_score`。
- 或者引入显式的 score channel（如 `calibrated_score`、`affinity_adjusted_score`），让每个阶段的语义明确。

### 1.3 Pipeline 框架差异

x-algorithm 的 `candidate_pipeline.rs` 使用 trait 对象（`dyn Source`、`dyn Scorer`）+ `join_all` 并行执行 source 和 hydrator。你的 Node 层 `Pipeline.ts` 实现了相同的模式，但增加了 `componentTimeoutMs` 和 `captureComponentMetrics`，这是好的扩展。

但你的 Rust 层 `runner.rs` **完全没有并行化**——19 个 scorer 是严格串行的函数调用。x-algorithm 虽然 scorer 也是串行的（因为依赖关系），但 source 和 hydrator 是并行的。

**修改建议**：

- Rust 层的 source 获取应该并行化（使用 `tokio::join!` 或 `futures::future::join_all`）。
- Rust 层的 hydrator 也应该并行化。
- scorer 必须串行（有依赖关系），但可以考虑将无依赖的 scorer 分组并行。

---

## 二、Scorer 逐模块对标

### 2.1 PhoenixScorer

**x-algorithm**：调用远程 Phoenix 预测服务，返回 `log_probs`，通过 `exp()` 转为概率。失败时返回空 `PhoenixScores`（所有字段为 `None`）。

**你的 Node 层**：增加了 `buildSocialPhoenixScores` 启发式回退，当远程模型不可用时用规则估算 14 个 action 分数。还增加了 `SocialPhoenixLinearModel` 学习模型。

**问题**：

1. x-algorithm 在 Phoenix 失败时直接返回空，WeightedScorer 会将所有分数视为 0，最终结果退化为纯 OON 降权后的排序。你的启发式回退虽然提高了可用性，但**启发式权重（50+ 行硬编码）与远程模型的输出分布不一致**，可能导致排序质量波动。
2. `buildSocialPhoenixScores` 中 `computeFreshness` 使用 `exp(-ageHours/72)`，而 `RecencyScorer` 使用 `0.5^(ageMs/halfLifeMs)`，两个 freshness 公式不一致。

**修改建议**：

- 启发式回退应该标记 `degradedMode: true`，让下游 scorer 知道当前分数是估算值。
- 统一 freshness 计算公式，避免同一个概念在不同 scorer 中用不同公式。
- 考虑将启发式回退的权重配置化（从 `ranking_policy` 读取），而不是硬编码。

### 2.2 WeightedScorer

**x-algorithm** 的 `offset_score` 函数：

```rust
fn offset_score(combined_score: f64) -> f64 {
    if combined_score < 0.0 {
        (combined_score + NEGATIVE_WEIGHTS_SUM) / WEIGHTS_SUM * NEGATIVE_SCORES_OFFSET
    } else {
        combined_score + NEGATIVE_SCORES_OFFSET
    }
}
```

这是一个**精心设计的归一化**：负分被压缩到 `[0, NEGATIVE_SCORES_OFFSET]` 区间，正分被偏移到 `[NEGATIVE_SCORES_OFFSET, +∞)`。这确保了负向行为（block、report）不会完全压垮正向分数，同时保留了区分度。

**你的 Node 层**：

```typescript
private normalizeScore(score: number): number {
    return Math.max(0, (score + NORMALIZATION.OFFSET) * NORMALIZATION.SCALE);
}
```

这只是简单的 `max(0, score + 0.1)`，**丢失了 x-algorithm 对负分的精细处理**。当 `combined_score` 为负时，你的实现直接截断为 0，而 x-algorithm 会将其映射到 `[0, 0.1]` 的小区间，保留了"这个内容有轻微负向信号"的信息。

**你的 Rust 层**的 `helpers/signals.rs` 中 `compute_weighted_score` 有类似的归一化，但公式也不完全一致。

**修改建议**：

- **对齐 x-algorithm 的 `offset_score` 逻辑**。这是排序质量的关键差异点。
- 统一 Rust 和 Node 层的归一化公式。

权重值对比：

| 行为 | x-algorithm | 你的 Node 层 | 差异 |
|------|-------------|-------------|------|
| FAVORITE_WEIGHT | 参数化 | 2.0 | 需确认是否一致 |
| REPLY_WEIGHT | 参数化 | 5.0 | 需确认 |
| RETWEET_WEIGHT | 参数化 | 4.0 | 需确认 |
| DWELL_WEIGHT | 参数化 | 0.3 | 需确认 |
| NOT_INTERESTED_WEIGHT | 参数化 | -5.0 | 需确认 |
| BLOCK_AUTHOR_WEIGHT | 参数化 | -10.0 | 需确认 |

x-algorithm 的权重在 `params` 模块中参数化管理。你的 Node 层硬编码在 `WeightedScorer.ts` 中，Rust 层硬编码在 `scorers/mod.rs` 中。

**修改建议**：将所有权重提取到统一的配置文件或 `ranking_policy` 中，支持运行时调整。

### 2.3 AuthorDiversityScorer

**x-algorithm**：

```rust
fn multiplier(&self, position: usize) -> f64 {
    (1.0 - self.floor) * self.decay_factor.powf(position as f64) + self.floor
}
```

使用 `author_id` 作为 diversity key，`decay_factor=0.8`，`floor=0.3`。

**你的实现**：公式完全一致。但你的 Node 层增加了**新闻内容的 diversity key 逻辑**——新闻帖使用 `sourceUrl` 的 hostname 或 `clusterId` 作为 diversity key，而不是 `authorId`。这是因为新闻帖的 `authorId` 通常是常量（如 NewsBot），会导致所有新闻被误判为同一作者。

**这是一个合理的扩展**，但需要注意：

- x-algorithm 没有新闻帖的概念（它是 Twitter 的 Home Timeline），你的扩展是针对 Telegram 的业务需求。
- 确保 `getDiversityKey` 的 fallback 逻辑健壮——如果 URL 解析失败且没有 clusterId，应该回退到 `authorId`。

**修改建议**：当前实现已经是正确的，无需修改。

### 2.4 OONScorer

**x-algorithm**：

```rust
let updated_score = c.score.map(|base_score| match c.in_network {
    Some(false) => base_score * p::OON_WEIGHT_FACTOR,
    _ => base_score,
});
```

非常简单：OON 内容乘以 `OON_WEIGHT_FACTOR`（默认 0.7）。

**你的 Rust 层**：`oon_scorer` 也是类似的逻辑，但增加了 `oon_factor` 的配置化读取。

**你的 Node 层**：`OONScorer.ts` 的实现与 x-algorithm 一致。

**修改建议**：当前实现已经对齐，无需修改。

---

## 三、Selector 对标

### 3.1 x-algorithm 的 TopKScoreSelector

```rust
pub struct TopKScoreSelector;
impl Selector<ScoredPostsQuery, PostCandidate> for TopKScoreSelector {
    fn score(&self, candidate: &PostCandidate) -> f64 {
        candidate.score.unwrap_or(f64::NEG_INFINITY)
    }
    fn size(&self) -> Option<usize> {
        Some(params::TOP_K_CANDIDATES_TO_SELECT)
    }
}
```

极其简单：按 `score` 降序排序，取 TopK。

### 3.2 你的 TopKSelector

你的实现远比 x-algorithm 复杂，增加了：
- **Lane-based constraints**（in_network、social_expansion、interest、fallback 的 floor/ceiling）
- **Soft caps**（author、topic、source、domain）
- **Exploration floor**（保证一定比例的探索内容）
- **Oversampling**（selector 多选一些，给 post-selection filter 留余量）
- **Constraint relaxation**（多轮 fill，逐步放松约束）
- **User state adaptation**（cold_start、sparse、heavy 不同策略）

**这些扩展都是合理的**，但有一个问题：

x-algorithm 的 selector 是**纯排序 + 截断**，不引入任何多样性约束。你的 selector 引入了大量业务逻辑（lane floors、soft caps），这使得 selector 的行为变得难以预测和调试。

**修改建议**：

- 将 lane-based mixing 逻辑从 selector 中分离出来，作为独立的 `LaneMixer` 组件。selector 应该只负责排序 + 截断。
- 软上限（soft cap）的值应该从 `ranking_policy` 读取，而不是硬编码在 selector 中。
- 当前的 7 轮 fill 逻辑（fillPersonalizedWindow → fillRequiredLaneFloors → fillExplorationFloor → fillByLaneOrder × 2 → fillBestAvailable × 2）过于复杂，建议简化为 3 轮：强制约束 → 放松约束 → 兜底。

---

## 四、Filter 对标

### 4.1 x-algorithm 的 Filter 列表

```
DropDuplicatesFilter
CoreDataHydrationFilter
AgeFilter
SelfTweetFilter
RetweetDeduplicationFilter
IneligibleSubscriptionFilter
PreviouslySeenPostsFilter
PreviouslyServedPostsFilter
MutedKeywordFilter
AuthorSocialgraphFilter
```

### 4.2 你的 Filter 列表（Node 层）

```
DuplicateFilter
NewsExternalIdDedupFilter
SelfPostFilter
RetweetDedupFilter
AgeFilter
BlockedUserFilter
MutedKeywordFilter
SeenPostFilter
PreviouslyServedFilter
VFFilter（post-selection）
ConversationDedupFilter（post-selection）
SafetyFilter（post-selection）
```

### 4.3 缺失的 Filter

**`AuthorSocialgraphFilter`**：x-algorithm 有这个 filter，用于根据社交图谱过滤作者（如屏蔽、取消关注等）。你的实现中没有对应的 filter，而是将类似逻辑分散在 `BlockedUserFilter` 和 `ScoreCalibrationScorer` 的 `getEarlySuppression` 中。

**修改建议**：

- 增加独立的 `AuthorSocialgraphFilter`，将社交图谱相关的硬过滤逻辑集中管理。
- `ScoreCalibrationScorer` 中的 `getEarlySuppression` 不应该做硬过滤（如 blocked user），这应该是 filter 的职责。

### 4.4 多余的 Filter

**`CoreDataHydrationFilter`**：x-algorithm 用这个 filter 检查核心数据是否成功加载。你的实现中这个逻辑在 hydrator 的 error handling 中隐式处理。

**修改建议**：保持当前做法即可，不需要增加。

---

## 五、Source 对标

### 5.1 x-algorithm 的 Source

只有 2 个：`PhoenixSource`（OON 内容召回）和 `ThunderSource`（关注网络内容）。

### 5.2 你的 Source

7 个：FollowingSource、GraphSource、NewsAnnSource、EmbeddingAuthorSource、PopularSource、TwoTowerSource、ColdStartSource。

**这是最大的架构差异**。x-algorithm 的召回非常简单（Phoenix Retrieval + 关注 Timeline），你的实现增加了图召回、embedding 召回、新闻召回、冷启动召回等多路召回。

**修改建议**：

- 多路召回本身是正确的，但需要注意**候选池之间的重叠**。x-algorithm 用 `DropDuplicatesFilter` 处理跨源去重，你也应该确保去重逻辑覆盖所有 source 组合。
- `TwoTowerSource` 中的 `loadLegacyCandidatePool` 使用 MongoDB `$expr` 做 engagement 过滤，这会阻止索引使用。建议将过滤逻辑移到应用层。
- `TwoTowerSource` 的三个候选池（dense_pool、cluster_pool、legacy_pool）是串行加载的，应该并行化。

---

## 六、Candidate 模型对标

### 6.1 x-algorithm 的 PostCandidate

```rust
pub struct PostCandidate {
    pub tweet_id: i64,
    pub author_id: u64,
    pub tweet_text: String,
    pub in_reply_to_tweet_id: Option<u64>,
    pub retweeted_tweet_id: Option<u64>,
    pub retweeted_user_id: Option<u64>,
    pub phoenix_scores: PhoenixScores,
    pub weighted_score: Option<f64>,
    pub score: Option<f64>,
    pub in_network: Option<bool>,
    pub video_duration_ms: Option<i32>,
    // ... 少量辅助字段
}
```

非常精简：核心字段只有 tweet_id、author_id、phoenix_scores、weighted_score、score、in_network。

### 6.2 你的 FeedCandidate

你的 FeedCandidate 包含了大量扩展字段：embedding 数据、news metadata、graph score、author affinity score、retrieval lane、interest pool kind、score breakdown 等。

**问题**：这些扩展字段中，很多是 scorer 之间传递中间结果用的（如 `_scoreBreakdown`），但它们被挂在 candidate 对象上，导致 candidate 对象变得臃肿。

**修改建议**：

- 将 scorer 间的中间结果从 candidate 对象中分离出来，使用独立的 `ScoringContext` 或 `ScoreBreakdown` map。
- candidate 对象只保留最终需要的字段（类似 x-algorithm 的精简设计）。

---

## 七、关键缺失项

### 7.1 缺少 `score_normalizer` 模块

x-algorithm 有独立的 `util/score_normalizer.rs`，提供 `normalize_score()` 函数，被 WeightedScorer 调用。你的实现中归一化逻辑内联在 scorer 中。

**修改建议**：提取独立的 `score_normalizer` 模块，统一归一化逻辑。

### 7.2 缺少 gRPC 服务层

x-algorithm 通过 gRPC 暴露 `ScoredPostsService`，支持 Gzip/Zstd 压缩、反射服务、最大消息大小限制。你的 Rust 层是 HTTP 服务。

**修改建议**：如果性能是关键考量，考虑迁移到 gRPC。gRPC 的二进制序列化比 JSON 更高效，压缩支持也更好。

### 7.3 缺少 `xai_stats_macro` 监控

x-algorithm 在每个 scorer、source、filter 上使用 `#[xai_stats_macro::receive_stats]` 宏自动采集指标。你的实现中没有对应的自动指标采集。

**修改建议**：在 Rust 层的每个 pipeline 组件上添加指标采集（使用 `tracing` + `metrics` crate）。

---

## 八、参数管理对标

x-algorithm 的所有参数集中在 `params` 模块中：

```rust
// 示例（推测）
pub const FAVORITE_WEIGHT: f64 = 2.0;
pub const REPLY_WEIGHT: f64 = 5.0;
pub const OON_WEIGHT_FACTOR: f64 = 0.7;
pub const AUTHOR_DIVERSITY_DECAY: f64 = 0.8;
pub const AUTHOR_DIVERSITY_FLOOR: f64 = 0.3;
pub const MAX_POST_AGE: u64 = 604800; // 7 days
pub const TOP_K_CANDIDATES_TO_SELECT: usize = 80;
pub const RESULT_SIZE: usize = 20;
```

**你的实现**中参数分散在多个文件中：
- Rust: `scorers/mod.rs` 中的常量、`ranking_policy` 中的动态参数、各 scorer 内部的硬编码值
- Node: `WeightedScorer.ts` 中的 `WEIGHTS` 对象、`RecencyScorer.ts` 中的 `PARAMS`、`TopKSelector.ts` 构造函数参数

**修改建议**：

- 建立统一的 `params` 模块（Rust）和 `params.ts`（Node），集中管理所有可调参数。
- 每个参数应有注释说明其含义和推荐范围。
- 关键参数（权重、衰减因子、阈值）应支持通过 `ranking_policy` 运行时覆盖。

---

## 九、优先级修改清单

### P0 — 必须修改（影响排序正确性）

| # | 问题 | 涉及文件 | 修改内容 |
|---|------|----------|----------|
| 1 | WeightedScorer 归一化逻辑未对齐 x-algorithm | Rust: `helpers/signals.rs`, Node: `WeightedScorer.ts` | 实现 `offset_score` 的负分压缩逻辑 |
| 2 | 扩展 scorer 反复修改 `weighted_score` | Rust: `runner.rs` 中所有 `writes_weighted_score: true` 的 scorer | 改为读 `weighted_score` 写 `score` |
| 3 | WeightedScorer 权重硬编码 | Rust: `scorers/mod.rs`, Node: `WeightedScorer.ts` | 提取到统一 params 模块 |

### P1 — 应该修改（影响排序质量和可维护性）

| # | 问题 | 涉及文件 | 修改内容 |
|---|------|----------|----------|
| 4 | 扩展 scorer 乘数范围过窄 | Rust: 各 scorer 的 `.clamp()` 范围 | 放大到 [0.7, 1.5] 或改为 additive |
| 5 | ScoreCalibrationScorer 双层重复 | Node: `ScoreCalibrationScorer.ts`, Rust: `calibration.rs` | 去掉 Node 层，仅保留 Rust 层 |
| 6 | Selector 过于复杂 | Node: `TopKSelector.ts` | 分离 lane mixing 逻辑，简化 fill 轮数 |
| 7 | PhoenixScorer 启发式回退权重硬编码 | Node: `PhoenixScorer.ts` | 配置化，标记 degradedMode |
| 8 | UserActionProfile 重复构建 | Rust: `affinity.rs`, `exploration.rs` | pipeline 入口构建一次，context 传递 |
| 9 | 缺少 AuthorSocialgraphFilter | Node filters/ | 新增独立 filter |

### P2 — 建议修改（影响性能和可观测性）

| # | 问题 | 涉及文件 | 修改内容 |
|---|------|----------|----------|
| 10 | Rust source 未并行化 | Rust: source 获取 | 使用 `tokio::join!` 并行 |
| 11 | Node TwoTowerSource 候选池串行加载 | Node: `TwoTowerSource.ts` | `Promise.all` 并行 |
| 12 | 默认 hasher 跨进程不稳定 | Rust: `semantic.rs`, `normalization.rs` | 换用 `ahash` 或 `xxhash` |
| 13 | 语义去重 stop word 仅英文 | Rust: `semantic.rs` | 增加 CJK 停用词 |
| 14 | 缺少自动指标采集 | Rust: 所有 pipeline 组件 | 添加 `tracing` + `metrics` |
| 15 | Candidate 对象臃肿 | Rust/Node: candidate 类型 | 分离中间结果到 ScoringContext |

---

## 十、总结

你的实现在 x-algorithm 的基础上做了大量合理的业务扩展（多路召回、冷启动、趋势、探索、多样性约束），但在**核心排序管线**上存在与参考实现的偏差。最需要关注的三个问题是：

1. **WeightedScorer 的归一化逻辑**——这是排序质量的基础，负分处理的差异会直接影响低质量内容的排序位置。
2. **Score 字段的语义混乱**——多个 scorer 反复修改 `weighted_score`，使得分数含义不明确。
3. **参数管理分散**——权重、阈值、衰减因子散落在多个文件中，难以统一调优和 A/B 测试。

建议按照 P0 → P1 → P2 的顺序逐步修改，每轮修改后进行 A/B 测试验证排序质量指标（CTR、engagement rate、diversity metrics）。
