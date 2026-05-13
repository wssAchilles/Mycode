use std::collections::HashMap;

use telegram_pipeline_primitives::{
    PIPELINE_STAGE_DETAIL_ERROR_CLASS_FIELD, PIPELINE_STAGE_DETAIL_ERROR_FIELD,
};

use crate::contracts::RecommendationStagePayload;

pub(crate) fn build_query_error_stage(stage_name: &str, error: &str) -> RecommendationStagePayload {
    RecommendationStagePayload {
        name: stage_name.to_string(),
        enabled: true,
        duration_ms: 0,
        input_count: 1,
        output_count: 1,
        removed_count: None,
        detail: Some(HashMap::from([(
            PIPELINE_STAGE_DETAIL_ERROR_FIELD.to_string(),
            serde_json::Value::String(error.to_string()),
        )])),
    }
}

pub(crate) fn annotate_query_stage_error_class(
    stage: &mut RecommendationStagePayload,
    error_class: String,
) {
    stage.detail.get_or_insert_with(HashMap::new).insert(
        PIPELINE_STAGE_DETAIL_ERROR_CLASS_FIELD.to_string(),
        serde_json::Value::String(error_class),
    );
}

pub(crate) fn annotate_query_stage_error(stage: &mut RecommendationStagePayload, error: String) {
    stage.detail.get_or_insert_with(HashMap::new).insert(
        PIPELINE_STAGE_DETAIL_ERROR_FIELD.to_string(),
        serde_json::Value::String(error),
    );
}

pub(crate) fn query_stage_error(stage: &RecommendationStagePayload) -> Option<&str> {
    stage
        .detail
        .as_ref()
        .and_then(|detail| detail.get(PIPELINE_STAGE_DETAIL_ERROR_FIELD))
        .and_then(serde_json::Value::as_str)
}

#[cfg(test)]
mod tests {
    use telegram_pipeline_primitives::{
        PIPELINE_STAGE_DETAIL_ERROR_CLASS_FIELD, PIPELINE_STAGE_DETAIL_ERROR_FIELD,
    };

    use super::{
        annotate_query_stage_error, annotate_query_stage_error_class, build_query_error_stage,
        query_stage_error,
    };

    #[test]
    fn builds_query_error_stage_payload() {
        let stage = build_query_error_stage("UserFeaturesQueryHydrator", "provider_timeout");

        assert_eq!(stage.name, "UserFeaturesQueryHydrator");
        assert!(stage.enabled);
        assert_eq!(stage.input_count, 1);
        assert_eq!(stage.output_count, 1);
        assert_eq!(
            stage
                .detail
                .as_ref()
                .and_then(|detail| detail.get(PIPELINE_STAGE_DETAIL_ERROR_FIELD))
                .and_then(serde_json::Value::as_str),
            Some("provider_timeout")
        );
    }

    #[test]
    fn annotates_query_stage_error_fields() {
        let mut stage = build_query_error_stage("UserFeaturesQueryHydrator", "provider_timeout");
        annotate_query_stage_error_class(&mut stage, "timeout".to_string());
        annotate_query_stage_error(&mut stage, "patch_conflict".to_string());

        let detail = stage.detail.as_ref().expect("detail");
        assert_eq!(query_stage_error(&stage), Some("patch_conflict"));
        assert_eq!(
            detail
                .get(PIPELINE_STAGE_DETAIL_ERROR_CLASS_FIELD)
                .and_then(serde_json::Value::as_str),
            Some("timeout")
        );
        assert_eq!(
            detail
                .get(PIPELINE_STAGE_DETAIL_ERROR_FIELD)
                .and_then(serde_json::Value::as_str),
            Some("patch_conflict")
        );
    }
}
