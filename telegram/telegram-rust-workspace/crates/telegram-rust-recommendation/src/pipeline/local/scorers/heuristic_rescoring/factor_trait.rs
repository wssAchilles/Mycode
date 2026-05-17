use crate::contracts::RecommendationCandidatePayload;
use super::super::helpers::merge_breakdown;
use super::context::HeuristicRescoringContext;

/// A single multiplicative heuristic factor applied to each candidate.
///
/// Each factor computes a multiplier in [0.0, 2.0] that scales the candidate's
/// weighted_score. The multiplier is applied multiplicatively and recorded
/// in the candidate's score_breakdown for diagnostics.
///
/// Design: one factor = one responsibility = one file.
pub(super) trait HeuristicFactor {
    /// Diagnostic name used in score_breakdown keys.
    fn name(&self) -> &'static str;

    /// Compute the multiplicative multiplier for a single candidate.
    /// Returns 1.0 for no-op; <1.0 to penalize; >1.0 to boost.
    fn compute_multiplier(
        &self,
        candidate: &RecommendationCandidatePayload,
        ctx: &HeuristicRescoringContext,
    ) -> f64;
}

/// Apply a single factor to a candidate: compute multiplier, adjust scores, record breakdown.
pub(super) fn apply_factor(
    factor: &dyn HeuristicFactor,
    candidate: &mut RecommendationCandidatePayload,
    ctx: &HeuristicRescoringContext,
) {
    let multiplier = factor.compute_multiplier(candidate, ctx);
    if !multiplier.is_finite() || multiplier <= 0.0 {
        return;
    }
    let current = candidate.weighted_score.unwrap_or_default();
    let adjusted = current * multiplier;
    candidate.weighted_score = Some(adjusted);
    candidate.pipeline_score = Some(adjusted);
    let breakdown_key = format!("{}Multiplier", factor.name());
    merge_breakdown(candidate, &breakdown_key, multiplier);
}
