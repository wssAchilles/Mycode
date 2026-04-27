use std::collections::{HashMap, HashSet};

use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};
use crate::pipeline::local::context::{
    FALLBACK_LANE, IN_NETWORK_LANE, INTEREST_LANE, SOCIAL_EXPANSION_LANE, ranking_policy_keywords,
    ranking_policy_number, ranking_policy_usize, source_retrieval_lane,
};

fn candidate_score(candidate: &RecommendationCandidatePayload) -> f64 {
    candidate
        .score
        .or(candidate.weighted_score)
        .or(candidate.pipeline_score)
        .unwrap_or_default()
}

pub fn selector_target_size(limit: usize, oversample_factor: usize, max_size: usize) -> usize {
    let base = limit.max(1);
    let oversampled = base.saturating_mul(oversample_factor.max(1));
    oversampled.min(max_size.max(1))
}

pub fn select_candidates(
    query: &RecommendationQueryPayload,
    candidates: &[RecommendationCandidatePayload],
    oversample_factor: usize,
    max_size: usize,
    author_soft_cap: usize,
) -> Vec<RecommendationCandidatePayload> {
    let target_size = selector_target_size(query.limit, oversample_factor, max_size);
    let mut sorted = candidates.to_vec();
    sort_candidates(&mut sorted, query.in_network_only);
    if query.in_network_only {
        sorted.truncate(target_size);
        return sorted;
    }

    let effective_author_soft_cap = author_soft_cap_for_query(query, target_size, author_soft_cap);
    let window_size = sorted.len().min(
        target_size
            .saturating_mul(window_factor(query))
            .max(target_size),
    );
    let window = &sorted[..window_size];
    let constraints = selector_constraints(query, target_size);
    let mut selected_indexes = HashSet::new();
    let mut selection_order = Vec::new();
    let mut author_counts = HashMap::<String, usize>::new();
    let mut lane_counts = HashMap::<String, usize>::new();
    let mut source_counts = HashMap::<String, usize>::new();
    let mut topic_counts = HashMap::<String, usize>::new();
    let mut oon_count = 0usize;
    let mut trend_count = 0usize;
    let mut news_count = 0usize;
    let topic_soft_cap = topic_soft_cap_for_query(query, target_size);
    let source_soft_cap = source_soft_cap_for_query(query, target_size);

    fill_personalized_window(
        query,
        window,
        target_size,
        &constraints,
        &mut selected_indexes,
        &mut selection_order,
        &mut author_counts,
        &mut lane_counts,
        &mut source_counts,
        &mut topic_counts,
        &mut oon_count,
        &mut trend_count,
        &mut news_count,
        effective_author_soft_cap,
        topic_soft_cap,
        source_soft_cap,
    );

    fill_required_lane_floors(
        window,
        target_size,
        &constraints,
        &mut selected_indexes,
        &mut selection_order,
        &mut author_counts,
        &mut lane_counts,
        &mut source_counts,
        &mut topic_counts,
        &mut oon_count,
        &mut trend_count,
        &mut news_count,
        effective_author_soft_cap,
        topic_soft_cap,
        source_soft_cap,
    );

    fill_required_special_pool_floors(
        window,
        target_size,
        &constraints,
        &mut selected_indexes,
        &mut selection_order,
        &mut author_counts,
        &mut lane_counts,
        &mut source_counts,
        &mut topic_counts,
        &mut oon_count,
        &mut trend_count,
        &mut news_count,
        effective_author_soft_cap,
        topic_soft_cap,
        source_soft_cap,
        special_pool_requirements(query, window, target_size),
    );

    fill_exploration_floor(
        window,
        target_size,
        &constraints,
        &mut selected_indexes,
        &mut selection_order,
        &mut author_counts,
        &mut lane_counts,
        &mut source_counts,
        &mut topic_counts,
        &mut oon_count,
        &mut trend_count,
        &mut news_count,
        effective_author_soft_cap,
        topic_soft_cap,
        source_soft_cap,
    );

    fill_by_lane_order(
        window,
        target_size,
        &constraints.lane_order,
        &mut selected_indexes,
        &mut selection_order,
        &mut author_counts,
        &mut lane_counts,
        &mut source_counts,
        &mut topic_counts,
        &constraints,
        &mut oon_count,
        &mut trend_count,
        &mut news_count,
        effective_author_soft_cap,
        topic_soft_cap,
        source_soft_cap,
        true,
    );

    while selected_indexes.len() < target_size {
        let Some(index) = next_candidate_index(
            window,
            &selected_indexes,
            None,
            &author_counts,
            effective_author_soft_cap,
            &lane_counts,
            &source_counts,
            &topic_counts,
            &constraints,
            oon_count,
            trend_count,
            news_count,
            topic_soft_cap,
            source_soft_cap,
            true,
        ) else {
            break;
        };
        apply_selected_candidate(
            window,
            index,
            &mut selected_indexes,
            &mut selection_order,
            &mut author_counts,
            &mut lane_counts,
            &mut source_counts,
            &mut topic_counts,
            &mut oon_count,
            &mut trend_count,
            &mut news_count,
        );
    }

    fill_by_lane_order(
        window,
        target_size,
        &constraints.lane_order,
        &mut selected_indexes,
        &mut selection_order,
        &mut author_counts,
        &mut lane_counts,
        &mut source_counts,
        &mut topic_counts,
        &constraints,
        &mut oon_count,
        &mut trend_count,
        &mut news_count,
        effective_author_soft_cap + 1,
        topic_soft_cap + 1,
        source_soft_cap + 1,
        false,
    );

    while selected_indexes.len() < target_size {
        let Some(index) = next_candidate_index(
            window,
            &selected_indexes,
            None,
            &author_counts,
            effective_author_soft_cap + 1,
            &lane_counts,
            &source_counts,
            &topic_counts,
            &constraints,
            oon_count,
            trend_count,
            news_count,
            topic_soft_cap + 1,
            source_soft_cap + 1,
            false,
        ) else {
            break;
        };
        apply_selected_candidate(
            window,
            index,
            &mut selected_indexes,
            &mut selection_order,
            &mut author_counts,
            &mut lane_counts,
            &mut source_counts,
            &mut topic_counts,
            &mut oon_count,
            &mut trend_count,
            &mut news_count,
        );
    }

    let mut output = selection_order
        .into_iter()
        .map(|index| window[index].clone())
        .collect::<Vec<_>>();

    if output.len() < target_size {
        for candidate in sorted.into_iter().skip(window_size) {
            if output.len() >= target_size {
                break;
            }
            output.push(candidate);
        }
    }

    for candidate in &mut output {
        let pool = candidate_selection_pool(candidate).to_string();
        candidate.selection_reason = Some(selection_reason(candidate, &pool));
        candidate.selection_pool = Some(pool);
    }

    output.truncate(target_size);
    output
}

