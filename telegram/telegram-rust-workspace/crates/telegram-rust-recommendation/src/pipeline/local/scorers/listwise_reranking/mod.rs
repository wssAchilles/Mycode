mod context;

use super::helpers::build_stage;
use super::runner::ScoringContext;
use crate::contracts::{RecommendationCandidatePayload, RecommendationStagePayload};
use context::ListwiseGroups;

pub(super) struct ListwiseRerankingExecution {
    pub candidates: Vec<RecommendationCandidatePayload>,
    pub stages: Vec<RecommendationStagePayload>,
}

/// Exponential decay rate per position within a group.
///
/// X's ListwiseRescoringProvider uses similar position-dependent decay to prevent
/// a single author or source from dominating consecutive feed positions.
///
/// With decay_rate = 0.90:
/// - Position 0: multiplier = 1.0 (no penalty)
/// - Position 1: multiplier = 0.90
/// - Position 2: multiplier = 0.81
/// - Position 3: multiplier = 0.729
const AUTHOR_DECAY_RATE: f64 = 0.90;
const SOURCE_DECAY_RATE: f64 = 0.92;

pub(super) const LISTWISE_RERANKING_STAGES: &[&str] =
    &["ListwiseAuthorDecay", "ListwiseSourceDecay"];

pub(super) fn run_listwise_reranking_group(
    _ctx: &ScoringContext,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> ListwiseRerankingExecution {
    let input_count = candidates.len();

    // Pass 1: position-dependent decay within author groups.
    apply_listwise_decay(
        &mut candidates,
        AUTHOR_DECAY_RATE,
        ListwiseGroups::by_author,
    );

    // Pass 2: position-dependent decay within source groups.
    apply_listwise_decay(
        &mut candidates,
        SOURCE_DECAY_RATE,
        ListwiseGroups::by_source,
    );

    let stages = LISTWISE_RERANKING_STAGES
        .iter()
        .map(|name| build_stage(name, input_count, true, None))
        .collect();

    ListwiseRerankingExecution { candidates, stages }
}

/// Apply position-dependent exponential decay within each group.
///
/// For each group, candidates are already sorted by score descending.
/// The i-th candidate receives `score *= decay_rate^i`, ensuring that
/// the highest-scored item in each group is preserved while subsequent
/// items are progressively penalized.
fn apply_listwise_decay(
    candidates: &mut [RecommendationCandidatePayload],
    decay_rate: f64,
    group_fn: fn(&[RecommendationCandidatePayload]) -> ListwiseGroups,
) {
    let groups = group_fn(candidates);

    for (_key, indices) in &groups.groups {
        for (position, &idx) in indices.iter().enumerate() {
            if position == 0 {
                // Best candidate in group: no penalty.
                continue;
            }
            let multiplier = decay_rate.powi(position as i32);
            let current = candidates[idx].weighted_score.unwrap_or(0.0);
            let adjusted = current * multiplier;
            candidates[idx].weighted_score = Some(adjusted);
            candidates[idx].pipeline_score = Some(adjusted);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::heuristic_rescoring::make_test_candidate;
    use super::*;

    #[test]
    fn single_author_position_decay() {
        let mut c1 = make_test_candidate("p1", "a1");
        let mut c2 = make_test_candidate("p2", "a1");
        let mut c3 = make_test_candidate("p3", "a1");
        c1.weighted_score = Some(1.0);
        c2.weighted_score = Some(0.9);
        c3.weighted_score = Some(0.8);
        c1.pipeline_score = Some(1.0);
        c2.pipeline_score = Some(0.9);
        c3.pipeline_score = Some(0.8);

        let mut candidates = vec![c1, c2, c3];
        let groups = ListwiseGroups::by_author(&candidates);
        // a1 group: indices sorted by score desc → [0, 1, 2]
        assert_eq!(groups.groups["a1"], vec![0, 1, 2]);

        apply_listwise_decay(
            &mut candidates,
            AUTHOR_DECAY_RATE,
            ListwiseGroups::by_author,
        );

        // Position 0: no decay
        assert!((candidates[0].weighted_score.unwrap() - 1.0).abs() < 0.001);
        // Position 1: 0.9 * 0.9 = 0.81
        assert!((candidates[1].weighted_score.unwrap() - 0.81).abs() < 0.001);
        // Position 2: 0.8 * 0.9^2 = 0.648
        assert!((candidates[2].weighted_score.unwrap() - 0.648).abs() < 0.001);
    }

    #[test]
    fn different_authors_no_decay() {
        let mut c1 = make_test_candidate("p1", "a1");
        let mut c2 = make_test_candidate("p2", "a2");
        c1.weighted_score = Some(1.0);
        c2.weighted_score = Some(0.9);
        c1.pipeline_score = Some(1.0);
        c2.pipeline_score = Some(0.9);

        let mut candidates = vec![c1, c2];
        apply_listwise_decay(
            &mut candidates,
            AUTHOR_DECAY_RATE,
            ListwiseGroups::by_author,
        );

        // Each author has only 1 post → position 0 → no decay
        assert!((candidates[0].weighted_score.unwrap() - 1.0).abs() < 0.001);
        assert!((candidates[1].weighted_score.unwrap() - 0.9).abs() < 0.001);
    }

    #[test]
    fn source_group_decay() {
        let mut c1 = make_test_candidate("p1", "a1");
        let mut c2 = make_test_candidate("p2", "a2");
        c1.recall_source = Some("GraphSource".to_string());
        c2.recall_source = Some("GraphSource".to_string());
        c1.weighted_score = Some(1.0);
        c2.weighted_score = Some(0.8);
        c1.pipeline_score = Some(1.0);
        c2.pipeline_score = Some(0.8);

        let mut candidates = vec![c1, c2];
        apply_listwise_decay(
            &mut candidates,
            SOURCE_DECAY_RATE,
            ListwiseGroups::by_source,
        );

        // Same source: position 1 gets decay
        assert!((candidates[0].weighted_score.unwrap() - 1.0).abs() < 0.001);
        assert!((candidates[1].weighted_score.unwrap() - 0.8 * 0.92).abs() < 0.001);
    }
}
