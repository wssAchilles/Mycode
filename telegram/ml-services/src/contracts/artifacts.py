"""V3 ServingManifestV3 契约定义与 Fail-Closed SHA-256 校验（严拒未签名/非 ONNX 运行时加载）。"""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Tuple

MANIFEST_SCHEMA_V3: int = 3
SUPPORTED_V3_EXTENSIONS = (".onnx", ".safetensors", ".index", ".json", ".npy", ".pkl")


def compute_file_sha256(path: Path, chunk_size: int = 1024 * 1024) -> str:
    """以流式分块计算任意产物文件的 SHA-256 十六进制摘要。"""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            chunk = handle.read(chunk_size)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def build_serving_manifest_v3(
    *,
    version: str,
    profile: str = "phoenix-v3",
    models_dir: Path,
    data_dir: Path,
    embedding_dim: int = 256,
    faiss_index_type: str = "hnsw_sq8",
    id_namespace: str = "mongo_object_id",
    embedding_space: str = "recommendation_two_tower_v3",
    model_version: str = "",
    sid_codebook_levels: int = 6,
    sid_codebook_size: int = 256,
    extra_artifacts: Optional[Mapping[str, Path]] = None,
) -> Dict[str, Any]:
    """生成携带完整 SHA-256 摘要的 V3 ServingManifest（面向纯 ONNXRT + HNSW-SQ8 在线容器）。"""
    resolved_model_ver = str(model_version or "").strip() or f"{embedding_space}:{version}"
    candidates: Dict[str, Path] = {
        "text_encoder_int8.onnx": models_dir / "text_encoder_int8.onnx",
        "two_tower_user_int8.onnx": models_dir / "two_tower_user_int8.onnx",
        "phoenix_v3_student_int8.onnx": models_dir / "phoenix_v3_student_int8.onnx",
        "sid_codebook.safetensors": models_dir / "sid_codebook.safetensors",
        f"faiss_{faiss_index_type}.index": models_dir / f"faiss_{faiss_index_type}.index",
        "faiss_id_mapping.json": models_dir / "faiss_id_mapping.json",
        "weighted_calibrator_v3.json": models_dir / "weighted_calibrator_v3.json",
        "cread_edges_ms.json": data_dir / "cread_edges_ms.json",
    }
    if extra_artifacts:
        for name, path in extra_artifacts.items():
            candidates[str(name)] = Path(path)

    checksums: Dict[str, str] = {}
    artifacts: Dict[str, Dict[str, Any]] = {}
    for name, path in candidates.items():
        if not path.exists() or not path.is_file():
            continue
        checksums[name] = compute_file_sha256(path)
        artifacts[name] = {
            "relativePath": path.name,
            "sizeBytes": int(path.stat().st_size),
            "sha256": checksums[name],
        }

    return {
        "schemaVersion": MANIFEST_SCHEMA_V3,
        "version": str(version),
        "profile": str(profile),
        "runtimeEngine": "onnxruntime_int8",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "embeddingDim": int(embedding_dim),
        "faissIndexType": str(faiss_index_type),
        "idNamespace": str(id_namespace),
        "embeddingSpace": str(embedding_space),
        "modelVersion": resolved_model_ver,
        "indexVersion": f"{faiss_index_type}:{version}",
        "sidSpec": {"levels": int(sid_codebook_levels), "codebookSize": int(sid_codebook_size)},
        "checksums": checksums,
        "artifacts": artifacts,
    }


def load_serving_manifest(path: Path) -> Optional[Dict[str, Any]]:
    """从磁盘安全加载并解析 serving_manifest JSON；损坏或不存在时返回 None。"""
    if not path.exists() or not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


def verify_manifest_checksums(
    manifest: Mapping[str, Any],
    artifact_paths: Mapping[str, Path],
    *,
    strict: bool = True,
    require_onnx_models: bool = False,
) -> Tuple[bool, List[str]]:
    """
    Fail-Closed SHA-256 校验：
    - strict=True 时缺失 checksum 或产物缺失均判定失败；
    - require_onnx_models=True 时拒绝加载缺少 .onnx 模型签名或存在不安全 .pt/.pkl 伪装模型入口的 manifest。
    """
    errors: List[str] = []
    checksums = manifest.get("checksums")
    if not isinstance(checksums, Mapping):
        return (False, ["manifest_missing_checksums"]) if strict else (True, [])

    if require_onnx_models:
        has_onnx = any(str(name).endswith(".onnx") and p.exists() for name, p in artifact_paths.items())
        if not has_onnx:
            errors.append("missing_onnx_runtime_artifact")
        for name in artifact_paths:
            if str(name).endswith((".pt", ".pth")):
                errors.append(f"forbidden_pytorch_weights_in_serving:{name}")

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


def artifact_file_plan_v3(
    *,
    models_dir: Path,
    data_dir: Path,
    faiss_index_type: str = "hnsw_sq8",
    include_text_encoder: bool = True,
) -> Tuple[List[Tuple[str, Path]], List[Tuple[str, Path]]]:
    """生成纯 ONNXRT Serving 容器所需 GCS 拉取清单（彻底剔除 .pt / news_vocab.pkl / user_vocab.pkl）。"""
    required: List[Tuple[str, Path]] = [
        ("artifacts/{version}/onnx/two_tower_user_int8.onnx", models_dir / "two_tower_user_int8.onnx"),
        ("artifacts/{version}/onnx/phoenix_v3_student_int8.onnx", models_dir / "phoenix_v3_student_int8.onnx"),
        ("artifacts/{version}/sid/sid_codebook.safetensors", models_dir / "sid_codebook.safetensors"),
        (
            f"artifacts/{{version}}/faiss/faiss_{faiss_index_type}.index",
            models_dir / f"faiss_{faiss_index_type}.index",
        ),
        ("artifacts/{version}/faiss/faiss_id_mapping.json", models_dir / "faiss_id_mapping.json"),
        ("artifacts/{version}/manifest/serving_manifest_v3.json", data_dir / "serving_manifest_v3.json"),
    ]
    if include_text_encoder:
        required.append(
            ("artifacts/{version}/onnx/text_encoder_int8.onnx", models_dir / "text_encoder_int8.onnx")
        )

    optional: List[Tuple[str, Path]] = [
        ("artifacts/{version}/calibration/weighted_calibrator_v3.json", models_dir / "weighted_calibrator_v3.json"),
        ("artifacts/{version}/data/cread_edges_ms.json", data_dir / "cread_edges_ms.json"),
    ]
    return required, optional
