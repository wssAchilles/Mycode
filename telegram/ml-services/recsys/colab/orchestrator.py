"""Google Colab CLI (v0.8.0) 训练作业编排与发布门禁控制器。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import shlex
import subprocess
import tarfile
import tempfile
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from recsys.contracts.artifacts import (
    build_serving_manifest,
    load_serving_manifest,
    verify_manifest_checksums,
)
from recsys.training.calibration_and_sidecars import validate_social_phoenix_linear_artifact

_DEFAULT_ML_DIR = Path(__file__).resolve().parent.parent.parent
_SENSITIVE_KEY_MARKERS: Tuple[str, ...] = (
    "SECRET",
    "TOKEN",
    "PASSWORD",
    "PASSWD",
    "PRIVATE",
    "CREDENTIAL",
    "MONGO_URI",
    "DATABASE_URL",
    "API_KEY",
    "AUTH",
)
_EXCLUDED_BUNDLE_NAMES: Tuple[str, ...] = (
    "__pycache__",
    ".pytest_cache",
    ".venv",
    "venv",
    ".git",
    "data",
    "models",
    ".env",
)


@dataclass(frozen=True)
class ColabAccountConfig:
    """
    单一授权 Colab 账号配置（仅使用用户当前绑定并具备算力池的 acct1/ADC 凭证）。
    """

    cloudsdk_config: str = "~/.config/gcloud-colab-1"
    colab_config: str = "~/.config/colab-cli/acct1.json"
    auth_mode: str = "adc"
    request_timeout_sec: int = 300
    colab_bin: str = "colab"

    def resolved_cloudsdk_dir(self) -> str:
        return str(Path(self.cloudsdk_config).expanduser())

    def resolved_colab_config_path(self) -> str:
        return str(Path(self.colab_config).expanduser())

    def base_cli_args(self) -> List[str]:
        return [
            self.colab_bin,
            "--auth",
            self.auth_mode,
            "--config",
            self.resolved_colab_config_path(),
        ]


@dataclass(frozen=True)
class ColabTrainingProfile:
    """预定义的 Colab 算力规格与推荐训练任务组合。"""

    name: str
    task: str  # "smoke" | "two-tower" | "phoenix-v2" | "sidecars"
    gpu: Optional[str] = None
    high_mem: bool = False
    scale: str = "mini"
    epochs: int = 5
    batch_size: int = 64
    estimated_cu_per_hr: float = 0.05
    description: str = ""


COLAB_PROFILES: Dict[str, ColabTrainingProfile] = {
    "smoke-cpu": ColabTrainingProfile(
        name="smoke-cpu",
        task="smoke",
        gpu=None,
        high_mem=False,
        scale="mini",
        epochs=1,
        batch_size=8,
        estimated_cu_per_hr=0.05,
        description="CPU 端到端链路冒烟验证（极低开销，校验代码打包、V2 训练、侧车及契约门禁）",
    ),
    "two-tower-t4": ColabTrainingProfile(
        name="two-tower-t4",
        task="two-tower",
        gpu="T4",
        high_mem=True,
        scale="mini",
        epochs=6,
        batch_size=2048,
        estimated_cu_per_hr=1.96,
        description="Two-Tower 双塔对比学习召回（InfoNCE + Log-Q 纠偏）与全量 MLP 向量导出",
    ),
    "phoenix-v2-mini-t4": ColabTrainingProfile(
        name="phoenix-v2-mini-t4",
        task="phoenix-v2",
        gpu="T4",
        high_mem=True,
        scale="mini",
        epochs=8,
        batch_size=64,
        estimated_cu_per_hr=1.96,
        description="Phoenix V2 Mini（128d, 4层）候选隔离多任务排序训练与 CPU 延迟基准验收",
    ),
    "phoenix-v2-medium-a100": ColabTrainingProfile(
        name="phoenix-v2-medium-a100",
        task="phoenix-v2",
        gpu="A100",
        high_mem=True,
        scale="medium",
        epochs=10,
        batch_size=128,
        estimated_cu_per_hr=13.0,
        description="Phoenix V2 Medium（256d, 6层）高容量排序主塔混合精度训练",
    ),
    "sidecars-cpu": ColabTrainingProfile(
        name="sidecars-cpu",
        task="sidecars",
        gpu=None,
        high_mem=False,
        scale="mini",
        epochs=1,
        batch_size=64,
        estimated_cu_per_hr=0.08,
        description="SocialPhoenix Linear + RealGraph GBT + WeightedScorer Platt 校准侧车联合训练",
    ),
}


def is_sensitive_env_key(key: str) -> bool:
    """判断环境变量名是否属于凭证、连接串或敏感密钥，用于日志脱敏。"""
    upper = key.strip().upper()
    return any(marker in upper for marker in _SENSITIVE_KEY_MARKERS)


def build_colab_subprocess_env(
    account: ColabAccountConfig,
    extra_local_env: Optional[Mapping[str, str]] = None,
) -> Dict[str, str]:
    """构造本地调用 colab CLI 的隔离环境变量（严格绑定 acct1 CLOUDSDK_CONFIG 与超长请求超时）。"""
    env = dict(os.environ)
    env["CLOUDSDK_CONFIG"] = account.resolved_cloudsdk_dir()
    env["COLAB_CLI_REQUEST_TIMEOUT"] = str(int(account.request_timeout_sec))
    if extra_local_env:
        for k, v in extra_local_env.items():
            env[str(k)] = str(v)
    return env


def format_redacted_command(args: Sequence[str]) -> str:
    """将命令参数列表格式化为可安全打印的 Shell 命令字符串（自动遮蔽 --env 中的敏感密钥值）。"""
    masked: List[str] = []
    mask_next = False
    for token in args:
        if mask_next:
            mask_next = False
            key, sep, val = token.partition("=")
            if sep and is_sensitive_env_key(key):
                masked.append(f"{key}=<REDACTED>")
            else:
                masked.append(token)
            continue
        if token == "--env":
            mask_next = True
        masked.append(token)
    return shlex.join(masked)


def _should_exclude_from_bundle(rel_path: Path) -> bool:
    for part in rel_path.parts:
        if part in _EXCLUDED_BUNDLE_NAMES or part.startswith(".env"):
            return True
    name = rel_path.name.lower()
    if name.endswith(".pyc") or name.endswith(".pyo"):
        return True
    if name.endswith(".json") and any(w in name for w in ("secret", "credential", "key", "token")):
        return True
    return False


def build_code_bundle(
    ml_services_dir: Path,
    output_tar_gz: Path,
) -> Dict[str, Any]:
    """
    将 ml-services/recsys 与 ml-services/scripts 安全打包为干净压缩包：
      - 严格排除 .env、密钥 JSON、本地 .venv、缓存字节码与大体积模型/数据目录
    """
    ml_dir = Path(ml_services_dir).resolve()
    output_tar_gz = Path(output_tar_gz)
    output_tar_gz.parent.mkdir(parents=True, exist_ok=True)

    included = 0
    excluded = 0
    target_roots = ["recsys", "scripts"]

    with tarfile.open(output_tar_gz, "w:gz") as tar:
        req_file = ml_dir / "requirements.txt"
        if req_file.exists():
            tar.add(req_file, arcname="requirements.txt")
            included += 1

        for root_name in target_roots:
            root_path = ml_dir / root_name
            if not root_path.exists():
                continue
            for item in sorted(root_path.rglob("*")):
                if item.is_dir():
                    continue
                rel = item.relative_to(ml_dir)
                if _should_exclude_from_bundle(rel):
                    excluded += 1
                    continue
                tar.add(item, arcname=str(rel))
                included += 1

    digest = hashlib.sha256(output_tar_gz.read_bytes()).hexdigest()
    return {
        "bundlePath": str(output_tar_gz),
        "includedFiles": included,
        "excludedFiles": excluded,
        "sizeBytes": int(output_tar_gz.stat().st_size),
        "sha256": digest,
    }


def render_remote_worker_script(
    *,
    profile: ColabTrainingProfile,
    artifact_version: str,
    gcs_bucket: str = "",
    gcs_archive_uri: str = "",
    publish_to_gcs: bool = False,
    max_cpu_p95_ms: float = 120.0,
) -> str:
    """生成直接在 Colab 远端内核执行的轻量化多阶段 Worker 脚本（含 30s 心跳与发布前门禁校验）。"""
    payload = {
        "profile": profile.name,
        "task": profile.task,
        "scale": profile.scale,
        "epochs": profile.epochs,
        "batch_size": profile.batch_size,
        "artifact_version": artifact_version,
        "gcs_bucket": gcs_bucket,
        "gcs_archive_uri": gcs_archive_uri,
        "publish_to_gcs": bool(publish_to_gcs),
        "max_cpu_p95_ms": float(max_cpu_p95_ms),
    }
    config_json = json.dumps(payload, ensure_ascii=False, indent=2)

    return f'''#!/usr/bin/env python3
"""Colab 远端训练执行入口（由 recsys.colab.orchestrator 自动生成）。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import pickle
import subprocess
import sys
import tarfile
import threading
import time

