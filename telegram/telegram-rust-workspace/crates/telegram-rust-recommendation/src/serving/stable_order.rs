use crate::contracts::RecommendationCandidatePayload;
use std::cmp::Ordering;
use telegram_serving_primitives::{StableOrderCandidateKey, build_stable_order_key_from_parts};

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
    let key_parts = candidates
        .iter()
        .map(|candidate| StableOrderCandidateKey {
            post_id: &candidate.post_id,
            author_id: &candidate.author_id,
            created_at_ms: candidate.created_at.timestamp_millis(),
            score: candidate_score(candidate),
            recall_source: candidate.recall_source.as_deref().unwrap_or_default(),
        })
        .collect::<Vec<_>>();
    build_stable_order_key_from_parts(&key_parts, in_network_only)
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

    use super::{compare_candidates, sort_candidates_stably};

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
            author_blocks_viewer: None,
            language_code: None,
            phoenix_scores: None,
            action_scores: None,
            ranking_signals: None,
            recall_evidence: None,
            selection_pool: None,
            selection_reason: None,
            score_contract_version: None,
            score_breakdown_version: None,
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
    fn stable_order_sort_preserves_candidate_score_fields() {
        let mut candidates = vec![
            candidate("low", 0.2, 1_700_000_000_000),
            candidate("high", 0.9, 1_700_000_000_100),
        ];
        candidates[0].pipeline_score = Some(0.2);
        candidates[1].pipeline_score = Some(0.9);
        let original = candidates.clone();

        sort_candidates_stably(&mut candidates, false);

        assert_eq!(candidates[0].post_id, "high");
        for candidate in &candidates {
            let expected = original
                .iter()
                .find(|input| input.post_id == candidate.post_id)
                .expect("sorted candidate comes from original input");
            assert_eq!(candidate.score, expected.score);
            assert_eq!(candidate.weighted_score, expected.weighted_score);
            assert_eq!(candidate.pipeline_score, expected.pipeline_score);
        }
    }
}
