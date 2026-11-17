//! 双向拉黑与社交图谱过滤入口：复用本地过滤链中的多边关系校验，同时保留兼容的轻量 API。

use std::collections::HashSet;

use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};
use crate::pipeline::local::filters::author_socialgraph_filter::{
    build_post_author_map, evaluate_candidate_socialgraph,
};

/// 双向拉黑过滤器：拦截已拉黑作者及反向拉黑观看者的作者（含转发/引用原作者多边校验）。
pub struct BlockedByFilter;

impl BlockedByFilter {
    /// 返回组件标准名称。
    pub fn name() -> &'static str {
        "BlockedByFilter"
    }

    /// 兼容既有单候选校验签名：检查观看者拉黑作者与作者反向拉黑观看者。
    pub fn should_keep(
        candidate: &RecommendationCandidatePayload,
        blocked_user_ids: &[String],
    ) -> bool {
        if blocked_user_ids.contains(&candidate.author_id) {
            return false;
        }

        if candidate.author_blocks_viewer.unwrap_or(false) {
            return false;
        }

        true
    }
}

/// 对候选列表执行兼容的基础双向拉黑过滤。
pub fn apply_blocked_by_filter(
    candidates: Vec<RecommendationCandidatePayload>,
    query: &RecommendationQueryPayload,
) -> Vec<RecommendationCandidatePayload> {
    let blocked_user_ids = query
        .user_features
        .as_ref()
        .map(|f| f.blocked_user_ids.clone())
        .unwrap_or_default();

    candidates
        .into_iter()
        .filter(|c| BlockedByFilter::should_keep(c, &blocked_user_ids))
        .collect()
}

/// 对候选列表执行包含转发/引用原作者映射、静音列表与双向拉黑的多边社交图谱过滤。
pub fn apply_blocked_by_filter_with_socialgraph(
    candidates: Vec<RecommendationCandidatePayload>,
    query: &RecommendationQueryPayload,
) -> Vec<RecommendationCandidatePayload> {
    let features = query.user_features.as_ref();
    let blocked: HashSet<String> = features
        .map(|f| f.blocked_user_ids.iter().cloned().collect())
        .unwrap_or_default();
    let muted: HashSet<String> = features
        .map(|f| f.muted_user_ids.iter().cloned().collect())
        .unwrap_or_default();
    let post_author_map = build_post_author_map(query, &candidates);

    candidates
        .into_iter()
        .filter(|candidate| {
            evaluate_candidate_socialgraph(candidate, &blocked, &muted, &post_author_map).is_ok()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::UserFeaturesPayload;
    use chrono::Utc;

    fn make_candidate(
        id: &str,
        author_id: &str,
        author_blocks_viewer: Option<bool>,
    ) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: id.to_string(),
            model_post_id: None,
            author_id: author_id.to_string(),
            content: String::new(),
            created_at: Utc::now(),
            conversation_id: None,
            is_reply: false,
            reply_to_post_id: None,
            is_repost: false,
            original_post_id: None,
            in_network: None,
            recall_source: None,
            retrieval_lane: None,
            interest_pool_kind: None,
            secondary_recall_sources: None,
            has_video: None,
            has_image: None,
            video_duration_sec: None,
            has_media: false,
            media_type: crate::contracts::MediaType::None,
            video_duration_ms: None,
            media: None,
            topic_ids: Vec::new(),
            like_count: None,
            comment_count: None,
            repost_count: None,
            view_count: None,
            author_username: None,
            author_avatar_url: None,
            author_affinity_score: None,
            author_blocks_viewer,
            language_code: None,
            phoenix_scores: None,
            action_scores: None,
            ranking_signals: None,
            recall_evidence: None,
            selection_pool: None,
            selection_reason: None,
            score_contract_version: None,
            score_breakdown_version: None,
            weighted_score: None,
            score: None,
            is_liked_by_user: None,
            is_reposted_by_user: None,
            is_nsfw: None,
            vf_result: None,
            is_news: None,
            news_metadata: None,
            is_pinned: None,
            is_subscription_only: None,
            graph_score: None,
            graph_path: None,
            graph_recall_type: None,
            post_type: None,
            mutual_follow_jaccard: None,
            following_replied: None,
            pipeline_score: None,
            score_breakdown: None,
            ..Default::default()
        }
    }

    #[test]
    fn keeps_unblocked_candidate() {
        let candidate = make_candidate("p1", "author-1", None);
        let blocked = vec!["author-2".to_string()];
        assert!(BlockedByFilter::should_keep(&candidate, &blocked));
    }

    #[test]
    fn filters_when_viewer_blocked_author() {
        let candidate = make_candidate("p1", "author-1", None);
        let blocked = vec!["author-1".to_string()];
        assert!(!BlockedByFilter::should_keep(&candidate, &blocked));
    }

    #[test]
    fn filters_when_author_blocked_viewer() {
        let candidate = make_candidate("p1", "author-1", Some(true));
        let blocked: Vec<String> = vec![];
        assert!(!BlockedByFilter::should_keep(&candidate, &blocked));
    }

    #[test]
    fn filters_when_both_blocked() {
        let candidate = make_candidate("p1", "author-1", Some(true));
        let blocked = vec!["author-1".to_string()];
        assert!(!BlockedByFilter::should_keep(&candidate, &blocked));
    }

    #[test]
    fn filters_repost_when_original_author_blocked() {
        let orig = make_candidate("orig-1", "blocked-orig", None);
        let mut repost = make_candidate("repost-1", "safe-user", None);
        repost.is_repost = true;
        repost.original_post_id = Some("orig-1".to_string());
        let clean = make_candidate("clean-1", "safe-user-2", None);

        let query = RecommendationQueryPayload {
            request_id: "req-blocked-by".to_string(),
            decision_id: "00000000-0000-4000-8000-0000000000aa".to_string(),
            user_id: "viewer-1".to_string(),
            user_features: Some(UserFeaturesPayload {
                blocked_user_ids: vec!["blocked-orig".to_string()],
                ..Default::default()
            }),
            ..Default::default()
        };

        let kept = apply_blocked_by_filter_with_socialgraph(vec![orig, repost, clean], &query);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].post_id, "clean-1");
    }
}
