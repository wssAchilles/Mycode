use crate::contracts::RecommendationCandidatePayload;
use super::context::HeuristicRescoringContext;
use super::factor_trait::HeuristicFactor;

/// Penalizes posts the user has already been exposed to (impressions).
///
/// Even if a post wasn't explicitly "seen" (clicked/engaged), repeated
/// impressions without engagement signal low interest. This factor applies
/// a soft penalty to posts that appear in the user's seen_ids.
///
/// X equivalent: ImpressionDecayFactor in HeuristicScoringPipeline.
///
/// Formula: multiplier = 0.4 for seen posts, 1.0 otherwise.
/// The 0.4 penalty is softer than a hard filter (which would remove entirely),
/// allowing high-quality seen posts to still surface if nothing better exists.
pub(super) struct ImpressionDecayFactor;

const SEEN_PENALTY: f64 = 0.4;

impl HeuristicFactor for ImpressionDecayFactor {
    fn name(&self) -> &'static str {
        "impressionDecay"
    }

    fn compute_multiplier(
        &self,
        candidate: &RecommendationCandidatePayload,
        ctx: &HeuristicRescoringContext,
    ) -> f64 {
        if ctx.seen_post_ids.contains(&candidate.post_id) {
            SEEN_PENALTY
        } else {
            1.0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::make_test_candidate;
    use std::collections::HashSet;

    #[test]
    fn unseen_post_no_penalty() {
        let seen = HashSet::new();
        let ctx = HeuristicRescoringContext::new(&[], &seen);
        let c = make_test_candidate("p1", "a1");
        assert_eq!(ImpressionDecayFactor.compute_multiplier(&c, &ctx), 1.0);
    }

    #[test]
    fn seen_post_penalized() {
        let mut seen = HashSet::new();
        seen.insert("p1".to_string());
        let ctx = HeuristicRescoringContext::new(&[], &seen);
        let c = make_test_candidate("p1", "a1");
        assert!((ImpressionDecayFactor.compute_multiplier(&c, &ctx) - 0.4).abs() < 0.001);
    }
}
