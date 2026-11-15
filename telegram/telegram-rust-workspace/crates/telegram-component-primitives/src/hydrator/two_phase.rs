//! 两阶段水合器原语（先无阻塞抓取只读 Snapshot，后可变应用合并，对标 X `TwoPhaseHydrator`）。

use std::any::Any;

use super::traits::{Hydrator, HydratorOutput, checked_len};

/// 将网络/缓存 I/O (`fetch`) 与候选原地修改 (`apply`) 解耦的两阶段水合器。
#[async_trait::async_trait]
pub trait TwoPhaseHydrator<Q, C>: Any + Send + Sync
where
    Q: Send + Sync + 'static,
    C: Clone + Send + Sync + 'static,
{
    /// `fetch` 阶段产出的强类型抓取载荷（必须支持跨异步任务传递）。
    type Fetched: Send + 'static;

    /// 水合器名称。
    fn name(&self) -> &str;

    /// 判断当前请求是否启用此两阶段水合器。
    fn enable(&self, _query: &Q) -> bool {
        true
    }

    /// 第一阶段：只读抓取候选所需的外部特征或索引负载。
    async fn fetch(&self, query: &Q, candidates: &[C]) -> Result<Self::Fetched, String>;

    /// 第二阶段：将抓取载荷原地应用到可变候选切片上。
    fn apply(&self, query: &Q, candidates: &mut [C], fetched: Self::Fetched);

    /// 当通过兼容路径执行单个候选更新时的合并逻辑。
    fn merge(&self, candidate: &mut C, hydrated: C);

    /// 兼容传统 `Hydrator::hydrate` 接口：抓取临时克隆副本并返回全量结果。
    async fn legacy_hydrate(&self, query: &Q, candidates: &[C]) -> Vec<Result<C, String>> {
        match self.fetch(query, candidates).await {
            Ok(fetched) => {
                let mut hydrated = candidates.to_vec();
                self.apply(query, &mut hydrated, fetched);
                checked_len(hydrated.into_iter().map(Ok).collect(), candidates.len())
            }
            Err(err) => vec![Err(err); candidates.len()],
        }
    }
}

/// 任何 `TwoPhaseHydrator` 自动满足通用 `Hydrator` trait，支持直接并入混合管线执行。
#[async_trait::async_trait]
impl<Q, C, T> Hydrator<Q, C> for T
where
    Q: Send + Sync + 'static,
    C: Clone + Send + Sync + 'static,
    T: TwoPhaseHydrator<Q, C>,
{
    fn name(&self) -> &str {
        TwoPhaseHydrator::name(self)
    }

    fn enable(&self, query: &Q) -> bool {
        TwoPhaseHydrator::enable(self, query)
    }

    async fn hydrate(&self, query: &Q, candidates: &[C]) -> Vec<Result<C, String>> {
        self.legacy_hydrate(query, candidates).await
    }

    fn update(&self, candidate: &mut C, hydrated: C) {
        TwoPhaseHydrator::merge(self, candidate, hydrated);
    }

    async fn fetch_output(&self, query: &Q, candidates: &[C]) -> HydratorOutput {
        HydratorOutput(Box::new(self.fetch(query, candidates).await))
    }

    fn apply_output(&self, query: &Q, candidates: &mut [C], output: HydratorOutput) {
        if let Ok(fetched) = output.0.downcast::<Result<T::Fetched, String>>()
            && let Ok(fetched) = *fetched
        {
            TwoPhaseHydrator::apply(self, query, candidates, fetched);
        }
    }
}