fn fill_personalized_window(
    query: &RecommendationQueryPayload,
    window: &[RecommendationCandidatePayload],
    target_size: usize,
    constraints: &SelectorConstraints,
    selected_indexes: &mut HashSet<usize>,
    selection_order: &mut Vec<usize>,
    author_counts: &mut HashMap<String, usize>,
    lane_counts: &mut HashMap<String, usize>,
    source_counts: &mut HashMap<String, usize>,
    topic_counts: &mut HashMap<String, usize>,
    oon_count: &mut usize,
    trend_count: &mut usize,
    news_count: &mut usize,
    author_soft_cap: usize,
    topic_soft_cap: usize,
    source_soft_cap: usize,
) {
    let target = personalized_window_size(query, target_size).min(target_size);
    while selected_indexes.len() < target {
        let Some(index) = window.iter().enumerate().find_map(|(index, candidate)| {
            if selected_indexes.contains(&index) || !is_strong_personalized_candidate(candidate) {
                return None;
            }
            can_select_candidate(
                candidate,
                None,
                author_counts,
                author_soft_cap,
                lane_counts,
                source_counts,
                topic_counts,
                constraints,
                *oon_count,
                *trend_count,
                *news_count,
                topic_soft_cap,
                source_soft_cap,
                true,
            )
            .then_some(index)
        }) else {
            break;
        };

        apply_selected_candidate(
            window,
            index,
            selected_indexes,
            selection_order,
            author_counts,
            lane_counts,
            source_counts,
            topic_counts,
            oon_count,
            trend_count,
            news_count,
        );
    }
}

fn fill_by_lane_order(
    window: &[RecommendationCandidatePayload],
    target_size: usize,
    lane_order: &[String],
    selected_indexes: &mut HashSet<usize>,
    selection_order: &mut Vec<usize>,
    author_counts: &mut HashMap<String, usize>,
    lane_counts: &mut HashMap<String, usize>,
    source_counts: &mut HashMap<String, usize>,
    topic_counts: &mut HashMap<String, usize>,
    constraints: &SelectorConstraints,
    oon_count: &mut usize,
    trend_count: &mut usize,
    news_count: &mut usize,
    author_soft_cap: usize,
    topic_soft_cap: usize,
    source_soft_cap: usize,
    enforce_constraints: bool,
) {
    loop {
        if selected_indexes.len() >= target_size {
            break;
        }

        let mut progress = false;
        for lane in lane_order {
            if selected_indexes.len() >= target_size {
                break;
            }
            let Some(index) = next_candidate_index(
                window,
                selected_indexes,
                Some(lane.as_str()),
                author_counts,
                author_soft_cap,
                lane_counts,
                source_counts,
                topic_counts,
                constraints,
                *oon_count,
                *trend_count,
                *news_count,
                topic_soft_cap,
                source_soft_cap,
                enforce_constraints,
            ) else {
                continue;
            };
            apply_selected_candidate(
                window,
                index,
                selected_indexes,
                selection_order,
                author_counts,
                lane_counts,
                source_counts,
                topic_counts,
                oon_count,
                trend_count,
                news_count,
            );
            progress = true;
        }

        if !progress {
            break;
        }
    }
}

