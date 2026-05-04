use std::collections::HashMap;

use serde_json::Value;

use crate::PIPELINE_OWNER_RUST;

pub const PIPELINE_STAGE_DETAIL_ERROR_FIELD: &str = "error";
pub const PIPELINE_STAGE_DETAIL_ERROR_CLASS_FIELD: &str = "errorClass";
pub const PIPELINE_STAGE_DETAIL_EXECUTION_MODE_FIELD: &str = "executionMode";
pub const PIPELINE_STAGE_DETAIL_DEGRADE_MODE_FIELD: &str = "degradeMode";
pub const PIPELINE_STAGE_DETAIL_OWNER_FIELD: &str = "owner";
pub const PIPELINE_STAGE_DETAIL_DISABLED_BY_CIRCUIT_FIELD: &str = "disabledByCircuit";

pub const PIPELINE_STAGE_EXECUTION_MODE_CIRCUIT_BREAKER_SKIP: &str = "circuit_breaker_skip";
pub const PIPELINE_STAGE_DEGRADE_MODE_FAIL_OPEN: &str = "fail_open";
pub const PIPELINE_STAGE_DISABLED_BY_ROLLING_COMPONENT_HEALTH: &str = "rolling_component_health";

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

    use super::{
        PIPELINE_STAGE_DETAIL_DISABLED_BY_CIRCUIT_FIELD,
        PIPELINE_STAGE_DETAIL_EXECUTION_MODE_FIELD, PIPELINE_STAGE_DETAIL_OWNER_FIELD,
        PIPELINE_STAGE_EXECUTION_MODE_CIRCUIT_BREAKER_SKIP, annotate_rust_owned_stage_detail,
        circuit_breaker_skip_detail,
    };

    #[test]
    fn annotates_rust_owned_stage_detail() {
        let mut detail = HashMap::new();

        annotate_rust_owned_stage_detail(&mut detail, "rust_local_rules_v1");

        assert_eq!(
            detail
                .get(PIPELINE_STAGE_DETAIL_EXECUTION_MODE_FIELD)
                .and_then(serde_json::Value::as_str),
            Some("rust_local_rules_v1")
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
