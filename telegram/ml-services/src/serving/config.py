"""V3 纯在线推理服务配置（零 PyTorch/爬虫重型依赖）。"""

from __future__ import annotations

from dataclasses import dataclass, field
import os
from pathlib import Path
from typing import Tuple


def _parse_csv(raw: str, default: Tuple[str, ...]) -> Tuple[str, ...]:
    vals = [x.strip() for x in str(raw or "").split(",") if x.strip()]
    return tuple(vals) if vals else default


@dataclass
class ServingConfig:
    """Cloud Run 4 vCPU / 4 GiB 在线 ONNX Runtime 服务配置。"""

    data_dir: Path = field(default_factory=lambda: Path(os.getenv("DATA_DIR", str(Path(__file__).resolve().parents[2] / "data"))))
    models_dir: Path = field(default_factory=lambda: Path(os.getenv("MODELS_DIR", str(Path(__file__).resolve().parents[2] / "models"))))
    artifact_gcs_bucket: str = field(
        default_factory=lambda: (
            os.getenv("ARTIFACT_GCS_BUCKET")
            or os.getenv("GCS_BUCKET")
            or os.getenv("GCS_ARTIFACT_BUCKET")
            or "telegram-467705-recsys"
        )
    )
    artifact_version: str = field(default_factory=lambda: os.getenv("ARTIFACT_VERSION", ""))
    artifact_profile: str = field(default_factory=lambda: os.getenv("ARTIFACT_PROFILE", "phoenix-v3").strip().lower())
    faiss_index_type: str = field(default_factory=lambda: os.getenv("FAISS_INDEX_TYPE", "hnsw_sq8"))
    embedding_dim: int = field(default_factory=lambda: int(os.getenv("TWO_TOWER_EMBEDDING_DIM", "256")))
    max_history_len: int = field(default_factory=lambda: int(os.getenv("PHOENIX_MAX_HISTORY", "128")))
    max_candidates: int = field(default_factory=lambda: int(os.getenv("PHOENIX_MAX_CANDIDATES", "64")))
    verify_artifact_checksums: bool = field(
        default_factory=lambda: os.getenv("VERIFY_ARTIFACT_CHECKSUMS", "true").lower() == "true"
    )
    require_onnx_artifacts: bool = field(
        default_factory=lambda: os.getenv("REQUIRE_ONNX_ARTIFACTS", "true").lower() == "true"
    )
    preload_on_startup: bool = field(
        default_factory=lambda: os.getenv("PRELOAD_MODELS_ON_STARTUP", "true").lower() == "true"
    )
    allow_download_on_request: bool = field(
        default_factory=lambda: os.getenv("ALLOW_ARTIFACT_DOWNLOAD_ON_REQUEST", "false").lower() == "true"
    )
    rank_deadline_ms: float = field(default_factory=lambda: float(os.getenv("RANK_DEADLINE_MS", "45.0")))
    cors_allow_origins: Tuple[str, ...] = field(
        default_factory=lambda: _parse_csv(os.getenv("CORS_ALLOW_ORIGINS", "*"), ("*",))
    )
    cors_allow_methods: Tuple[str, ...] = field(
        default_factory=lambda: _parse_csv(os.getenv("CORS_ALLOW_METHODS", "GET,POST,OPTIONS"), ("GET", "POST", "OPTIONS"))
    )
    cors_allow_headers: Tuple[str, ...] = field(
        default_factory=lambda: _parse_csv(os.getenv("CORS_ALLOW_HEADERS", "*"), ("*",))
    )
    cors_allow_credentials: bool = field(
        default_factory=lambda: os.getenv("CORS_ALLOW_CREDENTIALS", "false").lower() == "true"
    )
