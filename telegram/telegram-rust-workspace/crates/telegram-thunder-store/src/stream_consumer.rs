//! Redis Stream `recsys:events:v1` 增量消费者与事件解析器。
//!
//! 负责消费并应用：
//! - `post.created`：实时写入 `ThunderStore` 三池索引；
//! - `post.deleted`：写入 `deleted_posts` 墓碑并摘除主表与三池条目；
//! - `post.sid_assigned`：将异步生成的 6 级 Semantic ID 回填至对应 `CompactPost`。

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use redis::streams::StreamReadReply;
use serde::Deserialize;
use tokio::sync::watch;

use crate::model::CompactPost;
use crate::post_store::ThunderStore;

/// 默认订阅的推荐系统内网事件流 Key
pub const DEFAULT_STREAM_KEY: &str = "recsys:events:v1";
/// 默认 Rust 推荐消费组名称
pub const DEFAULT_CONSUMER_GROUP: &str = "cg:rust-recsys";

/// Redis Stream 监听器配置
#[derive(Debug, Clone)]
pub struct StreamConsumerConfig {
    pub redis_url: String,
    pub stream_key: String,
    pub consumer_group: String,
    pub consumer_name: String,
    pub read_count: usize,
    pub block_ms: usize,
    pub reconnect_delay: Duration,
}

impl StreamConsumerConfig {
    /// 使用指定 Redis URL 构建默认流消费配置
    pub fn new(redis_url: impl Into<String>) -> Self {
        Self {
            redis_url: redis_url.into(),
            ..Self::default()
        }
    }
}

impl Default for StreamConsumerConfig {
    fn default() -> Self {
        Self {
            redis_url: "redis://127.0.0.1:6379".to_string(),
            stream_key: DEFAULT_STREAM_KEY.to_string(),
            consumer_group: DEFAULT_CONSUMER_GROUP.to_string(),
            consumer_name: format!("thunder-worker-{}", std::process::id()),
            read_count: 64,
            block_ms: 500,
            reconnect_delay: Duration::from_secs(2),
        }
    }
}

#[derive(Debug, Deserialize)]
struct PostCreatedPayload {
    #[serde(alias = "postId", alias = "post_id")]
    post_id: String,
    #[serde(alias = "authorId", alias = "author_id")]
    author_id: String,
    #[serde(default, alias = "createdAtMs", alias = "created_at_ms")]
    created_at_ms: Option<i64>,
    #[serde(default, alias = "createdAt", alias = "created_at")]
    created_at: Option<String>,
    #[serde(
        default,
        alias = "replyToPostId",
        alias = "inReplyToPostId",
        alias = "in_reply_to_post_id",
        alias = "reply_to_post_id"
    )]
    in_reply_to_post_id: Option<String>,
    #[serde(default, alias = "originalPostId", alias = "original_post_id")]
    original_post_id: Option<String>,
    #[serde(default, alias = "conversationId", alias = "conversation_id")]
    conversation_id: Option<String>,
    #[serde(default, alias = "isReply", alias = "is_reply")]
    is_reply: bool,
    #[serde(default, alias = "isRepost", alias = "is_repost")]
    is_repost: bool,
    #[serde(default, alias = "hasVideo", alias = "has_video")]
    has_video: bool,
    #[serde(default, alias = "videoDurationSec", alias = "video_duration_sec")]
    video_duration_sec: Option<f64>,
    #[serde(
        default,
        alias = "sids",
        alias = "semanticIds",
        alias = "semantic_ids",
        alias = "codes"
    )]
    semantic_ids: Option<Vec<i32>>,
}

#[derive(Debug, Deserialize)]
struct PostDeletedPayload {
    #[serde(alias = "postId", alias = "post_id")]
    post_id: String,
    #[serde(default, alias = "authorId", alias = "author_id")]
    author_id: Option<String>,
    #[serde(
        default,
        alias = "deletedAtMs",
        alias = "deleted_at_ms",
        alias = "timestampMs"
    )]
    deleted_at_ms: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct PostSidAssignedPayload {
    #[serde(alias = "postId", alias = "post_id")]
    post_id: String,
    #[serde(
        default,
        alias = "codes",
        alias = "semanticIds",
        alias = "semantic_ids",
        alias = "sids"
    )]
    codes: Option<Vec<i32>>,
}

