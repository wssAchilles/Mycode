# 🚀 在 Google Colab Pro 上训练推荐模型（Mongo 语料）

本指南配合 `/Users/achilles/Documents/telegram/telegram/ml-services/train_on_colab_mongo.ipynb` 使用。

Notebook 会从 **MongoDB（posts/user_actions）** 构建训练数据，并生成可发布到 GCS 的 artifacts（Two-Tower + FAISS + 可选 Phoenix），让线上 `ANN` 返回 **Mongo `posts._id`（ObjectId string）**，从而真正打通 OON（Out-of-Network）召回。

## 是否需要 GPU

- Two-Tower：小规模 CPU 可跑但慢，建议 GPU（A100/T4 都可以）。
- Phoenix：Transformer 结构，强烈建议 GPU；同时建议使用小模型以满足 Cloud Run CPU 推理的 p95 目标。

## Step 1：准备 Colab 文件

- 上传以下文件/目录到 Google Drive（建议放到 `telegram/ml-services/` 目录下）
- `scripts/`
- `train_on_colab_mongo.ipynb`
- `requirements.txt`
- 不要上传 `data/`、`models/`（Notebook 会生成）

## Step 2：准备 MongoDB URI

- Notebook 会用 `getpass` 提示你输入 `MONGODB_URI`（不会写入到文件）
- 该账号需要读取 `posts` 和 `user_actions` 两个集合

## Step 3：配置 Colab 运行时

在 Colab 顶部菜单栏：

1. `Runtime` -> `Change runtime type`
2. Hardware accelerator 选择 `GPU`
3. 建议选 A100（可用就选），并打开 High RAM

## Step 4：运行训练

按 Notebook 单元格顺序执行，关键输出文件会生成在当前目录的：

- `data/news_vocab.pkl`（key 必须是 Mongo ObjectId string）
- `data/user_vocab.pkl`
- `data/item_embeddings.npy`
- `models/two_tower_epoch_latest.pt`
- `models/faiss_ivf_pq.index`
- `models/faiss_id_mapping.pkl`
- `models/phoenix_epoch_latest.pt`（可选）
- `stage/`（可上传到 GCS 的目录结构）
- `stage_bundle.tgz`（便于从 Colab 下载到本地）

## Step 5：上传到 GCS 并切换线上版本

1. 从 Colab 下载 `stage_bundle.tgz` 到本地并解压，得到 `stage/` 目录
2. 上传到 GCS（沿用你之前成功的方式）

```bash
BUCKET="telegram-467705-recsys"
ARTIFACT_VERSION="2026-02-07_build02"  # 例子：YYYY-MM-DD_buildNN

gcloud storage cp -r stage/* "gs://$BUCKET/artifacts/$ARTIFACT_VERSION/"
gcloud storage ls -r "gs://$BUCKET/artifacts/$ARTIFACT_VERSION/**"
```

3. 更新 Cloud Run（us-central1）

```bash
gcloud run services update telegram-ml-services \
  --project telegram-467705 \
  --region us-central1 \
  --update-env-vars "ARTIFACT_VERSION=$ARTIFACT_VERSION,TWO_TOWER_EMBEDDING_DIM=256,PHOENIX_EMBEDDING_DIM=256,PHOENIX_NUM_HEADS=8,PHOENIX_NUM_LAYERS=4"
```

## 常见问题

- Mongo 拉取慢：先把 `days_posts/days_actions` 调小（例如 7 天），验证链路通，再逐步放大
- OOM：降低 batch size；或把 embedding_dim / num_layers 调小
- 会话结束丢文件：务必先下载 `stage_bundle.tgz`

