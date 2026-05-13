pub const RANKING_CANDIDATE_FIELD_PHOENIX_SCORES: &str = "phoenix_scores";
pub const RANKING_CANDIDATE_FIELD_ACTION_SCORES: &str = "action_scores";
pub const RANKING_CANDIDATE_FIELD_RANKING_SIGNALS: &str = "ranking_signals";
pub const RANKING_CANDIDATE_FIELD_AUTHOR_AFFINITY_SCORE: &str = "author_affinity_score";
pub const RANKING_CANDIDATE_FIELD_WEIGHTED_SCORE: &str = "weighted_score";
pub const RANKING_CANDIDATE_FIELD_FINAL_SCORE: &str = "score";
pub const RANKING_CANDIDATE_FIELD_SCORE_CONTRACT_VERSION: &str = "score_contract_version";
pub const RANKING_CANDIDATE_FIELD_SCORE_BREAKDOWN_VERSION: &str = "score_breakdown_version";
pub const RANKING_CANDIDATE_FIELD_SCORE_BREAKDOWN: &str = "score_breakdown";
pub const RANKING_CANDIDATE_FIELD_PIPELINE_SCORE: &str = "pipeline_score";

#[cfg(test)]
mod tests {
    use super::{
        RANKING_CANDIDATE_FIELD_ACTION_SCORES, RANKING_CANDIDATE_FIELD_AUTHOR_AFFINITY_SCORE,
        RANKING_CANDIDATE_FIELD_FINAL_SCORE, RANKING_CANDIDATE_FIELD_PHOENIX_SCORES,
        RANKING_CANDIDATE_FIELD_PIPELINE_SCORE, RANKING_CANDIDATE_FIELD_RANKING_SIGNALS,
        RANKING_CANDIDATE_FIELD_SCORE_BREAKDOWN, RANKING_CANDIDATE_FIELD_SCORE_BREAKDOWN_VERSION,
        RANKING_CANDIDATE_FIELD_SCORE_CONTRACT_VERSION, RANKING_CANDIDATE_FIELD_WEIGHTED_SCORE,
    };

    #[test]
    fn exports_candidate_score_field_write_names() {
        assert_eq!(RANKING_CANDIDATE_FIELD_PHOENIX_SCORES, "phoenix_scores");
        assert_eq!(RANKING_CANDIDATE_FIELD_ACTION_SCORES, "action_scores");
        assert_eq!(RANKING_CANDIDATE_FIELD_RANKING_SIGNALS, "ranking_signals");
        assert_eq!(
            RANKING_CANDIDATE_FIELD_AUTHOR_AFFINITY_SCORE,
            "author_affinity_score"
        );
        assert_eq!(RANKING_CANDIDATE_FIELD_WEIGHTED_SCORE, "weighted_score");
        assert_eq!(RANKING_CANDIDATE_FIELD_FINAL_SCORE, "score");
        assert_eq!(
            RANKING_CANDIDATE_FIELD_SCORE_CONTRACT_VERSION,
            "score_contract_version"
        );
        assert_eq!(
            RANKING_CANDIDATE_FIELD_SCORE_BREAKDOWN_VERSION,
            "score_breakdown_version"
        );
        assert_eq!(RANKING_CANDIDATE_FIELD_SCORE_BREAKDOWN, "score_breakdown");
        assert_eq!(RANKING_CANDIDATE_FIELD_PIPELINE_SCORE, "pipeline_score");
    }
}
