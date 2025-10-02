# Urban Environment Phase 2 升级指南

## 概述
本项目已成功从Phase 1的简单MVP升级为Phase 2的基于消息队列的实时流处理架构。

## 新架构特点

### 数据流
```
IoT模拟器 → Kafka (sensor-data-topic) → Spring Boot消费者 → TimescaleDB/PostgreSQL
                                                    ↓
                                            前端查询API ← Vue.js前端
```

### 技术栈变更
- **新增**: Apache Kafka, Zookeeper, TimescaleDB
- **修改**: Spring Boot (集成Kafka), Python模拟器 (Kafka生产者)

## 启动步骤

### 1. 启动基础设施

#### 完整版本 (需要网络连接)
```bash
docker-compose up -d
```

#### 简化版本 (仅PostgreSQL，适用于网络问题)
```bash
docker-compose -f docker-compose.simple.yml up -d
```

### 2. 安装Python依赖
```bash
pip install kafka-python
```

### 3. 启动后端应用
```bash
cd backend
./gradlew bootRun
```

### 4. 启动IoT模拟器
```bash
python scripts/iot_simulator.py
```

### 5. 启动前端 (可选)
```bash
cd frontend
npm run dev
```

## 配置说明

### 测试环境
- 使用H2内存数据库
- 不需要Kafka连接
- 自动跳过TimescaleDB初始化

### 生产环境
- 使用PostgreSQL/TimescaleDB
- 需要Kafka服务
- 自动创建TimescaleDB超表

## 故障排除

### 1. Docker网络问题
如果无法拉取Docker镜像，使用本地PostgreSQL或使用简化配置：
```bash
docker-compose -f docker-compose.simple.yml up -d
```

### 2. Kafka连接问题
检查Kafka服务是否正常启动：
```bash
docker-compose ps
```

### 3. 数据库连接问题
确保PostgreSQL容器正常运行并且端口5432可访问。

## API端点

### 数据查询
- `GET /api/data/latest` - 获取最新传感器数据

### 注意事项
- 旧的 `POST /api/data` 端点已移除
- 数据现在通过Kafka消息队列接收

## 性能优势

1. **解耦性**: 生产者和消费者解耦，提高系统弹性
2. **可扩展性**: 可轻松添加多个消费者和生产者
3. **时序优化**: TimescaleDB超表提供卓越的时序数据性能
4. **实时性**: 基于消息队列的实时数据流处理
5. **容错性**: Kafka提供消息持久化和重试机制
