use std::sync::Arc;
use std::time::{Duration, Instant};

use dashmap::DashMap;
use serde::{Deserialize, Serialize};

/// Thunder 内存帖子存储 — 对标 X 的 Thunder service
///
/// 亚毫秒级 in-network 帖子查询，替代数据库回退。
/// 使用 DashMap 实现无锁并发读写，后台任务定期裁剪过期帖子。
///
/// 设计目标：
/// - 读路径：<1ms（内存 HashMap 查找）
/// - 写路径：Kafka consumer 消费 post create/delete 事件
/// - 内存控制：后台裁剪 >7 天帖子，定期 shrink
/// - 容量：单节点 ~100K 帖子（~50MB 内存）

/// 轻量帖子结构（仅存储推荐所需字段）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LightPost {
    pub post_id: String,
    pub author_id: String,
    pub content_preview: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub has_image: bool,
    pub has_video: bool,
    pub like_count: u64,
    pub comment_count: u64,
    pub repost_count: u64,
    pub view_count: u64,
    pub recall_source: String,
    pub conversation_id: Option<String>,
    pub is_reply: bool,
    pub is_repost: bool,
    pub original_post_id: Option<String>,
    /// 帖子的标签/分类（用于兴趣匹配）
    pub topic_tags: Vec<String>,
}

impl LightPost {
    /// 帖子年龄（天数）
    pub fn age_days(&self) -> i64 {
        chrono::Utc::now()
            .signed_duration_since(self.created_at)
            .num_days()
    }

    /// 是否过期（超过 max_age_days）
    pub fn is_expired(&self, max_age_days: i64) -> bool {
        self.age_days() > max_age_days
    }
}

/// 帖子存储条目（包含元数据）
#[derive(Debug, Clone)]
struct PostEntry {
    post: LightPost,
    #[allow(dead_code)]
    inserted_at: Instant,
    last_accessed: Instant,
    #[allow(dead_code)]
    access_count: u64,
}

/// Thunder 存储配置
#[derive(Debug, Clone)]
pub struct ThunderConfig {
    /// 最大帖子数量（超出时触发裁剪）
    pub max_posts: usize,
    /// 帖子最大存活天数
    pub max_age_days: i64,
    /// 裁剪间隔
    pub prune_interval: Duration,
    /// 不活跃帖子阈值（超过此时间未访问则优先裁剪）
    pub inactive_threshold: Duration,
}

impl Default for ThunderConfig {
    fn default() -> Self {
        Self {
            max_posts: 100_000,
            max_age_days: 7,
            prune_interval: Duration::from_secs(120), // 2 分钟
            inactive_threshold: Duration::from_secs(3600), // 1 小时
        }
    }
}

/// Thunder 内存帖子存储
pub struct ThunderStore {
    /// 核心存储：post_id -> PostEntry
    posts: DashMap<String, PostEntry>,
    /// 作者索引：author_id -> Vec<post_id>（用于 author-based 查询）
    author_index: DashMap<String, Vec<String>>,
    /// 配置
    config: ThunderConfig,
    /// 统计
    stats: Arc<ThunderStats>,
}

/// 存储统计
#[derive(Debug, Default)]
pub struct ThunderStats {
    pub total_inserts: std::sync::atomic::AtomicU64,
    pub total_deletes: std::sync::atomic::AtomicU64,
    pub total_queries: std::sync::atomic::AtomicU64,
    pub total_prunes: std::sync::atomic::AtomicU64,
    pub cache_hits: std::sync::atomic::AtomicU64,
}

impl ThunderStore {
    pub fn new(config: ThunderConfig) -> Self {
        Self {
            posts: DashMap::with_capacity(config.max_posts),
            author_index: DashMap::new(),
            config,
            stats: Arc::new(ThunderStats::default()),
        }
    }

    /// 插入或更新帖子
    pub fn upsert(&self, post: LightPost) {
        let post_id = post.post_id.clone();
        let author_id = post.author_id.clone();

        // 更新作者索引
        self.author_index
            .entry(author_id)
            .or_insert_with(Vec::new)
            .push(post_id.clone());

        let entry = PostEntry {
            post,
            inserted_at: Instant::now(),
            last_accessed: Instant::now(),
            access_count: 0,
        };

        self.posts.insert(post_id, entry);
        self.stats
            .total_inserts
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }

    /// 批量插入
    pub fn upsert_batch(&self, posts: Vec<LightPost>) {
        for post in posts {
            self.upsert(post);
        }
    }

    /// 删除帖子
    pub fn delete(&self, post_id: &str) -> Option<LightPost> {
        let removed = self.posts.remove(post_id).map(|(_, entry)| {
            // 清理作者索引
            if let Some(mut author_posts) = self.author_index.get_mut(&entry.post.author_id) {
                author_posts.retain(|id| id != post_id);
            }
            self.stats
                .total_deletes
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            entry.post
        });
        removed
    }

