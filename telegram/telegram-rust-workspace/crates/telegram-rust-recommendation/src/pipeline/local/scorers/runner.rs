use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};
use crate::pipeline::local::ranking::{
    RankingAdjustmentGroupSpec, RankingLadderPlan, RankingStageKind, RankingStageSpec,
    validate_ranking_adjustment_registry,
};
use crate::pipeline::local::signals::user_actions::UserActionProfile;
use serde_json::Value;
use telegram_component_primitives::scorers::{
    AUTHOR_AFFINITY_SCORER, AUTHOR_DIVERSITY_SCORER, BANDIT_EXPLORATION_SCORER,
    COLD_START_INTEREST_SCORER, CONTENT_QUALITY_SCORER, EXPLORATION_SCORER, FATIGUE_SCORER,
    INTEREST_DECAY_SCORER, INTRA_REQUEST_DIVERSITY_SCORER, LIGHTWEIGHT_PHOENIX_SCORER,
    NEWS_TREND_LINK_SCORER, OUT_OF_NETWORK_SCORER, RECENCY_SCORER, SCORE_CALIBRATION_SCORER,
    SCORE_CONTRACT_SCORER, SESSION_SUPPRESSION_SCORER, TREND_AFFINITY_SCORER,
    TREND_PERSONALIZATION_SCORER, WEIGHTED_SCORER,
};
use telegram_ranking_primitives::{
    RANKING_FUSED_GROUP_FIELD, RANKING_FUSED_GROUP_STAGES_FIELD,
    RANKING_FUSED_STAGE_APPLIED_COUNT_FIELD, RANKING_FUSED_STAGE_SKIPPED_REASON_FIELD,
};

#[cfg(debug_assertions)]
use super::ownership::{assert_fused_candidate_field_writes, assert_stage_candidate_field_writes};
use super::stage_detail::attach_ranking_stage_detail;
use super::{
    author_affinity_scorer, author_diversity_scorer, bandit_exploration_scorer,
    cold_start_interest_scorer, content_quality_scorer, exploration_scorer, fatigue_scorer,
    interest_decay_scorer, intra_request_diversity_scorer, lightweight_phoenix_scorer,
    news_trend_link_scorer, oon_scorer, recency_scorer, run_fused_foundation_adjustment_group,
    run_fused_interest_exploration_group, run_fused_suppression_adjustment_group,
    run_fused_trend_adjustment_group, score_calibration_scorer, score_contract_scorer,
    session_suppression_scorer, trend_affinity_scorer, trend_personalization_scorer,
    weighted_scorer,
};

pub struct ScoringContext<'a> {
    pub query: &'a RecommendationQueryPayload,
    action_profile: std::sync::OnceLock<UserActionProfile>,
}

impl<'a> ScoringContext<'a> {
    pub fn new(query: &'a RecommendationQueryPayload) -> Self {
        Self {
            query,
            action_profile: std::sync::OnceLock::new(),
        }
    }

    pub fn action_profile(&self) -> &UserActionProfile {
        self.action_profile
            .get_or_init(|| UserActionProfile::from_query(self.query))
    }
}

pub struct LocalScoringExecution {
    pub candidates: Vec<RecommendationCandidatePayload>,
    pub stages: Vec<RecommendationStagePayload>,
}

pub fn run_local_scorers(
    query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> LocalScoringExecution {
    debug_assert!(
        validate_local_ranking_ladder().is_ok(),
        "local ranking ladder must satisfy score contract invariants"
    );

    let ctx = ScoringContext::new(query);
    let mut current = candidates;
    let mut stages = Vec::new();
    let mut fused_adjustment_stages = Vec::new();

    for step in local_scorer_steps() {
        if let Some(group) = fused_adjustment_group_start(step.spec.stage_name) {
            #[cfg(debug_assertions)]
            let before = current.clone();
            let fused_execution = run_fused_adjustment_group(group, &ctx, current);
            #[cfg(debug_assertions)]
            assert_fused_candidate_field_writes(
                group.name(),
                group.stages(),
                &before,
                &fused_execution.candidates,
            );
            current = fused_execution.candidates;
            fused_adjustment_stages = fused_execution.stages;
            push_fused_adjustment_stage(
                &mut stages,
                &mut fused_adjustment_stages,
                step.spec,
                current.len(),
            );
            continue;
        }

        if is_fused_adjustment_group_member(step.spec.stage_name) {
            push_fused_adjustment_stage(
                &mut stages,
                &mut fused_adjustment_stages,
                step.spec,
                current.len(),
            );
            continue;
        }

        #[cfg(debug_assertions)]
        let stage_input = current.clone();
        let (next, mut stage) = (step.scorer)(&ctx, current);
        #[cfg(debug_assertions)]
        assert_stage_candidate_field_writes(step.spec.stage_name, &stage_input, &next);
        attach_ranking_stage_detail(&mut stage, step.spec);
        current = next;
        stages.push(stage);
    }

    LocalScoringExecution {
        candidates: current,
        stages,
    }
}

#[derive(Debug, Clone, Copy)]
enum FusedAdjustmentGroup {
    Foundation,
    Trend,
    InterestExploration,
    Suppression,
}

impl FusedAdjustmentGroup {
    const fn name(self) -> &'static str {
        match self {
            Self::Foundation => "fused_foundation_adjustments",
            Self::Trend => "fused_trend_adjustments",
            Self::InterestExploration => "fused_interest_exploration_adjustments",
            Self::Suppression => "fused_suppression_adjustments",
        }
    }

    const fn stages(self) -> &'static [&'static str] {
        match self {
            Self::Foundation => FUSED_FOUNDATION_ADJUSTMENT_STAGES,
            Self::Trend => FUSED_TREND_ADJUSTMENT_STAGES,
            Self::InterestExploration => FUSED_INTEREST_EXPLORATION_ADJUSTMENT_STAGES,
            Self::Suppression => FUSED_SUPPRESSION_ADJUSTMENT_STAGES,
        }
    }
}

