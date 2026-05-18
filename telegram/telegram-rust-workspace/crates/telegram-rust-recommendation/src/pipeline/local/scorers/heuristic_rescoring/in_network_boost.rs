use super::context::HeuristicRescoringContext;
use super::factor_trait::HeuristicFactor;
use crate::contracts::RecommendationCandidatePayload;

/// Boosts content from users the viewer follows (in-network).
///
/// In-network content has higher relevance because the viewer has
/// explicitly chosen to follow the author. This factor applies a
/// moderate boost to in-network candidates.
///
/// X equivalent: InNetworkBoostFactor in HeuristicScoringPipeline.
///
/// Formula: 1.15 for in-network, 1.0 for out-of-network.
pub(super) struct InNetworkBoostFactor;

const IN_NETWORK_BOOST: f64 = 1.15;

impl HeuristicFactor for InNetworkBoostFactor {
    fn name(&self) -> &'static str {
        "inNetworkBoost"
    }

    fn compute_multiplier(
        &self,
        candidate: &RecommendationCandidatePayload,
        _ctx: &HeuristicRescoringContext,
    ) -> f64 {
        if candidate.in_network == Some(true) {
            IN_NETWORK_BOOST
        } else {
            1.0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::make_test_candidate;
    use super::*;

    #[test]
    fn in_network_boosted() {
        let ctx = dummy_ctx();
        let mut c = make_test_candidate("p1", "a1");
        c.in_network = Some(true);
        assert!((InNetworkBoostFactor.compute_multiplier(&c, &ctx) - 1.15).abs() < 0.001);
    }

    #[test]
    fn out_of_network_no_boost() {
        let ctx = dummy_ctx();
        let c = make_test_candidate("p1", "a1");
        assert_eq!(InNetworkBoostFactor.compute_multiplier(&c, &ctx), 1.0);
    }

    fn dummy_ctx() -> HeuristicRescoringContext {
        let seen = std::collections::HashSet::new();
        HeuristicRescoringContext::new(&[], &seen)
    }
}
