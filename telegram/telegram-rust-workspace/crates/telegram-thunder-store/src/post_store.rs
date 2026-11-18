//! 基于三池分离索引与墓碑机制的 Thunder 内存帖子存储。
//!
//! 严格对标 `x-algorithm/thunder/posts/post_store.rs`：
//! - 维护原创池（original）、回复/转发次级池（secondary）、长视频池（video）三套按作者分片的有序时间队列；
//! - 维护 `deleted_posts` 墓碑表以阻止已删帖在乱序事件或并发读路径下复活；
//! - 查询路径采用反向时间扫描（最新帖优先）与二级回复对话树祖先门控；
//! - `prune_expired` 周期性清理过期条目与墓碑，并对 `VecDeque` 与 `DashMap` 执行 `shrink_to_fit` 回收内存。

use std::cmp::Reverse;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Instant;

use chrono::{DateTime, Duration as ChronoDuration, Utc};
use dashmap::DashMap;

use crate::model::{
    CompactPost, LightPost, PoolStats, PostEvent, PruneResult, ThunderConfig, ThunderSnapshot,
    ThunderStats, TinyPost,
};

/// 单作者单个分池队列最大保留条数
const MAX_POSTING_LIST_SIZE: usize = 5_000;
/// 每次查询单个作者单池最多反向扫描的 `TinyPost` 数量
const MAX_TINY_POSTS_PER_USER_SCAN: usize = 500;
/// 单作者原创帖单次返回上限
const MAX_ORIGINAL_POSTS_PER_AUTHOR: usize = 50;
/// 单作者回复/转发次级帖单次返回上限
const MAX_SECONDARY_POSTS_PER_AUTHOR: usize = 30;
/// 单作者视频帖单次返回上限
const MAX_VIDEO_POSTS_PER_AUTHOR: usize = 100;
/// 每日毫秒数
const MILLIS_PER_DAY: i64 = 86_400_000;

/// 保留旧版 `LightPost` 扩展字段的旁路元数据（仅在通过 `upsert(LightPost)` 写入时按需分配）
#[derive(Debug, Clone)]
pub(crate) struct LegacyPostMeta {
    pub content_preview: String,
    pub created_at: DateTime<Utc>,
    pub has_image: bool,
    pub like_count: u64,
    pub comment_count: u64,
    pub repost_count: u64,
    pub view_count: u64,
    pub recall_source: String,
    pub topic_tags: Vec<String>,
    pub last_accessed: Instant,
}

impl LegacyPostMeta {
    fn from_light_post(post: &LightPost) -> Self {
        Self {
            content_preview: post.content_preview.clone(),
            created_at: post.created_at,
            has_image: post.has_image,
            like_count: post.like_count,
            comment_count: post.comment_count,
            repost_count: post.repost_count,
            view_count: post.view_count,
            recall_source: post.recall_source.clone(),
            topic_tags: post.topic_tags.clone(),
            last_accessed: Instant::now(),
        }
    }

    fn merge_into_light_post(&self, compact: &CompactPost) -> LightPost {
        LightPost {
            post_id: compact.post_id.clone(),
            author_id: compact.author_id.clone(),
            content_preview: self.content_preview.clone(),
            created_at: self.created_at,
            has_image: self.has_image,
            has_video: compact.has_video,
            like_count: self.like_count,
            comment_count: self.comment_count,
            repost_count: self.repost_count,
            view_count: self.view_count,
            recall_source: self.recall_source.clone(),
            conversation_id: compact.conversation_id.clone(),
            is_reply: compact.is_reply,
            is_repost: compact.is_repost,
            original_post_id: compact.original_post_id.clone(),
            topic_tags: self.topic_tags.clone(),
        }
    }
}

/// 关注流内存存储类型别名（语义演进对齐 V3 `InNetworkStore`）
pub type InNetworkStore = ThunderStore;

