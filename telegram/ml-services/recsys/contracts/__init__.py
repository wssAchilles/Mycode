"""推荐系统版本化契约：模型产物清单、ANN 响应证据与统一行为动作词表。"""

from recsys.contracts.actions import (
    ACTION_LOSS_WEIGHTS,
    ACTION_TYPE_MAP,
    CONTINUOUS_ACTIONS,
    NEGATIVE_ACTIONS,
    NUM_ACTION_TYPES,
    NUM_PREDICTED_ACTIONS,
    POSITIVE_ACTIONS,
    PREDICTED_ACTIONS,
    WEIGHTED_SCORER_PARAMS,
    canonicalize_action_name,
)
from recsys.contracts.ann import (
    build_ann_response_evidence,
    build_user_embedding_contract,
    infer_id_namespace,
    is_mongo_object_id,
)
from recsys.contracts.artifacts import (
    artifact_file_plan,
    build_serving_manifest,
    compute_file_sha256,
    load_serving_manifest,
    verify_manifest_checksums,
)

__all__ = [
    "ACTION_LOSS_WEIGHTS",
    "ACTION_TYPE_MAP",
    "CONTINUOUS_ACTIONS",
    "NEGATIVE_ACTIONS",
    "NUM_ACTION_TYPES",
    "NUM_PREDICTED_ACTIONS",
    "POSITIVE_ACTIONS",
    "PREDICTED_ACTIONS",
    "WEIGHTED_SCORER_PARAMS",
    "artifact_file_plan",
    "build_ann_response_evidence",
    "build_serving_manifest",
    "build_user_embedding_contract",
    "canonicalize_action_name",
    "compute_file_sha256",
    "infer_id_namespace",
    "is_mongo_object_id",
    "load_serving_manifest",
    "verify_manifest_checksums",
]
