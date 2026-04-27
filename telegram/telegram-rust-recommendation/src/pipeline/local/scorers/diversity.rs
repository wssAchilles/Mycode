use std::collections::{HashMap, HashSet};

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};

use super::helpers::{
    breakdown_value, build_stage, candidate_semantic_tokens, diversity_key, jaccard_overlap,
    merge_breakdown, request_source_key, request_topic_key,
};

pub(super) fn intra_request_diversity_scorer(
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

    let mut author_counts = HashMap::<String, usize>::new();
    let mut source_counts = HashMap::<String, usize>::new();
    let mut topic_counts = HashMap::<String, usize>::new();
    let mut seen_token_sets = Vec::<HashSet<String>>::new();

    for (index, _) in ordered {
        let author_repeat = author_counts
            .get(&next[index].author_id)
            .copied()
            .unwrap_or_default();
        let source_key = request_source_key(&next[index]);
        let source_repeat = source_counts.get(&source_key).copied().unwrap_or_default();
        let topic_key = request_topic_key(&next[index]);
        let topic_repeat = topic_counts.get(&topic_key).copied().unwrap_or_default();
        let candidate_tokens = candidate_semantic_tokens(&next[index])
            .into_iter()
            .collect::<HashSet<_>>();
        let semantic_overlap = seen_token_sets
            .iter()
            .map(|seen| jaccard_overlap(&candidate_tokens, seen))
            .fold(0.0, f64::max);
        let trend_protection = breakdown_value(
            next[index].score_breakdown.as_ref(),
            "trendPersonalizationStrength",
        )
        .max(breakdown_value(
            next[index].score_breakdown.as_ref(),
            "trendAffinityStrength",
        )) * 0.32;
        let evidence_protection = breakdown_value(
            next[index].score_breakdown.as_ref(),
            "retrievalEvidenceConfidence",
        ) * 0.08;
        let raw_penalty = (author_repeat as f64 * 0.05)
            + (source_repeat as f64 * 0.026)
            + (topic_repeat as f64 * 0.045)
            + semantic_overlap * 0.12;
        let protection = (trend_protection + evidence_protection).clamp(0.0, 0.38);
        let penalty = (raw_penalty * (1.0 - protection)).clamp(0.0, 0.24);
        let multiplier = 1.0 - penalty;
        let adjusted = next[index].weighted_score.unwrap_or_default() * multiplier;
        next[index].weighted_score = Some(adjusted);
        next[index].pipeline_score = Some(adjusted);
        merge_breakdown(&mut next[index], "intraRequestRedundancyPenalty", penalty);
        merge_breakdown(
            &mut next[index],
            "intraRequestSemanticOverlap",
            semantic_overlap,
        );
        merge_breakdown(
            &mut next[index],
            "intraRequestAuthorRepeat",
            author_repeat as f64,
        );
        merge_breakdown(
            &mut next[index],
            "intraRequestSourceRepeat",
            source_repeat as f64,
        );
        merge_breakdown(
            &mut next[index],
            "intraRequestTopicRepeat",
            topic_repeat as f64,
        );
        merge_breakdown(
            &mut next[index],
            "intraRequestDiversityMultiplier",
            multiplier,
        );

        *author_counts
            .entry(next[index].author_id.clone())
            .or_insert(0) += 1;
        *source_counts.entry(source_key).or_insert(0) += 1;
        *topic_counts.entry(topic_key).or_insert(0) += 1;
        if !candidate_tokens.is_empty() {
            seen_token_sets.push(candidate_tokens);
        }
    }

    (
        next,
        build_stage("IntraRequestDiversityScorer", input_count, true, None),
    )
}

pub(super) fn author_diversity_scorer(
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
        let multi_source_softener = 1.0
            + next[index]
                .secondary_recall_sources
                .as_ref()
                .map(|sources| ((sources.len() as f64) * 0.02).min(0.06))
                .unwrap_or_default();
        let recall_evidence_softener = 1.0
            + next[index]
                .recall_evidence
                .as_ref()
                .map(|evidence| ((evidence.source_count - 1.0).max(0.0) * 0.015).min(0.045))
                .unwrap_or_default();
        let multiplier = ((1.0 - 0.3) * 0.8_f64.powi(position as i32) + 0.3)
            * multi_source_softener
            * recall_evidence_softener;
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
