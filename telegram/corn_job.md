# Cloud Scheduler 定时任务执行说明（telegram-467705）

本文件用于交接给你的 agent，完整描述如何在 **Google Cloud Scheduler** 中创建两个定时任务：

- **每日刷新特征（不重训模型）**
- **每小时爬虫**

> 目标服务（Render）：`https://telegram-ml-services.onrender.com`

---

## 0. 任务前置条件（必须先完成）

### 0.1 Render 环境变量（ml-services）

确保 Render 上已设置：

- `CRON_SECRET`：你自己生成的随机长字符串（**用于鉴权**）
- `ENABLE_INTERNAL_SCHEDULER=false`（关闭内置定时器，避免重复）
- `MONGODB_URI`（已有）
- `DATABASE_URL`（可选，用于过滤用户）

> `CRON_SECRET` 查看位置：Render Dashboard → 服务 → Environment → 找到 `CRON_SECRET`。
> 如果没有，手动新增。

### 0.2 服务已部署包含以下接口

- `POST /jobs/refresh-features`
- `POST /jobs/crawl`

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

查看可用区域（任选一个常用区域，例如 `asia-east1` 或 `asia-northeast1`）：

```bash
gcloud scheduler locations list
```

> 假设选择 `asia-east1`。

---

## 3. 创建 Cloud Scheduler 作业

### 3.1 每日刷新特征（不重训模型）

**目标：** 每天 03:00（北京时间）刷新用户特征、必要时重建 FAISS。

**命令：**

```bash
gcloud scheduler jobs create http refresh-features-daily \
  --location=asia-east1 \
  --schedule="0 3 * * *" \
  --time-zone="Asia/Shanghai" \
  --http-method=POST \
  --uri="https://telegram-ml-services.onrender.com/jobs/refresh-features?days=1&rebuild_faiss=true&filter_users_from_postgres=true" \
  --headers="Authorization=Bearer <CRON_SECRET>"
```

说明：

- `days=1`：只处理最近 1 天的用户行为
- `rebuild_faiss=true`：重建 FAISS（可选，模型更新后建议开）
- `filter_users_from_postgres=true`：仅处理 PostgreSQL 真实用户

> 如果不想重建索引，可去掉 `rebuild_faiss=true`。

### 3.2 每小时爬虫

**命令：**

```bash
gcloud scheduler jobs create http crawl-hourly \
  --location=asia-east1 \
  --schedule="0 * * * *" \
  --time-zone="Asia/Shanghai" \
  --http-method=POST \
  --uri="https://telegram-ml-services.onrender.com/jobs/crawl" \
  --headers="Authorization=Bearer <CRON_SECRET>"
```

---

## 4. 验证作业是否创建成功

```bash
gcloud scheduler jobs list --location=asia-east1
```

查看某个任务详情：

```bash
gcloud scheduler jobs describe refresh-features-daily --location=asia-east1
```

手动立即触发一次测试：

```bash
gcloud scheduler jobs run refresh-features-daily --location=asia-east1
```

---

## 5. 常见问题排查

### 5.1 401 Unauthorized

- 说明 `CRON_SECRET` 不一致或未配置。
- 确认 Render 环境变量和 Scheduler header 完全一致。

### 5.2 作业执行但没有效果

- Render 可能处于休眠，任务触发会有延迟。
- 查看 Render Logs：确认 `/jobs/refresh-features` 或 `/jobs/crawl` 是否被调用。

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
- Location: `asia-east1`（可替换）
- Time Zone: `Asia/Shanghai`
- Refresh Features URL:
  - `https://telegram-ml-services.onrender.com/jobs/refresh-features?days=1&rebuild_faiss=true&filter_users_from_postgres=true`
- Crawl URL:
  - `https://telegram-ml-services.onrender.com/jobs/crawl`
- Auth Header:
  - `Authorization: Bearer <1663f2b1af5f96db3b47fbaf40653f31a1d8ded4b1c47c541ab602767e35649c>`
