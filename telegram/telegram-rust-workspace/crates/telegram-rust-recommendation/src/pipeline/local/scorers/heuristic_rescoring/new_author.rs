use crate::contracts::RecommendationCandidatePayload;
use super::context::HeuristicRescoringContext;
use super::factor_trait::HeuristicFactor;

/// Boosts posts from recently published content to promote freshness.
///
/// Posts published within the last 2 hours get a moderate boost,
/// tapering to 1.0 at 24 hours. This helps surface breaking content
/// that hasn't yet accumulated engagement signals.
///
/// X equivalent: NewAuthorFactor in HeuristicScoringPipeline.
///
/// Formula: 1.0 + 0.12 * decay, where decay = 0.5^(age_hours / 6)
/// - 0 hours: 1.12
/// - 6 hours: 1.06
/// - 24 hours: 1.015
pub(super) struct NewAuthorFactor;

const MAX_BOOST: f64 = 0.12;
const HALF_LIFE_HOURS: f64 = 6.0;

impl HeuristicFactor for NewAuthorFactor {
    fn name(&self) -> &'static str {
        "newAuthor"
    }

    fn compute_multiplier(
        &self,
        candidate: &RecommendationCandidatePayload,
        ctx: &HeuristicRescoringContext,
    ) -> f64 {
        let age_hours = ctx
            .now
            .signed_duration_since(candidate.created_at)
            .num_minutes()
            .max(0) as f64
            / 60.0;

        let decay = 0.5_f64.powf(age_hours / HALF_LIFE_HOURS);
        1.0 + MAX_BOOST * decay
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::make_test_candidate;
    use chrono::Utc;

    #[test]
    fn fresh_post_boosted() {
        let ctx = dummy_ctx();
        let mut c = make_test_candidate("p1", "a1");
        c.created_at = Utc::now();
        let m = NewAuthorFactor.compute_multiplier(&c, &ctx);
        assert!(m > 1.10);
    }

    #[test]
    fn old_post_minimal_boost() {
        let ctx = dummy_ctx();
        let mut c = make_test_candidate("p1", "a1");
        c.created_at = Utc::now() - chrono::Duration::hours(48);
        let m = NewAuthorFactor.compute_multiplier(&c, &ctx);
        assert!((m - 1.0).abs() < 0.01);
    }

    fn dummy_ctx() -> HeuristicRescoringContext {
        let seen = std::collections::HashSet::new();
        HeuristicRescoringContext::new(&[], &seen)
    }
}
