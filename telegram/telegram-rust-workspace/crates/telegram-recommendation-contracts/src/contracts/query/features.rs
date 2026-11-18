//! 查询级用户特征、双塔嵌入、状态分层与人口属性契约结构。

use std::num::NonZeroU64;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// 用户社交关系、屏蔽词与过滤偏好汇总。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct UserFeaturesPayload {
    pub followed_user_ids: Vec<String>,
    pub blocked_user_ids: Vec<String>,
    pub muted_user_ids: Vec<String>,
    pub muted_keywords: Vec<String>,
    pub muted_topic_ids: Vec<String>,
    pub video_preference: String,
    pub is_subscriber: bool,
    pub seen_post_ids: Vec<String>,
    pub subscribed_user_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub follower_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_created_at: Option<DateTime<Utc>>,
}

/// SimClusters 稀疏兴趣簇条目。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SparseEmbeddingEntryPayload {
    pub cluster_id: i64,
    pub score: f64,
}

/// Embedding 产物版本与维度契约声明。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingContractPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding_space: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dimensions: Option<NonZeroU64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retrieval_embedding_dim: Option<NonZeroU64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ranking_embedding_dim: Option<NonZeroU64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifact_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub producer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub semantic: Option<bool>,
}

/// 请求期携带的用户向量上下文。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingContextPayload {
    pub interested_in_clusters: Vec<SparseEmbeddingEntryPayload>,
    pub producer_embedding: Vec<SparseEmbeddingEntryPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub known_for_cluster: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub known_for_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quality_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub computed_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifact_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_profile: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding_dim: Option<i64>,
    pub usable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stale: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding_contract: Option<EmbeddingContractPayload>,
}

/// 用户生命周期分层上下文（cold_start / sparse / warm / heavy）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserStateContextPayload {
    pub state: String,
    pub reason: String,
    pub followed_count: i64,
    pub recent_action_count: i64,
    pub recent_positive_action_count: i64,
    pub usable_embedding: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_age_days: Option<i64>,
}

/// 用户实时行为统计聚合特征。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UserSignalFeaturesPayload {
    pub favorite_count: i64,
    pub retweet_count: i64,
    pub reply_count: i64,
    pub quote_count: i64,
    pub follow_count: i64,
    pub click_count: i64,
    pub video_view_count: i64,
    pub dwell_time_ms: f64,
    pub engagement_score: f64,
    pub explicit_score: f64,
    pub implicit_score: f64,
}

/// 兼容数组 `[low, high]` 或范围字符串 `'18-24'` 的年龄段反序列化辅助器。
pub fn deserialize_flexible_age_range<'de, D>(
    deserializer: D,
) -> Result<Option<(u32, u32)>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::Error;
    let value: Option<serde_json::Value> = serde::Deserialize::deserialize(deserializer)?;
    match value {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::Array(arr)) => {
            if arr.len() == 2 {
                let low = arr[0]
                    .as_u64()
                    .ok_or_else(|| Error::custom("invalid age range lower bound"))?
                    as u32;
                let high = arr[1]
                    .as_u64()
                    .ok_or_else(|| Error::custom("invalid age range upper bound"))?
                    as u32;
                Ok(Some((low, high)))
            } else {
                Err(Error::custom(
                    "age range array must contain exactly 2 integers",
                ))
            }
        }
        Some(serde_json::Value::String(s)) => {
            let cleaned = s.trim().trim_matches(['[', ']', '(', ')']);
            let parts: Vec<&str> = cleaned
                .split(['-', ',', ':'])
                .map(|p| p.trim())
                .filter(|p| !p.is_empty())
                .collect();
            if parts.len() == 2 {
                let low = parts[0].parse::<u32>().map_err(Error::custom)?;
                let high = parts[1].parse::<u32>().map_err(Error::custom)?;
                Ok(Some((low, high)))
            } else {
                Err(Error::custom(format!(
                    "invalid age range string format: {s}"
                )))
            }
        }
        _ => Err(Error::custom(
            "age range must be either an array of two integers or a range string like '18-24'",
        )),
    }
}

/// 用户人口统计学基础画像。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Demographics {
    #[serde(
        default,
        deserialize_with = "deserialize_flexible_age_range",
        skip_serializing_if = "Option::is_none"
    )]
    pub age_range: Option<(u32, u32)>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub city: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gender: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
}
