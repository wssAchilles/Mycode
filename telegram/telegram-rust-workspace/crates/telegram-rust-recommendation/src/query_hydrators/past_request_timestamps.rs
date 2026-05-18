use chrono::Utc;

use crate::contracts::RecommendationQueryPayload;

/// Hydrator that populates `past_request_timestamps` for frequency control.
///
/// In production this reads from Redis (`timestamps:{user_id}`).
/// The stub implementation seeds from the current request time so the
/// downstream frequency-control logic has a non-empty signal to work with.
pub struct PastRequestTimestampsQueryHydrator;

impl PastRequestTimestampsQueryHydrator {
    pub fn name() -> &'static str {
        "PastRequestTimestampsQueryHydrator"
    }

    /// Populate past_request_timestamps if empty.
    ///
    /// Production impl would read from Redis; stub seeds with `now` so the
    /// frequency decay scorer has at least one data point.
    pub fn hydrate(query: &mut RecommendationQueryPayload) {
        if query.past_request_timestamps.is_empty() {
            query.past_request_timestamps = vec![Utc::now()];
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{DateTime, Utc};

    fn make_query(timestamps: Vec<DateTime<Utc>>) -> RecommendationQueryPayload {
        RecommendationQueryPayload {
            request_id: "req-ts-test".to_string(),
            user_id: "user-1".to_string(),
            limit: 20,
            past_request_timestamps: timestamps,
            ..Default::default()
        }
    }

    #[test]
    fn seeds_timestamp_when_empty() {
        let mut query = make_query(Vec::new());
        PastRequestTimestampsQueryHydrator::hydrate(&mut query);
        assert_eq!(query.past_request_timestamps.len(), 1);
    }

    #[test]
    fn preserves_existing_timestamps() {
        let ts = DateTime::parse_from_rfc3339("2026-01-01T00:00:00Z")
            .unwrap()
            .to_utc();
        let mut query = make_query(vec![ts]);
        PastRequestTimestampsQueryHydrator::hydrate(&mut query);
        assert_eq!(query.past_request_timestamps.len(), 1);
        assert_eq!(query.past_request_timestamps[0], ts);
    }
}
