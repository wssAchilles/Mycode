"""Colab 远端 Python Worker 脚本渲染器：支持数据拉取、FAISS 构建、预训练、迁移微调与发布门禁。"""

from __future__ import annotations

import json
from typing import Any, Dict, Optional

from recsys.colab.profiles import ColabTrainingProfile

_WORKER_TEMPLATE = '''#!/usr/bin/env python3
"""Colab 远端训练执行入口（由 recsys.colab.worker_template 自动生成）。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import pickle
import shutil
import subprocess
import sys
import tarfile
import threading
import time

JOB_CONFIG = json.loads(__JOB_CONFIG_LITERAL__)
WORKDIR = Path("/content/ml-services")
BUNDLE_PATH = Path("/content/ml_services_bundle.tar.gz")


def _extract_bundle() -> None:
    import inspect

    if WORKDIR.exists():
        # 清理旧代码目录，保障每次运行使用最新同步包
        for sub in ("recsys", "scripts", "src"):
            target = WORKDIR / sub
            if target.exists():
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


def _ensure_dependencies(task: str, *, need_gcs: bool = False, need_mongo: bool = False) -> None:
    needed = []
    deps = [
        ("sklearn", "scikit-learn"),
        ("tqdm", "tqdm"),
    ]
    if need_mongo:
        deps.extend([("pymongo", "pymongo[srv]"), ("bson", "pymongo"), ("dns.resolver", "dnspython")])
    if need_gcs:
        deps.append(("google.cloud.storage", "google-cloud-storage"))
    if task == "two-tower":
        deps.append(("faiss", "faiss-cpu"))
    if task.startswith("v3-"):
        deps.extend(
            [
                ("safetensors", "safetensors"),
                ("onnx", "onnx"),
                ("onnxruntime", "onnxruntime"),
                ("pyarrow", "pyarrow"),
                ("scipy", "scipy"),
                ("faiss", "faiss-cpu"),
            ]
        )
    for mod, pkg in deps:
        try:
            __import__(mod)
        except Exception:
            if pkg not in needed:
                needed.append(pkg)
    if needed:
        print(f"[setup] installing missing packages: {needed}", flush=True)
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", *needed], check=True)


def _start_heartbeat(stop_event: threading.Event, label: str) -> threading.Thread:
    start = time.monotonic()

    def _beat() -> None:
        while not stop_event.wait(30.0):
            elapsed = int(time.monotonic() - start)
            print(f"[heartbeat] profile={label} elapsed={elapsed}s", flush=True)

    thread = threading.Thread(target=_beat, daemon=True)
    thread.start()
    return thread


def _parse_gcs_uri(uri: str) -> tuple[str, str]:
    cleaned = (uri or "").strip()
    if not cleaned.startswith("gs://"):
        raise ValueError(f"无效 GCS URI: {uri!r}")
    bucket, _, prefix = cleaned[5:].partition("/")
    if not bucket:
        raise ValueError(f"GCS URI 缺少桶名: {uri!r}")
    return bucket, prefix.strip("/")


def _download_gcs_prefix(gcs_uri: str, dest_dir: Path) -> list[Path]:
    from google.cloud import storage

    bucket_name, prefix = _parse_gcs_uri(gcs_uri)
    client = storage.Client()
    bucket = client.bucket(bucket_name)
    prefix_with_slash = f"{prefix}/" if prefix and not prefix.endswith("/") else prefix
    dest_dir.mkdir(parents=True, exist_ok=True)
    downloaded: list[Path] = []
    blobs = list(client.list_blobs(bucket, prefix=prefix_with_slash))
    if not blobs and prefix:
        # 兼容传入精确单对象路径而非前缀目录
        blob = bucket.blob(prefix)
        if blob.exists():
            blobs = [blob]

    for blob in blobs:
        if blob.name.endswith("/"):
            continue
        if prefix_with_slash and blob.name.startswith(prefix_with_slash):
            rel = blob.name[len(prefix_with_slash) :]
        else:
            rel = Path(blob.name).name
        target = dest_dir / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and blob.size is not None and target.stat().st_size == int(blob.size):
            downloaded.append(target)
            continue
        print(f"[gcs-download] gs://{bucket_name}/{blob.name} -> {target}", flush=True)
        blob.download_to_filename(str(target))
        downloaded.append(target)
    return downloaded


def _upload_directory_to_gcs(src_dir: Path, gcs_uri: str) -> int:
    from google.cloud import storage

    bucket_name, prefix = _parse_gcs_uri(gcs_uri)
    client = storage.Client()
    bucket = client.bucket(bucket_name)
    uploaded = 0
    for path in sorted(src_dir.rglob("*")):
        if path.is_dir():
            continue
        rel = path.relative_to(src_dir).as_posix()
        dst_key = f"{prefix}/{rel}" if prefix else rel
        blob = bucket.blob(dst_key)
        blob.upload_from_filename(str(path))
        print(f"[gcs-upload] {path} -> gs://{bucket_name}/{dst_key}", flush=True)
        uploaded += 1
    return uploaded


def _stage_local_or_gcs(
    *,
    drive_dir: str,
    gcs_uri: str,
    target_dir: Path,
    required_files: tuple[str, ...] = (),
) -> Path:
    target_dir.mkdir(parents=True, exist_ok=True)
    if drive_dir:
        src = Path(drive_dir)
        if src.exists():
            print(f"[stage] using local/Drive directory: {src}", flush=True)
            for path in src.iterdir():
                dst = target_dir / path.name
                if path.is_file() and not dst.exists():
                    shutil.copy2(path, dst)
            for req in required_files:
                if not (target_dir / req).exists():
                    raise FileNotFoundError(f"Drive 目录缺少必需文件 {req} (已检查 {src})")
            return src
        raise FileNotFoundError(f"指定的本地/Drive 数据目录不存在: {src}")
    if gcs_uri:
        files = _download_gcs_prefix(gcs_uri, target_dir)
        if not files:
            raise FileNotFoundError(f"GCS 数据前缀为空: {gcs_uri}")
        for req in required_files:
            if not (target_dir / req).exists():
                raise FileNotFoundError(f"缺少必需数据文件 {req} (已搜索 {target_dir})")
        return target_dir
    for req in required_files:
        if not (target_dir / req).exists():
            raise FileNotFoundError(f"未配置数据来源且本地缺少必需文件 {target_dir / req}")
    return target_dir


def _download_pretrained_checkpoint(gcs_init_uri: str, init_dir: Path) -> Path:
    init_dir.mkdir(parents=True, exist_ok=True)
    files = _download_gcs_prefix(gcs_init_uri, init_dir)
    if not files:
        raise FileNotFoundError(f"未能在 GCS 路径找到预训练检查点: {gcs_init_uri}")

    candidates_pt = [
        init_dir / "phoenix_v2_inference.pt",
        init_dir / "phoenix_v2" / "model.pt",
        init_dir / "model.pt",
    ]
    candidates_cfg = [
        init_dir / "phoenix_v2_config.json",
        init_dir / "phoenix_v2" / "config.json",
        init_dir / "config.json",
    ]
    pt_src = next((p for p in candidates_pt if p.exists()), None)
    if pt_src is None:
        pt_src = next((p for p in init_dir.rglob("*.pt")), None)
    if pt_src is None:
        raise FileNotFoundError(f"下载的预训练目录中找不到 .pt 权重文件: {init_dir}")

    norm_pt = init_dir / "phoenix_v2_inference.pt"
    if pt_src != norm_pt:
        shutil.copy2(pt_src, norm_pt)

    cfg_src = next((p for p in candidates_cfg if p.exists()), None)
    if cfg_src is None:
        cfg_src = next((p for p in init_dir.rglob("*config*.json")), None)
    if cfg_src is not None:
        norm_cfg = init_dir / "phoenix_v2_config.json"
        if cfg_src != norm_cfg:
            shutil.copy2(cfg_src, norm_cfg)
    return norm_pt


def _stage_base_serving_artifacts(
    *,
    gcs_bucket: str,
    base_version: str,
    faiss_index_type: str,
    models_dir: Path,
    data_dir: Path,
) -> None:
    from google.cloud import storage

    if not gcs_bucket or not base_version:
        return
    client = storage.Client()
    bucket = client.bucket(gcs_bucket)
    mappings = [
        (f"artifacts/{base_version}/two_tower/model.pt", models_dir / "two_tower_epoch_latest.pt", True),
        (f"artifacts/{base_version}/faiss/faiss_{faiss_index_type}.index", models_dir / f"faiss_{faiss_index_type}.index", True),
        (f"artifacts/{base_version}/faiss/faiss_id_mapping.pkl", models_dir / "faiss_id_mapping.pkl", True),
        (f"artifacts/{base_version}/data/news_vocab.pkl", data_dir / "news_vocab.pkl", True),
        (f"artifacts/{base_version}/data/user_vocab.pkl", data_dir / "user_vocab.pkl", True),
        (f"artifacts/{base_version}/data/news_dict.pkl", data_dir / "news_dict.pkl", False),
        (f"artifacts/{base_version}/manifest/preprocess_manifest.json", data_dir / "preprocess_manifest.json", False),
    ]
    for src_key, dst_path, required in mappings:
        blob = bucket.blob(src_key)
        if not blob.exists():
            if required:
                raise FileNotFoundError(f"基线线上产物缺失: gs://{gcs_bucket}/{src_key}")
            continue
        dst_path.parent.mkdir(parents=True, exist_ok=True)
        print(f"[stage-base] gs://{gcs_bucket}/{src_key} -> {dst_path}", flush=True)
        blob.download_to_filename(str(dst_path))


def _stage_base_serving_artifacts_from_drive(
    *,
    drive_base_dir: str,
    faiss_index_type: str,
    models_dir: Path,
    data_dir: Path,
) -> None:
    base_root = Path(drive_base_dir)
    if not base_root.exists():
        raise FileNotFoundError(f"Drive 基线 Two-Tower/FAISS 目录不存在: {base_root}")

    def _pick(sub: str, fname: str) -> Path | None:
        for candidate in (base_root / sub / fname, base_root / fname):
            if candidate.exists() and candidate.is_file():
                return candidate
        return None

    mappings = [
        ("models", "two_tower_epoch_latest.pt", models_dir / "two_tower_epoch_latest.pt", True),
        ("models", f"faiss_{faiss_index_type}.index", models_dir / f"faiss_{faiss_index_type}.index", True),
        ("models", "faiss_id_mapping.pkl", models_dir / "faiss_id_mapping.pkl", True),
        ("data", "news_vocab.pkl", data_dir / "news_vocab.pkl", True),
        ("data", "user_vocab.pkl", data_dir / "user_vocab.pkl", True),
        ("data", "item_embeddings.npy", data_dir / "item_embeddings.npy", False),
        ("data", "news_dict.pkl", data_dir / "news_dict.pkl", False),
        ("data", "preprocess_manifest.json", data_dir / "preprocess_manifest.json", False),
    ]
    for sub, fname, dst_path, required in mappings:
        src_path = _pick(sub, fname)
        if src_path is None:
            if required:
                raise FileNotFoundError(f"Drive 基线目录缺少必需文件 {sub}/{fname}: {base_root}")
            continue
        dst_path.parent.mkdir(parents=True, exist_ok=True)
        print(f"[stage-base-drive] {src_path} -> {dst_path}", flush=True)
        shutil.copy2(src_path, dst_path)


def _run_export_training_data(
    *,
    samples_path: Path,
    local_jsonl_dir: str,
    gcs_archive_uri: str,
    mongo_uri: str,
    export_days: int,
) -> None:
    cmd = [
        sys.executable,
        str(WORKDIR / "scripts" / "export_training_data.py"),
        "--output",
        str(samples_path),
        "--days",
        str(int(export_days)),
    ]
    if local_jsonl_dir:
        cmd.extend(["--local-jsonl-dir", local_jsonl_dir])
    if gcs_archive_uri:
        cmd.extend(["--gcs-archive-uri", gcs_archive_uri])
    if mongo_uri:
        cmd.extend(["--mongo-uri", mongo_uri, "--include-user-signals"])
    subprocess.run(cmd, check=True)


def _create_smoke_fixture(data_dir: Path, models_dir: Path) -> Path:
    from recsys.contracts.actions import ACTION_TYPE_MAP

    data_dir.mkdir(parents=True, exist_ok=True)
    models_dir.mkdir(parents=True, exist_ok=True)
    base_ts = datetime(2026, 11, 10, 0, 0, 0, tzinfo=timezone.utc)
    samples = []
    for i in range(32):
        engaged = i % 2 == 0
        samples.append(
            {
                "user_id": f"smoke_u_{i % 4}",
                "history": [
                    (f"smoke_hp_{j}", f"smoke_ha_{j % 2}", ACTION_TYPE_MAP["like" if j % 2 == 0 else "click"], j % 5)
                    for j in range(4)
                ],
                "candidate_post_id": f"smoke_cp_{i}",
                "candidate_author_id": f"smoke_ha_{i % 2}",
                "labels": {
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
                },
                "dwell_ms": 12000 if engaged else 300,
                "in_network": engaged,
                "has_video": i % 3 == 0,
                "action_time": (base_ts + timedelta(minutes=i * 10)).isoformat(),
                "is_positive": engaged,
            }
        )
    out = data_dir / "phoenix_v2_samples.pkl"
    with open(out, "wb") as f:
        pickle.dump(samples, f, protocol=pickle.HIGHEST_PROTOCOL)
    return out


def main() -> None:
    task = str(JOB_CONFIG["task"])
    _extract_bundle()
    drive_data_dir = str(JOB_CONFIG.get("drive_data_dir") or os.getenv("DRIVE_DATA_DIR", ""))
    drive_output_dir = str(JOB_CONFIG.get("drive_output_dir") or os.getenv("DRIVE_OUTPUT_DIR", ""))
    drive_init_from = str(JOB_CONFIG.get("drive_init_from") or os.getenv("DRIVE_INIT_FROM", ""))
    drive_aux_samples_dir = str(JOB_CONFIG.get("drive_aux_samples_dir") or os.getenv("DRIVE_AUX_SAMPLES_DIR", ""))
    drive_base_dir = str(JOB_CONFIG.get("drive_base_dir") or os.getenv("DRIVE_BASE_DIR", ""))
    local_jsonl_dir = str(JOB_CONFIG.get("local_jsonl_dir") or os.getenv("LOCAL_JSONL_DIR", ""))
    gcs_dataset_uri = str(JOB_CONFIG.get("gcs_dataset_uri") or os.getenv("GCS_DATASET_URI", ""))
    gcs_bucket = str(JOB_CONFIG.get("gcs_bucket") or os.getenv("GCS_BUCKET", ""))
    gcs_archive_uri = str(JOB_CONFIG.get("gcs_archive_uri") or os.getenv("GCS_ARCHIVE_URI", ""))
    gcs_init_from_uri = str(JOB_CONFIG.get("gcs_init_from_uri") or os.getenv("GCS_INIT_FROM_URI", ""))
    gcs_aux_samples_uri = str(JOB_CONFIG.get("gcs_aux_samples_uri") or os.getenv("GCS_AUX_SAMPLES_URI", ""))
    base_version = str(JOB_CONFIG.get("base_artifact_version") or os.getenv("GCS_BASE_ARTIFACT_VERSION", ""))
    faiss_index_type = str(JOB_CONFIG.get("faiss_index_type") or os.getenv("FAISS_INDEX_TYPE", "ivf_pq"))
    allow_pretrain_publish = bool(JOB_CONFIG.get("allow_pretrain_publish", False))
    mongo_uri = os.getenv("MONGO_URI", "")

    need_gcs = bool(gcs_bucket or gcs_archive_uri or gcs_dataset_uri or gcs_init_from_uri or gcs_aux_samples_uri)
    need_mongo = bool(mongo_uri) and task in ("phoenix-v2", "phoenix-v2-finetune", "sidecars")
    _ensure_dependencies(task, need_gcs=need_gcs, need_mongo=need_mongo)

    from recsys.colab.gates import evaluate_promotion_gate
    from recsys.contracts.artifacts import build_serving_manifest
    from recsys.data.kuairand_phoenix import KuaiRandConvertConfig, convert_kuairand_to_phoenix_v2
    from recsys.training.calibration_and_sidecars import run_sidecar_training
    from recsys.training.phoenix_v2_trainer import PhoenixV2TrainConfig, train_phoenix_v2
    from recsys.training.two_tower_trainer import TwoTowerTrainConfig, train_two_tower

    stop_event = threading.Event()
    _start_heartbeat(stop_event, JOB_CONFIG["profile"])
    data_dir = WORKDIR / "data"
    models_dir = WORKDIR / "models"
    data_dir.mkdir(parents=True, exist_ok=True)
    models_dir.mkdir(parents=True, exist_ok=True)

    report: dict = {}
    try:
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
            _stage_local_or_gcs(
                drive_dir=drive_data_dir,
                gcs_uri=gcs_dataset_uri,
                target_dir=data_dir,
                required_files=("train_samples.pkl", "news_vocab.pkl", "user_vocab.pkl"),
            )
            report = train_two_tower(
                TwoTowerTrainConfig(
                    data_dir=data_dir,
                    models_dir=models_dir,
                    epochs=int(JOB_CONFIG["epochs"]),
                    batch_size=int(JOB_CONFIG["batch_size"]),
                    lr=float(JOB_CONFIG["lr"]),
                )
            )
            subprocess.run(
                [
                    sys.executable,
                    str(WORKDIR / "scripts" / "build_faiss_index.py"),
                    "--type",
                    faiss_index_type,
                    "--data-dir",
                    str(data_dir),
                    "--models-dir",
                    str(models_dir),
                    "--no-benchmark",
                ],
                check=True,
            )
        elif task == "kuairand-prep":
            raw_dir = Path(drive_data_dir) if (drive_data_dir and Path(drive_data_dir).exists()) else (data_dir / "kuairand_raw")
            if not raw_dir.exists() or not any(raw_dir.glob("*.csv*")):
                if not gcs_dataset_uri:
                    raise FileNotFoundError("kuairand-prep 需要 --drive-data-dir 或 --dataset-uri")
                _download_gcs_prefix(gcs_dataset_uri, raw_dir)
            prep_out = data_dir / "kuairand_phoenix"
            report = convert_kuairand_to_phoenix_v2(
                KuaiRandConvertConfig(
                    kuairand_dir=raw_dir,
                    output_dir=prep_out,
                    max_history=int(JOB_CONFIG["max_history"]),
                    max_candidates=int(JOB_CONFIG["max_candidates"]),
                    max_train_slates=int(JOB_CONFIG.get("max_train_slates", 400_000)),
                    max_val_rand_slates=int(JOB_CONFIG.get("max_val_rand_slates", 50_000)),
                    num_buckets=int(JOB_CONFIG.get("num_buckets", 32)),
                    user_sample_mod=int(JOB_CONFIG.get("user_sample_mod", 10)),
                    shard_slates=int(JOB_CONFIG.get("shard_slates", 50_000)),
                )
            )
            (models_dir / "kuairand_prep_report.json").write_text(
                json.dumps(report, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            passed, reasons, gate_details = evaluate_promotion_gate(
                profile_name=str(JOB_CONFIG["profile"]),
                models_dir=models_dir,
                data_dir=data_dir,
                train_report=report,
                allow_pretrain_only=True,
            )
            print(json.dumps({"gatePassed": passed, "reasons": reasons, "details": gate_details}, ensure_ascii=False, indent=2), flush=True)
            if not passed:
                raise RuntimeError(f"KuaiRand prep gate blocked: {reasons}")
            if drive_output_dir:
                dst_prep = Path(drive_output_dir)
                dst_prep.mkdir(parents=True, exist_ok=True)
                shutil.copytree(prep_out, dst_prep, dirs_exist_ok=True)
                shutil.copy2(models_dir / "kuairand_prep_report.json", dst_prep / "kuairand_prep_report.json")
                print(f"[drive-sync] saved preprocessed shards -> {dst_prep}", flush=True)
            if JOB_CONFIG.get("publish_to_gcs") and gcs_bucket:
                if not allow_pretrain_publish:
                    raise RuntimeError("KuaiRand preprocessed dataset publish requires --allow-pretrain-publish")
                target_uri = f"gs://{gcs_bucket}/datasets/kuairand_phoenix/{JOB_CONFIG['artifact_version']}"
                _upload_directory_to_gcs(prep_out, target_uri)
            print(f"[colab-worker] COMPLETED task={task} version={JOB_CONFIG['artifact_version']}", flush=True)
            return
        elif task == "phoenix-v2":
            samples_path = data_dir / "phoenix_v2_samples.pkl"
            if not samples_path.exists() and (drive_data_dir or gcs_dataset_uri):
                _stage_local_or_gcs(drive_dir=drive_data_dir, gcs_uri=gcs_dataset_uri, target_dir=data_dir)
            if not samples_path.exists() and (local_jsonl_dir or gcs_archive_uri or mongo_uri):
                _run_export_training_data(
                    samples_path=samples_path,
                    local_jsonl_dir=local_jsonl_dir,
                    gcs_archive_uri=gcs_archive_uri,
                    mongo_uri=mongo_uri,
                    export_days=int(JOB_CONFIG.get("export_days", 3650)),
                )
            report = train_phoenix_v2(
                PhoenixV2TrainConfig(
                    data_dir=data_dir,
                    models_dir=models_dir,
                    samples_path=samples_path,
                    scale=str(JOB_CONFIG["scale"]),
                    epochs=int(JOB_CONFIG["epochs"]),
                    batch_size=int(JOB_CONFIG["batch_size"]),
                    max_history=int(JOB_CONFIG["max_history"]),
                    max_candidates=int(JOB_CONFIG["max_candidates"]),
                    lr=float(JOB_CONFIG["lr"]),
                )
            )
        elif task == "phoenix-v2-pretrain":
            pretrain_dir = Path(drive_data_dir) if (drive_data_dir and Path(drive_data_dir).exists()) else (data_dir / "kuairand_phoenix")
            if not (pretrain_dir / "train").exists() and gcs_dataset_uri:
                _download_gcs_prefix(gcs_dataset_uri, pretrain_dir)
            train_shards = pretrain_dir / "train"
            if not train_shards.exists():
                raise FileNotFoundError(f"预训练训练分片目录不存在: {train_shards}")
            eval_shards = pretrain_dir / "eval_random"
            has_eval = eval_shards.exists() and any(eval_shards.glob("*.pkl*"))
            report = train_phoenix_v2(
                PhoenixV2TrainConfig(
                    data_dir=data_dir,
                    models_dir=models_dir,
                    samples_path=train_shards,
                    eval_samples_path=eval_shards if has_eval else None,
                    checkpoint_role="pretrain_only",
                    scale=str(JOB_CONFIG["scale"]),
                    epochs=int(JOB_CONFIG["epochs"]),
                    batch_size=int(JOB_CONFIG["batch_size"]),
                    max_history=int(JOB_CONFIG["max_history"]),
                    max_candidates=int(JOB_CONFIG["max_candidates"]),
                    lr=float(JOB_CONFIG["lr"]),
                    num_workers=2,
                )
            )
            pretrain_manifest = build_serving_manifest(
                version=str(JOB_CONFIG["artifact_version"]),
                profile="pretrain",
                faiss_index_type=faiss_index_type,
                models_dir=models_dir,
                data_dir=data_dir,
                model_version=str(JOB_CONFIG["artifact_version"]),
                include_checksums=True,
            )
            (data_dir / "pretrain_manifest.json").write_text(
                json.dumps(pretrain_manifest, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            passed, reasons, gate_details = evaluate_promotion_gate(
                profile_name=str(JOB_CONFIG["profile"]),
                models_dir=models_dir,
                data_dir=data_dir,
                train_report=report,
                max_cpu_p95_ms=float(JOB_CONFIG["max_cpu_p95_ms"]),
                faiss_index_type=faiss_index_type,
                allow_pretrain_only=True,
                manifest_filename="pretrain_manifest.json",
            )
            print(json.dumps({"gatePassed": passed, "reasons": reasons, "details": gate_details}, ensure_ascii=False, indent=2), flush=True)
            if not passed:
                raise RuntimeError(f"Pretrain gate blocked upload: {reasons}")
            if drive_output_dir:
                dst_pre = Path(drive_output_dir)
                dst_pre.mkdir(parents=True, exist_ok=True)
                for fname in (
                    "phoenix_v2_inference.pt",
                    "phoenix_v2_config.json",
                    "phoenix_v2_train_report.json",
                ):
                    src_f = models_dir / fname
                    if src_f.exists():
                        shutil.copy2(src_f, dst_pre / fname)
                shutil.copy2(data_dir / "pretrain_manifest.json", dst_pre / "pretrain_manifest.json")
                print(f"[drive-sync] saved pretrain artifacts -> {dst_pre}", flush=True)
            if JOB_CONFIG.get("publish_to_gcs") and gcs_bucket:
                if not allow_pretrain_publish:
                    raise RuntimeError("Pretrain publish blocked: pass --allow-pretrain-publish to upload under pretrain/<version>/")
                subprocess.run(
                    [
                        sys.executable,
                        str(WORKDIR / "scripts" / "publish_artifacts.py"),
                        "--bucket",
                        gcs_bucket,
                        "--version",
                        str(JOB_CONFIG["artifact_version"]),
                        "--models-dir",
                        str(models_dir),
                        "--data-dir",
                        str(data_dir),
                        "--profile",
                        "pretrain",
                        "--faiss-index-type",
                        faiss_index_type,
                    ],
                    check=True,
                )
            print(f"[colab-worker] COMPLETED task={task} version={JOB_CONFIG['artifact_version']}", flush=True)
            return
        elif task == "phoenix-v2-finetune":
            samples_path = data_dir / "phoenix_v2_samples.pkl"
            archive_tar = Path("/content/local_archives_user_actions.tar.gz")
            if archive_tar.exists():
                import inspect as _inspect

                arch_root = data_dir / "archives"
                arch_root.mkdir(parents=True, exist_ok=True)
                target_arch = Path(local_jsonl_dir) if local_jsonl_dir else (arch_root / "user_actions")
                if not target_arch.exists() or not any(target_arch.rglob("*.jsonl*")):
                    extract_base = target_arch.parent if target_arch.name == "user_actions" else target_arch
                    extract_base.mkdir(parents=True, exist_ok=True)
                    with tarfile.open(archive_tar, "r:gz") as tar:
                        if "filter" in _inspect.signature(tar.extractall).parameters:
                            tar.extractall(extract_base, filter="data")
                        else:
                            tar.extractall(extract_base)
                local_jsonl_dir = str(target_arch)
            if not samples_path.exists() and (drive_data_dir or gcs_dataset_uri):
                _stage_local_or_gcs(drive_dir=drive_data_dir, gcs_uri=gcs_dataset_uri, target_dir=data_dir)
            if not samples_path.exists() and (local_jsonl_dir or gcs_archive_uri or mongo_uri):
                _run_export_training_data(
                    samples_path=samples_path,
                    local_jsonl_dir=local_jsonl_dir,
                    gcs_archive_uri=gcs_archive_uri,
                    mongo_uri=mongo_uri,
                    export_days=int(JOB_CONFIG.get("export_days", 3650)),
                )
            if not samples_path.exists():
                raise FileNotFoundError(f"微调样本文件缺失: {samples_path}")

            init_ckpt: Path | None = None
            if drive_init_from and Path(drive_init_from).exists():
                src_init = Path(drive_init_from)
                init_ckpt = src_init / "phoenix_v2_inference.pt" if src_init.is_dir() else src_init
            elif gcs_init_from_uri:
                init_ckpt = _download_pretrained_checkpoint(gcs_init_from_uri, models_dir / "pretrained_init")
            elif (models_dir / "pretrained_init" / "phoenix_v2_inference.pt").exists():
                init_ckpt = models_dir / "pretrained_init" / "phoenix_v2_inference.pt"

            aux_dir: Path | None = None
            if drive_aux_samples_dir and Path(drive_aux_samples_dir).exists():
                aux_dir = Path(drive_aux_samples_dir)
            elif gcs_aux_samples_uri:
                aux_dir = data_dir / "aux_replay"
                _download_gcs_prefix(gcs_aux_samples_uri, aux_dir)

            if drive_base_dir:
                _stage_base_serving_artifacts_from_drive(
                    drive_base_dir=drive_base_dir,
                    faiss_index_type=faiss_index_type,
                    models_dir=models_dir,
                    data_dir=data_dir,
                )
            elif base_version and gcs_bucket:
                _stage_base_serving_artifacts(
                    gcs_bucket=gcs_bucket,
                    base_version=base_version,
                    faiss_index_type=faiss_index_type,
                    models_dir=models_dir,
                    data_dir=data_dir,
                )

            report = train_phoenix_v2(
                PhoenixV2TrainConfig(
                    data_dir=data_dir,
                    models_dir=models_dir,
                    samples_path=samples_path,
                    aux_samples_path=aux_dir,
                    aux_sample_max_groups=int(JOB_CONFIG.get("aux_max_groups", 2000)),
                    init_from=init_ckpt,
                    reset_id_hash_embeddings_on_init=bool(JOB_CONFIG.get("reset_id_hashes_on_init", True)),
                    backbone_lr_scale=float(JOB_CONFIG.get("backbone_lr_scale", 0.1)),
                    checkpoint_role="serving",
                    scale=str(JOB_CONFIG["scale"]),
                    epochs=int(JOB_CONFIG["epochs"]),
                    batch_size=int(JOB_CONFIG["batch_size"]),
                    max_history=int(JOB_CONFIG["max_history"]),
                    max_candidates=int(JOB_CONFIG["max_candidates"]),
                    lr=float(JOB_CONFIG["lr"]),
                )
            )
            run_sidecar_training(samples_path=samples_path, models_dir=models_dir, mongo_uri=mongo_uri)
        elif task == "sidecars":
            samples_path = data_dir / "phoenix_v2_samples.pkl"
            report = run_sidecar_training(
                samples_path=samples_path,
                models_dir=models_dir,
                mongo_uri=mongo_uri,
            )
        elif task.startswith("v3-"):
            from src.models.phoenix_v3 import PhoenixV3Config
            from src.models.two_tower_v3 import TwoTowerV3Config
            from src.training.ablation_runner import (
                build_complete_v3_serving_bundle,
                load_v3_parquet_corpus_and_samples,
            )

            _stage_local_or_gcs(
                drive_dir=drive_data_dir,
                gcs_uri=gcs_dataset_uri,
                target_dir=data_dir,
                required_files=("prod_posts_corpus_v3.parquet", "prod_pit_samples_v3.parquet"),
            )
            posts_rows, samples_rows = load_v3_parquet_corpus_and_samples(data_dir)
            scale = str(JOB_CONFIG.get("scale", "large"))
            epochs = int(JOB_CONFIG.get("epochs", 6))
            batch_size = int(JOB_CONFIG.get("batch_size", 64))
            max_history = int(JOB_CONFIG.get("max_history", 128))
            max_candidates = int(JOB_CONFIG.get("max_candidates", 64))
            artifact_version = str(JOB_CONFIG["artifact_version"])

            if scale == "mini":
                embedding_dim = 128
                t_cfg = PhoenixV3Config(
                    dim=64,
                    num_layers=2,
                    num_cand_only_layers=1,
                    num_heads=4,
                    num_kv_heads=2,
                    max_history_len=max_history,
                    max_candidates=max_candidates,
                    post_hash_buckets=8192,
                    author_hash_buckets=2048,
                )
                s_cfg = PhoenixV3Config(
                    dim=32,
                    num_layers=2,
                    num_cand_only_layers=1,
                    num_heads=4,
                    num_kv_heads=2,
                    max_history_len=max_history,
                    max_candidates=max_candidates,
                    post_hash_buckets=8192,
                    author_hash_buckets=2048,
                )
                tt_cfg = TwoTowerV3Config(
                    hidden_dim=64,
                    embedding_dim=embedding_dim,
                    num_layers=2,
                    num_heads=4,
                    num_kv_heads=2,
                    mol_num_heads=4,
                    max_history_len=max_history,
                    post_hash_buckets=8192,
                    author_hash_buckets=2048,
                )
                t_epochs = max(1, epochs)
                s_epochs = max(1, epochs)
                txt_epochs = max(1, epochs)
                rq_epochs = max(2, epochs)
                tt_epochs = max(1, epochs)
            else:
                embedding_dim = 256
                use_large_teacher = task in ("v3-phoenix-teacher", "v3-full-pipeline")
                t_cfg = (
                    PhoenixV3Config.teacher_preset(max_history_len=max_history, max_candidates=max_candidates)
                    if use_large_teacher
                    else PhoenixV3Config.student_preset(max_history_len=max_history, max_candidates=max_candidates)
                )
                s_cfg = PhoenixV3Config.student_preset(max_history_len=max_history, max_candidates=max_candidates)
                tt_cfg = TwoTowerV3Config(
                    hidden_dim=256,
                    embedding_dim=embedding_dim,
                    num_layers=4,
                    num_heads=8,
                    num_kv_heads=2,
                    mol_num_heads=4,
                    max_history_len=max_history,
                )
                if task == "v3-sid-twotower":
                    txt_epochs, rq_epochs, tt_epochs = max(8, epochs), max(16, epochs * 2), max(6, epochs)
                    t_epochs, s_epochs = 2, 2
                elif task == "v3-phoenix-teacher":
                    txt_epochs, rq_epochs, tt_epochs = 6, 12, 3
                    t_epochs, s_epochs = max(4, epochs), max(2, epochs // 2)
                elif task == "v3-phoenix-distill":
                    txt_epochs, rq_epochs, tt_epochs = 6, 12, 3
                    t_epochs, s_epochs = max(4, epochs // 2), max(4, epochs)
                else:
                    txt_epochs, rq_epochs, tt_epochs = max(8, epochs), max(16, epochs * 2), max(4, epochs // 2)
                    t_epochs, s_epochs = max(4, epochs), max(4, epochs)

            report = build_complete_v3_serving_bundle(
                posts_rows=posts_rows,
                samples_rows=samples_rows,
                models_dir=models_dir,
                data_dir=data_dir,
                artifact_version=artifact_version,
                embedding_dim=embedding_dim,
                text_epochs=txt_epochs,
                rqvae_epochs=rq_epochs,
                tt_epochs=tt_epochs,
                teacher_epochs=t_epochs,
                student_epochs=s_epochs,
                batch_size=batch_size,
                teacher_config=t_cfg,
                student_config=s_cfg,
                two_tower_config=tt_cfg,
                max_history_len=max_history,
                max_candidates=max_candidates,
            )
            report_path = data_dir / "v3_pipeline_report.json"
            report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)

            if drive_output_dir:
                dst_root = Path(drive_output_dir)
                (dst_root / "models").mkdir(parents=True, exist_ok=True)
                (dst_root / "data").mkdir(parents=True, exist_ok=True)
                for item in models_dir.iterdir():
                    if item.is_file():
                        shutil.copy2(item, dst_root / "models" / item.name)
                for d_name in ("cread_edges_ms.json", "serving_manifest_v3.json", "v3_pipeline_report.json"):
                    d_src = data_dir / d_name
                    if d_src.exists():
                        shutil.copy2(d_src, dst_root / "data" / d_name)
                print(f"[drive-sync] saved V3 serving bundle -> {dst_root}", flush=True)

            if JOB_CONFIG.get("publish_to_gcs") and gcs_bucket and (task != "v3-phoenix-teacher" or allow_pretrain_publish):
                _upload_directory_to_gcs(models_dir, f"gs://{gcs_bucket}/artifacts/{artifact_version}/models")
                v3_data_stage = WORKDIR / "v3_data_out"
                v3_data_stage.mkdir(parents=True, exist_ok=True)
                for d_name in ("cread_edges_ms.json", "serving_manifest_v3.json", "v3_pipeline_report.json"):
                    d_src = data_dir / d_name
                    if d_src.exists():
                        shutil.copy2(d_src, v3_data_stage / d_name)
                _upload_directory_to_gcs(v3_data_stage, f"gs://{gcs_bucket}/artifacts/{artifact_version}/data")
            print(f"[colab-worker] COMPLETED task={task} version={artifact_version}", flush=True)
            return
        else:
            raise ValueError(f"Unsupported task: {task}")

        manifest_profile = "phoenix-v2" if task in ("smoke", "phoenix-v2", "phoenix-v2-finetune") else "full"
        manifest = build_serving_manifest(
            version=str(JOB_CONFIG["artifact_version"]),
            profile=manifest_profile,
            faiss_index_type=faiss_index_type,
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
            faiss_index_type=faiss_index_type,
            require_serving_base=bool(base_version or drive_base_dir),
        )
        print(json.dumps({"gatePassed": passed, "reasons": reasons, "details": gate_details}, ensure_ascii=False, indent=2), flush=True)
        if not passed:
            raise RuntimeError(f"Promotion gate blocked upload: {reasons}")

        if drive_output_dir:
            dst_root = Path(drive_output_dir)
            (dst_root / "models").mkdir(parents=True, exist_ok=True)
            (dst_root / "data").mkdir(parents=True, exist_ok=True)
            for item in models_dir.iterdir():
                if item.is_file():
                    shutil.copy2(item, dst_root / "models" / item.name)
            for d_name in ("news_vocab.pkl", "user_vocab.pkl", "news_dict.pkl", "item_embeddings.npy", "preprocess_manifest.json", "serving_manifest.json"):
                d_src = data_dir / d_name
                if d_src.exists():
                    shutil.copy2(d_src, dst_root / "data" / d_name)
            print(f"[drive-sync] saved serving bundle -> {dst_root}", flush=True)

        if JOB_CONFIG.get("publish_to_gcs") and gcs_bucket:
            pub_profile = "phoenix-v2" if task in ("smoke", "phoenix-v2", "phoenix-v2-finetune") else "full"
            subprocess.run(
                [
                    sys.executable,
                    str(WORKDIR / "scripts" / "publish_artifacts.py"),
                    "--bucket",
                    str(gcs_bucket),
                    "--version",
                    str(JOB_CONFIG["artifact_version"]),
                    "--models-dir",
                    str(models_dir),
                    "--data-dir",
                    str(data_dir),
                    "--profile",
                    pub_profile,
                    "--faiss-index-type",
                    faiss_index_type,
                ],
                check=True,
            )
        print(f"[colab-worker] COMPLETED task={task} version={JOB_CONFIG['artifact_version']}", flush=True)
    finally:
        stop_event.set()


if __name__ == "__main__":
    main()
'''


