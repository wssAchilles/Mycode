use crate::contracts::RecommendationCandidatePayload;
use super::context::HeuristicRescoringContext;
use super::factor_trait::HeuristicFactor;

/// Boosts media-rich content (images, videos).
///
/// Posts with media attachments tend to have higher engagement and
/// provide a richer user experience. This factor applies a mild boost
/// to posts with images or videos.
///
/// X equivalent: MediaRichFactor in HeuristicScoringPipeline.
///
/// Formula:
/// - Video: 1.10 (highest boost, video is highly engaging)
/// - Image: 1.05 (moderate boost)
/// - Text only: 1.0 (no boost)
pub(super) struct MediaRichFactor;

const VIDEO_BOOST: f64 = 1.10;
const IMAGE_BOOST: f64 = 1.05;

impl HeuristicFactor for MediaRichFactor {
    fn name(&self) -> &'static str {
        "mediaRich"
    }

    fn compute_multiplier(
        &self,
        candidate: &RecommendationCandidatePayload,
        _ctx: &HeuristicRescoringContext,
    ) -> f64 {
        if candidate.has_video == Some(true) {
            VIDEO_BOOST
        } else if candidate.has_image == Some(true) {
            IMAGE_BOOST
        } else {
            1.0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::make_test_candidate;

    #[test]
    fn video_boosted_highest() {
        let ctx = dummy_ctx();
        let mut c = make_test_candidate("p1", "a1");
        c.has_video = Some(true);
        assert!((MediaRichFactor.compute_multiplier(&c, &ctx) - 1.10).abs() < 0.001);
    }

    #[test]
    fn image_boosted_moderate() {
        let ctx = dummy_ctx();
        let mut c = make_test_candidate("p1", "a1");
        c.has_image = Some(true);
        assert!((MediaRichFactor.compute_multiplier(&c, &ctx) - 1.05).abs() < 0.001);
    }

    #[test]
    fn text_only_no_boost() {
        let ctx = dummy_ctx();
        let c = make_test_candidate("p1", "a1");
        assert_eq!(MediaRichFactor.compute_multiplier(&c, &ctx), 1.0);
    }

    fn dummy_ctx() -> HeuristicRescoringContext {
        let seen = std::collections::HashSet::new();
        HeuristicRescoringContext::new(&[], &seen)
    }
}
