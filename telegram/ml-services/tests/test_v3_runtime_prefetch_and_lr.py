"""验证异步双缓冲 H2D 预取器、Warmup-Cosine 学习率调度与最佳权重回滚的高杠杆回归测试。"""

from __future__ import annotations

import threading

import numpy as np
import torch
import torch.nn as nn

from src.models.phoenix_v3 import PhoenixV3Config
from src.models.two_tower_v3 import TwoTowerV3Config
from src.training.pl_derd_distill import (
    PhoenixPreparedSlates,
    _build_slates_field_map,
    distill_phoenix_v3_student,
    train_phoenix_v3_teacher,
)
from src.training.runtime import AsyncMicroBatchPrefetcher, BestStateTracker, WarmupCosineLR
from src.training.two_tower_v3_trainer import TwoTowerPreparedSplit, train_two_tower_v3


def _build_local_two_tower_split(n: int = 24, hist_len: int = 6, seed: int = 7) -> TwoTowerPreparedSplit:
    rng = np.random.default_rng(seed)
    return TwoTowerPreparedSplit(
        history_post_hashes=rng.integers(1, 200, size=(n, hist_len), dtype=np.int64),
        history_author_hashes=rng.integers(1, 50, size=(n, hist_len), dtype=np.int64),
        history_action_types=rng.integers(0, 14, size=(n, hist_len), dtype=np.int64),
        history_time_buckets=rng.integers(0, 12, size=(n, hist_len), dtype=np.int64),
        history_sids=rng.integers(1, 64, size=(n, hist_len, 6), dtype=np.int64),
        history_action_masks=np.ones((n, hist_len, 13), dtype=np.uint8),
        attention_mask=np.ones((n, hist_len), dtype=np.int64),
        pos_post_ids=[f"p_{i}" for i in range(n)],
        pos_post_hashes=rng.integers(1, 200, size=(n,), dtype=np.int64),
        pos_author_hashes=rng.integers(1, 50, size=(n,), dtype=np.int64),
        pos_sids=rng.integers(1, 64, size=(n, 6), dtype=np.int64),
        pos_in_network=rng.integers(0, 2, size=(n,), dtype=np.int64),
        pos_has_video=rng.integers(0, 2, size=(n,), dtype=np.int64),
        pos_text_emb=rng.normal(size=(n, 32)).astype(np.float32),
        pos_log_q=np.zeros((n,), dtype=np.float32),
        sample_weights=np.ones((n,), dtype=np.float32),
    )


def _build_local_slates(n: int = 12, hist_len: int = 6, cands: int = 4, seed: int = 11) -> PhoenixPreparedSlates:
    rng = np.random.default_rng(seed)
    labels = rng.integers(0, 2, size=(n, cands, 14)).astype(np.float32)
    return PhoenixPreparedSlates(
        history_post_hashes=rng.integers(1, 200, size=(n, hist_len), dtype=np.int64),
        history_author_hashes=rng.integers(1, 50, size=(n, hist_len), dtype=np.int64),
        history_action_types=rng.integers(0, 14, size=(n, hist_len), dtype=np.int64),
        history_time_buckets=rng.integers(0, 12, size=(n, hist_len), dtype=np.int64),
        history_sids=rng.integers(1, 64, size=(n, hist_len, 6), dtype=np.int64),
        history_action_masks=np.ones((n, hist_len, 13), dtype=np.float32),
        history_mask=np.ones((n, hist_len), dtype=np.int64),
        cand_post_hashes=rng.integers(1, 200, size=(n, cands), dtype=np.int64),
        cand_author_hashes=rng.integers(1, 50, size=(n, cands), dtype=np.int64),
        cand_sids=rng.integers(1, 64, size=(n, cands, 6), dtype=np.int64),
        cand_in_network=rng.integers(0, 2, size=(n, cands), dtype=np.int64),
        cand_has_video=rng.integers(0, 2, size=(n, cands), dtype=np.int64),
        cand_served_position=np.tile(np.arange(cands, dtype=np.int64), (n, 1)),
        cand_mask=np.ones((n, cands), dtype=np.int64),
        labels_14=labels,
        mask_14=np.ones((n, cands, 14), dtype=np.float32),
        dwell_buckets=rng.integers(0, 30, size=(n, cands), dtype=np.int64),
        dwell_mask=np.ones((n, cands), dtype=np.float32),
        relevance_scores=labels[..., :3].sum(axis=-1).astype(np.float32),
        is_random_exposure=rng.integers(0, 2, size=(n, cands), dtype=np.uint8),
        user_hash_ids=[f"u_{i}" for i in range(n)],
        cand_post_ids=[[f"p_{i}_{j}" for j in range(cands)] for i in range(n)],
    )