    /// 按 post_id 查询（亚毫秒级）
    pub fn get(&self, post_id: &str) -> Option<LightPost> {
        self.stats
            .total_queries
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);

        self.posts.get_mut(post_id).map(|mut entry| {
            entry.last_accessed = Instant::now();
            entry.access_count += 1;
            self.stats
                .cache_hits
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            entry.post.clone()
        })
    }

    /// 批量查询
    pub fn get_batch(&self, post_ids: &[String]) -> Vec<Option<LightPost>> {
        post_ids.iter().map(|id| self.get(id)).collect()
    }

    /// 按作者查询帖子
    pub fn get_by_author(&self, author_id: &str) -> Vec<LightPost> {
        self.stats
            .total_queries
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);

        self.author_index
            .get(author_id)
            .map(|post_ids| post_ids.iter().filter_map(|id| self.get(id)).collect())
            .unwrap_or_default()
    }

    /// 按时间范围查询（最近 N 天的帖子）
    pub fn get_recent(&self, max_age_days: i64) -> Vec<LightPost> {
        let cutoff = chrono::Utc::now() - chrono::Duration::days(max_age_days);
        self.posts
            .iter()
            .filter(|entry| entry.post.created_at >= cutoff)
            .map(|entry| entry.post.clone())
            .collect()
    }

    /// 按话题标签查询
    pub fn get_by_topic(&self, topic: &str) -> Vec<LightPost> {
        self.posts
            .iter()
            .filter(|entry| entry.post.topic_tags.iter().any(|tag| tag == topic))
            .map(|entry| entry.post.clone())
            .collect()
    }

    /// 裁剪过期帖子和超容量帖子
    pub fn prune(&self) -> PruneResult {
        let start = Instant::now();
        let initial_count = self.posts.len();
        let mut pruned_expired = 0;
        let mut pruned_inactive = 0;

        // 1. 裁剪过期帖子
        self.posts.retain(|_, entry| {
            if entry.post.is_expired(self.config.max_age_days) {
                pruned_expired += 1;
                false
            } else {
                true
            }
        });

        // 2. 如果仍然超容量，按 last_accessed 排序裁剪最不活跃的
        if self.posts.len() > self.config.max_posts {
            let excess = self.posts.len() - self.config.max_posts;
            let inactive_threshold = self.config.inactive_threshold;

            // 收集不活跃的 key
            let inactive_keys: Vec<String> = self
                .posts
                .iter()
                .filter(|entry| entry.last_accessed.elapsed() > inactive_threshold)
                .map(|entry| entry.post.post_id.clone())
                .take(excess)
                .collect();

            for key in &inactive_keys {
                if let Some((_, entry)) = self.posts.remove(key) {
                    if let Some(mut author_posts) = self.author_index.get_mut(&entry.post.author_id)
                    {
                        author_posts.retain(|id| id != key);
                    }
                    pruned_inactive += 1;
                }
            }
        }

        // 3. 清理空的作者索引
        self.author_index.retain(|_, posts| !posts.is_empty());

        self.stats
            .total_prunes
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);

        PruneResult {
            initial_count,
            final_count: self.posts.len(),
            pruned_expired,
            pruned_inactive,
            duration_ms: start.elapsed().as_millis() as u64,
        }
    }

    /// 后台裁剪任务（应在 tokio spawn 中运行）
    pub async fn background_prune_loop(self: Arc<Self>) {
        let mut interval = tokio::time::interval(self.config.prune_interval);
        loop {
            interval.tick().await;
            let result = self.prune();
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

    /// 当前帖子数量
    pub fn len(&self) -> usize {
        self.posts.len()
    }

    pub fn is_empty(&self) -> bool {
        self.posts.is_empty()
    }

    /// 估算内存使用量（字节）
    pub fn estimated_memory_bytes(&self) -> usize {
        let post_size = std::mem::size_of::<PostEntry>() + 512; // 估算每帖子 ~512 字节数据
        let index_size = self.author_index.len() * 64; // 估算索引开销
        self.posts.len() * post_size + index_size
    }

    /// 存储快照（用于诊断）
    pub fn snapshot(&self) -> ThunderSnapshot {
        ThunderSnapshot {
            post_count: self.posts.len(),
            author_count: self.author_index.len(),
            estimated_memory_bytes: self.estimated_memory_bytes(),
            total_inserts: self
                .stats
                .total_inserts
                .load(std::sync::atomic::Ordering::Relaxed),
            total_deletes: self
                .stats
                .total_deletes
                .load(std::sync::atomic::Ordering::Relaxed),
            total_queries: self
                .stats
                .total_queries
                .load(std::sync::atomic::Ordering::Relaxed),
        }
    }
}

impl Default for ThunderStore {
    fn default() -> Self {
        Self::new(ThunderConfig::default())
    }
}

/// 裁剪结果
#[derive(Debug)]
pub struct PruneResult {
    pub initial_count: usize,
    pub final_count: usize,
    pub pruned_expired: usize,
    pub pruned_inactive: usize,
    pub duration_ms: u64,
}

/// 存储快照（诊断用）
#[derive(Debug, Serialize)]
pub struct ThunderSnapshot {
    pub post_count: usize,
    pub author_count: usize,
    pub estimated_memory_bytes: usize,
    pub total_inserts: u64,
    pub total_deletes: u64,
    pub total_queries: u64,
}

/// Kafka 事件类型（用于消费 post create/delete 事件）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum PostEvent {
    #[serde(rename = "post.created")]
    Created { post: LightPost },
    #[serde(rename = "post.deleted")]
    Deleted { post_id: String },
    #[serde(rename = "post.updated")]
    Updated { post: LightPost },
}