const FUSED_FOUNDATION_ADJUSTMENT_STAGES: &[&str] = &[
    SCORE_CALIBRATION_SCORER,
    CONTENT_QUALITY_SCORER,
    AUTHOR_AFFINITY_SCORER,
    RECENCY_SCORER,
    COLD_START_INTEREST_SCORER,
];

const FUSED_TREND_ADJUSTMENT_STAGES: &[&str] = &[
    TREND_AFFINITY_SCORER,
    TREND_PERSONALIZATION_SCORER,
    NEWS_TREND_LINK_SCORER,
];

const FUSED_INTEREST_EXPLORATION_ADJUSTMENT_STAGES: &[&str] = &[
    INTEREST_DECAY_SCORER,
    EXPLORATION_SCORER,
    BANDIT_EXPLORATION_SCORER,
];

const FUSED_SUPPRESSION_ADJUSTMENT_STAGES: &[&str] = &[
    FATIGUE_SCORER,
    SESSION_SUPPRESSION_SCORER,
    OUT_OF_NETWORK_SCORER,
];

const LOCAL_RANKING_ADJUSTMENT_GROUP_SPECS: &[RankingAdjustmentGroupSpec] = &[
    RankingAdjustmentGroupSpec::new(
        "fused_foundation_adjustments",
        FUSED_FOUNDATION_ADJUSTMENT_STAGES,
    ),
    RankingAdjustmentGroupSpec::new("fused_trend_adjustments", FUSED_TREND_ADJUSTMENT_STAGES),
    RankingAdjustmentGroupSpec::new(
        "fused_interest_exploration_adjustments",
        FUSED_INTEREST_EXPLORATION_ADJUSTMENT_STAGES,
    ),
    RankingAdjustmentGroupSpec::new(
        "fused_suppression_adjustments",
        FUSED_SUPPRESSION_ADJUSTMENT_STAGES,
    ),
];

fn fused_adjustment_group_start(stage_name: &str) -> Option<FusedAdjustmentGroup> {
    match stage_name {
        SCORE_CALIBRATION_SCORER => Some(FusedAdjustmentGroup::Foundation),
        TREND_AFFINITY_SCORER => Some(FusedAdjustmentGroup::Trend),
        INTEREST_DECAY_SCORER => Some(FusedAdjustmentGroup::InterestExploration),
        FATIGUE_SCORER => Some(FusedAdjustmentGroup::Suppression),
        _ => None,
    }
}

fn run_fused_adjustment_group(
    group: FusedAdjustmentGroup,
    ctx: &ScoringContext,
    candidates: Vec<RecommendationCandidatePayload>,
) -> super::fused_adjustments::FusedAdjustmentExecution {
    match group {
        FusedAdjustmentGroup::Foundation => run_fused_foundation_adjustment_group(ctx, candidates),
        FusedAdjustmentGroup::Trend => run_fused_trend_adjustment_group(ctx, candidates),
        FusedAdjustmentGroup::InterestExploration => {
            run_fused_interest_exploration_group(ctx, candidates)
        }
        FusedAdjustmentGroup::Suppression => {
            run_fused_suppression_adjustment_group(ctx, candidates)
        }
    }
}

fn is_fused_adjustment_group_member(stage_name: &str) -> bool {
    [
        &FUSED_FOUNDATION_ADJUSTMENT_STAGES[1..],
        &FUSED_TREND_ADJUSTMENT_STAGES[1..],
        &FUSED_INTEREST_EXPLORATION_ADJUSTMENT_STAGES[1..],
        &FUSED_SUPPRESSION_ADJUSTMENT_STAGES[1..],
    ]
    .into_iter()
    .flatten()
    .any(|member| *member == stage_name)
}

