"""推荐系统产物清单、SHA-256 校验及 GCS 同步路径规划。"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Tuple


def compute_file_sha256(path: Path, chunk_size: int = 1024 * 1024) -> str:
    """计算本地产物文件的 SHA-256 十六进制摘要。"""
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _file_size(path: Path) -> int:
    return int(path.stat().st_size) if path.exists() else 0


def build_serving_manifest(
    *,
    version: str,
    profile: str,
    faiss_index_type: str,
    models_dir: Path,
    data_dir: Path,
    embedding_dim: int = 256,
    id_namespace: str = "",
    embedding_space: str = "",
    model_version: str = "",
    include_checksums: bool = True,
) -> Dict[str, Any]:
    """生成带大小、SHA-256 校验和与向量空间元数据的 serving_manifest.json。"""
    artifact_paths: Dict[str, Path] = {
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

    files: Dict[str, int] = {}
    checksums: Dict[str, str] = {}
    for key, path in artifact_paths.items():
        size = _file_size(path)
        files[key] = size
        if include_checksums and size > 0 and path.exists():
            checksums[key] = compute_file_sha256(path)

    manifest: Dict[str, Any] = {
        "schemaVersion": 2,
        "version": version,
        "profile": profile,
        "faissIndexType": faiss_index_type,
        "embeddingDim": int(embedding_dim),
        "indexVersion": f"{faiss_index_type}:{version}",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "files": files,
        "checksums": checksums,
    }
    if id_namespace:
        manifest["idNamespace"] = id_namespace
    if embedding_space:
        manifest["embeddingSpace"] = embedding_space
    if model_version:
        manifest["modelVersion"] = model_version
    return manifest


def load_serving_manifest(manifest_path: Path) -> Optional[Dict[str, Any]]:
    """安全加载本地 serving_manifest.json，损坏或不存在则返回 None。"""
    if not manifest_path.exists():
        return None
    try:
        parsed = json.loads(manifest_path.read_text(encoding="utf-8"))
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


def verify_manifest_checksums(
    manifest: Mapping[str, Any],
    artifact_paths: Mapping[str, Path],
    strict: bool = False,
) -> Tuple[bool, List[str]]:
    """
    校验本地产物文件与 serving_manifest.json 中声明的 SHA-256 是否一致。
    若 strict=True，缺少校验和或文件缺失同样判为失败（fail-closed）。
    """
    errors: List[str] = []
    checksums = manifest.get("checksums")
    if not isinstance(checksums, Mapping):
        if strict:
            return False, ["manifest_missing_checksums"]
        return True, []

    for name, path in artifact_paths.items():
        expected = checksums.get(name)
        if not expected:
            if strict and path.exists():
                errors.append(f"missing_checksum:{name}")
            continue
        if not path.exists():
            if strict:
                errors.append(f"missing_artifact:{name}")
            continue
        actual = compute_file_sha256(path)
        if actual != str(expected):
            errors.append(f"checksum_mismatch:{name}:expected={expected}:actual={actual}")

    return len(errors) == 0, errors


def artifact_file_plan(
    component: str,
    *,
    models_dir: Path,
    data_dir: Path,
    faiss_index_type: str = "ivf_pq",
    artifact_profile: str = "serving-lite",
    load_item_embedding_fallback: bool = False,
) -> Tuple[List[Tuple[str, Path]], List[Tuple[str, Path]]]:
    """返回指定运行组件的必需和可选 GCS 产物同步清单。"""
    normalized = (component or "full").strip().lower()
    base_required = [
        ("artifacts/{version}/two_tower/model.pt", models_dir / "two_tower_epoch_latest.pt"),
        ("artifacts/{version}/data/news_vocab.pkl", data_dir / "news_vocab.pkl"),
        ("artifacts/{version}/data/user_vocab.pkl", data_dir / "user_vocab.pkl"),
    ]
    faiss_required = [
        (f"artifacts/{{version}}/faiss/faiss_{faiss_index_type}.index", models_dir / f"faiss_{faiss_index_type}.index"),
        ("artifacts/{version}/faiss/faiss_id_mapping.pkl", models_dir / "faiss_id_mapping.pkl"),
    ]
    phoenix_required = [
        ("artifacts/{version}/phoenix/model.pt", models_dir / "phoenix_epoch_latest.pt"),
    ]
    phoenix_v2_required = [
        ("artifacts/{version}/phoenix_v2/model.pt", models_dir / "phoenix_v2_inference.pt"),
        ("artifacts/{version}/phoenix_v2/config.json", models_dir / "phoenix_v2_config.json"),
    ]
    corpus_required = [
        ("artifacts/{version}/data/news_dict.pkl", data_dir / "news_dict.pkl"),
    ]
    sidecars_optional = [
        ("artifacts/{version}/calibration/weighted_calibrator.json", models_dir / "weighted_calibrator.json"),
        ("artifacts/{version}/realgraph/gbt_model.json", models_dir / "realgraph_gbt.json"),
        ("artifacts/{version}/social_phoenix/linear_model.json", models_dir / "social_phoenix_linear.json"),
    ]
    manifests_optional = [
        ("artifacts/{version}/manifest/preprocess_manifest.json", data_dir / "preprocess_manifest.json"),
        ("artifacts/{version}/manifest/serving_manifest.json", data_dir / "serving_manifest.json"),
    ]

    if normalized == "two_tower":
        return base_required, manifests_optional
    if normalized == "phoenix":
        if artifact_profile == "phoenix-v2":
            return base_required + phoenix_v2_required, manifests_optional + sidecars_optional
        return base_required + phoenix_required, manifests_optional + sidecars_optional
    if normalized == "phoenix_v2":
        return base_required + phoenix_v2_required, manifests_optional + sidecars_optional
    if normalized == "retrieval":
        return base_required + faiss_required, manifests_optional
    if normalized == "corpus":
        return corpus_required, manifests_optional

    optional = manifests_optional + corpus_required + sidecars_optional
    if load_item_embedding_fallback:
        optional.append(("artifacts/{version}/data/item_embeddings.npy", data_dir / "item_embeddings.npy"))

    if artifact_profile == "serving-lite":
        # serving-lite 模式保持轻量：不强制下载排序模型与全量 item_embeddings
        return base_required + faiss_required, optional

    if artifact_profile == "phoenix-v2":
        return base_required + phoenix_v2_required + faiss_required, optional

    return base_required + phoenix_required + faiss_required, optional