/// Kafka consumer 处理器（接口定义，实际实现需要 Kafka 客户端）
pub trait PostEventProcessor: Send + Sync {
    fn process_event(&self, event: PostEvent);
}

impl PostEventProcessor for ThunderStore {
    fn process_event(&self, event: PostEvent) {
        match event {
            PostEvent::Created { post } => self.upsert(post),
            PostEvent::Deleted { post_id } => {
                self.delete(&post_id);
            }
            PostEvent::Updated { post } => self.upsert(post),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_post(post_id: &str, author_id: &str) -> LightPost {
        LightPost {
            post_id: post_id.to_string(),
            author_id: author_id.to_string(),
            content_preview: "test content".to_string(),
            created_at: chrono::Utc::now(),
            has_image: false,
            has_video: false,
            like_count: 10,
            comment_count: 5,
            repost_count: 2,
            view_count: 100,
            recall_source: "FollowingSource".to_string(),
            conversation_id: None,
            is_reply: false,
            is_repost: false,
            original_post_id: None,
            topic_tags: vec!["tech".to_string()],
        }
    }

    #[test]
    fn upsert_and_get() {
        let store = ThunderStore::default();
        store.upsert(make_post("p1", "a1"));
        assert_eq!(store.len(), 1);
        let post = store.get("p1").unwrap();
        assert_eq!(post.post_id, "p1");
    }

    #[test]
    fn delete_removes_post() {
        let store = ThunderStore::default();
        store.upsert(make_post("p1", "a1"));
        let removed = store.delete("p1");
        assert!(removed.is_some());
        assert!(store.get("p1").is_none());
        assert!(store.is_empty());
    }

    #[test]
    fn batch_operations() {
        let store = ThunderStore::default();
        let posts = vec![
            make_post("p1", "a1"),
            make_post("p2", "a1"),
            make_post("p3", "a2"),
        ];
        store.upsert_batch(posts);
        assert_eq!(store.len(), 3);

        let results = store.get_batch(&["p1".to_string(), "p2".to_string(), "p999".to_string()]);
        assert!(results[0].is_some());
        assert!(results[1].is_some());
        assert!(results[2].is_none());
    }

    #[test]
    fn author_query() {
        let store = ThunderStore::default();
        store.upsert(make_post("p1", "a1"));
        store.upsert(make_post("p2", "a1"));
        store.upsert(make_post("p3", "a2"));

        let author_posts = store.get_by_author("a1");
        assert_eq!(author_posts.len(), 2);
    }

    #[test]
    fn topic_query() {
        let store = ThunderStore::default();
        let mut post = make_post("p1", "a1");
        post.topic_tags = vec!["rust".to_string(), "async".to_string()];
        store.upsert(post);

        let mut post2 = make_post("p2", "a2");
        post2.topic_tags = vec!["python".to_string()];
        store.upsert(post2);

        assert_eq!(store.get_by_topic("rust").len(), 1);
        assert_eq!(store.get_by_topic("python").len(), 1);
        assert!(store.get_by_topic("golang").is_empty());
    }

    #[test]
    fn prune_removes_expired() {
        let store = ThunderStore::new(ThunderConfig {
            max_age_days: 1,
            ..Default::default()
        });

        // 插入一个已过期的帖子
        let mut old_post = make_post("old", "a1");
        old_post.created_at = chrono::Utc::now() - chrono::Duration::days(10);
        store.upsert(old_post);
        store.upsert(make_post("new", "a2"));

        let result = store.prune();
        assert_eq!(result.pruned_expired, 1);
        assert_eq!(store.len(), 1);
        assert!(store.get("new").is_some());
    }

    #[test]
    fn post_event_processor() {
        let store = ThunderStore::default();
        store.process_event(PostEvent::Created {
            post: make_post("p1", "a1"),
        });
        assert_eq!(store.len(), 1);

        store.process_event(PostEvent::Deleted {
            post_id: "p1".to_string(),
        });
        assert!(store.is_empty());
    }

    #[test]
    fn snapshot_reports_stats() {
        let store = ThunderStore::default();
        store.upsert(make_post("p1", "a1"));
        store.get("p1");

        let snap = store.snapshot();
        assert_eq!(snap.post_count, 1);
        assert_eq!(snap.author_count, 1);
        assert_eq!(snap.total_inserts, 1);
        assert_eq!(snap.total_queries, 1);
    }
}