def test_async_prefetcher_parity_and_oom_fallback() -> None:
    """校验异步预取张量与原始切片逐元素一致，且触发尺寸缩容回退时不死锁不泄线程。"""
    rng = np.random.default_rng(123)
    fields = {
        "x_int": rng.integers(0, 500, size=(23, 8), dtype=np.int64),
        "x_fp": rng.normal(size=(23, 4)).astype(np.float32),
    }
    perm = rng.permutation(23)
    device = torch.device("cpu")

    baseline_threads = threading.active_count()
    seen_chunks = []
    with AsyncMicroBatchPrefetcher(fields, perm, batch_size=6, device=device, buffer_size=2) as prefetcher:
        offset = 0
        while offset < 23:
            if offset == 12:
                # 模拟 OOM 缩容回退：请求的 micro-batch 大小突变，必须安全退回同步切片
                batch = AsyncMicroBatchPrefetcher.fetch_or_slice(prefetcher, fields, perm, offset, 3, device)
                step = 3
            else:
                step = min(6, 23 - offset)
                batch = AsyncMicroBatchPrefetcher.fetch_or_slice(prefetcher, fields, perm, offset, step, device)
            idx = perm[offset : offset + step]
            assert torch.equal(batch["x_int"], torch.from_numpy(fields["x_int"][idx]))
            assert torch.allclose(batch["x_fp"], torch.from_numpy(fields["x_fp"][idx]))
            seen_chunks.append(idx)
            offset += step

    covered = np.concatenate(seen_chunks)
    assert np.array_equal(covered, perm)
    assert threading.active_count() <= baseline_threads + 1


def test_warmup_cosine_lr_and_best_state_tracker() -> None:
    """校验多参数组比例缩放与 BestStateTracker 权重精确还原。"""
    m = nn.Sequential(nn.Linear(4, 4), nn.Linear(4, 2))
    opt = torch.optim.AdamW(
        [
            {"params": list(m[0].parameters()), "lr": 1e-3},
            {"params": list(m[1].parameters()), "lr": 8e-3},
        ]
    )
    sched = WarmupCosineLR(opt, total_steps=10, warmup_ratio=0.2, min_lr_ratio=0.1)
    lr_step0 = sched.step(0)
    assert abs(lr_step0 - 5e-4) < 1e-8
    assert abs(opt.param_groups[1]["lr"] - 4e-3) < 1e-8

    lr_peak = sched.step(1)
    assert abs(lr_peak - 1e-3) < 1e-8
    lr_end = sched.step(10)
    assert abs(lr_end - 1e-4) < 1e-8
    assert abs(opt.param_groups[1]["lr"] - 8e-4) < 1e-8

    tracker = BestStateTracker()
    with torch.no_grad():
        m[0].weight.fill_(2.5)
    tracker.update(m, metric=0.81, epoch=3, is_best=True)

    # 模拟后续 Epoch 参数被震荡破坏
    with torch.no_grad():
        m[0].weight.fill_(-9.0)
    tracker.update(m, metric=0.65, epoch=4, is_best=False)

    assert tracker.restore(m) is True
    assert tracker.best_epoch == 3
    assert torch.allclose(m[0].weight, torch.full_like(m[0].weight, 2.5))


def test_trainers_with_cosine_lr_prefetch_and_restore_best() -> None:
    """端到端校验 TwoTower 与 Phoenix Teacher/Student 启用 cosine + best 回滚的稳定性。"""
    tt_split = _build_local_two_tower_split(24, seed=7)
    tt_val = _build_local_two_tower_split(12, seed=8)
    corpus = [
        {"post_id": f"p_{i}", "author_id": f"a_{i % 5}", "text": f"topic {i}", "in_network": i % 2 == 0, "has_video": False}
        for i in range(16)
    ]
    tt_cfg = TwoTowerV3Config(hidden_dim=32, embedding_dim=32, num_layers=1, num_heads=4, num_kv_heads=2, max_history_len=6)

    tt_model, tt_sum = train_two_tower_v3(
        tt_split,
        val_split=tt_val,
        corpus_posts=corpus,
        config=tt_cfg,
        epochs=3,
        batch_size=8,
        lr=1e-3,
        lr_schedule="cosine",
        restore_best_state=True,
        ema_decay=0.95,
        use_async_prefetch=True,
        device="cpu",
    )
    assert tt_model is not None
    assert len(tt_sum["history"]) == 3
    assert 1 <= int(tt_sum["best_epoch"]) <= 3
    assert float(tt_sum["history"][-1]["lr"]) < 1e-3

    tr_slates = _build_local_slates(12, seed=11)
    va_slates = _build_local_slates(6, seed=12)
    assert len(_build_slates_field_map(tr_slates)) == 19

    t_cfg = PhoenixV3Config(dim=32, num_layers=2, num_cand_only_layers=1, num_heads=4, num_kv_heads=2)
    teacher, t_sum = train_phoenix_v3_teacher(
        tr_slates,
        val_slates=va_slates,
        config=t_cfg,
        epochs=3,
        batch_size=4,
        lr_schedule="cosine",
        restore_best_state=True,
        use_async_prefetch=True,
        device="cpu",
    )
    assert 1 <= int(t_sum["best_epoch"]) <= 3

    student, s_sum = distill_phoenix_v3_student(
        tr_slates,
        teacher_model=teacher,
        val_slates=va_slates,
        student_config=t_cfg,
        epochs=2,
        batch_size=4,
        lr_schedule="cosine",
        restore_best_state=True,
        use_async_prefetch=True,
        device="cpu",
    )
    assert student is not None
    assert 1 <= int(s_sum["best_epoch"]) <= 2
