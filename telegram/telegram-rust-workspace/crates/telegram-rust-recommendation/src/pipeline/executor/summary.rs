use std::collections::{HashMap, HashSet};

use telegram_pipeline_primitives::PIPELINE_STAGE_DETAIL_ERROR_FIELD;
use telegram_ranking_primitives::{
    EXPLORATION_ELIGIBLE_FIELD, FATIGUE_NEGATIVE_FEEDBACK_FIELD,
    INTEREST_DECAY_NEGATIVE_PRESSURE_FIELD, NEGATIVE_FEEDBACK_STRENGTH_FIELD,
    TREND_AFFINITY_STRENGTH_FIELD, TREND_PERSONALIZATION_STRENGTH_FIELD,
};
use telegram_selector_primitives::SELECTION_POOL_EXPLORATION;

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationOnlineEvaluationPayload,
    RecommendationRankingSummaryPayload, RecommendationStagePayload,
};

use super::super::utils::dedup_strings;

pub(super) struct RankingSummaryInput<'a> {
    pub(super) input_candidates: usize,
    pub(super) hydrated_candidates: &'a [RecommendationCandidatePayload],
    pub(super) filtered_candidates: &'a [RecommendationCandidatePayload],
    pub(super) scored_candidates: &'a [RecommendationCandidatePayload],
    pub(super) filter_drop_counts: &'a HashMap<String, usize>,
    pub(super) hydrate_stages: &'a [RecommendationStagePayload],
    pub(super) filter_stages: &'a [RecommendationStagePayload],
    pub(super) score_stages: &'a [RecommendationStagePayload],
}

pub(super) fn build_ranking_summary(
    input: RankingSummaryInput<'_>,
) -> RecommendationRankingSummaryPayload {
    let mut stage_timings = HashMap::new();
    let mut degraded_reasons = Vec::new();

    for stage in input
        .hydrate_stages
        .iter()
        .chain(input.filter_stages.iter())
        .chain(input.score_stages.iter())
    {
        *stage_timings.entry(stage.name.clone()).or_insert(0) += stage.duration_ms;
        if let Some(error) = stage
            .detail
            .as_ref()
            .and_then(|detail| detail.get(PIPELINE_STAGE_DETAIL_ERROR_FIELD))
            .and_then(|value| value.as_str())
        {
            degraded_reasons.push(format!("ranking:{}:{error}", stage.name));
        }
    }

    let ml_eligible_candidates = input
        .filtered_candidates
        .iter()
        .filter(|candidate| {
            candidate.is_news.unwrap_or(false)
                && (candidate.model_post_id.is_some()
                    || candidate
                        .news_metadata
                        .as_ref()
                        .and_then(|metadata| metadata.external_id.as_ref())
                        .is_some())
        })
        .count();
    let ml_ranked_candidates = input
        .scored_candidates
        .iter()
        .filter(|candidate| candidate.phoenix_scores.is_some())
        .count();
    let weighted_candidates = input
        .scored_candidates
        .iter()
        .filter(|candidate| candidate.weighted_score.is_some())
        .count();

    let phoenix_stage_enabled = input
        .score_stages
        .iter()
        .any(|stage| stage.name == "PhoenixScorer" && stage.enabled);
    if phoenix_stage_enabled && ml_eligible_candidates > 0 && ml_ranked_candidates == 0 {
        degraded_reasons.push("ranking:PhoenixScorer:empty_ml_ranking".to_string());
    }

    dedup_strings(&mut degraded_reasons);

    RecommendationRankingSummaryPayload {
        stage: "xalgo_stageful_ranking_v2".to_string(),
        input_candidates: input.input_candidates,
        hydrated_candidates: input.hydrated_candidates.len(),
        filtered_candidates: input.filtered_candidates.len(),
        scored_candidates: input.scored_candidates.len(),
        ml_eligible_candidates,
        ml_ranked_candidates,
        weighted_candidates,
        stage_timings,
        filter_drop_counts: input.filter_drop_counts.clone(),
        degraded_reasons,
    }
}

