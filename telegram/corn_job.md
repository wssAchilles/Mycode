# Cloud Scheduler 定时任务执行说明（telegram-467705）

本文件用于交接给你的 agent，完整描述如何在 **Google Cloud Scheduler** 中创建两个定时任务：

- **每日刷新特征（不重训模型）**
- **每小时爬虫**
- **每周归档 user_actions 到 GCS（不做清理）**

> 目标服务（Cloud Run）：`https://telegram-ml-services-22619257282.us-central1.run.app`

---

## 0. 任务前置条件（必须先完成）

### 0.1 Cloud Run 环境变量（ml-services）

确保 Cloud Run 上已设置：

- `CRON_SECRET`：你自己生成的随机长字符串（**用于鉴权**）
- `ENABLE_INTERNAL_SCHEDULER=false`（关闭内置定时器，避免重复）
- `MONGODB_URI`（必须配置，ml-services 用于读取 posts/user_actions）
- `DATABASE_URL`（可选，用于过滤用户）

> `CRON_SECRET` 查看位置：Cloud Run Console → 服务 → Revision → Environment → 找到 `CRON_SECRET`。
> 如果没有，手动新增。

### 0.2 服务已部署包含以下接口

- `POST /jobs/refresh-features`
- `POST /jobs/crawl`
- `POST /jobs/archive-user-actions`

> 接口已在 `ml-services/app.py` 中实现，并会校验 `Authorization: Bearer <CRON_SECRET>`。

---

## 1. 使用 gcloud CLI 登录（避免浏览器被拒绝）

由于自动唤起浏览器会被 Google 阻止，请使用 **no-launch** 方式：

```bash
gcloud auth login --no-launch-browser --brief
```

执行后会出现一个 **URL** 和 **验证码**：

1) 在正常浏览器中打开 URL（不要用被“自动化控制”的窗口）。
2) 登录并获取验证码。
3) 回到终端粘贴验证码完成认证。

> 如果仍失败，可用 `gcloud auth login --no-launch-browser`（不带 brief）。

---

## 2. 设置项目与区域

```bash
gcloud config set project telegram-467705
```


```bash
gcloud scheduler locations list
```

> 假设选择us-central1。

---

## 3. 创建 Cloud Scheduler 作业

### 3.1 每日刷新特征（不重训模型）

**目标：** 每天 03:00（北京时间）刷新用户特征、必要时重建 FAISS。

**命令：**

```bash
gcloud scheduler jobs create http refresh-features-daily \
  --location=us-central1 \
  --schedule="0 3 * * *" \
  --time-zone="Asia/Shanghai" \
  --http-method=POST \
  --uri="https://telegram-ml-services-22619257282.us-central1.run.app/jobs/refresh-features?days=1&rebuild_faiss=true&filter_users_from_postgres=true" \
  --headers="Authorization=Bearer <CRON_SECRET>" \
  --attempt-deadline="1200s"
```

说明：

- `days=1`：只处理最近 1 天的用户行为
- `rebuild_faiss=true`：重建 FAISS（可选，模型更新后建议开）
- `filter_users_from_postgres=true`：仅处理 PostgreSQL 真实用户
- `attempt-deadline=1200s`：20 分钟超时（对齐 Cloud Run `--timeout 1200`，且 refresh-features 在 Cloud Run 内同步执行更可靠）

> 如果不想重建索引，可去掉 `rebuild_faiss=true`。

### 3.2 每小时爬虫

**命令：**

```bash
gcloud scheduler jobs create http crawl-hourly \
  --location=us-central1 \
  --schedule="0 * * * *" \
  --time-zone="Asia/Shanghai" \
  --http-method=POST \
  --uri="https://telegram-ml-services-22619257282.us-central1.run.app/jobs/crawl" \
  --headers="Authorization=Bearer <CRON_SECRET>"
```

### 3.3 每周归档 user_actions（不做清理）

**目标：** 每周一次，将最近 7 天 user_actions 归档到 GCS（JSONL.GZ 分区路径），不删除 Mongo。

**命令：**

```bash
gcloud scheduler jobs create http archive-user-actions-weekly \
  --location=us-central1 \
  --schedule="0 4 * * 0" \
  --time-zone="Asia/Shanghai" \
  --http-method=POST \
  --uri="https://telegram-ml-services-22619257282.us-central1.run.app/jobs/archive-user-actions?days=7" \
  --headers="Authorization=Bearer <CRON_SECRET>" \
  --attempt-deadline="1200s"
```

说明：

- `attempt-deadline=1200s` = 20 分钟超时（满足你要求）
- 不做清理：Mongo 中 user_actions 保留原数据

---

## 4. 验证作业是否创建成功

```bash
gcloud scheduler jobs list --location=us-central1
```

查看某个任务详情：

```bash
gcloud scheduler jobs describe refresh-features-daily --location=us-central1
```

手动立即触发一次测试：

```bash
gcloud scheduler jobs run refresh-features-daily --location=us-central1
```

---

## 5. 常见问题排查

### 5.1 401 Unauthorized

- 说明 `CRON_SECRET` 不一致或未配置。
- 确认 Cloud Run 环境变量和 Scheduler header 完全一致。

### 5.2 作业执行但没有效果

- Cloud Run 可能需要几秒冷启动。
- 查看 Cloud Run Logs：确认 `/jobs/refresh-features` 或 `/jobs/crawl` 是否被调用（状态码 200）。

### 5.3 重复爬虫

- 确认 `ENABLE_INTERNAL_SCHEDULER=false` 已生效。

---

## 6. 可选增强（需要额外实现）

- 给 `/jobs/*` 增加执行日志或状态查询接口
- 把大任务拆成 Cloud Run Job 或 Vertex AI Batch（更稳）
- 增加 retry / failure alert

---

## 7. 关键配置汇总（可拷贝给 agent）

- Project ID: `telegram-467705`
- Location: us-central1
- Time Zone: `Asia/Shanghai`
- Refresh Features URL:
  - `https://telegram-ml-services-22619257282.us-central1.run.app/jobs/refresh-features?days=1&rebuild_faiss=true&filter_users_from_postgres=true`
- Crawl URL:
  - `https://telegram-ml-services-22619257282.us-central1.run.app/jobs/crawl`
- Auth Header:
  - `Authorization: Bearer <CRON_SECRET>`
