use super::context::HeuristicRescoringContext;
use super::factor_trait::HeuristicFactor;
use crate::contracts::RecommendationCandidatePayload;

/// Penalizes over-representation from a single recall source.
///
/// When a single source (e.g., "following", "two_tower") contributes
/// too many candidates, this factor applies a mild penalty to promote
/// diversity across retrieval sources.
///
/// X equivalent: SourceDiversityFactor in HeuristicScoringPipeline.
///
/// Formula: penalty starts at 20% share, linear to 0.85 at 50% share.
/// - 10% share: 1.0 (no penalty)
/// - 30% share: 0.95
/// - 50% share: 0.85
/// - 80% share: 0.85 (clamped)
pub(super) struct SourceDiversityFactor;

const SHARE_THRESHOLD: f64 = 0.20;
const MAX_PENALTY: f64 = 0.85;

impl HeuristicFactor for SourceDiversityFactor {
    fn name(&self) -> &'static str {
        "sourceDiversity"
    }

    fn compute_multiplier(
        &self,
        candidate: &RecommendationCandidatePayload,
        ctx: &HeuristicRescoringContext,
    ) -> f64 {
        let source = match candidate.recall_source.as_deref() {
            Some(s) => s,
            None => return 1.0,
        };

        let count = ctx.source_counts.get(source).copied().unwrap_or(0);
        if ctx.candidate_count == 0 {
            return 1.0;
        }

        let share = count as f64 / ctx.candidate_count as f64;
        if share <= SHARE_THRESHOLD {
            return 1.0;
        }

        // Linear interpolation: 1.0 at threshold, MAX_PENALTY at 0.5
        let t = ((share - SHARE_THRESHOLD) / (0.5 - SHARE_THRESHOLD)).clamp(0.0, 1.0);
        1.0 - (1.0 - MAX_PENALTY) * t
    }
}

#[cfg(test)]
mod tests {
    use super::super::make_test_candidate;
    use super::*;

    #[test]
    fn low_share_no_penalty() {
        let ctx = make_ctx(10, 1);
        let mut c = make_test_candidate("p1", "a1");
        c.recall_source = Some("src1".to_string());
        assert_eq!(SourceDiversityFactor.compute_multiplier(&c, &ctx), 1.0);
    }

    #[test]
    fn high_share_penalized() {
        let ctx = make_ctx(10, 5);
        let mut c = make_test_candidate("p1", "a1");
        c.recall_source = Some("src1".to_string());
        let m = SourceDiversityFactor.compute_multiplier(&c, &ctx);
        assert!(m < 1.0);
        assert!(m >= MAX_PENALTY);
    }

    fn make_ctx(total: usize, source_count: usize) -> HeuristicRescoringContext {
        let seen = std::collections::HashSet::new();
        let mut candidates = Vec::new();
        for i in 0..total {
            let mut c = make_test_candidate(&format!("p{i}"), &format!("a{i}"));
            if i < source_count {
                c.recall_source = Some("src1".to_string());
            } else {
                c.recall_source = Some("src2".to_string());
            }
            candidates.push(c);
        }
        HeuristicRescoringContext::new(&candidates, &seen)
    }
}
