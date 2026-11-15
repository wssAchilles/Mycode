//! 推荐核心请求载荷 `RecommendationQueryPayload` 与增量水合补丁 `RecommendationQueryPatchPayload`。

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::features::{
    Demographics, EmbeddingContextPayload, UserFeaturesPayload, UserSignalFeaturesPayload,
    UserStateContextPayload,
};
use super::policy::{ExperimentContextPayload, RankingPolicyPayload};
use super::sequences::{
    CachedPostEntryPayload, ColumnarActionStepPayload, ServedHistoryEntryPayload,
};

/// 跨推荐管线各 Stage 共享的主查询上下文结构（含 V3 列式动作序列与布隆已读指纹）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationQueryPayload {
    pub request_id: String,
    pub decision_id: String,
    pub user_id: String,
    pub limit: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<DateTime<Utc>>,
    pub in_network_only: bool,
    pub seen_ids: Vec<String>,
    pub served_ids: Vec<String>,
    pub is_bottom_request: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_app_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_features: Option<UserFeaturesPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding_context: Option<EmbeddingContextPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_state_context: Option<UserStateContextPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_action_sequence: Option<Vec<HashMap<String, Value>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub news_history_external_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_user_action_sequence: Option<Vec<HashMap<String, Value>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub experiment_context: Option<ExperimentContextPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ranking_policy: Option<RankingPolicyPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_signal_features: Option<UserSignalFeaturesPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interested_topics: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mutual_follow_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub demographics: Option<Demographics>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub past_request_timestamps: Vec<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub impressed_post_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub subscribed_user_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub feature_switches: HashMap<String, bool>,
    /// V3 召回塔专用紧凑列式历史动作序列。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub columnar_retrieval_sequence: Vec<ColumnarActionStepPayload>,
    /// V3 Heavy Ranker / ValueModel 专用高密度动作序列（最多 128 步）。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub columnar_scoring_sequence: Vec<ColumnarActionStepPayload>,
    /// V3 客户端/服务端布隆过滤器 64-bit 槽位数组，支撑零分配高速曝光去重。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bloom_filter_entries: Vec<u64>,
    /// V3 近期已下发历史明细（支撑会话疲劳惩罚与 DPP served-context 校验）。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub served_history: Vec<ServedHistoryEntryPayload>,
    /// V3 查询期预缓存的关注/热点候选切片。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cached_posts: Vec<CachedPostEntryPayload>,
    /// V3 显式标记查询是否已命中缓存帖子池（Avoid empty-vec ambiguity）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_cached_posts: Option<bool>,
    /// V3 上文种子帖子 ID 列表（支撑相关性扩展或类似帖探测）。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub seed_candidate_post_ids: Vec<String>,
    /// V3 请求全链路唯一预测追踪 ID（关联离线归因与 OPE）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prediction_id: Option<String>,
}

impl RecommendationQueryPayload {
    pub fn effective_seen_ids(&self) -> Vec<String> {
        if !self.seen_ids.is_empty() {
            return self.seen_ids.clone();
        }
        self.user_features
            .as_ref()
            .map(|features| features.seen_post_ids.clone())
            .unwrap_or_default()
    }

    /// 获取指定特性开关值；未配置时返回传入的默认值。
    pub fn feature_switch(&self, key: &str, default: bool) -> bool {
        self.feature_switches.get(key).copied().unwrap_or(default)
    }
}

/// 各个 QueryHydrator 并行产出的局部查询字段补丁，由编排层无锁合并。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationQueryPatchPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_features: Option<UserFeaturesPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding_context: Option<EmbeddingContextPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_state_context: Option<UserStateContextPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_action_sequence: Option<Vec<HashMap<String, Value>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub news_history_external_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_user_action_sequence: Option<Vec<HashMap<String, Value>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub experiment_context: Option<ExperimentContextPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ranking_policy: Option<RankingPolicyPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_signal_features: Option<UserSignalFeaturesPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interested_topics: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mutual_follow_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub demographics: Option<Demographics>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub past_request_timestamps: Option<Vec<DateTime<Utc>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub impressed_post_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscribed_user_ids: Option<Vec<String>>,
}

