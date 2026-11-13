"""Colab 产物发布门禁（Fail-Closed）：校验预训练隔离、SHA-256 完整性、FAISS 索引、延迟与侧车契约。"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Tuple

from recsys.colab.profiles import COLAB_PROFILES
from recsys.contracts.artifacts import load_serving_manifest, verify_manifest_checksums
from recsys.training.calibration_and_sidecars import validate_social_phoenix_linear_artifact


def _check_nonempty_files(paths: Mapping[str, Path], reasons: List[str]) -> None:
    for label, path in paths.items():
        if not path.exists() or path.stat().st_size == 0:
            reasons.append(f"missing_or_empty:{label}")


def evaluate_promotion_gate(
    *,
    profile_name: str,
    models_dir: Path,
    data_dir: Path,
    train_report: Optional[Mapping[str, Any]] = None,
    max_cpu_p95_ms: float = 120.0,
    max_unit_norm_error: float = 1e-3,
    faiss_index_type: str = "ivf_pq",
    allow_pretrain_only: bool = False,
    manifest_filename: str = "serving_manifest.json",
    require_serving_base: bool = False,
) -> Tuple[bool, List[str], Dict[str, Any]]:
    """
    产物发布门禁（Fail-Closed）：
      - 阻断 pretrain_only 权重进入线上 serving 发布路径
      - 强校验 manifest SHA-256、CPU 推理 P95 延迟、Two-Tower+FAISS 完整度与侧车结构契约
    """
    profile = COLAB_PROFILES.get(profile_name)
    if profile is None:
        return False, [f"unknown_profile:{profile_name}"], {}

    reasons: List[str] = []
    details: Dict[str, Any] = {
        "profile": profile_name,
        "checkpointRole": (train_report or {}).get("checkpointRole", profile.checkpoint_role),
    }
    models_dir = Path(models_dir)
    data_dir = Path(data_dir)

    report_role = str((train_report or {}).get("checkpointRole") or profile.checkpoint_role)
    if not allow_pretrain_only and (profile.checkpoint_role == "pretrain_only" or report_role == "pretrain_only"):
        reasons.append("pretrain_only_checkpoint_not_for_serving")

    if profile.task == "kuairand-prep":
        prep_root = data_dir / "kuairand_phoenix"
        train_dir = prep_root / "train"
        eval_dir = prep_root / "eval_random"
        has_train = train_dir.exists() and any(train_dir.glob("*.pkl*"))
        has_eval = eval_dir.exists() and any(eval_dir.glob("*.pkl*"))
        if not has_train:
            reasons.append("missing_kuairand_train_shards")
        if not has_eval:
            reasons.append("missing_kuairand_eval_random_shards")
        return len(reasons) == 0, reasons, details

    manifest = load_serving_manifest(data_dir / manifest_filename)
    if manifest is None:
        if manifest_filename == "serving_manifest.json":
            reasons.append("missing_serving_manifest")
        else:
            reasons.append(f"missing_manifest:{manifest_filename}")
    else:
        artifact_paths = {
            "twoTowerModel": models_dir / "two_tower_epoch_latest.pt",
            "phoenixModel": models_dir / "phoenix_epoch_latest.pt",
            "phoenixV2Model": models_dir / "phoenix_v2_inference.pt",
            "phoenixV2Config": models_dir / "phoenix_v2_config.json",
            "faissIndex": models_dir / f"faiss_{faiss_index_type}.index",
            "faissIdMapping": models_dir / "faiss_id_mapping.pkl",
            "newsVocab": data_dir / "news_vocab.pkl",
            "userVocab": data_dir / "user_vocab.pkl",
            "itemEmbeddings": data_dir / "item_embeddings.npy",
            "newsDict": data_dir / "news_dict.pkl",
            "weightedCalibrator": models_dir / "weighted_calibrator.json",
            "realGraphGbt": models_dir / "realgraph_gbt.json",
            "socialPhoenixLinear": models_dir / "social_phoenix_linear.json",
        }
        present_subset = {k: p for k, p in artifact_paths.items() if p.exists()}
        ok_sha, sha_errors = verify_manifest_checksums(manifest, present_subset, strict=True)
        if not ok_sha:
            reasons.extend(sha_errors)

    if profile.task in ("smoke", "phoenix-v2", "phoenix-v2-pretrain", "phoenix-v2-finetune"):
        _check_nonempty_files(
            {
                "phoenix_v2_inference.pt": models_dir / "phoenix_v2_inference.pt",
                "phoenix_v2_config.json": models_dir / "phoenix_v2_config.json",
            },
            reasons,
        )
        if train_report:
            bench = train_report.get("cpuBenchmark") or {}
            fp32_p95 = bench.get("cpuFp32P95Ms")
            details["cpuFp32P95Ms"] = fp32_p95
            if fp32_p95 is not None and float(fp32_p95) > float(max_cpu_p95_ms):
                reasons.append(f"cpu_p95_latency_exceeded:{fp32_p95}>{max_cpu_p95_ms}")
            for ep in train_report.get("epochs") or []:
                loss_val = ep.get("trainLoss")
                if loss_val is None or not math.isfinite(float(loss_val)):
                    reasons.append("non_finite_train_loss")
                    break
        if profile.task == "phoenix-v2-finetune" and require_serving_base:
            _check_nonempty_files(
                {
                    "two_tower_epoch_latest.pt": models_dir / "two_tower_epoch_latest.pt",
                    f"faiss_{faiss_index_type}.index": models_dir / f"faiss_{faiss_index_type}.index",
                    "faiss_id_mapping.pkl": models_dir / "faiss_id_mapping.pkl",
                    "news_vocab.pkl": data_dir / "news_vocab.pkl",
                    "user_vocab.pkl": data_dir / "user_vocab.pkl",
                },
                reasons,
            )

    if profile.task == "two-tower":
        _check_nonempty_files(
            {
                "two_tower_epoch_latest.pt": models_dir / "two_tower_epoch_latest.pt",
                "item_embeddings.npy": data_dir / "item_embeddings.npy",
                "news_vocab.pkl": data_dir / "news_vocab.pkl",
                "user_vocab.pkl": data_dir / "user_vocab.pkl",
                f"faiss_{faiss_index_type}.index": models_dir / f"faiss_{faiss_index_type}.index",
                "faiss_id_mapping.pkl": models_dir / "faiss_id_mapping.pkl",
            },
            reasons,
        )
        if train_report:
            norm_err = train_report.get("maxUnitNormError")
            details["maxUnitNormError"] = norm_err
            if norm_err is not None and float(norm_err) > float(max_unit_norm_error):
                reasons.append(f"item_norm_error_exceeded:{norm_err}>{max_unit_norm_error}")

    social_path = models_dir / "social_phoenix_linear.json"
    if social_path.exists():
        try:
            social_obj = json.loads(social_path.read_text(encoding="utf-8"))
            ok_social, social_errs = validate_social_phoenix_linear_artifact(social_obj)
            if not ok_social:
                reasons.extend(social_errs)
        except Exception as exc:
            reasons.append(f"invalid_social_phoenix_json:{exc}")
    elif profile.task == "sidecars":
        reasons.append("missing_social_phoenix_linear")

    if profile.task == "sidecars":
        _check_nonempty_files(
            {
                "realgraph_gbt.json": models_dir / "realgraph_gbt.json",
                "weighted_calibrator.json": models_dir / "weighted_calibrator.json",
            },
            reasons,
        )

    return len(reasons) == 0, reasons, details
