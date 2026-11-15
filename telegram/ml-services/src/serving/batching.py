"""在线推理动态微批器与 Deadline 超时预算保护（对标 x-algorithm launch_inference）。"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
import time
from typing import Awaitable, Callable, Generic, List, Optional, TypeVar

TReq = TypeVar("TReq")
TResp = TypeVar("TResp")


@dataclass
class DeadlineBudget:
    """单请求生命周期预算计时器，防止尾部候选过长导致整体超 P99 SLA。"""

    budget_ms: float
    started_at: float = field(default_factory=time.perf_counter)

    @property
    def elapsed_ms(self) -> float:
        return (time.perf_counter() - self.started_at) * 1000.0

    @property
    def remaining_ms(self) -> float:
        return max(0.0, float(self.budget_ms) - self.elapsed_ms)

    def is_expired(self) -> bool:
        return self.elapsed_ms >= float(self.budget_ms)


class MicroBatcher(Generic[TReq, TResp]):
    """基于异步队列的窗口微批调度器，聚合并发文本/向量编码请求以压榨 ONNX CPU 缓存。"""

    def __init__(
        self,
        handler: Callable[[List[TReq]], Awaitable[List[TResp]]],
        *,
        max_batch_size: int = 32,
        max_wait_ms: float = 4.0,
    ) -> None:
        self._handler = handler
        self._max_batch_size = max(1, int(max_batch_size))
        self._max_wait_sec = max(0.0005, float(max_wait_ms) / 1000.0)
        self._queue: asyncio.Queue[tuple[TReq, asyncio.Future[TResp]]] = asyncio.Queue()
        self._worker_task: Optional[asyncio.Task[None]] = None
        self._closed = False

    async def start(self) -> None:
        if self._worker_task is None or self._worker_task.done():
            self._closed = False
            self._worker_task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        self._closed = True
        if self._worker_task is not None:
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass
            self._worker_task = None

    async def submit(self, item: TReq) -> TResp:
        """提交单条请求并等待微批执行结果；未启动循环时直接单批回退执行。"""
        if self._worker_task is None or self._worker_task.done():
            out = await self._handler([item])
            return out[0]
        loop = asyncio.get_running_loop()
        fut: asyncio.Future[TResp] = loop.create_future()
        await self._queue.put((item, fut))
        return await fut

    async def _loop(self) -> None:
        while not self._closed:
            first_item, first_fut = await self._queue.get()
            batch_items = [first_item]
            batch_futs = [first_fut]
            deadline = time.perf_counter() + self._max_wait_sec

            while len(batch_items) < self._max_batch_size:
                timeout = deadline - time.perf_counter()
                if timeout <= 0:
                    break
                try:
                    nxt_item, nxt_fut = await asyncio.wait_for(self._queue.get(), timeout=timeout)
                    batch_items.append(nxt_item)
                    batch_futs.append(nxt_fut)
                except asyncio.TimeoutError:
                    break

            try:
                responses = await self._handler(batch_items)
                if len(responses) != len(batch_futs):
                    raise RuntimeError(
                        f"micro-batch handler count mismatch: {len(responses)} != {len(batch_futs)}"
                    )
                for fut, resp in zip(batch_futs, responses):
                    if not fut.done():
                        fut.set_result(resp)
            except Exception as exc:
                for fut in batch_futs:
                    if not fut.done():
                        fut.set_exception(exc)
