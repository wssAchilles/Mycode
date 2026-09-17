use crate::contracts::RecommendationCandidatePayload;
use crate::serving::impression_bloom::ImpressionBloomFilter;

/// ImpressionBloomFilter 候选曝光去重过滤器（对标 X 的 ImpressionBloomFilterService）
pub struct ImpressionFilter;

impl ImpressionFilter {
    pub const NAME: &'static str = "ImpressionBloomFilter";

    /// 过滤候选集：移除用户已在 Bloom Filter 中记录过的曝光帖子
    /// 在 Heavy Ranker 打分之前执行，大幅削减打分算力开销并防止推荐已看内容
    pub fn apply(
        candidates: Vec<RecommendationCandidatePayload>,
        user_id: &str,
        bloom_filter: &ImpressionBloomFilter,
    ) -> (Vec<RecommendationCandidatePayload>, usize) {
        if candidates.is_empty() || user_id.is_empty() {
            return (candidates, 0);
        }

        let initial_count = candidates.len();
        let mut filtered: Vec<RecommendationCandidatePayload> = Vec::with_capacity(initial_count);
        let mut dropped_count = 0;

        for candidate in candidates {
            if bloom_filter.might_contain(user_id, &candidate.post_id) {
                dropped_count += 1;
            } else {
                filtered.push(candidate);
            }
        }

        (filtered, dropped_count)
    }
}
