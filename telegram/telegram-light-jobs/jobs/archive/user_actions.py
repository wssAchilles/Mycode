import gzip
import json
import os
import tempfile
import time
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict

from fastapi import HTTPException
from google.cloud import storage
from pymongo import MongoClient


def _mongo_db():
    uri = os.getenv("MONGODB_URI", "").strip()
    if not uri:
        raise HTTPException(status_code=503, detail="MONGODB_URI not configured")
    client = MongoClient(uri, serverSelectionTimeoutMS=5000)
    return client, client.get_default_database()


def _gcs_bucket():
    bucket_name = os.getenv("ARCHIVE_GCS_BUCKET") or os.getenv("GCS_BUCKET") or ""
    bucket_name = bucket_name.strip()
    if not bucket_name:
        raise HTTPException(status_code=500, detail="ARCHIVE_GCS_BUCKET not configured")
    return storage.Client().bucket(bucket_name)


def _serialize_action(doc: Dict[str, Any], ts: datetime) -> Dict[str, Any]:
    return {
        "id": str(doc.get("_id")) if doc.get("_id") is not None else None,
        "userId": doc.get("userId"),
        "action": doc.get("action"),
        "targetPostId": str(doc.get("targetPostId")) if doc.get("targetPostId") is not None else None,
        "targetAuthorId": doc.get("targetAuthorId"),
        "timestamp": ts.isoformat(),
        "productSurface": doc.get("productSurface"),
        "requestId": doc.get("requestId"),
    }


def archive_user_actions_to_gcs(days: int = 7, dry_run: bool = False) -> dict:
    client, db = _mongo_db()
    bucket = _gcs_bucket()
    prefix = os.getenv("ARCHIVE_GCS_PREFIX", "archives/user_actions").strip("/")

    try:
        days_i = max(1, int(days))
        since = datetime.now(timezone.utc) - timedelta(days=days_i)
        since_naive = since.replace(tzinfo=None)

        cursor = db["user_actions"].find(
            {"timestamp": {"$gte": since_naive}},
            {
                "_id": 1,
                "userId": 1,
                "action": 1,
                "targetPostId": 1,
                "targetAuthorId": 1,
                "timestamp": 1,
                "productSurface": 1,
                "requestId": 1,
            },
        ).sort("timestamp", 1)

        writers: Dict[tuple[int, int, int], list[Any]] = {}
        total = 0

        for doc in cursor:
            ts = doc.get("timestamp")
            if isinstance(ts, datetime) and ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            if not isinstance(ts, datetime):
                continue

            key = (ts.year, ts.month, ts.day)
            if key not in writers:
                tmp = tempfile.NamedTemporaryFile(
                    prefix=f"user_actions_{ts.year}{ts.month:02d}{ts.day:02d}_",
                    suffix=".jsonl.gz",
                    delete=False,
                )
                tmp_path = Path(tmp.name)
                tmp.close()
                writers[key] = [tmp_path, gzip.open(tmp_path, "wt", encoding="utf-8"), 0]

            tmp_path, gz, cnt = writers[key]
            gz.write(json.dumps(_serialize_action(doc, ts), ensure_ascii=False) + "\n")
            writers[key][2] = cnt + 1
            total += 1

        objects = []
        by_day = {}

        for (year, month, day), (tmp_path, gz, count) in writers.items():
            gz.close()
            by_day[f"{year:04d}-{month:02d}-{day:02d}"] = int(count)
            object_name = (
                f"{prefix}/yyyy={year:04d}/mm={month:02d}/dd={day:02d}/"
                f"user_actions_{year:04d}{month:02d}{day:02d}_{int(time.time())}_{uuid.uuid4().hex}.jsonl.gz"
            )

            if dry_run:
                objects.append({"object": object_name, "count": int(count), "dry_run": True})
            else:
                bucket.blob(object_name).upload_from_filename(str(tmp_path), content_type="application/gzip")
                objects.append({"object": object_name, "count": int(count)})

            try:
                tmp_path.unlink(missing_ok=True)
            except Exception:
                pass

        return {
            "archived": total,
            "objects": objects,
            "by_day": by_day,
            "since": since.isoformat(),
            "dry_run": bool(dry_run),
        }
    finally:
        client.close()