#[cfg(test)]
mod tests {
    use super::{
        ColumnarActionStepPayload, RecommendationQueryPayload, UserFeaturesPayload,
    };

    fn query(seen_ids: Vec<String>, feature_seen_ids: Vec<String>) -> RecommendationQueryPayload {
        RecommendationQueryPayload {
            request_id: "req-query-contract".to_string(),
            decision_id: "d7778f92-ab47-47f5-a262-f470c3a98156".to_string(),
            user_id: "viewer-1".to_string(),
            limit: 20,
            seen_ids,
            user_features: Some(UserFeaturesPayload {
                seen_post_ids: feature_seen_ids,
                ..UserFeaturesPayload::default()
            }),
            ..Default::default()
        }
    }

    #[test]
    fn effective_seen_ids_prefers_request_ids_before_feature_snapshot() {
        assert_eq!(
            query(
                vec!["request-seen".to_string()],
                vec!["feature-seen".to_string()]
            )
            .effective_seen_ids(),
            vec!["request-seen".to_string()]
        );
        assert_eq!(
            query(Vec::new(), vec!["feature-seen".to_string()]).effective_seen_ids(),
            vec!["feature-seen".to_string()]
        );
    }

    #[test]
    fn serde_requires_and_preserves_decision_id() {
        let value = serde_json::to_value(query(Vec::new(), Vec::new())).expect("serialize query");
        assert_eq!(
            value.get("decisionId").and_then(serde_json::Value::as_str),
            Some("d7778f92-ab47-47f5-a262-f470c3a98156")
        );

        let mut missing = value;
        missing.as_object_mut().unwrap().remove("decisionId");
        assert!(serde_json::from_value::<RecommendationQueryPayload>(missing).is_err());
    }

    #[test]
    fn query_payload_v3_sequences_and_bloom_roundtrip() {
        let mut q = query(Vec::new(), Vec::new());
        q.columnar_retrieval_sequence = vec![ColumnarActionStepPayload {
            post_id_hash: 123456789,
            semantic_ids: Some([1, 2, 3, 4, 5, 6]),
            author_hash: 9876,
            action_type: 1,
            action_mask: vec![1, 1, 0, 0],
            time_delta_sec: 12.5,
        }];
        q.bloom_filter_entries = vec![0xdeadbeef_u64];
        q.has_cached_posts = Some(false);
        q.prediction_id = Some("pred-v3-001".to_string());

        let json = serde_json::to_value(&q).expect("serialize v3 query");
        assert!(json.get("columnarRetrievalSequence").is_some());
        assert!(json.get("bloomFilterEntries").is_some());
        assert_eq!(
            json.get("predictionId").and_then(serde_json::Value::as_str),
            Some("pred-v3-001")
        );

        let decoded: RecommendationQueryPayload =
            serde_json::from_value(json).expect("deserialize v3 query");
        assert_eq!(decoded.columnar_retrieval_sequence.len(), 1);
        assert_eq!(decoded.bloom_filter_entries, vec![0xdeadbeef_u64]);
        assert_eq!(decoded.has_cached_posts, Some(false));
    }

    #[test]
    fn feature_switch_returns_default_when_not_set() {
        let q = query(Vec::new(), Vec::new());
        assert!(!q.feature_switch("unknown_switch", false));
        assert!(q.feature_switch("unknown_switch", true));
    }

    #[test]
    fn feature_switch_returns_configured_value() {
        let mut q = query(Vec::new(), Vec::new());
        q.feature_switches
            .insert("enable_new_scorer".to_string(), true);
        q.feature_switches
            .insert("disable_trends".to_string(), false);

        assert!(q.feature_switch("enable_new_scorer", false));
        assert!(!q.feature_switch("disable_trends", true));
        assert!(q.feature_switch("unrelated_switch", true));
    }

    #[test]
    fn feature_switch_supports_experiment_group_keys() {
        let mut q = query(Vec::new(), Vec::new());
        q.feature_switches
            .insert("experiment:treatment_a:enable_diversity".to_string(), true);
        q.feature_switches
            .insert("experiment:control:enable_diversity".to_string(), false);

        assert!(q.feature_switch("experiment:treatment_a:enable_diversity", false));
        assert!(!q.feature_switch("experiment:control:enable_diversity", true));
    }
}
