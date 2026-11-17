use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::time::Instant;

use serde_json::Value;

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, SlateContextPayload,
};

pub mod config;
pub mod greedy;
pub mod kernel;

#[cfg(test)]
mod tests;

pub use config::{DppConfig, SlidingWindow};
pub use greedy::DppResult;
pub use kernel::{DppInput, build_dpp_input_from_candidate, sid_to_normalized_256d_proxy};

use greedy::{greedy_dpp_pool, serve_remapped, window_greedy};
use kernel::{
    DPP_EPSILON, avg_adjacent_cosine, avg_pairwise_cosine, normalized_quality_ratios,
    recon_cosine_milli,
};

/// DPP 重排阶段可观测统计指标（用于写入 `SlateContextPayload` 与 `Stage Detail`）。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct DppMetrics {
    /// 是否执行了 DPP 多样性重排。
    pub applied: bool,
    /// 参与 DPP 的候选池大小（截断至 `max_selected_rank`）。
    pub pool_size: usize,
    /// 实际选出的候选数。
    pub selected_count: usize,
    /// 重排前 Top-K 平均两两余弦相似度。
    pub avg_pairwise_cosine_before: f64,
    /// 重排后 Top-K 平均两两余弦相似度。
    pub avg_pairwise_cosine_after: f64,
    /// 重排前相邻位置平均余弦相似度。
    pub adjacent_cosine_before: f64,
    /// 重排后相邻位置平均余弦相似度。
    pub adjacent_cosine_after: f64,
    /// 拥有有效语义向量的候选占比（含 SID 代理展开）。
    pub embedding_coverage_ratio: f64,
    /// 拥有有效 Semantic ID 的候选占比。
    pub sid_coverage_ratio: f64,
    /// Cholesky 增量分解是否触及秩耗尽提前终止。
    pub rank_exhausted: bool,
    /// 增量分解终止条件方差。
    pub terminal_cv: f64,
    /// 最终选中集合的对数行列式。
    pub log_det: Option<f64>,
    /// 本次 DPP 核矩阵构造与贪心选出耗时（微秒）。
    pub duration_us: u64,
}

/// 底层 DPP 重排输出（包含保分重映射后的结果及可观测指标）。
#[derive(Debug, Clone)]
pub struct DppRescoreOutput {
    pub results: Vec<DppResult>,
    pub metrics: DppMetrics,
}

/// 面向推荐管线候选列表的完整 DPP 重排输出。
#[derive(Debug, Clone)]
pub struct DppCandidateRerankOutput {
    pub candidates: Vec<RecommendationCandidatePayload>,
    pub metrics: DppMetrics,
}

/// 执行 DPP 多样性重排与保分重映射的简洁入口。
pub fn rescore(
    inputs: &[DppInput],
    seed: Option<&DppInput>,
    history: &[DppInput],
    config: &DppConfig,
) -> Vec<DppResult> {
    rescore_with_metrics(inputs, seed, history, config, None).results
}