JOB_CONFIG = json.loads({config_json!r})
WORKDIR = Path("/content/ml-services")
BUNDLE_PATH = Path("/content/ml_services_bundle.tar.gz")


def _extract_bundle() -> None:
    import inspect

    if WORKDIR.exists():
        # 清理旧代码目录，保障每次运行使用最新同步包
        for sub in ("recsys", "scripts"):
            target = WORKDIR / sub
            if target.exists():
                import shutil
                shutil.rmtree(target)
    WORKDIR.mkdir(parents=True, exist_ok=True)
    if BUNDLE_PATH.exists():
        with tarfile.open(BUNDLE_PATH, "r:gz") as tar:
            if "filter" in inspect.signature(tar.extractall).parameters:
                tar.extractall(WORKDIR, filter="data")
            else:
                tar.extractall(WORKDIR)
    if str(WORKDIR) not in sys.path:
        sys.path.insert(0, str(WORKDIR))
    os.chdir(WORKDIR)


def _ensure_dependencies() -> None:
    needed = []
    for mod, pkg in (
        ("pymongo", "pymongo"),
        ("google.cloud.storage", "google-cloud-storage"),
        ("sklearn", "scikit-learn"),
        ("tqdm", "tqdm"),
        ("bson", "pymongo"),
    ):
        try:
            __import__(mod)
        except Exception:
            if pkg not in needed:
                needed.append(pkg)
    if needed:
        print(f"[setup] installing missing packages: {{needed}}", flush=True)
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", *needed], check=True)


