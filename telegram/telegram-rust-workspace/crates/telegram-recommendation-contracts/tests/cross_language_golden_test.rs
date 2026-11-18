use std::fs;
use std::path::PathBuf;

use telegram_recommendation_contracts::contracts::candidate::{
    MediaType, RecommendationCandidatePayload,
};
use telegram_recommendation_contracts::contracts::canonical::candidate_pool_sha256;
use telegram_recommendation_contracts::contracts::query::RecommendationQueryPayload;

fn get_fixtures_dir() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .join("../../../fixtures/contracts")
        .canonicalize()
        .expect("canonicalize fixtures path")
}

#[test]
fn test_golden_candidate_roundtrip_and_fingerprint() {
    let fixtures_dir = get_fixtures_dir();
    let candidate_path = fixtures_dir.join("golden_candidate_v1.json");
    let content = fs::read_to_string(&candidate_path).expect("read golden_candidate_v1.json");

    let candidate: RecommendationCandidatePayload =
        serde_json::from_str(&content).expect("deserialize golden candidate in Rust");

    // 验证核心扩展字段在 Rust 侧被正确解析
    assert_eq!(candidate.post_id, "post_golden_1001");
    assert_eq!(candidate.author_id, "user_author_42");
    assert_eq!(candidate.topic_ids, vec!["tech", "ai", "systems"]);
    assert!(candidate.has_media);
    assert_eq!(candidate.media_type, MediaType::Video);
    assert_eq!(candidate.video_duration_ms, Some(42500));
    assert_eq!(candidate.author_blocks_viewer, Some(false));
    assert_eq!(candidate.language_code, Some("zh-CN".to_string()));
    assert_eq!(candidate.post_type, Some("article".to_string()));
    assert_eq!(candidate.mutual_follow_jaccard, Some(0.625));
    assert_eq!(candidate.following_replied, Some(true));
    assert_eq!(candidate.is_subscription_only, Some(false));

    // 验证排名信号
    let signals = candidate.ranking_signals.expect("ranking_signals present");
    assert!((signals.content_kind - 0.65).abs() < 1e-6);
    assert!((signals.trend - 0.89).abs() < 1e-6);
    assert!((signals.source_quality - 0.94).abs() < 1e-6);

    // 验证指纹计算能够确定性完成
    let pool_hash = candidate_pool_sha256(&[candidate]).expect("compute candidate pool hash");
    assert!(!pool_hash.is_empty());
}

#[test]
fn test_golden_query_flexible_age_range_deserialization() {
    let fixtures_dir = get_fixtures_dir();
    let query_path = fixtures_dir.join("golden_query_v1.json");
    let content = fs::read_to_string(&query_path).expect("read golden_query_v1.json");

    // 在修复前，因为 golden_query_v1.json 包含 "ageRange": "18-24" 字符串，
    // 而当前 Rust 定义的是 Option<(u32, u32)>，此处将直接反序列化报错（红灯）！
    let query: RecommendationQueryPayload =
        serde_json::from_str(&content).expect("deserialize golden query with string ageRange");

    let demographics = query.demographics.expect("demographics present");
    assert_eq!(demographics.age_range, Some((18, 24)));
}

