"""Colab 代码安全打包、敏感参数脱敏与已知 Google Drive/GCS 数据集规格。"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import os
from pathlib import Path
import shlex
import tarfile
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from recsys.colab.profiles import ColabAccountConfig

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
class DriveDatasetSpec:
    """已知 Google Drive 数据集源与对应的 GCS 中转子目录约束。"""

    name: str
    drive_folder_id: str
    drive_folder_label: str
    gcs_subdir: str
    required_files: Tuple[str, ...]
    optional_files: Tuple[str, ...] = ()


KNOWN_DRIVE_DATASET_SPECS: Dict[str, DriveDatasetSpec] = {
    "kuai_two_tower": DriveDatasetSpec(
        name="kuai_two_tower",
        drive_folder_id="1rDaxJMNni7jX9rB-dwX77RGEztRhKMEZ",
        drive_folder_label="MyDrive/ml-services/data",
        gcs_subdir="datasets/kuai_two_tower",
        required_files=(
            "train_samples.pkl",
            "dev_samples.pkl",
            "news_vocab.pkl",
            "user_vocab.pkl",
        ),
        optional_files=(
            "news_dict.pkl",
            "preprocess_manifest.json",
        ),
    ),
    "kuairand_raw": DriveDatasetSpec(
        name="kuairand_raw",
        drive_folder_id="13kVGVtyFBgZtGDNXZSKaR7LwVGgK0Jyg",
        drive_folder_label="MyDrive/ml-services/data/KuaiRand/KuaiRand-27K/data",
        gcs_subdir="datasets/kuairand_raw",
        required_files=(
            "video_features_basic_27k.csv",
            "log_standard_4_08_to_4_21_27k_part1.csv",
            "log_standard_4_08_to_4_21_27k_part2.csv",
            "log_standard_4_22_to_5_08_27k_part1.csv",
            "log_standard_4_22_to_5_08_27k_part2.csv",
            "log_random_4_22_to_5_08_27k.csv",
        ),
        optional_files=("user_features_27k.csv",),
    ),
}


def parse_gcs_uri(uri: str) -> Tuple[str, str]:
    """解析 gs://bucket/prefix 格式 URI 为 (bucket, stripped_prefix)。"""
    cleaned = (uri or "").strip()
    if not cleaned.startswith("gs://"):
        raise ValueError(f"无效 GCS URI（须以 gs:// 开头）: {uri!r}")
    rest = cleaned[5:]
    bucket, _, prefix = rest.partition("/")
    if not bucket:
        raise ValueError(f"GCS URI 缺少桶名: {uri!r}")
    return bucket, prefix.strip("/")


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
            key, sep, _val = token.partition("=")
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
