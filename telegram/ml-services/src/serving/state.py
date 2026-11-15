"""Serving 运行时状态持有者：管理 ONNXRT 执行池、FAISS 索引、码本及 Fail-Closed Manifest 校验。"""

from __future__ import annotations

import json
from pathlib import Path
import threading
from typing import Any, Dict, Mapping, Optional

from src.contracts.ann import build_ann_response_evidence
from src.contracts.artifacts import (
    artifact_file_plan_v3,
    load_serving_manifest,
    verify_manifest_checksums,
)
from src.onnx_runtime.phoenix_v3_ort import PhoenixV3OrtRunner
from src.onnx_runtime.session_pool import OnnxSessionPool
from src.onnx_runtime.text_encoder_ort import SidCodebookQuantizer, TextEncoderOrtRunner
from src.onnx_runtime.two_tower_ort import TwoTowerOrtRunner
from src.serving.config import ServingConfig


def _load_id_mapping(path: Path) -> Dict[int, str]:
    """优先从 JSON 映射加载 idx_to_post_id；兼容旧版仅存 pkl 时再解析。"""
    if not path.exists():
        return {}
    if path.suffix == ".json":
        payload = json.loads(path.read_text(encoding="utf-8"))
        raw = payload.get("idx_to_news_id") or payload.get("idx_to_post_id") or payload
        if isinstance(raw, dict):
            return {int(k): str(v) for k, v in raw.items()}
        return {}
    if path.suffix == ".pkl":
        import pickle

        with open(path, "rb") as handle:
            payload = pickle.load(handle)
        raw = payload.get("idx_to_news_id") or payload.get("idx_to_post_id") or {}
        return {int(k): str(v) for k, v in raw.items()}
    return {}


