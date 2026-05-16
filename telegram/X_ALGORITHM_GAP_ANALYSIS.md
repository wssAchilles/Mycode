# 对标 X (Twitter) 推荐算法 — 差距分析与优化计划 v2

> 基于 [xai-org/x-algorithm](https://github.com/xai-org/x-algorithm) 完整源码逐模块深度对比
> 更新日期: 2026-05-16

---

## 一、架构全景对比

### X 的五大模块

| 模块 | 语言 | 职责 | 我们有无 |
|------|------|------|----------|
| `candidate-pipeline/` | Rust | 通用可组合 pipeline 框架 (8 个 trait) | 部分有（耦合较重） |
| `thunder/` | Rust | 内存帖子存储 + Kafka 实时摄入 | **缺失** |
| `phoenix/` | Python/JAX | Grok Transformer 排序 + Two-Tower 召回 | 部分有（PyTorch，架构不同） |
| `home-mixer/` | Rust | 排序编排层（21 query hydrator + 18 candidate hydrator + 14 filter + 7 scorer） | 有（19-stage ladder，但手工规则为主） |
| `grox/` | Python | 内容理解 pipeline（安全/垃圾/嵌入，DAG 执行） | **基本缺失** |

### 我们的五大模块

| 模块 | 语言 | 职责 |
|------|------|------|
| `telegram-cpp-graph-service/` | C++ | 社交图谱内核（CSR 存储 + BFS/邻居/重叠查询） |
| `telegram-go-delivery-consumer/` | Go | 消息投递消费（Kafka 消费 + 平台分发 + 重试/DLQ） |
| `telegram-rust-workspace/` | Rust | 推荐排序（19 级 scoring ladder + 去重 + 趋势聚类） |
| `ml-services/` | Python/PyTorch | ML 模型（Two-Tower 召回 + Phoenix V1/V2 排序 + 安全过滤） |
| `telegram-rust-gateway/` | Rust | API 网关（限流 + JWT + 流量分类） |

---

## 二、逐模块深度差距分析

### 2.1 排序模型 — 最大差距

#### X 的做法（`phoenix/recsys_model.py` + `phoenix/grok.py`）

```
输入序列: [User Token | 128 History Tokens | 32 Candidate Tokens]
                ↓
    Hash-Based Embedding (K=2 hash × 3 entity type)
                ↓
    Grok Transformer (GQA + RoPE + RMSNorm + SiLU FFN)
    - Candidate Isolation Mask: 候选之间不互相注意
    - Right-Anchored RoPE: 最新历史 token 固定位置
    - Attention Clipping: 30 * tanh(logits/30)
                ↓
    19 个独立预测头 (每个 engagement 类型一个)
                ↓
    加权求和: Final = Σ(weight_i × P(action_i))
```

**关键设计决策**:
- **候选隔离注意力掩码**: 候选之间互不可见，只看用户历史 → 批量评分无交叉干扰
- **Hash-Based Embedding**: 2 个 hash 函数 × user/post/author → 固定内存，无需完整词表
- **符号动作编码**: `(2*actions - 1)` 编码同时表达动作存在和不存在
- **连续值嵌入**: dwell time 通过 2 层 MLP + GELU 投影为 embedding
- **19 种动作预测**: 包含 4 种负面动作（not_interested, block, mute, report）

#### 我们的做法

```
Phoenix V1: TransformerEncoder (768-dim, 12-head, 12-layer) + 4 个预测头
Phoenix V2: HashEmbedding + TransformerEncoder + 10 个预测头
实际运行: lightweight_phoenix.rs → 15 个手工特征线性加权 + 184 行硬编码权重
```

#### 差距量化

| 维度 | X | 我们 | 差距 |
|------|---|------|------|
| 排序模型 | Grok Transformer (JAX, GQA, RoPE) | 线性加权模型（实际运行）/ Transformer（已训练但未上线） | **架构代差** |
| 预测头 | 19 种（含 4 种负面） | 5 种（click/like/reply/repost/dwell） | **覆盖不全** |
| 行为序列 | 127 tokens 历史 + 64 候选 | 聚合后的 UserActionProfile 统计量 | **信息损失** |
| Embedding | Hash-Based (K=2, 固定内存) | ID Embedding（冷启动差）/ HashEmbedding（V2 已实现） | **V2 已对齐** |
| 注意力掩码 | 候选隔离 + Right-Anchored RoPE | 候选隔离（V1 已实现）+ 无 RoPE | **缺少 RoPE** |
| 框架 | JAX + bfloat16 | PyTorch + AMP | **基本对齐** |
| 推理设备 | GPU/TPU 原生 | CPU 硬编码（`app.py` line 127） | **严重性能问题** |

---

### 2.2 召回模型 — 架构差距

#### X 的做法（`phoenix/recsys_retrieval_model.py`）

```
User Tower: [user_hash_embed | history_action_embeds]
    → Grok Transformer (与排序模型共享权重)
    → Mean Pooling → L2 Normalize
    → user_repr ∈ R^D

Candidate Tower: [post_hash | author_hash]
    → 2-layer MLP (concat → project → SiLU → project → L2)
    → candidate_repr ∈ R^D

检索: scores = user_repr @ corpus_embeddings.T → top_k(200)
```

**关键**: User Tower **复用排序模型的 Transformer 权重**，参数效率高。

#### 我们的做法（`ml-services/scripts/model_arch.py`）

```
User Tower: ID Embedding + AvgPool(history) → 2-layer MLP → L2
News Tower: ID Embedding → 2-layer MLP → L2
```

#### 差距

| 维度 | X | 我们 |
|------|---|------|
| User Tower | Transformer 处理行为序列 | AvgPool 聚合 |
| 参数共享 | 召回/排序共享 Transformer | 两个模型完全独立 |
| Embedding | Hash-Based | ID Embedding（V2 有 HashEmbedding 但未用于召回） |
| 语义理解 | 用户行为序列模式 | 仅 ID 映射 |

---

### 2.3 候选源 — 覆盖度差距

#### X 的做法（`home-mixer/sources/`）

6 个并行候选源:
1. **ThunderSource**: 内存帖子存储，gRPC 查询，亚毫秒级
2. **PhoenixSource**: OON 召回（Two-Tower ANN 检索）
3. **PhoenixTopicsSource**: 基于主题的 OON 召回
4. **PhoenixMOESource**: 混合专家 OON 召回
5. **TweetMixerSource**: 混合源
6. **CachedPostsSource**: 缓存帖子

#### 我们的候选源

1. **Graph Kernel**: C++ 图服务（5 种图遍历：社交邻居/近期互动/共同互动/内容亲和/桥接用户）
2. **Two-Tower ANN**: PyTorch + FAISS 召回
3. **Following Source**: 关注用户的帖子
4. **Popular Source**: 热门帖子
5. **Interest Source**: 兴趣匹配
6. **Cold Start Source**: 冷启动

#### 差距

| X 有 | 我们有 | 差距 |
|------|--------|------|
| Thunder 内存帖子存储 | 数据库查询 | **延迟差 10-100x** |
| PhoenixTopics 主题召回 | 兴趣源（规则匹配） | **语义能力缺失** |
| PhoenixMOE 混合专家 | 无 | **完全缺失** |
| Bloom Filter 去重 | 无 | **完全缺失** |
| Impression 追踪 | 无系统性追踪 | **完全缺失** |

---

### 2.4 Query Hydration — 丰富度差距

#### X 的做法（`home-mixer/query_hydrators/`）

**21 个 Query Hydrator** 并行执行:

| Hydrator | 提供的信号 | 我们有无 |
|----------|-----------|----------|
| ScoringSequence | 用户行为序列（排序用） | 有（UserActionProfile） |
| RetrievalSequence | 用户行为序列（召回用） | **缺失** |
| BlockedUserIds | 屏蔽用户列表 | 有 |
| MutedUserIds | 静音用户列表 | 有 |
| FollowedUserIds | 关注用户列表 | 有 |
| SubscribedUserIds | 订阅用户列表 | **缺失** |
| ImpressionBloomFilter | 已看帖子布隆过滤器 | **缺失** |
| IP | 用户 IP 地理位置 | **缺失** |
| MutualFollow | 互相关注图 | **缺失** |
| ServedHistory | 服务历史 | 部分有 |
| UserDemographics | 用户画像 | **缺失** |
| InferredGender | 推断性别 | **缺失** |
| FollowedTopics | 关注话题 | **缺失** |
| StarterPacks | 新手包 | **缺失** |
| InferredTopics | 推断兴趣话题 | **缺失** |
| PastRequestTimestamps | 历史请求时间 | 有 |

#### 差距总结

X 有 21 个 query hydrator，我们约有 6-8 个等价物。**缺失 13 个关键信号**，特别是:
- Impression Bloom Filter（避免重复推荐）
- 用户画像（demographics, gender）
- 互相关注图
- IP 地理位置

---

### 2.5 Candidate Hydration — 丰富度差距

#### X 的做法（`home-mixer/candidate_hydrators/`）

**18 个 Candidate Hydrator** 并行执行:

| Hydrator | 信号 | 我们有无 |
|----------|------|----------|
| InNetwork | 是否站内 | 有 |
| CoreData | 帖子文本/媒体/元数据 | 有 |
| QuoteExpansion | 引用帖子展开 | **缺失** |
| VideoDuration | 视频时长 | **缺失** |
| HasMedia | 是否含媒体 | 部分有 |
| Subscription | 订阅信息 | **缺失** |
| Gizmoduck | 用户详细信息 | **缺失** |
| BlockedBy | 是否被作者屏蔽 | **缺失** |
| FilteredTopics | 过滤话题 | **缺失** |
| LanguageCode | 语言检测 | **缺失** |
| EngagementCounts | 互动计数 | 有 |
| MutualFollowJaccard | 互相关注 Jaccard | **缺失** |
| AdsBrandSafety | 广告品牌安全 | **缺失** |
| VF | 可见性过滤 | 部分有（safety_module） |

---

### 2.6 过滤器 — 覆盖度差距

#### X 的做法（`home-mixer/filters/`）

**14 个过滤器** 顺序执行:

| 过滤器 | 作用 | 我们有无 |
|--------|------|----------|
| DropDuplicates | 去重 | 有 |
| CoreDataHydration | 核心数据完整性 | **缺失** |
| Age | 帖子年龄 | 部分有 |
| SelfTweet | 过滤自己的帖子 | **缺失** |
| RetweetDedup | 转发去重 | **缺失** |
| IneligibleSubscription | 订阅资格 | **缺失** |
| PreviouslySeen (2 variants) | 已看过过滤 | **缺失** |
| PreviouslyServed | 已推荐过过滤 | 部分有 |
| MutedKeyword | 静音关键词 | **缺失** |
| AuthorSocialgraph | 作者社交关系 | **缺失** |
| Video | 视频过滤 | **缺失** |
| TopicIds | 话题过滤 | **缺失** |
| NewUserTopicIds | 新用户话题 | **缺失** |

---

### 2.7 内容理解 (Grox) — 能力缺失

#### X 的做法（`grox/`）

**DAG-based 内容理解 pipeline**，9 个 Plan:

| Plan | 功能 | 我们有无 |
|------|------|----------|
| PlanPostSafety | 内容安全（多层：规则→ML→Grok UPA） | 部分有（规则层） |
| PlanSafetyPtos | PTOS 政策执行 | **缺失** |
| PlanSpamComment | 垃圾评论检测 | **缺失** |
| PlanPostEmbeddingV5 | 多模态嵌入（文本+图像+视频ASR） | **缺失** |
| PlanReplyRanking | 回复质量排序 | **缺失** |
| PlanInitialBanger | 初始病毒式内容筛选 | **缺失** |

**多模态嵌入器 V5** (`grox/embedder/multimodal_post_embedder_v5.py`):
- 使用 xAI embedding API
- 支持文本 + 图像 + 视频 ASR 转录
- 1024 维，L2 归一化
- 异步 DAG 执行，最大并行度

#### 我们的做法（`ml-services/scripts/safety_module.py`）

- 规则层：关键词 + 正则 + URL 黑名单（始终启用）
- ML 层：HuggingFace 分类器接口（默认禁用，`enable_ml=False`）
- **无内容嵌入器、无多模态理解、无 DAG 执行引擎**

---

### 2.8 Pipeline 框架 — 架构差距

#### X 的做法（`candidate-pipeline/`）

8 个 Rust trait，完全泛化:

```rust
trait Source<Q, C>       // 并行获取候选
trait QueryHydrator<Q>   // 并行丰富查询
trait Hydrator<Q, C>     // 并行丰富候选（保数）
trait CachedHydrator<Q,C>// 带缓存的 Hydrator
trait Filter<Q, C>       // 顺序过滤
trait Scorer<Q, C>       // 顺序评分
trait Selector<Q, C>     // 选择
trait SideEffect<Q, C>   // 异步副作用
```

执行流:
```
hydrate_query → hydrate_dependent_query → fetch_candidates
→ hydrate → filter → score → select
→ hydrate_post_selection → filter_post_selection
→ finalize → side_effects
```

**关键**: Sources/Hydrators **并行**，Filters/Scorers **顺序**，每个 stage 有 tracing span + metrics。

#### 我们的做法

Rust 推荐流水线有 pipeline executor，但 stage 定义和业务逻辑耦合。scorer/filter 直接写在 pipeline 模块内部。

---

### 2.9 内存帖子存储 (Thunder) — 完全缺失

#### X 的做法（`thunder/`）

```
Kafka Consumer → PostStore (4 个 DashMap)
    ├── posts: DashMap<i64, LightPost>
    ├── original_posts_by_user: DashMap<i64, VecDeque<TinyPost>>
    ├── secondary_posts_by_user: DashMap<i64, VecDeque<TinyPost>>
    └── video_posts_by_user: DashMap<i64, VecDeque<TinyPost>>

gRPC: InNetworkPostsService.get_in_network_posts()
    → 遍历关注用户 → 每用户取最新 N 帖 → 过滤 → 返回

后台: 每 2 分钟自动裁剪过期帖子
并发: Semaphore 限流 + 请求超时
```

**性能**: 亚毫秒级查询（纯内存，无数据库调用）。

#### 我们的情况

无独立的内存帖子存储。in-network 查询依赖数据库，延迟高 10-100 倍。

---

### 2.10 多样性机制 — 精细程度差距

#### X 的做法

只有 2 个多样性 scorer（简洁设计）:
1. **AuthorDiversityScorer**: 指数衰减 `multiplier = (1-floor) × decay^position + floor`
2. **OONScorer**: OON 内容权重调整

**设计哲学**: 依赖模型本身学到的多样性，不加太多手工规则。

#### 我们的做法

4 个维度的多样性惩罚 + 大量约束:
- `intra_request_diversity_scorer`: author/source/topic/semantic 4 维惩罚
- `author_diversity_scorer`: 指数衰减
- `constraints.rs`: lane floors/ceilings、author/topic/source/domain/media soft caps
- O(C²) 语义重叠计算

**过度依赖手工规则**，与 X 的理念相反。

---

## 三、代码缺陷汇总

### 严重 (CRITICAL) — 必须立即修复

| # | 模块 | 文件 | 问题 | 影响 |
|---|------|------|------|------|
| 1 | C++ Graph | `ranked_query.h:53-59` | **堆比较器方向错误**：max-heap 用于 top-K 选择，替换最优而非最差 | `social_neighbors`/`recent_engagers`/`co_engagers`/`content_affinity_neighbors` 四个查询结果错误 |
| 2 | Python ML | `auto_retrain.py:31` | 导入 `PhoenixModel` 不存在（实际是 `PhoenixRanker`） | 自动重训练脚本启动即崩溃 |
| 3 | Python ML | `train_phoenix_v2.py` | 导入 `LABEL_ACTIONS`/`ACTION_TYPE_MAP` 不存在 | V2 训练脚本启动即崩溃 |

### 高 (HIGH) — 严重影响性能或质量

| # | 模块 | 文件 | 问题 | 影响 |
|---|------|------|------|------|
| 4 | Python ML | `app.py:127` | 设备硬编码 CPU | Phoenix Transformer 推理延迟严重，即使有 GPU 也不用 |
| 5 | Python ML | `app.py` (phoenix_predict) | Phoenix V1 缺少 padding mask | 零填充位置参与 attention，污染预测 |
| 6 | Rust Rec | `diversity.rs` | 请求内多样性 O(C²) | 候选池大时开销过大 |
| 7 | Rust GW | `rate_limit.rs` | 全局 `Mutex<HashMap>` + 每次 O(N) 清理 | 高并发下限流成为瓶颈 |
| 8 | Rust Rec | `user_actions.rs` | 大量 `String::clone()` + 重复解析时间戳 | 大动作序列时堆分配过多 |

### 中 (MEDIUM) — 影响可维护性或有潜在风险

| # | 模块 | 文件 | 问题 |
|---|------|------|------|
| 9 | C++ Graph | `scoring.h:159` | `bridge_strength` 的 `depth==0` 分支是死代码 |
| 10 | C++ Graph | `budget.h` | `can_add_new_candidate` 允许 max-1 个候选通过 |
| 11 | C++ Graph | `snapshot_handle.h` | `std::atomic_*` on `shared_ptr` 在 C++20 已废弃 |
| 12 | C++ Graph | `string_interner.h` | 字符串双重存储（map + vector 各一份） |
| 13 | Rust Rec | `semantic.rs` | `DefaultHasher` 跨平台不保证确定性 |
| 14 | Rust Rec | `primary.rs` | 去重入口克隆全部候选（应改为引用+延迟克隆） |
| 15 | Python ML | `phoenix_model.py` | V1 训练缺失标签时静默回退为 0.0 |
| 16 | Python ML | `phoenix_v2_model.py` | HashEmbedding 简单模哈希系统性碰撞风险 |

---

## 四、优化计划

### P0 — 最高优先级 (直接影响推荐质量，1-2 个月)

#### 4.1 修复 C++ 堆比较器 Bug

**文件**: `telegram-cpp-graph-service/src/graph/query/neighbors/ranked_query.h`

**问题**: `std::push_heap` 用 `is_better` 创建 max-heap（最优在顶部），但替换检查 `is_better(candidate, front)` 是和最优比较而非最差。

**修复**: 使用反转比较器创建 min-heap（最差在顶部）:

```cpp
// 当前（错误）:
auto is_better = [&](const auto& a, const auto& b) {
    return weight_fn(a) > weight_fn(b);
};
std::push_heap(top_refs.begin(), top_refs.end(), is_better);
if (is_better(candidate, top_refs.front())) { ... }

// 修复后:
auto is_worse = [&](const auto& a, const auto& b) {
    return weight_fn(a) < weight_fn(b);
};
std::push_heap(top_refs.begin(), top_refs.end(), is_worse);
if (weight_fn(candidate) > weight_fn(top_refs.front())) { ... }
```

**影响**: 修复 `social_neighbors`/`recent_engagers`/`co_engagers`/`content_affinity_neighbors` 四个查询。

#### 4.2 修复 Python 训练脚本

- `auto_retrain.py`: 删除或重写（当前是遗留死代码）
- `train_phoenix_v2.py`: 修复导入，添加缺失的 `LABEL_ACTIONS` 和 `ACTION_TYPE_MAP` 常量

#### 4.3 推理启用 GPU + 修复 Padding Mask

**文件**: `ml-services/app.py`

```python
# 当前（硬编码 CPU）:
device = torch.device("cpu")

# 修复:
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
```

**Phoenix V1 Padding Mask**: 修改 `phoenix_model.py` 的 `forward()` 方法接受 `src_key_padding_mask` 参数，在 `app.py` 中构建正确的 padding mask。

#### 4.4 训练并上线 Phoenix V2

当前 Phoenix V2 模型已实现但未上线。需要:
1. 修复训练脚本导入错误
2. 使用 `export_training_data.py` 导出训练数据
3. 训练 Mini 模型（128-dim, 4-head, 4-layer）验证
4. 训练 Medium 模型（256-dim, 8-head, 6-layer）
5. A/B 测试: Phoenix V2 vs 当前 lightweight_phoenix
6. 逐步移除 `policy.rs` 中的硬编码权重

---

### P1 — 高优先级 (架构升级，2-4 个月)

#### 4.5 搭建 Thunder 等价物（内存帖子存储）

**技术选型**: Rust + DashMap

```
架构:
├── Kafka Consumer: 消费 post create/delete 事件
├── PostStore:
│   ├── posts: DashMap<PostId, LightPost>
│   ├── original_by_user: DashMap<UserId, VecDeque<TinyPost>>
│   ├── secondary_by_user: DashMap<UserId, VecDeque<TinyPost>>
│   └── video_by_user: DashMap<UserId, VecDeque<TinyPost>>
├── gRPC Service: get_in_network_posts()
├── Background: 每 2 分钟裁剪过期帖子
└── 性能目标: p99 < 1ms
```

**集成**: Rust 推荐流水线先查 C++ Graph Service 拿 follow list → 再查 Thunder 拿帖子。

#### 4.6 升级召回模型为 Transformer User Tower

**当前**: MLP Two-Tower（AvgPool 聚合历史）
**目标**: Transformer User Tower（与排序模型共享权重）

```
Phase 1: 将 User Encoder 从 AvgPool 改为 Transformer
    输入: [user_hash_embed; history_action_embeds]
    用 2-4 层 Transformer Encoder
    输出: [CLS] token → user embedding

Phase 2: 与 Phoenix Ranking 共享底层 Transformer 权重
    召回和排序使用同一套 Transformer 参数
    参数效率提升 ~50%
```

#### 4.7 实现 Impression Bloom Filter

**目的**: 避免重复推荐已看过的内容

```
实现:
├── 每个用户维护一个 Bloom Filter（~1MB/用户）
├── 每次推荐后将 post_id 插入 Bloom Filter
├── 候选过滤时检查 Bloom Filter
├── 假阳性率: ~1%（可接受）
└── 存储: Redis（每个用户一个 key）
```

#### 4.8 Pipeline 框架抽象化

对标 X 的 `candidate-pipeline/` crate，提取通用 trait:

```rust
trait Source<Q, C>: Send + Sync {
    async fn source(&self, query: &Q) -> Result<Vec<C>>;
}

trait Hydrator<Q, C>: Send + Sync {
    async fn hydrate(&self, query: &Q, candidates: &mut [C]) -> Result<()>;
}

trait Filter<Q, C>: Send + Sync {
    fn filter(&self, query: &Q, candidates: Vec<C>) -> FilterResult<C>;
}

trait Scorer<Q, C>: Send + Sync {
    fn score(&self, query: &Q, candidates: &mut [C]) -> Result<()>;
}
```

---

### P2 — 中优先级 (精细化，持续)

#### 4.9 补齐 Query Hydrator

优先实现:
1. **RetrievalSequence**: 为召回模型提供独立的行为序列
2. **UserDemographics + InferredGender**: 用户画像信号
3. **MutualFollow**: 互相关注图
4. **FollowedTopics + InferredTopics**: 话题兴趣
5. **IP**: 地理位置信号

#### 4.10 补齐 Candidate Hydrator

优先实现:
1. **LanguageCode**: 语言检测（避免推荐外语内容）
2. **VideoDuration**: 视频时长（影响 dwell 预测）
3. **QuoteExpansion**: 引用帖子展开
4. **EngagementCounts**: 互动计数（已有部分）
5. **MutualFollowJaccard**: 互相关注 Jaccard 相似度

#### 4.11 补齐过滤器

优先实现:
1. **PreviouslySeen**: Bloom Filter 已看过过滤
2. **MutedKeyword**: 静音关键词过滤
3. **SelfTweet**: 过滤自己的帖子
4. **RetweetDedup**: 转发去重
5. **AuthorSocialgraph**: 屏蔽/静音用户过滤

#### 4.12 简化多样性机制

对标 X 的简洁设计:
1. 保留 `author_diversity_scorer`（X 也保留了）
2. 将 `intra_request_diversity` 中的 semantic overlap 交给模型学习
3. 将 lane constraints 逐步放宽，让模型自由决定内容分布
4. 最终目标: 仅保留 author diversity + exploration 两个手工 scorer

#### 4.13 添加负面动作预测头

短期在 Phoenix V2 中添加:
- **优先**: not_interested, block_author, mute_author, report（负面信号，对内容安全最关键）
- **其次**: quote, follow_author（正面高价值行为）
- **最后**: video_view, photo_expand, profile_click, share（媒体交互）

---

### P3 — 长期方向 (3-6 个月)

#### 4.14 搭建 Grox 等价物（内容理解引擎）

```
Phase 1: 安全检测升级
├── 训练 ML 安全分类器（DistilBERT 多标签分类）
├── 添加 content category 分类器
└── 添加 toxicity scoring

Phase 2: 内容嵌入
├── 训练帖子文本嵌入模型（sentence-transformers）
├── 多模态嵌入（文本+图像）
├── 嵌入存入 FAISS 索引
└── 构建 DAG 执行引擎（对标 Grox Plan 系统）
```

#### 4.15 在线持续训练 (Continuous Training)

```
目标: 模型实时性
├── 实时收集用户行为事件
├── 增量更新 embedding table
├── 定期微调 Transformer（每小时/每天）
└── A/B 测试持续训练 vs 定期训练
```

#### 4.16 召回和排序共享 Transformer 权重

```
目标: 参数效率
├── User Tower 复用 Ranking Transformer 的前 N 层
├── 共享 embedding table
└── 减少 ~50% 参数量
```

---

## 五、实施路线图

```
Month 1-2 (P0):
├── Week 1: 修复 C++ 堆比较器 bug
├── Week 2: 修复 Python 训练脚本导入错误
├── Week 3: 推理启用 GPU + 修复 padding mask
├── Week 4-6: 训练 Phoenix V2 Mini 模型
├── Week 7-8: A/B 测试 Phoenix V2 vs lightweight_phoenix
└── 里程碑: Phoenix V2 上线，推荐质量显著提升

Month 3-4 (P1):
├── Week 9-10: 搭建 Thunder 等价物
├── Week 11-12: 实现 Impression Bloom Filter
├── Week 13-14: 升级召回模型为 Transformer User Tower
├── Week 15-16: Pipeline 框架抽象化
└── 里程碑: 架构升级完成，in-network 延迟降低 10x

Month 5-6 (P2+P3):
├── Week 17-18: 补齐 Query/Candidate Hydrator
├── Week 19-20: 补齐过滤器 + 简化多样性
├── Week 21-22: 搭建 Grox 等价物（安全+嵌入）
├── Week 23-24: 在线持续训练基础设施
└── 里程碑: 系统能力全面对齐 X 算法
```

---

## 六、关键结论

### 最需要做的一件事

**训练并上线 Phoenix V2**。这一个改变替代了当前系统中 `policy.rs`（184 行硬编码权重）、`action_estimator.rs`（15 个手工特征）、`calibration.rs`（手工校准表）、`rule_signals.rs`（手工规则信号）四个文件中所有手工规则的总和。

### 最大的架构差距

不是某个模块的缺失，而是**排序理念的根本差异**:
- X: 模型从行为序列自动学习 → 少量手工 scorer（author diversity + exploration）
- 我们: 15 个手工特征 + 19 级 scoring ladder + 大量硬编码权重

### 建议的迁移策略

不要一步到位，而是:
1. 先修复 bug（C++ 堆、Python 导入、CPU 设备）→ 立竿见影
2. 训练 Phoenix V2 → 与现有系统并行运行
3. 用 Phoenix V2 输出替换 `lightweight_phoenix` 手工公式
4. 逐步移除 calibration、exploration、affinity 等手工 scorer
5. 最终只保留 author diversity + exploration（X 也保留了这两个）

---

## 七、已实施的纯代码优化 (2026-05-16)

> 以下优化全部通过 Rust/C++ 代码修改完成，无需 ML 训练。

### P0 — 关键 Bug 修复

| # | 文件 | 修改内容 | 影响 |
|---|------|----------|------|
| 1 | `cpp-graph-service/.../ranked_query.h` | 修复堆比较器方向错误：max-heap → min-heap，top-K 选择现在替换最差而非最优 | `social_neighbors`/`recent_engagers`/`co_engagers`/`content_affinity_neighbors` 四个查询结果修复 |
| 2 | `rust-recommendation/.../policy.rs` | 统一新鲜度半衰期：24h → 12h（与 recency_scorer 一致） | 消除双重新鲜度衰减的过度叠加 |
| 3 | `rust-recommendation/.../calibration.rs` | recency_scorer 半衰期：6h → 12h，乘数范围 [0.8, 1.5] → [0.85, 1.25] | 减少新鲜度叠加效应 |
| 4 | `rust-recommendation/.../policy.rs` | 归一化相关性权重：正向权重总和 1.44 → 1.0，负向权重等比缩放 | 解决高质候选聚集在 1.0 的区分度丢失问题 |

### P1 — 新增信号函数（利用已有但未使用的 candidate 字段）

| # | 信号函数 | 利用的字段 | 机制 |
|---|----------|-----------|------|
| 5 | `graph_authority_signal` | `graph_score`, `graph_recall_type` | 图谱权威度：BFS 多跳分数 + 召回类型加权 |
| 6 | `source_rank_signal` | `recall_evidence.source_rank`, `source_rank_score` | 源排名提升：排名越靠前提升越大 |
| 7 | `visibility_gradient_signal` | `vf_result.level`, `vf_result.score` | 可见性梯度：比 safe/unsafe 二元判断更精细 |
| 8 | `engagement_penalties` | `is_liked_by_user`, `is_reposted_by_user` | 已互动内容降权：已 like -35%，已 repost -45% |
| 9 | `multi_source_evidence_signal` | `recall_evidence.cross_lane_source_count` | 多源证据：跨 lane 来源比同 lane 更有价值 |
| 10 | `content_velocity_signal` | `like_count`, `comment_count`, `repost_count`, `created_at` | 内容速度：互动量/发布小时数 |

### P2 — 精细化信号

| # | 信号函数 | 机制 |
|---|----------|------|
| 11 | `user_sophistication_factor` | 用户成熟度校准：基于账户年龄、活跃度、关注数 |
| 12 | `language_match_signal` | 语言匹配：Unicode 范围启发式检测 + 用户偏好匹配 |
| 13 | `freshness_quality_interaction` | 新鲜度-质量交互：高质量内容容忍稍旧，低质量过期更快 |
| 14 | `time_of_day_adjustment` | 时段个性化：UTC 小时段调整内容偏好 |

### P2 — 性能优化

| # | 文件 | 修改内容 |
|---|------|----------|
| 15 | `scorers/diversity.rs` | 语义重叠比较窗口限制为最近 20 个候选，O(C²) → O(C×20) |
| 16 | `recommendation-contracts/.../candidate.rs` | `RankingSignalsPayload` 添加 `content_kind`/`trend`/`source_quality` 字段 |
| 17 | `scoring/feature_builder.rs` → `lightweight_phoenix.rs` | 消除 content_kind/trend/source_quality 重复计算 |
| 18 | `rule_signals.rs` | 修复 `news_source_prior` 子串匹配 bug："notreuters" 不再匹配 "reuters" |

### 信号叠加机制

所有新信号通过**乘法调整**叠加到归一化的 relevance 分数上，避免破坏权重归一化：

```
relevance = base_relevance
    × (1 + graph_authority × 0.08)     // 最大 +8%
    × (1 + source_rank × 0.06)         // 最大 +6%
    × visibility_gradient               // [0, 1.1]
    × engagement_penalty                // [0.55, 1.0]
    × (1 + multi_source × 0.05)        // 最大 +5%
    × (1 + velocity × 0.04)            // 最大 +4%
    × sophistication                    // [0.72, 1.08]
    × language_match                    // [0.62, 1.0]
    × (1 + fq_interaction × 0.05)      // 微调
    × time_of_day                       // [0.90, 1.06]
```
