pub mod dedup;
pub mod detail;
pub mod page_build;
pub mod policy;
pub mod rescue;
pub use dedup::*;
pub use detail::*;
pub use page_build::*;
pub use policy::*;
pub use rescue::*;

pub const SERVING_VERSION: &str = "rust_serving_v1";
pub const CURSOR_MODE: &str = "created_at_desc_v1";
pub const SERVED_STATE_VERSION: &str = "related_ids_v1";
pub const ASYNC_SIDE_EFFECT_MODE: &str = "post_response_background_v1";

pub const CACHE_KEY_MODE: &str = "normalized_query_v2";
pub const CACHE_POLICY_MODE: &str = "bounded_short_ttl_v1";

#[cfg(test)]
mod tests {
    use super::{
        ASYNC_SIDE_EFFECT_MODE, CACHE_KEY_MODE, CACHE_POLICY_MODE, CURSOR_MODE,
        SERVED_STATE_VERSION, SERVING_VERSION,
    };

    #[test]
    fn exports_stable_serving_contract_modes() {
        assert_eq!(SERVING_VERSION, "rust_serving_v1");
        assert_eq!(CURSOR_MODE, "created_at_desc_v1");
        assert_eq!(SERVED_STATE_VERSION, "related_ids_v1");
        assert_eq!(ASYNC_SIDE_EFFECT_MODE, "post_response_background_v1");
        assert_eq!(CACHE_KEY_MODE, "normalized_query_v2");
        assert_eq!(CACHE_POLICY_MODE, "bounded_short_ttl_v1");
    }
}
