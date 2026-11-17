use std::sync::Arc;

use tokio::sync::Mutex;

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationResultPayload,
};
use crate::metrics::RecommendationMetrics;
use crate::pipeline::local::side_effects::diversity_stats::DiversityStatsSideEffect;
use crate::pipeline::local::side_effects::{SideEffect, SideEffectContext};
use crate::serving::cache::ServeCache;
use crate::state::recent_store::RecentHotStore;

#[allow(unused_imports)]
pub use telegram_component_primitives::side_effects::{
    DIVERSITY_STATS_SIDE_EFFECT, FEATURE_CACHING_SIDE_EFFECT, RECENT_STORE_SIDE_EFFECT,
    REQUEST_CACHING_SIDE_EFFECT, SERVE_CACHE_WRITE_SIDE_EFFECT,
};
pub use telegram_serving_primitives::ASYNC_SIDE_EFFECT_MODE;

/// 后置异步副作用所需的请求身份与完整上下文载荷。
#[derive(Debug, Clone, Default)]
pub struct PostResponseQueryIdentity {
    pub user_id: String,
    pub decision_id: String,
    pub query_fingerprint: String,
    /// 可选的完整水合后请求上下文，使多样性统计与缓存副作用获取真实请求信息。
    pub query: Option<RecommendationQueryPayload>,
}

impl PostResponseQueryIdentity {
    /// 基于完整请求载荷与请求指纹构建后置响应身份对象。
    pub fn from_query(query: &RecommendationQueryPayload, query_fingerprint: String) -> Self {
        Self {
            user_id: query.user_id.clone(),
            decision_id: query.decision_id.clone(),
            query_fingerprint,
            query: Some(query.clone()),
        }
    }

    /// 以链式方式补充完整请求载荷（向后兼容旧的 3 字段构造代码）。
    pub fn with_query(mut self, query: RecommendationQueryPayload) -> Self {
        self.query = Some(query);
        self
    }
}

/// 根据后置身份载荷构建真实完整的 `SideEffectContext`。
///
/// 若 `query_identity.query` 为 `Some`，直接透传真实水合后的请求上下文；
/// 若为 `None`（兼容旧调用方），回退构造包含基础 `request_id`/`decision_id`/`user_id` 的最小上下文。
pub fn build_side_effect_context(
    query_identity: &PostResponseQueryIdentity,
    candidates: Vec<RecommendationCandidatePayload>,
) -> SideEffectContext {
    let query = query_identity
        .query
        .clone()
        .unwrap_or_else(|| RecommendationQueryPayload {
            request_id: query_identity.query_fingerprint.clone(),
            decision_id: query_identity.decision_id.clone(),
            user_id: query_identity.user_id.clone(),
            ..Default::default()
        });

    SideEffectContext {
        user_id: query_identity.user_id.clone(),
        candidates,
        query,
        request_hash: query_identity.query_fingerprint.clone(),
    }
}

