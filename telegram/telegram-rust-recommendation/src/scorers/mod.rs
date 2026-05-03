use crate::pipeline::local::scorers::local_scorer_stage_names;

pub const MODEL_PROVIDER_SCORER_NAMES: &[&str] = &["PhoenixScorer", "EngagementScorer"];

pub fn configured_scorers() -> Vec<String> {
    MODEL_PROVIDER_SCORER_NAMES
        .iter()
        .map(|name| (*name).to_string())
        .chain(local_scorer_stage_names())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{MODEL_PROVIDER_SCORER_NAMES, configured_scorers};

    #[test]
    fn configured_scorers_include_provider_then_local_ladder() {
        let scorers = configured_scorers();

        assert_eq!(
            &scorers[..MODEL_PROVIDER_SCORER_NAMES.len()],
            ["PhoenixScorer", "EngagementScorer",]
        );
        assert!(scorers.contains(&"LightweightPhoenixScorer".to_string()));
        assert!(scorers.contains(&"TrendAffinityScorer".to_string()));
        assert!(scorers.contains(&"TrendPersonalizationScorer".to_string()));
        assert!(scorers.contains(&"NewsTrendLinkScorer".to_string()));
        assert!(scorers.contains(&"InterestDecayScorer".to_string()));
        assert!(scorers.contains(&"IntraRequestDiversityScorer".to_string()));
        assert_eq!(
            scorers.last().map(String::as_str),
            Some("ScoreContractScorer")
        );
    }
}