#[test]
fn test_golden_v3_candidate_and_query_roundtrip() {
    let fixtures_dir = get_fixtures_dir();
    let candidate_json = fs::read_to_string(fixtures_dir.join("golden_candidate_v3.json"))
        .expect("read golden_candidate_v3.json");
    let query_json = fs::read_to_string(fixtures_dir.join("golden_query_v3.json"))
        .expect("read golden_query_v3.json");

    let candidate: RecommendationCandidatePayload =
        serde_json::from_str(&candidate_json).expect("deserialize golden v3 candidate");
    assert_eq!(candidate.semantic_ids, Some([12, 87, 203, 5, 199, 64]));
    assert_eq!(
        candidate.semantic_embedding_256d.as_deref(),
        Some([0.125_f32, -0.25, 0.5, -0.125].as_slice())
    );
    assert_eq!(candidate.retrieval_sources.len(), 1);
    assert_eq!(candidate.retrieval_sources[0].cluster, Some(42));
    assert_eq!(candidate.page_decode_slot, Some(2));
    let scores = candidate
        .phoenix_scores
        .as_ref()
        .expect("phoenix_scores present");
    assert_eq!(scores.expected_dwell_sec, Some(27.5));
    assert_eq!(scores.dwell_probs.as_ref().map(Vec::len), Some(5));
    let safety = candidate
        .content_safety_labels
        .as_ref()
        .expect("content_safety_labels present");
    assert!(safety.safe);
    assert_eq!(safety.labels, vec!["verified_source".to_string()]);
    let slate = candidate
        .slate_context
        .as_ref()
        .expect("slate_context present");
    assert_eq!(slate.sid_k_l1, Some(12));
    assert_eq!(slate.recon_cos_milli, Some(945));

    let pool_hash = candidate_pool_sha256(&[candidate]).expect("compute v3 candidate pool hash");
    assert!(!pool_hash.is_empty());

    let query: RecommendationQueryPayload =
        serde_json::from_str(&query_json).expect("deserialize golden v3 query");
    assert_eq!(query.columnar_retrieval_sequence.len(), 1);
    assert_eq!(query.columnar_scoring_sequence.len(), 1);
    assert_eq!(query.columnar_retrieval_sequence[0].action_mask.len(), 13);
    assert_eq!(query.bloom_filter_entries, vec![123456789, 987654321]);
    assert_eq!(query.has_cached_posts, Some(true));
    assert_eq!(query.prediction_id.as_deref(), Some("pred_v3_0001"));
    assert!(query.feature_switch("enable_v3_dpp", false));
}

