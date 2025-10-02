# Social App - Flutter + Firebase Data Connect

这是一个使用 Flutter 和 Firebase Data Connect 构建的社交媒体应用。

## 🚀 项目结构

```
social_app/
├── lib/
│   ├── main.dart                 # 应用入口
│   ├── firebase_options.dart     # Firebase 配置
│   ├── services/
│   │   ├── auth_service.dart     # 认证服务
│   │   └── data_connect_service.dart # Data Connect 服务
│   └── screens/
│       ├── auth_wrapper.dart     # 认证包装器
│       ├── login_screen.dart     # 登录页面
│       └── home_screen.dart      # 主页面
└── pubspec.yaml                  # 依赖配置
```

## 📋 下一步开发任务

### 1. 配置 Firebase

首先需要配置您的 Firebase 项目：

```bash
# 在 social_app 目录下运行
flutterfire configure --project=xzqcjnb666
```

这将：
- 下载配置文件
- 更新 firebase_options.dart
- 配置 Android/iOS 项目

### 2. 集成 Data Connect SDK

Data Connect SDK 已经生成在 `../dataconnect-generated/dart/default_connector/` 目录下。

需要在 `pubspec.yaml` 中添加对生成的 SDK 的依赖：

```yaml
dependencies:
  default_connector:
    path: ../dataconnect-generated/dart/default_connector
```

然后在 `data_connect_service.dart` 中取消注释相关代码并导入 SDK。

### 3. 实现核心功能

#### 3.1 帖子功能
- [ ] 发布文本帖子
- [ ] 显示帖子列表
- [ ] 点赞帖子
- [ ] 评论帖子
- [ ] 图片/视频帖子

#### 3.2 用户功能
- [ ] 用户注册/登录
- [ ] 用户资料编辑
- [ ] 关注/取消关注
- [ ] 搜索用户

#### 3.3 UI 优化
- [ ] 优化界面设计
- [ ] 添加头像上传
- [ ] 实现下拉刷新
- [ ] 添加无限滚动

### 4. 运行和测试

```bash
# 安装依赖
flutter pub get

# 运行应用
flutter run
```

### 5. 启动模拟器

在另一个终端中启动 Firebase 模拟器：

```bash
# 在 Firebase 项目根目录下
firebase emulators:start --only dataconnect
```

## 🔧 开发提示

### Data Connect 查询示例

项目已经定义了以下 GraphQL 操作：

1. **CreatePost** - 创建帖子
2. **GetAllPosts** - 获取所有帖子
3. **GetPostsByUser** - 获取用户帖子
4. **LikePost** - 点赞帖子
5. **CreateComment** - 创建评论
6. **FollowUser** - 关注用户
7. **SearchUsers** - 搜索用户

### 认证集成

应用使用 Firebase Authentication 进行用户认证。用户登录后，可以通过 `auth.uid` 在 Data Connect 查询中获取当前用户ID。

### 模拟器使用

- Data Connect 模拟器：http://localhost:9399
- Authentication 模拟器：http://localhost:9099

## 🐛 常见问题

1. **Data Connect SDK 导入问题**
   - 确保 SDK 路径正确
   - 运行 `flutter pub get` 更新依赖

2. **模拟器连接问题**
   - 确保模拟器正在运行
   - 检查端口是否被占用

3. **认证问题**
   - 确保 Firebase Authentication 已启用
   - 检查 firebase_options.dart 配置

## 📱 支持的平台

- ✅ Android
- ✅ iOS
- ✅ Web
- ✅ Windows
- ✅ macOS

## 🎯 后续功能规划

- [ ] 实时聊天
- [ ] 推送通知
- [ ] 内容推荐算法
- [ ] 多媒体处理
- [ ] 数据分析
