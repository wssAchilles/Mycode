import time
from threading import Lock

from fastapi import FastAPI, Request

from jobs.archive.user_actions import archive_user_actions_to_gcs
from jobs.crawler.news_fetcher import run_crawler_job
from jobs.http.auth import require_cron_auth


app = FastAPI(title="Telegram Light Jobs", version="1.0.0")

_job_lock = Lock()
_job_state = {
    "crawl": False,
    "archive_user_actions": False,
}


@app.get("/health")
def health():
    return {"status": "ok", "service": "telegram-light-jobs"}


@app.post("/jobs/crawl")
def crawl_job(request: Request):
    require_cron_auth(request)

    with _job_lock:
        if _job_state["crawl"]:
            return {"status": "busy", "job": "crawl"}
        _job_state["crawl"] = True

    started = time.time()
    try:
        result = run_crawler_job()
        return {"status": "ok", "durationMs": int((time.time() - started) * 1000), **result}
    finally:
        with _job_lock:
            _job_state["crawl"] = False


@app.post("/jobs/archive-user-actions")
def archive_user_actions_job(request: Request, days: int = 7, dry_run: bool = False):
    require_cron_auth(request)

    with _job_lock:
        if _job_state["archive_user_actions"]:
            return {"status": "busy", "job": "archive_user_actions"}
        _job_state["archive_user_actions"] = True

    started = time.time()
    try:
        result = archive_user_actions_to_gcs(days=days, dry_run=dry_run)
        return {"status": "ok", "durationMs": int((time.time() - started) * 1000), **result}
    finally:
        with _job_lock:
            _job_state["archive_user_actions"] = False
