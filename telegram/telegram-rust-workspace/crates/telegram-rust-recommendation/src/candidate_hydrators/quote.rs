use crate::contracts::RecommendationCandidatePayload;

/// Hydrator that detects quote posts and populates `original_post_id`.
///
/// A quote post is a repost that references another post. This hydrator
/// checks `is_repost` + `original_post_id` to identify quotes, and sets
/// `post_type` to "quote" for downstream scorers.
pub struct QuoteHydrator;

impl QuoteHydrator {
    pub fn name() -> &'static str {
        "QuoteCandidateHydrator"
    }

    /// Mark quote posts with `post_type = "quote"`.
    pub fn hydrate(candidate: &mut RecommendationCandidatePayload) {
        if candidate.is_repost && candidate.original_post_id.is_some() {
            candidate.post_type = Some("quote".to_string());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn make_candidate(is_repost: bool, original: Option<&str>) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: "p1".to_string(),
            author_id: "author-1".to_string(),
            content: String::new(),
            created_at: Utc::now(),
            is_repost,
            original_post_id: original.map(ToOwned::to_owned),
            ..Default::default()
        }
    }

    #[test]
    fn marks_quote_post() {
        let mut c = make_candidate(true, Some("original-post"));
        QuoteHydrator::hydrate(&mut c);
        assert_eq!(c.post_type.as_deref(), Some("quote"));
    }

    #[test]
    fn skips_non_repost() {
        let mut c = make_candidate(false, None);
        QuoteHydrator::hydrate(&mut c);
        assert!(c.post_type.is_none());
    }

    #[test]
    fn skips_repost_without_original() {
        let mut c = make_candidate(true, None);
        QuoteHydrator::hydrate(&mut c);
        assert!(c.post_type.is_none());
    }
}