fn fill_required_lane_floors(
    window: &[RecommendationCandidatePayload],
    target_size: usize,
    constraints: &SelectorConstraints,
    selected_indexes: &mut HashSet<usize>,
    selection_order: &mut Vec<usize>,
    author_counts: &mut HashMap<String, usize>,
    lane_counts: &mut HashMap<String, usize>,
    source_counts: &mut HashMap<String, usize>,
    topic_counts: &mut HashMap<String, usize>,
    oon_count: &mut usize,
    trend_count: &mut usize,
    news_count: &mut usize,
    author_soft_cap: usize,
    topic_soft_cap: usize,
    source_soft_cap: usize,
) {
    loop {
        if selected_indexes.len() >= target_size {
            break;
        }

        let mut progress = false;
        for lane in &constraints.lane_order {
            let lane_floor = constraints
                .lane_floors
                .get(lane)
                .copied()
                .unwrap_or_default();
            if lane_counts.get(lane).copied().unwrap_or_default() >= lane_floor {
                continue;
            }
            let Some(index) = next_candidate_index(
                window,
                selected_indexes,
                Some(lane.as_str()),
                author_counts,
                author_soft_cap,
                lane_counts,
                source_counts,
                topic_counts,
                constraints,
                *oon_count,
                *trend_count,
                *news_count,
                topic_soft_cap,
                source_soft_cap,
                true,
            ) else {
                continue;
            };
            apply_selected_candidate(
                window,
                index,
                selected_indexes,
                selection_order,
                author_counts,
                lane_counts,
                source_counts,
                topic_counts,
                oon_count,
                trend_count,
                news_count,
            );
            progress = true;
            if selected_indexes.len() >= target_size {
                break;
            }
        }

        if !progress {
            break;
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum SpecialPoolKind {
    Trend,
    News,
}

#[derive(Debug, Clone, Copy)]
struct SpecialPoolRequirement {
    kind: SpecialPoolKind,
    floor: usize,
}

fn fill_required_special_pool_floors(
    window: &[RecommendationCandidatePayload],
    target_size: usize,
    constraints: &SelectorConstraints,
    selected_indexes: &mut HashSet<usize>,
    selection_order: &mut Vec<usize>,
    author_counts: &mut HashMap<String, usize>,
    lane_counts: &mut HashMap<String, usize>,
    source_counts: &mut HashMap<String, usize>,
    topic_counts: &mut HashMap<String, usize>,
    oon_count: &mut usize,
    trend_count: &mut usize,
    news_count: &mut usize,
    author_soft_cap: usize,
    topic_soft_cap: usize,
    source_soft_cap: usize,
    requirements: Vec<SpecialPoolRequirement>,
) {
    for requirement in requirements {
        if requirement.floor == 0 {
            continue;
        }

        while selected_indexes.len() < target_size
            && selected_indexes
                .iter()
                .filter(|index| special_pool_matches(&window[**index], requirement.kind))
                .count()
                < requirement.floor
        {
            let Some(index) = window.iter().enumerate().find_map(|(index, candidate)| {
                if selected_indexes.contains(&index)
                    || !special_pool_matches(candidate, requirement.kind)
                {
                    return None;
                }
                can_select_candidate(
                    candidate,
                    None,
                    author_counts,
                    author_soft_cap,
                    lane_counts,
                    source_counts,
                    topic_counts,
                    constraints,
                    *oon_count,
                    *trend_count,
                    *news_count,
                    topic_soft_cap,
                    source_soft_cap,
                    true,
                )
                .then_some(index)
            }) else {
                break;
            };

            apply_selected_candidate(
                window,
                index,
                selected_indexes,
                selection_order,
                author_counts,
                lane_counts,
                source_counts,
                topic_counts,
                oon_count,
                trend_count,
                news_count,
            );
        }
    }
}

pub fn sort_candidates(candidates: &mut [RecommendationCandidatePayload], in_network_only: bool) {
    candidates.sort_by(|left, right| {
        if in_network_only {
            right
                .created_at
                .cmp(&left.created_at)
                .then_with(|| left.post_id.cmp(&right.post_id))
                .then_with(|| left.author_id.cmp(&right.author_id))
        } else {
            candidate_score(right)
                .partial_cmp(&candidate_score(left))
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| right.created_at.cmp(&left.created_at))
                .then_with(|| left.post_id.cmp(&right.post_id))
                .then_with(|| left.author_id.cmp(&right.author_id))
        }
    });
}

#[derive(Debug, Clone)]
struct SelectorConstraints {
    lane_floors: HashMap<String, usize>,
    lane_ceilings: HashMap<String, usize>,
    max_oon_count: usize,
    trend_ceiling: usize,
    news_ceiling: usize,
    exploration_floor: usize,
    lane_order: Vec<String>,
}

fn window_factor(query: &RecommendationQueryPayload) -> usize {
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

fn personalized_window_size(query: &RecommendationQueryPayload, target_size: usize) -> usize {
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

fn selector_constraints(
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
            lane_floors: HashMap::from([(FALLBACK_LANE.to_string(), target_size)]),
            lane_ceilings: HashMap::new(),
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
                    ceil_fraction(target_size, 0.16),
                ),
                (
                    SOCIAL_EXPANSION_LANE.to_string(),
                    ceil_fraction(target_size, 0.08),
                ),
                (INTEREST_LANE.to_string(), ceil_fraction(target_size, 0.36)),
            ]),
            lane_ceilings: HashMap::from([(
                FALLBACK_LANE.to_string(),
                fallback_ceiling_for_query(query, target_size, 0.25),
            )]),
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
                    ceil_fraction(target_size, 0.35),
                ),
                (
                    SOCIAL_EXPANSION_LANE.to_string(),
                    ceil_fraction(target_size, 0.16),
                ),
                (INTEREST_LANE.to_string(), ceil_fraction(target_size, 0.18)),
            ]),
            lane_ceilings: HashMap::from([(
                FALLBACK_LANE.to_string(),
                fallback_ceiling_for_query(query, target_size, 0.12),
            )]),
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
                    ceil_fraction(target_size, 0.32),
                ),
                (
                    SOCIAL_EXPANSION_LANE.to_string(),
                    ceil_fraction(target_size, 0.12),
                ),
                (INTEREST_LANE.to_string(), ceil_fraction(target_size, 0.22)),
            ]),
            lane_ceilings: HashMap::from([(
                FALLBACK_LANE.to_string(),
                fallback_ceiling_for_query(query, target_size, 0.18),
            )]),
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

