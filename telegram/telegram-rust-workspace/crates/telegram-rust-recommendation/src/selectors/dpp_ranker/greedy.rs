use std::cmp::Ordering;

use super::config::{DppConfig, SlidingWindow};
use super::kernel::{DPP_EPSILON, DppInput, compute_quality_factors, cosine};

/// 增量 Cholesky MAP 贪心选择返回结果。
#[derive(Debug, Clone)]
pub struct GreedyDppResult {
    /// 已选候选索引与对应的累计对数行列式 `(index, log_det)`。
    pub selected: Vec<(usize, f64)>,
    /// 终止步的条件方差（marginal gain）。
    pub terminal_cv: f64,
    /// 是否因剩余正交余量低于阈值 `DPP_EPSILON` 而提前秩耗尽终止。
    pub rank_exhausted: bool,
}

/// 保分集合重映射后的单条 DPP 输出结果。
#[derive(Debug, Clone)]
pub struct DppResult {
    /// 对应原始输入数组中的下标。
    pub pool_index: usize,
    /// 候选帖子 ID。
    pub post_id: String,
    /// 经过保分集合重映射后的单调降序分数。
    pub score: f64,
    /// DPP 重排之前该候选自身携带的原始精排分数。
    pub pre_diversity_score: f64,
}

/// 对标 `x-algorithm/vm-ranker/dpp.rs` 的 O(K^2 * N) 增量 Cholesky MAP 贪心分解算法。
pub fn greedy_dpp(
    kernel: &[f64],
    n: usize,
    k: usize,
    pinned_first: Option<usize>,
) -> GreedyDppResult {
    if n == 0 || k == 0 {
        return GreedyDppResult {
            selected: Vec::new(),
            terminal_cv: 0.0,
            rank_exhausted: true,
        };
    }

    let pinned = pinned_first.filter(|&p| p < n && kernel[p * n + p] > DPP_EPSILON);
    greedy_dpp_with_row_provider(
        n,
        k,
        pinned,
        |diag| {
            for (i, d) in diag.iter_mut().enumerate() {
                *d = kernel[i * n + i];
            }
        },
        |row_idx, _avail, dst| {
            dst.copy_from_slice(&kernel[row_idx * n..(row_idx + 1) * n]);
        },
    )
}

/// 按需懒计算核矩阵行的 Cholesky MAP 贪心实现，跳过未选候选行的内积与 `N*N` 矩阵分配。
///
/// 数学语义与预先构建完整 `N*N` 核矩阵再调用 `greedy_dpp` 完全等价，
/// 但计算量从 `O(N^2 * D)` 降至 `O(K * N * D)`，内存降至 `O(K * N)`。
pub(crate) fn greedy_dpp_pool(
    pool: &[&DppInput],
    seed: Option<&DppInput>,
    theta: f64,
    k: usize,
) -> GreedyDppResult {
    let m = pool.len();
    let total = m + usize::from(seed.is_some());
    if total == 0 || k == 0 {
        return GreedyDppResult {
            selected: Vec::new(),
            terminal_cv: 0.0,
            rank_exhausted: true,
        };
    }

    let qf = compute_quality_factors(pool, seed, theta);
    let pinned = seed.map(|_| m).filter(|&p| qf[p] * qf[p] > DPP_EPSILON);
    let item_at = |ki: usize| -> &DppInput {
        if ki < m {
            pool[ki]
        } else {
            seed.expect("seed index exists only when seed is Some")
        }
    };

    greedy_dpp_with_row_provider(
        total,
        k,
        pinned,
        |diag| {
            for (d, &q) in diag.iter_mut().zip(&qf) {
                *d = q * q;
            }
        },
        |row_idx, avail, dst| {
            let item_r = item_at(row_idx);
            if item_r.embedding_missing || item_r.embedding.is_empty() {
                dst.fill(0.0);
                return;
            }
            let qf_r = qf[row_idx];
            for i in 0..total {
                dst[i] = if avail[i] {
                    qf_r * qf[i] * cosine(item_r, item_at(i))
                } else {
                    0.0
                };
            }
        },
    )
}