/// Thunder 内存帖子存储
pub struct ThunderStore {
    /// 核心紧凑帖子主表：post_id -> CompactPost
    pub(crate) posts: DashMap<String, CompactPost>,
    /// 原创帖作者分池索引
    pub(crate) original_posts_by_author: DashMap<String, VecDeque<TinyPost>>,
    /// 回复/转发次级帖作者分池索引
    pub(crate) secondary_posts_by_author: DashMap<String, VecDeque<TinyPost>>,
    /// 符合时长门槛的视频帖作者分池索引
    pub(crate) video_posts_by_author: DashMap<String, VecDeque<TinyPost>>,
    /// 已删除帖子墓碑表：post_id -> deleted_at_ms
    pub(crate) deleted_posts: DashMap<String, i64>,
    /// 旧版 LightPost 扩展字段旁路存储
    pub(crate) legacy_meta: DashMap<String, LegacyPostMeta>,
    /// 存储配置
    pub(crate) config: ThunderConfig,
    /// 运行时统计
    pub(crate) stats: Arc<ThunderStats>,
}

impl std::fmt::Debug for ThunderStore {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ThunderStore")
            .field("posts_len", &self.posts.len())
            .field("deleted_tombstones_len", &self.deleted_posts.len())
            .finish()
    }
}

impl ThunderStore {
    /// 创建新的 Thunder 内存帖子存储实例
    pub fn new(config: ThunderConfig) -> Self {
        Self {
            posts: DashMap::with_capacity(config.max_posts),
            original_posts_by_author: DashMap::new(),
            secondary_posts_by_author: DashMap::new(),
            video_posts_by_author: DashMap::new(),
            deleted_posts: DashMap::new(),
            legacy_meta: DashMap::new(),
            config,
            stats: Arc::new(ThunderStats::default()),
        }
    }

    /// 写入或更新紧凑帖子并自动分流至三池索引；若已命中墓碑则返回 `false`
    pub fn upsert_compact(&self, mut post: CompactPost) -> bool {
        if post.post_id.is_empty() || post.author_id.is_empty() {
            return false;
        }

        // 若帖子已被标记删除，严禁通过乱序事件复活
        if self.deleted_posts.contains_key(&post.post_id) {
            return false;
        }

        // 若帖子已存在，先保留既有 semantic_ids（防止未编码更新覆盖）并清理旧分池条目
        let old_author = if let Some(existing) = self.posts.get(&post.post_id) {
            if post.semantic_ids.is_none() {
                post.semantic_ids = existing.semantic_ids;
            }
            Some(existing.author_id.clone())
        } else {
            None
        };

        if let Some(prev_author_id) = old_author {
            self.remove_from_author_pools(&prev_author_id, &post.post_id);
        }

        let tiny = post.to_tiny();
        let is_original = post.is_original();
        let is_video = post.is_video_eligible();
        let post_id = post.post_id.clone();
        let author_id = post.author_id.clone();

        self.posts.insert(post_id, post);

        // 1. 写入原创池或次级（回复/转发）池，并收集因单作者容量上限弹出的最旧条目
        let mut evicted_ids = Vec::new();
        if is_original {
            Self::push_tiny_sorted(
                &self.original_posts_by_author,
                &author_id,
                tiny.clone(),
                Some(&mut evicted_ids),
            );
        } else {
            Self::push_tiny_sorted(
                &self.secondary_posts_by_author,
                &author_id,
                tiny.clone(),
                Some(&mut evicted_ids),
            );
        }

        // 2. 若符合视频池条件，额外写入视频分池
        if is_video {
            Self::push_tiny_sorted(&self.video_posts_by_author, &author_id, tiny, None);
        }

        // 3. 若主池发生容量逐出，同步清理主表与视频池避免悬空引用
        for evicted_id in evicted_ids {
            self.remove_from_pool(&self.video_posts_by_author, &author_id, &evicted_id);
            self.posts.remove(&evicted_id);
            self.legacy_meta.remove(&evicted_id);
        }

        self.stats.total_inserts.fetch_add(1, Ordering::Relaxed);
        true
    }