fn special_pool_requirements(
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
        let floor_ratio = ranking_policy_number(query, "trend_floor_ratio", 0.1).clamp(0.0, 0.5);
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
        let floor_ratio = ranking_policy_number(query, "news_floor_ratio", 0.08).clamp(0.0, 0.4);
        requirements.push(SpecialPoolRequirement {
            kind: SpecialPoolKind::News,
            floor: ceil_fraction(target_size, floor_ratio).max(1),
        });
    }

    requirements
}

fn fill_exploration_floor(
    window: &[RecommendationCandidatePayload],
    target_size: usize,
    constraints: &SelectorConstraints,
    selected_indexes: &mut HashSet<usize>,
    selection_order: &mut Vec<usize>,
    author_counts: &mut HashMap<String, usize>,
    lane_counts: &mut HashMap<String, usize>,
    source_counts: &mut HashMap<String, usize>,
    topic_counts: &mut HashMap<String, usize>,
    oon_count: &mut usize,
    trend_count: &mut usize,
    news_count: &mut usize,
    author_soft_cap: usize,
    topic_soft_cap: usize,
    source_soft_cap: usize,
) {
    if constraints.exploration_floor == 0 {
        return;
    }

    while selected_indexes.len() < target_size
        && selected_indexes
            .iter()
            .filter(|index| is_exploration_candidate(&window[**index]))
            .count()
            < constraints.exploration_floor
    {
        let Some(index) = window.iter().enumerate().find_map(|(index, candidate)| {
            if selected_indexes.contains(&index) || !is_exploration_candidate(candidate) {
                return None;
            }
            can_select_candidate(
                candidate,
                None,
                author_counts,
                author_soft_cap,
                lane_counts,
                source_counts,
                topic_counts,
                constraints,
                *oon_count,
                *trend_count,
                *news_count,
                topic_soft_cap,
                source_soft_cap,
                true,
            )
            .then_some(index)
        }) else {
            break;
        };

        apply_selected_candidate(
            window,
            index,
            selected_indexes,
            selection_order,
            author_counts,
            lane_counts,
            source_counts,
            topic_counts,
            oon_count,
            trend_count,
            news_count,
        );
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

fn next_candidate_index(
    candidates: &[RecommendationCandidatePayload],
    selected_indexes: &HashSet<usize>,
    required_lane: Option<&str>,
    author_counts: &HashMap<String, usize>,
    author_soft_cap: usize,
    lane_counts: &HashMap<String, usize>,
    source_counts: &HashMap<String, usize>,
    topic_counts: &HashMap<String, usize>,
    constraints: &SelectorConstraints,
    oon_count: usize,
    trend_count: usize,
    news_count: usize,
    topic_soft_cap: usize,
    source_soft_cap: usize,
    enforce_constraints: bool,
) -> Option<usize> {
    candidates
        .iter()
        .enumerate()
        .find_map(|(index, candidate)| {
            if selected_indexes.contains(&index) {
                return None;
            }

            if !can_select_candidate(
                candidate,
                required_lane,
                author_counts,
                author_soft_cap,
                lane_counts,
                source_counts,
                topic_counts,
                constraints,
                oon_count,
                trend_count,
                news_count,
                topic_soft_cap,
                source_soft_cap,
                enforce_constraints,
            ) {
                return None;
            }

            Some(index)
        })
}

fn can_select_candidate(
    candidate: &RecommendationCandidatePayload,
    required_lane: Option<&str>,
    author_counts: &HashMap<String, usize>,
    author_soft_cap: usize,
    lane_counts: &HashMap<String, usize>,
    source_counts: &HashMap<String, usize>,
    topic_counts: &HashMap<String, usize>,
    constraints: &SelectorConstraints,
    oon_count: usize,
    trend_count: usize,
    news_count: usize,
    topic_soft_cap: usize,
    source_soft_cap: usize,
    enforce_constraints: bool,
) -> bool {
    let lane = candidate_lane(candidate);
    if required_lane.is_some_and(|required_lane| lane != required_lane) {
        return false;
    }

    let author_count = author_counts
        .get(&candidate.author_id)
        .copied()
        .unwrap_or_default();
    if author_count >= author_soft_cap {
        return false;
    }

    if is_trend_candidate(candidate) && trend_count >= constraints.trend_ceiling {
        return false;
    }

    if is_news_candidate(candidate) && news_count >= constraints.news_ceiling {
        return false;
    }

    if !enforce_constraints {
        return true;
    }

    let source_count = source_counts
        .get(candidate_source(candidate))
        .copied()
        .unwrap_or_default();
    if source_count >= source_soft_cap {
        return false;
    }

    if candidate.in_network == Some(false) && oon_count >= constraints.max_oon_count {
        return false;
    }

    if let Some(lane_ceiling) = constraints.lane_ceilings.get(lane) {
        let current_lane_count = lane_counts.get(lane).copied().unwrap_or_default();
        if current_lane_count >= *lane_ceiling {
            return false;
        }
    }

    if let Some(topic_key) = candidate_topic_key(candidate) {
        let topic_count = topic_counts.get(&topic_key).copied().unwrap_or_default();
        if topic_count >= topic_soft_cap {
            return false;
        }
    }

    true
}

fn apply_selected_candidate(
    candidates: &[RecommendationCandidatePayload],
    index: usize,
    selected_indexes: &mut HashSet<usize>,
    selection_order: &mut Vec<usize>,
    author_counts: &mut HashMap<String, usize>,
    lane_counts: &mut HashMap<String, usize>,
    source_counts: &mut HashMap<String, usize>,
    topic_counts: &mut HashMap<String, usize>,
    oon_count: &mut usize,
    trend_count: &mut usize,
    news_count: &mut usize,
) {
    if !selected_indexes.insert(index) {
        return;
    }
    selection_order.push(index);

    let candidate = &candidates[index];
    *author_counts
        .entry(candidate.author_id.clone())
        .or_insert(0) += 1;
    *lane_counts
        .entry(candidate_lane(candidate).to_string())
        .or_insert(0) += 1;
    *source_counts
        .entry(candidate_source(candidate).to_string())
        .or_insert(0) += 1;
    if let Some(topic_key) = candidate_topic_key(candidate) {
        *topic_counts.entry(topic_key).or_insert(0) += 1;
    }
    if candidate.in_network == Some(false) {
        *oon_count += 1;
    }
    if is_trend_candidate(candidate) {
        *trend_count += 1;
    }
    if is_news_candidate(candidate) {
        *news_count += 1;
    }
}

fn candidate_lane(candidate: &RecommendationCandidatePayload) -> &str {
    candidate
        .retrieval_lane
        .as_deref()
        .unwrap_or_else(|| source_retrieval_lane(candidate.recall_source.as_deref().unwrap_or("")))
}

fn candidate_source(candidate: &RecommendationCandidatePayload) -> &str {
    candidate
        .recall_source
        .as_deref()
        .or(candidate.retrieval_lane.as_deref())
        .unwrap_or_else(|| source_retrieval_lane(""))
}

fn candidate_topic_key(candidate: &RecommendationCandidatePayload) -> Option<String> {
    if let Some(cluster_key) = candidate
        .news_metadata
        .as_ref()
        .and_then(|metadata| metadata.cluster_id)
        .map(|cluster_id| format!("news_cluster:{cluster_id}"))
    {
        return Some(cluster_key);
    }

    if let Some(conversation_id) = candidate
        .conversation_id
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        return Some(format!("conversation:{conversation_id}"));
    }

    if let Some(pool_kind) = candidate
        .interest_pool_kind
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        return Some(format!("interest_pool:{pool_kind}"));
    }

    Some(format!("format:{}", candidate_format_key(candidate)))
}

