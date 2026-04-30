use std::collections::HashSet;

use crate::contracts::RecommendationCandidatePayload;

use super::policy::dedup_reason_priority;
use super::semantic::candidate_semantic_tokens;
use super::state::{DedupWorkset, ReinsertSummary, SuppressionSummary};
use super::{AUTHOR_SOFT_CAP_REASON, NEAR_DUPLICATE_CONTENT_REASON};

pub(super) fn reinsert_deferred_candidates(
    limit: usize,
    workset: &mut DedupWorkset,
) -> ReinsertSummary {
    let mut summary = ReinsertSummary::default();
    if limit == 0 || workset.state.kept.len() >= limit {
        return summary;
    }

    let mut plans = build_reinsert_plans(workset);
    plans.sort_by(|left, right| {
        left.priority
            .cmp(&right.priority)
            .then_with(|| right.score.total_cmp(&left.score))
            .then_with(|| left.index.cmp(&right.index))
    });

    for plan in plans {
        if workset.state.kept.len() >= limit {
            break;
        }
        if workset
            .state
            .has_seen_related_or_conversation(&plan.candidate, &plan.related_ids)
        {
            continue;
        }

        let semantic_tokens = plan
            .semantic_tokens
            .unwrap_or_else(|| candidate_semantic_tokens(&plan.candidate));
        workset
            .state
            .keep(plan.candidate, &plan.related_ids, semantic_tokens);
        summary.record(plan.kind, plan.index);
    }

    summary
}

#[derive(Debug, Clone, Copy)]
enum ReinsertKind {
    CrossRequest,
    NearDuplicate,
    AuthorSoftCap,
}

struct ReinsertPlan {
    kind: ReinsertKind,
    index: usize,
    priority: u8,
    score: f64,
    candidate: RecommendationCandidatePayload,
    related_ids: Vec<String>,
    semantic_tokens: Option<HashSet<String>>,
}

fn build_reinsert_plans(workset: &DedupWorkset) -> Vec<ReinsertPlan> {
    let mut plans = Vec::new();
    for (index, deferred) in workset.deferred_cross_request_soft_cap.iter().enumerate() {
        plans.push(ReinsertPlan {
            kind: ReinsertKind::CrossRequest,
            index,
            priority: dedup_reason_priority(deferred.reason),
            score: candidate_score(&deferred.candidate),
            candidate: deferred.candidate.clone(),
            related_ids: deferred.related_ids.clone(),
            semantic_tokens: None,
        });
    }

    for (index, deferred) in workset.deferred_near_duplicate.iter().enumerate() {
        plans.push(ReinsertPlan {
            kind: ReinsertKind::NearDuplicate,
            index,
            priority: dedup_reason_priority(NEAR_DUPLICATE_CONTENT_REASON),
            score: candidate_score(&deferred.candidate),
            candidate: deferred.candidate.clone(),
            related_ids: deferred.related_ids.clone(),
            semantic_tokens: Some(deferred.semantic_tokens.clone()),
        });
    }

    for (index, deferred) in workset.deferred_author_soft_cap.iter().enumerate() {
        plans.push(ReinsertPlan {
            kind: ReinsertKind::AuthorSoftCap,
            index,
            priority: dedup_reason_priority(AUTHOR_SOFT_CAP_REASON),
            score: candidate_score(&deferred.candidate),
            candidate: deferred.candidate.clone(),
            related_ids: deferred.related_ids.clone(),
            semantic_tokens: None,
        });
    }

    plans
}

fn candidate_score(candidate: &RecommendationCandidatePayload) -> f64 {
    candidate
        .score
        .or(candidate.weighted_score)
        .or(candidate.pipeline_score)
        .unwrap_or_default()
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

impl Default for ReinsertSummary {
    fn default() -> Self {
        Self {
            cross_request_indexes: HashSet::new(),
            near_duplicate_count: 0,
            author_soft_cap_count: 0,
        }
    }
}

impl ReinsertSummary {
    fn record(&mut self, kind: ReinsertKind, index: usize) {
        match kind {
            ReinsertKind::CrossRequest => {
                self.cross_request_indexes.insert(index);
            }
            ReinsertKind::NearDuplicate => {
                self.near_duplicate_count = self.near_duplicate_count.saturating_add(1);
            }
            ReinsertKind::AuthorSoftCap => {
                self.author_soft_cap_count = self.author_soft_cap_count.saturating_add(1);
            }
        }
    }
}
