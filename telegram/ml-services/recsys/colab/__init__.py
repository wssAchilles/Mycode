"""Google Colab CLI v0.8.0 训练编排、安全传参、心跳保活与产物发布门禁子包。"""

from recsys.colab.orchestrator import (
    COLAB_PROFILES,
    ColabAccountConfig,
    ColabTrainingProfile,
    build_code_bundle,
    build_colab_cli_plan,
    build_colab_subprocess_env,
    dispatch_colab_job,
    evaluate_promotion_gate,
    format_redacted_command,
    is_sensitive_env_key,
    render_remote_worker_script,
)

__all__ = [
    "COLAB_PROFILES",
    "ColabAccountConfig",
    "ColabTrainingProfile",
    "build_code_bundle",
    "build_colab_cli_plan",
    "build_colab_subprocess_env",
    "dispatch_colab_job",
    "evaluate_promotion_gate",
    "format_redacted_command",
    "is_sensitive_env_key",
    "render_remote_worker_script",
]