/// 将长度为 6 的动态数组解析为定长 Semantic ID（合法范围 -1..=255），全为负值占位符则视为缺失
fn parse_fixed_semantic_ids(raw: Option<Vec<i32>>) -> Option<[i32; 6]> {
    let vec = raw?;
    let arr: [i32; 6] = vec.try_into().ok()?;
    if !arr.iter().all(|&code| (-1..=255).contains(&code)) {
        return None;
    }
    if arr.iter().all(|&code| code < 0) {
        return None;
    }
    Some(arr)
}

fn resolve_created_at_ms(created_at_ms: Option<i64>, created_at: Option<&str>) -> i64 {
    if let Some(ms) = created_at_ms {
        return ms;
    }
    if let Some(iso) = created_at
        && let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(iso)
    {
        return parsed.timestamp_millis();
    }
    Utc::now().timestamp_millis()
}

/// 解析并应用来自 `recsys:events:v1` 的单条事件到 `ThunderStore`
pub fn apply_recsys_stream_event(
    store: &ThunderStore,
    event_type: &str,
    payload_json: &str,
) -> bool {
    match event_type {
        "post.created" => {
            let Ok(payload) = serde_json::from_str::<PostCreatedPayload>(payload_json) else {
                return false;
            };
            if payload.post_id.trim().is_empty() || payload.author_id.trim().is_empty() {
                return false;
            }
            let created_at_ms =
                resolve_created_at_ms(payload.created_at_ms, payload.created_at.as_deref());
            let compact = CompactPost {
                post_id: payload.post_id,
                author_id: payload.author_id,
                created_at_ms,
                in_reply_to_post_id: payload.in_reply_to_post_id,
                original_post_id: payload.original_post_id,
                conversation_id: payload.conversation_id,
                is_reply: payload.is_reply,
                is_repost: payload.is_repost,
                has_video: payload.has_video,
                video_duration_sec: payload.video_duration_sec,
                semantic_ids: parse_fixed_semantic_ids(payload.semantic_ids),
            };
            store.upsert_compact(compact)
        }
        "post.deleted" => {
            let Ok(payload) = serde_json::from_str::<PostDeletedPayload>(payload_json) else {
                return false;
            };
            if payload.post_id.trim().is_empty() {
                return false;
            }
            let deleted_at_ms = payload
                .deleted_at_ms
                .unwrap_or_else(|| Utc::now().timestamp_millis());
            store.mark_deleted(
                &payload.post_id,
                payload.author_id.as_deref(),
                deleted_at_ms,
            )
        }
        "post.sid_assigned" => {
            let Ok(payload) = serde_json::from_str::<PostSidAssignedPayload>(payload_json) else {
                return false;
            };
            if payload.post_id.trim().is_empty() {
                return false;
            }
            let Some(codes) = parse_fixed_semantic_ids(payload.codes) else {
                return false;
            };
            store.update_semantic_ids(&payload.post_id, codes)
        }
        _ => false,
    }
}

/// 从 Redis Stream 条目字段字典提取 `(event_type, payload_json)` 并应用至存储
pub(crate) fn apply_stream_fields_map(
    store: &ThunderStore,
    fields: &HashMap<String, redis::Value>,
) -> bool {
    let event_type = extract_field_string(fields, &["eventType", "event_type", "topic"]);
    let payload_json = extract_field_string(fields, &["payload", "data"]);

    match (event_type, payload_json) {
        (Some(evt), Some(payload)) => apply_recsys_stream_event(store, &evt, &payload),
        _ => false,
    }
}

fn extract_field_string(
    fields: &HashMap<String, redis::Value>,
    candidate_keys: &[&str],
) -> Option<String> {
    for key in candidate_keys {
        if let Some(val) = fields.get(*key)
            && let Ok(parsed) = redis::from_redis_value::<String>(val)
            && !parsed.is_empty()
        {
            return Some(parsed);
        }
    }
    None
}