/// 执行 DPP 多样性重排并收集重排前后两两余弦相似度、覆盖率与耗时指标。
pub fn rescore_with_metrics(
    inputs: &[DppInput],
    seed: Option<&DppInput>,
    history: &[DppInput],
    config: &DppConfig,
    eval_top_k: Option<usize>,
) -> DppRescoreOutput {
    let start = Instant::now();
    let n = inputs.len();
    if n == 0 || config.top_k == 0 {
        return DppRescoreOutput {
            results: Vec::new(),
            metrics: DppMetrics::default(),
        };
    }

    let mut sorted: Vec<usize> = (0..n).collect();
    sorted.sort_unstable_by(|&a, &b| {
        inputs[b]
            .score
            .partial_cmp(&inputs[a].score)
            .unwrap_or(Ordering::Equal)
            .then_with(|| a.cmp(&b))
    });

    let top_count = config.max_selected_rank.min(n).max(1);
    let top_indices = &sorted[..top_count];
    let m = top_count;
    let pool: Vec<&DppInput> = top_indices.iter().map(|&i| &inputs[i]).collect();

    let covered_embeddings = pool.iter().filter(|c| !c.embedding_missing).count();
    let covered_sids = pool.iter().filter(|c| c.l1.is_some()).count();
    let embedding_coverage_ratio = (covered_embeddings as f64) / (m as f64);
    let sid_coverage_ratio = (covered_sids as f64) / (m as f64);

    let theta = config.theta.clamp(0.0, 1.0 - DPP_EPSILON);
    let alpha = theta / (2.0 * (1.0 - theta));

    let (greedy, rank_exhausted, terminal_cv, log_det) = if let Some(window) = config.window {
        let ratios = normalized_quality_ratios(&pool);
        let quality: Vec<f64> = ratios
            .into_iter()
            .map(|r| (2.0 * alpha * r).clamp(-50.0, 50.0).exp())
            .collect();
        let context: Vec<&DppInput> = seed.into_iter().chain(history).collect();
        let picks = window_greedy(&pool, &quality, &context, window, config.top_k);
        let greedy: Vec<usize> = picks.into_iter().map(|i| top_indices[i]).collect();
        (greedy, false, 0.0, None)
    } else {
        let dpp_result = greedy_dpp_pool(&pool, seed, theta, config.top_k);

        let selected: Vec<(usize, f64)> = dpp_result
            .selected
            .iter()
            .copied()
            .filter(|&(ki, _)| ki < m)
            .collect();
        let log_det = selected.last().map(|&(_, ld)| ld);
        let greedy: Vec<usize> = selected.iter().map(|&(ki, _)| top_indices[ki]).collect();
        (
            greedy,
            dpp_result.rank_exhausted,
            dpp_result.terminal_cv,
            log_det,
        )
    };

    let (order, _dpp_selected, results) = serve_remapped(inputs, greedy, config);
    let k = results.len();
    let eval_k = eval_top_k.map(|ek| ek.min(k)).unwrap_or(k);

    let (avg_pairwise_cosine_before, avg_pairwise_cosine_after) = if eval_k >= 2 {
        (
            avg_pairwise_cosine(inputs, &sorted[..eval_k]),
            avg_pairwise_cosine(inputs, &order[..eval_k]),
        )
    } else {
        (0.0, 0.0)
    };

    let (adjacent_cosine_before, adjacent_cosine_after) = if eval_k >= 2 {
        (
            avg_adjacent_cosine(inputs, &sorted[..eval_k]),
            avg_adjacent_cosine(inputs, &order[..eval_k]),
        )
    } else {
        (0.0, 0.0)
    };

    let duration_us = start.elapsed().as_micros().min(u64::MAX as u128) as u64;

    DppRescoreOutput {
        results,
        metrics: DppMetrics {
            applied: true,
            pool_size: m,
            selected_count: k,
            avg_pairwise_cosine_before,
            avg_pairwise_cosine_after,
            adjacent_cosine_before,
            adjacent_cosine_after,
            embedding_coverage_ratio,
            sid_coverage_ratio,
            rank_exhausted,
            terminal_cv,
            log_det,
            duration_us,
        },
    }
}

