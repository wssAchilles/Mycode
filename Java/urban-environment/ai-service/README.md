# AI异常检测微服务

基于Python的独立AI微服务，使用scikit-learn的IsolationForest算法进行PM2.5异常检测。

## 🏗️ 架构概览

```
IoT模拟器 → Kafka → Java后端 → AI微服务 → 异常检测结果
                 ↓
            PostgreSQL/TimescaleDB
                 ↓
            WebSocket推送 → Vue.js前端
```

## 📁 项目结构

```
ai-service/
├── main.py              # FastAPI应用主文件
├── train.py             # 模型训练脚本
├── test_ai_service.py   # 测试脚本
├── requirements.txt     # Python依赖
├── Dockerfile          # Docker配置
├── .env               # 环境变量配置
└── models/            # 模型存储目录
    └── anomaly_model.joblib
```

## 🚀 快速开始

### 方法1：使用Docker Compose（推荐）

```bash
# 1. 构建并启动所有服务（包括AI服务）
docker-compose up --build

# 2. 等待所有服务启动完成，然后训练AI模型
docker-compose exec ai-service python train.py

# 3. 启动IoT模拟器开始发送数据
python scripts/iot_simulator.py
```

### 方法2：本地开发模式

```bash
# 1. 进入ai-service目录
cd ai-service

# 2. 创建Python虚拟环境
python -m venv venv
source venv/bin/activate  # Linux/Mac
# 或
venv\Scripts\activate     # Windows

# 3. 安装依赖
pip install -r requirements.txt

# 4. 训练模型
python train.py

# 5. 启动API服务
python main.py
```

## 🧠 AI模型训练

### 训练步骤

1. **数据获取**: 从TimescaleDB获取历史PM2.5数据
2. **模型训练**: 使用IsolationForest算法训练异常检测模型
3. **模型保存**: 将训练好的模型保存为`models/anomaly_model.joblib`

```bash
# 运行训练脚本
python train.py
```

### 模型参数

- **算法**: IsolationForest (孤立森林)
- **污染率**: auto (自动检测)
- **树的数量**: 100
- **随机种子**: 42

## 🔧 API端点

### 健康检查
```http
GET /health
```

### 异常检测预测
```http
POST /predict
Content-Type: application/json

{
  "pm25": 25.6
}
```

**响应示例**:
```json
{
  "is_anomaly": false,
  "anomaly_score": 0.1234,
  "confidence": 0.85,
  "pm25_value": 25.6
}
```

### 模型信息
```http
GET /model-info
```

## 🧪 测试

### 运行测试脚本
```bash
python test_ai_service.py
```

测试包括：
- 健康检查
- 模型信息获取
- 异常检测功能测试
- 性能基准测试

## 🐳 Docker部署

### 构建镜像
```bash
docker build -t urban-ai-service .
```

### 运行容器
```bash
docker run -d \
  --name urban-ai-service \
  -p 8001:8000 \
  -e DB_HOST=your-db-host \
  -e DB_NAME=urban_environment_db \
  -e DB_USER=user \
  -e DB_PASSWORD=password \
  urban-ai-service
```

## ⚙️ 环境变量

| 变量名 | 描述 | 默认值 |
|--------|------|--------|
| `DB_HOST` | 数据库主机 | `urban-db` |
| `DB_NAME` | 数据库名称 | `urban_environment_db` |
| `DB_USER` | 数据库用户 | `user` |
| `DB_PASSWORD` | 数据库密码 | `password` |
| `DB_PORT` | 数据库端口 | `5432` |

## 🔗 系统集成

### Java后端集成

AI服务已集成到Java后端的`KafkaDataConsumer`中：

1. **接收数据**: 从Kafka接收传感器数据
2. **异常检测**: 调用AI服务进行异常检测
3. **数据存储**: 将数据保存到TimescaleDB
4. **实时推送**: 通过WebSocket推送到前端

### 服务通信

- **容器间通信**: `http://urban-ai-service:8000`
- **主机访问**: `http://localhost:8001`

## 📊 监控和日志

### 服务监控
```bash
# 检查AI服务状态
curl http://localhost:8001/health

# 检查Docker容器状态
docker-compose ps ai-service

# 查看AI服务日志
docker-compose logs -f ai-service
```

### 性能指标

- **响应时间**: 通常 < 100ms
- **并发能力**: 支持多个并发请求
- **模型大小**: 通常 < 1MB
- **内存使用**: ~200-500MB

## 🛠️ 故障排除

### 常见问题

1. **模型文件不存在**
   ```
   解决方案: 运行 python train.py 训练模型
   ```

2. **数据库连接失败**
   ```
   检查环境变量配置和数据库服务状态
   ```

3. **AI服务无响应**
   ```bash
   # 检查服务状态
   docker-compose ps ai-service
   
   # 重启AI服务
   docker-compose restart ai-service
   ```

## 📈 性能优化

### 模型优化
- 调整`contamination`参数
- 增加训练数据量
- 特征工程优化

### 服务优化
- 使用异步处理
- 添加缓存机制
- 负载均衡

## 🚦 开发路线图

- [ ] 支持多特征异常检测
- [ ] 模型在线学习和更新
- [ ] 异常等级分类
- [ ] 模型版本管理
- [ ] A/B测试支持

## 📚 技术栈

- **Web框架**: FastAPI
- **机器学习**: scikit-learn
- **数据处理**: pandas, numpy
- **数据库**: PostgreSQL + psycopg2
- **容器化**: Docker
- **日志**: Python logging

## 🤝 贡献指南

1. Fork项目
2. 创建特性分支
3. 提交更改
4. 创建Pull Request

## 📄 许可证

MIT License