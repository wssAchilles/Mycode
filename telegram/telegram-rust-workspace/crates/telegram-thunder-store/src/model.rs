//! Thunder 内存帖子存储的核心数据模型、配置与统计结构。

use std::sync::atomic::AtomicU64;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// 轻量帖子结构（保留向后兼容的外部契约字段）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LightPost {
    pub post_id: String,
    pub author_id: String,
    pub content_preview: String,
    pub created_at: DateTime<Utc>,
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
    /// 计算帖子年龄（天数）
    pub fn age_days(&self) -> i64 {
        Utc::now().signed_duration_since(self.created_at).num_days()
    }

    /// 判断帖子是否已超过最大存活天数
    pub fn is_expired(&self, max_age_days: i64) -> bool {
        self.age_days() > max_age_days
    }
}

/// 分池时间索引中的紧凑节点，仅保留帖子标识与毫秒时间戳
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TinyPost {
    pub post_id: String,
    pub created_at_ms: i64,
}

impl TinyPost {
    /// 构建精简时间索引条目
    pub fn new(post_id: String, created_at_ms: i64) -> Self {
        Self {
            post_id,
            created_at_ms,
        }
    }
}

/// 紧凑内存帖子模型，承载三池分流、对话树门控与 6 级 Semantic ID 所需核心字段
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompactPost {
    pub post_id: String,
    pub author_id: String,
    pub created_at_ms: i64,
    pub in_reply_to_post_id: Option<String>,
    pub original_post_id: Option<String>,
    pub conversation_id: Option<String>,
    pub is_reply: bool,
    pub is_repost: bool,
    pub has_video: bool,
    pub video_duration_sec: Option<f64>,
    pub semantic_ids: Option<[i32; 6]>,
}

impl CompactPost {
    /// 视频池最低有效时长阈值（秒）
    pub const MIN_VIDEO_DURATION_SEC: f64 = 5.0;

    /// 判断是否为原创帖（非回复且非转发）
    pub fn is_original(&self) -> bool {
        !self.is_reply && !self.is_repost
    }

    /// 判断是否满足视频池准入条件（包含视频、时长 >= 5 秒且非回复）
    pub fn is_video_eligible(&self) -> bool {
        self.has_video
            && self.video_duration_sec.unwrap_or(0.0) >= Self::MIN_VIDEO_DURATION_SEC
            && !self.is_reply
    }

    /// 生成对应的精简索引条目
    pub fn to_tiny(&self) -> TinyPost {
        TinyPost {
            post_id: self.post_id.clone(),
            created_at_ms: self.created_at_ms,
        }
    }
}

impl From<LightPost> for CompactPost {
    fn from(post: LightPost) -> Self {
        Self {
            post_id: post.post_id,
            author_id: post.author_id,
            created_at_ms: post.created_at.timestamp_millis(),
            in_reply_to_post_id: None,
            original_post_id: post.original_post_id,
            conversation_id: post.conversation_id,
            is_reply: post.is_reply,
            is_repost: post.is_repost,
            has_video: post.has_video,
            video_duration_sec: None,
            semantic_ids: None,
        }
    }
}

impl From<&LightPost> for CompactPost {
    fn from(post: &LightPost) -> Self {
        Self {
            post_id: post.post_id.clone(),
            author_id: post.author_id.clone(),
            created_at_ms: post.created_at.timestamp_millis(),
            in_reply_to_post_id: None,
            original_post_id: post.original_post_id.clone(),
            conversation_id: post.conversation_id.clone(),
            is_reply: post.is_reply,
            is_repost: post.is_repost,
            has_video: post.has_video,
            video_duration_sec: None,
            semantic_ids: None,
        }
    }
}

impl From<CompactPost> for LightPost {
    fn from(post: CompactPost) -> Self {
        let created_at = DateTime::from_timestamp_millis(post.created_at_ms).unwrap_or_default();
        Self {
            post_id: post.post_id,
            author_id: post.author_id,
            content_preview: String::new(),
            created_at,
            has_image: false,
            has_video: post.has_video,
            like_count: 0,
            comment_count: 0,
            repost_count: 0,
            view_count: 0,
            recall_source: "thunder".to_string(),
            conversation_id: post.conversation_id,
            is_reply: post.is_reply,
            is_repost: post.is_repost,
            original_post_id: post.original_post_id,
            topic_tags: Vec::new(),
        }
    }
}

impl From<&CompactPost> for LightPost {
    fn from(post: &CompactPost) -> Self {
        let created_at = DateTime::from_timestamp_millis(post.created_at_ms).unwrap_or_default();
        Self {
            post_id: post.post_id.clone(),
            author_id: post.author_id.clone(),
            content_preview: String::new(),
            created_at,
            has_image: false,
            has_video: post.has_video,
            like_count: 0,
            comment_count: 0,
            repost_count: 0,
            view_count: 0,
            recall_source: "thunder".to_string(),
            conversation_id: post.conversation_id.clone(),
            is_reply: post.is_reply,
            is_repost: post.is_repost,
            original_post_id: post.original_post_id.clone(),
            topic_tags: Vec::new(),
        }
    }
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
            prune_interval: Duration::from_secs(120),
            inactive_threshold: Duration::from_secs(3600),
        }
    }
}

/// 存储统计计数器
#[derive(Debug, Default)]
pub struct ThunderStats {
    pub total_inserts: AtomicU64,
    pub total_deletes: AtomicU64,
    pub total_queries: AtomicU64,
    pub total_prunes: AtomicU64,
    pub cache_hits: AtomicU64,
}

/// 裁剪执行结果
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PruneResult {
    pub initial_count: usize,
    pub final_count: usize,
    pub pruned_expired: usize,
    pub pruned_inactive: usize,
    pub duration_ms: u64,
}

/// 存储快照（用于诊断与监控输出）
#[derive(Debug, Clone, Serialize)]
pub struct ThunderSnapshot {
    pub post_count: usize,
    pub author_count: usize,
    pub estimated_memory_bytes: usize,
    pub total_inserts: u64,
    pub total_deletes: u64,
    pub total_queries: u64,
}

/// 三池分离索引规模快照
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PoolStats {
    pub total_posts: usize,
    pub original_pool_entries: usize,
    pub secondary_pool_entries: usize,
    pub video_pool_entries: usize,
    pub deleted_tombstones: usize,
}

/// 帖子事件类型（兼容旧版事件处理器接口）
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
