# Phoenix 推荐系统 ML 服务

本模块包含 Two-Tower 召回模型和 Phoenix Ranking 模型的训练与推理代码。

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
