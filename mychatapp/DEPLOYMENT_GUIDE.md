# MyChatApp 部署和运行指南

## 🚀 快速开始

### 前置要求
- Flutter SDK (>=3.0.0)
- Firebase 项目已配置
- Android Studio / VS Code
- Git

### 1. 安装依赖
```bash
cd d:\Code\mychatapp
flutter pub get
```

### 2. Firebase 配置检查
确保以下文件存在：
- `lib/firebase_options.dart` (已存在)
- `android/app/google-services.json`
- `ios/Runner/GoogleService-Info.plist`

### 3. 运行应用
```bash
# 检查连接的设备
flutter devices

# 运行应用 (Debug模式)
flutter run

# 运行应用 (Release模式)
flutter run --release
```

## 📱 功能验证清单

### ✅ 用户认证系统
- [ ] 用户注册功能
- [ ] 用户登录功能
- [ ] 用户登出功能
- [ ] 密码重置功能
- [ ] 认证状态自动切换

### ✅ 用户列表与资料
- [ ] 实时用户列表显示
- [ ] 搜索用户功能
- [ ] 过滤当前用户
- [ ] 用户头像显示

### ✅ 实时聊天功能
- [ ] 一对一聊天
- [ ] 实时消息同步
- [ ] 消息状态显示
- [ ] 聊天记录持久化
- [ ] 消息时间戳

### ✅ 推送通知 (需要物理设备测试)
- [ ] 离线消息推送
- [ ] 通知点击跳转
- [ ] FCM Token 管理

## 🔧 开发调试

### 启用调试模式
```bash
flutter run --debug
```

### 查看日志
```bash
flutter logs
```

### 热重载
在调试模式下，按 `r` 进行热重载，按 `R` 进行热重启。

## 📊 Firebase Console 检查

### Firestore 数据结构
检查以下集合是否正确创建：
- `users` - 用户信息
- `chat_rooms` - 聊天室
- `chat_rooms/{chatRoomId}/messages` - 消息记录

### Cloud Functions
确保以下函数已部署：
- `createUserDocument` - 用户文档创建
- `sendMessageNotification` - 推送通知
- `cleanupUserData` - 用户数据清理
- `cleanupExpiredTokens` - FCM令牌清理

## ⚠️ 常见问题解决

### 1. Firebase 连接失败
- 检查 `google-services.json` 和 `GoogleService-Info.plist` 是否正确配置
- 确认 Firebase 项目中已启用 Authentication 和 Firestore

### 2. 推送通知不工作
- 确认已完成 FCM 配置步骤
- iOS 需要在真机上测试
- 检查 Firebase Console 中的 Cloud Messaging 设置

### 3. 构建失败
```bash
flutter clean
flutter pub get
flutter build apk  # Android
flutter build ios  # iOS
```

## 🚀 生产部署

### Android APK
```bash
flutter build apk --release
```

### iOS IPA
```bash
flutter build ios --release
```

### Cloud Functions 部署
```bash
cd functions
npm run deploy
```

## 📋 下一步开发建议

### 第二阶段功能
- 多媒体消息 (图片、语音、视频)
- 群组聊天
- 在线状态显示
- 消息回复和表情回应

### 第三阶段功能
- Google Maps 位置分享
- 智能回复建议
- 语音转文字
- 消息翻译
