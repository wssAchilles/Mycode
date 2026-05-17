use crate::contracts::RecommendationCandidatePayload;
use super::context::HeuristicRescoringContext;
use super::factor_trait::HeuristicFactor;

/// Boosts longer-form content that provides more value to readers.
///
/// Posts with substantial text content (>200 chars) receive a mild boost,
/// encouraging richer content over short quips. The boost saturates at
/// ~1000 characters.
///
/// X equivalent: LongFormFactor in HeuristicScoringPipeline.
///
/// Formula: 1.0 + 0.08 * saturation, where saturation = ln(1 + chars/200) / ln(6)
/// - 50 chars: 1.015
/// - 200 chars: 1.04
/// - 1000 chars: 1.075
/// - 2000+ chars: 1.08 (clamped)
pub(super) struct LongFormFactor;

const MAX_BOOST: f64 = 0.08;
const REFERENCE_LENGTH: f64 = 200.0;
const SATURATION_LENGTH: f64 = 1000.0;

impl HeuristicFactor for LongFormFactor {
    fn name(&self) -> &'static str {
        "longForm"
    }

    fn compute_multiplier(
        &self,
        candidate: &RecommendationCandidatePayload,
        _ctx: &HeuristicRescoringContext,
    ) -> f64 {
        let len = candidate.content.len() as f64;
        if len < REFERENCE_LENGTH {
            return 1.0;
        }

        let saturation =
            (1.0 + len / REFERENCE_LENGTH).ln() / (1.0 + SATURATION_LENGTH / REFERENCE_LENGTH).ln();
        1.0 + MAX_BOOST * saturation.min(1.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::make_test_candidate;

    #[test]
    fn short_content_no_boost() {
        let ctx = dummy_ctx();
        let mut c = make_test_candidate("p1", "a1");
        c.content = "short".to_string();
        assert_eq!(LongFormFactor.compute_multiplier(&c, &ctx), 1.0);
    }

    #[test]
    fn long_content_boosted() {
        let ctx = dummy_ctx();
        let mut c = make_test_candidate("p1", "a1");
        c.content = "x".repeat(1000);
        let m = LongFormFactor.compute_multiplier(&c, &ctx);
        assert!(m > 1.05);
        assert!(m <= 1.0 + MAX_BOOST + 0.001);
    }

    fn dummy_ctx() -> HeuristicRescoringContext {
        let seen = std::collections::HashSet::new();
        HeuristicRescoringContext::new(&[], &seen)
    }
}
