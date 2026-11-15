//! 推荐核心候选结构 `RecommendationCandidatePayload` 及其身份归一化与分值提取方法。

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::media::{CandidateMediaPayload, CandidateNewsMetadataPayload, MediaType};
use super::safety::{CandidateVisibilityPayload, ContentSafetyLabelsPayload};
use super::scores::{
    ActionScoresPayload, PhoenixScoresPayload, RankingSignalsPayload, RecallEvidencePayload,
};
use super::v3::{RetrievalSourcePayload, SlateContextPayload};

/// 全链路（Node Provider <-> Rust Pipeline <-> C++ 图核 <-> Scorer）共享的核心候选载荷。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationCandidatePayload {
    pub post_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_post_id: Option<String>,
    pub author_id: String,
    pub content: String,
    pub created_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    pub is_reply: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_to_post_id: Option<String>,
    pub is_repost: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_post_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub in_network: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recall_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retrieval_lane: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interest_pool_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub topic_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secondary_recall_sources: Option<Vec<String>>,
    /// V3 多路召回溯源结构化清单。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub retrieval_sources: Vec<RetrievalSourcePayload>,
    /// V3 6 级 RQ-VAE Semantic ID 数组（每级取值 0..255，-1 表示缺失）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub semantic_ids: Option<[i32; 6]>,
    /// V3 256 维内容语义向量，用于 ANN、SimClusters 与 DPP 核矩阵计算。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub semantic_embedding_256d: Option<Vec<f32>>,
    /// V3 作者历史可信度/声誉先验分。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author_cred_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_video: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_image: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_duration_sec: Option<f64>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub has_media: bool,
    #[serde(default, skip_serializing_if = "is_default_media_type")]
    pub media_type: MediaType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_duration_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media: Option<Vec<CandidateMediaPayload>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub like_count: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment_count: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repost_count: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub view_count: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_avatar_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_affinity_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_blocks_viewer: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phoenix_scores: Option<PhoenixScoresPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_scores: Option<ActionScoresPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ranking_signals: Option<RankingSignalsPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recall_evidence: Option<RecallEvidencePayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selection_pool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selection_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score_contract_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score_breakdown_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weighted_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_liked_by_user: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_reposted_by_user: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_nsfw: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vf_result: Option<CandidateVisibilityPayload>,
    /// V3 独立内容安全标签结构（不与召回业务耦合）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_safety_labels: Option<ContentSafetyLabelsPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_news: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub news_metadata: Option<CandidateNewsMetadataPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_pinned: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_subscription_only: Option<bool>,
    #[serde(rename = "_scoreBreakdown", skip_serializing_if = "Option::is_none")]
    pub score_breakdown: Option<HashMap<String, f64>>,
    #[serde(rename = "_pipelineScore", skip_serializing_if = "Option::is_none")]
    pub pipeline_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub graph_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub graph_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub graph_recall_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mutual_follow_jaccard: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub following_replied: Option<bool>,
    /// V3 DPP 候选池重排上下文特征。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slate_context: Option<Box<SlateContextPayload>>,
    /// V3 最终下发页面位次与探索回执上下文。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub served_slate_context: Option<Box<SlateContextPayload>>,
    /// V3 整页协同生成时对应的解码槽位序号。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_decode_slot: Option<u32>,
    /// V3 页面级强化学习探索倾向概率（用于 OPE 逆倾向加权）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_rl_exploration_prob: Option<f64>,
}

impl RecommendationCandidatePayload {
    pub fn canonical_external_id(&self) -> Option<String> {
        self.news_metadata
            .as_ref()
            .and_then(|metadata| trimmed_external_id(metadata.external_id.as_ref(), self))
            .or_else(|| trimmed_external_id(self.model_post_id.as_ref(), self))
    }

