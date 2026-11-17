//! 作者社交图谱多边过滤模块（对标 `x-algorithm` 的 `AuthorSocialgraphFilter` 与 `QuotedTweetRules`）。
//! 在直接发帖作者之外，同步解析转发/引用原作者及回复关联作者映射，执行双向拉黑与静音校验。

use std::collections::{HashMap, HashSet};

use serde_json::Value;
use telegram_component_primitives::filters::AUTHOR_SOCIALGRAPH_FILTER;
use telegram_filter_primitives::FILTER_DROP_REASON_BLOCKED_AUTHOR;

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};

use super::common::partition;
use super::detail::{build_disabled_stage, build_stage};

/// 作者关系映射条目的值：`(author_id, author_blocks_viewer)`。
#[derive(Debug, Clone)]
pub(crate) struct AuthorSocialEdge {
    pub author_id: String,
    pub blocks_viewer: bool,
}

/// 解析候选批次与缓存帖上下文中的 `post_id -> AuthorSocialEdge` 映射表。
pub(crate) fn build_post_author_map(
    query: &RecommendationQueryPayload,
    candidates: &[RecommendationCandidatePayload],
) -> HashMap<String, AuthorSocialEdge> {
    let mut map: HashMap<String, AuthorSocialEdge> = HashMap::new();

    for cached in &query.cached_posts {
        let post_id = cached.post_id.trim();
        let author_id = cached.author_id.trim();
        if post_id.is_empty() || author_id.is_empty() {
            continue;
        }
        map.entry(post_id.to_string())
            .or_insert_with(|| AuthorSocialEdge {
                author_id: author_id.to_string(),
                blocks_viewer: false,
            });
    }

    for candidate in candidates {
        let author_id = candidate.author_id.trim();
        if author_id.is_empty() {
            continue;
        }
        let blocks_viewer = candidate.author_blocks_viewer.unwrap_or(false);
        for key in [
            Some(candidate.post_id.as_str()),
            candidate.model_post_id.as_deref(),
        ]
        .into_iter()
        .flatten()
        .map(str::trim)
        .filter(|id| !id.is_empty())
        {
            map.entry(key.to_string())
                .and_modify(|edge| {
                    edge.blocks_viewer |= blocks_viewer;
                })
                .or_insert_with(|| AuthorSocialEdge {
                    author_id: author_id.to_string(),
                    blocks_viewer,
                });
        }
    }

    map
}

/// 从 `graph_path` 提取显式标注的原作者 / 引用作者 / 根作者列表（如 `original_author:u1|u2;quoted_author:u3`）。
fn extract_graph_path_related_authors(candidate: &RecommendationCandidatePayload) -> Vec<String> {
    let Some(path) = candidate.graph_path.as_deref() else {
        return Vec::new();
    };
    let mut authors = Vec::new();
    for segment in path.split(';') {
        let trimmed = segment.trim();
        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };
        let key_lower = key.trim().to_ascii_lowercase();
        if matches!(
            key_lower.as_str(),
            "original_author" | "repost_author" | "quoted_author" | "root_author"
        ) {
            for author in value.split('|').map(str::trim).filter(|s| !s.is_empty()) {
                authors.push(author.to_string());
            }
        }
    }
    authors
}

/// 检查安全标签或 VF 违规中是否显式记录了反向/引用拉黑信号。
fn has_reverse_socialgraph_label(candidate: &RecommendationCandidatePayload) -> bool {
    let is_block_tag = |tag: &str| {
        let lower = tag.trim().to_ascii_lowercase();
        matches!(
            lower.as_str(),
            "author_blocks_viewer"
                | "author_block_viewer"
                | "quoted_author_blocks_viewer"
                | "quoted_author_blocks_quoting_author"
                | "original_author_blocks_viewer"
                | "repost_author_blocks_viewer"
                | "mutual_block"
                | "blocked_by_author"
        )
    };

    if let Some(vf) = candidate.vf_result.as_ref() {
        if vf.reason.as_deref().is_some_and(is_block_tag) {
            return true;
        }
        if vf
            .violations
            .as_ref()
            .is_some_and(|list| list.iter().any(|tag| is_block_tag(tag)))
        {
            return true;
        }
    }

    if let Some(labels) = candidate.content_safety_labels.as_ref()
        && labels.labels.iter().any(|tag| is_block_tag(tag))
    {
        return true;
    }

    false
}

