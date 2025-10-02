# 城市环境智能分析平台

这是一个用于城市环境数据收集、分析和可视化的平台。该项目使用Spring Boot作为后端，Vue 3作为前端，通过Google Maps API实现地理数据可视化。

## 项目结构

```
urban-environment/
├── backend/                  # Spring Boot 后端
│   ├── src/                  # 源代码
│   │   ├── main/
│   │   │   ├── java/        # Java代码
│   │   │   └── resources/   # 配置文件
│   │   └── test/            # 测试代码
│   └── build.gradle         # Gradle构建脚本
├── frontend/                 # Vue 3 前端
│   ├── public/              # 静态资源
│   ├── src/                 # 源代码
│   │   ├── views/           # 视图组件
│   │   ├── services/        # API服务
│   │   ├── router/          # 路由配置
│   │   └── types/           # TypeScript类型定义
│   └── package.json         # NPM配置
└── scripts/                  # 辅助脚本
    └── iot_simulator.py     # IoT设备模拟器
```

## 技术栈

### 后端
- Java 21
- Spring Boot 3.x
- Spring Data JPA
- PostgreSQL数据库
- Gradle

### 前端
- Vue 3
- TypeScript
- Vue Router
- Google Maps API
- Axios

## 数据流

1. IoT模拟器(`scripts/iot_simulator.py`)产生模拟的传感器数据
2. 模拟数据通过HTTP POST请求发送到后端API
3. 后端将数据保存到PostgreSQL数据库
4. 前端通过HTTP GET请求从后端获取数据
5. 数据在地图上以标记点的形式显示

## 快速开始

### 数据库设置

使用Docker启动PostgreSQL数据库:

```bash
docker-compose up -d
```

### 后端启动

```bash
cd backend
./gradlew bootRun
```

### 前端启动

```bash
cd frontend
npm install
npm run dev
```

### IoT模拟器启动

```bash
cd scripts
python iot_simulator.py
```

## API文档

### 传感器数据API

#### 接收传感器数据

- **URL:** `/api/data`
- **方法:** `POST`
- **请求体:**
```json
{
  "deviceId": "sensor-tokyo-01",
  "latitude": 35.6895,
  "longitude": 139.6917,
  "pm25": 25.4,
  "timestamp": "2023-06-15T12:34:56Z"
}
```
- **响应:** 返回保存的数据对象（包含ID）

#### 获取最新传感器数据

- **URL:** `/api/data/latest`
- **方法:** `GET`
- **响应:** 返回传感器数据列表

## 环境变量配置

### 后端环境变量

在`backend/src/main/resources/application.properties`中配置:

```properties
spring.datasource.url=jdbc:postgresql://localhost:5432/urban_environment_db
spring.datasource.username=user
spring.datasource.password=password
```

### 前端环境变量

在`frontend/.env`中配置:

```
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here
```

## 后续开发计划

1. 实现数据筛选和过滤功能
2. 添加数据分析和统计功能
3. 实现用户认证和授权
4. 添加实时数据更新功能
5. 扩展传感器类型和数据维度
