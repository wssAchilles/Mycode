use crate::contracts::RecommendationCandidatePayload;
use super::context::HeuristicRescoringContext;
use super::factor_trait::HeuristicFactor;

/// Penalizes repeated exposure from the same author within a single request.
///
/// When multiple posts from the same author appear in the candidate pool,
/// each additional post beyond the first receives a multiplicative penalty.
/// This prevents a single author from dominating the feed.
///
/// X equivalent: AuthorDecayFactor in HeuristicScoringPipeline.
///
/// Formula: multiplier = 1.0 / (1.0 + ln(count))
/// - 1 post: 1.0 (no penalty)
/// - 2 posts: 1.0 / (1.0 + 0.693) = 0.591
/// - 3 posts: 1.0 / (1.0 + 1.099) = 0.476
/// - 5 posts: 1.0 / (1.0 + 1.609) = 0.383
pub(super) struct AuthorDecayFactor;

impl HeuristicFactor for AuthorDecayFactor {
    fn name(&self) -> &'static str {
        "authorDecay"
    }

    fn compute_multiplier(
        &self,
        candidate: &RecommendationCandidatePayload,
        ctx: &HeuristicRescoringContext,
    ) -> f64 {
        let count = ctx
            .author_counts
            .get(candidate.author_id.as_str())
            .copied()
            .unwrap_or(1);

        if count <= 1 {
            return 1.0;
        }

        1.0 / (1.0 + (count as f64).ln())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::make_test_candidate;

    #[test]
    fn single_author_no_penalty() {
        let c = make_test_candidate("p1", "a1");
        let ctx = make_ctx(1);
        assert_eq!(AuthorDecayFactor.compute_multiplier(&c, &ctx), 1.0);
    }

    #[test]
    fn two_posts_penalized() {
        let c = make_test_candidate("p1", "a1");
        let ctx = make_ctx(2);
        let m = AuthorDecayFactor.compute_multiplier(&c, &ctx);
        assert!(m < 1.0);
        assert!((m - 0.591).abs() < 0.01);
    }

    fn make_ctx(count: usize) -> HeuristicRescoringContext {
        let seen = std::collections::HashSet::new();
        let mut candidates = Vec::new();
        for i in 0..count {
            candidates.push(make_test_candidate(&format!("p{i}"), "a1"));
        }
        HeuristicRescoringContext::new(&candidates, &seen)
    }
}
