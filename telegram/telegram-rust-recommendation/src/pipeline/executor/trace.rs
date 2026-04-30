use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload,
    RecommendationTraceCandidatePayload, RecommendationTraceFreshnessPayload,
    RecommendationTracePayload, RecommendationTraceReplayPoolPayload,
    RecommendationTraceSourceCountPayload,
};
use crate::pipeline::local::context::ranking_policy_strategy_version;

const TRACE_VERSION: &str = "rust_candidate_trace_v1";
const TRACE_SELECTED_CANDIDATE_LIMIT: usize = 60;
const TRACE_REPLAY_POOL_LIMIT: usize = 60;

pub(super) fn build_recommendation_trace(
    query: &RecommendationQueryPayload,
    candidates: &[RecommendationCandidatePayload],
    replay_candidates: &[RecommendationCandidatePayload],
    pipeline_version: &str,
    owner: &str,
    fallback_mode: &str,
    serve_cache_hit: bool,
) -> RecommendationTracePayload {
    let selected_count = candidates.len();
    let in_network_count = candidates
        .iter()
        .filter(|candidate| candidate.in_network == Some(true))
        .count();
    let reply_count = candidates
        .iter()
        .filter(|candidate| candidate.is_reply)
        .count();
    let unique_authors = candidates
        .iter()
        .map(|candidate| candidate.author_id.clone())
        .collect::<HashSet<_>>();
    let scores = candidates
        .iter()
        .filter_map(trace_score)
        .collect::<Vec<_>>();

    let replay_pool = trace_replay_pool(replay_candidates);
    let selected_fingerprint = trace_candidate_fingerprint(candidates);
    let replay_pool_fingerprint = replay_pool.fingerprint.clone();

    RecommendationTracePayload {
        trace_version: TRACE_VERSION.to_string(),
        trace_mode: "live_trace".to_string(),
        request_id: query.request_id.clone(),
        pipeline_version: pipeline_version.to_string(),
        strategy_version: ranking_policy_strategy_version(query).to_string(),
        selected_fingerprint,
        replay_pool_fingerprint,
        owner: owner.to_string(),
        fallback_mode: fallback_mode.to_string(),
        selected_count,
        in_network_count,
        out_of_network_count: selected_count.saturating_sub(in_network_count),
        source_counts: trace_selected_source_counts(candidates),
        author_diversity: ratio(unique_authors.len(), selected_count),
        reply_ratio: ratio(reply_count, selected_count),
        average_score: average(&scores),
        top_score: scores.iter().copied().reduce(f64::max),
        bottom_score: scores.iter().copied().reduce(f64::min),
        freshness: trace_freshness(candidates),
        candidates: candidates
            .iter()
            .take(TRACE_SELECTED_CANDIDATE_LIMIT)
            .enumerate()
            .map(|(index, candidate)| trace_candidate(candidate, index + 1))
            .collect(),
        experiment_keys: trace_experiment_keys(query),
        user_state: query
            .user_state_context
            .as_ref()
            .map(|context| context.state.clone()),
        embedding_quality_score: query
            .embedding_context
            .as_ref()
            .and_then(|context| finite(context.quality_score)),
        replay_pool: Some(replay_pool),
        serve_cache_hit,
    }
}

fn trace_replay_pool(
    replay_candidates: &[RecommendationCandidatePayload],
) -> RecommendationTraceReplayPoolPayload {
    let total_count = replay_candidates.len();
    let mut ordered = replay_candidates.iter().collect::<Vec<_>>();
    ordered.sort_by(|left, right| {
        let right_score = trace_score(right).unwrap_or(f64::NEG_INFINITY);
        let left_score = trace_score(left).unwrap_or(f64::NEG_INFINITY);
        right_score
            .partial_cmp(&left_score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.post_id.cmp(&right.post_id))
    });

    RecommendationTraceReplayPoolPayload {
        pool_kind: "pre_selector_scored_topk_v1".to_string(),
        total_count,
        truncated: total_count > TRACE_REPLAY_POOL_LIMIT,
        fingerprint: trace_candidate_fingerprint(replay_candidates),
        candidates: ordered
            .into_iter()
            .take(TRACE_REPLAY_POOL_LIMIT)
            .enumerate()
            .map(|(index, candidate)| trace_candidate(candidate, index + 1))
            .collect(),
    }
}

