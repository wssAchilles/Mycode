"""KuaiRand -> Phoenix V2 严格 PIT 多候选 Slate 转换器的核心契约与零泄漏验证。"""

from __future__ import annotations

import csv
import json
from pathlib import Path
import pickle
import sys

_ML_SERVICES_ROOT = Path(__file__).resolve().parent.parent
if str(_ML_SERVICES_ROOT) not in sys.path:
    sys.path.insert(0, str(_ML_SERVICES_ROOT))

from recsys.contracts.actions import ACTION_TYPE_MAP, PREDICTED_ACTIONS  # noqa: E402
from recsys.data.kuairand_phoenix import (  # noqa: E402
    KuaiRandConvertConfig,
    convert_kuairand_to_phoenix_v2,
)
from recsys.training.phoenix_v2_trainer import PhoenixV2Dataset  # noqa: E402


def _write_csv(path: Path, fieldnames: list[str], rows: list[list[object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(fieldnames)
        writer.writerows(rows)


def test_kuairand_pit_conversion_no_leakage_random_split_and_dataset_ingest(tmp_path: Path) -> None:
    """
    验证 KuaiRand 转换器同时守住以下四条核心不变量：
      1. 严格因果时间序与同 slate 防串扰（同一 time_ms 下多个候选互相绝不进入彼此历史，未来不穿越过去）
      2. 自动关联 video_features_basic author_id，并过滤 AD 商业广告条目
      3. is_rand=1 随机曝光精准分流到无偏验证集，且正确保留之前标准流构造的用户因果历史
      4. 区分被动短曝光 (<3s 未点击) 与真实 dwell (>=5s / long_view)，并与 PhoenixV2Dataset 无缝兼容
    """
    raw_dir = tmp_path / "KuaiRand-27K" / "data"
    out_dir = tmp_path / "out"

    _write_csv(
        raw_dir / "video_features_basic_27k.csv",
        ["video_id", "author_id", "video_type"],
        [
            [101, 9001, "NORMAL"],
            [102, 9002, "NORMAL"],
            [103, 9003, "NORMAL"],
            [104, 9004, "NORMAL"],
            [105, 9005, "AD"],
            [106, 9006, "NORMAL"],
            [201, 9201, "NORMAL"],
        ],
    )

    cols = [
        "user_id",
        "video_id",
        "time_ms",
        "is_click",
        "is_like",
        "is_follow",
        "is_comment",
        "is_forward",
        "is_hate",
        "long_view",
        "play_time_ms",
        "duration_ms",
        "is_profile_enter",
        "is_rand",
        "tab",
    ]
    base_ts = 1_650_000_000_000

    # 用户 1 在四个递增时刻发生交互；其中 T3 有同时间戳双候选，T2 为纯 AD 应被跳过，T4 在 log_random
    _write_csv(
        raw_dir / "log_standard_4_08_to_4_21_27k_part1.csv",
        cols,
        [
            [1, 101, base_ts + 1_000, 1, 1, 0, 0, 0, 0, 1, 12000, 20000, 0, 0, 0],  # T0: like (history idx 0, in_network)
            [1, 102, base_ts + 2_000, 1, 0, 0, 0, 0, 0, 0, 3500, 15000, 0, 0, 1],   # T1: click (history idx 1)
            [1, 103, base_ts + 3_000, 0, 0, 0, 0, 0, 1, 0, 600, 10000, 0, 0, 1],    # T2: hate (history idx 2)
            # 达到 min_history=3 后，在 T3 同秒出现 104(未点击且极短播放), 105(广告), 106(comment+forward+follow)
            [1, 104, base_ts + 10_000, 0, 0, 0, 0, 0, 0, 0, 900, 30000, 0, 0, 1],
            [1, 105, base_ts + 10_000, 1, 1, 0, 0, 0, 0, 1, 9000, 10000, 0, 0, 1],
            [1, 106, base_ts + 10_000, 1, 0, 1, 1, 1, 0, 1, 15000, 20000, 0, 0, 0],
        ],
    )
    _write_csv(
        raw_dir / "log_random_4_22_to_5_08_27k.csv",
        cols,
        [
            [1, 201, base_ts + 20_000, 1, 0, 0, 0, 0, 0, 1, 8000, 12000, 0, 1, 1],
        ],
    )

    manifest = convert_kuairand_to_phoenix_v2(
        KuaiRandConvertConfig(
            kuairand_dir=raw_dir,
            output_dir=out_dir,
            max_history=32,
            min_history=3,
            max_candidates=16,
            num_buckets=4,
            chunk_size=100,
            exclude_ads=True,
        )
    )

    assert manifest["trainSlates"] == 1
    assert manifest["trainCandidates"] == 2  # 105 广告被剔除，仅剩 104 与 106
    assert manifest["valRandSlates"] == 1
    assert manifest["valRandCandidates"] == 1
    assert manifest["skippedAds"] == 1
    assert manifest["skippedColdHistory"] == 3  # T0/T1/T2 因历史长度 < 3 不入候选训练组
    assert (out_dir / "kuairand_phoenix_manifest.json").exists()

    with open(out_dir / "phoenix_v2_kuairand_train.pkl", "rb") as f:
        train_slates = pickle.load(f)
    with open(out_dir / "phoenix_v2_kuairand_val_rand.pkl", "rb") as f:
        val_rand_slates = pickle.load(f)

    t3_slate = train_slates[0]
    assert t3_slate["user_id"] == "kuairand_u_1"
    hist_pids = [h[0] for h in t3_slate["history"]]
    hist_acts = [h[2] for h in t3_slate["history"]]
    # 严格 PIT：T3 只能看见 T0/T1/T2，绝不可看见同秒 104/106 或未来 201
    assert hist_pids == ["kuairand_v_101", "kuairand_v_102", "kuairand_v_103"]
    assert hist_acts == [
        ACTION_TYPE_MAP["like"],
        ACTION_TYPE_MAP["click"],
        ACTION_TYPE_MAP["not_interested"],
    ]
    assert [h[1] for h in t3_slate["history"]] == ["kuairand_a_9001", "kuairand_a_9002", "kuairand_a_9003"]

    cand_map = {c["candidate_post_id"]: c for c in t3_slate["candidates"]}
    assert "kuairand_v_105" not in cand_map
    # 被动 900ms 未点击曝光不应被误标为 dwell=1.0
    assert cand_map["kuairand_v_104"]["labels"]["dwell"] == 0.0
    assert cand_map["kuairand_v_104"]["labels"]["click"] == 0.0
    assert cand_map["kuairand_v_104"]["in_network"] is False
    # tab=0 视为关注网内，同时具备 reply/repost/share/follow_author/dwell 多标签
    c106 = cand_map["kuairand_v_106"]
    assert c106["candidate_author_id"] == "kuairand_a_9006"
    assert c106["in_network"] is True
    assert c106["labels"]["reply"] == 1.0
    assert c106["labels"]["repost"] == 1.0
    assert c106["labels"]["share"] == 1.0
    assert c106["labels"]["follow_author"] == 1.0
    assert c106["labels"]["dwell"] == 1.0

    # 验证 log_random 样本能够看到 T3 的真实高意向行为 106
    t4_slate = val_rand_slates[0]
    assert [h[0] for h in t4_slate["history"]] == [
        "kuairand_v_101",
        "kuairand_v_102",
        "kuairand_v_103",
        "kuairand_v_106",
    ]
    assert t4_slate["candidates"][0]["candidate_post_id"] == "kuairand_v_201"
    assert t4_slate["candidates"][0]["candidate_author_id"] == "kuairand_a_9201"

    # 确认输出可以直接被 PhoenixV2Dataset 解析且 dwell_ms=900 不污染 labels["dwell"]
    ds = PhoenixV2Dataset(out_dir / "phoenix_v2_kuairand_train.pkl", max_history=32, max_candidates=16)
    assert len(ds) == 1
    assert len(ds[0]["candidates"]) == 2
    assert set(ds[0]["candidates"][0]["labels"].keys()) == set(PREDICTED_ACTIONS)
    assert ds[0]["candidates"][0]["labels"]["dwell"] == 0.0
    assert ds[0]["candidates"][1]["labels"]["dwell"] == 1.0
    saved_manifest = json.loads((out_dir / "kuairand_phoenix_manifest.json").read_text(encoding="utf-8"))
    assert saved_manifest["schema"] == "phoenix_v2_kuairand_pit_v1"


def test_kuairand_sharded_output_readable_by_phoenix_dataset(tmp_path: Path) -> None:
    """验证流式分片模式 (shard_slates=1) 产出多个 part_*.pkl.gz 且可被 PhoenixV2Dataset 直接读取。"""
    raw_dir = tmp_path / "KuaiRand-27K" / "data"
    out_dir = tmp_path / "out_sharded"

    _write_csv(
        raw_dir / "video_features_basic_27k.csv",
        ["video_id", "author_id", "video_type"],
        [[v, 8000 + v, "NORMAL"] for v in range(1, 10)],
    )
    cols = [
        "user_id",
        "video_id",
        "time_ms",
        "is_click",
        "is_like",
        "is_follow",
        "is_comment",
        "is_forward",
        "is_hate",
        "long_view",
        "play_time_ms",
        "duration_ms",
        "is_profile_enter",
        "is_rand",
        "tab",
    ]
    base_ts = 1_650_000_000_000
    rows_std = []
    rows_rand = []
    # 两位用户分别积累足够历史并产出 1 个 train slate + 1 个 eval_random slate
    for uid in (1, 2):
        rows_std.extend([
            [uid, 1, base_ts + 1_000, 1, 1, 0, 0, 0, 0, 1, 10000, 15000, 0, 0, 0],
            [uid, 2, base_ts + 2_000, 1, 0, 0, 0, 0, 0, 0, 4000, 12000, 0, 0, 1],
            [uid, 3, base_ts + 3_000, 0, 0, 0, 0, 0, 1, 0, 1000, 12000, 0, 0, 1],
            [uid, 4, base_ts + 4_000, 1, 1, 0, 0, 0, 0, 1, 12000, 15000, 0, 0, 1],
            [uid, 5, base_ts + 4_000, 0, 0, 0, 0, 0, 0, 0, 800, 15000, 0, 0, 1],
        ])
        rows_rand.append([uid, 6, base_ts + 8_000, 1, 0, 0, 0, 0, 0, 1, 9000, 12000, 0, 1, 1])

    _write_csv(raw_dir / "log_standard_4_08_to_4_21_27k_part1.csv", cols, rows_std)
    _write_csv(raw_dir / "log_random_4_22_to_5_08_27k.csv", cols, rows_rand)

    report = convert_kuairand_to_phoenix_v2(
        KuaiRandConvertConfig(
            kuairand_dir=raw_dir,
            output_dir=out_dir,
            min_history=3,
            num_buckets=2,
            shard_slates=1,
            chunk_size=4,
            user_sample_mod=1,
        )
    )
    assert report["sharded"] is True
    assert report["trainSlates"] == 2
    assert report["valRandSlates"] == 2
    train_parts = sorted((out_dir / "train").glob("part_*.pkl.gz"))
    eval_parts = sorted((out_dir / "eval_random").glob("part_*.pkl.gz"))
    assert len(train_parts) >= 2
    assert len(eval_parts) >= 2

    train_ds = PhoenixV2Dataset(out_dir / "train", max_history=32, max_candidates=16)
    eval_ds = PhoenixV2Dataset(out_dir / "eval_random", max_history=32, max_candidates=16)
    assert len(train_ds) == 2
    assert len(eval_ds) == 2
