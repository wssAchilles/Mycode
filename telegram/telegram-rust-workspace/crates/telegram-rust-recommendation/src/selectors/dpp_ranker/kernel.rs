use std::sync::OnceLock;

use crate::contracts::RecommendationCandidatePayload;

/// 数值稳定保护阈值。
pub const DPP_EPSILON: f64 = 1e-6;

/// V3 标准内容语义向量维度。
pub const DPP_EMBEDDING_DIM: usize = 256;

/// 六层 Semantic ID 在 256 维正交子空间中的起始偏移与维度长度（总和 = 256）。
const SID_LAYER_SLICES: [(usize, usize); 6] = [
    (0, 64),
    (64, 56),
    (120, 48),
    (168, 40),
    (208, 28),
    (236, 20),
];

/// 六层 Semantic ID 递减权重：保证越浅层（L1/L2）在余弦相似度中的主导贡献。
const SID_LAYER_WEIGHTS: [f32; 6] = [1.0, 0.75, 0.55, 0.40, 0.28, 0.20];

/// 供 DPP 核矩阵与滑窗排斥消费的紧凑候选输入。
#[derive(Debug, Clone)]
pub struct DppInput {
    /// 候选在输入切片中的原始索引位置。
    pub index: usize,
    /// 候选帖子 ID。
    pub post_id: String,
    /// 候选精排基线分数。
    pub score: f64,
    /// L2 归一化后的语义嵌入向量（当 `embedding_missing` 为 true 时为空）。
    pub embedding: Vec<f32>,
    /// 嵌入向量的 L2 范数（归一化后为 1.0；缺失时为 0.0）。
    pub norm: f64,
    /// 标记当前候选是否既无 `semantic_embedding_256d` 也无有效 `semantic_ids`。
    pub embedding_missing: bool,
    /// 是否已完成单位化（便于点积跳过额外归一化开销）。
    pub is_unit: bool,
    /// 第 1 层 Semantic ID（L1 粗粒度簇）。
    pub l1: Option<i32>,
    /// 第 2 层 Semantic ID（L2 中粒度簇）。
    pub l2: Option<i32>,
    /// 第 3 层 Semantic ID（L3 细粒度簇）。
    pub l3: Option<i32>,
}

/// 全局预计算的 6 层正交傅里叶三角基查找表，消除在线 `sin`/`cos` 调用开销。
struct SidTrigBasisTable {
    /// 每层对应不同谐波频率下的离散正交余弦与正弦基向量（按 64 维固定步长存储）。
    cos_basis: Vec<Vec<[f32; 64]>>,
    sin_basis: Vec<Vec<[f32; 64]>>,
}

static SID_TRIG_BASIS_TABLE: OnceLock<SidTrigBasisTable> = OnceLock::new();

fn trig_basis_table() -> &'static SidTrigBasisTable {
    SID_TRIG_BASIS_TABLE.get_or_init(|| {
        let mut cos_basis = Vec::with_capacity(6);
        let mut sin_basis = Vec::with_capacity(6);
        for &(_, dim_len) in &SID_LAYER_SLICES {
            let max_freq = (dim_len / 2).max(2);
            let mut layer_cos = Vec::with_capacity(max_freq);
            let mut layer_sin = Vec::with_capacity(max_freq);
            for freq in 0..max_freq {
                let mut c_row = [0.0_f32; 64];
                let mut s_row = [0.0_f32; 64];
                let scale = std::f64::consts::TAU * (freq as f64) / (dim_len as f64);
                for j in 0..dim_len {
                    let angle = scale * (j as f64);
                    c_row[j] = angle.cos() as f32;
                    s_row[j] = angle.sin() as f32;
                }
                layer_cos.push(c_row);
                layer_sin.push(s_row);
            }
            cos_basis.push(layer_cos);
            sin_basis.push(layer_sin);
        }
        SidTrigBasisTable {
            cos_basis,
            sin_basis,
        }
    })
}