fn push_fused_adjustment_stage(
    stages: &mut Vec<RecommendationStagePayload>,
    fused_adjustment_stages: &mut Vec<RecommendationStagePayload>,
    spec: RankingStageSpec,
    fallback_input_count: usize,
) {
    let group = fused_adjustment_group_for_stage(spec.stage_name);
    let mut stage = take_fused_adjustment_stage(
        fused_adjustment_stages,
        spec.stage_name,
        fallback_input_count,
    );
    if let Some(group) = group {
        attach_fused_adjustment_detail(&mut stage, group);
    }
    attach_ranking_stage_detail(&mut stage, spec);
    stages.push(stage);
}

fn fused_adjustment_group_for_stage(stage_name: &str) -> Option<FusedAdjustmentGroup> {
    [
        FusedAdjustmentGroup::Foundation,
        FusedAdjustmentGroup::Trend,
        FusedAdjustmentGroup::InterestExploration,
        FusedAdjustmentGroup::Suppression,
    ]
    .into_iter()
    .find(|group| group.stages().contains(&stage_name))
}

fn attach_fused_adjustment_detail(
    stage: &mut RecommendationStagePayload,
    group: FusedAdjustmentGroup,
) {
    let detail = stage.detail.get_or_insert_with(Default::default);
    detail.insert(
        RANKING_FUSED_GROUP_FIELD.to_string(),
        Value::String(group.name().to_string()),
    );
    detail.insert(
        RANKING_FUSED_GROUP_STAGES_FIELD.to_string(),
        Value::Array(
            group
                .stages()
                .iter()
                .map(|stage_name| Value::String((*stage_name).to_string()))
                .collect(),
        ),
    );
    detail.insert(
        RANKING_FUSED_STAGE_APPLIED_COUNT_FIELD.to_string(),
        Value::from(if stage.enabled { stage.input_count } else { 0 }),
    );
    if !stage.enabled {
        detail.insert(
            RANKING_FUSED_STAGE_SKIPPED_REASON_FIELD.to_string(),
            Value::String("stage_disabled_by_query_or_policy".to_string()),
        );
    }
}

fn take_fused_adjustment_stage(
    fused_adjustment_stages: &mut Vec<RecommendationStagePayload>,
    stage_name: &str,
    fallback_input_count: usize,
) -> RecommendationStagePayload {
    if let Some(position) = fused_adjustment_stages
        .iter()
        .position(|stage| stage.name == stage_name)
    {
        return fused_adjustment_stages.remove(position);
    }

    RecommendationStagePayload {
        name: stage_name.to_string(),
        enabled: false,
        duration_ms: 0,
        input_count: fallback_input_count,
        output_count: fallback_input_count,
        removed_count: Some(0),
        detail: None,
    }
}

pub fn local_scorer_stage_names() -> Vec<String> {
    local_ranking_ladder_plan().stage_names()
}

pub fn local_ranking_ladder_specs() -> Vec<RankingStageSpec> {
    local_scorer_steps().iter().map(|step| step.spec).collect()
}

pub fn local_ranking_ladder_plan() -> RankingLadderPlan {
    RankingLadderPlan::new(local_ranking_ladder_specs())
}

pub fn local_ranking_adjustment_group_specs() -> &'static [RankingAdjustmentGroupSpec] {
    LOCAL_RANKING_ADJUSTMENT_GROUP_SPECS
}

pub fn validate_local_ranking_ladder() -> Result<(), String> {
    local_ranking_ladder_plan().validate()?;
    validate_local_ranking_adjustment_registry()
}

pub fn validate_local_ranking_adjustment_registry() -> Result<(), String> {
    validate_ranking_adjustment_registry(
        local_ranking_adjustment_group_specs(),
        &local_ranking_ladder_specs(),
    )
}

type ScorerFn = fn(
    &ScoringContext,
    Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
);

#[derive(Clone, Copy)]
struct LocalScorerStep {
    scorer: ScorerFn,
    spec: RankingStageSpec,
}

