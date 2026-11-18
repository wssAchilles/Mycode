//! V3 查询期列式交互序列、布隆指纹及实时缓存帖子上下文结构。

use serde::{Deserialize, Serialize};

/// 对标 X V3 `ActionSeqFeatures` 的紧凑列式历史动作步（用于双塔召回与重排序列 Attention）。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ColumnarActionStepPayload {
    #[serde(
        default,
        deserialize_with = "super::numeric_serde::deserialize_flexible_i64"
    )]
    pub post_id_hash: i64,
    /// 6 级 RQ-VAE Semantic ID，缺失为 None。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub semantic_ids: Option<[i32; 6]>,
    #[serde(
        default,
        deserialize_with = "super::numeric_serde::deserialize_flexible_i64"
    )]
    pub author_hash: i64,
    pub action_type: i32,
    /// Multi-hot 行为掩码向量（对标 13 路动作可观测空间）。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub action_mask: Vec<u8>,
    pub time_delta_sec: f32,
}

/// 本会话/历史窗口内曾实际下发过且可能被用户看到的帖子条目（用于 Served Slate & 疲劳特征）。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ServedHistoryEntryPayload {
    pub post_id: String,
    pub served_at_ms: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

/// 查询水合阶段提前拉回的内存热点缓存帖子快照（减少重复 DB/API 回源）。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CachedPostEntryPayload {
    pub post_id: String,
    pub author_id: String,
    pub created_at_ms: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub semantic_ids: Option<[i32; 6]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recall_source: Option<String>,
}
