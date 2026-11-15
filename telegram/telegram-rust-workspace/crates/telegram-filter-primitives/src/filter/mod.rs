//! 过滤器模块入口，提供泛型原地切分原语与向后兼容 Trait 管线执行器。

pub mod partition;
pub mod pipeline;
pub mod traits;

#[cfg(test)]
mod tests;

pub use partition::FilterResult;
pub use pipeline::{FnFilter, run_filter_pipeline};
pub use traits::{
    FilterCandidate, FilterExecutionRecord, FilterOutcome, FilterQuery, PipelineFilter,
    PipelineFilterResult,
};