fn trace_candidate_fingerprint(candidates: &[RecommendationCandidatePayload]) -> String {
    let mut hasher = DefaultHasher::new();
    candidates.len().hash(&mut hasher);
    for candidate in candidates {
        candidate.post_id.hash(&mut hasher);
        candidate.model_post_id.hash(&mut hasher);
        candidate.author_id.hash(&mut hasher);
        candidate.recall_source.hash(&mut hasher);
        candidate.selection_pool.hash(&mut hasher);
        candidate.selection_reason.hash(&mut hasher);
        quantized_score(trace_score(candidate)).hash(&mut hasher);
        quantized_score(candidate.weighted_score).hash(&mut hasher);
        quantized_score(candidate.pipeline_score).hash(&mut hasher);
    }
    format!("{:016x}", hasher.finish())
}

fn quantized_score(score: Option<f64>) -> i64 {
    score
        .filter(|value| value.is_finite())
        .map(|value| (value * 1_000_000.0).round() as i64)
        .unwrap_or_default()
}

fn trace_selected_source_counts(
    candidates: &[RecommendationCandidatePayload],
) -> Vec<RecommendationTraceSourceCountPayload> {
    let mut source_counts = HashMap::new();
    for candidate in candidates {
        let source = candidate
            .recall_source
            .clone()
            .unwrap_or_else(|| "unknown".to_string());
        *source_counts.entry(source).or_insert(0) += 1;
    }
    let mut counts = source_counts
        .into_iter()
        .map(|(source, count)| RecommendationTraceSourceCountPayload { source, count })
        .collect::<Vec<_>>();
    counts.sort_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then_with(|| left.source.cmp(&right.source))
    });
    counts
}

fn trace_candidate(
    candidate: &RecommendationCandidatePayload,
    rank: usize,
) -> RecommendationTraceCandidatePayload {
    RecommendationTraceCandidatePayload {
        post_id: candidate.post_id.clone(),
        model_post_id: candidate.model_post_id.clone().or_else(|| {
            candidate
                .news_metadata
                .as_ref()
                .and_then(|metadata| metadata.external_id.clone())
        }),
        author_id: candidate.author_id.clone(),
        rank,
        recall_source: candidate
            .recall_source
            .clone()
            .unwrap_or_else(|| "unknown".to_string()),
        in_network: candidate.in_network == Some(true),
        is_news: candidate.is_news == Some(true),
        score: trace_score(candidate),
        weighted_score: finite(candidate.weighted_score),
        pipeline_score: finite(candidate.pipeline_score),
        score_breakdown: finite_score_breakdown(&candidate.score_breakdown),
        created_at: candidate.created_at,
    }
}

fn trace_score(candidate: &RecommendationCandidatePayload) -> Option<f64> {
    finite(candidate.score)
        .or_else(|| finite(candidate.weighted_score))
        .or_else(|| finite(candidate.pipeline_score))
}

fn finite_score_breakdown(value: &Option<HashMap<String, f64>>) -> Option<HashMap<String, f64>> {
    let entries = value
        .as_ref()?
        .iter()
        .filter_map(|(key, score)| finite(Some(*score)).map(|score| (key.clone(), score)))
        .collect::<HashMap<_, _>>();
    if entries.is_empty() {
        None
    } else {
        Some(entries)
    }
}

fn trace_freshness(
    candidates: &[RecommendationCandidatePayload],
) -> RecommendationTraceFreshnessPayload {
    let Some(newest) = candidates
        .iter()
        .map(|candidate| candidate.created_at)
        .max()
    else {
        return RecommendationTraceFreshnessPayload::default();
    };
    let Some(oldest) = candidates
        .iter()
        .map(|candidate| candidate.created_at)
        .min()
    else {
        return RecommendationTraceFreshnessPayload::default();
    };
    let now = chrono::Utc::now();
    RecommendationTraceFreshnessPayload {
        newest_age_seconds: Some(non_negative_seconds(now - newest)),
        oldest_age_seconds: Some(non_negative_seconds(now - oldest)),
        time_range_seconds: Some(non_negative_seconds(newest - oldest)),
    }
}

fn trace_experiment_keys(query: &RecommendationQueryPayload) -> Vec<String> {
    query
        .experiment_context
        .as_ref()
        .map(|context| {
            context
                .assignments
                .iter()
                .filter(|assignment| assignment.in_experiment)
                .map(|assignment| format!("{}:{}", assignment.experiment_id, assignment.bucket))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
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

fn non_negative_seconds(duration: chrono::Duration) -> u64 {
    duration.num_seconds().max(0) as u64
}
