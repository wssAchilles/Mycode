use crate::clients::redis_features::RealtimeUserFeatures;
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
    AUTHOR_AFFINITY_SCORER, AUTHOR_DECAY_FACTOR, AUTHOR_DIVERSITY_SCORER,
    BANDIT_EXPLORATION_SCORER, COLD_START_INTEREST_SCORER, CONTENT_QUALITY_SCORER,
    EMBEDDING_DIVERSITY_FACTOR, EXPLORATION_SCORER, FATIGUE_SCORER, FEEDBACK_FATIGUE_FACTOR,
    IMPRESSION_DECAY_FACTOR, IN_NETWORK_BOOST_FACTOR, INTEREST_DECAY_SCORER,
    INTRA_REQUEST_DIVERSITY_SCORER, LIGHTWEIGHT_PHOENIX_SCORER, LISTWISE_AUTHOR_DECAY,
    LISTWISE_SOURCE_DECAY, LONG_FORM_FACTOR, MEDIA_CLUSTER_DIVERSITY_FACTOR, MEDIA_RICH_FACTOR,
    MTL_NORMALIZATION_FACTOR, NEW_AUTHOR_FACTOR, NEWS_TREND_LINK_SCORER, OUT_OF_NETWORK_SCORER,
    RECENCY_SCORER, SCORE_CALIBRATION_SCORER, SCORE_CONTRACT_SCORER, SESSION_SUPPRESSION_SCORER,
    SOURCE_DIVERSITY_FACTOR, TREND_AFFINITY_SCORER, TREND_PERSONALIZATION_SCORER,
    VERIFIED_AUTHOR_FACTOR, WEIGHTED_SCORER,
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
    heuristic_rescoring, interest_decay_scorer, intra_request_diversity_scorer,
    lightweight_phoenix_scorer, listwise_reranking, news_trend_link_scorer, oon_scorer,
    recency_scorer, run_fused_foundation_adjustment_group, run_fused_interest_exploration_group,
    run_fused_suppression_adjustment_group, run_fused_trend_adjustment_group,
    score_calibration_scorer, score_contract_scorer, session_suppression_scorer,
    trend_affinity_scorer, trend_personalization_scorer, weighted_scorer,
};

pub struct ScoringContext<'a> {
    pub query: &'a RecommendationQueryPayload,
    action_profile: std::sync::OnceLock<UserActionProfile>,
    pub realtime_features: Option<RealtimeUserFeatures>,
}

impl<'a> ScoringContext<'a> {
    pub fn new(query: &'a RecommendationQueryPayload) -> Self {
        Self {
            query,
            action_profile: std::sync::OnceLock::new(),
            realtime_features: None,
        }
    }

    pub fn with_realtime_features(mut self, features: RealtimeUserFeatures) -> Self {
        self.realtime_features = Some(features);
        self
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
    HeuristicRescoring,
    ListwiseReranking,
}

impl FusedAdjustmentGroup {
    const fn name(self) -> &'static str {
        match self {
            Self::Foundation => "fused_foundation_adjustments",
            Self::Trend => "fused_trend_adjustments",
            Self::InterestExploration => "fused_interest_exploration_adjustments",
            Self::Suppression => "fused_suppression_adjustments",
            Self::HeuristicRescoring => "fused_heuristic_rescoring",
            Self::ListwiseReranking => "fused_listwise_reranking",
        }
    }

