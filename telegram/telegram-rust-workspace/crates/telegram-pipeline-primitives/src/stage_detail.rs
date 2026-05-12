use std::collections::HashMap;

use serde_json::Value;

use crate::PIPELINE_OWNER_RUST;

pub const PIPELINE_STAGE_DETAIL_ERROR_FIELD: &str = "error";
pub const PIPELINE_STAGE_DETAIL_ERROR_CLASS_FIELD: &str = "errorClass";
pub const PIPELINE_STAGE_DETAIL_EXECUTION_MODE_FIELD: &str = "executionMode";
pub const PIPELINE_STAGE_DETAIL_DEGRADE_MODE_FIELD: &str = "degradeMode";
pub const PIPELINE_STAGE_DETAIL_OWNER_FIELD: &str = "owner";
pub const PIPELINE_STAGE_DETAIL_DISABLED_BY_CIRCUIT_FIELD: &str = "disabledByCircuit";
pub const PIPELINE_STAGE_DETAIL_CONTRACT_VERSION_FIELD: &str = "stageContractVersion";
pub const PIPELINE_STAGE_DETAIL_STAGE_NAME_FIELD: &str = "stageName";
pub const PIPELINE_STAGE_DETAIL_STAGE_KIND_FIELD: &str = "stageKind";
pub const PIPELINE_STAGE_DETAIL_DEGRADED_REASON_FIELD: &str = "degradedReason";

pub const PIPELINE_STAGE_CONTRACT_VERSION: &str = "recommendation_stage_contract_v1";
pub const PIPELINE_STAGE_FIELD_NAME: &str = "name";
pub const PIPELINE_STAGE_FIELD_ENABLED: &str = "enabled";
pub const PIPELINE_STAGE_FIELD_DURATION_MS: &str = "durationMs";
pub const PIPELINE_STAGE_FIELD_INPUT_COUNT: &str = "inputCount";
pub const PIPELINE_STAGE_FIELD_OUTPUT_COUNT: &str = "outputCount";
pub const PIPELINE_STAGE_FIELD_REMOVED_COUNT: &str = "removedCount";
pub const PIPELINE_STAGE_FIELD_DETAIL: &str = "detail";
pub const PIPELINE_STAGE_KIND_SOURCE: &str = "source";
pub const PIPELINE_STAGE_KIND_FILTER: &str = "filter";
pub const PIPELINE_STAGE_KIND_RANKING: &str = "ranking";
pub const PIPELINE_STAGE_KIND_SELECTOR: &str = "selector";
pub const PIPELINE_STAGE_KIND_SERVING: &str = "serving";

pub const PIPELINE_STAGE_PAYLOAD_FIELDS: &[&str] = &[
    PIPELINE_STAGE_FIELD_NAME,
    PIPELINE_STAGE_FIELD_ENABLED,
    PIPELINE_STAGE_FIELD_DURATION_MS,
    PIPELINE_STAGE_FIELD_INPUT_COUNT,
    PIPELINE_STAGE_FIELD_OUTPUT_COUNT,
    PIPELINE_STAGE_FIELD_REMOVED_COUNT,
    PIPELINE_STAGE_FIELD_DETAIL,
];

pub const PIPELINE_STAGE_EXECUTION_MODE_CIRCUIT_BREAKER_SKIP: &str = "circuit_breaker_skip";
pub const PIPELINE_STAGE_DEGRADE_MODE_FAIL_OPEN: &str = "fail_open";
pub const PIPELINE_STAGE_DISABLED_BY_ROLLING_COMPONENT_HEALTH: &str = "rolling_component_health";

pub fn annotate_stage_contract_detail(
    detail: &mut HashMap<String, Value>,
    stage_name: &str,
    stage_kind: &str,
) {
    detail.insert(
        PIPELINE_STAGE_DETAIL_CONTRACT_VERSION_FIELD.to_string(),
        Value::String(PIPELINE_STAGE_CONTRACT_VERSION.to_string()),
    );
    detail.insert(
        PIPELINE_STAGE_DETAIL_STAGE_NAME_FIELD.to_string(),
        Value::String(stage_name.to_string()),
    );
    detail.insert(
        PIPELINE_STAGE_DETAIL_STAGE_KIND_FIELD.to_string(),
        Value::String(stage_kind.to_string()),
    );
}

pub fn annotate_rust_owned_stage_detail(detail: &mut HashMap<String, Value>, execution_mode: &str) {
    detail.insert(
        PIPELINE_STAGE_DETAIL_EXECUTION_MODE_FIELD.to_string(),
        Value::String(execution_mode.to_string()),
    );
    detail.insert(
        PIPELINE_STAGE_DETAIL_OWNER_FIELD.to_string(),
        Value::String(PIPELINE_OWNER_RUST.to_string()),
    );
}