    pub fn canonical_merge_key(&self) -> String {
        if self.is_news == Some(true) {
            if let Some(cluster_id) = self
                .news_metadata
                .as_ref()
                .and_then(|metadata| metadata.cluster_id)
            {
                return format!("news:cluster:{cluster_id}");
            }
            if let Some(external_id) = self
                .news_metadata
                .as_ref()
                .and_then(|metadata| metadata.external_id.as_deref())
                .filter(|value| !value.trim().is_empty())
            {
                return format!("news:external:{}", external_id.trim().to_lowercase());
            }
            if let Some(url) = self
                .news_metadata
                .as_ref()
                .and_then(|metadata| metadata.source_url.as_deref().or(metadata.url.as_deref()))
                .and_then(normalized_url_key)
            {
                return format!("news:url:{url}");
            }
        }

        self.original_post_id
            .clone()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                self.model_post_id
                    .clone()
                    .filter(|value| !value.trim().is_empty())
            })
            .unwrap_or_else(|| self.post_id.clone())
    }

    pub fn primary_score(&self) -> f64 {
        self.score
            .into_iter()
            .chain(self.pipeline_score)
            .chain(self.weighted_score)
            .find(|value| value.is_finite())
            .unwrap_or_default()
    }

    pub fn final_score(&self) -> f64 {
        self.score
            .filter(|value| value.is_finite())
            .unwrap_or_default()
    }
}

fn is_false(value: &bool) -> bool {
    !value
}

fn is_default_media_type(value: &MediaType) -> bool {
    *value == MediaType::None
}

fn trimmed_external_id(
    value: Option<&String>,
    candidate: &RecommendationCandidatePayload,
) -> Option<String> {
    value
        .map(|value| value.trim())
        .filter(|value| !value.is_empty() && *value != candidate.post_id)
        .map(ToOwned::to_owned)
}

