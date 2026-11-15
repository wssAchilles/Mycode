"""V3 多源 Parquet 转换、action_mask[13] 防污染、Masked BCE 与 Zero PIT Leakage 严格检验测试。"""

from __future__ import annotations

import csv
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path

from bson import ObjectId
import numpy as np
import pyarrow.parquet as pq
import pytest

from src.contracts.actions import ACTION_INDEX_BY_NAME, NUM_PREDICTED_ACTIONS, get_dataset_action_mask
from src.data.parquet_schema import (
    V3_POSTS_CORPUS_SCHEMA,
    V3_TRAINING_SAMPLE_SCHEMA,
    validate_v3_records_pit_and_masks,
)
from src.data.pit_exporter import (
    build_prod_pit_samples_v3,
    export_mongo_pit_v3_snapshot,
    sanitize_post_text,
)
from src.data.v3_parquet_pipeline import run_v3_parquet_conversion
from src.training.contracts import compute_masked_bce_loss_numpy


def _write_csv(path: Path, headers: list[str], rows: list[list[object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(headers)
        writer.writerows(rows)


def _write_tsv(path: Path, rows: list[list[object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t")
        writer.writerows(rows)


def test_masked_bce_zeroes_gradient_and_loss_contribution_on_uncollected_heads() -> None:
    """验证当 action_mask==0 时，修改对应 head 的 logits 与 labels 对最终标量 Loss 零干扰。"""
    logits = np.array([[1.2, -0.5, 3.0, -4.0]], dtype=np.float64)
    labels = np.array([[1.0, 0.0, 0.0, 1.0]], dtype=np.float64)
    mask = np.array([[1.0, 1.0, 0.0, 0.0]], dtype=np.float64)

    loss_a = compute_masked_bce_loss_numpy(logits, labels, mask)

    # 剧烈扰动未采集的 head[2], head[3]
    logits_perturbed = np.array([[1.2, -0.5, 19.0, -25.0]], dtype=np.float64)
    labels_perturbed = np.array([[1.0, 0.0, 1.0, 0.0]], dtype=np.float64)
    loss_b = compute_masked_bce_loss_numpy(logits_perturbed, labels_perturbed, mask)
    assert loss_a == pytest.approx(loss_b, abs=1e-12)


def test_pit_exporter_pii_sanitization_cohort_tagging_and_rank_preservation(tmp_path: Path) -> None:
    """模拟线上 Mongo 集合，验证脱敏哈希、全正文提取、rank->served_position 与同帧零泄密。"""
    p1, p2, p3 = ObjectId(), ObjectId(), ObjectId()
    a1 = ObjectId()
    base_dt = datetime(2026, 4, 10, 12, 0, 0, tzinfo=timezone.utc)

    fake_posts = [
        {
            "_id": p1,
            "authorId": a1,
            "content": "Reach me at alice@example.com or 13812345678 for AI benchmarks.",
            "keywords": ["ai", "systems"],
            "media": [],
            "createdAt": base_dt - timedelta(days=1),
            "isNsfw": False,
            "deletedAt": None,
        },
        {
            "_id": p2,
            "authorId": a1,
            "content": "深度解析第三代推荐系统架构与因果序列建模方案",
            "keywords": ["recsys"],
            "media": [{"type": "video"}],
            "createdAt": base_dt - timedelta(hours=5),
            "isNsfw": False,
            "deletedAt": None,
        },
        {
            "_id": p3,
            "authorId": a1,
            "content": "Rust HNSW quantized retrieval benchmark",
            "keywords": ["rust"],
            "media": [],
            "createdAt": base_dt - timedelta(hours=2),
            "isNsfw": False,
            "deletedAt": None,
        },
    ]

    fake_actions = [
        # 用户首条点击 p1
        {"_id": ObjectId(), "userId": "real-uuid-1", "action": "click", "targetPostId": p1, "targetAuthorId": a1, "timestamp": base_dt},
        # 次条同 requestId slate：先 impression(p2 rank=0), 再 dwell(p2 7000ms), 再 impression(p3 rank=1)
        {"_id": ObjectId(), "userId": "real-uuid-1", "action": "impression", "targetPostId": p2, "targetAuthorId": a1, "rank": 0, "requestId": "req1", "inNetwork": True, "timestamp": base_dt + timedelta(minutes=5)},
        {"_id": ObjectId(), "userId": "real-uuid-1", "action": "dwell", "targetPostId": p2, "dwellTimeMs": 7200, "requestId": "req1", "timestamp": base_dt + timedelta(minutes=5, seconds=8)},
        {"_id": ObjectId(), "userId": "real-uuid-1", "action": "impression", "targetPostId": p3, "targetAuthorId": a1, "rank": 1, "requestId": "req1", "inNetwork": False, "timestamp": base_dt + timedelta(minutes=5)},
        # 应被清理的合成垃圾样本
        {"_id": ObjectId(), "userId": "interview_demo_bot", "action": "like", "targetPostId": p1, "timestamp": base_dt + timedelta(minutes=1)},
    ]

    assert "[EMAIL]" in sanitize_post_text(fake_posts[0]["content"])
    assert "[PHONE]" in sanitize_post_text(fake_posts[0]["content"])
    assert "alice@example.com" not in sanitize_post_text(fake_posts[0]["content"])

    class _Col:
        def __init__(self, docs):
            self._docs = docs

        def find(self, query, proj=None):  # noqa: ARG002
            return self._docs

    class _Db:
        def list_collection_names(self):
            return ["posts", "user_actions", "democohortmanifests"]

        def __getitem__(self, name):
            if name == "posts":
                return _Col(fake_posts)
            if name == "user_actions":
                return _Col(fake_actions)
            if name == "democohortmanifests":
                return _Col([{"userIds": ["real-uuid-1"]}])
            raise KeyError(name)

    from src.data.pit_exporter import (
        export_posts_corpus_from_mongo,
        export_raw_actions_from_mongo,
        load_demo_cohort_user_ids,
    )

    cohort = load_demo_cohort_user_ids(_Db())
    corpus, lookup = export_posts_corpus_from_mongo(_Db())
    assert len(corpus) == 3
    assert {r["language_hint"] for r in corpus} >= {"en", "zh"}

    events, skipped_syn = export_raw_actions_from_mongo(_Db(), days=0, cohort_user_ids=cohort, post_lookup=lookup)
    assert skipped_syn == 1
    assert len(events) == 4
    assert all(e["user_hash_id"].startswith("u_") and "real-uuid-1" not in e["user_hash_id"] for e in events)
    assert all(e["is_demo_cohort"] is True for e in events)

    samples, stats = build_prod_pit_samples_v3(events, post_lookup=lookup, min_history=1, val_ratio=0.0)
    assert len(samples) == 2
    p2_sample = next(s for s in samples if s["candidate_post_id"] == str(p2))
    assert p2_sample["served_position"] == 0
    assert p2_sample["dwell_mask"] == 1 and p2_sample["dwell_ms"] == pytest.approx(7200.0)
    assert p2_sample["video_quality_view_mask"] == 1 and p2_sample["video_quality_view_label"] == 1
    assert p2_sample["action_mask"] == [1] * NUM_PREDICTED_ACTIONS
    # 验证双语/混合语言识别准确区分纯中文与中英混合
    from src.data.pit_exporter import detect_language_hint

    assert detect_language_hint("深度解析 V3 推荐系统 Causal Transformer 架构") == "mixed"
    assert detect_language_hint("深度解析最新一代推荐系统架构与因果注意力机制设计细节与Transformer词元") == "zh"

    # p3 同页暴露绝不出现在 p2 的历史序列中，且 p2 只能看到分钟 0 的 p1
    assert p2_sample["history_post_ids"] == [str(p1)]

    # 回归测试：跨 requestId 异步延迟反馈交错（reqA 含延迟 dwell，期间穿插 reqB）不得触发 history_non_monotonic
    t0 = 1_780_000_000_000
    interleaved = [
        {"event_id": "e0", "user_hash_id": "u_inter", "is_demo_cohort": False, "post_id": str(p1), "author_hash": "a_1", "action": "click", "action_id": 1, "timestamp_ms": t0, "dwell_time_ms": 0.0, "served_position": 0, "request_id": "req0", "in_network": 1},
        {"event_id": "e1", "user_hash_id": "u_inter", "is_demo_cohort": False, "post_id": str(p2), "author_hash": "a_1", "action": "impression", "action_id": 0, "timestamp_ms": t0 + 1000, "dwell_time_ms": 0.0, "served_position": 0, "request_id": "reqA", "in_network": 1},
        {"event_id": "e2", "user_hash_id": "u_inter", "is_demo_cohort": False, "post_id": str(p3), "author_hash": "a_1", "action": "impression", "action_id": 0, "timestamp_ms": t0 + 3000, "dwell_time_ms": 0.0, "served_position": 0, "request_id": "reqB", "in_network": 0},
        {"event_id": "e3", "user_hash_id": "u_inter", "is_demo_cohort": False, "post_id": str(p3), "author_hash": "a_1", "action": "like", "action_id": 2, "timestamp_ms": t0 + 4000, "dwell_time_ms": 0.0, "served_position": 0, "request_id": "reqB", "in_network": 0},
        {"event_id": "e4", "user_hash_id": "u_inter", "is_demo_cohort": False, "post_id": str(p2), "author_hash": "a_1", "action": "dwell", "action_id": 8, "timestamp_ms": t0 + 8000, "dwell_time_ms": 7000.0, "served_position": 0, "request_id": "reqA", "in_network": 1},
        {"event_id": "e5", "user_hash_id": "u_inter", "is_demo_cohort": False, "post_id": str(p1), "author_hash": "a_1", "action": "impression", "action_id": 0, "timestamp_ms": t0 + 10000, "dwell_time_ms": 0.0, "served_position": 0, "request_id": "reqC", "in_network": 1},
    ]
    inter_samples, _ = build_prod_pit_samples_v3(interleaved, post_lookup=lookup, min_history=1, val_ratio=0.0)
    req_c_sample = next(s for s in inter_samples if s["action_ts_ms"] == t0 + 10000)
    assert req_c_sample["history_ts_ms"] == [t0, t0 + 4000, t0 + 8000]
    from src.data.parquet_schema import assert_valid_v3_samples_records, records_to_v3_samples_table

    assert_valid_v3_samples_records(inter_samples)
    assert records_to_v3_samples_table(inter_samples).num_rows == len(inter_samples)


def test_unified_multisource_parquet_pipeline_and_zero_leakage_circuit_breaker(tmp_path: Path) -> None:
    """端到端跑通 KuaiRand + MIND + KuaiRec + MicroLens(MMRec兜底) 转 V3 Parquet 并验证防泄露断路器。"""
    # 1. KuaiRand fixture（包含蓄意放置的 video_features_statistic_27k 陷阱文件）
    kuai_dir = tmp_path / "kuairand"
    _write_csv(
        kuai_dir / "video_features_statistic_27k_part1.csv",
        ["video_id", "play_cnt"],
        [[999, 999999]],  # 若被误读就会暴露或出错
    )
    _write_csv(
        kuai_dir / "video_features_basic_27k.csv",
        ["video_id", "author_id", "video_type", "duration_ms"],
        [[10, 501, "NORMAL", 15000], [11, 502, "NORMAL", 12000], [12, 503, "AD", 8000]],
    )
    base_ts = 1_650_000_000_000
    kr_cols = ["user_id", "video_id", "time_ms", "is_click", "is_like", "is_follow", "is_comment", "is_forward", "is_hate", "long_view", "play_time_ms", "duration_ms", "is_profile_enter", "is_rand", "tab"]
    _write_csv(
        kuai_dir / "log_standard_part1.csv",
        kr_cols,
        [
            [1, 10, base_ts + 1000, 1, 1, 0, 0, 0, 0, 1, 14000, 15000, 0, 0, 0],
            [1, 11, base_ts + 2000, 1, 0, 0, 0, 0, 0, 0, 6000, 12000, 0, 0, 1],
            [1, 12, base_ts + 2000, 0, 0, 0, 0, 0, 0, 0, 100, 8000, 0, 0, 1],  # AD skipped
            [1, 10, base_ts + 3000, 1, 0, 0, 1, 1, 0, 1, 13000, 15000, 0, 0, 1],
        ],
    )
    _write_csv(
        kuai_dir / "log_random_part1.csv",
        kr_cols,
        [[1, 11, base_ts + 5000, 0, 0, 0, 0, 0, 1, 0, 500, 12000, 0, 1, 1]],
    )

    # 2. MIND fixture
    mind_dir = tmp_path / "mind"
    _write_tsv(mind_dir / "news.tsv", [["N1", "tech", "ai", "Transformers V3", "Deep abstract"], ["N2", "news", "world", "Global Summit", ""] ])
    _write_tsv(mind_dir / "behaviors.tsv", [["1", "mu1", "11/15/2019 10:00:00 AM", "N1", "N2-1 N1-0"]])

    # 3. KuaiRec fixture
    krec_dir = tmp_path / "kuairec"
    _write_csv(krec_dir / "kuairec_caption_category.csv", ["video_id", "caption", "first_level_category_name"], [[201, "中文科普", "知识"], [202, "算法课", "科技"]])
    _write_csv(
        krec_dir / "small_matrix.csv",
        ["user_id", "video_id", "timestamp", "watch_ratio", "play_duration", "video_duration"],
        [
            [88, 201, 1_650_000_010, 1.5, 15000, 10000],
            [88, 202, 1_650_000_020, 0.8, 8000, 10000],
            [88, 201, 1_650_000_030, 0.05, 500, 10000],
        ],
    )

    # 4. MicroLens MMRec .inter 兜底格式 fixture
    mlens_dir = tmp_path / "microlens"
    mlens_dir.mkdir(parents=True)
    (mlens_dir / "microlens.inter").write_text(
        "user_id:token\titem_id:token\ttimestamp:float\n"
        "u1\ti1\t1650000001\n"
        "u1\ti2\t1650000002\n"
        "u1\ti3\t1650000003\n",
        encoding="utf-8",
    )

    out_dir = tmp_path / "v3_parquet"
    manifest = run_v3_parquet_conversion(
        output_dir=out_dir,
        kuairand_dir=kuai_dir,
        mind_dir=mind_dir,
        kuairec_dir=krec_dir,
        microlens_dir=mlens_dir,
    )
    assert manifest["zeroPitLeakageVerified"] is True
    assert manifest["sourceStats"]["microlens"]["mode"] == "mmrec_inter_fallback"
    assert manifest["sourceStats"]["kuairand"]["skipped_ads"] == 1

    train_table = pq.read_table(out_dir / "v3_samples_train.parquet")
    assert train_table.schema == V3_TRAINING_SAMPLE_SCHEMA
    posts_table = pq.read_table(out_dir / "v3_posts_corpus.parquet")
    assert posts_table.schema == V3_POSTS_CORPUS_SCHEMA

    rows = train_table.to_pylist()
    mind_rows = [r for r in rows if r["source_dataset"] == "mind"]
    mlens_rows = [r for r in rows if r["source_dataset"] == "microlens"]
    assert len(mind_rows) == 2
    assert all(r["action_mask"] == get_dataset_action_mask("mind") for r in mind_rows)
    assert all(r["dwell_mask"] == 0 for r in mind_rows)
    assert len(mlens_rows) == 1
    assert mlens_rows[0]["exposure_mask"] == 0

    eval_table = pq.read_table(out_dir / "v3_samples_eval_random.parquet").to_pylist()
    assert len(eval_table) == 1
    assert eval_table[0]["is_random_exposure"] == 1
    assert eval_table[0]["action_mask"] == get_dataset_action_mask("kuairand")

    # 校验 fail-closed 断路器：构造 1 条历史时间戳 >= action_ts_ms 的泄密记录 & mask=0 非零标签
    bad_pit = dict(rows[0])
    bad_pit["history_ts_ms"] = [bad_pit["action_ts_ms"]] * len(bad_pit["history_ts_ms"])
    ok_pit, errs_pit = validate_v3_records_pit_and_masks([bad_pit])
    assert ok_pit is False and any("pit_leakage" in e for e in errs_pit)

    bad_mask = dict(mind_rows[0])
    bad_labels = list(bad_mask["action_labels"])
    bad_labels[ACTION_INDEX_BY_NAME["quote"]] = 1  # quote 在 MIND 上 mask=0
    bad_mask["action_labels"] = bad_labels
    ok_m, errs_m = validate_v3_records_pit_and_masks([bad_mask])
    assert ok_m is False and any("masked_head_nonzero_label" in e for e in errs_m)