/// SplitMix64 确定性哈希混合器，将 `(layer, code)` 均匀映射至正交频率与相位槽位。
#[inline]
const fn splitmix64(mut x: u64) -> u64 {
    x = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    x = (x ^ (x >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    x ^ (x >> 31)
}

/// 由 6 层 Semantic ID 通过确定性正交哈希/三角基展开生成 L2 归一化的 256 维代理向量。
///
/// 设计要点：
/// 1. 六层编码各自独占 `[0..64], [64..120], ...` 互不重叠的正交子空间，层间天然严格正交；
/// 2. 每一子空间内利用离散三角基（`cos` / `sin` 整数谐波）组合展开，不同整数频率基向量在周期上严格正交；
/// 3. 按层级递减权重加权后 L2 归一化，使同 L1/L2 前缀候选在余弦核矩阵中呈现显著正相似度，而异构 SID 候选近似正交。
pub fn sid_to_normalized_256d_proxy(codes: &[i32; 6]) -> Option<Vec<f32>> {
    let table = trig_basis_table();
    let mut vec = vec![0.0_f32; DPP_EMBEDDING_DIM];
    let mut has_valid_code = false;

    for (layer, &code) in codes.iter().enumerate() {
        if code < 0 {
            continue;
        }
        has_valid_code = true;

        let (offset, dim_len) = SID_LAYER_SLICES[layer];
        let weight = SID_LAYER_WEIGHTS[layer];
        let max_freq = (dim_len / 2).saturating_sub(1).max(1);

        let seed_a = (((layer as u64) + 1) << 32) ^ (code as u64);
        let h1 = splitmix64(seed_a);
        let h2 = splitmix64(h1 ^ 0xA24B_AED4_963E_E407);

        let freq_a = 1 + (h1 as usize % max_freq);
        let mut freq_b = 1 + (h2 as usize % max_freq);
        if max_freq > 1 && freq_b == freq_a {
            freq_b = 1 + (freq_a % max_freq);
        }

        let sign_a = if (h1 >> 63) == 0 { 1.0_f32 } else { -1.0_f32 };
        let sign_b = if (h2 >> 63) == 0 { 1.0_f32 } else { -1.0_f32 };
        let use_cos_first = ((h1 >> 16) & 1) == 0;

        let basis_a = if use_cos_first {
            &table.cos_basis[layer][freq_a]
        } else {
            &table.sin_basis[layer][freq_a]
        };
        let basis_b = if use_cos_first {
            &table.sin_basis[layer][freq_b]
        } else {
            &table.cos_basis[layer][freq_b]
        };

        let dst = &mut vec[offset..offset + dim_len];
        for j in 0..dim_len {
            dst[j] = weight * (sign_a * basis_a[j] + 0.5 * sign_b * basis_b[j]);
        }
    }

    if !has_valid_code {
        return None;
    }

    let norm = l2_norm_f32(&vec);
    if !norm.is_finite() || norm <= DPP_EPSILON {
        return None;
    }
    let inv_norm = (1.0 / norm) as f32;
    for value in &mut vec {
        *value *= inv_norm;
    }

    Some(vec)
}

/// 将连续 8 维 `f32` 向量乘加累加至独立累加器（无边界检查并利于 LLVM SIMD 向量化）。
#[inline(always)]
fn accumulate_8_f32(acc: &mut [f32; 8], a: &[f32], b: &[f32]) {
    let (Ok(a), Ok(b)) = (<&[f32; 8]>::try_from(a), <&[f32; 8]>::try_from(b)) else {
        return;
    };
    acc[0] += a[0] * b[0];
    acc[1] += a[1] * b[1];
    acc[2] += a[2] * b[2];
    acc[3] += a[3] * b[3];
    acc[4] += a[4] * b[4];
    acc[5] += a[5] * b[5];
    acc[6] += a[6] * b[6];
    acc[7] += a[7] * b[7];
}

/// 将 8 路 `f32` 独立累加器与尾部残差归约为高精度 `f64` 点积结果。
#[inline(always)]
fn reduce_8_f32_to_f64(acc: [f32; 8], tail: f32) -> f64 {
    (((acc[0] as f64 + acc[1] as f64) + (acc[2] as f64 + acc[3] as f64))
        + ((acc[4] as f64 + acc[5] as f64) + (acc[6] as f64 + acc[7] as f64)))
        + (tail as f64)
}

/// 8 路 `f32` SIMD 向量化点积，最后归约转为 `f64` 兼顾高吞吐与数值精度。
#[inline]
pub fn dot_product_f32(a: &[f32], b: &[f32]) -> f64 {
    let len = a.len().min(b.len());
    let a = &a[..len];
    let b = &b[..len];

    let mut acc = [0.0_f32; 8];
    let mut a_chunks = a.chunks_exact(8);
    let mut b_chunks = b.chunks_exact(8);
    for (ca, cb) in (&mut a_chunks).zip(&mut b_chunks) {
        accumulate_8_f32(&mut acc, ca, cb);
    }

    let mut tail = 0.0_f32;
    for (&va, &vb) in a_chunks.remainder().iter().zip(b_chunks.remainder()) {
        tail += va * vb;
    }

    reduce_8_f32_to_f64(acc, tail)
}

/// 计算 `f32` 向量的 L2 范数。
#[inline]
pub fn l2_norm_f32(v: &[f32]) -> f64 {
    dot_product_f32(v, v).max(0.0).sqrt()
}

/// 计算两个 `DppInput` 之间的余弦相似度（缺失嵌入或零范数时安全返回 0.0）。
#[inline]
pub fn cosine(a: &DppInput, b: &DppInput) -> f64 {
    if a.embedding_missing
        || b.embedding_missing
        || a.embedding.is_empty()
        || b.embedding.is_empty()
    {
        return 0.0;
    }
    if a.is_unit && b.is_unit && a.embedding.len() == b.embedding.len() {
        return dot_product_f32(&a.embedding, &b.embedding).clamp(-1.0, 1.0);
    }
    let denom = a.norm * b.norm;
    if !denom.is_finite() || denom <= DPP_EPSILON {
        return 0.0;
    }
    (dot_product_f32(&a.embedding, &b.embedding) / denom).clamp(-1.0, 1.0)
}

/// 将外部传入向量校验并转换为单位化向量；非法或零向量返回 `None`。
pub fn normalize_embedding(raw: &[f32]) -> Option<Vec<f32>> {
    if raw.is_empty() || raw.iter().any(|v| !v.is_finite()) {
        return None;
    }
    let norm = l2_norm_f32(raw);
    if !norm.is_finite() || norm <= DPP_EPSILON {
        return None;
    }
    let inv_norm = (1.0 / norm) as f32;
    Some(raw.iter().map(|&v| v * inv_norm).collect())
}

#[inline]
fn extract_sid_level(semantic_ids: Option<[i32; 6]>, level: usize) -> Option<i32> {
    semantic_ids.and_then(|codes| {
        let code = codes[level];
        (code >= 0).then_some(code)
    })
}

/// 从 `RecommendationCandidatePayload` 构建零外部存储依赖的 `DppInput`。
///
/// 特征向量解析优先级：
/// 1. 候选随路携带的 `semantic_embedding_256d`（校验有效性后 L2 归一化）；
/// 2. 缺失或无效时，若存在 `semantic_ids: Option<[i32; 6]>`，展开为确定性 256d 正交三角基代理向量；
/// 3. 均缺失时标记 `embedding_missing = true` 并以零范数兜底参与流程。
pub fn build_dpp_input_from_candidate(
    index: usize,
    candidate: &RecommendationCandidatePayload,
) -> DppInput {
    let embedding = candidate
        .semantic_embedding_256d
        .as_deref()
        .and_then(normalize_embedding)
        .or_else(|| {
            candidate
                .semantic_ids
                .as_ref()
                .and_then(sid_to_normalized_256d_proxy)
        });

    let (embedding, norm, embedding_missing, is_unit) = match embedding {
        Some(unit_vec) => (unit_vec, 1.0, false, true),
        None => (Vec::new(), 0.0, true, false),
    };

    DppInput {
        index,
        post_id: candidate.post_id.clone(),
        score: candidate.final_score(),
        embedding,
        norm,
        embedding_missing,
        is_unit,
        l1: extract_sid_level(candidate.semantic_ids, 0),
        l2: extract_sid_level(candidate.semantic_ids, 1),
        l3: extract_sid_level(candidate.semantic_ids, 2),
    }
}

/// 计算候选自身真实 `semantic_embedding_256d` 与 `semantic_ids` 代理向量之间的一致力余弦千分比。
pub fn recon_cosine_milli(candidate: &RecommendationCandidatePayload) -> Option<i32> {
    let raw = candidate.semantic_embedding_256d.as_deref()?;
    let sid = candidate.semantic_ids.as_ref()?;
    let unit_real = normalize_embedding(raw)?;
    let unit_proxy = sid_to_normalized_256d_proxy(sid)?;
    if unit_real.len() != unit_proxy.len() {
        return None;
    }
    let cos = dot_product_f32(&unit_real, &unit_proxy).clamp(-1.0, 1.0);
    Some((cos * 1000.0).round() as i32)
}

/// 为候选池（按质量降序排列）计算归一化的相对质量分比例。
pub(crate) fn normalized_quality_ratios(pool: &[&DppInput]) -> Vec<f64> {
    if pool.is_empty() {
        return Vec::new();
    }
    let top_score = pool[0].score;
    let bot_score = pool[pool.len() - 1].score;
    if bot_score >= 0.0 && top_score > DPP_EPSILON {
        pool.iter().map(|c| c.score / top_score).collect()
    } else {
        // 兼容全负分或极小分值输入：先平移再按跨度归一，确保质量因子始终单调且数值稳定。
        let span = (top_score - bot_score).max(DPP_EPSILON);
        pool.iter().map(|c| (c.score - bot_score) / span).collect()
    }
}

/// 计算按相对质量归一化的指数核质量因子 `q_i = exp(alpha * r_i)`（含可选 `seed` 末尾槽位）。
pub(crate) fn compute_quality_factors(
    pool: &[&DppInput],
    seed: Option<&DppInput>,
    theta: f64,
) -> Vec<f64> {
    let m = pool.len();
    let total = m + usize::from(seed.is_some());
    if total == 0 {
        return Vec::new();
    }

    let theta = theta.clamp(0.0, 1.0 - DPP_EPSILON);
    let alpha = theta / (2.0 * (1.0 - theta));
    let ratios = normalized_quality_ratios(pool);

    let mut qf = Vec::with_capacity(total);
    for r in ratios {
        qf.push((alpha * r).clamp(-50.0, 50.0).exp());
    }
    if seed.is_some() {
        qf.push(alpha.clamp(-50.0, 50.0).exp());
    }
    qf
}

/// 构建对标 `dpp.rs` 的对称 DPP 核矩阵：`L_ij = q_i * q_j * cos(e_i, e_j)`。
pub fn build_kernel_matrix(pool: &[&DppInput], seed: Option<&DppInput>, theta: f64) -> Vec<f64> {
    let m = pool.len();
    let total = m + usize::from(seed.is_some());
    if total == 0 {
        return Vec::new();
    }

    let qf = compute_quality_factors(pool, seed, theta);
    let item_at = |ki: usize| -> &DppInput {
        if ki < m {
            pool[ki]
        } else {
            seed.expect("seed index exists only when seed is Some")
        }
    };

    let mut kernel = vec![0.0_f64; total * total];
    for i in 0..total {
        kernel[i * total + i] = qf[i] * qf[i];
        let item_i = item_at(i);
        for j in (i + 1)..total {
            let cos = cosine(item_i, item_at(j));
            let val = qf[i] * qf[j] * cos;
            kernel[i * total + j] = val;
            kernel[j * total + i] = val;
        }
    }

    kernel
}

/// 计算指定索引子集内所有无序候选对的平均两两余弦相似度。
pub fn avg_pairwise_cosine(inputs: &[DppInput], indices: &[usize]) -> f64 {
    if indices.len() < 2 {
        return 0.0;
    }
    let mut sim_sum = 0.0_f64;
    let mut count = 0_u64;
    for i in 0..indices.len() {
        let a = &inputs[indices[i]];
        for &j_idx in &indices[(i + 1)..] {
            let b = &inputs[j_idx];
            sim_sum += cosine(a, b);
            count += 1;
        }
    }
    if count > 0 {
        sim_sum / (count as f64)
    } else {
        0.0
    }
}

/// 计算顺序序列中相邻两条候选之间的平均余弦相似度。
pub fn avg_adjacent_cosine(inputs: &[DppInput], indices: &[usize]) -> f64 {
    if indices.len() < 2 {
        return 0.0;
    }
    let sum: f64 = indices
        .windows(2)
        .map(|pair| cosine(&inputs[pair[0]], &inputs[pair[1]]))
        .sum();
    sum / ((indices.len() - 1) as f64)
}
