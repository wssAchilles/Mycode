//! V3 条件期望价值模型（对标 `xai-value-model`）。
//!
//! 对齐 14 真头契约、连续停留时长 `cont_dwell_time`、3 项条件期望/互关加成，
//! 并实现严格保序且可逆的分段负分压缩 `offset_score_v3` / `unoffset_score_v3`
//! 以及单层作者多样性衰减 `author_diversity_multiplier`。

pub mod scoring;
pub mod weights;

#[cfg(test)]
mod tests;

pub use scoring::*;
pub use weights::*;
