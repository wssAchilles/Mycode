import argparse
import os
from pathlib import Path


def _get_gcs_bucket(name: str):
    from google.cloud import storage

    client = storage.Client()
    return client.bucket(name)


def _upload_file(bucket, src: Path, dst: str, content_type: str = "application/octet-stream"):
    blob = bucket.blob(dst)
    blob.upload_from_filename(str(src), content_type=content_type)
    print(f"✅ uploaded: {src} -> gs://{bucket.name}/{dst}")


def main():
    parser = argparse.ArgumentParser(description="Publish ML artifacts to GCS (versioned directory).")
    parser.add_argument("--bucket", default=os.getenv("ARTIFACT_GCS_BUCKET") or os.getenv("GCS_BUCKET") or "", required=False)
    parser.add_argument("--version", default=os.getenv("ARTIFACT_VERSION") or "", required=False)
    parser.add_argument("--faiss-index-type", default=os.getenv("FAISS_INDEX_TYPE") or "ivf_pq")
    parser.add_argument("--models-dir", default=str(Path(__file__).resolve().parent.parent / "models"))
    parser.add_argument("--data-dir", default=str(Path(__file__).resolve().parent.parent / "data"))
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
    faiss_index = models_dir / f"faiss_{args.faiss_index_type}.index"
    faiss_map = models_dir / "faiss_id_mapping.pkl"

    files = [
        (two_tower, f"artifacts/{args.version}/two_tower/model.pt", "application/octet-stream"),
        (phoenix, f"artifacts/{args.version}/phoenix/model.pt", "application/octet-stream"),
        (faiss_index, f"artifacts/{args.version}/faiss/faiss_{args.faiss_index_type}.index", "application/octet-stream"),
        (faiss_map, f"artifacts/{args.version}/faiss/faiss_id_mapping.pkl", "application/octet-stream"),
        (data_dir / "news_vocab.pkl", f"artifacts/{args.version}/data/news_vocab.pkl", "application/octet-stream"),
        (data_dir / "user_vocab.pkl", f"artifacts/{args.version}/data/user_vocab.pkl", "application/octet-stream"),
        (data_dir / "item_embeddings.npy", f"artifacts/{args.version}/data/item_embeddings.npy", "application/octet-stream"),
        # Optional corpus metadata used for one-time imports (not required for serving).
        (data_dir / "news_dict.pkl", f"artifacts/{args.version}/data/news_dict.pkl", "application/octet-stream"),
    ]

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
