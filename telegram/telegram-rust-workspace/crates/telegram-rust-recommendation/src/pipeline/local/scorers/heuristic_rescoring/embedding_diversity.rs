use super::context::HeuristicRescoringContext;
use super::factor_trait::HeuristicFactor;
use crate::contracts::RecommendationCandidatePayload;

/// Penalizes candidates whose topic affinity is highly concentrated,
/// promoting embedding-level diversity in the final ranking.
///
/// X equivalent: EmbeddingDiversityFactor in HeuristicScoringPipeline.
/// Uses ranking_signals.topic_affinity as a proxy for embedding similarity.
/// When many candidates share similar high topic_affinity scores, the factor
/// penalizes duplicates to spread the feed across diverse topics.
///
/// Formula: multiplier = 1.0 / (1.0 + max(0, similar_count - threshold) * 0.10)
/// where similar_count is the number of candidates with topic_affinity in the
/// same quantile bucket.
pub(super) struct EmbeddingDiversityFactor;

const BUCKET_SIZE: f64 = 0.2; // quantile bucket width
const SIMILAR_THRESHOLD: usize = 3;
const PENALTY_WEIGHT: f64 = 0.10;

impl HeuristicFactor for EmbeddingDiversityFactor {
    fn name(&self) -> &'static str {
        "embeddingDiversity"
    }

    fn compute_multiplier(
        &self,
        candidate: &RecommendationCandidatePayload,
        ctx: &HeuristicRescoringContext,
    ) -> f64 {
        let topic_affinity = candidate
            .ranking_signals
            .as_ref()
            .map(|signals| signals.topic_affinity)
            .unwrap_or(0.0);

        let bucket = (topic_affinity / BUCKET_SIZE).floor() as i32;
        let similar_count = ctx
            .topic_affinity_buckets
            .get(&bucket)
            .copied()
            .unwrap_or(1);

        if similar_count <= SIMILAR_THRESHOLD {
            return 1.0;
        }

        let excess = (similar_count - SIMILAR_THRESHOLD) as f64;
        1.0 / (1.0 + excess * PENALTY_WEIGHT)
    }
}

#[cfg(test)]
mod tests {
    use super::super::make_test_candidate;
    use super::*;
    use crate::contracts::RankingSignalsPayload;

    #[test]
    fn unique_topic_no_penalty() {
        let ctx = make_ctx(&[0.1, 0.5, 0.9]);
        let mut c = make_test_candidate("p1", "a1");
        c.ranking_signals = Some(make_signals(0.1));
        assert_eq!(EmbeddingDiversityFactor.compute_multiplier(&c, &ctx), 1.0);
    }

    #[test]
    fn clustered_topics_penalized() {
        let ctx = make_ctx(&[0.5, 0.52, 0.54, 0.56, 0.58]);
        let mut c = make_test_candidate("p1", "a1");
        c.ranking_signals = Some(make_signals(0.52));
        let m = EmbeddingDiversityFactor.compute_multiplier(&c, &ctx);
        assert!(m < 1.0);
    }

    fn make_signals(topic_affinity: f64) -> RankingSignalsPayload {
        RankingSignalsPayload {
            topic_affinity,
            ..Default::default()
        }
    }

    fn make_ctx(affinities: &[f64]) -> HeuristicRescoringContext {
        let seen = std::collections::HashSet::new();
        let candidates: Vec<_> = affinities
            .iter()
            .enumerate()
            .map(|(i, &affinity)| {
                let mut c = make_test_candidate(&format!("p{i}"), &format!("a{i}"));
                c.ranking_signals = Some(make_signals(affinity));
                c
            })
            .collect();
        HeuristicRescoringContext::new(&candidates, &seen)
    }
}
