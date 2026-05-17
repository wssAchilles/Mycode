use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use bloomfilter::Bloom;

/// Impression Bloom Filter - 对标 X 的 ImpressionBloomFilterService
///
/// 用于高效跟踪用户已看过的帖子，避免重复推荐。
/// 使用 Bloom Filter 实现概率性去重，假阳性率约 1%。
///
/// 参数：
/// - 每用户约 12KB 内存（10K 帖子，1% 假阳性率）
/// - TTL 30 天自动过期
pub struct ImpressionBloomFilter {
    /// 用户 Bloom Filter 存储: user_id -> (bloom, last_updated)
    filters: Arc<RwLock<HashMap<String, UserBloomEntry>>>,
    /// 每用户最大帖子数
    max_items_per_user: usize,
    /// 假阳性率
    false_positive_rate: f64,
    /// TTL
    ttl: Duration,
}

struct UserBloomEntry {
    bloom: Bloom<String>,
    last_updated: Instant,
    item_count: usize,
}

impl ImpressionBloomFilter {
    /// 创建新的 Impression Bloom Filter
    ///
    /// # Arguments
    /// * `max_items_per_user` - 每用户最大帖子数（默认 10000）
    /// * `false_positive_rate` - 假阳性率（默认 0.01 = 1%）
    /// * `ttl_hours` - TTL 小时数（默认 720 = 30 天）
    pub fn new(max_items_per_user: usize, false_positive_rate: f64, ttl_hours: u64) -> Self {
        Self {
            filters: Arc::new(RwLock::new(HashMap::new())),
            max_items_per_user,
            false_positive_rate,
            ttl: Duration::from_hours(ttl_hours),
        }
    }

    /// 检查帖子是否可能已被用户看过
    ///
    /// 返回 true 表示"可能看过"（可能是假阳性）
    /// 返回 false 表示"肯定没看过"
    pub fn might_contain(&self, user_id: &str, post_id: &str) -> bool {
        let filters = self.filters.read().unwrap();
        if let Some(entry) = filters.get(user_id) {
            if entry.last_updated.elapsed() > self.ttl {
                return false; // 过期了
            }
            entry.bloom.check(&post_id.to_string())
        } else {
            false
        }
    }

    /// 记录帖子已被用户看过
    pub fn insert(&self, user_id: &str, post_id: &str) {
        let mut filters = self.filters.write().unwrap();
        let entry = filters
            .entry(user_id.to_string())
            .or_insert_with(|| UserBloomEntry {
                bloom: Bloom::new_for_fp_rate(self.max_items_per_user, self.false_positive_rate),
                last_updated: Instant::now(),
                item_count: 0,
            });

        if entry.last_updated.elapsed() > self.ttl {
            // 过期了，重置
            entry.bloom = Bloom::new_for_fp_rate(self.max_items_per_user, self.false_positive_rate);
            entry.item_count = 0;
        }

        entry.bloom.set(&post_id.to_string());
        entry.item_count += 1;
        entry.last_updated = Instant::now();
    }

    /// 批量记录帖子已被用户看过
    pub fn insert_batch(&self, user_id: &str, post_ids: &[String]) {
        let mut filters = self.filters.write().unwrap();
        let entry = filters
            .entry(user_id.to_string())
            .or_insert_with(|| UserBloomEntry {
                bloom: Bloom::new_for_fp_rate(self.max_items_per_user, self.false_positive_rate),
                last_updated: Instant::now(),
                item_count: 0,
            });

        if entry.last_updated.elapsed() > self.ttl {
            entry.bloom = Bloom::new_for_fp_rate(self.max_items_per_user, self.false_positive_rate);
            entry.item_count = 0;
        }

        for post_id in post_ids {
            entry.bloom.set(post_id);
            entry.item_count += 1;
        }
        entry.last_updated = Instant::now();
    }

    /// 清理过期的用户 Bloom Filter
    pub fn cleanup_expired(&self) {
        let mut filters = self.filters.write().unwrap();
        filters.retain(|_, entry| entry.last_updated.elapsed() <= self.ttl);
    }

    /// 获取用户已看过的帖子数量估计
    pub fn estimated_count(&self, user_id: &str) -> usize {
        let filters = self.filters.read().unwrap();
        filters
            .get(user_id)
            .filter(|entry| entry.last_updated.elapsed() <= self.ttl)
            .map(|entry| entry.item_count)
            .unwrap_or(0)
    }
}

impl Default for ImpressionBloomFilter {
    fn default() -> Self {
        Self::new(10_000, 0.01, 720)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_item_not_contained() {
        let bloom = ImpressionBloomFilter::new(1000, 0.01, 24);
        assert!(!bloom.might_contain("user1", "post1"));
    }

    #[test]
    fn inserted_item_might_be_contained() {
        let bloom = ImpressionBloomFilter::new(1000, 0.01, 24);
        bloom.insert("user1", "post1");
        assert!(bloom.might_contain("user1", "post1"));
    }

    #[test]
    fn different_user_not_contained() {
        let bloom = ImpressionBloomFilter::new(1000, 0.01, 24);
        bloom.insert("user1", "post1");
        assert!(!bloom.might_contain("user2", "post1"));
    }

    #[test]
    fn batch_insert_works() {
        let bloom = ImpressionBloomFilter::new(1000, 0.01, 24);
        let posts = vec![
            "post1".to_string(),
            "post2".to_string(),
            "post3".to_string(),
        ];
        bloom.insert_batch("user1", &posts);
        assert!(bloom.might_contain("user1", "post1"));
        assert!(bloom.might_contain("user1", "post2"));
        assert!(bloom.might_contain("user1", "post3"));
        assert!(!bloom.might_contain("user1", "post4"));
    }

    #[test]
    fn estimated_count_works() {
        let bloom = ImpressionBloomFilter::new(1000, 0.01, 24);
        bloom.insert("user1", "post1");
        bloom.insert("user1", "post2");
        assert_eq!(bloom.estimated_count("user1"), 2);
        assert_eq!(bloom.estimated_count("user2"), 0);
    }
}
