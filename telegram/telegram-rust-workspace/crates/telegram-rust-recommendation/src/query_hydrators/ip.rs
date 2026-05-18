use crate::contracts::RecommendationQueryPayload;

/// Hydrator that populates `country_code` from the request IP geolocation.
///
/// In production this reads the client IP from request headers and queries
/// a geolocation service. The stub is a no-op pass-through — the country
/// code is expected to be set by the upstream HTTP layer if available.
pub struct IpQueryHydrator;

impl IpQueryHydrator {
    pub fn name() -> &'static str {
        "IpQueryHydrator"
    }

    /// Ensure country_code is populated.
    ///
    /// Production impl would resolve IP → country; stub is a no-op since
    /// the HTTP layer already sets country_code when available.
    pub fn hydrate(_query: &mut RecommendationQueryPayload) {
        // No-op: country_code is set by the HTTP layer.
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_existing_country_code() {
        let mut query = RecommendationQueryPayload {
            request_id: "req-ip-test".to_string(),
            user_id: "user-1".to_string(),
            limit: 20,
            country_code: Some("US".to_string()),
            ..Default::default()
        };
        IpQueryHydrator::hydrate(&mut query);
        assert_eq!(query.country_code.as_deref(), Some("US"));
    }

    #[test]
    fn no_op_when_country_code_absent() {
        let mut query = RecommendationQueryPayload {
            request_id: "req-ip-test".to_string(),
            user_id: "user-1".to_string(),
            limit: 20,
            country_code: None,
            ..Default::default()
        };
        IpQueryHydrator::hydrate(&mut query);
        assert!(query.country_code.is_none());
    }
}