def _start_heartbeat(stop_event: threading.Event, label: str) -> threading.Thread:
    start = time.monotonic()

    def _beat() -> None:
        while not stop_event.wait(30.0):
            elapsed = int(time.monotonic() - start)
            print(f"[heartbeat] profile={{label}} elapsed={{elapsed}}s", flush=True)

    thread = threading.Thread(target=_beat, daemon=True)
    thread.start()
    return thread


def _create_smoke_fixture(data_dir: Path, models_dir: Path) -> Path:
    from recsys.contracts.actions import ACTION_TYPE_MAP

    data_dir.mkdir(parents=True, exist_ok=True)
    models_dir.mkdir(parents=True, exist_ok=True)
    base_ts = datetime(2026, 11, 10, 0, 0, 0, tzinfo=timezone.utc)
    samples = []
    for i in range(32):
        engaged = i % 2 == 0
        samples.append(
            {{
                "user_id": f"smoke_u_{{i % 4}}",
                "history": [
                    (f"smoke_hp_{{j}}", f"smoke_ha_{{j % 2}}", ACTION_TYPE_MAP["like" if j % 2 == 0 else "click"], j % 5)
                    for j in range(4)
                ],
                "candidate_post_id": f"smoke_cp_{{i}}",
                "candidate_author_id": f"smoke_ha_{{i % 2}}",
                "labels": {{
                    "click": 1.0 if engaged else 0.0,
                    "like": 1.0 if engaged and i % 4 == 0 else 0.0,
                    "reply": 1.0 if engaged and i % 6 == 0 else 0.0,
                    "repost": 0.0,
                    "quote": 0.0,
                    "share": 0.0,
                    "dwell": 1.0 if engaged else 0.0,
                    "video_view": 0.0,
                    "follow_author": 0.0,
                    "not_interested": 0.0 if engaged else 1.0,
                    "block_author": 0.0,
                    "mute_author": 0.0,
                    "report": 0.0,
                }},
                "dwell_ms": 12000 if engaged else 300,
                "in_network": engaged,
                "has_video": i % 3 == 0,
                "action_time": (base_ts + timedelta(minutes=i * 10)).isoformat(),
                "is_positive": engaged,
            }}
        )
    out = data_dir / "phoenix_v2_samples.pkl"
    with open(out, "wb") as f:
        pickle.dump(samples, f, protocol=pickle.HIGHEST_PROTOCOL)
    return out