/// 异步派发后置推荐副作用（RecentHotStore 写入、多样性统计、ServeCache 写入）。
pub fn dispatch_post_response_side_effects(
    metrics: Arc<Mutex<RecommendationMetrics>>,
    recent_store: Arc<RecentHotStore>,
    serve_cache: ServeCache,
    query_identity: PostResponseQueryIdentity,
    result: &RecommendationResultPayload,
    cacheable: bool,
) {
    let mut names = Vec::new();
    if !result.candidates.is_empty() {
        names.push(RECENT_STORE_SIDE_EFFECT.to_string());
        names.push(DIVERSITY_STATS_SIDE_EFFECT.to_string());
    }
    if cacheable {
        names.push(SERVE_CACHE_WRITE_SIDE_EFFECT.to_string());
    }
    if names.is_empty() {
        return;
    }
    let cache_result = cacheable.then(|| result.clone());
    let recent_candidates = if cache_result.is_none() && !result.candidates.is_empty() {
        Some(result.candidates.clone())
    } else {
        None
    };

    tokio::spawn(async move {
        {
            let mut metrics = metrics.lock().await;
            metrics.record_side_effect_dispatch(&names);
        }

        let mut errors = Vec::new();
        let mut cache_store_drifted = false;

        if cache_result
            .as_ref()
            .is_some_and(|result| !result.candidates.is_empty())
            || recent_candidates
                .as_ref()
                .is_some_and(|candidates| !candidates.is_empty())
        {
            if let Some(result) = cache_result.as_ref() {
                recent_store.record(&query_identity.user_id, &result.candidates);
            } else if let Some(candidates) = recent_candidates.as_ref() {
                recent_store.record(&query_identity.user_id, candidates);
            }
        }

        // 构建携带真实请求上下文的 SideEffectContext 并执行多样性统计副作用。
        let diversity_candidates = cache_result
            .as_ref()
            .map(|r| r.candidates.clone())
            .or(recent_candidates.clone())
            .unwrap_or_default();

        if !diversity_candidates.is_empty() {
            let diversity_side_effect = DiversityStatsSideEffect::default_config();
            let diversity_context =
                build_side_effect_context(&query_identity, diversity_candidates);
            if let Err(err) = diversity_side_effect.execute(&diversity_context).await {
                errors.push(format!("diversity_stats_failed:{err}"));
            }
        }

        if let Some(result) = cache_result.as_ref() {
            match serve_cache
                .store(&query_identity.query_fingerprint, result)
                .await
            {
                Ok(store_result) => {
                    cache_store_drifted = store_result.drifted;
                }
                Err(error) => {
                    errors.push(format!("serve_cache_store_failed:{error}"));
                }
            }
        }

        let mut metrics = metrics.lock().await;
        if errors.is_empty() {
            metrics.record_side_effect_completion(&names, cache_store_drifted);
        } else {
            metrics.record_side_effect_failure(&names, &errors.join("; "));
        }
    });
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use chrono::Utc;
    use tokio::sync::Mutex;

    use crate::contracts::{
        EmbeddingContextPayload, RecommendationCandidatePayload, RecommendationQueryPayload,
        UserFeaturesPayload,
    };
    use crate::metrics::RecommendationMetrics;
    use crate::serving::cache::ServeCache;
    use crate::serving::cache::tests::test_result;
    use crate::state::recent_store::RecentHotStore;

    use super::{
        PostResponseQueryIdentity, build_side_effect_context, dispatch_post_response_side_effects,
    };

    fn make_candidate(post_id: &str) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: post_id.to_string(),
            author_id: "author-1".to_string(),
            content: "side effect test".to_string(),
            created_at: Utc::now(),
            recall_source: Some("SidSource".to_string()),
            ..Default::default()
        }
    }

    #[test]
    fn side_effect_context_preserves_real_query_when_provided() {
        let real_query = RecommendationQueryPayload {
            request_id: "real-req-id-123".to_string(),
            decision_id: "00000000-0000-4000-8000-000000000099".to_string(),
            user_id: "viewer-42".to_string(),
            limit: 25,
            user_features: Some(UserFeaturesPayload {
                followed_user_ids: vec!["author-1".to_string()],
                ..Default::default()
            }),
            embedding_context: Some(EmbeddingContextPayload {
                usable: true,
                quality_score: Some(0.95),
                ..Default::default()
            }),
            feature_switches: HashMap::from([("enable_v3_dpp".to_string(), true)]),
            ..Default::default()
        };

        let identity =
            PostResponseQueryIdentity::from_query(&real_query, "fp-hash-abc".to_string());
        let ctx = build_side_effect_context(&identity, vec![make_candidate("p1")]);

        assert_eq!(ctx.user_id, "viewer-42");
        assert_eq!(ctx.request_hash, "fp-hash-abc");
        assert_eq!(ctx.query.request_id, "real-req-id-123");
        assert_eq!(ctx.query.limit, 25);
        assert!(ctx.query.user_features.is_some());
        assert!(
            ctx.query
                .embedding_context
                .as_ref()
                .is_some_and(|e| e.usable)
        );
        assert!(ctx.query.feature_switch("enable_v3_dpp", false));
    }

    #[test]
    fn side_effect_context_remains_backward_compatible_without_query() {
        let identity = PostResponseQueryIdentity {
            user_id: "viewer-legacy".to_string(),
            decision_id: "00000000-0000-4000-8000-000000000001".to_string(),
            query_fingerprint: "fp-legacy".to_string(),
            ..Default::default()
        };
        let ctx = build_side_effect_context(&identity, vec![make_candidate("p1")]);

        assert_eq!(ctx.user_id, "viewer-legacy");
        assert_eq!(ctx.query.user_id, "viewer-legacy");
        assert_eq!(ctx.query.request_id, "fp-legacy");
        assert_eq!(
            ctx.query.decision_id,
            "00000000-0000-4000-8000-000000000001"
        );
    }

    #[tokio::test]
    async fn dispatch_side_effects_records_recent_store_and_serve_cache() {
        let metrics = Arc::new(Mutex::new(RecommendationMetrics::default()));
        let recent_store = Arc::new(RecentHotStore::new_sharded(16, 64, 4));
        let serve_cache = ServeCache::new(
            true,
            60,
            "recommendation:serve:side_effect_test".to_string(),
            "redis://unused".to_string(),
            None,
            16,
        );
        let query = RecommendationQueryPayload {
            request_id: "req-se-async".to_string(),
            decision_id: "00000000-0000-4000-8000-000000000055".to_string(),
            user_id: "viewer-se".to_string(),
            limit: 10,
            ..Default::default()
        };
        let mut result = test_result("stable-se");
        result.candidates = vec![make_candidate("p-se-1")];
        let identity = PostResponseQueryIdentity::from_query(&query, "fp-se-1".to_string());

        dispatch_post_response_side_effects(
            Arc::clone(&metrics),
            Arc::clone(&recent_store),
            serve_cache.clone(),
            identity,
            &result,
            true,
        );

        // 等待异步任务完成缓存与指标落盘
        for _ in 0..20 {
            if serve_cache.get("fp-se-1").await.result.is_some() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        assert!(serve_cache.get("fp-se-1").await.result.is_some());
    }
}
