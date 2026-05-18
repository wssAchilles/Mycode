use serde::{Deserialize, Serialize};

/// User demographics for content relevance and regional sorting.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Demographics {
    /// Age range (min, max) if known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub age_range: Option<(u32, u32)>,
    /// User's region/country code.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
    /// User's primary language.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
}

/// Hydrator that injects user demographics into the query.
///
/// Reads age, region, and language from the user profile
/// for content relevance scoring and regional content boosting.
pub struct DemographicsQueryHydrator;

impl DemographicsQueryHydrator {
    pub fn name() -> &'static str {
        "DemographicsQueryHydrator"
    }

    /// Build demographics from user profile data.
    pub fn from_profile(
        age: Option<u32>,
        region: Option<String>,
        language: Option<String>,
    ) -> Demographics {
        Demographics {
            age_range: age.map(|a| {
                // Map single age to a range (±5 years).
                let min = a.saturating_sub(5);
                let max = a + 5;
                (min, max)
            }),
            region,
            language,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn demographics_default_is_empty() {
        let d = Demographics::default();
        assert!(d.age_range.is_none());
        assert!(d.region.is_none());
        assert!(d.language.is_none());
    }

    #[test]
    fn from_profile_maps_age_to_range() {
        let d = DemographicsQueryHydrator::from_profile(
            Some(25),
            Some("US".to_string()),
            Some("en".to_string()),
        );
        assert_eq!(d.age_range, Some((20, 30)));
        assert_eq!(d.region.as_deref(), Some("US"));
        assert_eq!(d.language.as_deref(), Some("en"));
    }

    #[test]
    fn from_profile_handles_young_user() {
        let d = DemographicsQueryHydrator::from_profile(Some(3), None, None);
        assert_eq!(d.age_range, Some((0, 8)));
    }

    #[test]
    fn from_profile_handles_no_age() {
        let d = DemographicsQueryHydrator::from_profile(None, Some("JP".to_string()), None);
        assert!(d.age_range.is_none());
        assert_eq!(d.region.as_deref(), Some("JP"));
    }

    #[test]
    fn demographics_serialization_roundtrip() {
        let d = Demographics {
            age_range: Some((20, 30)),
            region: Some("US".to_string()),
            language: Some("en".to_string()),
        };
        let json = serde_json::to_string(&d).unwrap();
        let back: Demographics = serde_json::from_str(&json).unwrap();
        assert_eq!(back.age_range, Some((20, 30)));
    }
}
