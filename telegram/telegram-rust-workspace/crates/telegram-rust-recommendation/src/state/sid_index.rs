//! 6x256 Semantic ID 前缀压缩倒排索引（对标 x-algorithm `xai-recsys-sid-retrieval/src/index.rs`）。

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

mod codec;
#[cfg(test)]
mod tests;
mod types;

use codec::FULL_48_MASK;
pub use codec::{
    SID_LEVELS, SID_MAX_CODE, SeedKey, codes_from_key, is_valid_sid_code, pack_full_key,
    prefix_range, seed_key,
};
pub use types::{
    IndexedSidPost, SID_DEFAULT_MAX_PER_SEED, SID_DEFAULT_MAX_PREFIX_DEPTH,
    SID_DEFAULT_MAX_RESULTS, SID_DEFAULT_MAX_SEEDS, SID_DEFAULT_MIN_PREFIX_DEPTH, SidCandidate,
    SidRetrieveParams, SidSeed,
};

/// 全内存 Semantic ID 前缀倒排索引，支撑毫秒级无向量库语义召回与水合查询。
#[derive(Clone, Debug, Default)]
pub struct SidPrefixIndex {
    by_key: Vec<IndexedSidPost>,
    by_post: HashMap<String, (u64, String)>,
}

impl SidPrefixIndex {
    /// 从帖子列表构建排序去重后的前缀索引。
    pub fn build(mut posts: Vec<IndexedSidPost>) -> Self {
        posts.retain(|p| !p.post_id.trim().is_empty());
        // 同一帖子保留时间戳最新的一条记录
        posts.sort_unstable_by(|a, b| {
            a.post_id
                .cmp(&b.post_id)
                .then_with(|| b.created_at_ms.cmp(&a.created_at_ms))
        });
        posts.dedup_by(|a, b| a.post_id == b.post_id);

        let by_post = posts
            .iter()
            .map(|p| {
                (
                    p.post_id.clone(),
                    (p.key & FULL_48_MASK, p.author_id.clone()),
                )
            })
            .collect();

        for post in &mut posts {
            post.key &= FULL_48_MASK;
        }
        posts.sort_unstable_by(cmp_index_order);

        Self {
            by_key: posts,
            by_post,
        }
    }

    /// 返回索引内已收录帖子总数。
    pub fn len(&self) -> usize {
        self.by_key.len()
    }

    /// 判断索引是否为空。
    pub fn is_empty(&self) -> bool {
        self.by_key.is_empty()
    }

    /// 只读访问按 `key` 升序排列的底层索引切片。
    pub fn by_key(&self) -> &[IndexedSidPost] {
        &self.by_key
    }

    /// 只读访问 `post_id -> (key, author_id)` 映射表。
    pub fn by_post(&self) -> &HashMap<String, (u64, String)> {
        &self.by_post
    }

    /// 根据 `post_id` 查询压缩后的 48 位键与作者 ID。
    pub fn lookup(&self, post_id: &str) -> Option<(u64, &str)> {
        self.by_post
            .get(post_id)
            .map(|(key, author_id)| (*key, author_id.as_str()))
    }

    /// 根据 `post_id` 直接解包还原 6 级 Semantic ID。
    pub fn lookup_codes(&self, post_id: &str) -> Option<[i32; SID_LEVELS]> {
        self.by_post
            .get(post_id)
            .map(|(key, _)| codes_from_key(*key))
    }

    /// 增量插入或更新单篇帖子（供增量流回填使用）。
    pub fn upsert(&mut self, mut post: IndexedSidPost) {
        if post.post_id.trim().is_empty() {
            return;
        }
        post.key &= FULL_48_MASK;
        if let Some((old_key, _)) = self
            .by_post
            .insert(post.post_id.clone(), (post.key, post.author_id.clone()))
        {
            let (start, end) = self.key_range(old_key, old_key + 1);
            if let Some(rel_idx) = self.by_key[start..end]
                .iter()
                .position(|entry| entry.post_id == post.post_id)
            {
                self.by_key.remove(start + rel_idx);
            }
        }
        let insert_pos = self
            .by_key
            .partition_point(|entry| cmp_index_order(entry, &post) == Ordering::Less);
        self.by_key.insert(insert_pos, post);
    }

    /// 从索引中摘除指定帖子（如删帖事件）。
    pub fn remove(&mut self, post_id: &str) -> bool {
        let Some((old_key, _)) = self.by_post.remove(post_id) else {
            return false;
        };
        let (start, end) = self.key_range(old_key, old_key + 1);
        if let Some(rel_idx) = self.by_key[start..end]
            .iter()
            .position(|entry| entry.post_id == post_id)
        {
            self.by_key.remove(start + rel_idx);
        }
        true
    }

    fn key_range(&self, lo: u64, hi: u64) -> (usize, usize) {
        let start = self.by_key.partition_point(|p| p.key < lo);
        let end = self.by_key.partition_point(|p| p.key < hi);
        (start, end)
    }

