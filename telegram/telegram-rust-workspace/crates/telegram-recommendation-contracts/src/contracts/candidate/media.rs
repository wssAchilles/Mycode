//! 候选多媒体与新闻元数据契约结构。

use serde::{Deserialize, Serialize};

/// 候选媒体类型枚举（兼容上游 `"image"` 别名并安全兜底未知枚举如 `"audio"`）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum MediaType {
    #[serde(alias = "image", alias = "IMAGE", alias = "Photo", alias = "PHOTO")]
    Photo,
    #[serde(alias = "VIDEO", alias = "Video")]
    Video,
    #[serde(alias = "GIF", alias = "Gif")]
    Gif,
    #[serde(alias = "MIXED", alias = "Mixed")]
    Mixed,
    #[default]
    #[serde(other)]
    None,
}

/// 单条媒体附件描述。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateMediaPayload {
    #[serde(rename = "type")]
    pub type_: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_url: Option<String>,
}

/// 新闻外链语料附加元数据。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CandidateNewsMetadataPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cluster_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}
