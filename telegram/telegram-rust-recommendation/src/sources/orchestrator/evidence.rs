use std::collections::HashMap;

use crate::contracts::{RecallEvidencePayload, RecommendationCandidatePayload};
use crate::pipeline::local::context::source_retrieval_lane;

use super::policy::clamp01;

#[derive(Debug, Clone, Copy, Default)]
pub(super) struct RecallEvidenceMergeStats {
    pub secondary_count: usize,
    pub cross_lane_count: usize,
}

pub(super) fn annotate_candidate_recall_evidence(
    candidate: &mut RecommendationCandidatePayload,
) -> RecallEvidenceMergeStats {
    let secondary_count = candidate
        .secondary_recall_sources
        .as_ref()
        .map(|sources| sources.len())
        .unwrap_or(0);
    let primary_lane = candidate
        .retrieval_lane
        .as_deref()
        .unwrap_or_else(|| source_retrieval_lane(candidate.recall_source.as_deref().unwrap_or("")));
    let (same_lane_count, cross_lane_count) =
        secondary_lane_counts(primary_lane, candidate.secondary_recall_sources.as_deref());

    if secondary_count > 0 {
        insert_secondary_source_breakdown(
            candidate,
            secondary_count,
            same_lane_count,
            cross_lane_count,
        );
    }

    apply_merged_recall_evidence(
        candidate,
        secondary_count,
        same_lane_count,
        cross_lane_count,
    );

    RecallEvidenceMergeStats {
        secondary_count,
        cross_lane_count,
    }
}

pub(super) fn secondary_lane_counts(
    primary_lane: &str,
    secondary_sources: Option<&[String]>,
) -> (usize, usize) {
    let mut same_lane_count = 0usize;
    let mut cross_lane_count = 0usize;
    for source in secondary_sources.unwrap_or_default() {
        if source_retrieval_lane(source) == primary_lane {
            same_lane_count += 1;
        } else {
            cross_lane_count += 1;
        }
    }
    (same_lane_count, cross_lane_count)
}

fn insert_secondary_source_breakdown(
    candidate: &mut RecommendationCandidatePayload,
    secondary_count: usize,
    same_lane_count: usize,
    cross_lane_count: usize,
) {
    let effective_source_count =
        effective_source_count(secondary_count, same_lane_count, cross_lane_count);
    let source_diversity_score =
        source_diversity_score(secondary_count, same_lane_count, cross_lane_count);
    let cross_lane_bonus = (source_diversity_score * 0.12).min(0.12);
    let multi_source_bonus = ((effective_source_count - 1.0).max(0.0) * 0.04).min(0.14);
    let evidence_confidence =
        (0.48 + effective_source_count * 0.08 + source_diversity_score * 0.14).min(1.0);
    let breakdown = candidate.score_breakdown.get_or_insert_with(HashMap::new);
    breakdown.insert(
        "retrievalSecondarySourceCount".to_string(),
        secondary_count as f64,
    );
    breakdown.insert(
        "retrievalSameLaneSourceCount".to_string(),
        same_lane_count as f64,
    );
    breakdown.insert(
        "retrievalCrossLaneSourceCount".to_string(),
        cross_lane_count as f64,
    );
    breakdown.insert(
        "retrievalEffectiveSourceCount".to_string(),
        effective_source_count,
    );
    breakdown.insert(
        "retrievalSourceDiversityScore".to_string(),
        source_diversity_score,
    );
    breakdown.insert("retrievalCrossLaneBonus".to_string(), cross_lane_bonus);
    breakdown.insert("retrievalMultiSourceBonus".to_string(), multi_source_bonus);
    breakdown.insert(
        "retrievalEvidenceConfidence".to_string(),
        evidence_confidence,
    );
}

fn apply_merged_recall_evidence(
    candidate: &mut RecommendationCandidatePayload,
    secondary_count: usize,
    same_lane_count: usize,
    cross_lane_count: usize,
) {
    let existing = candidate.recall_evidence.clone().unwrap_or_default();
    let primary_source = candidate
        .recall_source
        .clone()
        .or_else(|| existing.primary_source.clone());
    let primary_lane = candidate
        .retrieval_lane
        .clone()
        .or_else(|| existing.primary_lane.clone());
    let source_rank_score = existing.source_rank_score.unwrap_or_default();
    let source_score = existing.source_score.unwrap_or_else(|| {
        candidate
            .score
            .or(candidate.pipeline_score)
            .or(candidate.weighted_score)
            .unwrap_or_default()
    });
    let source_count = 1.0 + secondary_count as f64;
    let effective_source_count =
        effective_source_count(secondary_count, same_lane_count, cross_lane_count);
    let source_diversity_score =
        source_diversity_score(secondary_count, same_lane_count, cross_lane_count);
    let confidence = clamp01(
        existing.confidence.max(0.38)
            + source_rank_score * 0.08
            + normalized_source_score(source_score) * 0.06
            + (effective_source_count - 1.0).max(0.0) * 0.05
            + source_diversity_score * 0.08,
    );

    candidate.recall_evidence = Some(RecallEvidencePayload {
        primary_source,
        primary_lane,
        source_rank: existing.source_rank,
        source_rank_score: existing.source_rank_score,
        source_score: Some(source_score),
        source_count,
        same_lane_source_count: same_lane_count as f64,
        cross_lane_source_count: cross_lane_count as f64,
        confidence,
    });

    let breakdown = candidate.score_breakdown.get_or_insert_with(HashMap::new);
    breakdown.insert("retrievalSourceCount".to_string(), source_count);
    breakdown.insert(
        "retrievalEffectiveSourceCount".to_string(),
        effective_source_count,
    );
    breakdown.insert(
        "retrievalSourceDiversityScore".to_string(),
        source_diversity_score,
    );
    breakdown.insert("retrievalSourceRankScore".to_string(), source_rank_score);
    breakdown.insert("retrievalSourceScore".to_string(), source_score);
    breakdown.insert("retrievalEvidenceConfidence".to_string(), confidence);
}

fn effective_source_count(
    secondary_count: usize,
    same_lane_count: usize,
    cross_lane_count: usize,
) -> f64 {
    (1.0 + same_lane_count.min(2) as f64 * 0.55 + cross_lane_count.min(3) as f64 * 0.9)
        .min(1.0 + secondary_count.min(4) as f64)
}

fn source_diversity_score(
    secondary_count: usize,
    same_lane_count: usize,
    cross_lane_count: usize,
) -> f64 {
    if secondary_count == 0 {
        return 0.0;
    }
    let lane_mix = cross_lane_count as f64 / secondary_count as f64;
    let same_lane_support = same_lane_count.min(2) as f64 * 0.12;
    clamp01(lane_mix * 0.82 + same_lane_support)
}

fn normalized_source_score(value: f64) -> f64 {
    if !value.is_finite() || value <= 0.0 {
        0.0
    } else if value <= 1.0 {
        value
    } else {
        value / (1.0 + value)
    }
}
