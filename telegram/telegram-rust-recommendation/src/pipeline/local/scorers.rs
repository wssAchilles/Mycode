use std::collections::HashMap;

use chrono::Utc;
use reqwest::Url;
use serde_json::Value;

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};

use super::context::{source_mixing_multiplier, space_feed_experiment_flag};

const LOCAL_EXECUTION_MODE: &str = "rust_local_scorers_v1";
const MIN_VIDEO_DURATION_SEC: f64 = 5.0;
const OON_WEIGHT_FACTOR: f64 = 0.7;

pub struct LocalScoringExecution {
    pub candidates: Vec<RecommendationCandidatePayload>,
    pub stages: Vec<RecommendationStagePayload>,
}

pub fn run_local_scorers(
    query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> LocalScoringExecution {
    let mut current = candidates;
    let mut stages = Vec::new();

    for scorer in [
        weighted_scorer as ScorerFn,
        score_calibration_scorer,
        content_quality_scorer,
        author_affinity_scorer,
        recency_scorer,
        author_diversity_scorer,
        oon_scorer,
    ] {
        let (next, stage) = scorer(query, current);
        current = next;
        stages.push(stage);
    }

    LocalScoringExecution {
        candidates: current,
        stages,
    }
}

type ScorerFn = fn(
    &RecommendationQueryPayload,
    Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
);

fn weighted_scorer(
    _query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    for candidate in &mut candidates {
        let raw = compute_weighted_score(candidate);
        let normalized = (raw + 0.1).max(0.0);
        candidate.weighted_score = Some(normalized);
        candidate.pipeline_score = Some(normalized);
        merge_breakdown(candidate, "rawWeightedScore", raw);
        merge_breakdown(candidate, "normalizedWeightedScore", normalized);
    }
    (
        candidates,
        build_stage("WeightedScorer", input_count, true, None),
    )
}

fn score_calibration_scorer(
    query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let enabled = space_feed_experiment_flag(query, "enable_score_calibration_scorer", true);
    if !enabled {
        return (
            candidates,
            build_stage("ScoreCalibrationScorer", input_count, false, None),
        );
    }

    for candidate in &mut candidates {
        let current = candidate.weighted_score.unwrap_or_default();
        let source_multiplier =
            source_mixing_multiplier(query, candidate.recall_source.as_deref().unwrap_or(""));
        let quality_multiplier = match query.embedding_context.as_ref() {
            None => 0.97,
            Some(context) if !context.usable => 0.95,
            Some(context) => 0.96 + clamp01(context.quality_score.unwrap_or_default()) * 0.08,
        };
        let freshness_multiplier = freshness_multiplier(candidate);
        let engagement_multiplier = engagement_multiplier(candidate);
        let user_state_multiplier = match query
            .user_state_context
            .as_ref()
            .map(|state| state.state.as_str())
        {
            Some("cold_start") => 0.97,
            Some("sparse") => 0.99,
            Some("heavy") => 1.02,
            _ => 1.0,
        };
        let adjusted = current
            * source_multiplier
            * quality_multiplier
            * freshness_multiplier
            * engagement_multiplier
            * user_state_multiplier;
        candidate.weighted_score = Some(adjusted);
        candidate.pipeline_score = Some(adjusted);
        merge_breakdown(candidate, "calibrationSourceMultiplier", source_multiplier);
        merge_breakdown(
            candidate,
            "calibrationEmbeddingQualityMultiplier",
            quality_multiplier,
        );
        merge_breakdown(
            candidate,
            "calibrationFreshnessMultiplier",
            freshness_multiplier,
        );
        merge_breakdown(
            candidate,
            "calibrationEngagementMultiplier",
            engagement_multiplier,
        );
        merge_breakdown(
            candidate,
            "calibrationUserStateMultiplier",
            user_state_multiplier,
        );
    }

    (
        candidates,
        build_stage("ScoreCalibrationScorer", input_count, true, None),
    )
}

fn content_quality_scorer(
    query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let enabled = space_feed_experiment_flag(query, "enable_content_quality_scorer", false);
    if !enabled {
        return (
            candidates,
            build_stage("ContentQualityScorer", input_count, false, None),
        );
    }

    for candidate in &mut candidates {
        let quality = compute_content_quality(candidate);
        let adjusted = candidate.weighted_score.unwrap_or_default() * (0.8 + quality * 0.4);
        candidate.weighted_score = Some(adjusted);
        candidate.pipeline_score = Some(adjusted);
        merge_breakdown(candidate, "contentQuality", quality);
    }

    (
        candidates,
        build_stage("ContentQualityScorer", input_count, true, None),
    )
}

fn author_affinity_scorer(
    query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let enabled = space_feed_experiment_flag(query, "enable_author_affinity_scorer", false)
        && query
            .user_action_sequence
            .as_ref()
            .is_some_and(|actions| !actions.is_empty());
    if !enabled {
        return (
            candidates,
            build_stage("AuthorAffinityScorer", input_count, false, None),
        );
    }

    let author_affinities = compute_author_affinities(query);
    for candidate in &mut candidates {
        let affinity = author_affinities
            .get(&candidate.author_id)
            .copied()
            .unwrap_or_default();
        let mut boost = 0.0;
        if affinity > 0.0 {
            boost = 0.1 + affinity * 0.5;
            if affinity >= 0.5 {
                boost += 0.3;
            }
        }
        let adjusted = candidate.weighted_score.unwrap_or_default() * (1.0 + boost);
        candidate.author_affinity_score = Some(affinity);
        candidate.weighted_score = Some(adjusted);
        candidate.pipeline_score = Some(adjusted);
        merge_breakdown(candidate, "authorAffinity", affinity);
        merge_breakdown(candidate, "affinityBoost", boost);
    }

    (
        candidates,
        build_stage("AuthorAffinityScorer", input_count, true, None),
    )
}

fn recency_scorer(
    query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let enabled = space_feed_experiment_flag(query, "enable_recency_scorer", false);
    if !enabled {
        return (
            candidates,
            build_stage("RecencyScorer", input_count, false, None),
        );
    }

    let half_life_ms = 6.0 * 60.0 * 60.0 * 1000.0;
    let now = Utc::now();
    for candidate in &mut candidates {
        let age_ms = now
            .signed_duration_since(candidate.created_at)
            .num_milliseconds()
            .max(0) as f64;
        let decay_factor = 0.5_f64.powf(age_ms / half_life_ms);
        let multiplier = 0.8 + (1.5 - 0.8) * decay_factor;
        let adjusted = candidate.weighted_score.unwrap_or_default() * multiplier;
        candidate.weighted_score = Some(adjusted);
        candidate.pipeline_score = Some(adjusted);
        merge_breakdown(candidate, "recencyMultiplier", multiplier);
        merge_breakdown(candidate, "ageHours", age_ms / (60.0 * 60.0 * 1000.0));
    }

    (
        candidates,
        build_stage("RecencyScorer", input_count, true, None),
    )
}

fn author_diversity_scorer(
    _query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let mut next = candidates;
    let mut ordered = next
        .iter()
        .enumerate()
        .map(|(index, candidate)| (index, candidate.weighted_score.unwrap_or_default()))
        .collect::<Vec<_>>();
    ordered.sort_by(|left, right| {
        right
            .1
            .partial_cmp(&left.1)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut key_counts = HashMap::<String, usize>::new();
    for (index, _) in ordered {
        let diversity_key = diversity_key(&next[index]);
        let position = key_counts.get(&diversity_key).copied().unwrap_or_default();
        key_counts.insert(diversity_key, position + 1);
        let multiplier = (1.0 - 0.3) * 0.8_f64.powi(position as i32) + 0.3;
        let adjusted = next[index].weighted_score.unwrap_or_default() * multiplier;
        next[index].score = Some(adjusted);
        next[index].pipeline_score = Some(adjusted);
        merge_breakdown(&mut next[index], "diversityMultiplier", multiplier);
    }

    (
        next,
        build_stage("AuthorDiversityScorer", input_count, true, None),
    )
}

fn oon_scorer(
    _query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    for candidate in &mut candidates {
        let base = candidate
            .score
            .or(candidate.weighted_score)
            .unwrap_or_default();
        let factor = if candidate.in_network == Some(false) {
            OON_WEIGHT_FACTOR
        } else {
            1.0
        };
        let adjusted = base * factor;
        candidate.score = Some(adjusted);
        candidate.pipeline_score = Some(adjusted);
        merge_breakdown(candidate, "baseScore", base);
        merge_breakdown(candidate, "oonFactor", factor);
    }
    (
        candidates,
        build_stage("OutOfNetworkScorer", input_count, true, None),
    )
}

fn compute_weighted_score(candidate: &RecommendationCandidatePayload) -> f64 {
    let Some(scores) = candidate.phoenix_scores.as_ref() else {
        return 0.0;
    };

    let video_quality_weight =
        if candidate.video_duration_sec.unwrap_or_default() > MIN_VIDEO_DURATION_SEC {
            3.0
        } else {
            0.0
        };

    let not_interested = scores
        .not_interested_score
        .or(scores.dismiss_score)
        .unwrap_or_default();
    let block_author = scores
        .block_author_score
        .or(scores.block_score)
        .unwrap_or_default();

    scores.like_score.unwrap_or_default() * 2.0
        + scores.reply_score.unwrap_or_default() * 5.0
        + scores.repost_score.unwrap_or_default() * 4.0
        + scores.quote_score.unwrap_or_default() * 4.5
        + scores.photo_expand_score.unwrap_or_default() * 1.0
        + scores.click_score.unwrap_or_default() * 0.5
        + scores.quoted_click_score.unwrap_or_default() * 0.8
        + scores.profile_click_score.unwrap_or_default() * 1.0
        + scores.video_quality_view_score.unwrap_or_default() * video_quality_weight
        + scores.share_score.unwrap_or_default() * 2.5
        + scores.share_via_dm_score.unwrap_or_default() * 2.0
        + scores.share_via_copy_link_score.unwrap_or_default() * 1.5
        + scores.dwell_score.unwrap_or_default() * 0.3
        + scores.dwell_time.unwrap_or_default() * 0.05
        + scores.follow_author_score.unwrap_or_default() * 2.0
        + not_interested * -5.0
        + block_author * -10.0
        + scores.mute_author_score.unwrap_or_default() * -4.0
        + scores.report_score.unwrap_or_default() * -8.0
}

fn freshness_multiplier(candidate: &RecommendationCandidatePayload) -> f64 {
    let age_hours = Utc::now()
        .signed_duration_since(candidate.created_at)
        .num_hours()
        .max(0);
    match age_hours {
        0..=24 => 1.04,
        25..=72 => 1.02,
        73..=168 => 1.0,
        169..=720 => 0.97,
        _ => 0.94,
    }
}

fn engagement_multiplier(candidate: &RecommendationCandidatePayload) -> f64 {
    let engagements = candidate.like_count.unwrap_or_default()
        + candidate.comment_count.unwrap_or_default() * 2.0
        + candidate.repost_count.unwrap_or_default() * 3.0;
    if engagements >= 60.0 {
        1.05
    } else if engagements >= 20.0 {
        1.02
    } else if engagements >= 5.0 {
        1.0
    } else {
        0.97
    }
}

fn compute_content_quality(candidate: &RecommendationCandidatePayload) -> f64 {
    let mut score = 0.0;
    let content_length = candidate.content.chars().count();
    let length_score = if content_length < 10 {
        0.3
    } else if content_length <= 280 {
        0.8 + content_length as f64 / 280.0 * 0.2
    } else if content_length <= 1_000 {
        0.9
    } else {
        0.7
    };
    score += length_score * 0.3;

    let media_score = (candidate.has_image == Some(true)) as i32 as f64 * 0.1
        + (candidate.has_video == Some(true)) as i32 as f64 * 0.15;
    score += media_score.min(0.2) * 0.2 / 0.2;

    let views = candidate.view_count.unwrap_or(1.0).max(1.0);
    let engagements = candidate.like_count.unwrap_or_default()
        + candidate.comment_count.unwrap_or_default() * 2.0
        + candidate.repost_count.unwrap_or_default() * 3.0;
    let engagement_score = (engagements / views / 0.1).min(1.0);
    score += engagement_score * 0.5;
    score.min(1.0)
}

fn compute_author_affinities(query: &RecommendationQueryPayload) -> HashMap<String, f64> {
    let now = Utc::now();
    let mut affinities = HashMap::<String, f64>::new();
    for action in query.user_action_sequence.as_ref().into_iter().flatten() {
        let Some(author_id) = action
            .get("targetAuthorId")
            .or_else(|| action.get("target_author_id"))
            .and_then(Value::as_str)
        else {
            continue;
        };
        let weight = match action
            .get("action")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "like" => 1.0,
            "reply" => 3.0,
            "repost" => 2.0,
            "quote" => 2.5,
            "click" => 0.3,
            "profile_click" => 1.5,
            "share" => 2.0,
            _ => 0.5,
        };
        let age_days = action
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
            .map(|timestamp| {
                now.signed_duration_since(timestamp.with_timezone(&Utc))
                    .num_seconds()
                    .max(0) as f64
                    / 86_400.0
            })
            .unwrap_or_default();
        let contribution = weight * 0.95_f64.powf(age_days);
        *affinities.entry(author_id.to_string()).or_insert(0.0) += contribution;
    }

    for affinity in affinities.values_mut() {
        *affinity = (*affinity / 10.0).min(1.0);
    }
    affinities
}

fn diversity_key(candidate: &RecommendationCandidatePayload) -> String {
    if candidate.is_news == Some(true) {
        if let Some(url) = candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.source_url.clone().or(metadata.url.clone()))
        {
            if let Ok(parsed) = Url::parse(&url) {
                if parsed.scheme() == "http" || parsed.scheme() == "https" {
                    if let Some(host) = parsed.host_str() {
                        return format!("news:domain:{host}");
                    }
                }
            }
        }
        if let Some(cluster_id) = candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.cluster_id)
        {
            return format!("news:cluster:{cluster_id}");
        }
        if let Some(source) = candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.source.clone())
        {
            return format!("news:source:{source}");
        }
        return format!("news:author:{}", candidate.author_id);
    }

    format!("author:{}", candidate.author_id)
}