    /// 批量写入紧凑帖子，返回成功写入条数
    pub fn upsert_compact_batch(&self, posts: Vec<CompactPost>) -> usize {
        let mut inserted = 0;
        for post in posts {
            if self.upsert_compact(post) {
                inserted += 1;
            }
        }
        inserted
    }

    /// 插入或更新旧版 `LightPost`（保持 100% 向后兼容）
    pub fn upsert(&self, post: LightPost) {
        let post_id = post.post_id.clone();
        let meta = LegacyPostMeta::from_light_post(&post);
        let compact = CompactPost::from(post);
        if self.upsert_compact(compact) {
            self.legacy_meta.insert(post_id, meta);
        }
    }

    /// 批量插入旧版 `LightPost`
    pub fn upsert_batch(&self, posts: Vec<LightPost>) {
        for post in posts {
            self.upsert(post);
        }
    }

    /// 按 `post_id` 删除帖子并写入墓碑表，返回被移除的 `LightPost`
    pub fn delete(&self, post_id: &str) -> Option<LightPost> {
        let now_ms = Utc::now().timestamp_millis();
        let removed_compact = self.remove_and_tombstone(post_id, None, now_ms);
        removed_compact.map(|compact| {
            let meta = self.legacy_meta.remove(post_id).map(|(_, m)| m);
            self.to_light_post_with_meta(&compact, meta.as_ref())
        })
    }

    /// 标记帖子为已删除：写入 `deleted_posts` 墓碑并立即摘除主表与三池条目
    pub fn mark_deleted(
        &self,
        post_id: &str,
        author_id_hint: Option<&str>,
        deleted_at_ms: i64,
    ) -> bool {
        if post_id.is_empty() {
            return false;
        }
        let removed = self.remove_and_tombstone(post_id, author_id_hint, deleted_at_ms);
        self.legacy_meta.remove(post_id);
        removed.is_some() || self.deleted_posts.contains_key(post_id)
    }

    /// 回填或更新指定帖子的 6 级 Semantic ID
    pub fn update_semantic_ids(&self, post_id: &str, semantic_ids: [i32; 6]) -> bool {
        if post_id.is_empty() || self.deleted_posts.contains_key(post_id) {
            return false;
        }
        if let Some(mut entry) = self.posts.get_mut(post_id) {
            entry.semantic_ids = Some(semantic_ids);
            true
        } else {
            false
        }
    }

    /// 按关注作者列表执行反向时间扫描查询，支持纯视频模式与对话树祖先门控
    pub fn query_in_network(
        &self,
        followed_authors: &[String],
        max_results: usize,
        video_only: bool,
    ) -> Vec<CompactPost> {
        let empty_excluded = HashSet::new();
        self.query_in_network_with_options(
            None,
            followed_authors,
            &empty_excluded,
            max_results,
            video_only,
        )
    }

