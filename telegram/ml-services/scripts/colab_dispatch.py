#!/usr/bin/env python3
"""Colab CLI 训练调度统一入口（仅使用当前认证的 acct1 算力池）。"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

_ML_SERVICES_ROOT = Path(__file__).resolve().parent.parent
if str(_ML_SERVICES_ROOT) not in sys.path:
    sys.path.insert(0, str(_ML_SERVICES_ROOT))

from recsys.colab.orchestrator import (  # noqa: E402
    COLAB_PROFILES,
    ColabAccountConfig,
    build_colab_subprocess_env,
    dispatch_colab_job,
    format_redacted_command,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="使用 google-colab-cli v0.8.0 调度推荐算法训练")
    parser.add_argument(
        "--profile",
        choices=sorted(COLAB_PROFILES.keys()),
        default="phoenix-v2-mini-t4",
        help="选择预定义算力与模型训练组合",
    )
    parser.add_argument("--artifact-version", required=False, default="manual_v2", help="目标产物版本号")
    parser.add_argument("--cloudsdk-config", default="~/.config/gcloud-colab-1", help="ADC 目录")
    parser.add_argument("--colab-config", default="~/.config/colab-cli/acct1.json", help="colab-cli 会话凭证文件")
    parser.add_argument("--gcs-bucket", default="", help="目标产物 GCS 桶名（不含 gs://）")
    parser.add_argument("--gcs-archive-uri", default="", help="可选用户行为归档 GCS URI（gs://...）")
    parser.add_argument("--publish", action="store_true", help="通过门禁校验后上传产出到 GCS")
    parser.add_argument("--session", default=None, help="自定义远端会话名")
    parser.add_argument("--max-cpu-p95-ms", type=float, default=120.0, help="Phoenix V2 推理 P95 门禁阈值(ms)")
    parser.add_argument(
        "--pass-env",
        action="append",
        default=[],
        help="将本地已设置的环境变量透传给远端内核（如 --pass-env MONGO_URI）",
    )
    parser.add_argument("--check-usage", action="store_true", help="仅查看当前 acct1 算力余额后退出")
    parser.add_argument("--dry-run", action="store_true", help="仅打印生成的代码包、脚本与脱敏命令，不消耗算力")
    parser.add_argument("--launch", action="store_true", help="显式确认启动真实 Colab 算力会话")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    account = ColabAccountConfig(
        cloudsdk_config=args.cloudsdk_config,
        colab_config=args.colab_config,
    )

    if args.check_usage:
        cmd = [*account.base_cli_args(), "usage"]
        sub_env = build_colab_subprocess_env(account)
        if args.dry_run:
            print(json.dumps({"usageCommand": format_redacted_command(cmd)}, ensure_ascii=False, indent=2))
            return
        subprocess.run(cmd, env=sub_env, check=True)
        return

    if not args.dry_run and not args.launch:
        # 严格安全默认：未显式传入 --launch 时自动进入 dry-run 预览模式，防止误触扣费
        args.dry_run = True

    remote_env = {}
    for var_name in args.pass_env:
        val = os.getenv(var_name, "")
        if val:
            remote_env[var_name] = val

    result = dispatch_colab_job(
        profile_name=args.profile,
        artifact_version=args.artifact_version,
        ml_services_dir=_ML_SERVICES_ROOT,
        account=account,
        gcs_bucket=args.gcs_bucket,
        gcs_archive_uri=args.gcs_archive_uri,
        publish_to_gcs=args.publish,
        remote_env=remote_env,
        session_name=args.session,
        dry_run=args.dry_run,
        max_cpu_p95_ms=args.max_cpu_p95_ms,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
