//! V3 代际架构专属候选字段载体（多源追溯与 DPP 整页语义上下文）。

use serde::{Deserialize, Serialize};

/// 候选命中的单条召回源明细（替代扁平字符串枚举，携带聚类簇与原生打分/位次）。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RetrievalSourcePayload {
    pub source_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cluster: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<u32>,
}

/// DPP/Greedy Slate 重排或离线回放时的语义 ID 与整页协同上下文。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SlateContextPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub k: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pool_rank: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sid_known: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sid_k_l1: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sid_k_l2: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sid_k_l3: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sid_gap_l1: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sid_gap_l2: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sid_gap_l3: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recon_cos_milli: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pre_diversity_score: Option<f64>,
}
