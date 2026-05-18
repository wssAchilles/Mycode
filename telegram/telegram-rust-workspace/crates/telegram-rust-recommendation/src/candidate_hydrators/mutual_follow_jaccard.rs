use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};

/// Hydrator that computes mutual-follow Jaccard similarity between viewer and author.
///
/// Jaccard = |intersection| / |union| of followee sets.
/// A high score means the viewer and author follow many of the same people,
/// indicating shared interests.
///
/// In production this requires the viewer's followee set (from user_features)
/// and the author's followee set (from a social graph service). The stub
/// computes a placeholder score based on available data.
pub struct MutualFollowJaccardHydrator;

impl MutualFollowJaccardHydrator {
    pub fn name() -> &'static str {
        "MutualFollowJaccardCandidateHydrator"
    }

    /// Compute Jaccard similarity for a candidate.
    ///
    /// Stub implementation: sets a default score of 0.0 when no social graph
    /// data is available. Production impl would compute from followee sets.
    pub fn hydrate(
        query: &RecommendationQueryPayload,
        candidate: &mut RecommendationCandidatePayload,
    ) {
        if candidate.mutual_follow_jaccard.is_some() {
            return;
        }

        // If the viewer has mutual_follow_ids, use count as a proxy score.
        let mutual_count = query
            .mutual_follow_ids
            .as_ref()
            .map(|ids| ids.len())
            .unwrap_or(0);

        if mutual_count > 0 {
            // Normalize to [0, 1] range using a soft cap of 50.
            let score = (mutual_count as f64 / 50.0).min(1.0);
            candidate.mutual_follow_jaccard = Some(score);
        } else {
            candidate.mutual_follow_jaccard = Some(0.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use std::collections::HashMap;

    fn make_query(mutual_ids: Option<Vec<String>>) -> RecommendationQueryPayload {
        RecommendationQueryPayload {
            request_id: "req-jaccard".to_string(),
            user_id: "user-1".to_string(),
            limit: 20,
            mutual_follow_ids: mutual_ids,
            ..Default::default()
        }
    }

    fn make_candidate() -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: "p1".to_string(),
            author_id: "author-1".to_string(),
            content: String::new(),
            created_at: Utc::now(),
            ..Default::default()
        }
    }

    #[test]
    fn computes_score_from_mutual_follow_ids() {
        let query = make_query(Some(vec!["a".into(), "b".into(), "c".into()]));
        let mut c = make_candidate();
        MutualFollowJaccardHydrator::hydrate(&query, &mut c);
        let score = c.mutual_follow_jaccard.unwrap();
        assert!((score - 0.06).abs() < 0.01); // 3/50
    }

    #[test]
    fn defaults_to_zero_without_mutual_ids() {
        let query = make_query(None);
        let mut c = make_candidate();
        MutualFollowJaccardHydrator::hydrate(&query, &mut c);
        assert_eq!(c.mutual_follow_jaccard, Some(0.0));
    }

    #[test]
    fn caps_at_one() {
        let ids: Vec<String> = (0..100).map(|i| format!("u{i}")).collect();
        let query = make_query(Some(ids));
        let mut c = make_candidate();
        MutualFollowJaccardHydrator::hydrate(&query, &mut c);
        assert_eq!(c.mutual_follow_jaccard, Some(1.0));
    }

    #[test]
    fn preserves_existing_score() {
        let query = make_query(Some(vec!["a".into()]));
        let mut c = make_candidate();
        c.mutual_follow_jaccard = Some(0.42);
        MutualFollowJaccardHydrator::hydrate(&query, &mut c);
        assert_eq!(c.mutual_follow_jaccard, Some(0.42));
    }
}
