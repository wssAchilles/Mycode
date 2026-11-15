//! 候选 Hydrator 基础 trait 与执行输出封装。

use std::any::Any;

/// 两阶段水合器的类型擦除输出容器（对应 X 的 HydratorOutput）。
pub struct HydratorOutput(pub Box<dyn Any + Send>);

/// 基础 Hydrator trait，所有水合器的统一根接口。
#[async_trait::async_trait]
pub trait Hydrator<Q, C>: Any + Send + Sync
where
    Q: Send + Sync + 'static,
    C: Clone + Send + Sync + 'static,
{
    /// 水合器名称（用于遥测与阶段明细记录）。
    fn name(&self) -> &str;

    /// 是否对当前请求启用（默认开启）。
    fn enable(&self, _query: &Q) -> bool {
        true
    }

    /// 批量水合候选列表，返回与输入等长的结果序列。
    async fn hydrate(&self, query: &Q, candidates: &[C]) -> Vec<Result<C, String>>;

    /// 将水合结果字段合并回原候选对象（默认整体替换）。
    fn update(&self, candidate: &mut C, hydrated: C) {
        *candidate = hydrated;
    }

    /// 按位置逐个将水合成功的结果合并回原候选切片。
    fn update_all(&self, candidates: &mut [C], hydrated: Vec<Result<C, String>>) {
        for (candidate, result) in candidates.iter_mut().zip(hydrated) {
            if let Ok(h) = result {
                self.update(candidate, h);
            }
        }
    }

    /// 获取可异步暂存的输出负载，默认包装传统逐候选水合结果。
    async fn fetch_output(&self, query: &Q, candidates: &[C]) -> HydratorOutput {
        HydratorOutput(Box::new(self.hydrate(query, candidates).await))
    }

    /// 将暂存输出应用回候选列表（默认拆箱并调用 update_all）。
    fn apply_output(&self, _query: &Q, candidates: &mut [C], output: HydratorOutput) {
        if let Ok(hydrated) = output.0.downcast::<Vec<Result<C, String>>>() {
            self.update_all(candidates, *hydrated);
        }
    }
}

/// 校验水合器返回长度与输入候选长度一致；不一致时 fail-closed 返回等长错误集。
pub fn checked_len<C: Clone>(
    hydrated: Vec<Result<C, String>>,
    expected: usize,
) -> Vec<Result<C, String>> {
    if hydrated.len() == expected {
        return hydrated;
    }
    let message = format!(
        "Hydrator length_mismatch expected={} got={}",
        expected,
        hydrated.len()
    );
    vec![Err(message); expected]
}
