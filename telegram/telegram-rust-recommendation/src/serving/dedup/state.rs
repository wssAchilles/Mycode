use std::collections::{HashMap, HashSet};

use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};
use crate::pipeline::local::context::ranking_policy_usize;

use super::identity::record_candidate_state;
use super::semantic::record_semantic_state;
use super::soft_caps::served_context_counts;

pub(super) struct ServedContext {
    pub(super) served_state: HashSet<String>,
    pub(super) served_author_counts: HashMap<String, usize>,
    pub(super) served_source_counts: HashMap<String, usize>,
    pub(super) served_topic_counts: HashMap<String, usize>,
    pub(super) author_soft_cap: usize,
    pub(super) source_soft_cap: usize,
    pub(super) topic_soft_cap: usize,
}

#[derive(Default)]
pub(super) struct DedupState {
    pub(super) kept: Vec<RecommendationCandidatePayload>,
    pub(super) seen_related_ids: HashSet<String>,
    pub(super) seen_conversations: HashSet<String>,
    pub(super) seen_semantic_sets: Vec<HashSet<String>>,
    pub(super) author_counts: HashMap<String, usize>,
    pub(super) source_counts: HashMap<String, usize>,
    pub(super) topic_counts: HashMap<String, usize>,
    pub(super) suppression_reasons: HashMap<String, usize>,
    pub(super) cross_page_duplicate_count: usize,
}

pub(super) struct DeferredNearDuplicate {
    pub(super) candidate: RecommendationCandidatePayload,
    pub(super) related_ids: Vec<String>,
    pub(super) semantic_tokens: HashSet<String>,
}

pub(super) struct DeferredAuthorSoftCap {
    pub(super) candidate: RecommendationCandidatePayload,
    pub(super) related_ids: Vec<String>,
}

pub(super) struct DeferredCrossRequestSoftCap {
    pub(super) candidate: RecommendationCandidatePayload,
    pub(super) related_ids: Vec<String>,
    pub(super) reason: &'static str,
}

#[derive(Default)]
pub(super) struct DedupWorkset {
    pub(super) state: DedupState,
    pub(super) deferred_near_duplicate: Vec<DeferredNearDuplicate>,
    pub(super) deferred_author_soft_cap: Vec<DeferredAuthorSoftCap>,
    pub(super) deferred_cross_request_soft_cap: Vec<DeferredCrossRequestSoftCap>,
}

pub(super) struct ReinsertSummary {
    pub(super) cross_request_indexes: HashSet<usize>,
    pub(super) near_duplicate_count: usize,
    pub(super) author_soft_cap_count: usize,
}

pub(super) struct SuppressionSummary {
    pub(super) cross_request_suppressed: usize,
    pub(super) near_duplicate_suppressed: usize,
    pub(super) author_soft_cap_suppressed: usize,
}

impl ServedContext {
    pub(super) fn from_query(query: &RecommendationQueryPayload) -> Self {
        let served_state = query
            .served_ids
            .iter()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .collect::<HashSet<_>>();
        let served_author_counts = served_context_counts(&served_state, "author:");
        let served_source_counts = served_context_counts(&served_state, "source:");
        let served_topic_counts = served_context_counts(&served_state, "topic:");

        Self {
            served_state,
            served_author_counts,
            served_source_counts,
            served_topic_counts,
            author_soft_cap: ranking_policy_usize(query, "cross_request_author_soft_cap", 0),
            source_soft_cap: ranking_policy_usize(query, "cross_request_source_soft_cap", 0),
            topic_soft_cap: ranking_policy_usize(query, "cross_request_topic_soft_cap", 0),
        }
    }
}

impl DedupWorkset {
    pub(super) fn with_capacity(capacity: usize) -> Self {
        Self {
            state: DedupState {
                kept: Vec::with_capacity(capacity),
                ..DedupState::default()
            },
            ..DedupWorkset::default()
        }
    }
}

impl DedupState {
    pub(super) fn suppress(&mut self, reason: &str) {
        *self
            .suppression_reasons
            .entry(reason.to_string())
            .or_insert(0) += 1;
    }

    pub(super) fn has_seen_related_or_conversation(
        &self,
        candidate: &RecommendationCandidatePayload,
        related_ids: &[String],
    ) -> bool {
        related_ids
            .iter()
            .any(|id| self.seen_related_ids.contains(id))
            || candidate
                .conversation_id
                .as_ref()
                .is_some_and(|conversation_id| self.seen_conversations.contains(conversation_id))
    }

    pub(super) fn keep(
        &mut self,
        candidate: RecommendationCandidatePayload,
        related_ids: &[String],
        semantic_tokens: HashSet<String>,
    ) {
        *self
            .author_counts
            .entry(candidate.author_id.clone())
            .or_insert(0usize) += 1;
        record_candidate_state(
            &candidate,
            related_ids,
            &mut self.seen_related_ids,
            &mut self.seen_conversations,
            &mut self.source_counts,
            &mut self.topic_counts,
        );
        record_semantic_state(&mut self.seen_semantic_sets, semantic_tokens);
        self.kept.push(candidate);
    }
}
