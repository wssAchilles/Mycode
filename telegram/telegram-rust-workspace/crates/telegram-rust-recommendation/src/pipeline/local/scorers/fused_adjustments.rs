use crate::contracts::{RecommendationCandidatePayload, RecommendationStagePayload};

use super::affinity::{
    apply_author_affinity, apply_cold_start_interest, apply_interest_decay,
    author_affinity_enabled, author_affinity_stage, cold_start_interest_plan,
    cold_start_interest_stage, interest_decay_plan, interest_decay_stage,
};
use super::calibration::{
    apply_content_quality, apply_recency, apply_score_calibration, content_quality_enabled,
    content_quality_stage, recency_adjustment_plan, recency_stage, score_calibration_enabled,
    score_calibration_stage,
};
use super::exploration::{
    apply_bandit_exploration, apply_exploration, bandit_exploration_plan, bandit_exploration_stage,
    exploration_plan, exploration_stage,
};
use super::metadata::{apply_oon, oon_stage};
use super::runner::ScoringContext;
use super::suppression::{
    apply_fatigue, apply_session_suppression, fatigue_plan, fatigue_stage,
    session_suppression_plan, session_suppression_stage,
};
use super::trends::{
    apply_news_trend_link, apply_trend_affinity, apply_trend_personalization, news_trend_link_plan,
    news_trend_link_stage, trend_affinity_plan, trend_affinity_stage, trend_personalization_plan,
    trend_personalization_stage,
};

#[derive(Debug)]
pub(super) struct FusedAdjustmentExecution {
    pub candidates: Vec<RecommendationCandidatePayload>,
    pub stages: Vec<RecommendationStagePayload>,
}

pub(super) fn run_fused_foundation_adjustment_group(
    ctx: &ScoringContext,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> FusedAdjustmentExecution {
    let input_count = candidates.len();
    let score_calibration_enabled = score_calibration_enabled(ctx.query);
    let content_quality_enabled = content_quality_enabled(ctx.query);
    let author_affinity_enabled = author_affinity_enabled(ctx.query);
    let recency_plan = recency_adjustment_plan(ctx.query);
    let cold_start_plan = cold_start_interest_plan(ctx.query);

    for candidate in &mut candidates {
        if score_calibration_enabled {
            apply_score_calibration(ctx, candidate);
        }
        if content_quality_enabled {
            apply_content_quality(candidate);
        }
        if author_affinity_enabled {
            apply_author_affinity(ctx, candidate);
        }
        if let Some(plan) = &recency_plan {
            apply_recency(candidate, plan);
        }
        if let Some(plan) = &cold_start_plan {
            apply_cold_start_interest(ctx.query, candidate, plan);
        }
    }

    FusedAdjustmentExecution {
        candidates,
        stages: vec![
            score_calibration_stage(input_count, score_calibration_enabled),
            content_quality_stage(input_count, content_quality_enabled),
            author_affinity_stage(input_count, author_affinity_enabled),
            recency_stage(input_count, recency_plan.is_some()),
            cold_start_interest_stage(input_count, cold_start_plan.is_some()),
        ],
    }
}

pub(super) fn run_fused_trend_adjustment_group(
    ctx: &ScoringContext,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> FusedAdjustmentExecution {
    let input_count = candidates.len();
    let trend_affinity_plan = trend_affinity_plan(ctx.query);
    let trend_personalization_plan = trend_personalization_plan(ctx);
    let news_trend_link_plan = news_trend_link_plan(ctx.query);

    for candidate in &mut candidates {
        if let Some(plan) = &trend_affinity_plan {
            apply_trend_affinity(candidate, plan);
        }
        if let Some(plan) = &trend_personalization_plan {
            apply_trend_personalization(ctx, candidate, plan);
        }
        if let Some(plan) = &news_trend_link_plan {
            apply_news_trend_link(candidate, plan);
        }
    }

    FusedAdjustmentExecution {
        candidates,
        stages: vec![
            trend_affinity_stage(input_count, trend_affinity_plan.is_some()),
            trend_personalization_stage(input_count, trend_personalization_plan.is_some()),
            news_trend_link_stage(input_count, news_trend_link_plan.is_some()),
        ],
    }
}

pub(super) fn run_fused_interest_exploration_group(
    ctx: &ScoringContext,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> FusedAdjustmentExecution {
    let input_count = candidates.len();
    let interest_decay_plan = interest_decay_plan(ctx);
    let exploration_plan = exploration_plan(ctx);
    let bandit_exploration_plan = bandit_exploration_plan(ctx);

    for candidate in &mut candidates {
        if let Some(plan) = &interest_decay_plan {
            apply_interest_decay(ctx, candidate, plan);
        }
        if let Some(plan) = &exploration_plan {
            apply_exploration(ctx, candidate, plan);
        }
        if let Some(plan) = &bandit_exploration_plan {
            apply_bandit_exploration(ctx, candidate, plan);
        }
    }

    FusedAdjustmentExecution {
        candidates,
        stages: vec![
            interest_decay_stage(input_count, interest_decay_plan.is_some()),
            exploration_stage(input_count, exploration_plan.is_some()),
            bandit_exploration_stage(input_count, bandit_exploration_plan.is_some()),
        ],
    }
}

pub(super) fn run_fused_suppression_adjustment_group(
    ctx: &ScoringContext,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> FusedAdjustmentExecution {
    let input_count = candidates.len();
    let fatigue_plan = fatigue_plan(ctx);
    let session_suppression_plan = session_suppression_plan(ctx);

    for candidate in &mut candidates {
        if let Some(plan) = &fatigue_plan {
            apply_fatigue(ctx, candidate, plan);
        }
        if let Some(plan) = &session_suppression_plan {
            apply_session_suppression(ctx, candidate, plan);
        }
        apply_oon(ctx, candidate);
    }

    FusedAdjustmentExecution {
        candidates,
        stages: vec![
            fatigue_stage(input_count, fatigue_plan.is_some()),
            session_suppression_stage(input_count, session_suppression_plan.is_some()),
            oon_stage(input_count),
        ],
    }
}
