use crate::contracts::RecommendationCandidatePayload;

/// Hydrator that populates engagement count fields from candidate metadata.
///
/// Reads like/reply/repost/view counts from the candidate's existing fields
/// and ensures they are non-None for downstream scorers (ContentQualityScorer,
/// EngagementScorer).
pub struct EngagementCountsHydrator;

impl EngagementCountsHydrator {
    pub fn name() -> &'static str {
        "EngagementCountsCandidateHydrator"
    }

    /// Ensure engagement counts default to 0 when absent.
    pub fn hydrate(candidate: &mut RecommendationCandidatePayload) {
        candidate.like_count = Some(candidate.like_count.unwrap_or(0.0));
        candidate.comment_count = Some(candidate.comment_count.unwrap_or(0.0));
        candidate.repost_count = Some(candidate.repost_count.unwrap_or(0.0));
        candidate.view_count = Some(candidate.view_count.unwrap_or(0.0));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn make_candidate(
        like: Option<f64>,
        comment: Option<f64>,
        repost: Option<f64>,
        view: Option<f64>,
    ) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: "p1".to_string(),
            author_id: "author-1".to_string(),
            content: String::new(),
            created_at: Utc::now(),
            like_count: like,
            comment_count: comment,
            repost_count: repost,
            view_count: view,
            ..Default::default()
        }
    }

    #[test]
    fn defaults_missing_counts_to_zero() {
        let mut c = make_candidate(None, None, None, None);
        EngagementCountsHydrator::hydrate(&mut c);
        assert_eq!(c.like_count, Some(0.0));
        assert_eq!(c.comment_count, Some(0.0));
        assert_eq!(c.repost_count, Some(0.0));
        assert_eq!(c.view_count, Some(0.0));
    }

    #[test]
    fn preserves_existing_counts() {
        let mut c = make_candidate(Some(10.0), Some(5.0), Some(3.0), Some(100.0));
        EngagementCountsHydrator::hydrate(&mut c);
        assert_eq!(c.like_count, Some(10.0));
        assert_eq!(c.comment_count, Some(5.0));
        assert_eq!(c.repost_count, Some(3.0));
        assert_eq!(c.view_count, Some(100.0));
    }

    #[test]
    fn fills_partial_missing() {
        let mut c = make_candidate(Some(10.0), None, Some(3.0), None);
        EngagementCountsHydrator::hydrate(&mut c);
        assert_eq!(c.like_count, Some(10.0));
        assert_eq!(c.comment_count, Some(0.0));
        assert_eq!(c.repost_count, Some(3.0));
        assert_eq!(c.view_count, Some(0.0));
    }
}
