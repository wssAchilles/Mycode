# 城市环境智能监测平台 - 部署指南

## 系统架构总览

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│   IoT 模拟器    │────▶│    Kafka     │────▶│  Spring Boot    │
└─────────────────┘     └──────────────┘     └─────────────────┘
                                                      │
                                    ┌─────────────────┼─────────────────┐
                                    ▼                 ▼                 ▼
                            ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
                            │ TimescaleDB  │ │   BigQuery   │ │ AI Service   │
                            └──────────────┘ └──────────────┘ └──────────────┘
                                    │                                   │
                                    └───────────────┬───────────────────┘
                                                    ▼
                                            ┌──────────────┐
                                            │   Vue 3 UI   │
                                            └──────────────┘
```

## 部署前准备

### 1. 系统要求
- Docker Desktop 20.10+
- Java 21+
- Node.js 18+
- Python 3.9+
- 至少8GB内存

### 2. Google Cloud配置（可选）
如需启用BigQuery功能：
1. 创建Google Cloud项目
2. 启用BigQuery API
3. 创建服务账号并下载JSON密钥
4. 将密钥文件放置在`backend/`目录

## 快速部署步骤

### Step 1: 克隆项目并配置环境

```bash
# 克隆项目
git clone <your-repo-url>
cd urban-environment

# 创建环境变量文件
cp .env.example .env
# 编辑.env文件，配置必要的环境变量
```

### Step 2: 启动基础设施

```bash
# 启动所有Docker容器
docker-compose up -d

# 验证容器状态
docker ps

# 预期看到以下容器运行中：
# - urban-db (PostgreSQL/TimescaleDB)
# - kafka
# - zookeeper
# - urban-backend (Spring Boot)
# - urban-ai-service (Python FastAPI)
```

### Step 3: 初始化数据库

数据库会在首次启动时自动初始化，包括：
- 创建TimescaleDB超表
- 设置数据分区策略
- 创建必要索引

### Step 4: 启动后端服务（如果未使用Docker）

```bash
cd backend

# 安装依赖并构建
./gradlew clean build

# 运行应用
./gradlew bootRun

# 或使用JAR文件
java -jar build/libs/backend-0.0.1-SNAPSHOT.jar
```

### Step 5: 启动前端应用

```bash
cd frontend

# 安装依赖
npm install

# 开发模式运行
npm run dev

# 生产构建
npm run build
npm run preview
```

### Step 6: 启动IoT模拟器

```bash
cd scripts

# 安装Python依赖
pip install kafka-python

# 运行模拟器
python iot_simulator.py
```

## 验证部署

### 1. 健康检查端点

- **后端健康检查**: http://localhost:8080/actuator/health
- **AI服务健康检查**: http://localhost:8001/health
- **前端应用**: http://localhost:5173

### 2. 功能验证清单

- [ ] Kafka消息队列正常接收数据
- [ ] 数据成功存储到TimescaleDB
- [ ] AI异常检测服务响应正常
- [ ] WebSocket实时推送工作
- [ ] 前端地图显示传感器位置
- [ ] 数据筛选功能正常工作
- [ ] 数据导出功能可用

### 3. 监控面板

访问以下地址查看系统状态：
- **主仪表盘**: http://localhost:5173/dashboard
- **传感器地图**: http://localhost:5173/map
- **Kafka管理**: 使用Kafka Manager或Kafdrop（需额外配置）

## 生产环境部署

### 1. 使用Kubernetes

```yaml
# k8s-deployment.yaml 示例
apiVersion: apps/v1
kind: Deployment
metadata:
  name: urban-environment-backend
spec:
  replicas: 3
  selector:
    matchLabels:
      app: urban-backend
  template:
    metadata:
      labels:
        app: urban-backend
    spec:
      containers:
      - name: backend
        image: urban-environment/backend:latest
        ports:
        - containerPort: 8080
        env:
        - name: SPRING_PROFILES_ACTIVE
          value: "production"
```

### 2. 使用Docker Swarm

```bash
# 初始化Swarm
docker swarm init

# 部署服务栈
docker stack deploy -c docker-compose.yml urban-env