def render_remote_worker_script(
    *,
    profile: ColabTrainingProfile,
    artifact_version: str,
    gcs_bucket: str = "",
    gcs_archive_uri: str = "",
    publish_to_gcs: bool = False,
    max_cpu_p95_ms: float = 120.0,
    gcs_dataset_uri: str = "",
    drive_data_dir: str = "",
    drive_output_dir: str = "",
    drive_init_from: str = "",
    drive_aux_samples_dir: str = "",
    drive_base_dir: str = "",
    local_jsonl_dir: str = "",
    gcs_init_from_uri: str = "",
    gcs_aux_samples_uri: str = "",
    aux_max_groups: int = 2000,
    base_artifact_version: str = "",
    faiss_index_type: str = "ivf_pq",
    allow_pretrain_publish: bool = False,
    user_sample_mod: int = 10,
    max_train_slates: int = 400_000,
    max_val_rand_slates: int = 50_000,
    shard_slates: int = 50_000,
    epochs_override: Optional[int] = None,
    batch_size_override: Optional[int] = None,
    lr_override: Optional[float] = None,
    backbone_lr_scale_override: Optional[float] = None,
) -> str:
    """生成直接在 Colab 远端内核执行的多阶段 Worker 脚本（含 30s 心跳、数据预备与门禁校验）。"""
    payload: Dict[str, Any] = {
        "profile": profile.name,
        "task": profile.task,
        "scale": profile.scale,
        "epochs": int(epochs_override if epochs_override is not None else profile.epochs),
        "batch_size": int(batch_size_override if batch_size_override is not None else profile.batch_size),
        "max_history": int(profile.max_history),
        "max_candidates": int(profile.max_candidates),
        "lr": float(lr_override if lr_override is not None else profile.lr),
        "backbone_lr_scale": float(
            backbone_lr_scale_override if backbone_lr_scale_override is not None else profile.backbone_lr_scale
        ),
        "reset_id_hashes_on_init": bool(profile.reset_id_hashes_on_init),
        "checkpoint_role": profile.checkpoint_role,
        "artifact_version": artifact_version,
        "gcs_bucket": gcs_bucket,
        "gcs_archive_uri": gcs_archive_uri,
        "gcs_dataset_uri": gcs_dataset_uri,
        "drive_data_dir": drive_data_dir,
        "drive_output_dir": drive_output_dir,
        "drive_init_from": drive_init_from,
        "drive_aux_samples_dir": drive_aux_samples_dir,
        "drive_base_dir": drive_base_dir,
        "local_jsonl_dir": local_jsonl_dir,
        "gcs_init_from_uri": gcs_init_from_uri,
        "gcs_aux_samples_uri": gcs_aux_samples_uri,
        "aux_max_groups": int(aux_max_groups),
        "base_artifact_version": base_artifact_version,
        "faiss_index_type": faiss_index_type,
        "publish_to_gcs": bool(publish_to_gcs),
        "allow_pretrain_publish": bool(allow_pretrain_publish),
        "user_sample_mod": int(user_sample_mod),
        "max_train_slates": int(max_train_slates),
        "max_val_rand_slates": int(max_val_rand_slates),
        "shard_slates": int(shard_slates),
        "max_cpu_p95_ms": float(max_cpu_p95_ms),
    }
    config_json = json.dumps(payload, ensure_ascii=False, indent=2)
    return _WORKER_TEMPLATE.replace("__JOB_CONFIG_LITERAL__", repr(config_json))
