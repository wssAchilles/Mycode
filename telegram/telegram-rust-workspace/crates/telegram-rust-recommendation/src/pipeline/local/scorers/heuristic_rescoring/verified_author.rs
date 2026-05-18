use super::context::HeuristicRescoringContext;
use super::factor_trait::HeuristicFactor;
use crate::contracts::RecommendationCandidatePayload;

/// Boosts posts from verified or high-affinity authors.
///
/// X equivalent: VerifiedAuthorFactor in HeuristicScoringPipeline.
/// Since the candidate contract does not carry an explicit `verified` flag,
/// we use author_affinity_score as a proxy: authors with high affinity
/// (long-standing positive engagement history) receive a moderate boost.
///
/// Formula: 1.0 + 0.10 * min(affinity / 0.8, 1.0)
/// - affinity 0.0: 1.0 (no boost)
/// - affinity 0.4: 1.05
/// - affinity 0.8+: 1.10
pub(super) struct VerifiedAuthorFactor;

const MAX_BOOST: f64 = 0.10;
const AFFINITY_THRESHOLD: f64 = 0.8;

impl HeuristicFactor for VerifiedAuthorFactor {
    fn name(&self) -> &'static str {
        "verifiedAuthor"
    }

    fn compute_multiplier(
        &self,
        candidate: &RecommendationCandidatePayload,
        _ctx: &HeuristicRescoringContext,
    ) -> f64 {
        let affinity = candidate.author_affinity_score.unwrap_or(0.0);
        let normalized = (affinity / AFFINITY_THRESHOLD).clamp(0.0, 1.0);
        1.0 + MAX_BOOST * normalized
    }
}

#[cfg(test)]
mod tests {
    use super::super::make_test_candidate;
    use super::*;

    #[test]
    fn high_affinity_boosted() {
        let ctx = dummy_ctx();
        let mut c = make_test_candidate("p1", "a1");
        c.author_affinity_score = Some(0.9);
        let m = VerifiedAuthorFactor.compute_multiplier(&c, &ctx);
        assert!((m - 1.10).abs() < 0.01);
    }

    #[test]
    fn zero_affinity_no_boost() {
        let ctx = dummy_ctx();
        let c = make_test_candidate("p1", "a1");
        assert_eq!(VerifiedAuthorFactor.compute_multiplier(&c, &ctx), 1.0);
    }

    #[test]
    fn mid_affinity_partial_boost() {
        let ctx = dummy_ctx();
        let mut c = make_test_candidate("p1", "a1");
        c.author_affinity_score = Some(0.4);
        let m = VerifiedAuthorFactor.compute_multiplier(&c, &ctx);
        assert!((m - 1.05).abs() < 0.01);
    }

    fn dummy_ctx() -> HeuristicRescoringContext {
        let seen = std::collections::HashSet::new();
        HeuristicRescoringContext::new(&[], &seen)
    }
}
