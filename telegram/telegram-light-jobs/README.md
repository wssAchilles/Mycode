# Telegram Light Jobs

轻量 Python 任务面：新闻 RSS 爬取与用户行为归档。无内建调度，由外部 Cloud Scheduler / cron 调 HTTP。

> 与 `ml-services` 中的 `/jobs/*` 存在功能重叠（crawl / archive 双实现）。新增任务时先确认归属，避免行为分叉。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 探活 |
| POST | `/jobs/crawl` | BBC/Guardian/NPR world RSS → newspaper3k 正文 → TF-IDF + KMeans 聚类 → 推送后端 |
| POST | `/jobs/archive-user-actions` | Mongo `user_actions` 按日分区 → gzip JSONL → GCS |

鉴权：`Authorization: Bearer $CRON_SECRET`（`jobs/http/auth.py`）。

并发：进程内 Lock + busy 标志（非分布式锁）；多副本部署会重复跑 job。

## 目录

```text
app.py                          # FastAPI 入口
jobs/
├── crawler/news_fetcher.py
├── archive/user_actions.py
└── http/auth.py
consumers/
Dockerfile
requirements.txt
```

## 本地运行

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
CRON_SECRET=change-me uvicorn app:app --port 8080
```

## 相关文档

- [服务目录](../docs/architecture/service-catalog.md)
- [ml-services README](../ml-services/README.md)
