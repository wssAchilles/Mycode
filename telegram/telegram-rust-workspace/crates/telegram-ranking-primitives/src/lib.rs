//! 推荐排序原语、阶梯契约、V3 条件期望价值模型与轻量用户消偏模块。
//!
//! 遵循 Anti-Flat 领域模块化结构，同时在 crate 根路径重新导出全部历史公开符号以保障 100% 向后兼容。

pub mod breakdown_fields;
pub mod candidate_fields;
pub mod ladder;
pub mod policy_keys;
pub mod user_debias;
pub mod value_model;
pub mod weighted;

pub use breakdown_fields::*;
pub use candidate_fields::*;
pub use ladder::*;
pub use policy_keys::*;
pub use user_debias::*;
pub use value_model::*;
pub use weighted::*;