/// 对推荐候选切片执行端到端 DPP 重排，执行保分集合重映射并填充 `SlateContextPayload`。
///
/// 说明：
/// - 仅对前 `config.max_selected_rank`（默认 150）名内的候选进行 DPP 核/滑窗重排；
/// - 若存在被 Cholesky 秩耗尽排除但仍需保留至尾部（避免欠采）的候选或超出 150 名的长尾候选，
///   可由调用方根据 `preserve_unselected_tail` 策略决定是否保留在已选序列之后；
/// - 重排后写回 `candidate.score`（保分重映射）与完整 `SlateContextPayload`。
pub fn rerank_candidates(
    query: &RecommendationQueryPayload,
    candidates: &[RecommendationCandidatePayload],
    config: &DppConfig,
    preserve_unselected_tail: bool,
    eval_top_k: Option<usize>,
) -> DppCandidateRerankOutput {
    if candidates.is_empty() || config.top_k == 0 {
        return DppCandidateRerankOutput {
            candidates: Vec::new(),
            metrics: DppMetrics::default(),
        };
    }

    let inputs: Vec<DppInput> = candidates
        .iter()
        .enumerate()
        .map(|(idx, candidate)| build_dpp_input_from_candidate(idx, candidate))
        .collect();

    // 若查询携带了历史已下发且在本地有嵌入/SID 映射的条目，提取滑窗跨页排斥上下文。
    let history = build_history_context(query, candidates);

    let rescore_out = rescore_with_metrics(&inputs, None, &history, config, eval_top_k);
    let mut selected_indices = HashSet::with_capacity(rescore_out.results.len());
    let mut output = Vec::with_capacity(if preserve_unselected_tail {
        candidates.len()
    } else {
        rescore_out.results.len()
    });

    for (new_rank, res) in rescore_out.results.iter().enumerate() {
        selected_indices.insert(res.pool_index);
        let mut candidate = candidates[res.pool_index].clone();
        if candidate.score.is_some() {
            candidate.score = Some(res.score);
        }
        let breakdown = candidate.score_breakdown.get_or_insert_with(HashMap::new);
        breakdown.insert("dppPreDiversityScore".to_string(), res.pre_diversity_score);
        if new_rank == 0 {
            breakdown.insert(
                "dppAvgPairwiseCosineBefore".to_string(),
                rescore_out.metrics.avg_pairwise_cosine_before,
            );
            breakdown.insert(
                "dppAvgPairwiseCosineAfter".to_string(),
                rescore_out.metrics.avg_pairwise_cosine_after,
            );
        }
        output.push((res.pool_index, res.pre_diversity_score, candidate));
    }

    if preserve_unselected_tail && selected_indices.len() < candidates.len() {
        // 将未在本次 DPP 前排选中的剩余候选按原分顺序附加于尾部，且分数不高于已选最低分。
        let min_selected_score = rescore_out.results.last().map(|r| r.score).unwrap_or(0.0);
        let mut tail: Vec<(usize, &RecommendationCandidatePayload)> = candidates
            .iter()
            .enumerate()
            .filter(|(idx, _)| !selected_indices.contains(idx))
            .collect();
        tail.sort_unstable_by(|(idx_a, cand_a), (idx_b, cand_b)| {
            cand_b
                .final_score()
                .partial_cmp(&cand_a.final_score())
                .unwrap_or(Ordering::Equal)
                .then_with(|| idx_a.cmp(idx_b))
        });
        for (offset, (orig_idx, cand)) in tail.into_iter().enumerate() {
            let mut cloned = cand.clone();
            let orig_score = cloned.final_score();
            if cloned.score.is_some() {
                cloned.score = Some(min_selected_score - ((offset + 1) as f64) * 1e-4);
            }
            output.push((orig_idx, orig_score, cloned));
        }
    }

    let mut final_candidates: Vec<RecommendationCandidatePayload> =
        Vec::with_capacity(output.len());
    let mut raw_pairs: Vec<(usize, f64)> = Vec::with_capacity(output.len());
    for (orig_pool_rank, orig_score, cand) in output {
        raw_pairs.push((orig_pool_rank, orig_score));
        final_candidates.push(cand);
    }

    populate_slate_contexts(&mut final_candidates, &raw_pairs);

    DppCandidateRerankOutput {
        candidates: final_candidates,
        metrics: rescore_out.metrics,
    }
}