fn candidate_format_key(candidate: &RecommendationCandidatePayload) -> &'static str {
    if candidate.is_news == Some(true) {
        "news"
    } else if candidate.has_video == Some(true) {
        "video"
    } else if candidate.has_image == Some(true) {
        "image"
    } else if candidate.is_reply {
        "reply"
    } else if candidate.is_repost {
        "repost"
    } else {
        "text"
    }
}

fn is_strong_personalized_candidate(candidate: &RecommendationCandidatePayload) -> bool {
    if candidate.in_network == Some(true) {
        return true;
    }

    let breakdown = candidate.score_breakdown.as_ref();
    let author_affinity = candidate
        .author_affinity_score
        .unwrap_or_default()
        .max(breakdown_value(breakdown, "authorAffinityScore"));
    let evidence_confidence = breakdown_value(breakdown, "retrievalEvidenceConfidence");
    let dense_score = breakdown_value(breakdown, "retrievalDenseVectorScore");
    let topic_score = breakdown_value(breakdown, "retrievalTopicCoverageScore")
        .max(breakdown_value(breakdown, "retrievalCandidateClusterScore"));
    let graph_score = candidate
        .graph_score
        .unwrap_or_default()
        .max(breakdown_value(breakdown, "retrievalAuthorGraphPrior"));

    author_affinity >= 0.18
        || evidence_confidence >= 0.62
        || (candidate_lane(candidate) == INTEREST_LANE && dense_score.max(topic_score) >= 0.25)
        || graph_score >= 0.2
}

fn is_exploration_candidate(candidate: &RecommendationCandidatePayload) -> bool {
    let lane = candidate_lane(candidate);
    breakdown_value(candidate.score_breakdown.as_ref(), "explorationEligible") >= 0.5
        || (candidate.in_network != Some(true)
            && (lane == FALLBACK_LANE || lane == INTEREST_LANE)
            && breakdown_value(candidate.score_breakdown.as_ref(), "fatigueStrength") < 0.42)
}

fn special_pool_matches(candidate: &RecommendationCandidatePayload, kind: SpecialPoolKind) -> bool {
    match kind {
        SpecialPoolKind::Trend => is_trend_candidate(candidate),
        SpecialPoolKind::News => is_news_candidate(candidate),
    }
}

fn is_trend_candidate(candidate: &RecommendationCandidatePayload) -> bool {
    breakdown_value(
        candidate.score_breakdown.as_ref(),
        "trendPersonalizationStrength",
    ) >= 0.08
        || breakdown_value(candidate.score_breakdown.as_ref(), "trendAffinityStrength") >= 0.14
}

fn is_news_candidate(candidate: &RecommendationCandidatePayload) -> bool {
    candidate.is_news == Some(true) || candidate.recall_source.as_deref() == Some("NewsAnnSource")
}

fn candidate_selection_pool(candidate: &RecommendationCandidatePayload) -> &'static str {
    if candidate
        .score_breakdown
        .as_ref()
        .is_some_and(|breakdown| breakdown_value(Some(breakdown), "selectorRescueEligible") >= 0.5)
    {
        return "rescue";
    }
    if is_trend_candidate(candidate) {
        return "trend";
    }
    if is_exploration_candidate(candidate) {
        return "exploration";
    }
    match candidate_lane(candidate) {
        IN_NETWORK_LANE | SOCIAL_EXPANSION_LANE | INTEREST_LANE => "primary",
        _ => "fallback",
    }
}