    const fn stages(self) -> &'static [&'static str] {
        match self {
            Self::Foundation => FUSED_FOUNDATION_ADJUSTMENT_STAGES,
            Self::Trend => FUSED_TREND_ADJUSTMENT_STAGES,
            Self::InterestExploration => FUSED_INTEREST_EXPLORATION_ADJUSTMENT_STAGES,
            Self::Suppression => FUSED_SUPPRESSION_ADJUSTMENT_STAGES,
            Self::HeuristicRescoring => FUSED_HEURISTIC_RESCORING_STAGES,
            Self::ListwiseReranking => FUSED_LISTWISE_RERANKING_STAGES,
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

const FUSED_HEURISTIC_RESCORING_STAGES: &[&str] = &[
    AUTHOR_DECAY_FACTOR,
    IMPRESSION_DECAY_FACTOR,
    SOURCE_DIVERSITY_FACTOR,
    IN_NETWORK_BOOST_FACTOR,
    NEW_AUTHOR_FACTOR,
    LONG_FORM_FACTOR,
    MEDIA_RICH_FACTOR,
    VERIFIED_AUTHOR_FACTOR,
    FEEDBACK_FATIGUE_FACTOR,
    MEDIA_CLUSTER_DIVERSITY_FACTOR,
    EMBEDDING_DIVERSITY_FACTOR,
    MTL_NORMALIZATION_FACTOR,
];

const FUSED_LISTWISE_RERANKING_STAGES: &[&str] = &[LISTWISE_AUTHOR_DECAY, LISTWISE_SOURCE_DECAY];

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
    RankingAdjustmentGroupSpec::new(
        "fused_heuristic_rescoring",
        FUSED_HEURISTIC_RESCORING_STAGES,
    ),
    RankingAdjustmentGroupSpec::new("fused_listwise_reranking", FUSED_LISTWISE_RERANKING_STAGES),
];

fn fused_adjustment_group_start(stage_name: &str) -> Option<FusedAdjustmentGroup> {
    match stage_name {
        SCORE_CALIBRATION_SCORER => Some(FusedAdjustmentGroup::Foundation),
        TREND_AFFINITY_SCORER => Some(FusedAdjustmentGroup::Trend),
        INTEREST_DECAY_SCORER => Some(FusedAdjustmentGroup::InterestExploration),
        FATIGUE_SCORER => Some(FusedAdjustmentGroup::Suppression),
        AUTHOR_DECAY_FACTOR => Some(FusedAdjustmentGroup::HeuristicRescoring),
        LISTWISE_AUTHOR_DECAY => Some(FusedAdjustmentGroup::ListwiseReranking),
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
        FusedAdjustmentGroup::HeuristicRescoring => {
            let execution = heuristic_rescoring::run_heuristic_rescoring_group(ctx, candidates);
            super::fused_adjustments::FusedAdjustmentExecution {
                candidates: execution.candidates,
                stages: execution.stages,
            }
        }
        FusedAdjustmentGroup::ListwiseReranking => {
            let execution = listwise_reranking::run_listwise_reranking_group(ctx, candidates);
            super::fused_adjustments::FusedAdjustmentExecution {
                candidates: execution.candidates,
                stages: execution.stages,
            }
        }
    }
}

fn is_fused_adjustment_group_member(stage_name: &str) -> bool {
    [
        &FUSED_FOUNDATION_ADJUSTMENT_STAGES[1..],
        &FUSED_TREND_ADJUSTMENT_STAGES[1..],
        &FUSED_INTEREST_EXPLORATION_ADJUSTMENT_STAGES[1..],
        &FUSED_SUPPRESSION_ADJUSTMENT_STAGES[1..],
        &FUSED_HEURISTIC_RESCORING_STAGES[1..],
        &FUSED_LISTWISE_RERANKING_STAGES[1..],
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
        FusedAdjustmentGroup::HeuristicRescoring,
        FusedAdjustmentGroup::ListwiseReranking,
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
        (
            "fused_heuristic_rescoring",
            FUSED_HEURISTIC_RESCORING_STAGES.to_vec(),
        ),
        (
            "fused_listwise_reranking",
            FUSED_LISTWISE_RERANKING_STAGES.to_vec(),
        ),
        ("final_score", vec![AUTHOR_DIVERSITY_SCORER]),
        ("metadata", vec![SCORE_CONTRACT_SCORER]),
    ]
}

fn local_scorer_steps() -> [LocalScorerStep; 33] {
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
            AUTHOR_DECAY_FACTOR,
            ScoreAdjustment,
            true,
            false,
            false,
            noop_scorer,
        ),
        step(
            IMPRESSION_DECAY_FACTOR,
            ScoreAdjustment,
            true,
            false,
            false,
            noop_scorer,
        ),
        step(
            SOURCE_DIVERSITY_FACTOR,
            ScoreAdjustment,
            true,
            false,
            false,
            noop_scorer,
        ),
        step(
            IN_NETWORK_BOOST_FACTOR,
            ScoreAdjustment,
            true,
            false,
            false,
            noop_scorer,
        ),
        step(
            NEW_AUTHOR_FACTOR,
            ScoreAdjustment,
            true,
            false,
            false,
            noop_scorer,
        ),
        step(
            LONG_FORM_FACTOR,
            ScoreAdjustment,
            true,
            false,
            false,
            noop_scorer,
        ),
        step(
            MEDIA_RICH_FACTOR,
            ScoreAdjustment,
            true,
            false,
            false,
            noop_scorer,
        ),
        step(
            VERIFIED_AUTHOR_FACTOR,
            ScoreAdjustment,
            true,
            false,
            false,
            noop_scorer,
        ),
        step(
            FEEDBACK_FATIGUE_FACTOR,
            ScoreAdjustment,
            true,
            false,
            false,
            noop_scorer,
        ),
        step(
            MEDIA_CLUSTER_DIVERSITY_FACTOR,
            ScoreAdjustment,
            true,
            false,
            false,
            noop_scorer,
        ),
        step(
            EMBEDDING_DIVERSITY_FACTOR,
            ScoreAdjustment,
            true,
            false,
            false,
            noop_scorer,
        ),
        step(
            MTL_NORMALIZATION_FACTOR,
            ScoreAdjustment,
            true,
            false,
            false,
            noop_scorer,
        ),
        step(
            LISTWISE_AUTHOR_DECAY,
            ScoreAdjustment,
            true,
            false,
            false,
            noop_scorer,
        ),
        step(
            LISTWISE_SOURCE_DECAY,
            ScoreAdjustment,
            true,
            false,
            false,
            noop_scorer,
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

/// No-op scorer for fused group members. The actual logic runs in the fused group runner.
fn noop_scorer(
    _ctx: &ScoringContext,
    candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let stage = RecommendationStagePayload {
        name: "noop".to_string(),
        enabled: true,
        duration_ms: 0,
        input_count: candidates.len(),
        output_count: candidates.len(),
        removed_count: Some(0),
        detail: None,
    };
    (candidates, stage)
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
