use std::collections::{HashMap, HashSet};

use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};
use crate::pipeline::local::context::{
    FALLBACK_LANE, IN_NETWORK_LANE, INTEREST_LANE, SOCIAL_EXPANSION_LANE, source_retrieval_lane,
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
    let window_size = sorted
        .len()
        .min(target_size.saturating_mul(window_factor(query)).max(target_size));
    let window = &sorted[..window_size];
    let constraints = selector_constraints(query, target_size);
    let mut selected_indexes = HashSet::new();
    let mut selection_order = Vec::new();
    let mut author_counts = HashMap::<String, usize>::new();
    let mut lane_counts = HashMap::<String, usize>::new();
    let mut oon_count = 0usize;

    fill_required_lane_floors(
        window,
        target_size,
        &constraints,
        &mut selected_indexes,
        &mut selection_order,
        &mut author_counts,
        &mut lane_counts,
        &mut oon_count,
        effective_author_soft_cap,
    );

    fill_by_lane_order(
        window,
        target_size,
        &constraints.lane_order,
        &mut selected_indexes,
        &mut selection_order,
        &mut author_counts,
        &mut lane_counts,
        &constraints,
        &mut oon_count,
        effective_author_soft_cap,
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
            &constraints,
            oon_count,
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
            &mut oon_count,
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
        &constraints,
        &mut oon_count,
        effective_author_soft_cap + 1,
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
            &constraints,
            oon_count,
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
            &mut oon_count,
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

    output.truncate(target_size);
    output
}

fn fill_by_lane_order(
    window: &[RecommendationCandidatePayload],
    target_size: usize,
    lane_order: &[String],
    selected_indexes: &mut HashSet<usize>,
    selection_order: &mut Vec<usize>,
    author_counts: &mut HashMap<String, usize>,
    lane_counts: &mut HashMap<String, usize>,
    constraints: &SelectorConstraints,
    oon_count: &mut usize,
    author_soft_cap: usize,
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
                constraints,
                *oon_count,
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
                oon_count,
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
    oon_count: &mut usize,
    author_soft_cap: usize,
) {
    loop {
        if selected_indexes.len() >= target_size {
            break;
        }

        let mut progress = false;
        for lane in &constraints.lane_order {
            let lane_floor = constraints.lane_floors.get(lane).copied().unwrap_or_default();
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
                constraints,
                *oon_count,
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
                oon_count,
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

pub fn sort_candidates(candidates: &mut [RecommendationCandidatePayload], in_network_only: bool) {
    candidates.sort_by(|left, right| {
        if in_network_only {
            right.created_at.cmp(&left.created_at)
        } else {
            candidate_score(right)
                .partial_cmp(&candidate_score(left))
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| right.created_at.cmp(&left.created_at))
        }
    });
}

#[derive(Debug, Clone)]
struct SelectorConstraints {
    lane_floors: HashMap<String, usize>,
    lane_ceilings: HashMap<String, usize>,
    max_oon_count: usize,
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
    match query
        .user_state_context
        .as_ref()
        .map(|context| context.state.as_str())
    {
        Some("cold_start") => (base_cap + 1).max(2),
        Some("sparse") if target_size >= 8 => (base_cap + 1).max(2),
        Some("heavy") => base_cap.max(1),
        _ => base_cap.max(1),
    }
}

fn selector_constraints(query: &RecommendationQueryPayload, target_size: usize) -> SelectorConstraints {
    let state = query
        .user_state_context
        .as_ref()
        .map(|context| context.state.as_str())
        .unwrap_or("");

    match state {
        "cold_start" => SelectorConstraints {
            lane_floors: HashMap::from([(FALLBACK_LANE.to_string(), target_size)]),
            lane_ceilings: HashMap::new(),
            max_oon_count: target_size,
            lane_order: vec![FALLBACK_LANE.to_string()],
        },
        "sparse" => SelectorConstraints {
            lane_floors: HashMap::from([
                (IN_NETWORK_LANE.to_string(), ceil_fraction(target_size, 0.16)),
                (SOCIAL_EXPANSION_LANE.to_string(), ceil_fraction(target_size, 0.08)),
                (INTEREST_LANE.to_string(), ceil_fraction(target_size, 0.36)),
            ]),
            lane_ceilings: HashMap::from([
                (FALLBACK_LANE.to_string(), ceil_fraction(target_size, 0.25)),
            ]),
            max_oon_count: ceil_fraction(target_size, 0.64),
            lane_order: vec![
                INTEREST_LANE.to_string(),
                SOCIAL_EXPANSION_LANE.to_string(),
                IN_NETWORK_LANE.to_string(),
                FALLBACK_LANE.to_string(),
            ],
        },
        "heavy" => SelectorConstraints {
            lane_floors: HashMap::from([
                (IN_NETWORK_LANE.to_string(), ceil_fraction(target_size, 0.35)),
                (SOCIAL_EXPANSION_LANE.to_string(), ceil_fraction(target_size, 0.16)),
                (INTEREST_LANE.to_string(), ceil_fraction(target_size, 0.18)),
            ]),
            lane_ceilings: HashMap::from([
                (FALLBACK_LANE.to_string(), ceil_fraction(target_size, 0.12)),
            ]),
            max_oon_count: ceil_fraction(target_size, 0.42),
            lane_order: vec![
                IN_NETWORK_LANE.to_string(),
                SOCIAL_EXPANSION_LANE.to_string(),
                INTEREST_LANE.to_string(),
                FALLBACK_LANE.to_string(),
            ],
        },
        _ => SelectorConstraints {
            lane_floors: HashMap::from([
                (IN_NETWORK_LANE.to_string(), ceil_fraction(target_size, 0.32)),
                (SOCIAL_EXPANSION_LANE.to_string(), ceil_fraction(target_size, 0.12)),
                (INTEREST_LANE.to_string(), ceil_fraction(target_size, 0.22)),
            ]),
            lane_ceilings: HashMap::from([
                (FALLBACK_LANE.to_string(), ceil_fraction(target_size, 0.18)),
            ]),
            max_oon_count: ceil_fraction(target_size, 0.46),
            lane_order: vec![
                IN_NETWORK_LANE.to_string(),
                SOCIAL_EXPANSION_LANE.to_string(),
                INTEREST_LANE.to_string(),
                FALLBACK_LANE.to_string(),
            ],
        },
    }
}

fn next_candidate_index(
    candidates: &[RecommendationCandidatePayload],
    selected_indexes: &HashSet<usize>,
    required_lane: Option<&str>,
    author_counts: &HashMap<String, usize>,
    author_soft_cap: usize,
    lane_counts: &HashMap<String, usize>,
    constraints: &SelectorConstraints,
    oon_count: usize,
    enforce_constraints: bool,
) -> Option<usize> {
    candidates.iter().enumerate().find_map(|(index, candidate)| {
        if selected_indexes.contains(&index) {
            return None;
        }

        let lane = candidate_lane(candidate);
        if let Some(required_lane) = required_lane {
            if lane != required_lane {
                return None;
            }
        }

        let author_count = author_counts.get(&candidate.author_id).copied().unwrap_or_default();
        if author_count >= author_soft_cap {
            return None;
        }

        if enforce_constraints {
            if candidate.in_network == Some(false) && oon_count >= constraints.max_oon_count {
                return None;
            }

            if let Some(lane_ceiling) = constraints.lane_ceilings.get(lane) {
                let current_lane_count = lane_counts.get(lane).copied().unwrap_or_default();
                if current_lane_count >= *lane_ceiling {
                    return None;
                }
            }
        }

        Some(index)
    })
}

fn apply_selected_candidate(
    candidates: &[RecommendationCandidatePayload],
    index: usize,
    selected_indexes: &mut HashSet<usize>,
    selection_order: &mut Vec<usize>,
    author_counts: &mut HashMap<String, usize>,
    lane_counts: &mut HashMap<String, usize>,
    oon_count: &mut usize,
) {
    if !selected_indexes.insert(index) {
        return;
    }
    selection_order.push(index);

    let candidate = &candidates[index];
    *author_counts.entry(candidate.author_id.clone()).or_insert(0) += 1;
    *lane_counts.entry(candidate_lane(candidate).to_string()).or_insert(0) += 1;
    if candidate.in_network == Some(false) {
        *oon_count += 1;
    }
}

fn candidate_lane(candidate: &RecommendationCandidatePayload) -> &str {
    candidate
        .retrieval_lane
        .as_deref()
        .unwrap_or_else(|| source_retrieval_lane(candidate.recall_source.as_deref().unwrap_or("")))
}

fn ceil_fraction(total: usize, ratio: f64) -> usize {
    ((total as f64) * ratio).ceil() as usize
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};

    use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload, UserStateContextPayload};

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
            recall_source: Some(match lane {
                "in_network" => "FollowingSource",
                "social_expansion" => "GraphSource",
                "interest" => "TwoTowerSource",
                _ => "PopularSource",
            }.to_string()),
            retrieval_lane: Some(lane.to_string()),
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
}