/// 启动后台 Redis Stream 消费者任务（使用 `XGROUP CREATE ... $ MKSTREAM` 与 `XREADGROUP`）
pub fn spawn_stream_listener(
    store: Arc<ThunderStore>,
    config: StreamConsumerConfig,
) -> tokio::task::JoinHandle<()> {
    let (_tx, rx) = watch::channel(false);
    spawn_stream_listener_with_shutdown(store, config, rx)
}

/// 启动支持外部优雅关闭信号的后台 Redis Stream 消费者任务
pub fn spawn_stream_listener_with_shutdown(
    store: Arc<ThunderStore>,
    config: StreamConsumerConfig,
    mut shutdown: watch::Receiver<bool>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let client = match redis::Client::open(config.redis_url.as_str()) {
            Ok(c) => c,
            Err(err) => {
                tracing::error!(
                    error = %err,
                    redis_url = %config.redis_url,
                    "failed to build redis client for thunder stream listener"
                );
                return;
            }
        };

        while !*shutdown.borrow() {
            let Ok(mut conn) = client.get_multiplexed_async_connection().await else {
                tracing::warn!(
                    stream = %config.stream_key,
                    "redis connection unavailable for thunder stream listener, retrying"
                );
                tokio::select! {
                    _ = tokio::time::sleep(config.reconnect_delay) => {}
                    _ = shutdown.changed() => { break; }
                }
                continue;
            };

            // 幂等创建消费组（BUSYGROUP 代表消费组已存在，属于正常就绪状态）
            let group_result: redis::RedisResult<redis::Value> = redis::cmd("XGROUP")
                .arg("CREATE")
                .arg(&config.stream_key)
                .arg(&config.consumer_group)
                .arg("$")
                .arg("MKSTREAM")
                .query_async(&mut conn)
                .await;

            if let Err(err) = group_result
                && !err.to_string().contains("BUSYGROUP")
            {
                tracing::warn!(
                    error = %err,
                    stream = %config.stream_key,
                    group = %config.consumer_group,
                    "XGROUP CREATE failed"
                );
            }

            while !*shutdown.borrow() {
                let mut read_cmd = redis::cmd("XREADGROUP");
                read_cmd
                    .arg("GROUP")
                    .arg(&config.consumer_group)
                    .arg(&config.consumer_name)
                    .arg("COUNT")
                    .arg(config.read_count)
                    .arg("BLOCK")
                    .arg(config.block_ms)
                    .arg("STREAMS")
                    .arg(&config.stream_key)
                    .arg(">");
                let read_fut = read_cmd.query_async::<Option<StreamReadReply>>(&mut conn);

                let reply = tokio::select! {
                    res = read_fut => res,
                    _ = shutdown.changed() => {
                        if *shutdown.borrow() {
                            return;
                        }
                        continue;
                    }
                };

                match reply {
                    Ok(Some(stream_reply)) => {
                        for stream_key in stream_reply.keys {
                            for entry in stream_key.ids {
                                let _ = apply_stream_fields_map(&store, &entry.map);
                                // 即使事件属于其他消费者（如 graph.edge_delta）或解析跳过，也需 XACK 避免 PEL 积压
                                let _: redis::RedisResult<i64> = redis::cmd("XACK")
                                    .arg(&config.stream_key)
                                    .arg(&config.consumer_group)
                                    .arg(&entry.id)
                                    .query_async(&mut conn)
                                    .await;
                            }
                        }
                    }
                    Ok(None) => {}
                    Err(err) => {
                        tracing::warn!(
                            error = %err,
                            stream = %config.stream_key,
                            "XREADGROUP failed, reconnecting"
                        );
                        break;
                    }
                }
            }

            if *shutdown.borrow() {
                break;
            }
            tokio::select! {
                _ = tokio::time::sleep(config.reconnect_delay) => {}
                _ = shutdown.changed() => { break; }
            }
        }
    })
}