/// 增量 Cholesky MAP 贪心共用内核：外层遍历历史正交基行、内层连续切片向量化消元。
fn greedy_dpp_with_row_provider<Init, Row>(
    n: usize,
    k: usize,
    pinned_first: Option<usize>,
    init_diag: Init,
    mut fill_kernel_row: Row,
) -> GreedyDppResult
where
    Init: FnOnce(&mut [f64]),
    Row: FnMut(usize, &[bool], &mut [f64]),
{
    let max_items = match pinned_first {
        Some(_) => (k + 1).min(n),
        None => k.min(n),
    };

    let mut selected: Vec<(usize, f64)> = Vec::with_capacity(max_items);
    let mut available = vec![true; n];
    // 使用紧凑平铺 Cholesky 因子矩阵（步长 n）按行增量更新正交投影系数。
    let mut cholesky = vec![0.0_f64; max_items * n];
    let mut diag_residual = vec![0.0_f64; n];
    init_diag(&mut diag_residual);

    let mut log_det = 0.0_f64;
    let mut terminal_cv = 0.0_f64;
    let mut rank_exhausted = false;

    for s in 0..max_items {
        let (best_idx, best_vol) = if s == 0 {
            if let Some(p) = pinned_first {
                (p, diag_residual[p])
            } else {
                pick_best_residual(&diag_residual, &available)
            }
        } else {
            pick_best_residual(&diag_residual, &available)
        };

        if !best_vol.is_finite() || best_vol <= DPP_EPSILON {
            terminal_cv = best_vol;
            rank_exhausted = true;
            break;
        }

        terminal_cv = best_vol;
        log_det += best_vol.ln();
        selected.push((best_idx, log_det));
        available[best_idx] = false;

        if s + 1 >= max_items {
            break;
        }

        // 外层遍历已有正交基行 `j in 0..s`，内层连续顺序更新整行消除跨步访存并触发 SIMD 向量化。
        let (prev_rows, tail_rows) = cholesky.split_at_mut(s * n);
        let dst_row = &mut tail_rows[..n];
        fill_kernel_row(best_idx, &available, dst_row);

        for j in 0..s {
            let row_j = &prev_rows[j * n..(j + 1) * n];
            let c_jb = row_j[best_idx];
            for (d, &r) in dst_row.iter_mut().zip(row_j) {
                *d -= c_jb * r;
            }
        }

        let inv_sqrt_bv = 1.0 / best_vol.sqrt();
        let diag = &mut diag_residual[..n];
        for (d, dr) in dst_row.iter_mut().zip(diag.iter_mut()) {
            let c_si = *d * inv_sqrt_bv;
            *d = c_si;
            *dr -= c_si * c_si;
        }
    }

    GreedyDppResult {
        selected,
        terminal_cv,
        rank_exhausted,
    }
}

#[inline]
fn pick_best_residual(diag_residual: &[f64], available: &[bool]) -> (usize, f64) {
    let mut best_idx = 0_usize;
    let mut best_vol = f64::NEG_INFINITY;
    for (i, (&av, &cv)) in available.iter().zip(diag_residual).enumerate() {
        if av && cv > best_vol {
            best_vol = cv;
            best_idx = i;
        }
    }
    (best_idx, best_vol)
}

