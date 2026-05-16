# 对标 X (Twitter) 推荐算法 — 差距分析与优化计划

> 基于 [xai-org/x-algorithm](https://github.com/xai-org/x-algorithm) 开源代码与当前 Telegram 克隆推荐系统的逐模块对比

---

## 一、核心理念差距

### X 算法的核心哲学：消灭手工特征

X 算法的关键设计决策是 **"No Hand-Engineered Features"** — 整个推荐系统完全依赖 Grok-based Transformer 从用户行为序列中自动学习相关性，不依赖任何手工设计的内容特征或启发式规则。

**当前系统的问题：** 我们的排序管线 (`lightweight_phoenix`) 仍然是一个 **手工加权线性模型**，有 15 个手工设计的相关性权重 + 5 组动作估计权重（`policy.rs` 中的 `SCORING_POLICY_V1`），加上额外的校准表、探索/利用乘子、多样性惩罚等大量手工规则。这与 X 的理念完全相反。

| 维度 | X (x-algorithm) | 当前系统 | 差距 |
|------|-----------------|---------|------|
| 排序模型 | Grok-based Transformer (多层注意力) | 线性加权 + 手工规则 | **架构代差** |
| 特征工程 | 模型自动学习 (Hash-Based Embeddings) | 15+ 手工特征权重 | **根本性差异** |
| 召回模型 | Transformer-based Two-Tower | Embedding MLP Two-Tower | **容量不足** |
| 内容理解 | Grox Pipeline (分类器+嵌入器) | 关键词+正则规则引擎 | **能力缺失** |
| 行为预测 | 15 种动作独立预测 | 5 种动作 + 手工组合 | **覆盖不全** |
| 推理框架 | JAX (GPU/TPU 原生优化) | PyTorch + 手工 C++/Rust | **需要统一** |

---

## 二、逐模块差距详解

### 2.1 排序模型 — 最大差距

**X 的做法：**
- Phoenix Ranker 是一个 Grok-1 架构移植的 Transformer
- 输入：User Embedding + History Sequence (127 tokens) + Candidate Sequence (64 tokens)
- Candidate Isolation Mask：候选之间不互相注意，只看用户历史
- 输出：19 种动作概率（favorite, reply, repost, quote, click, profile_click, video_view, photo_expand, share, dwell, follow_author, not_interested, block_author, mute_author, report...）
- 最终得分 = weighted_sum(P(action_i))

**我们的做法：**
- `lightweight_phoenix.rs`：手工线性模型 `relevance = sum(weight_i * signal_i)`
- `action_estimator.rs`：用手工公式估计 5 种动作概率
- `calibration.rs`：手工校准表（lane_prior, source_prior 等）
- `policy.rs`：184 行硬编码权重常量

**差距量化：**
- X 的 Transformer 可以学习非线性特征交互，我们只能做线性组合
- X 有 19 种动作头，我们只有 5 种（click/like/reply/repost/dwell）
- X 用 127 长度的行为序列做上下文，我们只用聚合后的 `UserActionProfile` 统计量

**优化计划：**

```
Phase 1 (1-2 个月): 训练基础设施
├── 1.1 收集用户行为序列数据 (post_id, author_id, action_type, timestamp)
│   └── 至少覆盖: like, reply, repost, quote, click, dwell, follow, block, mute, report
├── 1.2 搭建 JAX/PyTorch 训练管线
│   ├── 行为序列 tokenizer (action_type → embedding)
│   ├── Candidate Isolation Mask 实现
│   └── 多任务损失函数 (每个动作独立 BCE loss)
├── 1.3 Hash-Based Embedding 替代 ID Embedding
│   └── User/Post/Author 各用 2 个 hash function → 1M vocab embedding table
└── 1.4 训练 mini-Phoenix (128-dim, 4-layer, 4-head)

Phase 2 (2-3 个月): 模型升级
├── 2.1 扩展到 production 规模 (256/512-dim, 8-layer, 8-head)
├── 2.2 在线持续训练 (continuous training on real-time engagement)
├── 2.3 A/B 测试: Phoenix Ranker vs 当前 lightweight_phoenix
└── 2.4 逐步减少手工特征，最终完全移除 scoring/policy.rs 中的硬编码权重
```

---

### 2.2 召回模型 — 容量与架构差距

**X 的做法：**
- Two-Tower 模型，User Tower 同样用 Transformer 架构
- User Tower 共享 Ranking Model 的 Transformer 权重
- User Embedding = hash-based user features + Transformer(history)
- Candidate Tower 独立编码
- FAISS ANN 检索百万级候选库

**我们的做法：**
- `model_arch.py`：简单的 MLP Two-Tower
  - User Encoder = ID Embedding + Avg Pooling(history) → 2 层 MLP
  - News Encoder = ID Embedding → 2 层 MLP
- 没有利用 Transformer 处理行为序列
- 没有 Hash-Based Embedding

**差距量化：**
- X 的 User Tower 用 Transformer 理解行为序列模式，我们只用平均池化
- X 的 User/Post/Author Embedding 用 Hash-Based（泛化性好），我们用 ID Embedding（冷启动差）
- X 召回和排序共享 Transformer 权重，我们的两个模型完全独立

**优化计划：**

```
Phase 1 (1-2 个月): 升级 User Tower
├── 1.1 将 User Encoder 从 Avg Pooling 改为 Transformer
│   ├── 输入: [user_hash_embedding; history_action_embeddings]
│   ├── 用 2-4 层 Transformer Encoder
│   └── 输出: [CLS] token → user embedding
├── 1.2 引入 Hash-Based Embedding
│   └── User/Post/Author 各 2 个 hash → 1M table
├── 1.3 训练数据: 加入 action_type embedding (like/reply/repost/dwell...)
└── 1.4 训练: 对比学习 (InfoNCE loss) 或 Sampled Softmax

Phase 2 (2-3 个月): 生产化
├── 2.1 训练大规模模型 (768-dim, 8-layer)
├── 2.2 FAISS IVF+PQ 索引 (百万级候选)
├── 2.3 在线增量更新 embedding table
└── 2.4 与 Phoenix Ranking 共享底层 Transformer 权重
```

---

### 2.3 内容理解 — 能力缺失

**X 的做法：**
- `grox/` 服务：完整的 content understanding pipeline
  - Spam 检测分类器
  - Post 类别分类器
  - PTOS (Policy Terms of Service) 执行
  - 内容嵌入器 (text embedding)
- 集成到候选 hydration 阶段，为每个帖子生成内容特征

**我们的做法：**
- `safety_module.py`：规则引擎 + 可选 ML 分类器
  - 规则层：关键词匹配 + 正则 + URL 黑名单
  - ML 层：预留接口但默认禁用（`enable_ml=False`）
- 没有帖子类别分类、没有内容嵌入器、没有系统性的内容理解

**差距量化：**
- X 有完整的 content understanding stack，我们只有简单的关键词过滤
- X 的内容特征直接输入 Transformer，我们的 content_kind 是手工规则

**优化计划：**

```
Phase 1 (1-2 个月): 安全检测升级
├── 1.1 训练 ML 安全分类器
│   ├── 数据: 标注过的帖子 (spam/nsfw/violence/hate_speech/harassment/safe)
│   ├── 模型: DistilBERT 或 BERT-tiny 做多标签分类
│   └── 部署: 启用 safety_module.py 中的 ML 分类器
├── 1.2 添加 content category 分类器
│   └── 类别: sports/politics/tech/entertainment/news/opinion...
└── 1.3 添加 toxicity scoring

Phase 2 (2-3 个月): 内容嵌入
├── 2.1 训练帖子文本嵌入模型 (sentence-transformers)
├── 2.2 嵌入存入 FAISS 索引，用于内容相似度检索
├── 2.3 内容嵌入作为 Phoenix Ranker 的输入特征
└── 2.4 构建 Grox-style 任务执行引擎 (统一调度分类/嵌入/审核)
```

---

### 2.4 In-Network 存储 (Thunder) — 架构差距

**X 的做法：**
- `thunder/`：纯内存帖子存储 + Kafka 实时摄入
  - 消费 Kafka 的 post create/delete 事件
  - 按用户维护 3 个 store: original posts, replies/reposts, video posts
  - 亚毫秒级查询
  - 自动淘汰过期帖子

**我们的做法：**
- C++ Graph Service 做社交图谱（邻居查询、多跳遍历）
- 但没有独立的 in-network 实时帖子存储
- 站内帖子检索可能依赖数据库查询

**差距量化：**
- X 有专用的内存帖子存储，in-network 查询是亚毫秒级
- 我们只有图服务，没有帖子级的内存存储
- 缺少 Kafka 实时摄入管线

**优化计划：**

```
Phase 1 (1-2 个月): 搭建 Thunder 等价物
├── 1.1 用 Rust 搭建 in-memory post store
│   ├── 消费 Kafka 的 post create/delete 事件
│   ├── Per-user 分片: original / reply_repost / media
│   ├── 自动 TTL 淘汰 (24-48 小时窗口)
│   └── gRPC 查询接口
├── 1.2 与现有 C++ Graph Service 集成
│   └── 先查 graph 拿 follow list → 再查 post store 拿帖子
└── 1.3 性能目标: p99 < 1ms

Phase 2: 持续优化
├── 2.1 Sharded deployment (按用户 ID 分片)
├── 2.2 Bloom filter 用于快速判断帖子是否已看过
└── 2.3 冷启动: 当内存 miss 时 fallback 到数据库
```

---

### 2.5 Pipeline 框架 — 架构差距

**X 的做法：**
- `candidate-pipeline` crate: 通用可组合的推荐管道框架
  - 定义 trait: Source, Hydrator, Filter, Scorer, Selector, SideEffect
  - Source 和 Hydrator 自动并行执行
  - 错误处理和监控与业务逻辑分离
  - 用 Rust 实现，零成本抽象

**我们的做法：**
- Rust 侧 (`telegram-rust-recommendation`) 有 pipeline executor，但耦合较重
- pipeline/stage 定义和具体业务逻辑混在一起
- 各 scorer/filter 直接写在 pipeline 模块内部

**优化计划：**

```
Phase 1 (1 个月): 框架抽象
├── 1.1 提取通用 trait (与 X 的 candidate-pipeline 对齐)
│   ├── Source trait: async fn fetch(&self, query) -> Vec<Candidate>
│   ├── Hydrator trait: async fn hydrate(&self, candidates) -> Vec<Candidate>
│   ├── Filter trait: fn filter(&self, candidates) -> Vec<Candidate>
│   ├── Scorer trait: fn score(&self, candidates) -> Vec<ScoredCandidate>
│   ├── Selector trait: fn select(&self, scored, limit) -> Vec<ScoredCandidate>
│   └── SideEffect trait: async fn execute(&self, context)
├── 1.2 Pipeline executor 自动并行化独立 stage
├── 1.3 统一错误处理和 stage 级监控
└── 1.4 将现有 scorer/filter 迁移到新 trait 接口
```

---

### 2.6 候候选 Hydration — 覆盖度差距

**X 的做法：**
- Query Hydrators: 用户上下文
  - Followed topics, Starter packs, Impression bloom filters, IP, Mutual follow graphs, Served history
- Candidate Hydrators: 帖子上下文
  - Engagement counts, Brand safety signals, Language codes, Media detection, Quote post expansion, Mutual follow scores

**我们的做法：**
- Query hydration 有限（user_state_context, user_action_sequence）
- Candidate hydration 有基本字段但缺少很多 X 有的信号

**优化计划：**

```
逐步补齐 (持续):
├── Query 侧:
│   ├── 添加 followed topics hydration
│   ├── 添加 impression bloom filter (避免重复推荐已看过的内容)
│   ├── 添加 mutual follow graph hydration
│   └── 添加 served history (session 内)
├── Candidate 侧:
│   ├── 添加 brand safety signal hydration
│   ├── 添加 language detection
│   ├── 添加 media type detection (image/video/gif/poll)
│   ├── 添加 quote post expansion
│   └── 添加 mutual follow score
```

---

### 2.7 多样性机制 — 精细程度差距

**X 的做法：**
- Author Diversity Scorer：简单的 repeated-author attenuation
- OON Scorer：out-of-network 内容分数调整
- 设计哲学：依赖模型本身学到的多样性，不加太多手工规则

**我们的做法：**
- `diversity.rs`：intra-request diversity (author/source/topic/semantic 4 维惩罚)
- `constraints.rs`：lane floors/ceilings、author/topic/source/domain/media soft caps、trend/news 探索地板
- 过度依赖手工规则

**优化计划：**

```
方向: 逐步用模型替代手工多样性规则
├── 1. 保留 author diversity scorer (X 也保留了)
├── 2. 将 intra-request diversity 中的 semantic overlap 交给模型学习
├── 3. 将 lane constraints 逐步放宽，让模型自由决定内容分布
├── 4. 将 exploration 机制简化为 bandit epsilon-greedy (保留)
└── 5. 最终目标: 仅保留 author diversity + exploration 两个手工 scorer
```

---

### 2.8 模型预测头 — 动作覆盖差距

**X 的 Phoenix Ranker 预测 15 种动作：**

| 动作 | X 有 | 我们有 | 差距 |
|------|------|--------|------|
| favorite (like) | Yes | Yes | - |
| reply | Yes | Yes | - |
| repost | Yes | Yes | - |
| quote | Yes | No | **缺失** |
| click | Yes | Yes | - |
| profile_click | Yes | No | **缺失** |
| video_view | Yes | No | **缺失** |
| photo_expand | Yes | No | **缺失** |
| share | Yes | No | **缺失** |
| dwell | Yes | Yes | - |
| follow_author | Yes | No | **缺失** |
| not_interested | Yes | No | **缺失** |
| block_author | Yes | No | **缺失** |
| mute_author | Yes | No | **缺失** |
| report | Yes | No | **缺失** |

我们缺少 10 个动作预测头，特别是 **负面动作**（not_interested, block, mute, report）对内容安全和用户满意度至关重要。

**优化计划：**
```
短期 (训练 Phoenix 时一起加):
├── 优先添加: not_interested, block_author, mute_author, report
│   └── 这些是负面信号，对过滤不良内容最关键
├── 其次添加: quote, follow_author
│   └── 正面高价值行为
└── 最后添加: video_view, photo_expand, profile_click, share
    └── 媒体交互行为
```

---

## 三、优先级排序与实施路线图

### P0 — 最高优先级 (直接影响推荐质量)

| # | 优化项 | 投入 | 预期收益 |
|---|--------|------|---------|
| 1 | 训练 Transformer-based Phoenix Ranker | 2-3 人月 | 推荐质量质变 |
| 2 | 升级召回模型为 Transformer User Tower | 1-2 人月 | 召回质量显著提升 |
| 3 | 训练 ML 安全分类器 | 1 人月 | 内容安全从规则升级为模型 |
| 4 | 添加负面动作预测头 | 0.5 人月 | 不良内容过滤能力 |

### P1 — 高优先级 (架构升级)

| # | 优化项 | 投入 | 预期收益 |
|---|--------|------|---------|
| 5 | 搭建 in-memory post store (Thunder 等价物) | 1-2 人月 | in-network 查询延迟降低 10x |
| 6 | Hash-Based Embedding 替代 ID Embedding | 1 人月 | 冷启动和泛化能力 |
| 7 | 引入内容嵌入模型 (sentence-transformers) | 1 人月 | 语义理解能力 |
| 8 | Pipeline 框架抽象化 | 1 人月 | 可维护性和扩展性 |

### P2 — 中优先级 (精细化)

| # | 优化项 | 投入 | 预期收益 |
|---|--------|------|---------|
| 9 | 补齐 candidate/query hydration 信号 | 持续 | 特征丰富度 |
| 10 | 逐步减少手工特征权重 | 持续 | 让模型接管更多决策 |
| 11 | 内容分类器 (category/topic) | 0.5 人月 | 内容理解 |
| 12 | Impression bloom filter | 0.5 人月 | 减少重复推荐 |

### P3 — 长期方向

| # | 优化项 | 投入 | 预期收益 |
|---|--------|------|---------|
| 13 | 在线持续训练 (continuous training) | 2-3 人月 | 模型实时性 |
| 14 | 召回和排序共享 Transformer 权重 | 1 人月 | 参数效率 |
| 15 | Grox-style 统一内容理解引擎 | 2 人月 | 架构统一 |
| 16 | 广告混排系统 | 2 人月 | 商业化 |

---

## 四、关键结论

**最大的差距不是某个模块的缺失，而是排序理念的根本差异：**

X 通过 Grok-based Transformer 统一处理所有排序决策，让模型从用户行为序列中自动学习什么是好的推荐。而我们当前的系统是典型的 **"特征工程 + 线性模型 + 后处理规则"** 范式，这种范式在 2020 年之前是主流，但已经被 Transformer-based 推荐系统全面超越。

**最需要做的一件事：** 训练一个 Transformer-based Phoenix Ranker。这一项改变就能带来最大的质量提升，因为它替代了当前系统中 `scoring/policy.rs`、`scoring/action_estimator.rs`、`scoring/calibration.rs`、`scoring/rule_signals.rs` 四个文件中所有手工规则的总和。

**建议的迁移策略：** 不要一步到位，而是：
1. 先训练 Phoenix Ranker，与现有系统并行运行
2. 用 Phoenix 的输出替换 `lightweight_phoenix` 的手工公式
3. 逐步移除 calibration、exploration、affinity 等手工 scorer
4. 最终只保留 author diversity 和 exploration（X 也保留了这两个）
