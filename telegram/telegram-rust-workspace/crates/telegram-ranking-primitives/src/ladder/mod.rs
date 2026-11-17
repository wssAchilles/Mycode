//! 排序阶梯（Ranking Ladder）与阶段契约子模块。
//!
//! 定义推荐精排多阶段执行阶梯的规范模型、顺序校验规则以及阶段明细诊断注解。

pub mod stage_detail;
pub mod types;
pub mod validation;

#[cfg(test)]
mod detail_tests;
#[cfg(test)]
mod tests;

pub use stage_detail::*;
pub use types::*;
pub use validation::*;
