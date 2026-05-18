use super::context::HeuristicRescoringContext;
use super::factor_trait::HeuristicFactor;
use crate::contracts::RecommendationCandidatePayload;

/// Penalizes content from authors the viewer has given negative feedback on.
///
/// X equivalent: FeedbackFatigueFactor in HeuristicScoringPipeline.
/// Uses the candidate's action_scores.negative signal to detect viewer fatigue.
/// High negative engagement signals indicate the viewer is tired of this content.
///
/// Formula: multiplier = 1.0 / (1.0 + negative_score * 0.5)
/// - negative 0.0: 1.0 (no penalty)
/// - negative 1.0: 0.667
/// - negative 2.0: 0.5
pub(super) struct FeedbackFatigueFactor;

const FATIGUE_WEIGHT: f64 = 0.5;

impl HeuristicFactor for FeedbackFatigueFactor {
    fn name(&self) -> &'static str {
        "feedbackFatigue"
    }

    fn compute_multiplier(
        &self,
        candidate: &RecommendationCandidatePayload,
        _ctx: &HeuristicRescoringContext,
    ) -> f64 {
        let negative = candidate
            .action_scores
            .as_ref()
            .map(|scores| scores.negative)
            .unwrap_or(0.0)
            .max(0.0);

        if negative <= 0.0 {
            return 1.0;
        }

        1.0 / (1.0 + negative * FATIGUE_WEIGHT)
    }
}

#[cfg(test)]
mod tests {
    use super::super::make_test_candidate;
    use super::*;
    use crate::contracts::ActionScoresPayload;

    #[test]
    fn no_negative_feedback_no_penalty() {
        let ctx = dummy_ctx();
        let c = make_test_candidate("p1", "a1");
        assert_eq!(FeedbackFatigueFactor.compute_multiplier(&c, &ctx), 1.0);
    }

    #[test]
    fn negative_feedback_penalizes() {
        let ctx = dummy_ctx();
        let mut c = make_test_candidate("p1", "a1");
        c.action_scores = Some(ActionScoresPayload {
            negative: 2.0,
            ..Default::default()
        });
        let m = FeedbackFatigueFactor.compute_multiplier(&c, &ctx);
        assert!((m - 0.5).abs() < 0.01);
    }

    #[test]
    fn mild_negative_partial_penalty() {
        let ctx = dummy_ctx();
        let mut c = make_test_candidate("p1", "a1");
        c.action_scores = Some(ActionScoresPayload {
            negative: 1.0,
            ..Default::default()
        });
        let m = FeedbackFatigueFactor.compute_multiplier(&c, &ctx);
        assert!((m - 0.667).abs() < 0.01);
    }

    fn dummy_ctx() -> HeuristicRescoringContext {
        let seen = std::collections::HashSet::new();
        HeuristicRescoringContext::new(&[], &seen)
    }
}