    /// 带请求用户视角与已排除帖子集合的关注流查询
    pub fn query_in_network_with_options(
        &self,
        request_user_id: Option<&str>,
        followed_authors: &[String],
        exclude_post_ids: &HashSet<String>,
        max_results: usize,
        video_only: bool,
    ) -> Vec<CompactPost> {
        self.stats.total_queries.fetch_add(1, Ordering::Relaxed);
        if max_results == 0 || followed_authors.is_empty() {
            return Vec::new();
        }

        let following_set: HashSet<&str> = followed_authors.iter().map(String::as_str).collect();
        let mut seen_authors = HashSet::with_capacity(following_set.len());
        let mut results = Vec::new();

        for author_id in followed_authors {
            if !seen_authors.insert(author_id.as_str()) {
                continue;
            }

            if video_only {
                self.collect_author_pool(
                    &self.video_posts_by_author,
                    author_id,
                    MAX_VIDEO_POSTS_PER_AUTHOR,
                    exclude_post_ids,
                    |post| post.is_video_eligible(),
                    &mut results,
                );
            } else {
                self.collect_author_pool(
                    &self.original_posts_by_author,
                    author_id,
                    MAX_ORIGINAL_POSTS_PER_AUTHOR,
                    exclude_post_ids,
                    |post| post.is_original(),
                    &mut results,
                );
                self.collect_author_pool(
                    &self.secondary_posts_by_author,
                    author_id,
                    MAX_SECONDARY_POSTS_PER_AUTHOR,
                    exclude_post_ids,
                    |post| {
                        !post.is_original()
                            && self.passes_conversation_gate(post, &following_set, request_user_id)
                    },
                    &mut results,
                );
            }
        }

        // 全局按发布时间倒序重排并截取目标预算
        results.sort_unstable_by(|a, b| {
            Reverse(a.created_at_ms)
                .cmp(&Reverse(b.created_at_ms))
                .then_with(|| b.post_id.cmp(&a.post_id))
        });
        results.truncate(max_results);

        if !results.is_empty() {
            self.stats
                .cache_hits
                .fetch_add(results.len() as u64, Ordering::Relaxed);
        }

        results
    }

    /// 按 `post_id` 查询紧凑帖子
    pub fn get_compact(&self, post_id: &str) -> Option<CompactPost> {
        self.stats.total_queries.fetch_add(1, Ordering::Relaxed);
        if self.deleted_posts.contains_key(post_id) {
            return None;
        }
        self.posts.get(post_id).map(|entry| {
            self.touch_legacy_meta(post_id);
            self.stats.cache_hits.fetch_add(1, Ordering::Relaxed);
            entry.value().clone()
        })
    }

    /// 按 `post_id` 查询旧版 `LightPost`（亚毫秒级）
    pub fn get(&self, post_id: &str) -> Option<LightPost> {
        self.stats.total_queries.fetch_add(1, Ordering::Relaxed);
        if self.deleted_posts.contains_key(post_id) {
            return None;
        }

        let compact = self.posts.get(post_id).map(|entry| entry.value().clone())?;
        self.touch_legacy_meta(post_id);
        self.stats.cache_hits.fetch_add(1, Ordering::Relaxed);
        Some(self.hydrate_light_post(&compact))
    }

    /// 批量查询旧版 `LightPost`
    pub fn get_batch(&self, post_ids: &[String]) -> Vec<Option<LightPost>> {
        post_ids.iter().map(|id| self.get(id)).collect()
    }

    /// 批量查询并返回 Map（对标 X 的 Thunder In-Network Batch Hydration）
    pub fn get_batch_map(&self, post_ids: &[String]) -> HashMap<String, LightPost> {
        let mut map = HashMap::with_capacity(post_ids.len());
        for id in post_ids {
            if let Some(post) = self.get(id) {
                map.insert(id.clone(), post);
            }
        }
        map
    }

    /// 按作者查询帖子（从原创池与次级池聚合后查主表）
    pub fn get_by_author(&self, author_id: &str) -> Vec<LightPost> {
        self.stats.total_queries.fetch_add(1, Ordering::Relaxed);

        let mut post_ids = Vec::new();
        if let Some(orig) = self.original_posts_by_author.get(author_id) {
            post_ids.extend(orig.iter().map(|t| t.post_id.clone()));
        }
        if let Some(sec) = self.secondary_posts_by_author.get(author_id) {
            post_ids.extend(sec.iter().map(|t| t.post_id.clone()));
        }

        post_ids
            .into_iter()
            .filter_map(|id| self.get(&id))
            .collect()
    }

    /// 按时间范围查询最近 N 天的帖子
    pub fn get_recent(&self, max_age_days: i64) -> Vec<LightPost> {
        let cutoff_ms = (Utc::now() - ChronoDuration::days(max_age_days)).timestamp_millis();
        let compacts: Vec<CompactPost> = self
            .posts
            .iter()
            .filter(|entry| {
                entry.value().created_at_ms >= cutoff_ms
                    && !self.deleted_posts.contains_key(entry.key())
            })
            .map(|entry| entry.value().clone())
            .collect();

        compacts
            .iter()
            .map(|compact| self.hydrate_light_post(compact))
            .collect()
    }