/// 判定候选是否存在反向拉黑（直接作者拉黑、标签记录反向拉黑或关联原帖作者拉黑）。
fn candidate_has_reverse_block(
    candidate: &RecommendationCandidatePayload,
    post_author_map: &HashMap<String, AuthorSocialEdge>,
) -> bool {
    if candidate.author_blocks_viewer.unwrap_or(false) || has_reverse_socialgraph_label(candidate) {
        return true;
    }

    for post_ref in [
        candidate.original_post_id.as_deref(),
        candidate.reply_to_post_id.as_deref(),
    ]
    .into_iter()
    .flatten()
    .map(str::trim)
    .filter(|id| !id.is_empty())
    {
        if let Some(edge) = post_author_map.get(post_ref)
            && edge.blocks_viewer
        {
            return true;
        }
    }

    false
}

/// 单候选社交图谱拦截细分原因，用于统计与审计。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SocialgraphDropKind {
    ViewerBlockedAuthor,
    ViewerMutedAuthor,
    AuthorBlocksViewer,
    OriginalAuthorBlockedOrMuted,
    OriginalAuthorBlocksViewer,
}

/// 评估候选是否应通过多边社交图谱校验，拦截时返回细分拦截原因。
pub(crate) fn evaluate_candidate_socialgraph(
    candidate: &RecommendationCandidatePayload,
    blocked: &HashSet<String>,
    muted: &HashSet<String>,
    post_author_map: &HashMap<String, AuthorSocialEdge>,
) -> Result<(), SocialgraphDropKind> {
    // 1. 直接作者双向校验：观看者静音/拉黑直接作者，或直接作者反向拉黑观看者
    if muted.contains(&candidate.author_id) {
        return Err(SocialgraphDropKind::ViewerMutedAuthor);
    }
    if blocked.contains(&candidate.author_id) {
        return Err(SocialgraphDropKind::ViewerBlockedAuthor);
    }
    if candidate.author_blocks_viewer.unwrap_or(false) || has_reverse_socialgraph_label(candidate) {
        return Err(SocialgraphDropKind::AuthorBlocksViewer);
    }

    // 2. 转发/引用/回复关联原作者映射校验（基于 batch payload 与 cached_posts 映射表）
    for post_ref in [
        candidate.original_post_id.as_deref(),
        candidate.reply_to_post_id.as_deref(),
    ]
    .into_iter()
    .flatten()
    .map(str::trim)
    .filter(|id| !id.is_empty())
    {
        if let Some(edge) = post_author_map.get(post_ref) {
            if blocked.contains(&edge.author_id) || muted.contains(&edge.author_id) {
                return Err(SocialgraphDropKind::OriginalAuthorBlockedOrMuted);
            }
            if edge.blocks_viewer {
                return Err(SocialgraphDropKind::OriginalAuthorBlocksViewer);
            }
        }
    }

    // 3. `graph_path` 显式携带的转发/引用/根作者多边校验
    for related_author in extract_graph_path_related_authors(candidate) {
        if blocked.contains(&related_author) || muted.contains(&related_author) {
            return Err(SocialgraphDropKind::OriginalAuthorBlockedOrMuted);
        }
    }

    Ok(())
}