/// 为重排后的候选序列填充完整的 `SlateContextPayload`（位置索引、SID 前缀步距间隔及多样性前分数）。
pub fn populate_slate_contexts(
    candidates: &mut [RecommendationCandidatePayload],
    pool_ranks_and_pre_scores: &[(usize, f64)],
) {
    let mut last_l1_pos: HashMap<i32, usize> = HashMap::new();
    let mut last_l2_pos: HashMap<(i32, i32), usize> = HashMap::new();
    let mut last_l3_pos: HashMap<(i32, i32, i32), usize> = HashMap::new();

    for (pos, candidate) in candidates.iter_mut().enumerate() {
        let (pool_rank, pre_diversity_score) = pool_ranks_and_pre_scores
            .get(pos)
            .copied()
            .unwrap_or((pos, candidate.final_score()));

        let sids = candidate.semantic_ids;
        let l1 = sids.and_then(|s| (s[0] >= 0).then_some(s[0]));
        let l2 = sids.and_then(|s| (s[0] >= 0 && s[1] >= 0).then_some(s[1]));
        let l3 = sids.and_then(|s| (s[0] >= 0 && s[1] >= 0 && s[2] >= 0).then_some(s[2]));

        let gap_l1 = l1.and_then(|code| {
            let prev = last_l1_pos.insert(code, pos)?;
            Some((pos - prev) as i32)
        });
        let gap_l2 = match (l1, l2) {
            (Some(c1), Some(c2)) => {
                let prev = last_l2_pos.insert((c1, c2), pos);
                prev.map(|p| (pos - p) as i32)
            }
            _ => None,
        };
        let gap_l3 = match (l1, l2, l3) {
            (Some(c1), Some(c2), Some(c3)) => {
                let prev = last_l3_pos.insert((c1, c2, c3), pos);
                prev.map(|p| (pos - p) as i32)
            }
            _ => None,
        };

        let existing_recon = candidate
            .slate_context
            .as_ref()
            .and_then(|ctx| ctx.recon_cos_milli);
        let recon_cos_milli = existing_recon.or_else(|| recon_cosine_milli(candidate));

        let sid_known = sids.is_some_and(|s| s[0] >= 0);
        let ctx = candidate
            .slate_context
            .get_or_insert_with(|| Box::new(SlateContextPayload::default()));
        ctx.k = Some(pos as u32);
        ctx.pool_rank = Some(pool_rank as u32);
        ctx.sid_known = Some(sid_known);
        ctx.sid_k_l1 = l1.map(|v| v as u32);
        ctx.sid_k_l2 = l2.map(|v| v as u32);
        ctx.sid_k_l3 = l3.map(|v| v as u32);
        ctx.sid_gap_l1 = gap_l1;
        ctx.sid_gap_l2 = gap_l2;
        ctx.sid_gap_l3 = gap_l3;
        ctx.recon_cos_milli = recon_cos_milli;
        ctx.pre_diversity_score = Some(pre_diversity_score);
    }
}

/// 将 DPP 重排统计指标注入 Stage Detail，供离线归因与在线监控消费。
pub fn insert_dpp_stage_detail(detail: &mut HashMap<String, Value>, metrics: &DppMetrics) {
    detail.insert("dppApplied".to_string(), Value::Bool(metrics.applied));
    detail.insert(
        "dppPoolSize".to_string(),
        Value::from(metrics.pool_size as u64),
    );
    detail.insert(
        "dppSelectedCount".to_string(),
        Value::from(metrics.selected_count as u64),
    );
    detail.insert(
        "avgPairwiseCosineBefore".to_string(),
        Value::from(metrics.avg_pairwise_cosine_before),
    );
    detail.insert(
        "avgPairwiseCosineAfter".to_string(),
        Value::from(metrics.avg_pairwise_cosine_after),
    );
    detail.insert(
        "dppAdjacentCosineBefore".to_string(),
        Value::from(metrics.adjacent_cosine_before),
    );
    detail.insert(
        "dppAdjacentCosineAfter".to_string(),
        Value::from(metrics.adjacent_cosine_after),
    );
    detail.insert(
        "dppEmbeddingCoverageRatio".to_string(),
        Value::from(metrics.embedding_coverage_ratio),
    );
    detail.insert(
        "dppSidCoverageRatio".to_string(),
        Value::from(metrics.sid_coverage_ratio),
    );
    detail.insert(
        "dppRankExhausted".to_string(),
        Value::Bool(metrics.rank_exhausted),
    );
    detail.insert(
        "dppDurationUs".to_string(),
        Value::from(metrics.duration_us),
    );
}

fn build_history_context(
    query: &RecommendationQueryPayload,
    candidates: &[RecommendationCandidatePayload],
) -> Vec<DppInput> {
    if query.served_history.is_empty() && query.seed_candidate_post_ids.is_empty() {
        return Vec::new();
    }
    let mut by_id: HashMap<&str, &RecommendationCandidatePayload> =
        HashMap::with_capacity(candidates.len());
    for candidate in candidates {
        by_id.insert(candidate.post_id.as_str(), candidate);
    }

    let mut history = Vec::new();
    for entry in &query.served_history {
        if let Some(cand) = by_id.get(entry.post_id.as_str()) {
            let input = build_dpp_input_from_candidate(usize::MAX, cand);
            if !input.embedding_missing || input.l1.is_some() {
                history.push(input);
            }
        }
    }
    history
}