pub(super) fn build_online_eval(
    candidates: &[RecommendationCandidatePayload],
) -> RecommendationOnlineEvaluationPayload {
    let selected_count = candidates.len();
    let scores = candidates
        .iter()
        .filter_map(trace_score)
        .collect::<Vec<_>>();
    let average_score = average(&scores);
    let score_stddev = if scores.len() <= 1 {
        0.0
    } else {
        let variance = scores
            .iter()
            .map(|score| {
                let delta = score - average_score;
                delta * delta
            })
            .sum::<f64>()
            / scores.len() as f64;
        variance.sqrt()
    };
    let unique_authors = candidates
        .iter()
        .map(|candidate| candidate.author_id.clone())
        .collect::<HashSet<_>>();
    let source_counts = count_by(candidates, |candidate| {
        candidate
            .recall_source
            .clone()
            .unwrap_or_else(|| "unknown".to_string())
    });
    let lane_counts = count_by(candidates, |candidate| {
        candidate
            .retrieval_lane
            .clone()
            .unwrap_or_else(|| "unknown".to_string())
    });
    let pool_counts = count_by(candidates, |candidate| {
        candidate
            .selection_pool
            .clone()
            .unwrap_or_else(|| "unknown".to_string())
    });
    let trend_count = candidates
        .iter()
        .filter(|candidate| online_is_trend(candidate))
        .count();
    let news_count = candidates
        .iter()
        .filter(|candidate| candidate.is_news == Some(true))
        .count();
    let exploration_count = candidates
        .iter()
        .filter(|candidate| {
            candidate.selection_pool.as_deref() == Some(SELECTION_POOL_EXPLORATION)
                || score_breakdown_value(candidate, EXPLORATION_ELIGIBLE_FIELD) >= 0.5
        })
        .count();
    let negative_values = candidates
        .iter()
        .map(|candidate| {
            score_breakdown_value(candidate, NEGATIVE_FEEDBACK_STRENGTH_FIELD)
                .max(score_breakdown_value(
                    candidate,
                    INTEREST_DECAY_NEGATIVE_PRESSURE_FIELD,
                ))
                .max(score_breakdown_value(
                    candidate,
                    FATIGUE_NEGATIVE_FEEDBACK_FIELD,
                ))
        })
        .collect::<Vec<_>>();

    RecommendationOnlineEvaluationPayload {
        selected_count,
        average_score,
        score_stddev,
        unique_author_ratio: ratio(unique_authors.len(), selected_count),
        source_entropy: entropy(&source_counts, selected_count),
        lane_entropy: entropy(&lane_counts, selected_count),
        pool_entropy: entropy(&pool_counts, selected_count),
        trend_count,
        news_count,
        exploration_count,
        negative_pressure_average: average(&negative_values),
        source_counts,
        lane_counts,
        pool_counts,
    }
}

fn count_by<F>(
    candidates: &[RecommendationCandidatePayload],
    mut key_fn: F,
) -> HashMap<String, usize>
where
    F: FnMut(&RecommendationCandidatePayload) -> String,
{
    let mut counts = HashMap::new();
    for candidate in candidates {
        *counts.entry(key_fn(candidate)).or_insert(0) += 1;
    }
    counts
}

fn entropy(counts: &HashMap<String, usize>, total: usize) -> f64 {
    if total == 0 || counts.len() <= 1 {
        return 0.0;
    }
    counts
        .values()
        .map(|count| {
            let probability = *count as f64 / total as f64;
            -probability * probability.log2()
        })
        .sum()
}

fn online_is_trend(candidate: &RecommendationCandidatePayload) -> bool {
    score_breakdown_value(candidate, TREND_PERSONALIZATION_STRENGTH_FIELD) >= 0.08
        || score_breakdown_value(candidate, TREND_AFFINITY_STRENGTH_FIELD) >= 0.14
}

fn score_breakdown_value(candidate: &RecommendationCandidatePayload, key: &str) -> f64 {
    candidate
        .score_breakdown
        .as_ref()
        .and_then(|breakdown| breakdown.get(key))
        .copied()
        .filter(|value| value.is_finite())
        .unwrap_or_default()
}

fn trace_score(candidate: &RecommendationCandidatePayload) -> Option<f64> {
    finite(candidate.score)
        .or_else(|| finite(candidate.weighted_score))
        .or_else(|| finite(candidate.pipeline_score))
}

fn finite(value: Option<f64>) -> Option<f64> {
    value.filter(|score| score.is_finite())
}

