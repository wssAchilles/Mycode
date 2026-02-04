# Phoenix 推荐系统 ML 服务

本模块包含 Two-Tower 召回模型和 Phoenix Ranking 模型的训练与推理代码。

## 目录结构
- `data/` - 处理后的数据缓存
- `models/` - 保存的模型权重
- `scripts/` - 训练和推理脚本

## 快速开始
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