fn normalized_url_key(url: &str) -> Option<String> {
    let trimmed = url.trim().to_lowercase();
    if trimmed.is_empty() {
        return None;
    }
    let without_scheme = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .unwrap_or(trimmed.as_str());
    let without_www = without_scheme
        .strip_prefix("www.")
        .unwrap_or(without_scheme);
    let without_fragment = without_www.split('#').next().unwrap_or(without_www);
    let without_query = without_fragment
        .split('?')
        .next()
        .unwrap_or(without_fragment);
    let normalized = without_query.trim_end_matches('/');
    (!normalized.is_empty()).then(|| normalized.to_string())
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;
    use serde_json::Value;

    use super::*;

    #[test]
    fn candidate_payload_omits_absent_optional_fields() {
        let payload = RecommendationCandidatePayload {
            post_id: "507f191e810c19729de8c001".to_string(),
            author_id: "author-1".to_string(),
            content: "candidate".to_string(),
            created_at: Utc.with_ymd_and_hms(2026, 4, 20, 0, 0, 0).unwrap(),
            ..Default::default()
        };

        let serialized = serde_json::to_value(payload).expect("serialize candidate payload");
        let object = serialized.as_object().expect("candidate payload object");

        assert!(object.contains_key("postId"));
        assert!(object.contains_key("authorId"));
        assert!(object.contains_key("createdAt"));
        assert!(!object.contains_key("conversationId"));
        assert!(!object.contains_key("replyToPostId"));
        assert!(!object.contains_key("newsMetadata"));
        assert!(!object.contains_key("semanticIds"));
        assert!(!object.contains_key("slateContext"));
        assert!(!contains_null(&serialized));
    }

    #[test]
    fn candidate_payload_v3_fields_roundtrip_without_nulls() {
        let payload = RecommendationCandidatePayload {
            post_id: "507f191e810c19729de8c009".to_string(),
            author_id: "author-v3".to_string(),
            content: "v3 semantic post".to_string(),
            created_at: Utc.with_ymd_and_hms(2026, 11, 15, 0, 0, 0).unwrap(),
            semantic_ids: Some([12, 44, 78, 99, 128, 255]),
            semantic_embedding_256d: Some(vec![0.25, -0.5]),
            retrieval_sources: vec![RetrievalSourcePayload {
                source_type: "TwoTowerSource".to_string(),
                cluster: Some(7),
                score: Some(0.91),
                position: Some(1),
            }],
            author_cred_score: Some(0.88),
            content_safety_labels: Some(ContentSafetyLabelsPayload {
                safe: true,
                level: Some("safe".to_string()),
                labels: vec!["verified".to_string()],
                score: Some(0.99),
                source: Some("vf-v3".to_string()),
                assigned_at_ms: Some(1700000000000),
            }),
            slate_context: Some(Box::new(SlateContextPayload {
                k: Some(0),
                pool_rank: Some(2),
                sid_known: Some(true),
                sid_k_l1: Some(12),
                ..Default::default()
            })),
            page_decode_slot: Some(0),
            page_rl_exploration_prob: Some(0.05),
            phoenix_scores: Some(PhoenixScoresPayload {
                like_score: Some(0.8),
                video_view_score: Some(0.6),
                expected_dwell_sec: Some(28.4),
                dwell_probs: Some(vec![0.1, 0.4, 0.5]),
                ..Default::default()
            }),
            ..Default::default()
        };

        let serialized = serde_json::to_value(&payload).expect("serialize v3 candidate");
        assert_eq!(
            serialized.get("semanticEmbedding256d").and_then(Value::as_array).map(|v| v.len()),
            Some(2)
        );
        assert!(serialized.get("semanticIds").is_some());
        assert!(!contains_null(&serialized));

        let decoded: RecommendationCandidatePayload =
            serde_json::from_value(serialized).expect("deserialize v3 candidate");
        assert_eq!(decoded.semantic_ids, Some([12, 44, 78, 99, 128, 255]));
        assert_eq!(decoded.page_decode_slot, Some(0));
        assert_eq!(
            decoded.phoenix_scores.as_ref().and_then(|s| s.expected_dwell_sec),
            Some(28.4)
        );
    }

    #[test]
    fn canonical_candidate_identity_prefers_news_cluster_external_and_url_keys() {
        let mut payload = RecommendationCandidatePayload {
            post_id: "post-1".to_string(),
            model_post_id: Some("model-1".to_string()),
            author_id: "author-1".to_string(),
            content: "candidate".to_string(),
            created_at: Utc.with_ymd_and_hms(2026, 4, 20, 0, 0, 0).unwrap(),
            weighted_score: Some(0.4),
            is_news: Some(true),
            news_metadata: Some(CandidateNewsMetadataPayload {
                external_id: Some("external-1".to_string()),
                source_url: Some("https://www.example.com/a?b=1#frag".to_string()),
                ..CandidateNewsMetadataPayload::default()
            }),
            pipeline_score: Some(0.6),
            ..Default::default()
        };

        assert_eq!(
            payload.canonical_external_id().as_deref(),
            Some("external-1")
        );
        assert_eq!(payload.canonical_merge_key(), "news:external:external-1");
        assert_eq!(payload.primary_score(), 0.6);

        payload.score = Some(f64::NAN);
        assert_eq!(payload.primary_score(), 0.6);
        payload.pipeline_score = Some(f64::INFINITY);
        assert_eq!(payload.primary_score(), 0.4);
        payload.weighted_score = Some(f64::NEG_INFINITY);
        assert_eq!(payload.primary_score(), 0.0);
        assert_eq!(payload.final_score(), 0.0);
        payload.score = Some(-0.2);
        assert_eq!(payload.final_score(), -0.2);

        payload.news_metadata = Some(CandidateNewsMetadataPayload {
            source_url: Some("https://www.example.com/a?b=1#frag".to_string()),
            ..CandidateNewsMetadataPayload::default()
        });
        assert_eq!(payload.canonical_merge_key(), "news:url:example.com/a");
    }

    #[test]
    fn nested_candidate_payloads_omit_absent_optional_fields() {
        let media = serde_json::to_value(CandidateMediaPayload {
            type_: "image".to_string(),
            url: "https://example.com/image.jpg".to_string(),
            thumbnail_url: None,
        })
        .expect("serialize media");
        let phoenix = serde_json::to_value(PhoenixScoresPayload {
            like_score: Some(1.0),
            ..Default::default()
        })
        .expect("serialize phoenix scores");
        let visibility = serde_json::to_value(CandidateVisibilityPayload {
            safe: true,
            ..Default::default()
        })
        .expect("serialize visibility");
        let news = serde_json::to_value(CandidateNewsMetadataPayload {
            external_id: Some("N1".to_string()),
            ..Default::default()
        })
        .expect("serialize news metadata");

        assert_eq!(media.get("thumbnailUrl"), None);
        assert_eq!(phoenix.get("likeScore").and_then(Value::as_f64), Some(1.0));
        assert_eq!(phoenix.as_object().map(|value| value.len()), Some(1));
        assert_eq!(visibility.as_object().map(|value| value.len()), Some(1));
        assert_eq!(news.as_object().map(|value| value.len()), Some(1));
        assert!(!contains_null(&media));
        assert!(!contains_null(&phoenix));
        assert!(!contains_null(&visibility));
        assert!(!contains_null(&news));
    }

    fn contains_null(value: &Value) -> bool {
        match value {
            Value::Null => true,
            Value::Array(values) => values.iter().any(contains_null),
            Value::Object(values) => values.values().any(contains_null),
            _ => false,
        }
    }
}
