import argparse
import json
import os
import tempfile
from pathlib import Path


def _get_gcs_bucket(name: str):
    from google.cloud import storage

    client = storage.Client()
    return client.bucket(name)


def _upload_file(bucket, src: Path, dst: str, content_type: str = "application/octet-stream"):
    blob = bucket.blob(dst)
    # 仅大文件启用 4 MiB 分片断点续传并放宽超时/重试窗口，保持对轻量文件与测试替身的签名兼容
    if src.stat().st_size > 4 * 1024 * 1024:
        from google.cloud.storage.retry import DEFAULT_RETRY

        blob.chunk_size = 4 * 1024 * 1024
        blob.upload_from_filename(
            str(src),
            content_type=content_type,
            timeout=(30, 180),
            retry=DEFAULT_RETRY.with_deadline(600.0),
        )
    else:
        blob.upload_from_filename(str(src), content_type=content_type)
    print(f"✅ uploaded: {src} -> gs://{bucket.name}/{dst}", flush=True)


def _file_size(path: Path) -> int:
    try:
        return path.stat().st_size
    except FileNotFoundError:
        return 0


def _write_serving_manifest(
    *,
    version: str,
    profile: str,
    faiss_index_type: str,
    models_dir: Path,
    data_dir: Path,
) -> Path:
    manifest = {
        "schema": "telegram_ml_serving_bundle_v1",
        "version": version,
        "profile": profile,
        "faissIndexType": faiss_index_type,
        "files": {
            "twoTowerModel": _file_size(models_dir / "two_tower_epoch_latest.pt"),
            "phoenixModel": _file_size(models_dir / "phoenix_epoch_latest.pt"),
            "faissIndex": _file_size(models_dir / f"faiss_{faiss_index_type}.index"),
            "faissIdMapping": _file_size(models_dir / "faiss_id_mapping.pkl"),
            "newsVocab": _file_size(data_dir / "news_vocab.pkl"),
            "userVocab": _file_size(data_dir / "user_vocab.pkl"),
            "itemEmbeddings": _file_size(data_dir / "item_embeddings.npy"),
            "newsDict": _file_size(data_dir / "news_dict.pkl"),
        },
        "notes": [
            "serving-lite excludes Phoenix, item_embeddings.npy, and news_dict.pkl from upload by default.",
            "item_embeddings.npy is an offline FAISS build input, not an online serving artifact.",
        ],
    }

    tmp = tempfile.NamedTemporaryFile(prefix="serving_manifest_", suffix=".json", delete=False)
    tmp_path = Path(tmp.name)
    tmp.close()
    tmp_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return tmp_path