#[test]
fn test_node_partial_user_features_64bit_overflow_media_alias_and_nan_sanitization() {
    use serde_json::json;
    use telegram_recommendation_contracts::contracts::candidate::PhoenixScoresPayload;
    use telegram_recommendation_contracts::contracts::pipeline::{
        RecommendationOnlineEvaluationPayload, RecommendationRankingSummaryPayload,
        RecommendationResultPayload, RecommendationRetrievalSummaryPayload,
        RecommendationSelectorPayload, RecommendationServingSummaryPayload,
        RecommendationSummaryPayload,
    };

    // 1. 验证 Node createFeedQuery 发送缺失 videoPreference / isSubscriber 的 userFeatures
    //    以及 JS Number 64-bit 浮点进位溢出值与字符串槽位不会触发 422
    let raw_query = json!({
        "requestId": "req-node-compat-01",
        "decisionId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
        "userId": "viewer-node-1",
        "limit": 10,
        "inNetworkOnly": false,
        "seenIds": [],
        "servedIds": [],
        "isBottomRequest": false,
        "userFeatures": {
            "followedUserIds": ["author-1", "author-2"],
            "blockedUserIds": [],
            "mutedUserIds": []
        },
        "bloomFilterEntries": [
            18446744073709552000.0_f64,
            "18446744073709551615",
            "0x10"
        ],
        "columnarRetrievalSequence": [
            {
                "postIdHash": "9223372036854775807",
                "authorHash": "-42"
            }
        ]
    });

    let parsed_query: RecommendationQueryPayload =
        serde_json::from_value(raw_query).expect("Node 缺省 userFeatures 与 64-bit 边界应平滑解析");
    let features = parsed_query.user_features.expect("user_features 存在");
    assert_eq!(features.followed_user_ids, vec!["author-1", "author-2"]);
    assert!(!features.is_subscriber);
    assert_eq!(
        parsed_query.bloom_filter_entries,
        vec![u64::MAX, u64::MAX, 16]
    );
    assert_eq!(
        parsed_query.columnar_retrieval_sequence[0].post_id_hash,
        i64::MAX
    );
    assert_eq!(parsed_query.columnar_retrieval_sequence[0].author_hash, -42);

    // 2. 验证 MediaType 兼容 "image" -> Photo 且未知值 "audio" 安全兜底为 None
    let image_media: MediaType = serde_json::from_value(json!("image")).expect("image 别名");
    assert_eq!(image_media, MediaType::Photo);
    let audio_media: MediaType = serde_json::from_value(json!("audio")).expect("audio 未知兜底");
    assert_eq!(audio_media, MediaType::None);
    assert_eq!(
        serde_json::to_value(MediaType::None).unwrap(),
        json!("none")
    );

    // 3. 验证 NaN / Infinity 在序列化前被清洗为有限值 0.0，杜绝输出 null
    let mut candidate = RecommendationCandidatePayload {
        post_id: "post-nan-1".to_string(),
        author_id: "author-1".to_string(),
        content: "nan check".to_string(),
        score: Some(f64::NAN),
        weighted_score: Some(f64::INFINITY),
        phoenix_scores: Some(PhoenixScoresPayload {
            like_score: Some(f64::NEG_INFINITY),
            dwell_probs: Some(vec![0.2, f64::NAN, f64::INFINITY]),
            ..Default::default()
        }),
        ..Default::default()
    };
    candidate.sanitize_non_finite_floats();

    let mut result = RecommendationResultPayload {
        request_id: "req-nan".to_string(),
        serving_version: "v1".to_string(),
        cursor: None,
        next_cursor: None,
        has_more: false,
        served_state_version: "v1".to_string(),
        stable_order_key: "key".to_string(),
        candidates: vec![candidate],
        summary: RecommendationSummaryPayload {
            request_id: "req-nan".to_string(),
            stage: "stage".to_string(),
            pipeline_version: "v1".to_string(),
            owner: "rust".to_string(),
            fallback_mode: "none".to_string(),
            provider_calls: Default::default(),
            provider_latency_ms: Default::default(),
            retrieved_count: 1,
            selected_count: 1,
            source_counts: Default::default(),
            filter_drop_counts: Default::default(),
            stage_timings: Default::default(),
            stage_latency_ms: Default::default(),
            degraded_reasons: Vec::new(),
            recent_hot_applied: false,
            online_eval: RecommendationOnlineEvaluationPayload {
                selected_count: 1,
                average_score: f64::NAN,
                score_stddev: f64::INFINITY,
                ..Default::default()
            },
            selector: RecommendationSelectorPayload {
                oversample_factor: 1,
                max_size: 10,
                final_limit: 10,
                truncated: false,
                selector_report: None,
                selector_report_unavailable_reason: None,
            },
            serving: RecommendationServingSummaryPayload {
                serving_version: "v1".to_string(),
                cursor_mode: "v1".to_string(),
                cursor: None,
                next_cursor: None,
                has_more: false,
                served_state_version: "v1".to_string(),
                stable_order_key: "key".to_string(),
                duplicate_suppressed_count: 0,
                cross_page_duplicate_count: 0,
                suppression_reasons: Default::default(),
                serve_cache_hit: false,
                stable_order_drifted: false,
                cache_key_mode: "v1".to_string(),
                cache_policy: "v1".to_string(),
                cache_policy_reason: "ok".to_string(),
                page_remaining_count: 0,
                page_underfilled: false,
                page_underfill_reason: None,
            },
            retrieval: RecommendationRetrievalSummaryPayload {
                stage: "v1".to_string(),
                total_candidates: 1,
                in_network_candidates: 1,
                out_of_network_candidates: 0,
                ml_retrieved_candidates: 0,
                recent_hot_candidates: 0,
                source_counts: Default::default(),
                source_outcome_counts: Default::default(),
                source_failure_counts: Default::default(),
                source_disabled_counts: Default::default(),
                lane_counts: Default::default(),
                ml_source_counts: Default::default(),
                stage_timings: Default::default(),
                degraded_reasons: Vec::new(),
                graph: Default::default(),
            },
            ranking: RecommendationRankingSummaryPayload {
                stage: "v1".to_string(),
                input_candidates: 1,
                hydrated_candidates: 1,
                filtered_candidates: 1,
                scored_candidates: 1,
                ml_eligible_candidates: 0,
                ml_ranked_candidates: 0,
                weighted_candidates: 1,
                stage_timings: Default::default(),
                filter_drop_counts: Default::default(),
                degraded_reasons: Vec::new(),
            },
            stages: Vec::new(),
            trace: None,
        },
    };
    result.sanitize_non_finite_floats();

    let wire = serde_json::to_value(&result).expect("序列化清洗后的结果");
    assert_eq!(wire["summary"]["onlineEval"]["averageScore"], json!(0.0));
    assert_eq!(wire["summary"]["onlineEval"]["scoreStddev"], json!(0.0));
    assert_eq!(wire["candidates"][0]["score"], json!(0.0));
    assert_eq!(
        wire["candidates"][0]["phoenixScores"]["dwellProbs"],
        json!([0.2, 0.0, 0.0])
    );
}