def main() -> None:
    _extract_bundle()
    _ensure_dependencies()

    from recsys.colab.orchestrator import evaluate_promotion_gate
    from recsys.contracts.artifacts import build_serving_manifest
    from recsys.training.calibration_and_sidecars import run_sidecar_training
    from recsys.training.phoenix_v2_trainer import PhoenixV2TrainConfig, train_phoenix_v2
    from recsys.training.two_tower_trainer import TwoTowerTrainConfig, train_two_tower

    stop_event = threading.Event()
    _start_heartbeat(stop_event, JOB_CONFIG["profile"])
    data_dir = WORKDIR / "data"
    models_dir = WORKDIR / "models"
    data_dir.mkdir(parents=True, exist_ok=True)
    models_dir.mkdir(parents=True, exist_ok=True)

    report: dict = {{}}
    try:
        task = JOB_CONFIG["task"]
        if task == "smoke":
            samples_path = _create_smoke_fixture(data_dir, models_dir)
            report = train_phoenix_v2(
                PhoenixV2TrainConfig(
                    data_dir=data_dir,
                    models_dir=models_dir,
                    samples_path=samples_path,
                    scale="mini",
                    epochs=1,
                    batch_size=8,
                    max_history=16,
                    max_candidates=8,
                )
            )
            run_sidecar_training(samples_path=samples_path, models_dir=models_dir)
        elif task == "two-tower":
            report = train_two_tower(
                TwoTowerTrainConfig(
                    data_dir=data_dir,
                    models_dir=models_dir,
                    epochs=int(JOB_CONFIG["epochs"]),
                    batch_size=int(JOB_CONFIG["batch_size"]),
                )
            )
        elif task == "phoenix-v2":
            archive_uri = JOB_CONFIG.get("gcs_archive_uri") or os.getenv("GCS_ARCHIVE_URI", "")
            mongo_uri = os.getenv("MONGO_URI", "")
            samples_path = data_dir / "phoenix_v2_samples.pkl"
            if not samples_path.exists() and (archive_uri or mongo_uri):
                cmd = [sys.executable, str(WORKDIR / "scripts" / "export_training_data.py"), "--output", str(samples_path)]
                if archive_uri:
                    cmd.extend(["--gcs-archive-uri", archive_uri])
                if mongo_uri:
                    cmd.extend(["--mongo-uri", mongo_uri])
                subprocess.run(cmd, check=True)
            report = train_phoenix_v2(
                PhoenixV2TrainConfig(
                    data_dir=data_dir,
                    models_dir=models_dir,
                    samples_path=samples_path,
                    scale=str(JOB_CONFIG["scale"]),
                    epochs=int(JOB_CONFIG["epochs"]),
                    batch_size=int(JOB_CONFIG["batch_size"]),
                )
            )
        elif task == "sidecars":
            samples_path = data_dir / "phoenix_v2_samples.pkl"
            report = run_sidecar_training(
                samples_path=samples_path,
                models_dir=models_dir,
                mongo_uri=os.getenv("MONGO_URI", ""),
            )
        else:
            raise ValueError(f"Unsupported task: {{task}}")

        manifest = build_serving_manifest(
            version=str(JOB_CONFIG["artifact_version"]),
            profile="phoenix-v2" if task in ("smoke", "phoenix-v2") else "full",
            faiss_index_type=os.getenv("FAISS_INDEX_TYPE", "ivf_pq"),
            models_dir=models_dir,
            data_dir=data_dir,
            model_version=str(JOB_CONFIG["artifact_version"]),
            include_checksums=True,
        )
        (data_dir / "serving_manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        passed, reasons, gate_details = evaluate_promotion_gate(
            profile_name=str(JOB_CONFIG["profile"]),
            models_dir=models_dir,
            data_dir=data_dir,
            train_report=report,
            max_cpu_p95_ms=float(JOB_CONFIG["max_cpu_p95_ms"]),
        )
        print(json.dumps({{"gatePassed": passed, "reasons": reasons, "details": gate_details}}, ensure_ascii=False, indent=2), flush=True)
        if not passed:
            raise RuntimeError(f"Promotion gate blocked upload: {{reasons}}")

        if JOB_CONFIG.get("publish_to_gcs") and (JOB_CONFIG.get("gcs_bucket") or os.getenv("GCS_BUCKET")):
            bucket = JOB_CONFIG.get("gcs_bucket") or os.getenv("GCS_BUCKET")
            pub_profile = "phoenix-v2" if task in ("smoke", "phoenix-v2") else "full"
            subprocess.run(
                [
                    sys.executable,
                    str(WORKDIR / "scripts" / "publish_artifacts.py"),
                    "--bucket",
                    str(bucket),
                    "--version",
                    str(JOB_CONFIG["artifact_version"]),
                    "--models-dir",
                    str(models_dir),
                    "--data-dir",
                    str(data_dir),
                    "--profile",
                    pub_profile,
                ],
                check=True,
            )
    finally:
        stop_event.set()