/// 对标 `x-algorithm/vm-ranker/dpp.rs` 的滑动窗口衰减贪心选择算法，结合余弦平方惩罚与 SID L1/L2 前缀排斥。
pub fn window_greedy(
    pool: &[&DppInput],
    quality: &[f64],
    context: &[&DppInput],
    window: SlidingWindow,
    k: usize,
) -> Vec<usize> {
    let target = k.min(pool.len());
    if target == 0 {
        return Vec::new();
    }

    let size = window.size.min(context.len() + target);
    let weights: Vec<f64> = (0..size)
        .map(|d| {
            if window.half_distance > 0.0 {
                0.5_f64.powf((d as f64) / window.half_distance).min(1.0)
            } else {
                1.0
            }
        })
        .collect();

    let fill_penalty_row = |item: &DppInput, avail: Option<&[bool]>, row: &mut [f64]| {
        for (idx, (&c, slot)) in pool.iter().zip(row.iter_mut()).enumerate() {
            if avail.is_some_and(|flags| !flags[idx]) {
                *slot = 0.0;
                continue;
            }
            let cos = cosine(item, c);
            let sid_penalty = sid_prefix_penalty(item, c, window.sid_lambda);
            *slot = (cos * cos + sid_penalty).min(1.0);
        }
    };

    let mut sequence: Vec<Vec<f64>> = Vec::with_capacity(size);
    for &item in context.iter().take(size).rev() {
        let mut row = vec![0.0_f64; pool.len()];
        fill_penalty_row(item, None, &mut row);
        sequence.push(row);
    }

    let mut available = vec![true; pool.len()];
    let mut picks = Vec::with_capacity(target);

    for _ in 0..target {
        let recent = &sequence[sequence.len().saturating_sub(size)..];
        let mut best: Option<(usize, f64)> = None;

        for i in 0..pool.len() {
            if !available[i] {
                continue;
            }
            let gain = recent
                .iter()
                .rev()
                .zip(&weights)
                .fold(quality[i], |g, (row, &w)| g * (1.0 - w * row[i]));
            if best.is_none_or(|(_, b)| gain > b) {
                best = Some((i, gain));
            }
        }

        let Some((pick, _)) = best else {
            break;
        };
        available[pick] = false;
        picks.push(pick);
        if picks.len() < target && size > 0 {
            let mut row = if sequence.len() >= size {
                // 复用滑出窗口的最旧行缓冲，消除每步堆分配。
                sequence.remove(0)
            } else {
                vec![0.0_f64; pool.len()]
            };
            fill_penalty_row(pool[pick], Some(&available), &mut row);
            sequence.push(row);
        }
    }

    picks
}

/// 计算两个候选之间的 Semantic ID L1/L2 前缀多样性排斥惩罚。
#[inline]
fn sid_prefix_penalty(a: &DppInput, b: &DppInput, sid_lambda: f64) -> f64 {
    if sid_lambda <= 0.0 {
        return 0.0;
    }
    let same_l1 = a.l1.is_some() && a.l1 == b.l1;
    if !same_l1 {
        return 0.0;
    }
    let same_l2 = a.l2.is_some() && a.l2 == b.l2;
    if same_l2 {
        (sid_lambda * 1.5).min(1.0)
    } else {
        sid_lambda.min(1.0)
    }
}

/// 对标 `dpp.rs:187-215` 的保分集合重映射 (`serve`)。
///
/// 将选中子集按原精排分降序排列后，与目标下发顺序一对一拉链重映射：
/// 既实现同质簇打散重排，又严格保持下游分数单调性与分值尺度不变。
pub fn serve_remapped(
    inputs: &[DppInput],
    greedy: Vec<usize>,
    config: &DppConfig,
) -> (Vec<usize>, Vec<usize>, Vec<DppResult>) {
    let mut dpp_selected = greedy.clone();
    dpp_selected.sort_unstable_by(|&a, &b| {
        inputs[b]
            .score
            .partial_cmp(&inputs[a].score)
            .unwrap_or(Ordering::Equal)
            .then_with(|| a.cmp(&b))
    });

    let use_greedy_order = config.greedy_order || config.window.is_some();
    let order = if use_greedy_order {
        greedy
    } else {
        dpp_selected.clone()
    };

    let results: Vec<DppResult> = order
        .iter()
        .zip(&dpp_selected)
        .map(|(&orig_idx, &score_idx)| DppResult {
            pool_index: inputs[orig_idx].index,
            post_id: inputs[orig_idx].post_id.clone(),
            score: inputs[score_idx].score,
            pre_diversity_score: inputs[orig_idx].score,
        })
        .collect();

    (order, dpp_selected, results)
}
