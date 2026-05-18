use super::context::HeuristicRescoringContext;
use super::factor_trait::HeuristicFactor;
use crate::contracts::RecommendationCandidatePayload;

/// Normalizes multi-task learning (MTL) scores across the candidate batch.
///
/// X equivalent: MTLNormalizationFactor in HeuristicScoringPipeline.
/// Phoenix scores from the ML model may have different scales across
/// engagement types (like, reply, repost, click, dwell). This factor
/// applies a batch-wise z-score normalization to bring outlier scores
/// closer to the batch mean, preventing one engagement type from
/// dominating the final ranking.
///
/// Uses the phoenix_scores.like_score as the primary signal for normalization.
/// Formula: multiplier = clamp(1.0 + (score - mean) / (std + epsilon) * 0.1, 0.5, 1.5)
pub(super) struct MtlNormalizationFactor;

const NORM_WEIGHT: f64 = 0.1;
const EPSILON: f64 = 1e-6;

impl HeuristicFactor for MtlNormalizationFactor {
    fn name(&self) -> &'static str {
        "mtlNormalization"
    }

    fn compute_multiplier(
        &self,
        candidate: &RecommendationCandidatePayload,
        ctx: &HeuristicRescoringContext,
    ) -> f64 {
        let score = candidate
            .phoenix_scores
            .as_ref()
            .and_then(|s| s.like_score)
            .unwrap_or(0.0);

        if ctx.phoenix_score_stats.count < 2 {
            return 1.0;
        }

        let mean = ctx.phoenix_score_stats.mean;
        let std = ctx.phoenix_score_stats.std;

        if std < EPSILON {
            return 1.0;
        }

        let z = (score - mean) / std;
        (1.0 + z * NORM_WEIGHT).clamp(0.5, 1.5)
    }
}

#[cfg(test)]
mod tests {
    use super::super::make_test_candidate;
    use super::*;
    use crate::contracts::PhoenixScoresPayload;

    #[test]
    fn single_candidate_no_normalization() {
        let ctx = make_ctx(&[0.5]);
        let c = make_test_candidate("p1", "a1");
        assert_eq!(MtlNormalizationFactor.compute_multiplier(&c, &ctx), 1.0);
    }

    #[test]
    fn above_mean_boosted() {
        let ctx = make_ctx(&[0.2, 0.4, 0.6, 0.8]);
        let mut c = make_test_candidate("p1", "a1");
        c.phoenix_scores = Some(make_phoenix(0.8));
        let m = MtlNormalizationFactor.compute_multiplier(&c, &ctx);
        assert!(m > 1.0);
        assert!(m <= 1.5);
    }

    #[test]
    fn below_mean_penalized() {
        let ctx = make_ctx(&[0.2, 0.4, 0.6, 0.8]);
        let mut c = make_test_candidate("p1", "a1");
        c.phoenix_scores = Some(make_phoenix(0.2));
        let m = MtlNormalizationFactor.compute_multiplier(&c, &ctx);
        assert!(m < 1.0);
        assert!(m >= 0.5);
    }

    fn make_phoenix(like_score: f64) -> PhoenixScoresPayload {
        PhoenixScoresPayload {
            like_score: Some(like_score),
            ..Default::default()
        }
    }

    fn make_ctx(scores: &[f64]) -> HeuristicRescoringContext {
        let seen = std::collections::HashSet::new();
        let candidates: Vec<_> = scores
            .iter()
            .enumerate()
            .map(|(i, &score)| {
                let mut c = make_test_candidate(&format!("p{i}"), &format!("a{i}"));
                c.phoenix_scores = Some(make_phoenix(score));
                c
            })
            .collect();
        HeuristicRescoringContext::new(&candidates, &seen)
    }
}
