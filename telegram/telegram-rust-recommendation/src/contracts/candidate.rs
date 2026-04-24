use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateMediaPayload {
    #[serde(rename = "type")]
    pub type_: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PhoenixScoresPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub like_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repost_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quote_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub click_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quoted_click_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_click_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dwell_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dwell_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub share_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub share_via_dm_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub share_via_copy_link_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub photo_expand_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub follow_author_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_quality_view_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub not_interested_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dismiss_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_author_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mute_author_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub report_score: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CandidateVisibilityPayload {
    pub safe: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub violations: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requires_review: Option<bool>,
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secondary_recall_sources: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_video: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_image: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_duration_sec: Option<f64>,
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
    pub phoenix_scores: Option<PhoenixScoresPayload>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_news: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub news_metadata: Option<CandidateNewsMetadataPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_pinned: Option<bool>,
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
            model_post_id: None,
            author_id: "author-1".to_string(),
            content: "candidate".to_string(),
            created_at: Utc.with_ymd_and_hms(2026, 4, 20, 0, 0, 0).unwrap(),
            conversation_id: None,
            is_reply: false,
            reply_to_post_id: None,
            is_repost: false,
            original_post_id: None,
            in_network: None,
            recall_source: None,
            retrieval_lane: None,
            interest_pool_kind: None,
            secondary_recall_sources: None,
            has_video: None,
            has_image: None,
            video_duration_sec: None,
            media: None,
            like_count: None,
            comment_count: None,
            repost_count: None,
            view_count: None,
            author_username: None,
            author_avatar_url: None,
            author_affinity_score: None,
            phoenix_scores: None,
            weighted_score: None,
            score: None,
            is_liked_by_user: None,
            is_reposted_by_user: None,
            is_nsfw: None,
            vf_result: None,
            is_news: None,
            news_metadata: None,
            is_pinned: None,
            score_breakdown: None,
            pipeline_score: None,
            graph_score: None,
            graph_path: None,
            graph_recall_type: None,
        };

        let serialized = serde_json::to_value(payload).expect("serialize candidate payload");
        let object = serialized.as_object().expect("candidate payload object");

        assert!(object.contains_key("postId"));
        assert!(object.contains_key("authorId"));
        assert!(object.contains_key("createdAt"));
        assert!(!object.contains_key("conversationId"));
        assert!(!object.contains_key("replyToPostId"));
        assert!(!object.contains_key("newsMetadata"));
        assert!(!contains_null(&serialized));
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
