//! 6x256 Semantic ID 位打包与前缀区间编解码原语。

/// Semantic ID 的量化层级数。
pub const SID_LEVELS: usize = 6;
/// 每层量化码词占用的比特数。
const BITS_PER_LEVEL: usize = 8;
/// 单层合法码词上限（含）。
pub const SID_MAX_CODE: i32 = 255;
/// 低 48 位有效掩码。
pub(super) const FULL_48_MASK: u64 = (1u64 << (SID_LEVELS * BITS_PER_LEVEL)) - 1;

/// 解析后的种子键及有效前缀深度。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SeedKey {
    pub key: u64,
    pub valid_depth: usize,
}

/// 判断单级 Semantic ID 码词是否处于合法范围 `[0, 255]`。
pub fn is_valid_sid_code(code: i32) -> bool {
    (0..=SID_MAX_CODE).contains(&code)
}

/// 将完整 6 级 Semantic ID（每级 `0..=255`）无损打包入 `u64` 低 48 位（第 0 级位于最高字节）。
pub fn pack_full_key(codes: &[i32; SID_LEVELS]) -> Option<u64> {
    if !codes.iter().all(|&code| is_valid_sid_code(code)) {
        return None;
    }
    Some(
        codes
            .iter()
            .fold(0u64, |acc, &code| (acc << BITS_PER_LEVEL) | (code as u64)),
    )
}

/// 从任意前缀长度的码词切片提取 `SeedKey`，返回最长连续有效前置层级数。
pub fn seed_key(codes: &[i32]) -> Option<SeedKey> {
    let valid_depth = codes
        .iter()
        .take(SID_LEVELS)
        .take_while(|&&code| is_valid_sid_code(code))
        .count();
    if valid_depth == 0 {
        return None;
    }
    let key = (0..SID_LEVELS).fold(0u64, |acc, level| {
        let code = if level < valid_depth {
            codes[level] as u64
        } else {
            0
        };
        (acc << BITS_PER_LEVEL) | code
    });
    Some(SeedKey { key, valid_depth })
}

/// 将 `u64` 低 48 位压缩键反向解包为 6 级 Semantic ID 数组。
pub fn codes_from_key(key: u64) -> [i32; SID_LEVELS] {
    let mut out = [0i32; SID_LEVELS];
    for (level, slot) in out.iter_mut().enumerate() {
        let shift = BITS_PER_LEVEL * (SID_LEVELS - 1 - level);
        *slot = ((key >> shift) & (SID_MAX_CODE as u64)) as i32;
    }
    out
}

/// 计算给定前缀深度 `depth`（钳位至 `0..=6`）在 48 位空间内的半开键区间 `[lo, hi)`。
pub fn prefix_range(key: u64, depth: usize) -> (u64, u64) {
    let clamped_depth = depth.min(SID_LEVELS);
    let shift = BITS_PER_LEVEL * (SID_LEVELS - clamped_depth);
    let masked = key & FULL_48_MASK;
    let lo = (masked >> shift) << shift;
    let hi = lo + (1u64 << shift);
    (lo, hi)
}
