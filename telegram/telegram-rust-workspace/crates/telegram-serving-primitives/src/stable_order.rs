use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

pub const SERVING_STABLE_ORDER_MODE: &str = "score_created_at_post_author_v1";
pub const SERVING_STABLE_ORDER_MODE_FIELD: &str = "stableOrderMode";

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StableOrderCandidateKey<'a> {
    pub post_id: &'a str,
    pub author_id: &'a str,
    pub created_at_ms: i64,
    pub score: f64,
    pub recall_source: &'a str,
}

pub fn build_stable_order_key_from_parts(
    candidates: &[StableOrderCandidateKey<'_>],
    in_network_only: bool,
) -> String {
    let mut hasher = DefaultHasher::new();
    in_network_only.hash(&mut hasher);

    for candidate in candidates {
        candidate.post_id.hash(&mut hasher);
        candidate.author_id.hash(&mut hasher);
        candidate.created_at_ms.hash(&mut hasher);
        candidate.score.to_bits().hash(&mut hasher);
        candidate.recall_source.hash(&mut hasher);
    }

    format!("{:016x}", hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::{
        SERVING_STABLE_ORDER_MODE, SERVING_STABLE_ORDER_MODE_FIELD, StableOrderCandidateKey,
        build_stable_order_key_from_parts,
    };

    #[test]
    fn exports_stable_order_contract() {
        assert_eq!(SERVING_STABLE_ORDER_MODE, "score_created_at_post_author_v1");
        assert_eq!(SERVING_STABLE_ORDER_MODE_FIELD, "stableOrderMode");
    }

    #[test]
    fn stable_order_key_changes_with_candidate_order() {
        let left = [
            StableOrderCandidateKey {
                post_id: "post-1",
                author_id: "author-1",
                created_at_ms: 1,
                score: 0.9,
                recall_source: "GraphSource",
            },
            StableOrderCandidateKey {
                post_id: "post-2",
                author_id: "author-2",
                created_at_ms: 2,
                score: 0.8,
                recall_source: "PopularSource",
            },
        ];
        let right = [left[1], left[0]];

        assert_ne!(
            build_stable_order_key_from_parts(&left, false),
            build_stable_order_key_from_parts(&right, false)
        );
    }
}
