use crate::contracts::RecommendationStagePayload;
use crate::pipeline::local::ranking::{
    RankingStageSpec, annotate_ranking_stage_detail, ranking_stage_detail_contract_violations,
};
use serde_json::Value;
use telegram_pipeline_primitives::{PIPELINE_STAGE_KIND_RANKING, annotate_stage_contract_detail};
use telegram_ranking_primitives::RANKING_CANDIDATE_FIELD_WRITES_FIELD;

use super::ownership::candidate_field_write_names_for_stage;

pub(super) fn attach_ranking_stage_detail(
    stage: &mut RecommendationStagePayload,
    spec: RankingStageSpec,
) {
    let detail = stage.detail.get_or_insert_with(Default::default);
    annotate_stage_contract_detail(detail, spec.stage_name, PIPELINE_STAGE_KIND_RANKING);
    annotate_ranking_stage_detail(detail, spec);
    detail.insert(
        RANKING_CANDIDATE_FIELD_WRITES_FIELD.to_string(),
        Value::Array(
            candidate_field_write_names_for_stage(spec.stage_name)
                .into_iter()
                .map(Value::String)
                .collect(),
        ),
    );
    debug_assert!(
        ranking_stage_detail_contract_violations(spec, Some(detail)).is_empty(),
        "ranking stage detail must match ranking ladder spec"
    );
}
