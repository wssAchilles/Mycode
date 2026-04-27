use std::collections::{HashMap, HashSet};

use crate::contracts::RecommendationCandidatePayload;

use super::candidates::{
    candidate_lane, candidate_source, candidate_topic_key, is_news_candidate, is_trend_candidate,
};
use super::constraints::{SelectionLimits, SelectorConstraints};

#[derive(Default)]
pub(super) struct SelectionState {
    selected_indexes: HashSet<usize>,
    pub(super) selection_order: Vec<usize>,
    author_counts: HashMap<String, usize>,
    lane_counts: HashMap<String, usize>,
    source_counts: HashMap<String, usize>,
    topic_counts: HashMap<String, usize>,
    oon_count: usize,
    trend_count: usize,
    news_count: usize,
}

impl SelectionState {
    pub(super) fn len(&self) -> usize {
        self.selected_indexes.len()
    }

    pub(super) fn contains(&self, index: usize) -> bool {
        self.selected_indexes.contains(&index)
    }

    pub(super) fn selected_matching_count(
        &self,
        candidates: &[RecommendationCandidatePayload],
        matches: impl Fn(&RecommendationCandidatePayload) -> bool,
    ) -> usize {
        self.selected_indexes
            .iter()
            .filter(|index| matches(&candidates[**index]))
            .count()
    }

    pub(super) fn lane_count(&self, lane: &str) -> usize {
        self.lane_counts.get(lane).copied().unwrap_or_default()
    }

    pub(super) fn next_candidate_index(
        &self,
        candidates: &[RecommendationCandidatePayload],
        required_lane: Option<&str>,
        constraints: &SelectorConstraints,
        limits: SelectionLimits,
    ) -> Option<usize> {
        candidates
            .iter()
            .enumerate()
            .find_map(|(index, candidate)| {
                if self.selected_indexes.contains(&index) {
                    return None;
                }

                if !self.can_select_candidate(candidate, required_lane, constraints, limits) {
                    return None;
                }

                Some(index)
            })
    }

    pub(super) fn can_select_candidate(
        &self,
        candidate: &RecommendationCandidatePayload,
        required_lane: Option<&str>,
        constraints: &SelectorConstraints,
        limits: SelectionLimits,
    ) -> bool {
        let lane = candidate_lane(candidate);
        if required_lane.is_some_and(|required_lane| lane != required_lane) {
            return false;
        }

        let author_count = self
            .author_counts
            .get(&candidate.author_id)
            .copied()
            .unwrap_or_default();
        if author_count >= limits.author_soft_cap {
            return false;
        }

        if is_trend_candidate(candidate) && self.trend_count >= constraints.trend_ceiling {
            return false;
        }

        if is_news_candidate(candidate) && self.news_count >= constraints.news_ceiling {
            return false;
        }

        if !limits.enforce_constraints {
            return true;
        }

        let source_count = self
            .source_counts
            .get(candidate_source(candidate))
            .copied()
            .unwrap_or_default();
        if source_count >= limits.source_soft_cap {
            return false;
        }

        if candidate.in_network == Some(false) && self.oon_count >= constraints.max_oon_count {
            return false;
        }

        if let Some(lane_ceiling) = constraints.lane_ceilings.get(lane) {
            let current_lane_count = self.lane_counts.get(lane).copied().unwrap_or_default();
            if current_lane_count >= *lane_ceiling {
                return false;
            }
        }

        if let Some(topic_key) = candidate_topic_key(candidate) {
            let topic_count = self
                .topic_counts
                .get(&topic_key)
                .copied()
                .unwrap_or_default();
            if topic_count >= limits.topic_soft_cap {
                return false;
            }
        }

        true
    }

    pub(super) fn apply_candidate(
        &mut self,
        candidates: &[RecommendationCandidatePayload],
        index: usize,
    ) {
        if !self.selected_indexes.insert(index) {
            return;
        }
        self.selection_order.push(index);

        let candidate = &candidates[index];
        *self
            .author_counts
            .entry(candidate.author_id.clone())
            .or_insert(0) += 1;
        *self
            .lane_counts
            .entry(candidate_lane(candidate).to_string())
            .or_insert(0) += 1;
        *self
            .source_counts
            .entry(candidate_source(candidate).to_string())
            .or_insert(0) += 1;
        if let Some(topic_key) = candidate_topic_key(candidate) {
            *self.topic_counts.entry(topic_key).or_insert(0) += 1;
        }
        if candidate.in_network == Some(false) {
            self.oon_count += 1;
        }
        if is_trend_candidate(candidate) {
            self.trend_count += 1;
        }
        if is_news_candidate(candidate) {
            self.news_count += 1;
        }
    }
}
