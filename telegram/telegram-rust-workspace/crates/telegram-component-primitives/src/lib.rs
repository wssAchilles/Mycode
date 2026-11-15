//! 组件原语入口：按职责子目录组织查询/候选/过滤/打分/缓存原语。

pub mod candidate_hydrators;
pub mod filters;
pub mod hydrator;
pub mod query_hydrators;
pub mod scorers;
pub mod selectors;
pub mod side_effects;

// 保留向后兼容重导出，避免外部 crate 既有 `cached_hydrator::*` 导入路径失效
pub use hydrator as cached_hydrator;

/// 将静态组件名称切片转换为拥有所有权的字符串列表。
pub fn to_component_names(names: &[&str]) -> Vec<String> {
    names.iter().map(|name| (*name).to_string()).collect()
}
