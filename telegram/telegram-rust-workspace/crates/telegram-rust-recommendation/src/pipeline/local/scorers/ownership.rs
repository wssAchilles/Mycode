use crate::contracts::RecommendationCandidatePayload;
use serde::Serialize;
use telegram_component_primitives::scorers::{
    AUTHOR_AFFINITY_SCORER, AUTHOR_DECAY_FACTOR, AUTHOR_DIVERSITY_SCORER,
    BANDIT_EXPLORATION_SCORER, COLD_START_INTEREST_SCORER, CONTENT_QUALITY_SCORER,
    EMBEDDING_DIVERSITY_FACTOR, EXPLORATION_SCORER, FATIGUE_SCORER, FEEDBACK_FATIGUE_FACTOR,
    IMPRESSION_DECAY_FACTOR, IN_NETWORK_BOOST_FACTOR, INTEREST_DECAY_SCORER,
    INTRA_REQUEST_DIVERSITY_SCORER, LIGHTWEIGHT_PHOENIX_SCORER, LISTWISE_AUTHOR_DECAY,
    LISTWISE_SOURCE_DECAY, LONG_FORM_FACTOR, MEDIA_CLUSTER_DIVERSITY_FACTOR, MEDIA_RICH_FACTOR,
    MTL_NORMALIZATION_FACTOR, NEW_AUTHOR_FACTOR, NEWS_TREND_LINK_SCORER, OUT_OF_NETWORK_SCORER,
    RECENCY_SCORER, SCORE_CALIBRATION_SCORER, SCORE_CONTRACT_SCORER, SESSION_SUPPRESSION_SCORER,
    SOURCE_DIVERSITY_FACTOR, TREND_AFFINITY_SCORER, TREND_PERSONALIZATION_SCORER,
    VERIFIED_AUTHOR_FACTOR, WEIGHTED_SCORER,
};
use telegram_ranking_primitives::{
    RANKING_CANDIDATE_FIELD_ACTION_SCORES, RANKING_CANDIDATE_FIELD_AUTHOR_AFFINITY_SCORE,
    RANKING_CANDIDATE_FIELD_FINAL_SCORE, RANKING_CANDIDATE_FIELD_PHOENIX_SCORES,
    RANKING_CANDIDATE_FIELD_PIPELINE_SCORE, RANKING_CANDIDATE_FIELD_RANKING_SIGNALS,
    RANKING_CANDIDATE_FIELD_SCORE_BREAKDOWN, RANKING_CANDIDATE_FIELD_SCORE_BREAKDOWN_VERSION,
    RANKING_CANDIDATE_FIELD_SCORE_CONTRACT_VERSION, RANKING_CANDIDATE_FIELD_WEIGHTED_SCORE,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum CandidateFieldWrite {
    PhoenixScores,
    ActionScores,
    RankingSignals,
    AuthorAffinityScore,
    WeightedScore,
    FinalScore,
    ScoreContractVersion,
    ScoreBreakdownVersion,
    ScoreBreakdown,
    PipelineScore,
}

impl CandidateFieldWrite {
    pub(super) const fn as_str(self) -> &'static str {
        match self {
            Self::PhoenixScores => RANKING_CANDIDATE_FIELD_PHOENIX_SCORES,
            Self::ActionScores => RANKING_CANDIDATE_FIELD_ACTION_SCORES,
            Self::RankingSignals => RANKING_CANDIDATE_FIELD_RANKING_SIGNALS,
            Self::AuthorAffinityScore => RANKING_CANDIDATE_FIELD_AUTHOR_AFFINITY_SCORE,
            Self::WeightedScore => RANKING_CANDIDATE_FIELD_WEIGHTED_SCORE,
            Self::FinalScore => RANKING_CANDIDATE_FIELD_FINAL_SCORE,
            Self::ScoreContractVersion => RANKING_CANDIDATE_FIELD_SCORE_CONTRACT_VERSION,
            Self::ScoreBreakdownVersion => RANKING_CANDIDATE_FIELD_SCORE_BREAKDOWN_VERSION,
            Self::ScoreBreakdown => RANKING_CANDIDATE_FIELD_SCORE_BREAKDOWN,
            Self::PipelineScore => RANKING_CANDIDATE_FIELD_PIPELINE_SCORE,
        }
    }
}

const MODEL_SCORE_WRITES: &[CandidateFieldWrite] = &[
    CandidateFieldWrite::PhoenixScores,
    CandidateFieldWrite::ActionScores,
    CandidateFieldWrite::RankingSignals,
    CandidateFieldWrite::ScoreBreakdown,
    CandidateFieldWrite::ScoreBreakdownVersion,
];

