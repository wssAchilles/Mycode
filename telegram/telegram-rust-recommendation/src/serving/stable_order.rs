use std::cmp::Ordering;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use serde_json::Value;

use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};

pub fn sort_candidates_stably(
    candidates: &mut [RecommendationCandidatePayload],
    in_network_only: bool,
) {
    candidates.sort_by(|left, right| compare_candidates(left, right, in_network_only));
}

pub fn compare_candidates(
    left: &RecommendationCandidatePayload,
    right: &RecommendationCandidatePayload,
    in_network_only: bool,
) -> Ordering {
    if in_network_only {
        right
            .created_at
            .cmp(&left.created_at)
            .then_with(|| right.post_id.cmp(&left.post_id))
            .then_with(|| right.author_id.cmp(&left.author_id))
    } else {
        candidate_score(right)
            .partial_cmp(&candidate_score(left))
            .unwrap_or(Ordering::Equal)
            .then_with(|| right.created_at.cmp(&left.created_at))
            .then_with(|| right.post_id.cmp(&left.post_id))
            .then_with(|| right.author_id.cmp(&left.author_id))
    }
}

pub fn build_stable_order_key(
    candidates: &[RecommendationCandidatePayload],
    in_network_only: bool,
) -> String {
    let mut hasher = DefaultHasher::new();
    in_network_only.hash(&mut hasher);

    for candidate in candidates {
        candidate.post_id.hash(&mut hasher);
        candidate.author_id.hash(&mut hasher);
        candidate.created_at.timestamp_millis().hash(&mut hasher);
        candidate_score(candidate).to_bits().hash(&mut hasher);
        candidate
            .recall_source
            .as_deref()
            .unwrap_or_default()
            .hash(&mut hasher);
    }

    format!("{:016x}", hasher.finish())
}

pub fn build_query_fingerprint(query: &RecommendationQueryPayload) -> String {
    let mut payload = serde_json::to_value(query).unwrap_or(Value::Null);
    if let Value::Object(map) = &mut payload {
        map.remove("requestId");
    }

    let mut hasher = DefaultHasher::new();
    hash_json_value(&payload, &mut hasher);
    format!("{:016x}", hasher.finish())
}

fn hash_json_value(value: &Value, hasher: &mut DefaultHasher) {
    match value {
        Value::Null => {
            "null".hash(hasher);
        }
        Value::Bool(boolean) => {
            "bool".hash(hasher);
            boolean.hash(hasher);
        }
        Value::Number(number) => {
            "number".hash(hasher);
            number.to_string().hash(hasher);
        }
        Value::String(string) => {
            "string".hash(hasher);
            string.hash(hasher);
        }
        Value::Array(values) => {
            "array".hash(hasher);
            values.len().hash(hasher);
            for value in values {
                hash_json_value(value, hasher);
            }
        }
        Value::Object(entries) => {
            "object".hash(hasher);
            let mut keys = entries.keys().cloned().collect::<Vec<_>>();
            keys.sort_unstable();
            for key in keys {
                key.hash(hasher);
                if let Some(value) = entries.get(&key) {
                    hash_json_value(value, hasher);
                }
            }
        }
    }
}

fn candidate_score(candidate: &RecommendationCandidatePayload) -> f64 {
    candidate
        .score
        .or(candidate.weighted_score)
        .or(candidate.pipeline_score)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;
    use chrono::Utc;

    use crate::contracts::RecommendationCandidatePayload;

    use super::{build_query_fingerprint, compare_candidates};

    fn candidate(post_id: &str, score: f64, created_at_ms: i64) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: post_id.to_string(),
            model_post_id: None,
            author_id: "author-1".to_string(),
            content: "content".to_string(),
            created_at: Utc.timestamp_millis_opt(created_at_ms).single().unwrap(),
            conversation_id: None,
            is_reply: false,
            reply_to_post_id: None,
            is_repost: false,
            original_post_id: None,
            in_network: Some(false),
            recall_source: Some("GraphSource".to_string()),
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
            weighted_score: Some(score),
            score: Some(score),
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
        }
    }

    #[test]
    fn compare_candidates_uses_post_id_as_final_tie_breaker() {
        let left = candidate("a", 1.0, 1_700_000_000_000);
        let right = candidate("b", 1.0, 1_700_000_000_000);

        assert_eq!(
            compare_candidates(&left, &right, false),
            std::cmp::Ordering::Greater
        );
    }

    #[test]
    fn query_fingerprint_ignores_request_id_but_is_otherwise_stable() {
        let first = crate::contracts::RecommendationQueryPayload {
            request_id: "req-1".to_string(),
            user_id: "viewer-1".to_string(),
            limit: 20,
            cursor: None,
            in_network_only: false,
            seen_ids: vec!["a".to_string()],
            served_ids: vec!["b".to_string()],
            is_bottom_request: false,
            client_app_id: Some(1),
            country_code: Some("CN".to_string()),
            language_code: Some("zh".to_string()),
            user_features: None,
            user_action_sequence: None,
            news_history_external_ids: None,
            model_user_action_sequence: None,
            experiment_context: None,
        };
        let mut second = first.clone();
        second.request_id = "req-2".to_string();

        assert_eq!(
            build_query_fingerprint(&first),
            build_query_fingerprint(&second)
        );
    }
}
