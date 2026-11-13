"""ANN 召回与用户向量写入契约辅助函数，与后端 TypeScript 契约严格对齐。"""

from __future__ import annotations

import os
import re
from typing import Any, Dict, Mapping, Optional

_MONGO_OBJECT_ID_RE = re.compile(r"^[0-9a-fA-F]{24}$")
_SPECIAL_VOCAB_TOKENS = {"<PAD>", "<UNK>"}


def is_mongo_object_id(value: str) -> bool:
    """判断字符串是否为标准的 24 位十六进制 Mongo ObjectId。"""
    return bool(_MONGO_OBJECT_ID_RE.match(str(value or "").strip()))


def infer_id_namespace(
    idx_to_news_id: Optional[Mapping[int, str]],
    configured: str = "",
    sample_limit: int = 64,
) -> str:
    """根据显式配置或词表 ID 形态真实推断产物 ID 命名空间。"""
    explicit = str(configured or "").strip()
    if explicit:
        return explicit

    if not idx_to_news_id:
        return "news_external_id"

    checked = 0
    all_object_ids = True
    for raw_id in idx_to_news_id.values():
        token = str(raw_id or "").strip()
        if not token or token in _SPECIAL_VOCAB_TOKENS:
            continue
        checked += 1
        if not is_mongo_object_id(token):
            all_object_ids = False
            break
        if checked >= sample_limit:
            break

    if checked > 0 and all_object_ids:
        return "mongo_object_id"
    return "news_external_id"


def resolve_embedding_space(id_namespace: str, configured: str = "") -> str:
    """根据显式配置或 ID 命名空间返回对应的向量空间标识。"""
    explicit = str(configured or "").strip()
    if explicit:
        return explicit
    if id_namespace == "mongo_object_id":
        return "recommendation_two_tower_v1"
    return "semantic_news_v1"


def build_ann_response_evidence(
    *,
    retrieval_embedding_dim: int,
    artifact_version: str = "",
    model_version: str = "",
    id_namespace: str = "",
    embedding_space: str = "",
    faiss_index_type: str = "ivf_pq",
    index_version: str = "",
    idx_to_news_id: Optional[Mapping[int, str]] = None,
    manifest: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    """构建符合 Node ANNClient.ts isCompleteResponseEvidence 校验的证据对象。"""
    manifest_data = manifest if isinstance(manifest, Mapping) else {}
    resolved_dim = max(1, int(manifest_data.get("embeddingDim") or retrieval_embedding_dim or 256))
    resolved_artifact = (
        str(artifact_version or "").strip()
        or str(manifest_data.get("version") or "").strip()
        or str(os.getenv("ARTIFACT_VERSION", "")).strip()
        or "local_artifact_v1"
    )
    resolved_namespace = infer_id_namespace(
        idx_to_news_id,
        configured=(
            str(id_namespace or "").strip()
            or str(manifest_data.get("idNamespace") or "").strip()
            or str(os.getenv("ANN_ID_NAMESPACE", "")).strip()
        ),
    )
    resolved_space = resolve_embedding_space(
        resolved_namespace,
        configured=(
            str(embedding_space or "").strip()
            or str(manifest_data.get("embeddingSpace") or "").strip()
            or str(os.getenv("ANN_EMBEDDING_SPACE", "")).strip()
        ),
    )
    resolved_model = (
        str(model_version or "").strip()
        or str(manifest_data.get("modelVersion") or "").strip()
        or str(os.getenv("TWO_TOWER_MODEL_VERSION", "")).strip()
        or f"{resolved_space}:{resolved_artifact}"
    )
    resolved_index_type = str(manifest_data.get("faissIndexType") or faiss_index_type or "flat").strip()
    resolved_index_version = (
        str(index_version or "").strip()
        or str(manifest_data.get("indexVersion") or "").strip()
        or str(os.getenv("ANN_INDEX_VERSION", "")).strip()
        or f"{resolved_index_type}:{resolved_artifact}"
    )

    return {
        "embeddingSpace": resolved_space,
        "retrievalEmbeddingDim": resolved_dim,
        "modelVersion": resolved_model,
        "artifactVersion": resolved_artifact,
        "idNamespace": resolved_namespace,
        "indexVersion": resolved_index_version,
    }


def build_user_embedding_contract(
    *,
    embedding_dim: int,
    model_version: str,
    artifact_version: str,
    embedding_space: str = "recommendation_two_tower_v1",
    producer: str = "ml-services/refresh_features",
    semantic: bool = True,
) -> Dict[str, Any]:
    """构建写入 Mongo user_feature_vectors.twoTowerEmbeddingContract 的契约对象。"""
    dim = max(1, int(embedding_dim or 256))
    return {
        "embeddingSpace": str(embedding_space or "recommendation_two_tower_v1").strip(),
        "dimensions": dim,
        "retrievalEmbeddingDim": dim,
        "rankingEmbeddingDim": dim,
        "modelVersion": str(model_version or "two_tower_unknown").strip(),
        "artifactVersion": str(artifact_version or model_version or "local_artifact_v1").strip(),
        "producer": str(producer or "ml-services/refresh_features").strip(),
        "semantic": bool(semantic),
    }
