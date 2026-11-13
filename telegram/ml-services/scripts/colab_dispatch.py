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
    parser.add_argument("--dataset-uri", default="", help="数据集 GCS 前缀（如 gs://telegram-467705-recsys/datasets/...）")
    parser.add_argument("--drive-data-dir", default="", help="预挂载 Drive 数据目录（如 /content/drive/MyDrive/...）")
    parser.add_argument("--drive-output-dir", default="", help="预挂载 Drive 输出同步目录（自动写回模型产物与分片数据集）")
    parser.add_argument("--drive-init-from", default="", help="预挂载 Drive 预训练 Phoenix V2 检查点目录")
    parser.add_argument("--drive-aux-samples-dir", default="", help="预挂载 Drive 微调回放锚点数据目录")
    parser.add_argument("--init-from-gcs", default="", help="预训练检查点 GCS URI（如 gs://.../pretrain/<ver>/phoenix_v2）")
    parser.add_argument("--aux-samples-uri", default="", help="迁移微调纯训练回放锚点数据 GCS 前缀")
    parser.add_argument("--aux-max-groups", type=int, default=2000, help="回放锚点最大混入 slate 组数")
    parser.add_argument("--base-artifact-version", default="", help="微调发布合入的基线 Two-Tower/FAISS 版本号")
    parser.add_argument(
        "--faiss-index-type",
        choices=["flat", "ivf", "hnsw", "ivf_pq"],
        default="ivf_pq",
        help="FAISS 索引构建与验证类型",
    )
    parser.add_argument("--publish", action="store_true", help="通过门禁校验后上传产出到 GCS")
    parser.add_argument(
        "--allow-pretrain-publish",
        action="store_true",
        help="显式允许 pretrain/预处理阶段向隔离前缀 gs://<bucket>/pretrain/ 或 datasets/ 上传",
    )
    parser.add_argument("--session", default=None, help="自定义远端会话名")
    parser.add_argument("--reuse-session", action="store_true", help="复用已认证/挂载的现有具名会话（跳过 colab new）")
    parser.add_argument("--keep-session", action="store_true", help="作业完成后保留会话不自动 colab stop")
    parser.add_argument("--epochs", type=int, default=None, help="覆盖 profile 默认训练轮数")
    parser.add_argument("--batch-size", type=int, default=None, help="覆盖 profile 默认 batch size")
    parser.add_argument("--lr", type=float, default=None, help="覆盖 profile 默认学习率")
    parser.add_argument("--backbone-lr-scale", type=float, default=None, help="覆盖微调主干差分学习率缩放因子")
    parser.add_argument("--user-sample-mod", type=int, default=10, help="KuaiRand 确定性用户取模抽样比例（1 表示全量，10 表示 1/10）")
    parser.add_argument("--max-train-slates", type=int, default=400_000, help="KuaiRand 预处理保留的最大训练 slate 数")
    parser.add_argument("--max-val-rand-slates", type=int, default=50_000, help="KuaiRand 预处理保留的最大随机验证 slate 数")
    parser.add_argument("--shard-slates", type=int, default=50_000, help="KuaiRand 流式分片大小（每个 part_*.pkl.gz 的 slate 数）")
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
        gcs_dataset_uri=args.dataset_uri,
        drive_data_dir=args.drive_data_dir,
        drive_output_dir=args.drive_output_dir,
        drive_init_from=args.drive_init_from,
        drive_aux_samples_dir=args.drive_aux_samples_dir,
        gcs_init_from_uri=args.init_from_gcs,
        gcs_aux_samples_uri=args.aux_samples_uri,
        aux_max_groups=args.aux_max_groups,
        base_artifact_version=args.base_artifact_version,
        faiss_index_type=args.faiss_index_type,
        allow_pretrain_publish=args.allow_pretrain_publish,
        reuse_session=args.reuse_session,
        keep_session=args.keep_session,
        epochs_override=args.epochs,
        batch_size_override=args.batch_size,
        lr_override=args.lr,
        backbone_lr_scale_override=args.backbone_lr_scale,
        user_sample_mod=args.user_sample_mod,
        max_train_slates=args.max_train_slates,
        max_val_rand_slates=args.max_val_rand_slates,
        shard_slates=args.shard_slates,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
