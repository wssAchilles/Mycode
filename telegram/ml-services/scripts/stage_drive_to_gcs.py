#!/usr/bin/env python3
"""将已授权 Google Drive 中的 KuaiRand / KuaiRec 数据流式中转至私有 GCS 桶，供无交互 Colab CLI 直接读取。"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence
import urllib.parse
import urllib.request

_ML_SERVICES_ROOT = Path(__file__).resolve().parent.parent
if str(_ML_SERVICES_ROOT) not in sys.path:
    sys.path.insert(0, str(_ML_SERVICES_ROOT))

from recsys.colab.datasets import KNOWN_DRIVE_DATASET_SPECS, DriveDatasetSpec  # noqa: E402

_CHUNK_BYTES = 16 * 1024 * 1024


def _resolve_drive_token(cloudsdk_config: str = "") -> str:
    env_tok = os.getenv("DRIVE_ACCESS_TOKEN", "").strip()
    if env_tok:
        return env_tok
    env = dict(os.environ)
    if cloudsdk_config:
        env["CLOUDSDK_CONFIG"] = str(Path(cloudsdk_config).expanduser())
    else:
        env.pop("CLOUDSDK_CONFIG", None)
    return subprocess.check_output(["gcloud", "auth", "print-access-token"], env=env, text=True).strip()


def list_drive_folder_files(folder_id: str, token: str) -> Dict[str, Dict[str, Any]]:
    """枚举指定 Google Drive 目录下的非回收站文件（filename -> metadata）。"""
    out: Dict[str, Dict[str, Any]] = {}
    page_token: Optional[str] = None
    while True:
        params: Dict[str, Any] = {
            "q": f"trashed=false and '{folder_id}' in parents",
            "fields": "nextPageToken,files(id,name,size,mimeType,md5Checksum)",
            "pageSize": 200,
        }
        if page_token:
            params["pageToken"] = page_token
        url = "https://www.googleapis.com/drive/v3/files?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        for item in payload.get("files", []):
            name = str(item.get("name") or "")
            if name:
                out[name] = item
        page_token = payload.get("nextPageToken")
        if not page_token:
            break
    return out


def _download_drive_file_streaming(file_id: str, token: str, dst_path: Path) -> None:
    url = f"https://www.googleapis.com/drive/v3/files/{urllib.parse.quote(file_id)}?alt=media"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=600) as resp, open(dst_path, "wb") as out:
        while True:
            chunk = resp.read(_CHUNK_BYTES)
            if not chunk:
                break
            out.write(chunk)


def _select_specs(dataset: str) -> List[DriveDatasetSpec]:
    if dataset == "all":
        return [KNOWN_DRIVE_DATASET_SPECS["kuai_two_tower"], KNOWN_DRIVE_DATASET_SPECS["kuairand_raw"]]
    if dataset not in KNOWN_DRIVE_DATASET_SPECS:
        raise KeyError(f"未知数据集标识: {dataset}，可选: {sorted(KNOWN_DRIVE_DATASET_SPECS)} 或 all")
    return [KNOWN_DRIVE_DATASET_SPECS[dataset]]


def stage_datasets_to_gcs(
    *,
    dataset: str,
    bucket_name: str,
    prefix_override: str = "",
    execute: bool = False,
    cloudsdk_config: str = "",
    drive_token: Optional[str] = None,
    list_files_fn: Optional[Callable[[str, str], Dict[str, Dict[str, Any]]]] = None,
    gcs_bucket: Any = None,
) -> Dict[str, Any]:
    """
    规划或执行 Google Drive -> GCS 单文件中转同步：
      - execute=False 时仅核对 Drive 必需文件存在性与 GCS 已有字节大小，不产生流量与写操作
      - 按单文件流式下载再立即清理临时文件，防止一次性占用过多本地磁盘
    """
    specs = _select_specs(dataset)
    token = drive_token if drive_token is not None else _resolve_drive_token(cloudsdk_config)
    lister = list_files_fn or list_drive_folder_files

    bucket = gcs_bucket
    if bucket is None:
        from google.cloud import storage

        client = storage.Client()
        bucket = client.bucket(bucket_name)

    plan_entries: List[Dict[str, Any]] = []
    missing_required: List[str] = []

    for spec in specs:
        drive_map = lister(spec.drive_folder_id, token)
        target_prefix = prefix_override.strip("/") if prefix_override else spec.gcs_subdir
        if prefix_override and len(specs) > 1:
            target_prefix = f"{prefix_override.strip('/')}/{spec.name}"

        for req_name in spec.required_files:
            if req_name not in drive_map:
                missing_required.append(f"{spec.name}/{req_name}")

        candidate_names: Sequence[str] = (*spec.required_files, *spec.optional_files)
        for fname in candidate_names:
            meta = drive_map.get(fname)
            if meta is None:
                continue
            drive_size = int(meta.get("size") or 0)
            dst_key = f"{target_prefix}/{fname}"
            blob = bucket.blob(dst_key)
            remote_exists = bool(blob.exists())
            remote_size = int(blob.size or 0) if remote_exists else 0
            if remote_exists and drive_size > 0 and remote_size == drive_size:
                action = "skip_existing"
            else:
                action = "upload"
            plan_entries.append(
                {
                    "dataset": spec.name,
                    "driveFileId": meta["id"],
                    "fileName": fname,
                    "sizeBytes": drive_size,
                    "gcsUri": f"gs://{bucket_name}/{dst_key}",
                    "dstKey": dst_key,
                    "action": action,
                }
            )

    if missing_required:
        raise FileNotFoundError(f"Drive 目录缺少必需数据集文件: {missing_required}")

    result: Dict[str, Any] = {
        "dryRun": not execute,
        "dataset": dataset,
        "bucket": bucket_name,
        "totalFiles": len(plan_entries),
        "uploadFiles": sum(1 for e in plan_entries if e["action"] == "upload"),
        "skippedFiles": sum(1 for e in plan_entries if e["action"] == "skip_existing"),
        "uploadBytes": sum(int(e["sizeBytes"]) for e in plan_entries if e["action"] == "upload"),
        "files": plan_entries,
    }
    if not execute:
        return result

    with tempfile.TemporaryDirectory(prefix="drive_to_gcs_") as tmp_dir:
        tmp_root = Path(tmp_dir)
        for entry in plan_entries:
            if entry["action"] != "upload":
                continue
            tmp_file = tmp_root / entry["fileName"]
            print(
                f"[stage] downloading {entry['fileName']} ({entry['sizeBytes'] / (1024 * 1024):.1f} MB)...",
                flush=True,
            )
            _download_drive_file_streaming(entry["driveFileId"], token, tmp_file)
            blob = bucket.blob(entry["dstKey"])
            blob.chunk_size = _CHUNK_BYTES
            print(f"[stage] uploading -> {entry['gcsUri']}", flush=True)
            blob.upload_from_filename(str(tmp_file))
            tmp_file.unlink(missing_ok=True)
            entry["status"] = "uploaded"

    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Stage KuaiRand/KuaiRec datasets from Google Drive to GCS")
    parser.add_argument(
        "--dataset",
        choices=["kuai_two_tower", "kuairand_raw", "all"],
        default="kuai_two_tower",
        help="要中转至 GCS 的已知数据集名称",
    )
    parser.add_argument("--bucket", default="telegram-467705-recsys", help="目标 GCS 桶名")
    parser.add_argument("--prefix", default="", help="可选覆盖默认 GCS 前缀（默认 datasets/<name>）")
    parser.add_argument("--cloudsdk-config", default="", help="可选指定获取 gcloud token 的配置目录")
    parser.add_argument("--dry-run", action="store_true", help="仅核对文件并打印同步计划（默认模式）")
    parser.add_argument("--execute", action="store_true", help="显式执行流式下载并上传到 GCS")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    execute = bool(args.execute) and not bool(args.dry_run)
    report = stage_datasets_to_gcs(
        dataset=args.dataset,
        bucket_name=args.bucket,
        prefix_override=args.prefix,
        execute=execute,
        cloudsdk_config=args.cloudsdk_config,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