fn selection_reason(candidate: &RecommendationCandidatePayload, pool: &str) -> String {
    match pool {
        "primary" if candidate.in_network == Some(true) => "in_network_primary".to_string(),
        "primary" => format!("{}_primary", candidate_lane(candidate)),
        "trend" => "trend_affinity_primary".to_string(),
        "exploration" => "bandit_or_novelty_exploration".to_string(),
        "rescue" => "underfill_rescue".to_string(),
        _ => format!("{}_fallback", candidate_lane(candidate)),
    }
}

fn breakdown_value(breakdown: Option<&HashMap<String, f64>>, key: &str) -> f64 {
    breakdown
        .and_then(|breakdown| breakdown.get(key))
        .copied()
        .unwrap_or_default()
}

fn ceil_fraction(total: usize, ratio: f64) -> usize {
    ((total as f64) * ratio).ceil() as usize
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use chrono::{TimeZone, Utc};

    use crate::contracts::query::RankingPolicyPayload;
    use crate::contracts::{
        CandidateNewsMetadataPayload, RecommendationCandidatePayload, RecommendationQueryPayload,
        UserStateContextPayload,
    };

    use super::select_candidates;

    fn query(state: &str, limit: usize) -> RecommendationQueryPayload {
        RecommendationQueryPayload {
            request_id: "selector-query".to_string(),
            user_id: "viewer-1".to_string(),
            limit,
            cursor: None,
            in_network_only: false,
            seen_ids: Vec::new(),
            served_ids: Vec::new(),
            is_bottom_request: false,
            client_app_id: None,
            country_code: None,
            language_code: None,
            user_features: None,
            embedding_context: None,
            user_state_context: Some(UserStateContextPayload {
                state: state.to_string(),
                reason: "test".to_string(),
                followed_count: 10,
                recent_action_count: 20,
                recent_positive_action_count: 8,
                usable_embedding: true,
                account_age_days: Some(30),
            }),
            user_action_sequence: None,
            news_history_external_ids: None,
            model_user_action_sequence: None,
            experiment_context: None,
            ranking_policy: None,
        }
    }

    fn candidate(
        post_id: &str,
        author_id: &str,
        lane: &str,
        in_network: bool,
        score: f64,
    ) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: post_id.to_string(),
            model_post_id: Some(post_id.to_string()),
            author_id: author_id.to_string(),
            content: "candidate".to_string(),
            created_at: Utc.with_ymd_and_hms(2026, 4, 23, 0, 0, 0).unwrap(),
            conversation_id: None,
            is_reply: false,
            reply_to_post_id: None,
            is_repost: false,
            original_post_id: None,
            in_network: Some(in_network),
            recall_source: Some(
                match lane {
                    "in_network" => "FollowingSource",
                    "social_expansion" => "GraphSource",
                    "interest" => "TwoTowerSource",
                    _ => "PopularSource",
                }
                .to_string(),
            ),
            retrieval_lane: Some(lane.to_string()),
            interest_pool_kind: None,
            secondary_recall_sources: None,
            has_video: None,
            has_image: None,
            video_duration_sec: None,
            media: None,
            like_count: None,
            comment_count: None,
            repost_count: None,
            view_count: None,
            author_username: None,
            author_avatar_url: None,
            author_affinity_score: None,
            phoenix_scores: None,
            action_scores: None,
            ranking_signals: None,
            recall_evidence: None,
            selection_pool: None,
            selection_reason: None,
            score_contract_version: None,
            score_breakdown_version: None,
            weighted_score: Some(score),
            score: Some(score),
            is_liked_by_user: None,
            is_reposted_by_user: None,
            is_nsfw: None,
            vf_result: None,
            is_news: None,
            news_metadata: None,
            is_pinned: None,
            score_breakdown: None,
            pipeline_score: Some(score),
            graph_score: None,
            graph_path: None,
            graph_recall_type: None,
        }
    }

    fn candidate_with_cluster(
        post_id: &str,
        author_id: &str,
        lane: &str,
        in_network: bool,
        score: f64,
        cluster_id: i64,
    ) -> RecommendationCandidatePayload {
        let mut candidate = candidate(post_id, author_id, lane, in_network, score);
        candidate.news_metadata = Some(CandidateNewsMetadataPayload {
            cluster_id: Some(cluster_id),
            ..CandidateNewsMetadataPayload::default()
        });
        candidate
    }

    fn trend_candidate(
        post_id: &str,
        author_id: &str,
        lane: &str,
        score: f64,
    ) -> RecommendationCandidatePayload {
        let mut candidate = candidate(post_id, author_id, lane, false, score);
        candidate.score_breakdown =
            Some(HashMap::from([("trendAffinityStrength".to_string(), 0.32)]));
        candidate
    }

    fn query_with_trend_policy(state: &str, limit: usize) -> RecommendationQueryPayload {
        let mut query = query(state, limit);
        query.ranking_policy = Some(RankingPolicyPayload {
            trend_keywords: Some(vec!["rust".to_string(), "recsys".to_string()]),
            ..RankingPolicyPayload::default()
        });
        query
    }

    #[test]
    fn selector_enforces_author_soft_cap_and_lane_mix() {
        let selected = select_candidates(
            &query("warm", 6),
            &[
                candidate("f1", "author-a", "in_network", true, 10.0),
                candidate("f2", "author-a", "in_network", true, 9.8),
                candidate("f3", "author-a", "in_network", true, 9.6),
                candidate("f4", "author-f", "in_network", true, 9.5),
                candidate("g1", "author-b", "social_expansion", false, 9.4),
                candidate("i1", "author-c", "interest", false, 9.2),
                candidate("i2", "author-d", "interest", false, 9.0),
                candidate("p1", "author-e", "fallback", false, 8.8),
            ],
            1,
            20,
            2,
        );

        let author_a_count = selected
            .iter()
            .filter(|candidate| candidate.author_id == "author-a")
            .count();
        let social_count = selected
            .iter()
            .filter(|candidate| candidate.retrieval_lane.as_deref() == Some("social_expansion"))
            .count();
        assert_eq!(author_a_count, 2);
        assert!(social_count >= 1);
    }

    #[test]
    fn sparse_selector_limits_fallback_takeover() {
        let selected = select_candidates(
            &query("sparse", 5),
            &[
                candidate("p1", "author-p1", "fallback", false, 9.9),
                candidate("p2", "author-p2", "fallback", false, 9.8),
                candidate("p3", "author-p3", "fallback", false, 9.7),
                candidate("i1", "author-i1", "interest", false, 9.6),
                candidate("i2", "author-i2", "interest", false, 9.5),
                candidate("f1", "author-f1", "in_network", true, 9.4),
            ],
            1,
            20,
            2,
        );

        let fallback_count = selected
            .iter()
            .filter(|candidate| candidate.retrieval_lane.as_deref() == Some("fallback"))
            .count();
        assert!(fallback_count <= 2);
    }

    #[test]
    fn selector_preserves_interleaved_lane_output_order() {
        let selected = select_candidates(
            &query("warm", 6),
            &[
                candidate("f1", "author-f1", "in_network", true, 10.0),
                candidate("f2", "author-f2", "in_network", true, 9.9),
                candidate("f3", "author-f3", "in_network", true, 9.8),
                candidate("g1", "author-g1", "social_expansion", false, 9.7),
                candidate("g2", "author-g2", "social_expansion", false, 9.6),
                candidate("i1", "author-i1", "interest", false, 9.5),
                candidate("i2", "author-i2", "interest", false, 9.4),
                candidate("p1", "author-p1", "fallback", false, 9.3),
            ],
            1,
            20,
            2,
        );

        let lanes = selected
            .iter()
            .map(|candidate| candidate.retrieval_lane.clone().unwrap_or_default())
            .collect::<Vec<_>>();
        assert_eq!(lanes.first().map(String::as_str), Some("in_network"));
        assert_eq!(lanes.get(1).map(String::as_str), Some("social_expansion"));
        assert_eq!(lanes.get(2).map(String::as_str), Some("interest"));
    }

    #[test]
    fn selector_applies_topic_soft_cap_before_relaxed_underfill() {
        let selected = select_candidates(
            &query("warm", 6),
            &[
                candidate_with_cluster("c1", "author-c1", "interest", false, 10.0, 7),
                candidate_with_cluster("c2", "author-c2", "interest", false, 9.9, 7),
                candidate_with_cluster("c3", "author-c3", "interest", false, 9.8, 7),
                candidate_with_cluster("c4", "author-c4", "interest", false, 9.7, 7),
                candidate_with_cluster("c5", "author-c5", "interest", false, 9.6, 7),
                candidate_with_cluster("g1", "author-g1", "social_expansion", false, 9.5, 9),
                candidate_with_cluster("f1", "author-f1", "in_network", true, 9.4, 10),
                candidate_with_cluster("i1", "author-i1", "interest", false, 9.3, 11),
            ],
            1,
            20,
            3,
        );

        let cluster_7_count = selected
            .iter()
            .filter(|candidate| {
                candidate
                    .news_metadata
                    .as_ref()
                    .and_then(|metadata| metadata.cluster_id)
                    == Some(7)
            })
            .count();
        assert!(cluster_7_count <= 4);
        assert!(selected.iter().any(|candidate| {
            candidate
                .news_metadata
                .as_ref()
                .and_then(|metadata| metadata.cluster_id)
                == Some(9)
        }));
    }

    #[test]
    fn selector_prevents_single_source_takeover_when_alternatives_exist() {
        let selected = select_candidates(
            &query("warm", 6),
            &[
                candidate("i1", "author-i1", "interest", false, 10.0),
                candidate("i2", "author-i2", "interest", false, 9.9),
                candidate("i3", "author-i3", "interest", false, 9.8),
                candidate("i4", "author-i4", "interest", false, 9.7),
                candidate("f1", "author-f1", "in_network", true, 9.6),
                candidate("g1", "author-g1", "social_expansion", false, 9.5),
                candidate("p1", "author-p1", "fallback", false, 9.4),
            ],
            1,
            20,
            2,
        );

        let two_tower_count = selected
            .iter()
            .filter(|candidate| candidate.recall_source.as_deref() == Some("TwoTowerSource"))
            .count();
        assert!(two_tower_count <= 3);
        assert!(
            selected
                .iter()
                .any(|candidate| { candidate.recall_source.as_deref() == Some("FollowingSource") })
        );
        assert!(
            selected
                .iter()
                .any(|candidate| { candidate.recall_source.as_deref() == Some("GraphSource") })
        );
    }

    #[test]
    fn selector_applies_conversation_diversity_before_relaxed_underfill() {
        let mut repeated = (1..=5)
            .map(|index| {
                let mut candidate = candidate(
                    &format!("thread-{index}"),
                    &format!("author-thread-{index}"),
                    "interest",
                    false,
                    10.0 - index as f64 * 0.1,
                );
                candidate.conversation_id = Some("conversation-a".to_string());
                candidate
            })
            .collect::<Vec<_>>();
        repeated.push(candidate("g1", "author-g1", "social_expansion", false, 9.3));
        repeated.push(candidate("f1", "author-f1", "in_network", true, 9.2));

        let selected = select_candidates(&query("warm", 6), &repeated, 1, 20, 3);
        let repeated_count = selected
            .iter()
            .filter(|candidate| candidate.conversation_id.as_deref() == Some("conversation-a"))
            .count();

        assert!(repeated_count <= 4);
        assert!(
            selected
                .iter()
                .any(|candidate| candidate.retrieval_lane.as_deref() == Some("social_expansion"))
        );
    }

    #[test]
    fn selector_keeps_media_format_from_monopolizing_when_alternatives_exist() {
        let mut candidates = (1..=5)
            .map(|index| {
                let mut candidate = candidate(
                    &format!("video-{index}"),
                    &format!("author-video-{index}"),
                    "interest",
                    false,
                    10.0 - index as f64 * 0.1,
                );
                candidate.has_video = Some(true);
                candidate
            })
            .collect::<Vec<_>>();
        candidates.push(candidate(
            "text-1",
            "author-text-1",
            "in_network",
            true,
            9.3,
        ));
        candidates.push(candidate(
            "image-1",
            "author-image-1",
            "social_expansion",
            false,
            9.2,
        ));
        candidates.last_mut().unwrap().has_image = Some(true);

        let selected = select_candidates(&query("warm", 6), &candidates, 1, 20, 3);
        let video_count = selected
            .iter()
            .filter(|candidate| candidate.has_video == Some(true))
            .count();

        assert!(video_count <= 4);
        assert!(
            selected
                .iter()
                .any(|candidate| candidate.has_image == Some(true))
        );
    }

    #[test]
    fn selector_reserves_trend_visibility_when_policy_has_trends() {
        let selected = select_candidates(
            &query_with_trend_policy("warm", 8),
            &[
                candidate("f1", "author-f1", "in_network", true, 10.0),
                candidate("f2", "author-f2", "in_network", true, 9.9),
                candidate("g1", "author-g1", "social_expansion", false, 9.8),
                candidate("g2", "author-g2", "social_expansion", false, 9.7),
                candidate("i1", "author-i1", "interest", false, 9.6),
                candidate("i2", "author-i2", "interest", false, 9.5),
                candidate("p1", "author-p1", "fallback", false, 9.4),
                trend_candidate("t1", "author-t1", "interest", 7.2),
            ],
            1,
            20,
            2,
        );

        assert!(selected.iter().any(|candidate| {
            candidate.selection_pool.as_deref() == Some("trend") || candidate.post_id == "t1"
        }));
    }

    #[test]
    fn selector_caps_trend_takeover_when_policy_has_ceiling() {
        let mut query = query_with_trend_policy("warm", 6);
        query.ranking_policy = Some(RankingPolicyPayload {
            trend_keywords: Some(vec!["rust".to_string()]),
            trend_ceiling_ratio: Some(0.25),
            trend_floor_ratio: Some(0.1),
            ..RankingPolicyPayload::default()
        });
        let mut following = candidate("f1", "author-f1", "in_network", true, 9.6);
        following.conversation_id = Some("conversation-f1".to_string());
        let mut graph = candidate("g1", "author-g1", "social_expansion", false, 9.5);
        graph.conversation_id = Some("conversation-g1".to_string());
        let mut interest = candidate("i1", "author-i1", "interest", false, 9.4);
        interest.conversation_id = Some("conversation-i1".to_string());
        let mut fallback = candidate("p1", "author-p1", "fallback", false, 9.3);
        fallback.conversation_id = Some("conversation-p1".to_string());
        let selected = select_candidates(
            &query,
            &[
                trend_candidate("t1", "author-t1", "interest", 10.0),
                trend_candidate("t2", "author-t2", "interest", 9.9),
                trend_candidate("t3", "author-t3", "interest", 9.8),
                trend_candidate("t4", "author-t4", "interest", 9.7),
                following,
                graph,
                interest,
                fallback,
            ],
            1,
            20,
            2,
        );

        let trend_count = selected
            .iter()
            .filter(|candidate| candidate.post_id.starts_with('t'))
            .count();
        assert!(trend_count <= 2);
        assert!(selected.iter().any(|candidate| candidate.post_id == "f1"));
    }

    #[test]
    fn selector_reserves_news_visibility_when_news_pool_exists() {
        let mut news = candidate_with_cluster("n1", "author-n1", "interest", false, 7.1, 42);
        news.is_news = Some(true);
        let selected = select_candidates(
            &query("warm", 8),
            &[
                candidate("f1", "author-f1", "in_network", true, 10.0),
                candidate("f2", "author-f2", "in_network", true, 9.9),
                candidate("g1", "author-g1", "social_expansion", false, 9.8),
                candidate("g2", "author-g2", "social_expansion", false, 9.7),
                candidate("i1", "author-i1", "interest", false, 9.6),
                candidate("i2", "author-i2", "interest", false, 9.5),
                candidate("p1", "author-p1", "fallback", false, 9.4),
                news,
            ],
            1,
            20,
            2,
        );

        assert!(selected.iter().any(|candidate| candidate.post_id == "n1"));
    }
}
