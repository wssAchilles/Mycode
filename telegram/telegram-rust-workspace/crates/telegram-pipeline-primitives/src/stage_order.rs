pub const PIPELINE_STAGE_ORDER_VERSION: &str = "pipeline_stage_order_v1";

pub const CANONICAL_PIPELINE_STAGE_ORDER: &[&str] = &[
    crate::PIPELINE_STAGE_QUERY_HYDRATORS,
    crate::PIPELINE_STAGE_SOURCES,
    crate::PIPELINE_STAGE_CANDIDATE_HYDRATORS,
    crate::PIPELINE_STAGE_FILTERS,
    crate::PIPELINE_STAGE_SCORERS,
    crate::PIPELINE_STAGE_SELECTORS,
    crate::PIPELINE_STAGE_POST_SELECTION_HYDRATORS,
    crate::PIPELINE_STAGE_POST_SELECTION_FILTERS,
    crate::PIPELINE_STAGE_SIDE_EFFECTS,
];

pub fn pipeline_stage_index(stage: &str) -> Option<usize> {
    CANONICAL_PIPELINE_STAGE_ORDER
        .iter()
        .position(|expected| *expected == stage)
}

pub fn validate_pipeline_stage_order(stages: &[&str]) -> Result<(), String> {
    let mut previous_index = None;

    for stage in stages {
        let Some(index) = pipeline_stage_index(stage) else {
            return Err(format!("unknown_pipeline_stage: {stage}"));
        };

        if let Some(previous) = previous_index
            && index < previous
        {
            return Err(format!("pipeline_stage_order_regressed: {stage}"));
        }
        previous_index = Some(index);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        CANONICAL_PIPELINE_STAGE_ORDER, PIPELINE_STAGE_ORDER_VERSION, pipeline_stage_index,
        validate_pipeline_stage_order,
    };
    use crate::{
        PIPELINE_STAGE_FILTERS, PIPELINE_STAGE_QUERY_HYDRATORS, PIPELINE_STAGE_SCORERS,
        PIPELINE_STAGE_SELECTORS, PIPELINE_STAGE_SOURCES,
    };

    #[test]
    fn exports_canonical_pipeline_stage_order() {
        assert_eq!(PIPELINE_STAGE_ORDER_VERSION, "pipeline_stage_order_v1");
        assert_eq!(
            CANONICAL_PIPELINE_STAGE_ORDER.first().copied(),
            Some(PIPELINE_STAGE_QUERY_HYDRATORS)
        );
        assert_eq!(
            CANONICAL_PIPELINE_STAGE_ORDER.last().copied(),
            Some(crate::PIPELINE_STAGE_SIDE_EFFECTS)
        );
        assert!(pipeline_stage_index(PIPELINE_STAGE_SCORERS).is_some());
    }

    #[test]
    fn accepts_repeated_components_inside_the_same_stage() {
        let stages = [
            PIPELINE_STAGE_QUERY_HYDRATORS,
            PIPELINE_STAGE_SOURCES,
            PIPELINE_STAGE_SOURCES,
            PIPELINE_STAGE_FILTERS,
            PIPELINE_STAGE_SCORERS,
            PIPELINE_STAGE_SELECTORS,
        ];

        validate_pipeline_stage_order(&stages).expect("valid stage order");
    }

    #[test]
    fn rejects_stage_regression() {
        let stages = [
            PIPELINE_STAGE_QUERY_HYDRATORS,
            PIPELINE_STAGE_SCORERS,
            PIPELINE_STAGE_FILTERS,
        ];

        assert_eq!(
            validate_pipeline_stage_order(&stages).expect_err("stage regression"),
            "pipeline_stage_order_regressed: filters"
        );
    }
}
