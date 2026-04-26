use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};
use crate::pipeline::local::context::{
    FALLBACK_LANE, IN_NETWORK_LANE, INTEREST_LANE, SOCIAL_EXPANSION_LANE, source_retrieval_lane,
};
use crate::pipeline::local::signals::user_actions::CandidateActionMatch;

#[derive(Debug, Clone, Copy)]
pub struct CalibrationTableAdjustment {
    pub multiplier: f64,
    pub lane_prior: f64,
    pub source_prior: f64,
    pub engagement_prior: f64,
    pub quality_prior: f64,
    pub behavior_prior: f64,
}

pub fn calibration_table_adjustment(
    query: &RecommendationQueryPayload,
    candidate: &RecommendationCandidatePayload,
    action_match: CandidateActionMatch,
) -> CalibrationTableAdjustment {
    let lane = candidate
        .retrieval_lane
        .as_deref()
        .unwrap_or_else(|| source_retrieval_lane(candidate.recall_source.as_deref().unwrap_or("")));
    let state = query
        .user_state_context
        .as_ref()
        .map(|context| context.state.as_str())
        .unwrap_or("");
    let lane_prior = lane_prior(state, lane);
    let source_prior = source_prior(candidate.recall_source.as_deref().unwrap_or(""));
    let engagement_prior = engagement_prior(candidate);
    let quality_prior = quality_prior(candidate);
    let behavior_prior = behavior_prior(action_match);
    let multiplier =
        (lane_prior * source_prior * engagement_prior * quality_prior * behavior_prior)
            .clamp(0.62, 1.36);

    CalibrationTableAdjustment {
        multiplier,
        lane_prior,
        source_prior,
        engagement_prior,
        quality_prior,
        behavior_prior,
    }
}

fn lane_prior(state: &str, lane: &str) -> f64 {
    match (state, lane) {
        ("cold_start", FALLBACK_LANE) => 1.06,
        ("cold_start", _) => 0.92,
        ("sparse", IN_NETWORK_LANE) => 1.04,
        ("sparse", SOCIAL_EXPANSION_LANE) => 1.03,
        ("sparse", INTEREST_LANE) => 1.02,
        ("sparse", FALLBACK_LANE) => 0.98,
        ("heavy", IN_NETWORK_LANE) => 1.08,
        ("heavy", SOCIAL_EXPANSION_LANE) => 1.04,
        ("heavy", INTEREST_LANE) => 0.98,
        ("heavy", FALLBACK_LANE) => 0.9,
        (_, IN_NETWORK_LANE) => 1.05,
        (_, SOCIAL_EXPANSION_LANE) => 1.02,
        (_, INTEREST_LANE) => 1.0,
        (_, FALLBACK_LANE) => 0.96,
        _ => 1.0,
    }
}

fn source_prior(source_name: &str) -> f64 {
    match source_name {
        "FollowingSource" => 1.04,
        "GraphSource" | "GraphKernelSource" => 1.03,
        "TwoTowerSource" => 1.02,
        "EmbeddingAuthorSource" => 1.01,
        "NewsAnnSource" => 0.99,
        "PopularSource" => 0.97,
        "ColdStartSource" => 0.99,
        _ => 1.0,
    }
}

fn engagement_prior(candidate: &RecommendationCandidatePayload) -> f64 {
    let views = candidate.view_count.unwrap_or(1.0).max(1.0);
    let engagements = candidate.like_count.unwrap_or_default()
        + candidate.comment_count.unwrap_or_default() * 2.0
        + candidate.repost_count.unwrap_or_default() * 3.0;
    let engagement_rate = engagements / views;
    if engagements >= 80.0 || engagement_rate >= 0.16 {
        1.06
    } else if engagements >= 24.0 || engagement_rate >= 0.08 {
        1.03
    } else if engagements <= 1.0 && views >= 80.0 {
        0.94
    } else {
        1.0
    }
}