class ServingState:
    """V3 在线服务唯一可变状态根对象，消除散落模块全局变量。"""

    def __init__(self, config: Optional[ServingConfig] = None) -> None:
        self.config = config or ServingConfig()
        self.lock = threading.RLock()
        self.pool = OnnxSessionPool()
        self.text_encoder = TextEncoderOrtRunner(self.pool, embedding_dim=self.config.embedding_dim)
        self.two_tower = TwoTowerOrtRunner(
            self.pool,
            max_history_len=self.config.max_history_len,
            embedding_dim=self.config.embedding_dim,
        )
        self.phoenix = PhoenixV3OrtRunner(
            self.pool,
            max_history_len=self.config.max_history_len,
            max_candidates_per_batch=self.config.max_candidates,
        )
        self.quantizer: Optional[SidCodebookQuantizer] = None
        self.faiss_index: Any = None
        self.idx_to_post_id: Dict[int, str] = {}
        self.serving_manifest: Optional[Dict[str, Any]] = None
        self.manifest_verified: Optional[bool] = None
        self.models_loaded: bool = False

    def load_v3_artifacts(self) -> Dict[str, Any]:
        """加载并严格校验 V3 ServingManifest、ONNX 会话、SID 码本、FAISS 与校准器。"""
        with self.lock:
            models_dir = self.config.models_dir
            data_dir = self.config.data_dir

            manifest_path = data_dir / "serving_manifest_v3.json"
            if not manifest_path.exists():
                manifest_path = data_dir / "serving_manifest.json"
            manifest = load_serving_manifest(manifest_path)

            required_files, optional_files = artifact_file_plan_v3(
                models_dir=models_dir,
                data_dir=data_dir,
                faiss_index_type=self.config.faiss_index_type,
                include_text_encoder=True,
            )

            artifact_paths = {
                Path(local).name: Path(local)
                for _, local in required_files + optional_files
                if Path(local).exists()
                and Path(local).name not in {"serving_manifest_v3.json", "serving_manifest.json"}
            }
            # 补充校验 manifest 中已签名的扩展产物（例如 sid_codebook.npz）以及本地可选遗留映射
            if isinstance(manifest, Mapping):
                checksums = manifest.get("checksums")
                if isinstance(checksums, Mapping):
                    for art_name in checksums:
                        if art_name in artifact_paths:
                            continue
                        data_candidate = data_dir / art_name
                        model_candidate = models_dir / art_name
                        if data_candidate.exists():
                            artifact_paths[art_name] = data_candidate
                        elif model_candidate.exists() or not art_name.endswith(".json"):
                            artifact_paths[art_name] = model_candidate
                        else:
                            artifact_paths[art_name] = data_candidate if "cread" in art_name else model_candidate

            npz_cb = models_dir / "sid_codebook.npz"
            if npz_cb.exists() and "sid_codebook.npz" not in artifact_paths:
                artifact_paths["sid_codebook.npz"] = npz_cb

            # 也检查是否存在 legacy pkl id mapping 以保持过渡期可测试性
            pkl_map = models_dir / "faiss_id_mapping.pkl"
            if pkl_map.exists() and "faiss_id_mapping.json" not in artifact_paths:
                artifact_paths["faiss_id_mapping.pkl"] = pkl_map

            if self.config.verify_artifact_checksums and manifest is not None:
                ok, errors = verify_manifest_checksums(
                    manifest,
                    artifact_paths,
                    strict=True,
                    require_onnx_models=self.config.require_onnx_artifacts,
                )
                self.manifest_verified = ok
                if not ok:
                    raise RuntimeError(f"V3 artifact manifest SHA-256 verification failed: {errors}")
            else:
                self.manifest_verified = False if manifest is not None else None

            self.serving_manifest = manifest

            # 按存在性加载各个 ONNX 会话
            model_files = {
                "text_encoder": models_dir / "text_encoder_int8.onnx",
                "two_tower_user": models_dir / "two_tower_user_int8.onnx",
                "phoenix_v3_student": models_dir / "phoenix_v3_student_int8.onnx",
            }
            for sess_name, path in model_files.items():
                if path.exists():
                    self.pool.load_session(sess_name, path)

            # 加载 SID 残差量化码本
            for cb_name in ("sid_codebook.safetensors", "sid_codebook.npz", "sid_codebook.npy"):
                cb_path = models_dir / cb_name
                if cb_path.exists():
                    self.quantizer = SidCodebookQuantizer.from_npz_or_json(cb_path)
                    self.text_encoder = TextEncoderOrtRunner(
                        self.pool,
                        quantizer=self.quantizer,
                        embedding_dim=self.config.embedding_dim,
                    )
                    break

            # 加载 FAISS 索引与 ID 映射
            faiss_path = models_dir / f"faiss_{self.config.faiss_index_type}.index"
            if faiss_path.exists():
                import faiss

                self.faiss_index = faiss.read_index(str(faiss_path))

            json_map_path = models_dir / "faiss_id_mapping.json"
            if json_map_path.exists():
                self.idx_to_post_id = _load_id_mapping(json_map_path)
            elif pkl_map.exists():
                self.idx_to_post_id = _load_id_mapping(pkl_map)

            # 加载 CREAD-30 分桶边界与 Platt 校准器
            cread_path = data_dir / "cread_edges_ms.json"
            cal_path = models_dir / "weighted_calibrator_v3.json"
            cread_edges = json.loads(cread_path.read_text(encoding="utf-8")) if cread_path.exists() else None
            calibrator = json.loads(cal_path.read_text(encoding="utf-8")) if cal_path.exists() else None
            self.phoenix = PhoenixV3OrtRunner(
                self.pool,
                max_history_len=self.config.max_history_len,
                max_candidates_per_batch=self.config.max_candidates,
                cread_edges_ms=cread_edges,
                calibrator=calibrator,
            )

            self.models_loaded = len(self.pool.loaded_names()) > 0
            return self.health_snapshot()

    def current_ann_evidence(self) -> Dict[str, Any]:
        return build_ann_response_evidence(
            retrieval_embedding_dim=self.config.embedding_dim,
            artifact_version=self.config.artifact_version,
            faiss_index_type=self.config.faiss_index_type,
            idx_to_news_id=self.idx_to_post_id,
            manifest=self.serving_manifest,
        )

    def health_snapshot(self) -> Dict[str, Any]:
        evidence = self.current_ann_evidence() if (self.two_tower.is_ready or self.faiss_index is not None) else None
        return {
            "status": "ok",
            "runtime_engine": "onnxruntime_int8",
            "models_loaded": self.models_loaded,
            "loaded_sessions": self.pool.loaded_names(),
            "artifact_version": self.config.artifact_version or (self.serving_manifest or {}).get("version"),
            "artifact_profile": self.config.artifact_profile,
            "two_tower_loaded": self.two_tower.is_ready,
            "phoenix_loaded": self.phoenix.is_ready,
            "phoenix_variant": "v3_onnx_int8" if self.phoenix.is_ready else None,
            "text_encoder_loaded": self.text_encoder.is_ready,
            "sid_codebook_loaded": self.quantizer is not None,
            "faiss_enabled": self.faiss_index is not None,
            "faiss_index_type": self.config.faiss_index_type if self.faiss_index is not None else None,
            "embedding_dim": self.config.embedding_dim,
            "id_namespace": evidence.get("idNamespace") if evidence else None,
            "embedding_space": evidence.get("embeddingSpace") if evidence else None,
            "manifest_verified": self.manifest_verified,
        }