if __name__ == "__main__":
    main()
'''


def evaluate_promotion_gate(
    *,
    profile_name: str,
    models_dir: Path,
    data_dir: Path,
    train_report: Optional[Mapping[str, Any]] = None,
    max_cpu_p95_ms: float = 120.0,
    max_unit_norm_error: float = 1e-3,
) -> Tuple[bool, List[str], Dict[str, Any]]:
    """
    产物发布门禁（Fail-Closed）：在允许上传 GCS 或切换线上版本前强校验产物完整性与延迟指标。
    """
    profile = COLAB_PROFILES.get(profile_name)
    if profile is None:
        return False, [f"unknown_profile:{profile_name}"], {}

    reasons: List[str] = []
    details: Dict[str, Any] = {"profile": profile_name}
    models_dir = Path(models_dir)
    data_dir = Path(data_dir)

    manifest = load_serving_manifest(data_dir / "serving_manifest.json")
    if manifest is None:
        reasons.append("missing_serving_manifest")
    else:
        artifact_paths = {
            "twoTowerModel": models_dir / "two_tower_epoch_latest.pt",
            "phoenixModel": models_dir / "phoenix_epoch_latest.pt",
            "phoenixV2Model": models_dir / "phoenix_v2_inference.pt",
            "phoenixV2Config": models_dir / "phoenix_v2_config.json",
            "itemEmbeddings": data_dir / "item_embeddings.npy",
            "weightedCalibrator": models_dir / "weighted_calibrator.json",
            "realGraphGbt": models_dir / "realgraph_gbt.json",
            "socialPhoenixLinear": models_dir / "social_phoenix_linear.json",
        }
        present_subset = {k: p for k, p in artifact_paths.items() if p.exists()}
        ok_sha, sha_errors = verify_manifest_checksums(manifest, present_subset, strict=True)
        if not ok_sha:
            reasons.extend(sha_errors)

    if profile.task in ("smoke", "phoenix-v2"):
        for req_name in ("phoenix_v2_inference.pt", "phoenix_v2_config.json"):
            p = models_dir / req_name
            if not p.exists() or p.stat().st_size == 0:
                reasons.append(f"missing_or_empty:{req_name}")
        if train_report:
            bench = train_report.get("cpuBenchmark") or {}
            fp32_p95 = bench.get("cpuFp32P95Ms")
            details["cpuFp32P95Ms"] = fp32_p95
            if fp32_p95 is not None and float(fp32_p95) > float(max_cpu_p95_ms):
                reasons.append(f"cpu_p95_latency_exceeded:{fp32_p95}>{max_cpu_p95_ms}")
            for ep in train_report.get("epochs") or []:
                loss_val = ep.get("trainLoss")
                if loss_val is None or not math.isfinite(float(loss_val)):
                    reasons.append("non_finite_train_loss")
                    break

    if profile.task == "two-tower":
        for p in (models_dir / "two_tower_epoch_latest.pt", data_dir / "item_embeddings.npy"):
            if not p.exists() or p.stat().st_size == 0:
                reasons.append(f"missing_or_empty:{p.name}")
        if train_report:
            norm_err = train_report.get("maxUnitNormError")
            details["maxUnitNormError"] = norm_err
            if norm_err is not None and float(norm_err) > float(max_unit_norm_error):
                reasons.append(f"item_norm_error_exceeded:{norm_err}>{max_unit_norm_error}")

    social_path = models_dir / "social_phoenix_linear.json"
    if social_path.exists():
        try:
            social_obj = json.loads(social_path.read_text(encoding="utf-8"))
            ok_social, social_errs = validate_social_phoenix_linear_artifact(social_obj)
            if not ok_social:
                reasons.extend(social_errs)
        except Exception as exc:
            reasons.append(f"invalid_social_phoenix_json:{exc}")
    elif profile.task == "sidecars":
        reasons.append("missing_social_phoenix_linear")

    if profile.task == "sidecars":
        for req_name in ("realgraph_gbt.json", "weighted_calibrator.json"):
            p = models_dir / req_name
            if not p.exists() or p.stat().st_size == 0:
                reasons.append(f"missing_or_empty:{req_name}")

    return len(reasons) == 0, reasons, details


def build_colab_cli_plan(
    *,
    profile_name: str,
    account: ColabAccountConfig,
    session_name: str,
    bundle_path: Path,
    worker_script_path: Path,
    remote_env: Optional[Mapping[str, str]] = None,
) -> Dict[str, List[str]]:
    """按 colab-cli v0.8.0 官方参数语法组装完整的会话新建、上传、执行与回收命令序列。"""
    if profile_name not in COLAB_PROFILES:
        raise KeyError(f"未知 Colab 训练规格: {profile_name}，可选: {sorted(COLAB_PROFILES)}")

    profile = COLAB_PROFILES[profile_name]
    base = account.base_cli_args()

    new_cmd = [*base, "new", "--session", session_name]
    if profile.gpu:
        new_cmd.extend(["--gpu", profile.gpu])
    if profile.high_mem:
        new_cmd.append("--high-mem")

    upload_cmd = [
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

    stop_cmd = [*base, "stop", "--session", session_name]
    usage_cmd = [*base, "usage"]

    return {
        "usage": usage_cmd,
        "new": new_cmd,
        "upload": upload_cmd,
        "exec": exec_cmd,
        "stop": stop_cmd,
    }


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
) -> Dict[str, Any]:
    """
    编排一次端到端的 Colab 远端训练作业：
      - dry_run=True 时仅生成安全代码包、Worker 脚本及脱敏后的 CLI 命令清单，零算力消耗
      - dry_run=False 时严格执行 new -> upload -> exec -> finally stop，杜绝孤儿实例空耗 CU
    """
    if profile_name not in COLAB_PROFILES:
        raise KeyError(f"未知 Colab 训练规格: {profile_name}")

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
    )
    worker_path.write_text(worker_code, encoding="utf-8")

    merged_remote_env: Dict[str, str] = {}
    if gcs_bucket:
        merged_remote_env["GCS_BUCKET"] = gcs_bucket
    if gcs_archive_uri:
        merged_remote_env["GCS_ARCHIVE_URI"] = gcs_archive_uri
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
    )
    sub_env = build_colab_subprocess_env(acc)

    result: Dict[str, Any] = {
        "dryRun": bool(dry_run),
        "profile": profile.name,
        "gpu": profile.gpu or "CPU",
        "highMem": profile.high_mem,
        "estimatedCuPerHr": profile.estimated_cu_per_hr,
        "artifactVersion": artifact_version,
        "sessionName": sess,
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

    session_created = False
    try:
        subprocess.run(plan["usage"], env=sub_env, check=True)
        subprocess.run(plan["new"], env=sub_env, check=True)
        session_created = True
        subprocess.run(plan["upload"], env=sub_env, check=True)
        subprocess.run(plan["exec"], env=sub_env, check=True)
        result["executed"] = True
    finally:
        if session_created:
            subprocess.run(plan["stop"], env=sub_env, check=False)

    return result