# 扩展服务
docker service scale urban-env_backend=3
```

### 3. 云平台部署

#### Google Cloud Platform
```bash
# 构建并推送镜像到GCR
gcloud builds submit --tag gcr.io/[PROJECT-ID]/urban-backend

# 部署到Cloud Run
gcloud run deploy --image gcr.io/[PROJECT-ID]/urban-backend --platform managed
```

#### AWS ECS
```bash
# 推送到ECR
aws ecr get-login-password | docker login --username AWS --password-stdin [REGISTRY-URL]
docker push [REGISTRY-URL]/urban-backend:latest

# 更新ECS服务
aws ecs update-service --cluster urban-cluster --service urban-backend --force-new-deployment
```

## 配置优化

### 1. 性能优化

**PostgreSQL/TimescaleDB**
```sql
-- 优化查询性能
ALTER TABLE sensor_data SET (timescaledb.compress);
SELECT add_compression_policy('sensor_data', INTERVAL '7 days');

-- 创建索引
CREATE INDEX idx_sensor_data_device_time ON sensor_data (device_id, timestamp DESC);
CREATE INDEX idx_sensor_data_anomaly ON sensor_data (is_anomaly) WHERE is_anomaly = true;
```

**Kafka配置**
```properties
# 生产环境kafka配置
num.network.threads=8
num.io.threads=8
socket.send.buffer.bytes=102400
socket.receive.buffer.bytes=102400
socket.request.max.bytes=104857600
```

### 2. 安全加固

- 启用HTTPS/TLS
- 配置防火墙规则
- 使用密钥管理服务
- 启用审计日志
- 定期安全扫描

### 3. 监控和告警

**Prometheus + Grafana**
```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'spring-boot'
    metrics_path: '/actuator/prometheus'
    static_configs:
      - targets: ['localhost:8080']
```

**ELK Stack日志收集**
```yaml
# logstash.conf
input {
  file {
    path => "/var/log/urban-environment/*.log"
    start_position => "beginning"
  }
}
output {
  elasticsearch {
    hosts => ["localhost:9200"]
    index => "urban-env-%{+YYYY.MM.dd}"
  }
}
```

## 故障排除

### 常见问题

1. **Kafka连接失败**
   - 检查Zookeeper是否运行正常
   - 验证Kafka端口29092是否开放
   - 查看Kafka日志：`docker logs kafka`

2. **数据库连接错误**
   - 确认PostgreSQL容器运行中
   - 检查数据库凭证是否正确
   - 验证端口5433未被占用

3. **AI服务无响应**
   - 检查模型文件是否存在
   - 验证Python依赖完整安装
   - 查看服务日志：`docker logs urban-ai-service`

4. **WebSocket连接断开**
   - 检查防火墙设置
   - 验证STOMP端点配置
   - 查看浏览器控制台错误

### 日志位置

- **后端日志**: `backend/logs/`
- **Docker日志**: `docker logs [container-name]`
- **前端日志**: 浏览器开发者工具控制台

## 备份和恢复

### 数据库备份
```bash
# 备份
docker exec urban-db pg_dump -U user urban_environment_db > backup.sql

# 恢复
docker exec -i urban-db psql -U user urban_environment_db < backup.sql
```

### 配置备份
```bash
# 备份所有配置
tar -czf config-backup.tar.gz backend/src/main/resources/ frontend/.env docker-compose.yml
```

## 性能基准

在标准配置下的预期性能：

- **数据摄入**: 10,000+ 消息/秒
- **查询响应**: < 100ms (P95)
- **WebSocket延迟**: < 50ms
- **AI预测**: < 200ms/请求
- **并发用户**: 1000+

## 维护计划

### 日常维护
- 检查系统健康状态
- 监控资源使用情况
- 清理过期日志

### 周期性维护
- 更新依赖库（每月）
- 数据库优化（每周）
- 安全补丁更新（按需）
- 性能调优（每季度）

## 支持和文档

- **API文档**: http://localhost:8080/swagger-ui
- **前端组件文档**: http://localhost:5173/storybook
- **项目Wiki**: [链接到项目Wiki]
- **问题跟踪**: [链接到Issue Tracker]

## 许可证

MIT License - 详见LICENSE文件

---
最后更新：2024年12月
版本：2.0.0