fn merge_breakdown(candidate: &mut RecommendationCandidatePayload, key: &str, value: f64) {
    if !value.is_finite() {
        return;
    }
    let breakdown = candidate.score_breakdown.get_or_insert_with(HashMap::new);
    breakdown.insert(key.to_string(), value);
}

fn clamp01(value: f64) -> f64 {
    value.max(0.0).min(1.0)
}

fn build_stage(
    name: &str,
    input_count: usize,
    enabled: bool,
    detail: Option<HashMap<String, Value>>,
) -> RecommendationStagePayload {
    let mut detail = detail.unwrap_or_default();
    detail.insert(
        "executionMode".to_string(),
        Value::String(LOCAL_EXECUTION_MODE.to_string()),
    );
    detail.insert("owner".to_string(), Value::String("rust".to_string()));

    RecommendationStagePayload {
        name: name.to_string(),
        enabled,
        duration_ms: 0,
        input_count,
        output_count: input_count,
        removed_count: Some(0),
        detail: Some(detail),
    }
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};
    use serde_json::json;
    use std::collections::HashMap;

    use crate::contracts::{
        CandidateNewsMetadataPayload, EmbeddingContextPayload, PhoenixScoresPayload,
        RecommendationCandidatePayload, RecommendationQueryPayload, UserStateContextPayload,
    };

    use super::run_local_scorers;

    fn query() -> RecommendationQueryPayload {
        RecommendationQueryPayload {
            request_id: "req-local-scorers".to_string(),
            user_id: "viewer-1".to_string(),
            limit: 20,
            cursor: None,
            in_network_only: false,
            seen_ids: Vec::new(),
            served_ids: Vec::new(),
            is_bottom_request: false,
            client_app_id: None,
            country_code: None,
            language_code: None,
            user_features: None,
            embedding_context: Some(EmbeddingContextPayload {
                quality_score: Some(0.9),
                usable: true,
                ..EmbeddingContextPayload::default()
            }),
            user_state_context: Some(UserStateContextPayload {
                state: "warm".to_string(),
                reason: "test".to_string(),
                followed_count: 3,
                recent_action_count: 4,
                recent_positive_action_count: 2,
                usable_embedding: true,
                account_age_days: Some(20),
            }),
            user_action_sequence: Some(vec![HashMap::from([
                ("action".to_string(), json!("reply")),
                ("targetAuthorId".to_string(), json!("author-a")),
                ("timestamp".to_string(), json!("2026-04-20T00:00:00Z")),
            ])]),
            news_history_external_ids: None,
            model_user_action_sequence: None,
            experiment_context: None,
        }
    }

    fn candidate(post_id: &str, author_id: &str) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: post_id.to_string(),
            model_post_id: Some(post_id.to_string()),
            author_id: author_id.to_string(),
            content: "a reasonably long content body for quality scoring".to_string(),
            created_at: Utc.with_ymd_and_hms(2026, 4, 20, 0, 0, 0).unwrap(),
            conversation_id: None,
            is_reply: false,
            reply_to_post_id: None,
            is_repost: false,
            original_post_id: None,
            in_network: Some(false),
            recall_source: Some("GraphSource".to_string()),
            has_video: Some(true),
            has_image: Some(true),
            video_duration_sec: Some(12.0),
            media: None,
            like_count: Some(12.0),
            comment_count: Some(4.0),
            repost_count: Some(2.0),
            view_count: Some(100.0),
            author_username: None,
            author_avatar_url: None,
            author_affinity_score: None,
            phoenix_scores: Some(PhoenixScoresPayload {
                like_score: Some(0.2),
                reply_score: Some(0.1),
                repost_score: Some(0.05),
                click_score: Some(0.3),
                follow_author_score: Some(0.1),
                ..Default::default()
            }),
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
        }
    }

    #[test]
    fn local_scorers_compute_weighted_and_final_scores() {
        let mut query = query();
        query.experiment_context = Some(crate::contracts::ExperimentContextPayload {
            user_id: "viewer-1".to_string(),
            assignments: vec![crate::contracts::ExperimentAssignmentPayload {
                experiment_id: std::env::var("SPACE_FEED_EXPERIMENT_ID")
                    .unwrap_or_else(|_| "space_feed_recsys".to_string()),
                experiment_name: "space".to_string(),
                bucket: "treatment".to_string(),
                config: HashMap::from([
                    ("enable_score_calibration_scorer".to_string(), json!(true)),
                    ("enable_content_quality_scorer".to_string(), json!(true)),
                    ("enable_author_affinity_scorer".to_string(), json!(true)),
                    ("enable_recency_scorer".to_string(), json!(true)),
                ]),
                in_experiment: true,
            }],
        });

        let mut second = candidate("post-2", "author-b");
        second.is_news = Some(true);
        second.news_metadata = Some(CandidateNewsMetadataPayload {
            source_url: Some("https://example.com/news".to_string()),
            ..CandidateNewsMetadataPayload::default()
        });

        let result = run_local_scorers(&query, vec![candidate("post-1", "author-a"), second]);
        assert_eq!(result.stages.len(), 7);
        assert!(result.candidates[0].weighted_score.unwrap_or_default() > 0.0);
        assert!(result.candidates[0].score.unwrap_or_default() > 0.0);
        assert!(
            result.candidates[0]
                .score_breakdown
                .as_ref()
                .is_some_and(|breakdown| breakdown.contains_key("normalizedWeightedScore"))
        );
        assert!(
            result.candidates[0]
                .score_breakdown
                .as_ref()
                .is_some_and(|breakdown| breakdown.contains_key("authorAffinity"))
        );
        assert!(
            result.candidates[1]
                .score_breakdown
                .as_ref()
                .is_some_and(|breakdown| breakdown.contains_key("oonFactor"))
        );
    }
}
