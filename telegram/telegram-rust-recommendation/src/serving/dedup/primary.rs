use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};

use super::identity::related_ids;
use super::semantic::{candidate_semantic_tokens, is_near_duplicate_content};
use super::soft_caps::cross_request_soft_cap_reason;
use super::state::{
    DedupWorkset, DeferredAuthorSoftCap, DeferredCrossRequestSoftCap, DeferredNearDuplicate,
    ServedContext,
};
use super::{CONTENT_DUPLICATE_REASON, CONVERSATION_DUPLICATE_REASON, SERVED_STATE_REASON};

pub(super) fn run_primary_dedup_pass(
    query: &RecommendationQueryPayload,
    candidates: &[RecommendationCandidatePayload],
    author_soft_cap: usize,
    served_context: &ServedContext,
    workset: &mut DedupWorkset,
) {
    for candidate in candidates.iter().cloned() {
        let related_ids = related_ids(&candidate);
        if related_ids
            .iter()
            .any(|id| served_context.served_state.contains(id))
        {
            workset.state.suppress(SERVED_STATE_REASON);
            workset.state.cross_page_duplicate_count =
                workset.state.cross_page_duplicate_count.saturating_add(1);
            continue;
        }

        if related_ids
            .iter()
            .any(|id| workset.state.seen_related_ids.contains(id))
        {
            workset.state.suppress(CONTENT_DUPLICATE_REASON);
            continue;
        }

        if candidate
            .conversation_id
            .as_ref()
            .is_some_and(|conversation_id| {
                workset.state.seen_conversations.contains(conversation_id)
            })
        {
            workset.state.suppress(CONVERSATION_DUPLICATE_REASON);
            continue;
        }

        let semantic_tokens = candidate_semantic_tokens(&candidate);
        if is_near_duplicate_content(query, &semantic_tokens, &workset.state.seen_semantic_sets) {
            workset.deferred_near_duplicate.push(DeferredNearDuplicate {
                candidate,
                related_ids,
                semantic_tokens,
            });
            continue;
        }

        if let Some(reason) = cross_request_soft_cap_reason(
            &candidate,
            &served_context.served_author_counts,
            &served_context.served_source_counts,
            &served_context.served_topic_counts,
            &workset.state.author_counts,
            &workset.state.source_counts,
            &workset.state.topic_counts,
            served_context.author_soft_cap,
            served_context.source_soft_cap,
            served_context.topic_soft_cap,
        ) {
            workset
                .deferred_cross_request_soft_cap
                .push(DeferredCrossRequestSoftCap {
                    candidate,
                    related_ids,
                    reason,
                });
            continue;
        }

        let author_count = workset
            .state
            .author_counts
            .get(&candidate.author_id)
            .copied()
            .unwrap_or_default();
        if author_soft_cap > 0 && author_count >= author_soft_cap {
            workset
                .deferred_author_soft_cap
                .push(DeferredAuthorSoftCap {
                    candidate,
                    related_ids,
                });
            continue;
        }

        workset.state.keep(candidate, &related_ids, semantic_tokens);
    }
}