    /// 按话题标签查询（仅匹配携带 `topic_tags` 元数据的条目）
    pub fn get_by_topic(&self, topic: &str) -> Vec<LightPost> {
        let matched_ids: Vec<String> = self
            .legacy_meta
            .iter()
            .filter(|entry| entry.value().topic_tags.iter().any(|tag| tag == topic))
            .map(|entry| entry.key().clone())
            .collect();

        matched_ids
            .into_iter()
            .filter_map(|id| self.get(&id))
            .collect()
    }

    /// 周期性清理过期帖子、超容帖子与过期墓碑，并对内部容器执行 `shrink_to_fit` 回收内存
    pub fn prune_expired(&self) -> PruneResult {
        let start = Instant::now();
        let initial_count = self.posts.len();
        let now_ms = Utc::now().timestamp_millis();
        let max_age_ms = self.config.max_age_days.saturating_mul(MILLIS_PER_DAY);
        let cutoff_ms = now_ms.saturating_sub(max_age_ms);

        // 1. 裁剪超过保留期限的帖子
        let mut expired_ids = Vec::new();
        self.posts.retain(|post_id, post| {
            if post.created_at_ms < cutoff_ms {
                expired_ids.push(post_id.clone());
                false
            } else {
                true
            }
        });
        let pruned_expired = expired_ids.len();
        for id in &expired_ids {
            self.legacy_meta.remove(id);
        }

        // 2. 若仍超过总容量上限，优先裁剪不活跃条目，其次淘汰最旧条目
        let mut pruned_inactive = 0;
        if self.posts.len() > self.config.max_posts {
            let excess = self.posts.len() - self.config.max_posts;
            let inactive_threshold = self.config.inactive_threshold;

            let post_snapshots: Vec<(String, i64)> = self
                .posts
                .iter()
                .map(|entry| (entry.key().clone(), entry.value().created_at_ms))
                .collect();

            let mut candidates: Vec<(bool, i64, String)> = post_snapshots
                .into_iter()
                .map(|(post_id, created_at_ms)| {
                    let is_inactive = self
                        .legacy_meta
                        .get(&post_id)
                        .is_some_and(|meta| meta.last_accessed.elapsed() > inactive_threshold);
                    (!is_inactive, created_at_ms, post_id)
                })
                .collect();

            candidates.sort_unstable_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));