#[cfg(test)]
pub(super) fn run_local_scorers_without_fusion(
    query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> LocalScoringExecution {
    let ctx = ScoringContext::new(query);
    let mut current = candidates;
    let mut stages = Vec::new();

    for step in local_scorer_steps() {
        let (next, mut stage) = (step.scorer)(&ctx, current);
        attach_ranking_stage_detail(&mut stage, step.spec);
        current = next;
        stages.push(stage);
    }

    LocalScoringExecution {
        candidates: current,
        stages,
    }
}

#[cfg(test)]
pub(super) fn local_scoring_execution_passes() -> Vec<(&'static str, Vec<&'static str>)> {
    vec![
        ("model_scores", vec![LIGHTWEIGHT_PHOENIX_SCORER]),
        ("weighted_score", vec![WEIGHTED_SCORER]),
        (
            "fused_foundation_adjustments",
            FUSED_FOUNDATION_ADJUSTMENT_STAGES.to_vec(),
        ),
        (
            "fused_trend_adjustments",
            FUSED_TREND_ADJUSTMENT_STAGES.to_vec(),
        ),
        (
            "fused_interest_exploration_adjustments",
            FUSED_INTEREST_EXPLORATION_ADJUSTMENT_STAGES.to_vec(),
        ),
        (
            "fused_suppression_adjustments",
            FUSED_SUPPRESSION_ADJUSTMENT_STAGES.to_vec(),
        ),
        (
            "request_order_diversity",
            vec![INTRA_REQUEST_DIVERSITY_SCORER],
        ),
        ("final_score", vec![AUTHOR_DIVERSITY_SCORER]),
        ("metadata", vec![SCORE_CONTRACT_SCORER]),
    ]
}

fn local_scorer_steps() -> [LocalScorerStep; 19] {
    use RankingStageKind::{FinalScore, Metadata, ModelScores, ScoreAdjustment, WeightedScore};

    [
        step(
            LIGHTWEIGHT_PHOENIX_SCORER,
            ModelScores,
            false,
            false,
            true,
            lightweight_phoenix_scorer,
        ),
        step(
            WEIGHTED_SCORER,
            WeightedScore,
            true,
            false,
            false,
            weighted_scorer,
        ),
        step(
            SCORE_CALIBRATION_SCORER,
            ScoreAdjustment,
            true,
            false,
            false,
            score_calibration_scorer,
        ),
        step(
            CONTENT_QUALITY_SCORER,
            ScoreAdjustment,
            true,
            false,
            false,
            content_quality_scorer,
        ),
        step(
            AUTHOR_AFFINITY_SCORER,
            ScoreAdjustment,
            true,
            false,
            false,
            author_affinity_scorer,
        ),
        step(
            RECENCY_SCORER,
            ScoreAdjustment,
            true,
            false,
            false,
            recency_scorer,
        ),
        step(
            COLD_START_INTEREST_SCORER,
            ScoreAdjustment,
            true,
            false,
            false,
            cold_start_interest_scorer,
        ),
        step(
            TREND_AFFINITY_SCORER,
            ScoreAdjustment,
            true,
            false,
            false,
            trend_affinity_scorer,
        ),
        step(
            TREND_PERSONALIZATION_SCORER,
            ScoreAdjustment,
            true,
            false,
            false,
            trend_personalization_scorer,
        ),
        step(
            NEWS_TREND_LINK_SCORER,
            ScoreAdjustment,
            true,
            false,
            false,
            news_trend_link_scorer,
        ),
        step(
            INTEREST_DECAY_SCORER,
            ScoreAdjustment,
            true,
            false,
            false,
            interest_decay_scorer,
        ),
        step(
            EXPLORATION_SCORER,
            ScoreAdjustment,
            true,
            false,
            false,
            exploration_scorer,
        ),
        step(
            BANDIT_EXPLORATION_SCORER,
            ScoreAdjustment,
            true,
            false,
            false,
            bandit_exploration_scorer,
        ),
        step(
            FATIGUE_SCORER,
            ScoreAdjustment,
            true,
            false,
            false,
            fatigue_scorer,
        ),
        step(
            SESSION_SUPPRESSION_SCORER,
            ScoreAdjustment,
            true,
            false,
            false,
            session_suppression_scorer,
        ),
        step(
            OUT_OF_NETWORK_SCORER,
            ScoreAdjustment,
            true,
            false,
            false,
            oon_scorer,
        ),
        step(
            INTRA_REQUEST_DIVERSITY_SCORER,
            ScoreAdjustment,
            true,
            false,
            false,
            intra_request_diversity_scorer,
        ),
        step(
            AUTHOR_DIVERSITY_SCORER,
            FinalScore,
            false,
            true,
            false,
            author_diversity_scorer,
        ),
        step(
            SCORE_CONTRACT_SCORER,
            Metadata,
            false,
            false,
            false,
            score_contract_scorer,
        ),
    ]
}

fn step(
    stage_name: &'static str,
    kind: RankingStageKind,
    writes_weighted_score: bool,
    writes_final_score: bool,
    fallback_model_scorer: bool,
    scorer: ScorerFn,
) -> LocalScorerStep {
    LocalScorerStep {
        scorer,
        spec: RankingStageSpec::new(
            stage_name,
            kind,
            writes_weighted_score,
            writes_final_score,
            fallback_model_scorer,
        ),
    }
}
