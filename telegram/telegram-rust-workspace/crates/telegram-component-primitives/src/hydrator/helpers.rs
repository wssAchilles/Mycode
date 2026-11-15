//! 缓存键构造与阶段缓存明细生成工具。

use std::collections::HashMap;
use std::hash::Hasher;

use serde_json::Value;

/// Query Hydrator 缓存键构造器。
pub fn query_hydrator_cache_key(hydrator_name: &str, user_id: &str, request_id: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    std::hash::Hash::hash(request_id, &mut hasher);
    let hash = hasher.finish();
    format!("{}:{}:{:016x}", hydrator_name, user_id, hash)
}

/// Candidate Hydrator 缓存键构造器。
pub fn candidate_hydrator_cache_key(hydrator_name: &str, post_id: &str) -> String {
    format!("{}:{}", hydrator_name, post_id)
}

/// 构建阶段缓存遥测明细映射。
pub fn cache_stage_detail(hit: bool, key: &str, entry_count: u64) -> HashMap<String, Value> {
    let mut detail = HashMap::new();
    detail.insert("cacheHit".to_string(), Value::Bool(hit));
    detail.insert("cacheKey".to_string(), Value::String(key.to_string()));
    detail.insert("cacheEntryCount".to_string(), Value::from(entry_count));
    detail
}
