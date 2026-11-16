"""高效 NumPy->Device 微批数据切片与 CUDA 双 Stream 异步 H2D 预取器。"""

from __future__ import annotations

import queue
import threading
from typing import Any, Dict, Mapping, Optional, Tuple

import numpy as np
import torch


def slice_mapping_to_device(
    field_map: Mapping[str, np.ndarray],
    indices: np.ndarray,
    device: torch.device,
    *,
    pin_memory: bool = False,
    non_blocking: bool = False,
) -> Dict[str, torch.Tensor]:
    """按给定索引切片 NumPy 字典并搬运至目标计算设备。"""
    idx = np.asarray(indices, dtype=np.int64)
    out: Dict[str, torch.Tensor] = {}
    use_pin = bool(pin_memory and device.type == "cuda")
    for key, arr in field_map.items():
        sliced = arr[idx]
        if not sliced.flags["C_CONTIGUOUS"]:
            sliced = np.ascontiguousarray(sliced)
        tensor = torch.from_numpy(sliced)
        if use_pin:
            tensor = tensor.pin_memory()
        out[key] = tensor.to(device, non_blocking=non_blocking)
    return out


class AsyncMicroBatchPrefetcher:
    """后台线程 + CUDA 独立 Copy Stream 双缓冲预取器，消除 CPU 切片与 H2D 空等。"""

    def __init__(
        self,
        field_map: Mapping[str, np.ndarray],
        indices: np.ndarray,
        *,
        batch_size: int,
        device: torch.device,
        start_offset: int = 0,
        buffer_size: int = 2,
    ) -> None:
        self._field_map = field_map
        self._indices = np.asarray(indices, dtype=np.int64)
        self._batch_size = max(1, int(batch_size))
        self._device = device
        self._next_offset = max(0, int(start_offset))
        self._n_total = int(len(self._indices))
        self._buffer_size = max(1, int(buffer_size))

        self._use_cuda_stream = bool(device.type == "cuda" and torch.cuda.is_available())
        self._copy_stream: Optional[torch.cuda.Stream] = (
            torch.cuda.Stream(device=device) if self._use_cuda_stream else None
        )
        self._queue: "queue.Queue[Tuple[str, Any]]" = queue.Queue(maxsize=self._buffer_size)
        self._stop_event = threading.Event()
        self._closed = False
        self._thread = threading.Thread(
            target=self._worker_loop,
            name=f"v3-prefetch-{id(self):x}",
            daemon=True,
        )
        self._thread.start()

    @property
    def batch_size(self) -> int:
        return self._batch_size

    def _put_with_stop(self, item: Tuple[str, Any]) -> bool:
        """在支持快速中断的轮询中将预取元素写入队列，避免关闭时死锁。"""
        while not self._stop_event.is_set():
            try:
                self._queue.put(item, timeout=0.05)
                return True
            except queue.Full:
                continue
        return False

    def _worker_loop(self) -> None:
        try:
            offset = self._next_offset
            while offset < self._n_total and not self._stop_event.is_set():
                end = min(self._n_total, offset + self._batch_size)
                chunk_idx = self._indices[offset:end]
                if self._copy_stream is not None:
                    # 在工作线程完成 NumPy 切片与锁页内存拷贝，并用独立 CUDA Stream 发射异步 DMA H2D
                    cpu_batch: Dict[str, torch.Tensor] = {}
                    for key, arr in self._field_map.items():
                        sliced = arr[chunk_idx]
                        if not sliced.flags["C_CONTIGUOUS"]:
                            sliced = np.ascontiguousarray(sliced)
                        cpu_batch[key] = torch.from_numpy(sliced).pin_memory()

                    with torch.cuda.stream(self._copy_stream):
                        gpu_batch = {
                            k: t.to(self._device, non_blocking=True) for k, t in cpu_batch.items()
                        }
                        ev = torch.cuda.Event()
                        ev.record(self._copy_stream)
                    payload = (offset, len(chunk_idx), gpu_batch, ev)
                else:
                    cpu_batch = slice_mapping_to_device(
                        self._field_map, chunk_idx, self._device, pin_memory=False, non_blocking=False
                    )
                    payload = (offset, len(chunk_idx), cpu_batch, None)

                if not self._put_with_stop(("data", payload)):
                    return
                offset = end

            self._put_with_stop(("done", None))
        except Exception as exc:  # noqa: BLE001
            self._put_with_stop(("err", exc))

    def get_batch(self, offset: int, size: int) -> Dict[str, torch.Tensor]:
        """读取与 `[offset : offset + size]` 对齐的下一批张量；若发生 OOM 缩容偏移不匹配则透明回退同步切片。"""
        if not self._closed and offset == self._next_offset:
            expected_len = min(self._batch_size, max(0, self._n_total - offset))
            if size == expected_len:
                kind, payload = self._queue.get()
                if kind == "err":
                    raise RuntimeError(f"AsyncMicroBatchPrefetcher worker failed: {payload}") from payload
                if kind == "data":
                    q_offset, q_len, batch, ev = payload
                    if q_offset == offset and q_len == size:
                        if ev is not None:
                            cur_stream = torch.cuda.current_stream(self._device)
                            cur_stream.wait_event(ev)
                            # 向 PyTorch CUDA 分配器声明计算流生命周期，防止异步流张量显存过早复用
                            for tensor in batch.values():
                                tensor.record_stream(cur_stream)
                        self._next_offset = offset + size
                        return batch

        # 触发 OOM micro-batch 缩容或退避重试：立即关闭旧流预取器并同步切片兜底
        self.close()
        chunk_idx = self._indices[offset : min(self._n_total, offset + size)]
        return slice_mapping_to_device(self._field_map, chunk_idx, self._device, pin_memory=False, non_blocking=False)

    @staticmethod
    def fetch_or_slice(
        prefetcher: Optional["AsyncMicroBatchPrefetcher"],
        field_map: Mapping[str, np.ndarray],
        perm: np.ndarray,
        offset: int,
        cur_bs: int,
        device: torch.device,
    ) -> Dict[str, torch.Tensor]:
        """优先从预取器取批；若未启用预取则按顺序索引同步切片至设备。"""
        actual_bs = min(cur_bs, max(0, len(perm) - offset))
        if prefetcher is not None:
            return prefetcher.get_batch(offset, actual_bs)
        return slice_mapping_to_device(field_map, perm[offset : offset + actual_bs], device)

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._stop_event.set()
        while True:
            try:
                self._queue.get_nowait()
            except queue.Empty:
                break
        if self._thread.is_alive():
            self._thread.join(timeout=2.0)

    def __enter__(self) -> "AsyncMicroBatchPrefetcher":
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self.close()
