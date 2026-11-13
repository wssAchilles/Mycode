"""Google Colab CLI (v0.8.0) 训练作业编排入口：支持会话复用、数据分流与预训练隔离发布。"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import subprocess
import tempfile
from typing import Any, Dict, List, Mapping, Optional

from recsys.colab.datasets import (
    _DEFAULT_ML_DIR,
    DriveDatasetSpec,  # noqa: F401
    KNOWN_DRIVE_DATASET_SPECS,  # noqa: F401
    build_code_bundle,
    build_colab_subprocess_env,
    format_redacted_command,
    is_sensitive_env_key,
    parse_gcs_uri,  # noqa: F401
)
from recsys.colab.gates import evaluate_promotion_gate
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
    "build_code_bundle",
    "build_colab_cli_plan",
    "build_colab_subprocess_env",
    "dispatch_colab_job",
    "evaluate_promotion_gate",
    "format_redacted_command",
    "is_sensitive_env_key",
    "render_remote_worker_script",
]


def build_colab_cli_plan(
    *,
    profile_name: str,
    account: ColabAccountConfig,
    session_name: str,
    bundle_path: Path,
    worker_script_path: Path,
    remote_env: Optional[Mapping[str, str]] = None,
    reuse_session: bool = False,
    keep_session: bool = False,
) -> Dict[str, List[str]]:
    """按 colab-cli v0.8.0 官方参数语法组装会话创建/复用、上传、执行与回收命令序列。"""
    if profile_name not in COLAB_PROFILES:
        raise KeyError(f"未知 Colab 训练规格: {profile_name}，可选: {sorted(COLAB_PROFILES)}")

    profile = COLAB_PROFILES[profile_name]
    base = account.base_cli_args()
    plan: Dict[str, List[str]] = {
        "usage": [*base, "usage"],
    }

    if not reuse_session:
        new_cmd = [*base, "new", "--session", session_name]
        if profile.gpu:
            new_cmd.extend(["--gpu", profile.gpu])
        if profile.high_mem:
            new_cmd.append("--high-mem")
        plan["new"] = new_cmd

    plan["upload"] = [
        *base,
        "upload",
        "--session",
        session_name,
        str(bundle_path),
        "/content/ml_services_bundle.tar.gz",
    ]

    exec_cmd = [
        *base,
        "exec",
        "--session",
        session_name,
        "--file",
        str(worker_script_path),
        "--timeout",
        "0",
    ]
    if remote_env:
        for key in sorted(remote_env.keys()):
            val = remote_env[key]
            if val:
                exec_cmd.extend(["--env", f"{key}={val}"])
    plan["exec"] = exec_cmd

    if not keep_session:
        plan["stop"] = [*base, "stop", "--session", session_name]

    return plan


def dispatch_colab_job(
    *,
    profile_name: str,
    artifact_version: str,
    ml_services_dir: Path = _DEFAULT_ML_DIR,
    staging_dir: Optional[Path] = None,
    account: Optional[ColabAccountConfig] = None,
    gcs_bucket: str = "",
    gcs_archive_uri: str = "",
    publish_to_gcs: bool = False,
    remote_env: Optional[Mapping[str, str]] = None,
    session_name: Optional[str] = None,
    dry_run: bool = True,
    max_cpu_p95_ms: float = 120.0,
    gcs_dataset_uri: str = "",
    drive_data_dir: str = "",
    drive_output_dir: str = "",
    drive_init_from: str = "",
    drive_aux_samples_dir: str = "",
    gcs_init_from_uri: str = "",
    gcs_aux_samples_uri: str = "",
    aux_max_groups: int = 2000,
    base_artifact_version: str = "",
    faiss_index_type: str = "ivf_pq",
    allow_pretrain_publish: bool = False,
    reuse_session: bool = False,
    keep_session: bool = False,
    epochs_override: Optional[int] = None,
    batch_size_override: Optional[int] = None,
    lr_override: Optional[float] = None,
    backbone_lr_scale_override: Optional[float] = None,
    user_sample_mod: int = 10,
    max_train_slates: int = 400_000,
    max_val_rand_slates: int = 50_000,
    shard_slates: int = 50_000,
) -> Dict[str, Any]:
    """
    编排一次端到端的 Colab 远端训练作业：
      - dry_run=True 时仅生成安全代码包、Worker 脚本及脱敏后的 CLI 命令清单，零算力消耗
      - reuse_session=True 时复用已有预挂载 Drive/已鉴权会话并校验显式 session_name
      - keep_session=False 时严格执行 finally stop，杜绝孤儿实例空耗 CU
    """
    if profile_name not in COLAB_PROFILES:
        raise KeyError(f"未知 Colab 训练规格: {profile_name}")
    if reuse_session and not session_name:
        raise ValueError("启用 reuse_session=True 时必须显式传入 session_name")

    acc = account or ColabAccountConfig()
    profile = COLAB_PROFILES[profile_name]
    ts_tag = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    sess = session_name or f"recsys-{profile_name}-{ts_tag}"

    work_dir = Path(staging_dir) if staging_dir else Path(tempfile.mkdtemp(prefix=f"colab_{profile_name}_"))
    work_dir.mkdir(parents=True, exist_ok=True)

    bundle_path = work_dir / "ml_services_bundle.tar.gz"
    worker_path = work_dir / f"worker_{profile_name}.py"

    bundle_info = build_code_bundle(ml_services_dir, bundle_path)
    worker_code = render_remote_worker_script(
        profile=profile,
        artifact_version=artifact_version,
        gcs_bucket=gcs_bucket,
        gcs_archive_uri=gcs_archive_uri,
        publish_to_gcs=publish_to_gcs,
        max_cpu_p95_ms=max_cpu_p95_ms,
        gcs_dataset_uri=gcs_dataset_uri,
        drive_data_dir=drive_data_dir,
        drive_output_dir=drive_output_dir,
        drive_init_from=drive_init_from,
        drive_aux_samples_dir=drive_aux_samples_dir,
        gcs_init_from_uri=gcs_init_from_uri,
        gcs_aux_samples_uri=gcs_aux_samples_uri,
        aux_max_groups=aux_max_groups,
        base_artifact_version=base_artifact_version,
        faiss_index_type=faiss_index_type,
        allow_pretrain_publish=allow_pretrain_publish,
        epochs_override=epochs_override,
        batch_size_override=batch_size_override,
        lr_override=lr_override,
        backbone_lr_scale_override=backbone_lr_scale_override,
        user_sample_mod=user_sample_mod,
        max_train_slates=max_train_slates,
        max_val_rand_slates=max_val_rand_slates,
        shard_slates=shard_slates,
    )
    worker_path.write_text(worker_code, encoding="utf-8")

    merged_remote_env: Dict[str, str] = {}
    if gcs_bucket:
        merged_remote_env["GCS_BUCKET"] = gcs_bucket
    if gcs_archive_uri:
        merged_remote_env["GCS_ARCHIVE_URI"] = gcs_archive_uri
    if gcs_dataset_uri:
        merged_remote_env["GCS_DATASET_URI"] = gcs_dataset_uri
    if drive_data_dir:
        merged_remote_env["DRIVE_DATA_DIR"] = drive_data_dir
    if drive_output_dir:
        merged_remote_env["DRIVE_OUTPUT_DIR"] = drive_output_dir
    if drive_init_from:
        merged_remote_env["DRIVE_INIT_FROM"] = drive_init_from
    if drive_aux_samples_dir:
        merged_remote_env["DRIVE_AUX_SAMPLES_DIR"] = drive_aux_samples_dir
    if gcs_init_from_uri:
        merged_remote_env["GCS_INIT_FROM_URI"] = gcs_init_from_uri
    if gcs_aux_samples_uri:
        merged_remote_env["GCS_AUX_SAMPLES_URI"] = gcs_aux_samples_uri
    if base_artifact_version:
        merged_remote_env["GCS_BASE_ARTIFACT_VERSION"] = base_artifact_version
    if faiss_index_type:
        merged_remote_env["FAISS_INDEX_TYPE"] = faiss_index_type
    if remote_env:
        for k, v in remote_env.items():
            merged_remote_env[str(k)] = str(v)

    plan = build_colab_cli_plan(
        profile_name=profile_name,
        account=acc,
        session_name=sess,
        bundle_path=bundle_path,
        worker_script_path=worker_path,
        remote_env=merged_remote_env,
        reuse_session=reuse_session,
        keep_session=keep_session,
    )
    sub_env = build_colab_subprocess_env(acc)

    result: Dict[str, Any] = {
        "dryRun": bool(dry_run),
        "profile": profile.name,
        "task": profile.task,
        "checkpointRole": profile.checkpoint_role,
        "gpu": profile.gpu or "CPU",
        "highMem": profile.high_mem,
        "estimatedCuPerHr": profile.estimated_cu_per_hr,
        "artifactVersion": artifact_version,
        "sessionName": sess,
        "reuseSession": bool(reuse_session),
        "keepSession": bool(keep_session),
        "stagingDir": str(work_dir),
        "bundle": bundle_info,
        "workerScriptPath": str(worker_path),
        "localEnv": {
            "CLOUDSDK_CONFIG": sub_env["CLOUDSDK_CONFIG"],
            "COLAB_CLI_REQUEST_TIMEOUT": sub_env["COLAB_CLI_REQUEST_TIMEOUT"],
        },
        "commandsRedacted": {step: format_redacted_command(cmd) for step, cmd in plan.items()},
    }

    if dry_run:
        return result

    should_stop = False
    try:
        subprocess.run(plan["usage"], env=sub_env, check=True)
        if "new" in plan:
            subprocess.run(plan["new"], env=sub_env, check=True)
            should_stop = not keep_session
        elif not keep_session:
            should_stop = True
        subprocess.run(plan["upload"], env=sub_env, check=True)
        subprocess.run(plan["exec"], env=sub_env, check=True)
        result["executed"] = True
    finally:
        if should_stop and "stop" in plan:
            subprocess.run(plan["stop"], env=sub_env, check=False)

    return result
