# Phoenix 推荐系统 ML 服务

本模块包含 Two-Tower 召回模型和 Phoenix Ranking 模型的训练与推理代码。生产部署在 GCP Cloud Run；前端不直连，一律经 Node Backend 代理。

## 在线 API（Serving）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 模型加载状态、artifact 版本、FAISS 状态 |
| POST | `/ann/retrieve` | Two-Tower + FAISS 召回 |
| POST | `/phoenix/predict` | Phoenix 多目标排序 |
| POST | `/feed/recommend` | 端到端：ANN → Phoenix → VF |
| POST | `/vf/check`、`/vf/check/v2` | 内容安全过滤 |
| POST | `/vf/blacklist/*`、`/vf/rules/add` | 黑名单与动态规则 |
| POST | `/jobs/*` | 特征刷新、爬取、归档、语料导入（`CRON_SECRET`） |
| GET/POST | `/agent/health`、`/agent/respond` | Agent Plane（Gemini） |

约定摘要：

- **ANN**：`{userId, historyPostIds, keywords?, topK}` → `{candidates:[{postId, score}]}`；FAISS ivf_pq，无索引时退化暴力检索；`ANN_TOPK_CAP` 默认 400。
- **Phoenix**：模型真实 head 为 click/like/reply/repost；quote/share/dwell/report 等为启发式合成，下游勿当校准概率使用。
- **VF**：in-network 可放行 LOW_RISK，OON 仅 SAFE（可用 env 调整）。
- 设备固定 CPU；artifact 从 GCS `telegram-467705-recsys` 按 `ARTIFACT_VERSION` 加载；支持 `full` / `serving-lite` profile。

与 `telegram-light-jobs` 的 crawl/archive 存在双实现，新增 job 时先确认归属。

## 目录结构
- `data/` - 处理后的数据缓存
- `models/` - 保存的模型权重
- `scripts/` - 训练和推理脚本

## MIND 快速开始
```bash
# 1. 安装依赖
pip install -r requirements.txt

# 2. 预处理数据
python scripts/preprocess_mind.py

# 3. 训练 Two-Tower 模型
python scripts/train_two_tower.py

# 4. 训练 Phoenix Ranking 模型
python scripts/train_phoenix.py
```

## KuaiRec / KuaiRand 训练流程

KuaiRec / KuaiRand 会被转换成当前线上服务已经支持的 artifact contract：

- `data/news_dict.pkl`
- `data/news_vocab.pkl`
- `data/user_vocab.pkl`
- `data/train_samples.pkl`
- `data/dev_samples.pkl`
- `models/two_tower_epoch_latest.pt`
- `models/phoenix_epoch_latest.pt`
- `models/faiss_ivf_pq.index`
- `models/faiss_id_mapping.pkl`

在 Colab 挂载 Google Drive 后，按实际目录传入：

```bash
python scripts/preprocess_kuaishou.py \
  --kuairec-dir /content/drive/MyDrive/telegram/KuaiRec \
  --kuairand-dir /content/drive/MyDrive/telegram/KuaiRand-27K \
  --kuairand-content-dir /content/drive/MyDrive/telegram/KuaiRand-content \
  --max-train-samples 5000000 \
  --max-dev-samples 500000

python scripts/train_two_tower.py \
  --epochs 10 \
  --batch-size 65536 \
  --embedding-dim 768

python scripts/train_phoenix.py \
  --epochs 3 \
  --batch-size 1536 \
  --embedding-dim 768 \
  --num-heads 12 \
  --num-layers 12

python scripts/build_faiss_index.py --type ivf_pq

python scripts/publish_artifacts.py \
  --bucket telegram-467705-recsys \
  --version 2026-04-28_kuai01 \
  --faiss-index-type ivf_pq
```

然后切换 Cloud Run artifact 版本：

```bash
gcloud run services update telegram-ml-services \
  --region us-central1 \
  --project telegram-467705 \
  --update-env-vars ARTIFACT_VERSION=2026-04-28_kuai01
```

注意：KuaiRec/KuaiRand 产出的 `postId` 是 `kuairec_*` / `kuairand_*` 外部 ID。若要让 ANN 召回内容在前端可见，需要先执行语料导入任务，把 `news_dict.pkl` 中的外部内容导入 Mongo，并写入 `newsMetadata.externalId`。
