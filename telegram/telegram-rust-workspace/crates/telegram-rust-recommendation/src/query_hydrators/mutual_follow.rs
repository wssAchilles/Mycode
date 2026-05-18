use std::collections::HashSet;

/// Hydrator that computes mutual follow relationships.
///
/// Intersects the user's following list with their followers list
/// to produce a `mutual_follow_ids` list. Used in the reranking stage
/// to boost content from mutual connections.
pub struct MutualFollowHydrator;

impl MutualFollowHydrator {
    pub fn name() -> &'static str {
        "MutualFollowQueryHydrator"
    }

    /// Compute mutual follow IDs by intersecting following and followers lists.
    pub fn compute_mutual_follows(
        following_ids: &[String],
        follower_ids: &[String],
    ) -> Vec<String> {
        let following_set: HashSet<&String> = following_ids.iter().collect();
        let follower_set: HashSet<&String> = follower_ids.iter().collect();

        following_set
            .intersection(&follower_set)
            .map(|id| (*id).clone())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computes_intersection() {
        let following = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let followers = vec!["b".to_string(), "c".to_string(), "d".to_string()];

        let mutual = MutualFollowHydrator::compute_mutual_follows(&following, &followers);
        let mut sorted = mutual;
        sorted.sort();
        assert_eq!(sorted, vec!["b".to_string(), "c".to_string()]);
    }

    #[test]
    fn empty_intersection() {
        let following = vec!["a".to_string()];
        let followers = vec!["b".to_string()];

        let mutual = MutualFollowHydrator::compute_mutual_follows(&following, &followers);
        assert!(mutual.is_empty());
    }

    #[test]
    fn empty_inputs() {
        assert!(MutualFollowHydrator::compute_mutual_follows(&[], &[]).is_empty());
    }

    #[test]
    fn full_overlap() {
        let ids = vec!["a".to_string(), "b".to_string()];
        let mutual = MutualFollowHydrator::compute_mutual_follows(&ids, &ids);
        assert_eq!(mutual.len(), 2);
    }
}
