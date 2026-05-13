use std::collections::HashMap;

use serde_json::Value;
use telegram_pipeline_primitives::{PIPELINE_STAGE_KIND_SOURCE, annotate_stage_contract_detail};
use telegram_source_primitives::{
    RECENT_HOT_DETAIL_FIELD, RECENT_HOT_STORE_SOURCE, annotate_source_stage_detail,
};

use crate::contracts::RecommendationStagePayload;

pub(crate) fn build_recent_hot_stage(
    duration_ms: u64,
    output_count: usize,
) -> RecommendationStagePayload {
    let mut detail = HashMap::from([(
        RECENT_HOT_DETAIL_FIELD.to_string(),
        Value::Bool(output_count > 0),
    )]);
    annotate_stage_contract_detail(
        &mut detail,
        RECENT_HOT_STORE_SOURCE,
        PIPELINE_STAGE_KIND_SOURCE,
    );
    annotate_source_stage_detail(&mut detail, RECENT_HOT_STORE_SOURCE, true, output_count);

    RecommendationStagePayload {
        name: RECENT_HOT_STORE_SOURCE.to_string(),
        enabled: true,
        duration_ms,
        input_count: 1,
        output_count,
        removed_count: None,
        detail: Some(detail),
    }
}

#[cfg(test)]
mod tests {
    use telegram_pipeline_primitives::{
        PIPELINE_STAGE_DETAIL_STAGE_KIND_FIELD, PIPELINE_STAGE_KIND_SOURCE,
    };
    use telegram_source_primitives::{
        RECENT_HOT_DETAIL_FIELD, RECENT_HOT_STORE_SOURCE, SOURCE_STAGE_CANDIDATE_COUNT_FIELD,
        SOURCE_STAGE_CONTRACT_VERSION_FIELD, SOURCE_STAGE_SOURCE_NAME_FIELD,
    };

    use super::build_recent_hot_stage;

    #[test]
    fn builds_recent_hot_stage_with_source_contract_detail() {
        let stage = build_recent_hot_stage(6, 3);
        let detail = stage.detail.as_ref().expect("recent hot detail");

        assert_eq!(stage.name, RECENT_HOT_STORE_SOURCE);
        assert_eq!(stage.output_count, 3);
        assert_eq!(
            detail
                .get(RECENT_HOT_DETAIL_FIELD)
                .and_then(serde_json::Value::as_bool),
            Some(true)
        );
        assert_eq!(
            detail
                .get(PIPELINE_STAGE_DETAIL_STAGE_KIND_FIELD)
                .and_then(serde_json::Value::as_str),
            Some(PIPELINE_STAGE_KIND_SOURCE)
        );
        assert_eq!(
            detail
                .get(SOURCE_STAGE_SOURCE_NAME_FIELD)
                .and_then(serde_json::Value::as_str),
            Some(RECENT_HOT_STORE_SOURCE)
        );
        assert_eq!(
            detail
                .get(SOURCE_STAGE_CANDIDATE_COUNT_FIELD)
                .and_then(serde_json::Value::as_u64),
            Some(3)
        );
        assert!(detail.contains_key(SOURCE_STAGE_CONTRACT_VERSION_FIELD));
    }
}
