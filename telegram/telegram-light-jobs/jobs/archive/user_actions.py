from datetime import datetime, timedelta, timezone
import gzip
import json
import os
from pathlib import Path
import tempfile
from typing import Any, Dict, Optional

from fastapi import HTTPException
from google.cloud import storage
from pymongo import MongoClient

_WATERMARK_COLLECTION = "archive_watermarks"
_WATERMARK_DOC_ID = "user_actions"


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


def _ensure_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _read_watermark_utc(db: Any) -> Optional[datetime]:
    """读取上次成功归档的截止水位，兼容无水位集合的首次运行场景。"""
    try:
        doc = db[_WATERMARK_COLLECTION].find_one({"_id": _WATERMARK_DOC_ID})
    except Exception:
        return None
    if not isinstance(doc, dict):
        return None
    raw_ts = doc.get("lastArchivedUntil")
    if isinstance(raw_ts, datetime):
        return _ensure_utc(raw_ts)
    return None


def _write_watermark_utc(db: Any, until_utc: datetime, now_utc: datetime) -> None:
    """持久化本次成功归档的自然日截止水位，消除次日重复导出。"""
    try:
        db[_WATERMARK_COLLECTION].update_one(
            {"_id": _WATERMARK_DOC_ID},
            {
                "$set": {
                    "lastArchivedUntil": until_utc.replace(tzinfo=None),
                    "updatedAt": now_utc.replace(tzinfo=None),
                }
            },
            upsert=True,
        )
    except Exception:
        pass


def archive_user_actions_to_gcs(
    days: int = 1,
    dry_run: bool = False,
    now_utc: Optional[datetime] = None,
) -> dict:
    """按完整 UTC 自然日增量窗口归档用户行为日志，并确保异常时临时文件 100% 清理。"""
    client, db = _mongo_db()
    bucket = _gcs_bucket()
    prefix = os.getenv("ARCHIVE_GCS_PREFIX", "archives/user_actions").strip("/")

    try:
        effective_now = _ensure_utc(now_utc) if now_utc is not None else datetime.now(timezone.utc)
        # 仅归档已封口的完整 UTC 自然日 [window_start, window_end)，杜绝半天残片与多日重复全量导出
        window_end = effective_now.replace(hour=0, minute=0, second=0, microsecond=0)
        days_i = max(1, int(days))
        floor_start = window_end - timedelta(days=days_i)

        watermark = _read_watermark_utc(db)
        window_start = max(floor_start, watermark) if watermark is not None else floor_start

        if window_start >= window_end:
            return {
                "archived": 0,
                "objects": [],
                "by_day": {},
                "since": window_start.isoformat(),
                "until": window_end.isoformat(),
                "dry_run": bool(dry_run),
            }

        start_naive = window_start.replace(tzinfo=None)
        end_naive = window_end.replace(tzinfo=None)

        cursor = db["user_actions"].find(
            {"timestamp": {"$gte": start_naive, "$lt": end_naive}},
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
        objects = []
        by_day = {}
        total = 0

        try:
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

            for (year, month, day), (tmp_path, gz, count) in writers.items():
                gz.close()
                by_day[f"{year:04d}-{month:02d}-{day:02d}"] = int(count)
                # 按完整自然日使用确定性对象键，支持幂等重跑零冗余垃圾文件
                object_name = (
                    f"{prefix}/yyyy={year:04d}/mm={month:02d}/dd={day:02d}/"
                    f"user_actions_{year:04d}{month:02d}{day:02d}.jsonl.gz"
                )

                if dry_run:
                    objects.append({"object": object_name, "count": int(count), "dry_run": True})
                else:
                    bucket.blob(object_name).upload_from_filename(
                        str(tmp_path),
                        content_type="application/gzip",
                    )
                    objects.append({"object": object_name, "count": int(count)})
        finally:
            # 无论正常完成还是中途抛错，强制关闭所有句柄并删除本地临时压缩文件
            for tmp_path, gz, _ in writers.values():
                try:
                    gz.close()
                except Exception:
                    pass
                try:
                    tmp_path.unlink(missing_ok=True)
                except Exception:
                    pass

        if not dry_run:
            _write_watermark_utc(db, window_end, effective_now)

        return {
            "archived": total,
            "objects": objects,
            "by_day": by_day,
            "since": window_start.isoformat(),
            "until": window_end.isoformat(),
            "dry_run": bool(dry_run),
        }
    finally:
        client.close()