pub fn circuit_breaker_skip_detail() -> HashMap<String, Value> {
    HashMap::from([
        (
            PIPELINE_STAGE_DETAIL_DISABLED_BY_CIRCUIT_FIELD.to_string(),
            Value::String(PIPELINE_STAGE_DISABLED_BY_ROLLING_COMPONENT_HEALTH.to_string()),
        ),
        (
            PIPELINE_STAGE_DETAIL_EXECUTION_MODE_FIELD.to_string(),
            Value::String(PIPELINE_STAGE_EXECUTION_MODE_CIRCUIT_BREAKER_SKIP.to_string()),
        ),
        (
            PIPELINE_STAGE_DETAIL_DEGRADE_MODE_FIELD.to_string(),
            Value::String(PIPELINE_STAGE_DEGRADE_MODE_FAIL_OPEN.to_string()),
        ),
    ])
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use crate::PIPELINE_LOCAL_FILTER_EXECUTION_MODE;

    use super::{
        PIPELINE_STAGE_CONTRACT_VERSION, PIPELINE_STAGE_DETAIL_DISABLED_BY_CIRCUIT_FIELD,
        PIPELINE_STAGE_DETAIL_EXECUTION_MODE_FIELD, PIPELINE_STAGE_DETAIL_OWNER_FIELD,
        PIPELINE_STAGE_DETAIL_STAGE_KIND_FIELD, PIPELINE_STAGE_DETAIL_STAGE_NAME_FIELD,
        PIPELINE_STAGE_EXECUTION_MODE_CIRCUIT_BREAKER_SKIP, PIPELINE_STAGE_FIELD_DETAIL,
        PIPELINE_STAGE_FIELD_DURATION_MS, PIPELINE_STAGE_FIELD_ENABLED,
        PIPELINE_STAGE_FIELD_INPUT_COUNT, PIPELINE_STAGE_FIELD_NAME,
        PIPELINE_STAGE_FIELD_OUTPUT_COUNT, PIPELINE_STAGE_KIND_FILTER, PIPELINE_STAGE_KIND_RANKING,
        PIPELINE_STAGE_KIND_SELECTOR, PIPELINE_STAGE_KIND_SERVING, PIPELINE_STAGE_KIND_SOURCE,
        PIPELINE_STAGE_PAYLOAD_FIELDS, annotate_rust_owned_stage_detail,
        annotate_stage_contract_detail, circuit_breaker_skip_detail,
    };

    #[test]
    fn exports_stage_payload_contract_fields() {
        assert_eq!(
            PIPELINE_STAGE_CONTRACT_VERSION,
            "recommendation_stage_contract_v1"
        );
        assert_eq!(
            PIPELINE_STAGE_PAYLOAD_FIELDS,
            &[
                PIPELINE_STAGE_FIELD_NAME,
                PIPELINE_STAGE_FIELD_ENABLED,
                PIPELINE_STAGE_FIELD_DURATION_MS,
                PIPELINE_STAGE_FIELD_INPUT_COUNT,
                PIPELINE_STAGE_FIELD_OUTPUT_COUNT,
                "removedCount",
                PIPELINE_STAGE_FIELD_DETAIL,
            ]
        );
        assert_eq!(PIPELINE_STAGE_KIND_SOURCE, "source");
        assert_eq!(PIPELINE_STAGE_KIND_FILTER, "filter");
        assert_eq!(PIPELINE_STAGE_KIND_RANKING, "ranking");
        assert_eq!(PIPELINE_STAGE_KIND_SELECTOR, "selector");
        assert_eq!(PIPELINE_STAGE_KIND_SERVING, "serving");
    }

    #[test]
    fn annotates_stage_contract_detail() {
        let mut detail = HashMap::new();

        annotate_stage_contract_detail(&mut detail, "WeightedScorer", "ranking");

        assert_eq!(
            detail
                .get(PIPELINE_STAGE_DETAIL_STAGE_NAME_FIELD)
                .and_then(serde_json::Value::as_str),
            Some("WeightedScorer")
        );
        assert_eq!(
            detail
                .get(PIPELINE_STAGE_DETAIL_STAGE_KIND_FIELD)
                .and_then(serde_json::Value::as_str),
            Some("ranking")
        );
    }

    #[test]
    fn annotates_rust_owned_stage_detail() {
        let mut detail = HashMap::new();

        annotate_rust_owned_stage_detail(&mut detail, PIPELINE_LOCAL_FILTER_EXECUTION_MODE);

        assert_eq!(
            detail
                .get(PIPELINE_STAGE_DETAIL_EXECUTION_MODE_FIELD)
                .and_then(serde_json::Value::as_str),
            Some(PIPELINE_LOCAL_FILTER_EXECUTION_MODE)
        );
        assert_eq!(
            detail
                .get(PIPELINE_STAGE_DETAIL_OWNER_FIELD)
                .and_then(serde_json::Value::as_str),
            Some("rust")
        );
    }

    #[test]
    fn builds_circuit_breaker_skip_detail() {
        let detail = circuit_breaker_skip_detail();

        assert_eq!(
            detail
                .get(PIPELINE_STAGE_DETAIL_DISABLED_BY_CIRCUIT_FIELD)
                .and_then(serde_json::Value::as_str),
            Some("rolling_component_health")
        );
        assert_eq!(
            detail
                .get(PIPELINE_STAGE_DETAIL_EXECUTION_MODE_FIELD)
                .and_then(serde_json::Value::as_str),
            Some(PIPELINE_STAGE_EXECUTION_MODE_CIRCUIT_BREAKER_SKIP)
        );
    }
}
