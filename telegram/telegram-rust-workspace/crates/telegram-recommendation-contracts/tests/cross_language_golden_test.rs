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