const WEIGHTED_SCORE_WRITES: &[CandidateFieldWrite] = &[
    CandidateFieldWrite::WeightedScore,
    CandidateFieldWrite::PipelineScore,
    CandidateFieldWrite::ScoreBreakdown,
];

const WEIGHTED_ADJUSTMENT_WRITES: &[CandidateFieldWrite] = &[
    CandidateFieldWrite::WeightedScore,
    CandidateFieldWrite::PipelineScore,
    CandidateFieldWrite::ScoreBreakdown,
];

const AUTHOR_AFFINITY_WRITES: &[CandidateFieldWrite] = &[
    CandidateFieldWrite::AuthorAffinityScore,
    CandidateFieldWrite::WeightedScore,
    CandidateFieldWrite::PipelineScore,
    CandidateFieldWrite::ScoreBreakdown,
];

const FINAL_SCORE_WRITES: &[CandidateFieldWrite] = &[
    CandidateFieldWrite::FinalScore,
    CandidateFieldWrite::PipelineScore,
    CandidateFieldWrite::ScoreBreakdown,
];

const METADATA_WRITES: &[CandidateFieldWrite] = &[
    CandidateFieldWrite::ScoreContractVersion,
    CandidateFieldWrite::ScoreBreakdownVersion,
    CandidateFieldWrite::ScoreBreakdown,
];

const LISTWISE_ADJUSTMENT_WRITES: &[CandidateFieldWrite] = &[
    CandidateFieldWrite::WeightedScore,
    CandidateFieldWrite::PipelineScore,
];

pub(super) fn candidate_field_writes_for_stage(stage_name: &str) -> &'static [CandidateFieldWrite] {
    match stage_name {
        LIGHTWEIGHT_PHOENIX_SCORER => MODEL_SCORE_WRITES,
        WEIGHTED_SCORER => WEIGHTED_SCORE_WRITES,
        AUTHOR_AFFINITY_SCORER => AUTHOR_AFFINITY_WRITES,
        SCORE_CONTRACT_SCORER => METADATA_WRITES,
        AUTHOR_DIVERSITY_SCORER => FINAL_SCORE_WRITES,
        SCORE_CALIBRATION_SCORER
        | CONTENT_QUALITY_SCORER
        | RECENCY_SCORER
        | COLD_START_INTEREST_SCORER
        | TREND_AFFINITY_SCORER
        | TREND_PERSONALIZATION_SCORER
        | NEWS_TREND_LINK_SCORER
        | INTEREST_DECAY_SCORER
        | EXPLORATION_SCORER
        | BANDIT_EXPLORATION_SCORER
        | FATIGUE_SCORER
        | SESSION_SUPPRESSION_SCORER
        | OUT_OF_NETWORK_SCORER
        | INTRA_REQUEST_DIVERSITY_SCORER
        | AUTHOR_DECAY_FACTOR
        | IMPRESSION_DECAY_FACTOR
        | SOURCE_DIVERSITY_FACTOR
        | IN_NETWORK_BOOST_FACTOR
        | NEW_AUTHOR_FACTOR
        | LONG_FORM_FACTOR
        | MEDIA_RICH_FACTOR
        | VERIFIED_AUTHOR_FACTOR
        | FEEDBACK_FATIGUE_FACTOR
        | MEDIA_CLUSTER_DIVERSITY_FACTOR
        | EMBEDDING_DIVERSITY_FACTOR
        | MTL_NORMALIZATION_FACTOR => WEIGHTED_ADJUSTMENT_WRITES,
        LISTWISE_AUTHOR_DECAY | LISTWISE_SOURCE_DECAY => LISTWISE_ADJUSTMENT_WRITES,
        _ => &[],
    }
}

pub(super) fn candidate_field_write_names_for_stage(stage_name: &str) -> Vec<String> {
    candidate_field_writes_for_stage(stage_name)
        .iter()
        .map(|field| field.as_str().to_string())
        .collect()
}

#[cfg(debug_assertions)]
pub(super) fn assert_stage_candidate_field_writes(
    stage_name: &str,
    before: &[RecommendationCandidatePayload],
    after: &[RecommendationCandidatePayload],
) {
    let allowed = candidate_field_writes_for_stage(stage_name);
    assert_candidate_field_writes_allowed(stage_name, allowed, before, after);
}

#[cfg(debug_assertions)]
pub(super) fn assert_fused_candidate_field_writes(
    group_name: &str,
    stage_names: &[&str],
    before: &[RecommendationCandidatePayload],
    after: &[RecommendationCandidatePayload],
) {
    let mut allowed = Vec::new();
    for stage_name in stage_names {
        for field in candidate_field_writes_for_stage(stage_name) {
            if !allowed.contains(field) {
                allowed.push(*field);
            }
        }
    }
    assert_candidate_field_writes_allowed(group_name, &allowed, before, after);
}

