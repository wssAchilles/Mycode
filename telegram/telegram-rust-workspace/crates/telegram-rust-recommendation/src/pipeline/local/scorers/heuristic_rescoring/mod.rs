mod author_decay;
mod context;
mod embedding_diversity;
mod factor_trait;
mod feedback_fatigue;
mod impression_decay;
mod in_network_boost;
mod long_form;
mod media_cluster_diversity;
mod media_rich;
mod mtl_normalization;
mod new_author;
mod source_diversity;
mod verified_author;

use super::helpers::build_stage;
use super::runner::ScoringContext;
use crate::contracts::{RecommendationCandidatePayload, RecommendationStagePayload};
use context::HeuristicRescoringContext;
use factor_trait::{HeuristicFactor, apply_factor};
use std::collections::HashSet;

use author_decay::AuthorDecayFactor;
use embedding_diversity::EmbeddingDiversityFactor;
use feedback_fatigue::FeedbackFatigueFactor;
use impression_decay::ImpressionDecayFactor;
use in_network_boost::InNetworkBoostFactor;
use long_form::LongFormFactor;
use media_cluster_diversity::MediaClusterDiversityFactor;
use media_rich::MediaRichFactor;
use mtl_normalization::MtlNormalizationFactor;
use new_author::NewAuthorFactor;
use source_diversity::SourceDiversityFactor;
use verified_author::VerifiedAuthorFactor;

pub(super) struct HeuristicRescoringExecution {
    pub candidates: Vec<RecommendationCandidatePayload>,
    pub stages: Vec<RecommendationStagePayload>,
}

/// All heuristic rescoring factors, applied in order.
/// Each factor is a separate responsibility, but they share a single
/// iteration pass for cache efficiency (fused group pattern).
const HEURISTIC_FACTORS: &[&dyn HeuristicFactor] = &[
    &AuthorDecayFactor,
    &ImpressionDecayFactor,
    &SourceDiversityFactor,
    &InNetworkBoostFactor,
    &NewAuthorFactor,
    &LongFormFactor,
    &MediaRichFactor,
    &VerifiedAuthorFactor,
    &FeedbackFatigueFactor,
    &MediaClusterDiversityFactor,
    &EmbeddingDiversityFactor,
    &MtlNormalizationFactor,
];

pub(super) const HEURISTIC_RESCORING_STAGES: &[&str] = &[
    "AuthorDecayFactor",
    "ImpressionDecayFactor",
    "SourceDiversityFactor",
    "InNetworkBoostFactor",
    "NewAuthorFactor",
    "LongFormFactor",
    "MediaRichFactor",
    "VerifiedAuthorFactor",
    "FeedbackFatigueFactor",
    "MediaClusterDiversityFactor",
    "EmbeddingDiversityFactor",
    "MtlNormalizationFactor",
];

#[cfg(test)]
pub(super) fn make_test_candidate(
    post_id: &str,
    author_id: &str,
) -> RecommendationCandidatePayload {
    use chrono::{TimeZone, Utc};
    RecommendationCandidatePayload {
        post_id: post_id.to_string(),
        model_post_id: Some(post_id.to_string()),
        author_id: author_id.to_string(),
        content: "test content for heuristic rescoring".to_string(),
        created_at: Utc.with_ymd_and_hms(2026, 4, 20, 0, 0, 0).unwrap(),
        conversation_id: None,
        is_reply: false,
        reply_to_post_id: None,
        is_repost: false,
        original_post_id: None,
        in_network: Some(false),
        recall_source: Some("GraphSource".to_string()),
        retrieval_lane: None,
        interest_pool_kind: None,
        topic_ids: Vec::new(),
        secondary_recall_sources: None,
        has_video: Some(false),
        has_image: Some(false),
        video_duration_sec: None,
        has_media: false,
        media_type: crate::contracts::MediaType::None,
        video_duration_ms: None,
        media: None,
        like_count: Some(0.0),
        comment_count: Some(0.0),
        repost_count: Some(0.0),
        view_count: Some(0.0),
        author_username: None,
        author_avatar_url: None,
        author_affinity_score: None,
        author_blocks_viewer: None,
        language_code: None,
        phoenix_scores: None,
        action_scores: None,
        ranking_signals: None,
        recall_evidence: None,
        weighted_score: Some(0.5),
        pipeline_score: Some(0.5),
        score: Some(0.5),
        graph_score: None,
        graph_path: None,
        graph_recall_type: None,
        post_type: None,
        mutual_follow_jaccard: None,
        following_replied: None,
        score_breakdown: None,
        score_breakdown_version: None,
        is_nsfw: Some(false),
        is_news: Some(false),
        news_metadata: None,
        vf_result: None,
        is_liked_by_user: Some(false),
        is_reposted_by_user: Some(false),
        selection_pool: None,
        selection_reason: None,
        is_pinned: Some(false),
        is_subscription_only: None,
        score_contract_version: None,
    }
}

pub(super) fn run_heuristic_rescoring_group(
    ctx: &ScoringContext,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> HeuristicRescoringExecution {
    let input_count = candidates.len();
    let seen_post_ids: HashSet<String> = ctx.query.seen_ids.iter().cloned().collect();

    // Pre-compute per-author and per-source counts before the mutable loop
    // to satisfy the borrow checker (immutable borrow of candidates for context,
    // then mutable borrow for the factor application loop).
    let rescoring_ctx = HeuristicRescoringContext::new(&candidates, &seen_post_ids);

    for candidate in &mut candidates {
        for factor in HEURISTIC_FACTORS {
            apply_factor(*factor, candidate, &rescoring_ctx);
        }
    }

    let stages = HEURISTIC_RESCORING_STAGES
        .iter()
        .map(|name| build_stage(name, input_count, true, None))
        .collect();

    HeuristicRescoringExecution { candidates, stages }
}
