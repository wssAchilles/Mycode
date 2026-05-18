use crate::contracts::RecommendationCandidatePayload;
use super::context::HeuristicRescoringContext;
use super::factor_trait::HeuristicFactor;

/// Penalizes clusters of similar media content to promote diversity.
///
/// X equivalent: MediaClusterDiversityFactor in HeuristicScoringPipeline.
/// When too many candidates in the batch share the same media type
/// (video-only or image-only), each candidate beyond the cluster threshold
/// receives a penalty to encourage media-type variety.
///
/// Formula: multiplier = 1.0 / (1.0 + max(0, cluster_count - threshold) * 0.15)
/// - cluster_count <= 3: 1.0 (no penalty)
/// - cluster_count 5: 1.0 / (1.0 + 0.30) = 0.769
/// - cluster_count 8: 1.0 / (1.0 + 0.75) = 0.571
pub(super) struct MediaClusterDiversityFactor;

const CLUSTER_THRESHOLD: usize = 3;
const PENALTY_WEIGHT: f64 = 0.15;

impl HeuristicFactor for MediaClusterDiversityFactor {
    fn name(&self) -> &'static str {
        "mediaClusterDiversity"
    }

    fn compute_multiplier(
        &self,
        candidate: &RecommendationCandidatePayload,
        ctx: &HeuristicRescoringContext,
    ) -> f64 {
        let media_key = media_cluster_key(candidate);
        let Some(key) = media_key else {
            return 1.0;
        };

        let cluster_count = ctx
            .media_cluster_counts
            .get(key)
            .copied()
            .unwrap_or(1);

        if cluster_count <= CLUSTER_THRESHOLD {
            return 1.0;
        }

        let excess = (cluster_count - CLUSTER_THRESHOLD) as f64;
        1.0 / (1.0 + excess * PENALTY_WEIGHT)
    }
}

/// Classify candidates into media clusters for diversity tracking.
/// Returns None for text-only content (no media to cluster).
pub(super) fn media_cluster_key(candidate: &RecommendationCandidatePayload) -> Option<&'static str> {
    let has_video = candidate.has_video.unwrap_or(false);
    let has_image = candidate.has_image.unwrap_or(false);

    if has_video && has_image {
        Some("mixed_media")
    } else if has_video {
        Some("video_only")
    } else if has_image {
        Some("image_only")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::make_test_candidate;

    #[test]
    fn small_cluster_no_penalty() {
        let ctx = make_ctx(2, false, true);
        let mut c = make_test_candidate("p1", "a1");
        c.has_image = Some(true);
        assert_eq!(MediaClusterDiversityFactor.compute_multiplier(&c, &ctx), 1.0);
    }

    #[test]
    fn large_cluster_penalized() {
        let ctx = make_ctx(6, false, true);
        let mut c = make_test_candidate("p1", "a1");
        c.has_image = Some(true);
        let m = MediaClusterDiversityFactor.compute_multiplier(&c, &ctx);
        assert!(m < 1.0);
    }

    #[test]
    fn text_only_no_cluster_penalty() {
        let ctx = make_ctx(10, false, false);
        let c = make_test_candidate("p1", "a1");
        let m = MediaClusterDiversityFactor.compute_multiplier(&c, &ctx);
        assert!((m - 1.0).abs() < 0.01);
    }

    fn make_ctx(image_count: usize, has_video: bool, has_image: bool) -> HeuristicRescoringContext {
        let seen = std::collections::HashSet::new();
        let mut candidates = Vec::new();
        for i in 0..image_count {
            let mut c = make_test_candidate(&format!("p{i}"), &format!("a{i}"));
            c.has_video = Some(has_video);
            c.has_image = Some(has_image);
            candidates.push(c);
        }
        HeuristicRescoringContext::new(&candidates, &seen)
    }
}
