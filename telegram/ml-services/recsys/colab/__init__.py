"""Google Colab CLI v0.8.0 训练编排、安全传参、数据分流与产物发布门禁子包。"""

from recsys.colab.datasets import (
    DriveDatasetSpec,
    KNOWN_DRIVE_DATASET_SPECS,
    build_code_bundle,
    build_colab_subprocess_env,
    format_redacted_command,
    is_sensitive_env_key,
    parse_gcs_uri,
)
from recsys.colab.gates import evaluate_promotion_gate
from recsys.colab.orchestrator import build_colab_cli_plan, dispatch_colab_job
from recsys.colab.profiles import (
    COLAB_PROFILES,
    ColabAccountConfig,
    ColabTrainingProfile,
)
from recsys.colab.worker_template import render_remote_worker_script

__all__ = [
    "COLAB_PROFILES",
    "ColabAccountConfig",
    "ColabTrainingProfile",
    "DriveDatasetSpec",
    "KNOWN_DRIVE_DATASET_SPECS",
    "build_code_bundle",
    "build_colab_cli_plan",
    "build_colab_subprocess_env",
    "dispatch_colab_job",
    "evaluate_promotion_gate",
    "format_redacted_command",
    "is_sensitive_env_key",
    "parse_gcs_uri",
    "render_remote_worker_script",
]
