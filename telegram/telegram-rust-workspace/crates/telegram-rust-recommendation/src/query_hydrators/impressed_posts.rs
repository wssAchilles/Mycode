use crate::contracts::RecommendationQueryPayload;

/// Hydrator that populates `impressed_post_ids` from the ImpressionBloomFilter.
///
/// In production this reads from the bloom filter or a secondary store.
/// The stub ensures the field is populated from `seen_ids` when the bloom
/// filter is unavailable, so ImpressionDecayFactor has data to work with.
pub struct ImpressedPostsQueryHydrator;

impl ImpressedPostsQueryHydrator {
    pub fn name() -> &'static str {
        "ImpressedPostsQueryHydrator"
    }

    /// Populate impressed_post_ids from seen_ids if empty.
    ///
    /// Production impl would read from ImpressionBloomFilter; stub falls
    /// back to seen_ids as a conservative approximation.
    pub fn hydrate(query: &mut RecommendationQueryPayload) {
        if query.impressed_post_ids.is_empty() {
            query.impressed_post_ids = query.seen_ids.clone();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn make_query(impressed: Vec<String>, seen: Vec<String>) -> RecommendationQueryPayload {
        RecommendationQueryPayload {
            request_id: "req-impressed-test".to_string(),
            user_id: "user-1".to_string(),
            limit: 20,
            seen_ids: seen,
            impressed_post_ids: impressed,
            ..Default::default()
        }
    }

    #[test]
    fn falls_back_to_seen_ids_when_empty() {
        let mut query = make_query(Vec::new(), vec!["p1".to_string(), "p2".to_string()]);
        ImpressedPostsQueryHydrator::hydrate(&mut query);
        assert_eq!(query.impressed_post_ids, vec!["p1", "p2"]);
    }

    #[test]
    fn preserves_existing_impressed_ids() {
        let mut query = make_query(
            vec!["existing".to_string()],
            vec!["p1".to_string()],
        );
        ImpressedPostsQueryHydrator::hydrate(&mut query);
        assert_eq!(query.impressed_post_ids, vec!["existing"]);
    }

    #[test]
    fn handles_empty_seen_ids() {
        let mut query = make_query(Vec::new(), Vec::new());
        ImpressedPostsQueryHydrator::hydrate(&mut query);
        assert!(query.impressed_post_ids.is_empty());
    }
}
