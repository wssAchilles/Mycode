# ML Platform MCP Server

为 ML Platform 提供 AI 辅助学习功能的 Model Context Protocol (MCP) 服务器。

## 🎯 功能特性

### 1. 算法解释 (`explain_algorithm`)
- 解释算法原理、复杂度和应用场景
- 支持三种详细程度: basic, detailed, expert
- 覆盖排序、数据结构、操作系统、机器学习算法

### 2. 代码生成 (`generate_visualization_code`)
- 自动生成 Flutter 算法可视化代码
- 支持不同动画风格
- 包含完整的 CustomPaint 实现

### 3. 实验分析 (`analyze_ml_results`)
- 分析机器学习模型性能
- 识别过拟合/欠拟合问题
- 提供优化建议

### 4. 超参数建议 (`suggest_hyperparameters`)
- 根据数据集特征推荐超参数
- 提供调优策略
- 解释参数作用

### 5. 算法比较 (`compare_algorithms`)
- 多算法性能对比
- 适用场景分析
- 选择建议

### 6. 代码调试 (`debug_visualization`)
- Flutter 可视化代码调试
- 错误原因分析
- 修复方案

## 🚀 快速开始

### 1. 安装依赖

```bash
cd mcp_server
pip install -r requirements.txt
```

### 2. 配置环境变量

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env 文件,填入你的 API Key
# 获取 Anthropic API Key: https://console.anthropic.com/
```

### 3. 运行 MCP Server

```bash
python server.py
```

### 4. 在 Claude Desktop 中配置

编辑 Claude Desktop 配置文件:

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "ml-platform": {
      "command": "python",
      "args": [
        "D:/Code/ml_platform/mcp_server/server.py"
      ],
      "env": {
        "ANTHROPIC_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

## 📖 使用示例

### 在 Claude Desktop 中使用

1. 打开 Claude Desktop
2. 询问关于算法的问题,MCP 工具会自动调用

示例对话:
```
用户: 请解释快速排序算法的原理

Claude 会自动调用 explain_algorithm 工具,
提供详细的算法解释
```

### 在代码中调用 (通过 Firebase Cloud Functions)

```python
import requests

response = requests.post(
    'https://your-project.cloudfunctions.net/mcp_chat_assistant',
    json={
        'tool': 'explain_algorithm',
        'arguments': {
            'algorithm_name': 'quick_sort',
            'category': 'sorting',
            'detail_level': 'basic'
        }
    }
)

result = response.json()
print(result['explanation'])
```

## 🔧 工具详细说明

### explain_algorithm

解释算法原理和特性。

**参数:**
- `algorithm_name` (string, 必需): 算法名称
- `category` (string, 必需): 算法类别
  - `sorting`: 排序算法
  - `data_structures`: 数据结构
  - `os_algorithms`: 操作系统算法
  - `ml_algorithms`: 机器学习算法
- `detail_level` (string, 可选): 详细程度
  - `basic`: 基础解释 (默认)
  - `detailed`: 详细解释
  - `expert`: 专家级解释

**示例:**
```json
{
  "algorithm_name": "bubble_sort",
  "category": "sorting",
  "detail_level": "detailed"
}
```

### generate_visualization_code

生成算法可视化代码。

**参数:**
- `algorithm_type` (string, 必需): 算法类型
- `framework` (string, 可选): 框架 (默认 "flutter")
- `animation_style` (string, 可选): 动画风格
  - `basic`: 基础动画
  - `smooth`: 平滑动画 (默认)
  - `interactive`: 交互式动画

**示例:**
```json
{
  "algorithm_type": "merge_sort",
  "framework": "flutter",
  "animation_style": "smooth"
}
```

### analyze_ml_results

分析机器学习实验结果。

**参数:**
- `metrics` (object, 必需): 评估指标
- `task_type` (string, 必需): 任务类型
- `model_type` (string, 可选): 模型类型

**示例:**
```json
{
  "metrics": {
    "accuracy": 0.85,
    "precision": 0.82,
    "recall": 0.88,
    "f1_score": 0.85
  },
  "task_type": "classification",
  "model_type": "RandomForestClassifier"
}
```

### suggest_hyperparameters

建议模型超参数配置。

**参数:**
- `model_name` (string, 必需): 模型名称
- `task_type` (string, 必需): 任务类型
- `dataset_info` (object, 可选): 数据集信息

**示例:**
```json
{
  "model_name": "RandomForestClassifier",
  "task_type": "classification",
  "dataset_info": {
    "n_samples": 1000,
    "n_features": 20,
    "n_classes": 3
  }
}
```

### compare_algorithms

比较多个算法。

**参数:**
- `algorithms` (array, 必需): 算法列表
- `category` (string, 必需): 算法类别
- `comparison_criteria` (array, 可选): 比较维度

**示例:**
```json
{
  "algorithms": ["bubble_sort", "quick_sort", "merge_sort"],
  "category": "sorting",
  "comparison_criteria": ["complexity", "performance", "use_cases"]
}
```

### debug_visualization

调试可视化代码。

**参数:**
- `error_message` (string, 必需): 错误信息
- `code_snippet` (string, 可选): 代码片段
- `context` (string, 可选): 问题上下文

**示例:**
```json
{
  "error_message": "RenderBox was not laid out",
  "code_snippet": "class MyPainter extends CustomPainter {...}",
  "context": "在绘制排序动画时出现错误"
}
```

## 🏗️ 架构说明

```
MCP Server
├── server.py              # 主服务器文件
├── requirements.txt       # Python 依赖
├── .env                   # 环境变量 (不提交到 git)
├── .env.example           # 环境变量示例
└── README.md              # 本文档
```

### 与 Firebase 集成

MCP Server 可以通过 Firebase Cloud Functions 暴露给前端:

```python
# functions/main.py 中添加

@https_fn.on_request()
def mcp_chat_assistant(req: https_fn.Request):
    """
    MCP 聊天助手 API
    前端调用此函数来使用 MCP 功能
    """
    import subprocess
    import json
    
    data = req.get_json()
    tool = data.get('tool')
    arguments = data.get('arguments')
    
    # 调用 MCP Server
    result = subprocess.run(
        ['python', 'mcp_server/server.py', tool, json.dumps(arguments)],
        capture_output=True,
        text=True
    )
    
    return {
        'status': 'success',
        'result': result.stdout
    }
```

## 🔐 安全性

- API Key 存储在环境变量中,不要提交到代码库
- 使用 `.gitignore` 忽略 `.env` 文件
- 在生产环境中使用 Firebase Secret Manager

## 📊 监控与日志

MCP Server 使用 `loguru` 进行日志记录:

```python
from loguru import logger

logger.info("MCP Server started")
logger.error("Error occurred: {}", error_message)
```

## 🤝 贡献

欢迎贡献新的 MCP 工具!

1. Fork 本项目
2. 创建功能分支
3. 在 `server.py` 中添加新工具
4. 更新本 README
5. 提交 Pull Request

## 📄 许可证

MIT License