def main():
    parser = argparse.ArgumentParser(description="Publish ML artifacts to GCS (versioned directory).")
    parser.add_argument("--bucket", default=os.getenv("ARTIFACT_GCS_BUCKET") or os.getenv("GCS_BUCKET") or "", required=False)
    parser.add_argument("--version", default=os.getenv("ARTIFACT_VERSION") or "", required=False)
    parser.add_argument("--faiss-index-type", default=os.getenv("FAISS_INDEX_TYPE") or "ivf_pq")
    parser.add_argument("--models-dir", default=str(Path(__file__).resolve().parent.parent / "models"))
    parser.add_argument("--data-dir", default=str(Path(__file__).resolve().parent.parent / "data"))
    parser.add_argument(
        "--profile",
        choices=["full", "serving-lite", "phoenix-v2", "pretrain"],
        default=os.getenv("ARTIFACT_PROFILE") or "full",
        help="full/serving-lite/phoenix-v2 publish under artifacts/<version>/; pretrain publishes strictly under pretrain/<version>/.",
    )
    args = parser.parse_args()

    if not args.bucket:
        raise SystemExit("missing --bucket (or ARTIFACT_GCS_BUCKET/GCS_BUCKET)")
    if not args.version:
        raise SystemExit("missing --version (or ARTIFACT_VERSION)")

    bucket = _get_gcs_bucket(args.bucket)
    models_dir = Path(args.models_dir)
    data_dir = Path(args.data_dir)

    two_tower = models_dir / "two_tower_epoch_latest.pt"
    phoenix = models_dir / "phoenix_epoch_latest.pt"
    import json
    import sys
    import tempfile

    root_dir = Path(__file__).resolve().parent.parent
    if str(root_dir) not in sys.path:
        sys.path.insert(0, str(root_dir))
    from recsys.contracts.artifacts import build_serving_manifest

    if args.profile == "pretrain":
        v2_model = models_dir / "phoenix_v2_inference.pt"
        v2_cfg = models_dir / "phoenix_v2_config.json"
        if not v2_model.exists() or not v2_cfg.exists():
            raise SystemExit("missing phoenix_v2_inference.pt or phoenix_v2_config.json for pretrain profile")
        manifest_payload = build_serving_manifest(
            version=args.version,
            profile="pretrain",
            faiss_index_type=args.faiss_index_type,
            models_dir=models_dir,
            data_dir=data_dir,
            model_version=args.version,
            include_checksums=True,
        )
        with tempfile.TemporaryDirectory(prefix="recsys_pretrain_manifest_") as tmp_dir:
            pretrain_manifest = Path(tmp_dir) / "pretrain_manifest.json"
            pretrain_manifest.write_text(json.dumps(manifest_payload, ensure_ascii=False, indent=2), encoding="utf-8")
            pretrain_files = [
                (v2_model, f"pretrain/{args.version}/phoenix_v2/model.pt", "application/octet-stream"),
                (v2_cfg, f"pretrain/{args.version}/phoenix_v2/config.json", "application/json"),
                (pretrain_manifest, f"pretrain/{args.version}/manifest/pretrain_manifest.json", "application/json"),
                (models_dir / "phoenix_v2_train_report.json", f"pretrain/{args.version}/manifest/phoenix_v2_train_report.json", "application/json"),
            ]
            for src, dst, ctype in pretrain_files:
                if src.exists():
                    _upload_file(bucket, src, dst, content_type=ctype)
        return

    faiss_index = models_dir / f"faiss_{args.faiss_index_type}.index"
    faiss_map = models_dir / "faiss_id_mapping.pkl"

    manifest_payload = build_serving_manifest(
        version=args.version,
        profile=args.profile,
        faiss_index_type=args.faiss_index_type,
        models_dir=models_dir,
        data_dir=data_dir,
    )

    with tempfile.TemporaryDirectory(prefix="recsys_manifest_") as tmp_dir:
        serving_manifest = Path(tmp_dir) / "serving_manifest.json"
        serving_manifest.write_text(
            json.dumps(manifest_payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        files = [
            (two_tower, f"artifacts/{args.version}/two_tower/model.pt", "application/octet-stream"),
            (faiss_index, f"artifacts/{args.version}/faiss/faiss_{args.faiss_index_type}.index", "application/octet-stream"),
            (faiss_map, f"artifacts/{args.version}/faiss/faiss_id_mapping.pkl", "application/octet-stream"),
            (data_dir / "news_vocab.pkl", f"artifacts/{args.version}/data/news_vocab.pkl", "application/octet-stream"),
            (data_dir / "user_vocab.pkl", f"artifacts/{args.version}/data/user_vocab.pkl", "application/octet-stream"),
            (data_dir / "preprocess_manifest.json", f"artifacts/{args.version}/manifest/preprocess_manifest.json", "application/json"),
            (serving_manifest, f"artifacts/{args.version}/manifest/serving_manifest.json", "application/json"),
            # 轻量校准、RealGraph 与 SocialPhoenix JSON 产物（如已生成则随任意 profile 发布）
            (models_dir / "weighted_calibrator.json", f"artifacts/{args.version}/calibration/weighted_calibrator.json", "application/json"),
            (models_dir / "realgraph_gbt.json", f"artifacts/{args.version}/realgraph/gbt_model.json", "application/json"),
            (models_dir / "social_phoenix_linear.json", f"artifacts/{args.version}/social_phoenix/linear_model.json", "application/json"),
        ]
        if args.profile in ("full", "phoenix-v2"):
            files.extend(
                [
                    (phoenix, f"artifacts/{args.version}/phoenix/model.pt", "application/octet-stream"),
                    (models_dir / "phoenix_v2_inference.pt", f"artifacts/{args.version}/phoenix_v2/model.pt", "application/octet-stream"),
                    (models_dir / "phoenix_v2_config.json", f"artifacts/{args.version}/phoenix_v2/config.json", "application/json"),
                    (data_dir / "item_embeddings.npy", f"artifacts/{args.version}/data/item_embeddings.npy", "application/octet-stream"),
                    (data_dir / "news_dict.pkl", f"artifacts/{args.version}/data/news_dict.pkl", "application/octet-stream"),
                ]
            )

        missing = [str(src) for (src, _, _) in files if not src.exists()]
        if missing:
            print("⚠️ missing local files (will skip):")
            for m in missing:
                print(f" - {m}")

        for src, dst, ctype in files:
            if not src.exists():
                continue
            _upload_file(bucket, src, dst, content_type=ctype)


if __name__ == "__main__":
    main()
