mod experiment;
mod identifiers;
mod ranking_policy;
mod retrieval;
mod signals;
mod sources;

#[allow(unused_imports)]
pub use experiment::space_feed_experiment_number;
pub use experiment::{env_bool, space_feed_experiment_flag};
pub use identifiers::related_post_ids;
#[allow(unused_imports)]
pub use ranking_policy::{SCORE_BREAKDOWN_VERSION, SCORE_CONTRACT_VERSION};
pub use ranking_policy::{
    ranking_policy_contract_version, ranking_policy_keywords, ranking_policy_number,
    ranking_policy_score_breakdown_version, ranking_policy_strategy_version, ranking_policy_usize,
};
pub use retrieval::{
    FALLBACK_LANE, IN_NETWORK_LANE, INTEREST_LANE, SOCIAL_EXPANSION_LANE, source_retrieval_lane,
};
pub use sources::{source_candidate_budget, source_enabled_for_query, source_mixing_multiplier};

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use serde_json::Value;

    use crate::contracts::query::RankingPolicyPayload;
    use crate::contracts::{
        EmbeddingContextPayload, ExperimentAssignmentPayload, ExperimentContextPayload,
        RecommendationQueryPayload, SparseEmbeddingEntryPayload, UserStateContextPayload,
    };

    use super::{
        FALLBACK_LANE, IN_NETWORK_LANE, INTEREST_LANE, SOCIAL_EXPANSION_LANE,
        source_candidate_budget, source_enabled_for_query, source_retrieval_lane,
    };

    fn query(state: &str) -> RecommendationQueryPayload {
        RecommendationQueryPayload {
            request_id: "req-source-policy".to_string(),
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
            user_features: None,
            embedding_context: None,
            user_state_context: Some(UserStateContextPayload {
                state: state.to_string(),
                reason: "test".to_string(),
                followed_count: 0,
                recent_action_count: 0,
                recent_positive_action_count: 0,
                usable_embedding: state != "cold_start",
                account_age_days: Some(1),
            }),
            user_action_sequence: None,
            news_history_external_ids: None,
            model_user_action_sequence: None,
            experiment_context: None,
            ranking_policy: None,
        }
    }

    #[test]
    fn source_policy_restricts_cold_start_to_bootstrap_lanes() {
        let query = query("cold_start");
        assert!(source_enabled_for_query(&query, "ColdStartSource"));
        assert!(!source_enabled_for_query(&query, "GraphSource"));
        assert!(!source_enabled_for_query(&query, "EmbeddingAuthorSource"));
        assert_eq!(source_candidate_budget(&query, "ColdStartSource", 100), 100);
    }

    #[test]
    fn source_policy_disables_popular_before_user_state_is_known() {
        let mut query = query("warm");
        query.user_state_context = None;

        assert!(!source_enabled_for_query(&query, "PopularSource"));
        assert_eq!(source_candidate_budget(&query, "PopularSource", 100), 0);
    }

    #[test]
    fn source_policy_skips_popular_for_dense_heavy_users() {
        let mut query = query("heavy");
        query.user_state_context = Some(UserStateContextPayload {
            state: "heavy".to_string(),
            reason: "dense_recent_activity".to_string(),
            followed_count: 24,
            recent_action_count: 100,
            recent_positive_action_count: 30,
            usable_embedding: true,
            account_age_days: Some(16),
        });

        assert!(!source_enabled_for_query(&query, "PopularSource"));
        assert_eq!(source_candidate_budget(&query, "PopularSource", 100), 0);
        assert!(source_enabled_for_query(&query, "GraphSource"));
    }

    #[test]
    fn source_policy_skips_popular_for_warm_users_with_social_evidence() {
        let mut query = query("warm");
        query.user_state_context = Some(UserStateContextPayload {
            state: "warm".to_string(),
            reason: "stable_but_not_dense".to_string(),
            followed_count: 24,
            recent_action_count: 50,
            recent_positive_action_count: 29,
            usable_embedding: true,
            account_age_days: Some(17),
        });

        assert!(!source_enabled_for_query(&query, "PopularSource"));
        assert_eq!(source_candidate_budget(&query, "PopularSource", 100), 0);
        assert!(source_enabled_for_query(&query, "GraphSource"));
    }

    #[test]
    fn maps_sources_into_stable_retrieval_lanes() {
        assert_eq!(source_retrieval_lane("FollowingSource"), IN_NETWORK_LANE);
        assert_eq!(source_retrieval_lane("GraphSource"), SOCIAL_EXPANSION_LANE);
        assert_eq!(
            source_retrieval_lane("GraphKernelSource"),
            SOCIAL_EXPANSION_LANE
        );
        assert_eq!(source_retrieval_lane("TwoTowerSource"), INTEREST_LANE);
        assert_eq!(
            source_retrieval_lane("EmbeddingAuthorSource"),
            INTEREST_LANE
        );
        assert_eq!(source_retrieval_lane("NewsAnnSource"), INTEREST_LANE);
        assert_eq!(source_retrieval_lane("PopularSource"), FALLBACK_LANE);
    }

    #[test]
    fn source_budget_honors_experiment_override() {
        let mut query = query("heavy");
        query.embedding_context = Some(EmbeddingContextPayload {
            interested_in_clusters: vec![SparseEmbeddingEntryPayload {
                cluster_id: 7,
                score: 0.9,
            }],
            producer_embedding: vec![],
            known_for_cluster: None,
            known_for_score: None,
            quality_score: Some(0.8),
            computed_at: None,
            version: None,
            usable: true,
            stale: Some(false),
        });
        query.experiment_context = Some(ExperimentContextPayload {
            user_id: "viewer-1".to_string(),
            assignments: vec![ExperimentAssignmentPayload {
                experiment_id: "space_feed_recsys".to_string(),
                experiment_name: "space feed".to_string(),
                bucket: "treatment".to_string(),
                config: HashMap::from([("source_budget_graphsource".to_string(), Value::from(12))]),
                in_experiment: true,
            }],
        });

        assert!(source_enabled_for_query(&query, "GraphSource"));
        assert_eq!(source_candidate_budget(&query, "GraphSource", 50), 12);
    }

    #[test]
    fn sparse_users_with_positive_actions_unlock_graph_expansion_lane() {
        let mut query = query("sparse");
        query.user_state_context = Some(UserStateContextPayload {
            state: "sparse".to_string(),
            reason: "light_positive_activity".to_string(),
            followed_count: 3,
            recent_action_count: 9,
            recent_positive_action_count: 5,
            usable_embedding: true,
            account_age_days: Some(6),
        });
        query.embedding_context = Some(EmbeddingContextPayload {
            interested_in_clusters: vec![SparseEmbeddingEntryPayload {
                cluster_id: 11,
                score: 0.72,
            }],
            producer_embedding: vec![],
            known_for_cluster: None,
            known_for_score: None,
            quality_score: Some(0.74),
            computed_at: None,
            version: None,
            usable: true,
            stale: Some(false),
        });

        assert!(source_enabled_for_query(&query, "GraphSource"));
        assert!(source_candidate_budget(&query, "GraphSource", 100) >= 40);
    }

    #[test]
    fn sparse_users_with_sequence_actions_unlock_graph_even_if_summary_is_sparse() {
        let mut query = query("sparse");
        query.user_state_context = Some(UserStateContextPayload {
            state: "sparse".to_string(),
            reason: "summary_lagging_actions".to_string(),
            followed_count: 0,
            recent_action_count: 1,
            recent_positive_action_count: 0,
            usable_embedding: false,
            account_age_days: Some(4),
        });
        query.user_action_sequence = Some(vec![
            HashMap::from([("action".to_string(), Value::String("click".to_string()))]),
            HashMap::from([("action".to_string(), Value::String("reply".to_string()))]),
        ]);

        assert!(source_enabled_for_query(&query, "GraphSource"));
        assert!(source_candidate_budget(&query, "GraphSource", 100) >= 40);
    }

    #[test]
    fn warm_users_with_dense_embedding_and_actions_do_not_need_popular_fallback() {
        let mut query = query("warm");
        query.user_state_context = Some(UserStateContextPayload {
            state: "warm".to_string(),
            reason: "feature_summary_lagging".to_string(),
            followed_count: 8,
            recent_action_count: 10,
            recent_positive_action_count: 1,
            usable_embedding: true,
            account_age_days: Some(9),
        });
        query.embedding_context = Some(EmbeddingContextPayload {
            interested_in_clusters: vec![SparseEmbeddingEntryPayload {
                cluster_id: 42,
                score: 0.91,
            }],
            quality_score: Some(0.86),
            usable: true,
            ..EmbeddingContextPayload::default()
        });
        query.user_action_sequence = Some(
            ["click", "like", "reply", "repost", "share", "dwell"]
                .into_iter()
                .map(|action| {
                    HashMap::from([("action".to_string(), Value::String(action.to_string()))])
                })
                .collect(),
        );

        assert!(!source_enabled_for_query(&query, "PopularSource"));
        assert_eq!(source_candidate_budget(&query, "PopularSource", 100), 0);
        assert!(source_enabled_for_query(&query, "TwoTowerSource"));
    }

    #[test]
    fn weak_embedding_disables_embedding_author_and_expands_fallback_budget() {
        let mut query = query("warm");
        query.embedding_context = Some(EmbeddingContextPayload {
            interested_in_clusters: vec![SparseEmbeddingEntryPayload {
                cluster_id: 11,
                score: 0.7,
            }],
            producer_embedding: vec![],
            known_for_cluster: None,
            known_for_score: None,
            quality_score: Some(0.2),
            computed_at: None,
            version: None,
            usable: true,
            stale: Some(true),
        });

        assert!(!source_enabled_for_query(&query, "EmbeddingAuthorSource"));
        assert!(source_candidate_budget(&query, "PopularSource", 100) >= 48);
        assert!(source_candidate_budget(&query, "TwoTowerSource", 100) >= 36);
    }

    #[test]
    fn sparse_missing_embedding_expands_popular_topup_budget() {
        let mut query = query("sparse");
        query.user_state_context = Some(UserStateContextPayload {
            state: "sparse".to_string(),
            reason: "embedding_unusable".to_string(),
            followed_count: 2,
            recent_action_count: 10,
            recent_positive_action_count: 4,
            usable_embedding: false,
            account_age_days: Some(3),
        });

        assert_eq!(source_candidate_budget(&query, "PopularSource", 200), 80);
        assert_eq!(source_candidate_budget(&query, "PopularSource", 20), 20);
    }

    #[test]
    fn trend_keywords_expand_interest_source_budget() {
        let mut base_query = query("warm");
        base_query.embedding_context = Some(EmbeddingContextPayload {
            interested_in_clusters: vec![SparseEmbeddingEntryPayload {
                cluster_id: 11,
                score: 0.7,
            }],
            producer_embedding: vec![],
            known_for_cluster: None,
            known_for_score: None,
            quality_score: Some(0.8),
            computed_at: None,
            version: None,
            usable: true,
            stale: Some(false),
        });

        let base_budget = source_candidate_budget(&base_query, "NewsAnnSource", 200);
        let mut trend_query = base_query.clone();
        trend_query.ranking_policy = Some(RankingPolicyPayload {
            trend_keywords: Some(vec!["rust".to_string(), "recsys".to_string()]),
            trend_source_boost: Some(0.25),
            ..RankingPolicyPayload::default()
        });

        assert!(source_candidate_budget(&trend_query, "NewsAnnSource", 200) > base_budget);
    }
}
