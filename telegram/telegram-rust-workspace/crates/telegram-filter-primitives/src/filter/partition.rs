//! 泛型过滤器原地分区结果（对标 X `FilterResult::partition` + `Vec::extract_if`）。

/// 过滤器执行的泛型二分结果：`kept` 保留后续参与排序，`removed` 用于日志审计与 drop reason 聚合。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FilterResult<C> {
    pub kept: Vec<C>,
    pub removed: Vec<C>,
}

impl<C> FilterResult<C> {
    /// 基于谓词原地保留/剔除候选，保持输入相对顺序，且对每个元素严格仅调用一次谓词（零额外克隆）。
    pub fn partition(mut candidates: Vec<C>, mut keep: impl FnMut(&C) -> bool) -> Self {
        let removed = candidates
            .extract_if(.., |candidate| !keep(candidate))
            .collect();
        if candidates.is_empty() {
            candidates = Vec::new();
        }
        Self {
            kept: candidates,
            removed,
        }
    }
}
