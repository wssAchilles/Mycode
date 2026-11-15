//! 本地过滤器编排模块：按打分前（Pre-score）与精选后（Post-selection）两阶段驱动领域子过滤器。

use std::collections::HashMap;

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};

mod author_socialgraph_filter;
mod common;
mod conversation;
mod dedup;
mod detail;
mod exposure;
mod hygiene;
mod new_user_topic_filter;
mod quality;
mod seen_backup_filter;
mod subscription_filter;
mod topic_filter;
mod video_filter;
mod visibility;

use author_socialgraph_filter::author_socialgraph_filter;
use conversation::conversation_dedup_filter;
use dedup::{duplicate_filter, news_external_id_dedup_filter, retweet_dedup_filter};
use exposure::{previously_served_filter, seen_post_filter};
use hygiene::{age_filter, muted_keyword_filter, self_post_filter};
use new_user_topic_filter::new_user_topic_filter;
use quality::quality_guard_filter;
use seen_backup_filter::previously_seen_posts_backup_filter;
use subscription_filter::subscription_filter;
use topic_filter::topic_filter;
use video_filter::video_filter;
use visibility::vf_filter;

/// 本地过滤 stage 执行结果汇总。
pub struct LocalFilterExecution {
    pub candidates: Vec<RecommendationCandidatePayload>,
    pub drop_counts: HashMap<String, usize>,
    pub stages: Vec<RecommendationStagePayload>,
}

type FilterFn = fn(
    &RecommendationQueryPayload,
    Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
    bool,
);

fn execute_filter_chain(
    query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
    filters: &[FilterFn],
) -> LocalFilterExecution {
    let mut current = candidates;
    let mut drop_counts = HashMap::new();
    let mut stages = Vec::new();

    for &filter in filters {
        let (next, _dropped, stage, enabled) = filter(query, current);
        if enabled {
            drop_counts.insert(stage.name.clone(), stage.removed_count.unwrap_or_default());
        }
        current = next;
        stages.push(stage);
    }

    LocalFilterExecution {
        candidates: current,
        drop_counts,
        stages,
    }
}

/// 在 Heavy/Weighted 打分前执行的 15 路内容卫生、去重、疲劳与社交图谱过滤链。
pub fn run_pre_score_filters(
    query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> LocalFilterExecution {
    execute_filter_chain(
        query,
        candidates,
        &[
            duplicate_filter,
            news_external_id_dedup_filter,
            self_post_filter,
            retweet_dedup_filter,
            age_filter,
            quality_guard_filter,
            author_socialgraph_filter,
            muted_keyword_filter,
            seen_post_filter,
            previously_seen_posts_backup_filter,
            previously_served_filter,
            topic_filter,
            new_user_topic_filter,
            video_filter,
            subscription_filter,
        ],
    )
}

/// 在 Selector 精选之后执行的可见性安全审查与同会话串联去重链。
pub fn run_post_selection_filters(
    query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> LocalFilterExecution {
    execute_filter_chain(query, candidates, &[vf_filter, conversation_dedup_filter])
}

#[cfg(test)]
mod tests;
