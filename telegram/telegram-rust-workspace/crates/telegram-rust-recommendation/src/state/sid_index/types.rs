//! Semantic ID 索引条目、种子、召回候选与预算参数类型定义。

use super::codec::{SID_LEVELS, SeedKey, pack_full_key, seed_key};

/// 默认最大总召回条数（对齐 X `SidSourceMaxResults`）。
pub const SID_DEFAULT_MAX_RESULTS: usize = 800;
/// 默认最大种子帖数量（对齐 X `SidSourceMaxSeeds`）。
pub const SID_DEFAULT_MAX_SEEDS: usize = 50;
/// 默认单种子最大召回条数（对齐 X `SidSourceMaxPerSeed`）。
pub const SID_DEFAULT_MAX_PER_SEED: usize = 100;
/// 默认最小共享前缀深度（对齐 X `SidSourceMinPrefixDepth`）。
pub const SID_DEFAULT_MIN_PREFIX_DEPTH: usize = 3;
/// 默认最大共享前缀深度。
pub const SID_DEFAULT_MAX_PREFIX_DEPTH: usize = SID_LEVELS;

/// 索引中存储的单条帖子条目（按 `key` 升序、`created_at_ms` 降序排列）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IndexedSidPost {
    pub key: u64,
    pub post_id: String,
    pub author_id: String,
    pub created_at_ms: i64,
}

impl IndexedSidPost {
    /// 根据 6 级 Semantic ID 构造索引条目；若码词越界或缺失则返回 `None`。
    pub fn from_codes(
        post_id: impl Into<String>,
        author_id: impl Into<String>,
        codes: &[i32; SID_LEVELS],
        created_at_ms: i64,
    ) -> Option<Self> {
        let key = pack_full_key(codes)?;
        Some(Self {
            key,
            post_id: post_id.into(),
            author_id: author_id.into(),
            created_at_ms,
        })
    }
}

/// 传入 `SidPrefixIndex` 的检索种子。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SidSeed {
    pub post_id: String,
    pub key: SeedKey,
}

impl SidSeed {
    /// 从种子帖 ID 与码词切片构造 `SidSeed`。
    pub fn from_codes(post_id: impl Into<String>, codes: &[i32]) -> Option<Self> {
        let key = seed_key(codes)?;
        Some(Self {
            post_id: post_id.into(),
            key,
        })
    }
}

/// 前缀倒排召回产出的候选明细。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SidCandidate {
    pub post_id: String,
    pub author_id: String,
    pub key: u64,
    pub codes: [i32; SID_LEVELS],
    pub seed_post_id: String,
    pub shared_prefix_depth: u32,
    pub created_at_ms: i64,
}

/// Semantic ID 召回预算与前缀深度参数。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SidRetrieveParams {
    pub max_results: usize,
    pub max_seeds: usize,
    pub max_per_seed: usize,
    pub min_prefix_depth: usize,
    pub max_prefix_depth: usize,
}

impl Default for SidRetrieveParams {
    fn default() -> Self {
        Self {
            max_results: SID_DEFAULT_MAX_RESULTS,
            max_seeds: SID_DEFAULT_MAX_SEEDS,
            max_per_seed: SID_DEFAULT_MAX_PER_SEED,
            min_prefix_depth: SID_DEFAULT_MIN_PREFIX_DEPTH,
            max_prefix_depth: SID_DEFAULT_MAX_PREFIX_DEPTH,
        }
    }
}
