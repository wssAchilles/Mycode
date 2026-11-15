"""ANN 召回与 V3 语义嵌入契约校验工具：与后端 TypeScript semanticEmbeddingContracts.ts 严格同构。"""

from __future__ import annotations

import os
import re
from typing import Any, Dict, FrozenSet, Mapping, Optional

_MONGO_OBJECT_ID_RE = re.compile(r"^[0-9a-fA-F]{24}$")
_SPECIAL_VOCAB_TOKENS = {"<PAD>", "<UNK>"}
_DEFAULT_HEURISTIC_MODEL_VERSION = "heuristic_embedding_contract_v1"

# 与 telegram-clone-backend semanticEmbeddingContracts.ts 精确一致的 8 个必选白名单键
EMBEDDING_CONTRACT_EXACT_KEYS: FrozenSet[str] = frozenset(
    {
        "embeddingSpace",
        "dimensions",
        "retrievalEmbeddingDim",
        "rankingEmbeddingDim",
        "modelVersion",
        "artifactVersion",
        "producer",
        "semantic",
    }
)

TRUSTED_SEMANTIC_EMBEDDING_SPACES: FrozenSet[str] = frozenset(
    {
        "recommendation_two_tower_v3",
        "recommendation_two_tower_v1",
        "semantic_post_bge_m3_v3",
        "semantic_news_v1",
    }
)

TRUSTED_SEMANTIC_EMBEDDING_PRODUCERS: FrozenSet[str] = frozenset(
    {
        "ml-services",
        "ml-worker",
        "PostSemanticBackfillJob",
        "NewsService",
    }
)


def is_mongo_object_id(value: str) -> bool:
    """判断字符串是否为标准的 24 位十六进制 Mongo ObjectId。"""
    return bool(_MONGO_OBJECT_ID_RE.match(str(value or "").strip()))


def infer_id_namespace(
    idx_to_news_id: Optional[Mapping[int, str]],
    configured: str = "",
    sample_limit: int = 64,
) -> str:
    """根据显式配置或词表 ID 形态推断产物 ID 命名空间。"""
    explicit = str(configured or "").strip()
    if explicit:
        return explicit

    if not idx_to_news_id:
        return "mongo_object_id"

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
    """根据显式配置或 ID 命名空间解析目标语义向量空间名称。"""
    explicit = str(configured or "").strip()
    if explicit:
        return explicit
    if id_namespace == "mongo_object_id":
        return "recommendation_two_tower_v3"
    return "semantic_post_bge_m3_v3"


def build_user_embedding_contract(
    *,
    embedding_dim: int = 256,
    model_version: str = "two_tower_v3",
    artifact_version: str = "two_tower_v3_artifact_v1",
    embedding_space: str = "recommendation_two_tower_v3",
    producer: str = "ml-services",
    semantic: bool = True,
) -> Dict[str, Any]:
    """构建对齐 Node semanticEmbeddingContracts.ts 的 8 键语义嵌入契约对象。"""
    dim = max(1, int(embedding_dim or 256))
    return {
        "embeddingSpace": str(embedding_space or "recommendation_two_tower_v3").strip(),
        "dimensions": dim,
        "retrievalEmbeddingDim": dim,
        "rankingEmbeddingDim": dim,
        "modelVersion": str(model_version or "two_tower_v3").strip(),
        "artifactVersion": str(artifact_version or model_version or "two_tower_v3_artifact_v1").strip(),
        "producer": str(producer or "ml-services").strip(),
        "semantic": bool(semantic),
    }


def build_v3_user_embedding_contract(
    *,
    model_version: str = "two_tower_v3",
    artifact_version: str = "two_tower_v3_artifact_v1",
    producer: str = "ml-services",
) -> Dict[str, Any]:
    """生成受 Node 放行为 semantic_ready 的 V3 用户双塔标准契约。"""
    return build_user_embedding_contract(
        embedding_dim=256,
        model_version=model_version,
        artifact_version=artifact_version,
        embedding_space="recommendation_two_tower_v3",
        producer=producer,
        semantic=True,
    )


def build_v3_post_embedding_contract(
    *,
    model_version: str = "bge_m3_post_semantic_v3",
    artifact_version: str = "post_semantic_v3_artifact_v1",
    producer: str = "PostSemanticBackfillJob",
) -> Dict[str, Any]:
    """生成受 Node 放行为 semantic_ready 的 V3 帖子语义回刷标准契约。"""
    return build_user_embedding_contract(
        embedding_dim=256,
        model_version=model_version,
        artifact_version=artifact_version,
        embedding_space="semantic_post_bge_m3_v3",
        producer=producer,
        semantic=True,
    )


def is_trusted_semantic_embedding_contract(contract: Any) -> bool:
    """在 Python 侧镜像校验 Node isKnownSemanticEmbeddingContract 准入白名单。"""
    if not isinstance(contract, Mapping):
        return False
    if set(contract.keys()) != EMBEDDING_CONTRACT_EXACT_KEYS:
        return False
    if contract.get("semantic") is not True:
        return False
    if contract.get("modelVersion") == _DEFAULT_HEURISTIC_MODEL_VERSION:
        return False

    space = contract.get("embeddingSpace")
    producer = contract.get("producer")
    model_version = contract.get("modelVersion")
    artifact_version = contract.get("artifactVersion")

    if not isinstance(space, str) or space not in TRUSTED_SEMANTIC_EMBEDDING_SPACES:
        return False
    if not isinstance(producer, str) or producer not in TRUSTED_SEMANTIC_EMBEDDING_PRODUCERS:
        return False
    if not isinstance(model_version, str) or not model_version.strip():
        return False
    if not isinstance(artifact_version, str) or not artifact_version.strip():
        return False
    return True


def build_ann_response_evidence(
    *,
    retrieval_embedding_dim: int,
    artifact_version: str = "",
    model_version: str = "",
    id_namespace: str = "",
    embedding_space: str = "",
    faiss_index_type: str = "hnsw_sq8",
    index_version: str = "",
    idx_to_news_id: Optional[Mapping[int, str]] = None,
    manifest: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    """构建供 Rust / Node 消费的完整 ANN 响应契约证据。"""
    manifest_data = manifest if isinstance(manifest, Mapping) else {}
    resolved_dim = max(1, int(manifest_data.get("embeddingDim") or retrieval_embedding_dim or 256))
    resolved_artifact = (
        str(artifact_version or "").strip()
        or str(manifest_data.get("version") or "").strip()
        or str(os.getenv("ARTIFACT_VERSION", "")).strip()
        or "local_v3_artifact"
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
    resolved_index_type = str(manifest_data.get("faissIndexType") or faiss_index_type or "hnsw_sq8").strip()
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