#[cfg(debug_assertions)]
fn assert_candidate_field_writes_allowed(
    scope: &str,
    allowed: &[CandidateFieldWrite],
    before: &[RecommendationCandidatePayload],
    after: &[RecommendationCandidatePayload],
) {
    debug_assert_eq!(
        before.len(),
        after.len(),
        "candidate_write_contract_violation:{scope}:length_changed"
    );

    for (index, (left, right)) in before.iter().zip(after).enumerate() {
        assert_protected_fields_unchanged(scope, index, left, right);
        let changed = changed_scoring_fields(left, right);
        let unauthorized = changed
            .into_iter()
            .filter(|field| !allowed.contains(field))
            .map(CandidateFieldWrite::as_str)
            .collect::<Vec<_>>();
        debug_assert!(
            unauthorized.is_empty(),
            "candidate_write_contract_violation:{scope}:index={index}:unauthorized={unauthorized:?}"
        );
    }
}

#[cfg(debug_assertions)]
fn changed_scoring_fields(
    before: &RecommendationCandidatePayload,
    after: &RecommendationCandidatePayload,
) -> Vec<CandidateFieldWrite> {
    [
        (
            CandidateFieldWrite::PhoenixScores,
            !same_serialized(&before.phoenix_scores, &after.phoenix_scores),
        ),
        (
            CandidateFieldWrite::ActionScores,
            !same_serialized(&before.action_scores, &after.action_scores),
        ),
        (
            CandidateFieldWrite::RankingSignals,
            !same_serialized(&before.ranking_signals, &after.ranking_signals),
        ),
        (
            CandidateFieldWrite::AuthorAffinityScore,
            !same_serialized(&before.author_affinity_score, &after.author_affinity_score),
        ),
        (
            CandidateFieldWrite::WeightedScore,
            !same_serialized(&before.weighted_score, &after.weighted_score),
        ),
        (
            CandidateFieldWrite::FinalScore,
            !same_serialized(&before.score, &after.score),
        ),
        (
            CandidateFieldWrite::ScoreContractVersion,
            !same_serialized(
                &before.score_contract_version,
                &after.score_contract_version,
            ),
        ),
        (
            CandidateFieldWrite::ScoreBreakdownVersion,
            !same_serialized(
                &before.score_breakdown_version,
                &after.score_breakdown_version,
            ),
        ),
        (
            CandidateFieldWrite::ScoreBreakdown,
            !same_serialized(&before.score_breakdown, &after.score_breakdown),
        ),
        (
            CandidateFieldWrite::PipelineScore,
            !same_serialized(&before.pipeline_score, &after.pipeline_score),
        ),
    ]
    .into_iter()
    .filter_map(|(field, changed)| changed.then_some(field))
    .collect()
}

#[cfg(debug_assertions)]
fn assert_protected_fields_unchanged(
    scope: &str,
    index: usize,
    before: &RecommendationCandidatePayload,
    after: &RecommendationCandidatePayload,
) {
    macro_rules! same {
        ($field:ident) => {
            debug_assert!(
                same_serialized(&before.$field, &after.$field),
                "candidate_write_contract_violation:{}:index={}:protected_field={}",
                scope,
                index,
                stringify!($field)
            );
        };
    }

    same!(post_id);
    same!(model_post_id);
    same!(author_id);
    same!(content);
    same!(created_at);
    same!(conversation_id);
    same!(is_reply);
    same!(reply_to_post_id);
    same!(is_repost);
    same!(original_post_id);
    same!(in_network);
    same!(recall_source);
    same!(retrieval_lane);
    same!(interest_pool_kind);
    same!(secondary_recall_sources);
    same!(has_video);
    same!(has_image);
    same!(video_duration_sec);
    same!(media);
    same!(like_count);
    same!(comment_count);
    same!(repost_count);
    same!(view_count);
    same!(author_username);
    same!(author_avatar_url);
    same!(recall_evidence);
    same!(selection_pool);
    same!(selection_reason);
    same!(is_liked_by_user);
    same!(is_reposted_by_user);
    same!(is_nsfw);
    same!(vf_result);
    same!(is_news);
    same!(news_metadata);
    same!(is_pinned);
    same!(graph_score);
    same!(graph_path);
    same!(graph_recall_type);
}

#[cfg(debug_assertions)]
fn same_serialized<T: Serialize>(left: &T, right: &T) -> bool {
    serde_json::to_value(left).ok() == serde_json::to_value(right).ok()
}
