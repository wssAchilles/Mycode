use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

pub const PIPELINE_COMPONENT_ORDER_HASH_VERSION: &str = "pipeline_component_order_hash_v1";

pub fn build_component_order_hash(groups: &[&[String]]) -> String {
    let mut hasher = DefaultHasher::new();
    for group in groups {
        "|".hash(&mut hasher);
        for component in *group {
            component.hash(&mut hasher);
            ";".hash(&mut hasher);
        }
    }
    format!("{:016x}", hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::{PIPELINE_COMPONENT_ORDER_HASH_VERSION, build_component_order_hash};

    #[test]
    fn hashes_component_groups_with_order_sensitivity() {
        let sources = vec!["FollowingSource".to_string(), "GraphSource".to_string()];
        let filters = vec!["SeenFilter".to_string(), "QualityFilter".to_string()];
        let reordered_sources = vec!["GraphSource".to_string(), "FollowingSource".to_string()];

        let hash = build_component_order_hash(&[sources.as_slice(), filters.as_slice()]);
        let same_hash = build_component_order_hash(&[sources.as_slice(), filters.as_slice()]);
        let reordered_hash =
            build_component_order_hash(&[reordered_sources.as_slice(), filters.as_slice()]);

        assert_eq!(
            PIPELINE_COMPONENT_ORDER_HASH_VERSION,
            "pipeline_component_order_hash_v1"
        );
        assert_eq!(hash, same_hash);
        assert_ne!(hash, reordered_hash);
        assert_eq!(hash.len(), 16);
    }
}