fn average(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values.iter().sum::<f64>() / values.len() as f64
}

fn ratio(numerator: usize, denominator: usize) -> f64 {
    if denominator == 0 {
        return 0.0;
    }
    numerator as f64 / denominator as f64
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use chrono::Utc;
    use serde_json::json;
    use telegram_pipeline_primitives::PIPELINE_STAGE_DETAIL_ERROR_FIELD;

    use crate::contracts::{
        CandidateNewsMetadataPayload, RecommendationCandidatePayload, RecommendationStagePayload,
    };

    use super::{RankingSummaryInput, build_ranking_summary};

    #[test]
    fn builds_stageful_ranking_summary_and_ml_degradation() {
        let hydrated = vec![candidate("1"), candidate("2")];
        let filtered = hydrated.clone();
        let scored = vec![hydrated[0].clone()];
        let drop_counts = HashMap::from([("MutedKeywordFilter".to_string(), 1)]);
        let stages = [
            RecommendationStagePayload {
                name: "AuthorInfoHydrator".to_string(),
                enabled: true,
                duration_ms: 5,
                input_count: 2,
                output_count: 2,
                removed_count: None,
                detail: None,
            },
            RecommendationStagePayload {
                name: "PhoenixScorer".to_string(),
                enabled: true,
                duration_ms: 9,
                input_count: 2,
                output_count: 2,
                removed_count: None,
                detail: Some(HashMap::from([(
                    PIPELINE_STAGE_DETAIL_ERROR_FIELD.to_string(),
                    json!("remote_timeout"),
                )])),
            },
        ];

        let summary = build_ranking_summary(RankingSummaryInput {
            input_candidates: 2,
            hydrated_candidates: &hydrated,
            filtered_candidates: &filtered,
            scored_candidates: &scored,
            filter_drop_counts: &drop_counts,
            hydrate_stages: &stages[..1],
            filter_stages: &[],
            score_stages: &stages[1..],
        });

        assert_eq!(summary.stage, "xalgo_stageful_ranking_v2");
        assert_eq!(summary.input_candidates, 2);
        assert_eq!(summary.hydrated_candidates, 2);
        assert_eq!(summary.filtered_candidates, 2);
        assert_eq!(summary.scored_candidates, 1);
        assert_eq!(summary.ml_eligible_candidates, 2);
        assert_eq!(summary.ml_ranked_candidates, 0);
        assert_eq!(summary.weighted_candidates, 0);
        assert_eq!(
            summary.filter_drop_counts.get("MutedKeywordFilter"),
            Some(&1)
        );
        assert!(
            summary
                .degraded_reasons
                .contains(&"ranking:PhoenixScorer:remote_timeout".to_string())
        );
        assert!(
            summary
                .degraded_reasons
                .contains(&"ranking:PhoenixScorer:empty_ml_ranking".to_string())
        );
    }

    fn candidate(post_id: &str) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: post_id.to_string(),
            model_post_id: None,
            author_id: "author-1".to_string(),
            content: "content".to_string(),
            created_at: Utc::now(),
            conversation_id: None,
            is_reply: false,
            reply_to_post_id: None,
            is_repost: false,
            original_post_id: None,
            in_network: Some(false),
            recall_source: Some("NewsAnnSource".to_string()),
            retrieval_lane: None,
            interest_pool_kind: None,
            topic_ids: Vec::new(),
            secondary_recall_sources: None,
            has_video: None,
            has_image: None,
            video_duration_sec: None,
            has_media: false,
            media_type: crate::contracts::MediaType::None,
            video_duration_ms: None,
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
            weighted_score: None,
            score: None,
            is_liked_by_user: None,
            is_reposted_by_user: None,
            is_nsfw: None,
            vf_result: None,
            is_news: Some(true),
            news_metadata: Some(CandidateNewsMetadataPayload {
                external_id: Some(format!("ext-{post_id}")),
                ..CandidateNewsMetadataPayload::default()
            }),
            is_pinned: None,
            is_subscription_only: None,
            score_breakdown: None,
            pipeline_score: None,
            graph_score: None,
            graph_path: None,
            graph_recall_type: None,
            post_type: None,
            mutual_follow_jaccard: None,
            following_replied: None,
        }
    }
}
