use std::collections::HashMap;

use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};
use crate::pipeline::local::context::{
    FALLBACK_LANE, IN_NETWORK_LANE, INTEREST_LANE, SOCIAL_EXPANSION_LANE, ranking_policy_keywords,
    ranking_policy_number, ranking_policy_usize,
};
use crate::pipeline::local::signals::user_actions::UserActionProfile;

use super::candidates::{is_news_candidate, is_trend_candidate};

#[derive(Debug, Clone)]
pub(super) struct SelectorConstraints {
    pub(super) lane_floors: HashMap<String, usize>,
    pub(super) lane_ceilings: HashMap<String, usize>,
    pub(super) max_oon_count: usize,
    pub(super) trend_ceiling: usize,
    pub(super) news_ceiling: usize,
    pub(super) exploration_floor: usize,
    pub(super) lane_order: Vec<String>,
}

#[derive(Debug, Clone, Copy)]
pub(super) struct SelectorSoftCaps {
    author_soft_cap: usize,
    topic_soft_cap: usize,
    source_soft_cap: usize,
}

impl SelectorSoftCaps {
    pub(super) fn for_query(
        query: &RecommendationQueryPayload,
        target_size: usize,
        author_soft_cap: usize,
    ) -> Self {
        Self {
            author_soft_cap: author_soft_cap_for_query(query, target_size, author_soft_cap),
            topic_soft_cap: topic_soft_cap_for_query(query, target_size),
            source_soft_cap: source_soft_cap_for_query(query, target_size),
        }
    }

    pub(super) fn enforced(self) -> SelectionLimits {
        self.limits(true)
    }

    pub(super) fn relaxed(self) -> SelectionLimits {
        Self {
            author_soft_cap: self.author_soft_cap + 1,
            topic_soft_cap: self.topic_soft_cap + 1,
            source_soft_cap: self.source_soft_cap + 1,
        }
        .limits(false)
    }