    /// 对单颗种子沿共享前缀深度由深到浅（默认 6 -> 5 -> 4 -> 3）执行两次 `partition_point` 区间召回。
    pub fn retrieve_for_seed(
        &self,
        seed_post_id: &str,
        seed: SeedKey,
        params: &SidRetrieveParams,
        excluded: &HashSet<String>,
    ) -> Vec<SidCandidate> {
        let max_depth = params
            .max_prefix_depth
            .min(seed.valid_depth)
            .min(SID_LEVELS);
        let mut picked = Vec::new();
        if params.min_prefix_depth == 0
            || params.max_per_seed == 0
            || max_depth < params.min_prefix_depth
        {
            return picked;
        }

        // 记录上一更深层级已扫描过的子区间，避免跨层重复遍历与返回同一帖子
        let mut consumed: Option<(usize, usize)> = None;
        for depth in (params.min_prefix_depth..=max_depth).rev() {
            let remaining = params.max_per_seed.saturating_sub(picked.len());
            if remaining == 0 {
                break;
            }
            let (lo, hi) = prefix_range(seed.key, depth);
            let (start, end) = self.key_range(lo, hi);
            let mut level: Vec<&IndexedSidPost> = match consumed {
                None => self.by_key[start..end].iter().collect(),
                Some((inner_start, inner_end)) => {
                    let inner_start = inner_start.clamp(start, end);
                    let inner_end = inner_end.clamp(inner_start, end);
                    self.by_key[start..inner_start]
                        .iter()
                        .chain(self.by_key[inner_end..end].iter())
                        .collect()
                }
            };
            level.retain(|post| !excluded.contains(&post.post_id));

            if level.len() > remaining {
                level.select_nth_unstable_by(remaining, |a, b| cmp_recency_desc(a, b));
                level.truncate(remaining);
            }
            level.sort_unstable_by(|a, b| cmp_recency_desc(a, b));

            picked.extend(level.into_iter().map(|post| SidCandidate {
                post_id: post.post_id.clone(),
                author_id: post.author_id.clone(),
                key: post.key,
                codes: codes_from_key(post.key),
                seed_post_id: seed_post_id.to_string(),
                shared_prefix_depth: depth as u32,
                created_at_ms: post.created_at_ms,
            }));
            consumed = Some((start, end));
        }

        picked
    }

    /// 多颗种子并发/批量前缀召回后按轮询（interleave）去重合并，控制每种子配额与总上限。
    pub fn retrieve_interleaved(
        &self,
        seeds: &[SidSeed],
        extra_excluded: &HashSet<String>,
        params: &SidRetrieveParams,
    ) -> (Vec<SidCandidate>, Vec<usize>) {
        if self.is_empty() || params.max_results == 0 || params.max_seeds == 0 {
            return (Vec::new(), Vec::new());
        }

        let mut seen_seed_ids = HashSet::new();
        let mut active_seeds = Vec::new();
        for seed in seeds {
            if seen_seed_ids.insert(seed.post_id.as_str()) {
                active_seeds.push(seed);
                if active_seeds.len() >= params.max_seeds {
                    break;
                }
            }
        }
        if active_seeds.is_empty() {
            return (Vec::new(), Vec::new());
        }

        let mut excluded: HashSet<String> = extra_excluded.clone();
        for seed in &active_seeds {
            excluded.insert(seed.post_id.clone());
        }

        let per_seed: Vec<Vec<SidCandidate>> = active_seeds
            .iter()
            .map(|seed| self.retrieve_for_seed(&seed.post_id, seed.key, params, &excluded))
            .collect();

        interleave_candidates(per_seed, params.max_results)
    }
}

fn cmp_index_order(a: &IndexedSidPost, b: &IndexedSidPost) -> Ordering {
    a.key
        .cmp(&b.key)
        .then_with(|| b.created_at_ms.cmp(&a.created_at_ms))
        .then_with(|| b.post_id.cmp(&a.post_id))
}

fn cmp_recency_desc(a: &IndexedSidPost, b: &IndexedSidPost) -> Ordering {
    b.created_at_ms
        .cmp(&a.created_at_ms)
        .then_with(|| b.post_id.cmp(&a.post_id))
}

fn interleave_candidates(
    per_seed: Vec<Vec<SidCandidate>>,
    max_results: usize,
) -> (Vec<SidCandidate>, Vec<usize>) {
    let mut counts = vec![0usize; per_seed.len()];
    let mut cursors = vec![0usize; per_seed.len()];
    let mut emitted = HashSet::new();
    let mut out = Vec::with_capacity(max_results.min(256));

    while out.len() < max_results {
        let mut progressed = false;
        for (seed_idx, candidates) in per_seed.iter().enumerate() {
            if out.len() >= max_results {
                break;
            }
            while cursors[seed_idx] < candidates.len() {
                let candidate = &candidates[cursors[seed_idx]];
                cursors[seed_idx] += 1;
                if emitted.insert(candidate.post_id.clone()) {
                    out.push(candidate.clone());
                    counts[seed_idx] += 1;
                    progressed = true;
                    break;
                }
            }
        }
        if !progressed {
            break;
        }
    }

    (out, counts)
}
