use std::collections::{HashMap, HashSet};

use crate::contracts::RecommendationCandidatePayload;

use super::candidates::{
    candidate_domain_key, candidate_lane, candidate_media_key, candidate_source,
    candidate_topic_key, is_news_candidate, is_trend_candidate,
};
use super::constraints::{ConstraintVerdict, SelectionLimits, SelectorConstraints};

#[derive(Default)]
pub(super) struct SelectionState {
    selected_indexes: HashSet<usize>,
    pub(super) selection_order: Vec<usize>,
    author_counts: HashMap<String, usize>,
    lane_counts: HashMap<String, usize>,
    source_counts: HashMap<String, usize>,
    domain_counts: HashMap<String, usize>,
    media_counts: HashMap<String, usize>,
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

                if !self
                    .constraint_verdict(candidate, required_lane, constraints, limits)
                    .pass
                {
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
        self.constraint_verdict(candidate, required_lane, constraints, limits)
            .pass
    }

    pub(super) fn constraint_verdict(
        &self,
        candidate: &RecommendationCandidatePayload,
        required_lane: Option<&str>,
        constraints: &SelectorConstraints,
        limits: SelectionLimits,
    ) -> ConstraintVerdict {
        let lane = candidate_lane(candidate);
        if required_lane.is_some_and(|required_lane| lane != required_lane) {
            return ConstraintVerdict::block("required_lane_mismatch", false, 10);
        }

        let author_count = self
            .author_counts
            .get(&candidate.author_id)
            .copied()
            .unwrap_or_default();
        if author_count >= limits.author_soft_cap {
            return ConstraintVerdict::block("author_soft_cap", true, 80);
        }

        if is_trend_candidate(candidate) && self.trend_count >= constraints.trend_ceiling {
            return ConstraintVerdict::block("trend_ceiling", true, 40);
        }

        if is_news_candidate(candidate) && self.news_count >= constraints.news_ceiling {
            return ConstraintVerdict::block("news_ceiling", true, 42);
        }

        if let Some(domain_key) = candidate_domain_key(candidate) {
            let domain_count = self
                .domain_counts
                .get(&domain_key)
                .copied()
                .unwrap_or_default();
            if domain_count >= limits.domain_soft_cap {
                return ConstraintVerdict::block("domain_soft_cap", true, 66);
            }
        }

        if let Some(media_key) = candidate_media_key(candidate) {
            let media_count = self
                .media_counts
                .get(media_key)
                .copied()
                .unwrap_or_default();
            if media_count >= limits.media_soft_cap {
                return ConstraintVerdict::block("media_soft_cap", true, 68);
            }
        }

        if !limits.enforce_constraints {
            return ConstraintVerdict::pass();
        }

        let source_count = self
            .source_counts
            .get(candidate_source(candidate))
            .copied()
            .unwrap_or_default();
        if source_count >= limits.source_soft_cap {
            return ConstraintVerdict::block("source_soft_cap", true, 62);
        }

        if candidate.in_network == Some(false) && self.oon_count >= constraints.max_oon_count {
            return ConstraintVerdict::block("oon_ceiling", true, 36);
        }

        if let Some(lane_ceiling) = constraints.lane_ceilings.get(lane) {
            let current_lane_count = self.lane_counts.get(lane).copied().unwrap_or_default();
            if current_lane_count >= *lane_ceiling {
                return ConstraintVerdict::block("lane_ceiling", true, 32);
            }
        }

        if let Some(topic_key) = candidate_topic_key(candidate) {
            let topic_count = self
                .topic_counts
                .get(&topic_key)
                .copied()
                .unwrap_or_default();
            if topic_count >= limits.topic_soft_cap {
                return ConstraintVerdict::block("topic_soft_cap", true, 70);
            }
        }

        ConstraintVerdict::pass()
    }

    pub(super) fn blocking_reason_counts(
        &self,
        candidates: &[RecommendationCandidatePayload],
        constraints: &SelectorConstraints,
        limits: SelectionLimits,
    ) -> HashMap<String, usize> {
        let mut counts = HashMap::new();
        for (index, candidate) in candidates.iter().enumerate() {
            if self.selected_indexes.contains(&index) {
                continue;
            }
            let verdict = self.constraint_verdict(candidate, None, constraints, limits);
            if verdict.pass {
                continue;
            }
            *counts.entry(verdict.reason.to_string()).or_insert(0) += 1;
        }
        counts
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
        if let Some(domain_key) = candidate_domain_key(candidate) {
            *self.domain_counts.entry(domain_key).or_insert(0) += 1;
        }
        if let Some(media_key) = candidate_media_key(candidate) {
            *self.media_counts.entry(media_key.to_string()).or_insert(0) += 1;
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
