use std::collections::HashMap;

use serde_json::Value;
use telegram_filter_primitives::{
    FILTER_DECISION_DROP_COUNT_FIELD, filter_stage_detail_contract_violations,
};
use telegram_pipeline_primitives::{
    PIPELINE_STAGE_DETAIL_STAGE_KIND_FIELD, PIPELINE_STAGE_KIND_FILTER,
    PIPELINE_STAGE_KIND_RANKING, PIPELINE_STAGE_KIND_SELECTOR, PIPELINE_STAGE_KIND_SERVING,
    PIPELINE_STAGE_KIND_SOURCE_MERGE, stage_detail_contract_violations,
};
use telegram_ranking_primitives::{RankingStageSpec, ranking_stage_detail_contract_violations};
use telegram_selector_primitives::selector_detail_contract_violations;
use telegram_serving_primitives::{
    serving_page_build_detail_contract_violations, serving_stage_detail_contract_violations,
};
use telegram_source_primitives::source_merge_detail_contract_violations;

pub(super) fn replay_stage_contract_violations(
    ranking_specs: &[RankingStageSpec],
    stage_details: &HashMap<String, HashMap<String, Value>>,
) -> Vec<String> {
    let ranking_specs_by_name = ranking_specs
        .iter()
        .map(|spec| (spec.stage_name, *spec))
        .collect::<HashMap<_, _>>();
    let mut violations = Vec::new();

    for (stage_name, detail) in stage_details {
        let Some(stage_kind) = detail
            .get(PIPELINE_STAGE_DETAIL_STAGE_KIND_FIELD)
            .and_then(Value::as_str)
        else {
            violations.push(format!(
                "stage_contract_violation:replay_stage_detail_kind_missing: stage={stage_name}"
            ));
            continue;
        };

        append_prefixed(
            &mut violations,
            "stage_contract_violation",
            stage_detail_contract_violations(stage_name, stage_kind, Some(detail)),
        );

        match stage_kind {
            PIPELINE_STAGE_KIND_FILTER => {
                let removed_count = detail
                    .get(FILTER_DECISION_DROP_COUNT_FIELD)
                    .and_then(Value::as_u64)
                    .unwrap_or_default() as usize;
                append_prefixed(
                    &mut violations,
                    "filter_contract_violation",
                    filter_stage_detail_contract_violations(removed_count, Some(detail)),
                );
            }
            PIPELINE_STAGE_KIND_RANKING => {
                let Some(spec) = ranking_specs_by_name.get(stage_name.as_str()).copied() else {
                    violations.push(format!(
                        "ranking_contract_violation:replay_ranking_stage_spec_missing: stage={stage_name}"
                    ));
                    continue;
                };
                append_prefixed(
                    &mut violations,
                    "ranking_contract_violation",
                    ranking_stage_detail_contract_violations(spec, Some(detail)),
                );
            }
            PIPELINE_STAGE_KIND_SELECTOR => {
                append_prefixed(
                    &mut violations,
                    "selector_contract_violation",
                    selector_detail_contract_violations(Some(detail)),
                );
            }
            PIPELINE_STAGE_KIND_SERVING => {
                append_prefixed(
                    &mut violations,
                    "serving_contract_violation",
                    serving_stage_detail_contract_violations(Some(detail)),
                );
                append_prefixed(
                    &mut violations,
                    "serving_page_build_contract_violation",
                    serving_page_build_detail_contract_violations(Some(detail)),
                );
            }
            PIPELINE_STAGE_KIND_SOURCE_MERGE => {
                append_prefixed(
                    &mut violations,
                    "source_merge_contract_violation",
                    source_merge_detail_contract_violations(Some(detail)),
                );
            }
            _ => {}
        }
    }

    violations
}

fn append_prefixed(violations: &mut Vec<String>, prefix: &str, new_violations: Vec<String>) {
    violations.extend(
        new_violations
            .into_iter()
            .map(|violation| format!("{prefix}:{violation}")),
    );
}
