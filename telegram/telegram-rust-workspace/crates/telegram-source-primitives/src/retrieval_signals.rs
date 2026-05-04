pub const RETRIEVAL_SECONDARY_SOURCE_COUNT_FIELD: &str = "retrievalSecondarySourceCount";
pub const RETRIEVAL_SAME_LANE_SOURCE_COUNT_FIELD: &str = "retrievalSameLaneSourceCount";
pub const RETRIEVAL_CROSS_LANE_SOURCE_COUNT_FIELD: &str = "retrievalCrossLaneSourceCount";
pub const RETRIEVAL_EFFECTIVE_SOURCE_COUNT_FIELD: &str = "retrievalEffectiveSourceCount";
pub const RETRIEVAL_SOURCE_DIVERSITY_SCORE_FIELD: &str = "retrievalSourceDiversityScore";
pub const RETRIEVAL_CROSS_LANE_BONUS_FIELD: &str = "retrievalCrossLaneBonus";
pub const RETRIEVAL_MULTI_SOURCE_BONUS_FIELD: &str = "retrievalMultiSourceBonus";
pub const RETRIEVAL_EVIDENCE_CONFIDENCE_FIELD: &str = "retrievalEvidenceConfidence";
pub const RETRIEVAL_SOURCE_COUNT_FIELD: &str = "retrievalSourceCount";
pub const RETRIEVAL_SOURCE_RANK_SCORE_FIELD: &str = "retrievalSourceRankScore";
pub const RETRIEVAL_SOURCE_SCORE_FIELD: &str = "retrievalSourceScore";

pub const RETRIEVAL_DENSE_VECTOR_SCORE_FIELD: &str = "retrievalDenseVectorScore";
pub const RETRIEVAL_TOPIC_COVERAGE_SCORE_FIELD: &str = "retrievalTopicCoverageScore";
pub const RETRIEVAL_CANDIDATE_CLUSTER_SCORE_FIELD: &str = "retrievalCandidateClusterScore";
pub const RETRIEVAL_AUTHOR_PRIOR_FIELD: &str = "retrievalAuthorPrior";
pub const RETRIEVAL_AUTHOR_GRAPH_PRIOR_FIELD: &str = "retrievalAuthorGraphPrior";

#[cfg(test)]
mod tests {
    use super::{
        RETRIEVAL_CROSS_LANE_SOURCE_COUNT_FIELD, RETRIEVAL_DENSE_VECTOR_SCORE_FIELD,
        RETRIEVAL_EVIDENCE_CONFIDENCE_FIELD, RETRIEVAL_MULTI_SOURCE_BONUS_FIELD,
        RETRIEVAL_SOURCE_DIVERSITY_SCORE_FIELD,
    };

    #[test]
    fn exports_stable_retrieval_signal_fields() {
        assert_eq!(
            RETRIEVAL_CROSS_LANE_SOURCE_COUNT_FIELD,
            "retrievalCrossLaneSourceCount"
        );
        assert_eq!(
            RETRIEVAL_SOURCE_DIVERSITY_SCORE_FIELD,
            "retrievalSourceDiversityScore"
        );
        assert_eq!(
            RETRIEVAL_MULTI_SOURCE_BONUS_FIELD,
            "retrievalMultiSourceBonus"
        );
        assert_eq!(
            RETRIEVAL_EVIDENCE_CONFIDENCE_FIELD,
            "retrievalEvidenceConfidence"
        );
        assert_eq!(
            RETRIEVAL_DENSE_VECTOR_SCORE_FIELD,
            "retrievalDenseVectorScore"
        );
    }
}