fn quality_prior(candidate: &RecommendationCandidatePayload) -> f64 {
    let quality = candidate
        .ranking_signals
        .map(|signals| signals.quality)
        .or_else(|| {
            candidate
                .score_breakdown
                .as_ref()
                .and_then(|breakdown| breakdown.get("rankingQuality"))
                .copied()
        })
        .unwrap_or(0.62);
    let safety_penalty = if candidate
        .vf_result
        .as_ref()
        .is_some_and(|result| !result.safe)
        || candidate.is_nsfw == Some(true)
    {
        0.16
    } else {
        0.0
    };
    (0.9 + quality.clamp(0.0, 1.0) * 0.2 - safety_penalty).clamp(0.72, 1.1)
}

fn behavior_prior(action_match: CandidateActionMatch) -> f64 {
    (1.0 + action_match.personalized_strength * 0.16
        - action_match.negative_feedback * 0.24
        - action_match.delivery_fatigue * 0.1)
        .clamp(0.7, 1.18)
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};

    use crate::contracts::{
        RecommendationCandidatePayload, RecommendationQueryPayload, UserStateContextPayload,
    };
    use crate::pipeline::local::signals::user_actions::CandidateActionMatch;

    use super::calibration_table_adjustment;

    fn query(state: &str) -> RecommendationQueryPayload {
        RecommendationQueryPayload {
            request_id: "calibration".to_string(),
            user_id: "viewer".to_string(),
            limit: 20,
            cursor: None,
            in_network_only: false,
            seen_ids: vec![],
            served_ids: vec![],
            is_bottom_request: false,
            client_app_id: None,
            country_code: None,
            language_code: None,
            user_features: None,
            embedding_context: None,
            user_state_context: Some(UserStateContextPayload {
                state: state.to_string(),
                reason: "test".to_string(),
                followed_count: 12,
                recent_action_count: 20,
                recent_positive_action_count: 12,
                usable_embedding: true,
                account_age_days: Some(30),
            }),
            user_action_sequence: None,
            news_history_external_ids: None,
            model_user_action_sequence: None,
            experiment_context: None,
        }
    }

    fn candidate(source: &str, lane: &str) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: "post".to_string(),
            model_post_id: Some("post".to_string()),
            author_id: "author".to_string(),
            content: "ranking candidate".to_string(),
            created_at: Utc.with_ymd_and_hms(2026, 4, 20, 0, 0, 0).unwrap(),
            conversation_id: None,
            is_reply: false,
            reply_to_post_id: None,
            is_repost: false,
            original_post_id: None,
            in_network: Some(source == "FollowingSource"),
            recall_source: Some(source.to_string()),
            retrieval_lane: Some(lane.to_string()),
            interest_pool_kind: None,
            secondary_recall_sources: None,
            has_video: None,
            has_image: None,
            video_duration_sec: None,
            media: None,
            like_count: Some(80.0),
            comment_count: Some(12.0),
            repost_count: Some(7.0),
            view_count: Some(500.0),
            author_username: None,
            author_avatar_url: None,
            author_affinity_score: None,
            phoenix_scores: None,
            action_scores: None,
            ranking_signals: None,
            recall_evidence: None,
            weighted_score: Some(1.0),
            score: Some(1.0),
            is_liked_by_user: None,
            is_reposted_by_user: None,
            is_nsfw: None,
            vf_result: None,
            is_news: None,
            news_metadata: None,
            is_pinned: None,
            score_breakdown: None,
            pipeline_score: Some(1.0),
            graph_score: None,
            graph_path: None,
            graph_recall_type: None,
        }
    }

    #[test]
    fn calibration_prior_prefers_heavy_in_network_over_fallback() {
        let action_match = CandidateActionMatch {
            personalized_strength: 0.4,
            ..CandidateActionMatch::default()
        };
        let in_network = calibration_table_adjustment(
            &query("heavy"),
            &candidate("FollowingSource", "in_network"),
            action_match,
        );
        let fallback = calibration_table_adjustment(
            &query("heavy"),
            &candidate("PopularSource", "fallback"),
            action_match,
        );

        assert!(in_network.multiplier > fallback.multiplier);
    }
}