            for (_, _, post_id) in candidates.into_iter().take(excess) {
                if self.posts.remove(&post_id).is_some() {
                    self.legacy_meta.remove(&post_id);
                    pruned_inactive += 1;
                }
            }
        }

        // 3. 清理超出保留窗口的历史删除墓碑，防止墓碑表无限增长
        self.deleted_posts
            .retain(|_, deleted_at_ms| *deleted_at_ms >= cutoff_ms);

        // 4. 清理三个作者分池中的过期或失效条目，并对缩容后的 VecDeque 与 DashMap 执行 shrink_to_fit
        self.prune_and_shrink_pool(&self.original_posts_by_author, cutoff_ms);
        self.prune_and_shrink_pool(&self.secondary_posts_by_author, cutoff_ms);
        self.prune_and_shrink_pool(&self.video_posts_by_author, cutoff_ms);

        self.posts.shrink_to_fit();
        self.deleted_posts.shrink_to_fit();
        self.legacy_meta.shrink_to_fit();

        self.stats.total_prunes.fetch_add(1, Ordering::Relaxed);

        PruneResult {
            initial_count,
            final_count: self.posts.len(),
            pruned_expired,
            pruned_inactive,
            duration_ms: start.elapsed().as_millis() as u64,
        }
    }

    /// 兼容旧版调用名称，内部委托至 `prune_expired`
    pub fn prune(&self) -> PruneResult {
        self.prune_expired()
    }

    /// 后台周期性裁剪任务（应在 tokio spawn 中运行）
    pub async fn background_prune_loop(self: Arc<Self>) {
        let mut interval = tokio::time::interval(self.config.prune_interval);
        loop {
            interval.tick().await;
            let result = self.prune_expired();
            if result.pruned_expired > 0 || result.pruned_inactive > 0 {
                tracing::info!(
                    initial = result.initial_count,
                    final_count = result.final_count,
                    expired = result.pruned_expired,
                    inactive = result.pruned_inactive,
                    duration_ms = result.duration_ms,
                    "thunder prune completed"
                );
            }
        }
    }

    /// 当前活跃帖子数量
    pub fn len(&self) -> usize {
        self.posts.len()
    }

    /// 存储是否为空
    pub fn is_empty(&self) -> bool {
        self.posts.is_empty()
    }

    /// 判断 `post_id` 是否已进入删除墓碑
    pub fn is_deleted(&self, post_id: &str) -> bool {
        self.deleted_posts.contains_key(post_id)
    }

    /// 估算内存占用（字节）
    pub fn estimated_memory_bytes(&self) -> usize {
        let post_size = std::mem::size_of::<CompactPost>() + 128;
        let tiny_size = std::mem::size_of::<TinyPost>() + 32;
        let pool_items = self.count_pool_items(&self.original_posts_by_author)
            + self.count_pool_items(&self.secondary_posts_by_author)
            + self.count_pool_items(&self.video_posts_by_author);
        let tombstone_size = self.deleted_posts.len() * 48;
        self.posts.len() * post_size + pool_items * tiny_size + tombstone_size
    }

    /// 生成存储快照（用于诊断与监控）
    pub fn snapshot(&self) -> ThunderSnapshot {
        let mut unique_authors = HashSet::new();
        for entry in self.original_posts_by_author.iter() {
            unique_authors.insert(entry.key().clone());
        }
        for entry in self.secondary_posts_by_author.iter() {
            unique_authors.insert(entry.key().clone());
        }
        for entry in self.video_posts_by_author.iter() {
            unique_authors.insert(entry.key().clone());
        }

        ThunderSnapshot {
            post_count: self.posts.len(),
            author_count: unique_authors.len(),
            estimated_memory_bytes: self.estimated_memory_bytes(),
            total_inserts: self.stats.total_inserts.load(Ordering::Relaxed),
            total_deletes: self.stats.total_deletes.load(Ordering::Relaxed),
            total_queries: self.stats.total_queries.load(Ordering::Relaxed),
        }
    }

    /// 获取三池分流规模统计
    pub fn pool_stats(&self) -> PoolStats {
        PoolStats {
            total_posts: self.posts.len(),
            original_pool_entries: self.count_pool_items(&self.original_posts_by_author),
            secondary_pool_entries: self.count_pool_items(&self.secondary_posts_by_author),
            video_pool_entries: self.count_pool_items(&self.video_posts_by_author),
            deleted_tombstones: self.deleted_posts.len(),
        }
    }

    /// 按时间戳升序将 `TinyPost` 插入指定作者队列，并在超出单作者上限时从队首逐出
    fn push_tiny_sorted(
        pool: &DashMap<String, VecDeque<TinyPost>>,
        author_id: &str,
        tiny: TinyPost,
        mut evicted_out: Option<&mut Vec<String>>,
    ) {
        let mut deque = pool.entry(author_id.to_string()).or_default();
        while deque.len() >= MAX_POSTING_LIST_SIZE {
            if let Some(oldest) = deque.pop_front()
                && let Some(ref mut out) = evicted_out
            {
                out.push(oldest.post_id);
            }
        }

        let needs_ordered_insert = deque
            .back()
            .is_some_and(|last| last.created_at_ms > tiny.created_at_ms);

        if needs_ordered_insert {
            let slice = deque.make_contiguous();
            let pos = slice.partition_point(|item| item.created_at_ms <= tiny.created_at_ms);
            deque.insert(pos, tiny);
        } else {
            deque.push_back(tiny);
        }
    }

    /// 移除帖子并写入墓碑（按提示或主表作者摘除三池条目）
    fn remove_and_tombstone(
        &self,
        post_id: &str,
        author_id_hint: Option<&str>,
        deleted_at_ms: i64,
    ) -> Option<CompactPost> {
        self.deleted_posts
            .insert(post_id.to_string(), deleted_at_ms);
        let removed = self.posts.remove(post_id).map(|(_, post)| post);

        if let Some(author_id) = removed
            .as_ref()
            .map(|p| p.author_id.as_str())
            .or(author_id_hint)
        {
            self.remove_from_author_pools(author_id, post_id);
        }

        if removed.is_some() {
            self.stats.total_deletes.fetch_add(1, Ordering::Relaxed);
        }
        removed
    }

    /// 从指定作者的全部三个分池中摘除 `post_id`
    fn remove_from_author_pools(&self, author_id: &str, post_id: &str) {
        self.remove_from_pool(&self.original_posts_by_author, author_id, post_id);
        self.remove_from_pool(&self.secondary_posts_by_author, author_id, post_id);
        self.remove_from_pool(&self.video_posts_by_author, author_id, post_id);
    }

    /// 从单个分池摘除 `post_id`，若作者队列清空则移除作者键
    fn remove_from_pool(
        &self,
        pool: &DashMap<String, VecDeque<TinyPost>>,
        author_id: &str,
        post_id: &str,
    ) {
        let mut should_remove_author = false;
        if let Some(mut entry) = pool.get_mut(author_id) {
            entry.retain(|tiny| tiny.post_id != post_id);
            should_remove_author = entry.is_empty();
        }
        if should_remove_author {
            pool.remove_if(author_id, |_, deque| deque.is_empty());
        }
    }

    /// 从单个作者分池反向时间扫描并水合过滤候选
    fn collect_author_pool<F>(
        &self,
        pool: &DashMap<String, VecDeque<TinyPost>>,
        author_id: &str,
        max_per_author: usize,
        exclude_post_ids: &HashSet<String>,
        predicate: F,
        out: &mut Vec<CompactPost>,
    ) where
        F: Fn(&CompactPost) -> bool,
    {
        if max_per_author == 0 {
            return;
        }
        let Some(deque_ref) = pool.get(author_id) else {
            return;
        };

        let mut collected = 0usize;
        for tiny in deque_ref
            .value()
            .iter()
            .rev()
            .take(MAX_TINY_POSTS_PER_USER_SCAN)
        {
            if collected >= max_per_author {
                break;
            }
            if exclude_post_ids.contains(&tiny.post_id)
                || self.deleted_posts.contains_key(&tiny.post_id)
            {
                continue;
            }
            if let Some(post_ref) = self.posts.get(&tiny.post_id) {
                let post = post_ref.value();
                if predicate(post) {
                    out.push(post.clone());
                    collected += 1;
                }
            }
        }
    }

    /// 对话树祖先门控校验（对标 `x-algorithm` 二级回复规则）
    ///
    /// - 转发帖：若原帖已进入 `deleted_posts` 墓碑，或原帖作者即当前请求者本人，则拦截；
    /// - 一级回复：父帖必须存活于存储且为原创帖；
    /// - 二级回复：父帖须为直接回复对话根帖的一级回复，且父帖作者须在当前用户的关注列表中；
    /// - 三级及更深回复或孤儿回复：一律拦截。
    fn passes_conversation_gate(
        &self,
        post: &CompactPost,
        following_set: &HashSet<&str>,
        request_user_id: Option<&str>,
    ) -> bool {
        if post.is_repost
            && let Some(orig_id) = &post.original_post_id
        {
            if self.deleted_posts.contains_key(orig_id) {
                return false;
            }
            if let Some(viewer_id) = request_user_id
                && let Some(orig_post) = self.posts.get(orig_id)
                && orig_post.author_id == viewer_id
            {
                return false;
            }
        }

        if !post.is_reply {
            return true;
        }

        if let Some(conv_id) = &post.conversation_id
            && self.deleted_posts.contains_key(conv_id)
        {
            return false;
        }

        let Some(reply_to_id) = &post.in_reply_to_post_id else {
            // 兼容未填充 in_reply_to_post_id 的精简回复：若存在根帖则要求根帖非次级帖
            if let Some(conv_id) = &post.conversation_id
                && let Some(root) = self.posts.get(conv_id)
            {
                return root.is_original();
            }
            return true;
        };

        if reply_to_id == &post.post_id || self.deleted_posts.contains_key(reply_to_id) {
            return false;
        }

        let Some(parent) = self.posts.get(reply_to_id) else {
            // 父帖不存在或已过期裁剪，拦截孤儿回复
            return false;
        };

        if parent.is_original() {
            return true;
        }

        if !parent.is_reply {
            return false;
        }

        let replies_to_root = post
            .conversation_id
            .as_ref()
            .is_some_and(|conv_id| parent.in_reply_to_post_id.as_ref() == Some(conv_id));
        let parent_author_followed = following_set.contains(parent.author_id.as_str());

        replies_to_root && parent_author_followed
    }

    /// 清理单个作者分池中的过期或失效条目，并对缩容队列执行 `shrink_to_fit`
    fn prune_and_shrink_pool(&self, pool: &DashMap<String, VecDeque<TinyPost>>, cutoff_ms: i64) {
        let mut empty_authors = Vec::new();
        for mut entry in pool.iter_mut() {
            let deque = entry.value_mut();
            while let Some(front) = deque.front() {
                if front.created_at_ms < cutoff_ms {
                    deque.pop_front();
                } else {
                    break;
                }
            }
            deque.retain(|tiny| {
                tiny.created_at_ms >= cutoff_ms
                    && !self.deleted_posts.contains_key(&tiny.post_id)
                    && self.posts.contains_key(&tiny.post_id)
            });

            if deque.is_empty() {
                empty_authors.push(entry.key().clone());
            } else if deque.capacity() > deque.len().saturating_mul(2) {
                deque.shrink_to_fit();
            }
        }

        for author_id in empty_authors {
            pool.remove_if(&author_id, |_, deque| deque.is_empty());
        }
        pool.shrink_to_fit();
    }

    fn count_pool_items(&self, pool: &DashMap<String, VecDeque<TinyPost>>) -> usize {
        pool.iter().map(|entry| entry.value().len()).sum()
    }

    fn touch_legacy_meta(&self, post_id: &str) {
        if let Some(mut meta) = self.legacy_meta.get_mut(post_id) {
            meta.last_accessed = Instant::now();
        }
    }

    fn hydrate_light_post(&self, compact: &CompactPost) -> LightPost {
        let meta = self.legacy_meta.get(&compact.post_id);
        self.to_light_post_with_meta(compact, meta.as_deref())
    }

    fn to_light_post_with_meta(
        &self,
        compact: &CompactPost,
        meta: Option<&LegacyPostMeta>,
    ) -> LightPost {
        match meta {
            Some(m) => m.merge_into_light_post(compact),
            None => LightPost::from(compact),
        }
    }
}

impl Default for ThunderStore {
    fn default() -> Self {
        Self::new(ThunderConfig::default())
    }
}

/// 帖子事件处理器接口（兼容既有消费者扩展）
pub trait PostEventProcessor: Send + Sync {
    fn process_event(&self, event: PostEvent);
}

impl PostEventProcessor for ThunderStore {
    fn process_event(&self, event: PostEvent) {
        match event {
            PostEvent::Created { post } | PostEvent::Updated { post } => self.upsert(post),
            PostEvent::Deleted { post_id } => {
                self.delete(&post_id);
            }
        }
    }
}
