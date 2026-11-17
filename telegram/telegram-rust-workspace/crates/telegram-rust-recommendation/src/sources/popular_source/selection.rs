//! 热门帖 8 小时半衰期饱和投射评分与每作者配额筛选纯计算逻辑。

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

/// 单作者在热门快照中最多保留的帖子数。
pub const POPULAR_DEFAULT_PER_AUTHOR: usize = 5;
/// 热门快照全局总预算条数。
pub const POPULAR_DEFAULT_BUDGET: usize = 500;
/// 热度衰减与投射半衰期（8 小时）。
pub const POPULAR_DEFAULT_HALF_LIFE_HOURS: f64 = 8.0;
/// 最小平滑龄期下限（防止刚发布 0 秒帖子分母过小放大噪声）。
pub const POPULAR_DEFAULT_FLOOR_HOURS: f64 = 0.5;
/// 热门候选最大窗口期（24 小时）。
pub const POPULAR_DEFAULT_WINDOW_HOURS: f64 = 24.0;

/// 热门帖筛选配置。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PopularSelectionConfig {
    pub per_author: usize,
    pub budget: usize,
    pub half_life_hours: f64,
    pub floor_hours: f64,
    pub window_hours: f64,
}

impl Default for PopularSelectionConfig {
    fn default() -> Self {
        Self {
            per_author: POPULAR_DEFAULT_PER_AUTHOR,
            budget: POPULAR_DEFAULT_BUDGET,
            half_life_hours: POPULAR_DEFAULT_HALF_LIFE_HOURS,
            floor_hours: POPULAR_DEFAULT_FLOOR_HOURS,
            window_hours: POPULAR_DEFAULT_WINDOW_HOURS,
        }
    }
}

/// 供热度快照刷新消费的原始帖子互动统计条目。
#[derive(Clone, Debug, PartialEq)]
pub struct PopularPostInput {
    pub post_id: String,
    pub author_id: String,
    pub created_at_ms: i64,
    pub age_hours: f64,
    pub engagement_views: u64,
    pub semantic_ids: Option<[i32; 6]>,
}

impl PopularPostInput {
    /// 根据发布时间与当前时间戳自动计算 `age_hours` 并构造输入条目。
    pub fn from_timestamps(
        post_id: impl Into<String>,
        author_id: impl Into<String>,
        created_at_ms: i64,
        now_ms: i64,
        engagement_views: u64,
        semantic_ids: Option<[i32; 6]>,
    ) -> Self {
        let age_hours = (now_ms.saturating_sub(created_at_ms) as f64) / 3_600_000.0;
        Self {
            post_id: post_id.into(),
            author_id: author_id.into(),
            created_at_ms,
            age_hours,
            engagement_views,
            semantic_ids,
        }
    }
}

/// 经 8 小时半衰期饱和投射排序并截断后的热门候选条目。
#[derive(Clone, Debug, PartialEq)]
pub struct SelectedPopularPost {
    pub post_id: String,
    pub author_id: String,
    pub created_at_ms: i64,
    pub quality: f64,
    pub semantic_ids: Option<[i32; 6]>,
}

/// 内存态热门帖子只读快照。
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PopularPostsSnapshot {
    pub generated_at_ms: i64,
    pub loaded_at_ms: Option<i64>,
    pub posts: Vec<SelectedPopularPost>,
}

/// 基于 8 小时半衰期饱和投射模型计算帖子热度分：`views * (1 - exp(-λW)) / (1 - exp(-λ*max(age, floor)))`。
pub fn compute_popular_quality(
    engagement_views: u64,
    age_hours: f64,
    config: &PopularSelectionConfig,
) -> f64 {
    if engagement_views == 0
        || !config.half_life_hours.is_finite()
        || config.half_life_hours <= 0.0
        || !age_hours.is_finite()
    {
        return 0.0;
    }
    let lambda = std::f64::consts::LN_2 / config.half_life_hours;
    let saturation = 1.0 - (-lambda * config.window_hours.max(0.0)).exp();
    let elapsed = 1.0 - (-lambda * age_hours.max(config.floor_hours).max(1e-6)).exp();
    if elapsed <= 0.0 {
        return 0.0;
    }
    engagement_views as f64 * saturation / elapsed
}

fn cmp_quality_desc(a: &SelectedPopularPost, b: &SelectedPopularPost) -> Ordering {
    b.quality
        .total_cmp(&a.quality)
        .then_with(|| b.created_at_ms.cmp(&a.created_at_ms))
        .then_with(|| b.post_id.cmp(&a.post_id))
}

/// 按 8 小时半衰期热度降序筛选热门帖，强制每作者最多 `per_author`（5）条且总预算不超过 `budget`（500）条。
pub fn select_popular_posts(
    posts: &[PopularPostInput],
    config: &PopularSelectionConfig,
) -> Vec<SelectedPopularPost> {
    if config.per_author == 0 || config.budget == 0 {
        return Vec::new();
    }

    let mut seen_post_ids = HashSet::new();
    let mut by_author: HashMap<&str, Vec<SelectedPopularPost>> = HashMap::new();

    for post in posts {
        let pid = post.post_id.trim();
        let aid = post.author_id.trim();
        if pid.is_empty()
            || aid.is_empty()
            || !post.age_hours.is_finite()
            || post.age_hours < 0.0
            || post.age_hours > config.window_hours
            || !seen_post_ids.insert(pid)
        {
            continue;
        }
        let quality = compute_popular_quality(post.engagement_views, post.age_hours, config);
        by_author.entry(aid).or_default().push(SelectedPopularPost {
            post_id: pid.to_string(),
            author_id: aid.to_string(),
            created_at_ms: post.created_at_ms,
            quality,
            semantic_ids: post.semantic_ids,
        });
    }

    let mut pool = Vec::new();
    for (_, mut author_posts) in by_author {
        author_posts.sort_unstable_by(cmp_quality_desc);
        author_posts.truncate(config.per_author);
        pool.extend(author_posts);
    }

    pool.sort_unstable_by(cmp_quality_desc);
    pool.truncate(config.budget);
    pool
}
