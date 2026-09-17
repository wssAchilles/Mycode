use chrono::Utc;

use telegram_rust_recommendation::contracts::RecommendationCandidatePayload;
use telegram_rust_recommendation::filters::impression_filter::ImpressionFilter;
use telegram_rust_recommendation::serving::impression_bloom::ImpressionBloomFilter;
use telegram_rust_recommendation::clients::redis_features::{RealtimeFeatureProvider, RealtimeUserFeatures};
use telegram_thunder_store::{LightPost, ThunderConfig, ThunderStore};

fn make_test_candidate(id: &str, author_id: &str) -> RecommendationCandidatePayload {
    RecommendationCandidatePayload {
        post_id: id.to_string(),
        author_id: author_id.to_string(),
        created_at: Utc::now(),
        score: Some(0.85),
        recall_source: Some("test_source".to_string()),
        ..Default::default()
    }
}

fn make_test_light_post(id: &str, author_id: &str) -> LightPost {
    LightPost {
        post_id: id.to_string(),
        author_id: author_id.to_string(),
        content_preview: "测试帖子内容".to_string(),
        created_at: Utc::now(),
        has_image: false,
        has_video: false,
        like_count: 10,
        comment_count: 2,
        repost_count: 1,
        view_count: 100,
        recall_source: "thunder".to_string(),
        conversation_id: None,
        is_reply: false,
        is_repost: false,
        original_post_id: None,
        topic_tags: vec!["tech".to_string()],
    }
}

#[tokio::test]
async fn test_impression_bloom_filtering_lifecycle() {
    let bloom = ImpressionBloomFilter::new(1000, 0.01, 720);
    let user_id = "user_test_42";

    let c1 = make_test_candidate("post_1001", "author_1");
    let c2 = make_test_candidate("post_1002", "author_2");
    let c3 = make_test_candidate("post_1003", "author_3");

    // 1. 初始状态：未看过任何帖子，所有候选保留
    let (kept, dropped) = ImpressionFilter::apply(vec![c1.clone(), c2.clone(), c3.clone()], user_id, &bloom);
    assert_eq!(kept.len(), 3);
    assert_eq!(dropped, 0);

    // 2. 模拟用户已看 post_1001 与 post_1003
    bloom.insert(user_id, "post_1001");
    bloom.insert(user_id, "post_1003");

    // 3. 再次过滤：post_1001 与 post_1003 必须被过滤，仅保留 post_1002
    let (kept_after, dropped_after) = ImpressionFilter::apply(vec![c1, c2, c3], user_id, &bloom);
    assert_eq!(kept_after.len(), 1);
    assert_eq!(kept_after[0].post_id, "post_1002");
    assert_eq!(dropped_after, 2);
}

#[tokio::test]
async fn test_thunder_store_batch_map() {
    let config = ThunderConfig::default();
    let store = ThunderStore::new(config);

    let p1 = make_test_light_post("post_t1", "author_a");
    let p2 = make_test_light_post("post_t2", "author_b");

    store.upsert(p1);
    store.upsert(p2);

    let ids = vec![
        "post_t1".to_string(),
        "post_t2".to_string(),
        "post_nonexistent".to_string(),
    ];

    let batch_map = store.get_batch_map(&ids);
    assert_eq!(batch_map.len(), 2);
    assert!(batch_map.contains_key("post_t1"));
    assert!(batch_map.contains_key("post_t2"));
    assert!(!batch_map.contains_key("post_nonexistent"));
}

#[tokio::test]
async fn test_realtime_features_fail_open_on_invalid_connection() {
    // 使用无效的 Redis 地址测试 Fail-open 软降级
    let provider = RealtimeFeatureProvider::new("redis://127.0.0.1:59999").unwrap();

    // 必须在超时限制内平滑返回默认特征，不发生 panic，不报错中断
    let features: RealtimeUserFeatures = provider.get_user_features_safe("user_timeout_test", 50).await;
    assert!(features.is_empty());
    assert_eq!(features.interaction_count_1h, 0);
    assert_eq!(features.interaction_count_24h, 0);
}