/// 执行作者社交图谱多边过滤：拦截直接作者、转发/引用原作者与双向拉黑/静音候选。
pub(super) fn author_socialgraph_filter(
    query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
    bool,
) {
    let input_count = candidates.len();
    let features = query.user_features.as_ref();

    let blocked: HashSet<String> = features
        .map(|f| f.blocked_user_ids.iter().cloned().collect())
        .unwrap_or_default();
    let muted: HashSet<String> = features
        .map(|f| f.muted_user_ids.iter().cloned().collect())
        .unwrap_or_default();

    let post_author_map = build_post_author_map(query, &candidates);
    let has_reverse_block = candidates
        .iter()
        .any(|c| candidate_has_reverse_block(c, &post_author_map));

    if blocked.is_empty() && muted.is_empty() && !has_reverse_block {
        return (
            candidates,
            Vec::new(),
            build_disabled_stage(AUTHOR_SOCIALGRAPH_FILTER, input_count),
            false,
        );
    }

    let mut bidirectional_block_count = 0_u64;
    let mut original_author_drop_count = 0_u64;
    let mut muted_author_drop_count = 0_u64;

    let mut kept = Vec::with_capacity(input_count);
    let mut removed = Vec::new();
    let (all_kept, all_removed) = partition(candidates, |candidate| {
        evaluate_candidate_socialgraph(candidate, &blocked, &muted, &post_author_map).is_ok()
    });
    kept.extend(all_kept);
    for candidate in all_removed {
        if let Err(reason) =
            evaluate_candidate_socialgraph(&candidate, &blocked, &muted, &post_author_map)
        {
            match reason {
                SocialgraphDropKind::ViewerMutedAuthor => muted_author_drop_count += 1,
                SocialgraphDropKind::AuthorBlocksViewer => bidirectional_block_count += 1,
                SocialgraphDropKind::OriginalAuthorBlockedOrMuted => {
                    original_author_drop_count += 1;
                }
                SocialgraphDropKind::OriginalAuthorBlocksViewer => {
                    original_author_drop_count += 1;
                    bidirectional_block_count += 1;
                }
                SocialgraphDropKind::ViewerBlockedAuthor => {}
            }
        }
        removed.push(candidate);
    }

    let removed_count = input_count.saturating_sub(kept.len());

    let mut detail = HashMap::new();
    detail.insert(
        "bidirectionalBlockCount".to_string(),
        Value::from(bidirectional_block_count),
    );
    detail.insert(
        "originalAuthorDropCount".to_string(),
        Value::from(original_author_drop_count),
    );
    detail.insert(
        "mutedAuthorDropCount".to_string(),
        Value::from(muted_author_drop_count),
    );

    (
        kept,
        removed,
        build_stage(
            AUTHOR_SOCIALGRAPH_FILTER,
            input_count,
            removed_count,
            Some(detail),
            Some(FILTER_DROP_REASON_BLOCKED_AUTHOR),
        ),
        true,
    )
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;
    use crate::contracts::{
        CachedPostEntryPayload, CandidateVisibilityPayload, ContentSafetyLabelsPayload,
    };
    use chrono::Utc;

    fn candidate(
        author_id: &str,
        author_blocks_viewer: Option<bool>,
    ) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: "post-1".to_string(),
            model_post_id: None,
            author_id: author_id.to_string(),
            content: "test content".to_string(),
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
            topic_ids: Vec::new(),
            secondary_recall_sources: None,
            has_video: None,
            has_image: None,
            video_duration_sec: None,
            has_media: false,
            media_type: crate::contracts::MediaType::None,
            video_duration_ms: None,
            media: None,
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
            score_breakdown: None,
            pipeline_score: None,
            graph_score: None,
            graph_path: None,
            graph_recall_type: None,
            post_type: None,
            mutual_follow_jaccard: None,
            following_replied: None,
            ..Default::default()
        }
    }

    fn query(
        blocked_user_ids: Vec<String>,
        muted_user_ids: Vec<String>,
    ) -> RecommendationQueryPayload {
        RecommendationQueryPayload {
            request_id: "req-socialgraph-filter".to_string(),
            decision_id: "00000000-0000-4000-8000-0000000000ff".to_string(),
            user_id: "viewer-1".to_string(),
            limit: 20,
            cursor: None,
            in_network_only: false,
            seen_ids: Vec::new(),
            served_ids: Vec::new(),
            is_bottom_request: false,
            client_app_id: None,
            country_code: None,
            language_code: None,
            user_features: Some(crate::contracts::UserFeaturesPayload {
                blocked_user_ids,
                muted_user_ids,
                ..Default::default()
            }),
            embedding_context: None,
            user_state_context: None,
            user_action_sequence: None,
            news_history_external_ids: None,
            model_user_action_sequence: None,
            experiment_context: None,
            ranking_policy: None,
            user_signal_features: None,
            interested_topics: None,
            mutual_follow_ids: None,
            demographics: None,
            feature_switches: HashMap::new(),
            past_request_timestamps: Vec::new(),
            impressed_post_ids: Vec::new(),
            subscribed_user_ids: Vec::new(),
            ..Default::default()
        }
    }

    #[test]
    fn socialgraph_filter_disables_when_no_blocked_or_muted() {
        let query = query(Vec::new(), Vec::new());
        let candidates = vec![candidate("author-1", None)];
        let (kept, _removed, _stage, enabled) = author_socialgraph_filter(&query, candidates);
        assert!(!enabled);
        assert_eq!(kept.len(), 1);
    }

    #[test]
    fn socialgraph_filter_drops_blocked_authors() {
        let query = query(vec!["blocked-author".to_string()], Vec::new());
        let candidates = vec![
            candidate("blocked-author", None),
            candidate("safe-author", None),
        ];
        let (kept, removed, _stage, enabled) = author_socialgraph_filter(&query, candidates);
        assert!(enabled);
        assert_eq!(kept.len(), 1);
        assert_eq!(removed.len(), 1);
        assert_eq!(removed[0].author_id, "blocked-author");
    }

    #[test]
    fn socialgraph_filter_drops_muted_authors() {
        let query = query(Vec::new(), vec!["muted-author".to_string()]);
        let candidates = vec![
            candidate("muted-author", None),
            candidate("safe-author", None),
        ];
        let (kept, removed, _stage, enabled) = author_socialgraph_filter(&query, candidates);
        assert!(enabled);
        assert_eq!(kept.len(), 1);
        assert_eq!(removed.len(), 1);
        assert_eq!(removed[0].author_id, "muted-author");
    }

    #[test]
    fn socialgraph_filter_drops_when_author_blocks_viewer() {
        let query = query(Vec::new(), Vec::new());
        let candidates = vec![
            candidate("blocking-author", Some(true)),
            candidate("safe-author", None),
        ];
        let (kept, removed, _stage, enabled) = author_socialgraph_filter(&query, candidates);
        assert!(enabled);
        assert_eq!(kept.len(), 1);
        assert_eq!(removed.len(), 1);
        assert_eq!(removed[0].author_id, "blocking-author");
    }

    #[test]
    fn socialgraph_filter_bidirectional_block() {
        let query = query(vec!["mutual-block".to_string()], Vec::new());
        let candidates = vec![candidate("mutual-block", Some(true))];
        let (kept, removed, _stage, enabled) = author_socialgraph_filter(&query, candidates);
        assert!(enabled);
        assert_eq!(kept.len(), 0);
        assert_eq!(removed.len(), 1);
    }

    #[test]
    fn socialgraph_filter_drops_repost_and_quote_when_original_author_blocked_or_muted() {
        let mut q = query(
            vec!["blocked-orig".to_string()],
            vec!["muted-quoted".to_string()],
        );
        // 通过 cached_posts 映射提供被转发/引用原帖的作者关系
        q.cached_posts.push(CachedPostEntryPayload {
            post_id: "orig-cached-1".to_string(),
            author_id: "blocked-orig".to_string(),
            created_at_ms: 1_700_000_000_000,
            semantic_ids: None,
            recall_source: None,
        });

        // 1. 转发帖本身作者正常，但转发的 cached 原帖作者被拉黑
        let mut repost_cached = candidate("safe-retweeter", None);
        repost_cached.post_id = "repost-1".to_string();
        repost_cached.is_repost = true;
        repost_cached.original_post_id = Some("orig-cached-1".to_string());

        // 2. 批次内原帖作者双向拉黑了当前用户，同时有人转发它
        let mut orig_blocking = candidate("orig-blocking-author", Some(true));
        orig_blocking.post_id = "orig-batch-2".to_string();
        let mut quote_batch = candidate("safe-quoter", None);
        quote_batch.post_id = "quote-2".to_string();
        quote_batch.is_repost = true;
        quote_batch.original_post_id = Some("orig-batch-2".to_string());

        // 3. 通过 graph_path 携带被静音的引用原作者
        let mut quote_via_path = candidate("safe-quoter-3", None);
        quote_via_path.post_id = "quote-3".to_string();
        quote_via_path.is_repost = true;
        quote_via_path.graph_path = Some("quoted_author:muted-quoted".to_string());

        // 4. 通过安全标签携带引用原作者反向拉黑标记
        let mut quote_label_block = candidate("safe-quoter-4", None);
        quote_label_block.post_id = "quote-4".to_string();
        quote_label_block.vf_result = Some(CandidateVisibilityPayload {
            safe: true,
            violations: Some(vec!["quoted_author_blocks_viewer".to_string()]),
            ..Default::default()
        });
        quote_label_block.content_safety_labels = Some(ContentSafetyLabelsPayload {
            safe: true,
            ..Default::default()
        });

        // 5. 正常候选应保留
        let mut clean = candidate("safe-author", None);
        clean.post_id = "clean-5".to_string();

        let (kept, removed, stage, enabled) = author_socialgraph_filter(
            &q,
            vec![
                repost_cached,
                orig_blocking,
                quote_batch,
                quote_via_path,
                quote_label_block,
                clean,
            ],
        );
        assert!(enabled);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].post_id, "clean-5");
        assert_eq!(removed.len(), 5);
        let detail = stage.detail.expect("stage detail");
        assert!(
            detail
                .get("originalAuthorDropCount")
                .and_then(Value::as_u64)
                .unwrap_or_default()
                >= 2
        );
    }
}
