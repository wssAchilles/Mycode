# Firebase Cloud Functions 部署说明

## 环境准备

### 1. 安装Firebase CLI
```bash
npm install -g firebase-tools
```

### 2. 登录Firebase
```bash
firebase login
```

### 3. 初始化Firebase项目
```bash
firebase init
```
选择以下服务：
- Functions
- Storage 
- Firestore

## 部署步骤

### 1. 安装Python依赖
```bash
cd functions
pip install -r requirements.txt
```

### 2. 配置项目ID
编辑 `main.py` 中的 Firebase Cloud Functions URL:
```python
# 将 YOUR_PROJECT_ID 替换为实际的 Firebase 项目ID
_baseUrl = 'https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net'
```

### 3. 部署函数
```bash
firebase deploy --only functions
```

### 4. 验证部署
部署成功后，控制台会显示函数URL：
```
✔  Function URL (train_ml_model): https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/train_ml_model
✔  Function URL (get_experiment_history): https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/get_experiment_history
```

## Firebase配置

### 1. Storage配置
在Firebase Console中：
1. 进入 Storage 页面
2. 创建存储桶（如果还没有）
3. 设置规则允许已认证用户上传：
```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /datasets/{userId}/{fileName} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

### 2. Firestore配置
在Firebase Console中：
1. 进入 Firestore 页面
2. 创建数据库（选择生产模式）
3. 设置规则：
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /experiments/{document} {
      allow read, write: if request.auth != null && request.auth.uid == resource.data.user_id;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.user_id;
    }
  }
}
```

## Flutter客户端配置

在 `lib/ml/services/ml_service.dart` 中更新项目ID：
```dart
static const String _baseUrl = 'https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net';
```

## 测试

### 1. 本地测试
```bash
firebase emulators:start --only functions
```

### 2. 生产环境测试
使用Flutter应用上传CSV文件并训练模型

## 常见问题

### Q: 函数超时
A: 在 `main.py` 中增加内存和超时配置：
```python
@https_fn.on_request(
    memory=options.MemoryOption.GB_2,  # 增加到2GB
    timeout_sec=540,  # 增加到9分钟
)
```

### Q: CORS错误
A: 确保函数配置了正确的CORS选项：
```python
cors=options.CorsOptions(
    cors_origins="*",
    cors_methods=["POST", "OPTIONS", "GET"],
)
```

### Q: 依赖包太大
A: 考虑使用Google Cloud Build或Docker来构建更轻量的部署包

## 监控和日志

在Firebase Console中：
1. Functions页面查看执行日志
2. 监控函数调用次数和错误率
3. 设置预算警报避免超额费用
