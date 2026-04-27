use std::collections::HashSet;

use super::semantic::candidate_semantic_tokens;
use super::state::{DedupWorkset, ReinsertSummary, SuppressionSummary};
use super::{AUTHOR_SOFT_CAP_REASON, NEAR_DUPLICATE_CONTENT_REASON};

pub(super) fn reinsert_deferred_candidates(
    limit: usize,
    workset: &mut DedupWorkset,
) -> ReinsertSummary {
    let cross_request_indexes = reinsert_cross_request_soft_cap(limit, workset);
    let near_duplicate_count = reinsert_near_duplicates(limit, workset);
    let author_soft_cap_count = reinsert_author_soft_cap(limit, workset);

    ReinsertSummary {
        cross_request_indexes,
        near_duplicate_count,
        author_soft_cap_count,
    }
}

fn reinsert_cross_request_soft_cap(limit: usize, workset: &mut DedupWorkset) -> HashSet<usize> {
    let mut reinserted_indexes = HashSet::new();
    if limit == 0 || workset.state.kept.len() >= limit {
        return reinserted_indexes;
    }

    let needed = limit.saturating_sub(workset.state.kept.len());
    for (index, deferred) in workset.deferred_cross_request_soft_cap.iter().enumerate() {
        if reinserted_indexes.len() >= needed {
            break;
        }
        if workset
            .state
            .has_seen_related_or_conversation(&deferred.candidate, &deferred.related_ids)
        {
            continue;
        }
        workset.state.keep(
            deferred.candidate.clone(),
            &deferred.related_ids,
            candidate_semantic_tokens(&deferred.candidate),
        );
        reinserted_indexes.insert(index);
    }
    reinserted_indexes
}

fn reinsert_near_duplicates(limit: usize, workset: &mut DedupWorkset) -> usize {
    if limit == 0 || workset.state.kept.len() >= limit {
        return 0;
    }

    let needed = limit.saturating_sub(workset.state.kept.len());
    let mut reinserted = 0usize;
    for deferred in workset.deferred_near_duplicate.iter().take(needed) {
        if workset
            .state
            .has_seen_related_or_conversation(&deferred.candidate, &deferred.related_ids)
        {
            continue;
        }
        workset.state.keep(
            deferred.candidate.clone(),
            &deferred.related_ids,
            deferred.semantic_tokens.clone(),
        );
        reinserted = reinserted.saturating_add(1);
    }
    reinserted
}

fn reinsert_author_soft_cap(limit: usize, workset: &mut DedupWorkset) -> usize {
    if limit == 0 || workset.state.kept.len() >= limit {
        return 0;
    }

    let needed = limit.saturating_sub(workset.state.kept.len());
    let mut reinserted = 0usize;
    for deferred in workset.deferred_author_soft_cap.iter().take(needed) {
        if workset
            .state
            .has_seen_related_or_conversation(&deferred.candidate, &deferred.related_ids)
        {
            continue;
        }
        workset.state.keep(
            deferred.candidate.clone(),
            &deferred.related_ids,
            candidate_semantic_tokens(&deferred.candidate),
        );
        reinserted = reinserted.saturating_add(1);
    }
    reinserted
}

pub(super) fn apply_deferred_suppression_counts(
    workset: &mut DedupWorkset,
    reinserted: &ReinsertSummary,
) -> SuppressionSummary {
    let mut cross_request_suppressed = 0usize;
    for (index, deferred) in workset.deferred_cross_request_soft_cap.iter().enumerate() {
        if reinserted.cross_request_indexes.contains(&index) {
            continue;
        }
        workset.state.suppress(deferred.reason);
        cross_request_suppressed = cross_request_suppressed.saturating_add(1);
    }

    let author_soft_cap_suppressed = workset
        .deferred_author_soft_cap
        .len()
        .saturating_sub(reinserted.author_soft_cap_count);
    let near_duplicate_suppressed = workset
        .deferred_near_duplicate
        .len()
        .saturating_sub(reinserted.near_duplicate_count);
    if near_duplicate_suppressed > 0 {
        *workset
            .state
            .suppression_reasons
            .entry(NEAR_DUPLICATE_CONTENT_REASON.to_string())
            .or_insert(0) += near_duplicate_suppressed;
    }
    if author_soft_cap_suppressed > 0 {
        *workset
            .state
            .suppression_reasons
            .entry(AUTHOR_SOFT_CAP_REASON.to_string())
            .or_insert(0) += author_soft_cap_suppressed;
    }

    SuppressionSummary {
        cross_request_suppressed,
        near_duplicate_suppressed,
        author_soft_cap_suppressed,
    }
}