    fn limits(self, enforce_constraints: bool) -> SelectionLimits {
        SelectionLimits {
            author_soft_cap: self.author_soft_cap,
            topic_soft_cap: self.topic_soft_cap,
            source_soft_cap: self.source_soft_cap,
            enforce_constraints,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub(super) struct SelectionLimits {
    pub(super) author_soft_cap: usize,
    pub(super) topic_soft_cap: usize,
    pub(super) source_soft_cap: usize,
    pub(super) enforce_constraints: bool,
}

#[derive(Debug, Clone, Copy)]
pub(super) enum SpecialPoolKind {
    Trend,
    News,
}

#[derive(Debug, Clone, Copy)]
pub(super) struct SpecialPoolRequirement {
    pub(super) kind: SpecialPoolKind,
    pub(super) floor: usize,
}

pub(super) fn window_factor(query: &RecommendationQueryPayload) -> usize {
    match query
        .user_state_context
        .as_ref()
        .map(|context| context.state.as_str())
    {
        Some("cold_start") => 2,
        Some("sparse") | Some("heavy") => 4,
        _ => 3,
    }
}

fn author_soft_cap_for_query(
    query: &RecommendationQueryPayload,
    target_size: usize,
    base_cap: usize,
) -> usize {
    let configured = ranking_policy_usize(query, "author_soft_cap", base_cap);
    match query
        .user_state_context
        .as_ref()
        .map(|context| context.state.as_str())
    {
        Some("cold_start") => (configured + 1).max(2),
        Some("sparse") if target_size >= 8 => (configured + 1).max(2),
        Some("heavy") => configured.max(1),
        _ => configured.max(1),
    }
}

fn topic_soft_cap_for_query(query: &RecommendationQueryPayload, target_size: usize) -> usize {
    let configured_ratio = ranking_policy_number(query, "topic_soft_cap_ratio", -1.0);
    if configured_ratio > 0.0 {
        return ceil_fraction(target_size, configured_ratio.clamp(0.05, 1.0)).max(1);
    }
    match query
        .user_state_context
        .as_ref()
        .map(|context| context.state.as_str())
    {
        Some("cold_start") => target_size.max(1),
        Some("sparse") => ceil_fraction(target_size, 0.38).max(2),
        Some("heavy") => ceil_fraction(target_size, 0.45).max(3),
        _ => ceil_fraction(target_size, 0.42).max(3),
    }
}

fn source_soft_cap_for_query(query: &RecommendationQueryPayload, target_size: usize) -> usize {
    let configured_ratio = ranking_policy_number(query, "source_soft_cap_ratio", -1.0);
    if configured_ratio > 0.0 {
        return ceil_fraction(target_size, configured_ratio.clamp(0.05, 1.0)).max(1);
    }
    match query
        .user_state_context
        .as_ref()
        .map(|context| context.state.as_str())
    {
        Some("cold_start") => target_size.max(1),
        Some("sparse") => ceil_fraction(target_size, 0.48).max(2),
        Some("heavy") => ceil_fraction(target_size, 0.42).max(2),
        _ => ceil_fraction(target_size, 0.5).max(2),
    }
}

pub(super) fn personalized_window_size(
    query: &RecommendationQueryPayload,
    target_size: usize,
) -> usize {
    match query
        .user_state_context
        .as_ref()
        .map(|context| context.state.as_str())
    {
        Some("cold_start") => 0,
        Some("sparse") => ceil_fraction(target_size, 0.2).max(1),
        Some("heavy") => ceil_fraction(target_size, 0.25).max(1),
        _ => 0,
    }
}

pub(super) fn selector_constraints(
    query: &RecommendationQueryPayload,
    target_size: usize,
) -> SelectorConstraints {
    let state = query
        .user_state_context
        .as_ref()
        .map(|context| context.state.as_str())
        .unwrap_or("");

    match state {
        "cold_start" => SelectorConstraints {
            lane_floors: HashMap::from([(
                FALLBACK_LANE.to_string(),
                lane_floor_for_query(query, target_size, "fallback_floor_ratio", 1.0),
            )]),
            lane_ceilings: lane_ceilings_for_query(query, target_size, &[]),
            max_oon_count: max_oon_count_for_query(query, target_size, target_size),
            trend_ceiling: trend_ceiling_for_query(query, target_size, 0.45),
            news_ceiling: target_size,
            exploration_floor: exploration_floor_for_query(query, state, target_size),
            lane_order: vec![FALLBACK_LANE.to_string()],
        },
        "sparse" => SelectorConstraints {
            lane_floors: HashMap::from([
                (
                    IN_NETWORK_LANE.to_string(),
                    lane_floor_for_query(query, target_size, "in_network_floor_ratio", 0.16),
                ),
                (
                    SOCIAL_EXPANSION_LANE.to_string(),
                    lane_floor_for_query(query, target_size, "social_graph_floor_ratio", 0.08),
                ),
                (
                    INTEREST_LANE.to_string(),
                    lane_floor_for_query(query, target_size, "interest_floor_ratio", 0.36),
                ),
            ]),
            lane_ceilings: lane_ceilings_for_query(
                query,
                target_size,
                &[(
                    FALLBACK_LANE,
                    fallback_ceiling_for_query(query, target_size, 0.25),
                )],
            ),
            max_oon_count: max_oon_count_for_query(
                query,
                target_size,
                ceil_fraction(target_size, 0.64),
            ),
            trend_ceiling: trend_ceiling_for_query(query, target_size, 0.34),
            news_ceiling: news_ceiling_for_query(query, target_size, 0.42),
            exploration_floor: exploration_floor_for_query(query, state, target_size),
            lane_order: vec![
                INTEREST_LANE.to_string(),
                SOCIAL_EXPANSION_LANE.to_string(),
                IN_NETWORK_LANE.to_string(),
                FALLBACK_LANE.to_string(),
            ],
        },
        "heavy" => SelectorConstraints {
            lane_floors: HashMap::from([
                (
                    IN_NETWORK_LANE.to_string(),
                    lane_floor_for_query(query, target_size, "in_network_floor_ratio", 0.35),
                ),
                (
                    SOCIAL_EXPANSION_LANE.to_string(),
                    lane_floor_for_query(query, target_size, "social_graph_floor_ratio", 0.16),
                ),
                (
                    INTEREST_LANE.to_string(),
                    lane_floor_for_query(query, target_size, "interest_floor_ratio", 0.18),
                ),
            ]),
            lane_ceilings: lane_ceilings_for_query(
                query,
                target_size,
                &[(
                    FALLBACK_LANE,
                    fallback_ceiling_for_query(query, target_size, 0.12),
                )],
            ),
            max_oon_count: max_oon_count_for_query(
                query,
                target_size,
                ceil_fraction(target_size, 0.42),
            ),
            trend_ceiling: trend_ceiling_for_query(query, target_size, 0.28),
            news_ceiling: news_ceiling_for_query(query, target_size, 0.36),
            exploration_floor: exploration_floor_for_query(query, state, target_size),
            lane_order: vec![
                IN_NETWORK_LANE.to_string(),
                SOCIAL_EXPANSION_LANE.to_string(),
                INTEREST_LANE.to_string(),
                FALLBACK_LANE.to_string(),
            ],
        },
        _ => SelectorConstraints {
            lane_floors: HashMap::from([
                (
                    IN_NETWORK_LANE.to_string(),
                    lane_floor_for_query(query, target_size, "in_network_floor_ratio", 0.32),
                ),
                (
                    SOCIAL_EXPANSION_LANE.to_string(),
                    lane_floor_for_query(query, target_size, "social_graph_floor_ratio", 0.12),
                ),
                (
                    INTEREST_LANE.to_string(),
                    lane_floor_for_query(query, target_size, "interest_floor_ratio", 0.22),
                ),
            ]),
            lane_ceilings: lane_ceilings_for_query(
                query,
                target_size,
                &[(
                    FALLBACK_LANE,
                    fallback_ceiling_for_query(query, target_size, 0.18),
                )],
            ),
            max_oon_count: max_oon_count_for_query(
                query,
                target_size,
                ceil_fraction(target_size, 0.46),
            ),
            trend_ceiling: trend_ceiling_for_query(query, target_size, 0.32),
            news_ceiling: news_ceiling_for_query(query, target_size, 0.38),
            exploration_floor: exploration_floor_for_query(query, state, target_size),
            lane_order: vec![
                IN_NETWORK_LANE.to_string(),
                SOCIAL_EXPANSION_LANE.to_string(),
                INTEREST_LANE.to_string(),
                FALLBACK_LANE.to_string(),
            ],
        },
    }
}

fn lane_floor_for_query(
    query: &RecommendationQueryPayload,
    target_size: usize,
    policy_key: &str,
    default_ratio: f64,
) -> usize {
    let ratio = ranking_policy_number(query, policy_key, default_ratio).clamp(0.0, 1.0);
    ceil_fraction(target_size, ratio).min(target_size)
}

fn lane_ceilings_for_query(
    query: &RecommendationQueryPayload,
    target_size: usize,
    defaults: &[(&str, usize)],
) -> HashMap<String, usize> {
    let mut ceilings = defaults
        .iter()
        .map(|(lane, count)| ((*lane).to_string(), (*count).min(target_size)))
        .collect::<HashMap<_, _>>();

    for (lane, key) in [
        (IN_NETWORK_LANE, "in_network_ceiling_ratio"),
        (SOCIAL_EXPANSION_LANE, "social_graph_ceiling_ratio"),
        (INTEREST_LANE, "interest_ceiling_ratio"),
        (FALLBACK_LANE, "fallback_ceiling_ratio"),
    ] {
        let configured = ranking_policy_number(query, key, -1.0);
        if configured >= 0.0 {
            ceilings.insert(
                lane.to_string(),
                ceil_fraction(target_size, configured.clamp(0.0, 1.0))
                    .max(1)
                    .min(target_size),
            );
        }
    }

    ceilings
}

pub(super) fn special_pool_requirements(
    query: &RecommendationQueryPayload,
    window: &[RecommendationCandidatePayload],
    target_size: usize,
) -> Vec<SpecialPoolRequirement> {
    if target_size < 4 || query.in_network_only {
        return Vec::new();
    }

    let mut requirements = Vec::new();
    let has_trend_policy = query
        .ranking_policy
        .as_ref()
        .and_then(|policy| policy.trend_keywords.as_ref())
        .is_some_and(|keywords| !keywords.is_empty());
    if has_trend_policy && window.iter().any(is_trend_candidate) {
        let floor_ratio = dynamic_special_pool_floor_ratio(
            query,
            window,
            SpecialPoolKind::Trend,
            "trend_floor_ratio",
            0.1,
            0.5,
        );
        requirements.push(SpecialPoolRequirement {
            kind: SpecialPoolKind::Trend,
            floor: ceil_fraction(target_size, floor_ratio).max(1),
        });
    }

    let state = query
        .user_state_context
        .as_ref()
        .map(|context| context.state.as_str())
        .unwrap_or("");
    if state != "cold_start" && target_size >= 8 && window.iter().any(is_news_candidate) {
        let floor_ratio = dynamic_special_pool_floor_ratio(
            query,
            window,
            SpecialPoolKind::News,
            "news_floor_ratio",
            0.08,
            0.4,
        );
        requirements.push(SpecialPoolRequirement {
            kind: SpecialPoolKind::News,
            floor: ceil_fraction(target_size, floor_ratio).max(1),
        });
    }

    requirements
}

fn dynamic_special_pool_floor_ratio(
    query: &RecommendationQueryPayload,
    window: &[RecommendationCandidatePayload],
    kind: SpecialPoolKind,
    policy_key: &str,
    default_ratio: f64,
    max_ratio: f64,
) -> f64 {
    let base_ratio = ranking_policy_number(query, policy_key, default_ratio).clamp(0.0, max_ratio);

    let profile = UserActionProfile::from_query(query);
    if profile.action_count == 0 {
        return base_ratio;
    }

    let pool_interest = window
        .iter()
        .filter(|candidate| special_pool_matches(candidate, kind))
        .map(|candidate| profile.match_candidate(candidate).personalized_strength)
        .fold(0.0_f64, f64::max);
    let temporal = profile.temporal_summary();
    let temporal_lift = temporal.short_interest() * 0.06 + temporal.stable_interest() * 0.04;
    let negative_pressure = temporal.negative_pressure() * 0.08;

    (base_ratio + pool_interest * 0.16 + temporal_lift - negative_pressure).clamp(0.0, max_ratio)
}

pub(super) fn special_pool_matches(
    candidate: &RecommendationCandidatePayload,
    kind: SpecialPoolKind,
) -> bool {
    match kind {
        SpecialPoolKind::Trend => is_trend_candidate(candidate),
        SpecialPoolKind::News => is_news_candidate(candidate),
    }
}

fn exploration_floor_for_query(
    query: &RecommendationQueryPayload,
    state: &str,
    target_size: usize,
) -> usize {
    if target_size < 4 {
        return 0;
    }
    let configured_ratio = ranking_policy_number(query, "exploration_floor_ratio", -1.0);
    if configured_ratio >= 0.0 {
        return ceil_fraction(target_size, configured_ratio.clamp(0.0, 0.5));
    }
    match state {
        "cold_start" => ceil_fraction(target_size, 0.24).max(1),
        "sparse" => ceil_fraction(target_size, 0.14).max(1),
        "heavy" => ceil_fraction(target_size, 0.06).min(2),
        _ => ceil_fraction(target_size, 0.08).max(1),
    }
}

fn max_oon_count_for_query(
    query: &RecommendationQueryPayload,
    target_size: usize,
    default_count: usize,
) -> usize {
    let ratio = ranking_policy_number(query, "max_oon_ratio", -1.0);
    if ratio > 0.0 {
        ceil_fraction(target_size, ratio.clamp(0.0, 1.0)).min(target_size)
    } else {
        default_count.min(target_size)
    }
}

fn fallback_ceiling_for_query(
    query: &RecommendationQueryPayload,
    target_size: usize,
    default_ratio: f64,
) -> usize {
    let ratio = ranking_policy_number(query, "fallback_ceiling_ratio", default_ratio);
    ceil_fraction(target_size, ratio.clamp(0.0, 1.0)).min(target_size)
}

fn trend_ceiling_for_query(
    query: &RecommendationQueryPayload,
    target_size: usize,
    default_ratio: f64,
) -> usize {
    let has_trend_policy = !ranking_policy_keywords(query, "trend_keywords").is_empty();
    if !has_trend_policy {
        return target_size;
    }
    let ratio = ranking_policy_number(query, "trend_ceiling_ratio", default_ratio);
    ceil_fraction(target_size, ratio.clamp(0.05, 1.0))
        .max(1)
        .min(target_size)
}

fn news_ceiling_for_query(
    query: &RecommendationQueryPayload,
    target_size: usize,
    default_ratio: f64,
) -> usize {
    let ratio = ranking_policy_number(query, "news_ceiling_ratio", default_ratio);
    ceil_fraction(target_size, ratio.clamp(0.05, 1.0))
        .max(1)
        .min(target_size)
}

fn ceil_fraction(total: usize, ratio: f64) -> usize {
    ((total as f64) * ratio).ceil() as usize
}
