use crate::contracts::RecommendationCandidatePayload;

/// Hydrator that classifies post type and populates `post_type`.
///
/// Classifies candidates as:
/// - "original": not a reply, not a repost
/// - "reply": is_reply = true
/// - "repost": is_repost = true, no original_post_id
/// - "quote": is_repost = true, has original_post_id
///
/// Used by ContentQualityScorer for type-based weight adjustments.
pub struct TweetTypeMetricsHydrator;

impl TweetTypeMetricsHydrator {
    pub fn name() -> &'static str {
        "TweetTypeMetricsCandidateHydrator"
    }

    /// Classify the post type if not already set.
    pub fn hydrate(candidate: &mut RecommendationCandidatePayload) {
        if candidate.post_type.is_some() {
            return;
        }

        let post_type = if candidate.is_repost && candidate.original_post_id.is_some() {
            "quote"
        } else if candidate.is_repost {
            "repost"
        } else if candidate.is_reply {
            "reply"
        } else {
            "original"
        };
        candidate.post_type = Some(post_type.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn make_candidate(
        is_reply: bool,
        is_repost: bool,
        original: Option<&str>,
    ) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: "p1".to_string(),
            author_id: "author-1".to_string(),
            content: String::new(),
            created_at: Utc::now(),
            is_reply,
            is_repost,
            original_post_id: original.map(ToOwned::to_owned),
            ..Default::default()
        }
    }

    #[test]
    fn classifies_original_post() {
        let mut c = make_candidate(false, false, None);
        TweetTypeMetricsHydrator::hydrate(&mut c);
        assert_eq!(c.post_type.as_deref(), Some("original"));
    }

    #[test]
    fn classifies_reply() {
        let mut c = make_candidate(true, false, None);
        TweetTypeMetricsHydrator::hydrate(&mut c);
        assert_eq!(c.post_type.as_deref(), Some("reply"));
    }

    #[test]
    fn classifies_repost() {
        let mut c = make_candidate(false, true, None);
        TweetTypeMetricsHydrator::hydrate(&mut c);
        assert_eq!(c.post_type.as_deref(), Some("repost"));
    }

    #[test]
    fn classifies_quote() {
        let mut c = make_candidate(false, true, Some("original-post"));
        TweetTypeMetricsHydrator::hydrate(&mut c);
        assert_eq!(c.post_type.as_deref(), Some("quote"));
    }

    #[test]
    fn preserves_existing_post_type() {
        let mut c = make_candidate(false, false, None);
        c.post_type = Some("custom".to_string());
        TweetTypeMetricsHydrator::hydrate(&mut c);
        assert_eq!(c.post_type.as_deref(), Some("custom"));
    }
}
