use std::collections::HashSet;

use telegram_pipeline_primitives::{annotate_stage_contract_detail, circuit_breaker_skip_detail};

use crate::contracts::RecommendationStagePayload;

pub(super) fn active_component_names(
    configured_components: &[String],
    circuit_open_components: &[String],
    stage_kind: &str,
    input_count: usize,
) -> (Option<Vec<String>>, Vec<RecommendationStagePayload>) {
    if configured_components.is_empty() {
        return (None, Vec::new());
    }

    let circuit_open = circuit_open_components
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();

    let mut active = Vec::new();
    let mut skipped = Vec::new();
    for component in configured_components {
        if circuit_open.contains(component.as_str()) {
            skipped.push(build_circuit_disabled_component_stage(
                component,
                stage_kind,
                input_count,
            ));
        } else {
            active.push(component.clone());
        }
    }

    (Some(active), skipped)
}

fn build_circuit_disabled_component_stage(
    component: &str,
    stage_kind: &str,
    input_count: usize,
) -> RecommendationStagePayload {
    let mut detail = circuit_breaker_skip_detail();
    annotate_stage_contract_detail(&mut detail, component, stage_kind);

    RecommendationStagePayload {
        name: component.to_string(),
        enabled: false,
        duration_ms: 0,
        input_count,
        output_count: input_count,
        removed_count: None,
        detail: Some(detail),
    }
}

#[cfg(test)]
mod tests {
    use super::active_component_names;
    use telegram_pipeline_primitives::{
        PIPELINE_STAGE_DETAIL_STAGE_KIND_FIELD, PIPELINE_STAGE_DETAIL_STAGE_NAME_FIELD,
        PIPELINE_STAGE_KIND_HYDRATOR, stage_detail_contract_violations,
    };

    #[test]
    fn active_component_names_returns_explicit_components_without_circuit_breaks() {
        let configured = vec![
            "AuthorInfoHydrator".to_string(),
            "StatsHydrator".to_string(),
        ];

        let (active, skipped) =
            active_component_names(&configured, &[], PIPELINE_STAGE_KIND_HYDRATOR, 12);

        assert_eq!(active, Some(configured));
        assert!(skipped.is_empty());
    }

    #[test]
    fn active_component_names_excludes_circuit_open_components() {
        let configured = vec![
            "AuthorInfoHydrator".to_string(),
            "StatsHydrator".to_string(),
        ];

        let (active, skipped) = active_component_names(
            &configured,
            &["StatsHydrator".to_string()],
            PIPELINE_STAGE_KIND_HYDRATOR,
            12,
        );

        assert_eq!(active, Some(vec!["AuthorInfoHydrator".to_string()]));
        assert_eq!(skipped.len(), 1);
        assert_eq!(skipped[0].name, "StatsHydrator");
        assert!(!skipped[0].enabled);
        let detail = skipped[0].detail.as_ref().expect("skip detail");
        assert_eq!(
            detail
                .get(PIPELINE_STAGE_DETAIL_STAGE_NAME_FIELD)
                .and_then(serde_json::Value::as_str),
            Some("StatsHydrator")
        );
        assert_eq!(
            detail
                .get(PIPELINE_STAGE_DETAIL_STAGE_KIND_FIELD)
                .and_then(serde_json::Value::as_str),
            Some(PIPELINE_STAGE_KIND_HYDRATOR)
        );
        assert!(
            stage_detail_contract_violations(
                "StatsHydrator",
                PIPELINE_STAGE_KIND_HYDRATOR,
                Some(detail),
            )
            .is_empty()
        );
    }
}
