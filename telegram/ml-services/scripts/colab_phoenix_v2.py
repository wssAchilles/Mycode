# ============================================================
# Google Colab 快速启动脚本
# ============================================================
# 使用方法:
#   1. 在 Colab 中选择 GPU 运行时 (Runtime → Change runtime type → T4 GPU)
#   2. 将此脚本内容复制到 Colab notebook cell 中
#   3. 按顺序执行各 cell
#
# 或者: 直接上传整个 ml-services/scripts/ 目录到 Colab
# ============================================================


# ============================================================
# Cell 1: 安装依赖 & 挂载 Google Drive
# ============================================================
"""
!pip install torch tqdm pymongo

# 挂载 Google Drive (用于保存模型和数据)
from google.colab import drive
drive.mount('/content/drive')

# 创建工作目录
import os
os.makedirs('/content/drive/MyDrive/phoenix_v2/data', exist_ok=True)
os.makedirs('/content/drive/MyDrive/phoenix_v2/models', exist_ok=True)
"""


# ============================================================
# Cell 2: 检查 GPU
# ============================================================
"""
import torch
print(f"PyTorch: {torch.__version__}")
print(f"CUDA: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    print(f"显存: {torch.cuda.get_device_properties(0).total_mem / 1e9:.1f} GB")
"""


# ============================================================
# Cell 3: 导出训练数据
# ============================================================
# 如果你已经有本地导出的 pickle 文件, 跳过此步骤,
# 直接上传 phoenix_v2_samples.pkl 和 vocab 文件到 Drive

"""
# 方式 A: 从 MongoDB 导出 (需要公网可达的 MongoDB)
!python export_training_data.py \\
    --mongo-uri "mongodb://YOUR_HOST:27017/telegram_db" \\
    --days 30 \\
    --min-actions 5 \\
    --output /content/drive/MyDrive/phoenix_v2/data/phoenix_v2_samples.pkl

# 方式 B: 从本地上传 (推荐)
# 在本地运行:
#   python export_training_data.py --mongo-uri mongodb://localhost:27017/telegram_db --days 30
# 然后上传 data/phoenix_v2_*.pkl 到 Colab
"""


# ============================================================
# Cell 4: 训练 Mini Phoenix (T4, ~10分钟/epoch)
# ============================================================
"""
!python train_phoenix_v2.py \\
    --data-dir /content/drive/MyDrive/phoenix_v2/data \\
    --models-dir /content/drive/MyDrive/phoenix_v2/models \\
    --model-size mini \\
    --batch-size 256 \\
    --epochs 10 \\
    --lr 3e-4 \\
    --max-history 64
"""


# ============================================================
# Cell 5: 训练 Medium Phoenix (A100, ~20分钟/epoch)
# ============================================================
"""
!python train_phoenix_v2.py \\
    --data-dir /content/drive/MyDrive/phoenix_v2/data \\
    --models-dir /content/drive/MyDrive/phoenix_v2/models \\
    --model-size medium \\
    --batch-size 128 \\
    --epochs 15 \\
    --lr 1e-4 \\
    --max-history 100
"""


# ============================================================
# Cell 6: 测试推理延迟
# ============================================================
"""
import torch
import time
from phoenix_v2_model import create_mini_phoenix

model = create_mini_phoenix()
model.eval()
model = model.cuda() if torch.cuda.is_available() else model

# 模拟输入
B = 16
with torch.no_grad():
    user_ids = torch.randint(0, 1000, (B,), device='cuda')
    hist_posts = torch.randint(0, 10000, (B, 64), device='cuda')
    hist_authors = torch.randint(0, 5000, (B, 64), device='cuda')
    hist_actions = torch.randint(0, 13, (B, 64), device='cuda')
    hist_mask = torch.ones(B, 64, device='cuda')
    cand_posts = torch.randint(0, 10000, (B, 1), device='cuda')
    cand_authors = torch.randint(0, 5000, (B, 1), device='cuda')
    cand_mask = torch.ones(B, 1, device='cuda')

    # Warmup
    for _ in range(10):
        model(user_ids, hist_posts, hist_authors, hist_actions, hist_mask,
              cand_posts, cand_authors, cand_mask)

    # Benchmark
    torch.cuda.synchronize()
    t0 = time.time()
    for _ in range(100):
        model(user_ids, hist_posts, hist_authors, hist_actions, hist_mask,
              cand_posts, cand_authors, cand_mask)
    torch.cuda.synchronize()
    elapsed = time.time() - t0

    print(f"推理延迟: {elapsed/100*1000:.1f} ms/batch (batch_size={B})")
    print(f"单样本延迟: {elapsed/100/B*1000:.2f} ms/sample")
    print(f"QPS: {B*100/elapsed:.0f}")
"""


# ============================================================
# Cell 7: 查看训练结果
# ============================================================
"""
import os
model_dir = '/content/drive/MyDrive/phoenix_v2/models'
for f in sorted(os.listdir(model_dir)):
    path = os.path.join(model_dir, f)
    size_mb = os.path.getsize(path) / (1024*1024)
    print(f"  {f:40s} {size_mb:.1f} MB")
"""
