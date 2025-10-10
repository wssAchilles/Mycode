# Firebase Social App - 现代社交媒体平台

基于 **Firebase Data Connect** 和 **Flutter** 构建的全栈社交媒体应用，展示了现代Firebase服务的强大能力和GraphQL数据层的优势。

## 🏗️ 项目架构

```
Firebase/
├── dataconnect/                    # Firebase Data Connect 后端配置
│   ├── schema/
│   │   └── schema.gql             # PostgreSQL数据模型定义
│   ├── connector/
│   │   └── default.gql            # GraphQL查询和变更操作
│   └── dataconnect.yaml           # Data Connect服务配置
├── dataconnect-generated/          # 自动生成的SDK
│   └── dart/                      # Flutter/Dart SDK
├── social_app/                     # Flutter移动应用
│   ├── lib/
│   │   ├── main.dart
│   │   ├── services/              # 业务逻辑层
│   │   └── screens/               # UI界面层
│   └── pubspec.yaml
└── firebase.json                   # Firebase项目配置
```

## 🚀 核心技术栈

### 后端服务
- **Firebase Data Connect** - 现代化的GraphQL数据层
- **Cloud SQL (PostgreSQL)** - 关系型数据库
- **Firebase Authentication** - 用户认证系统
- **Firebase Emulator Suite** - 本地开发环境

### 前端应用
- **Flutter** - 跨平台移动应用框架
- **Dart** - 应用开发语言
- **Firebase SDK** - 客户端集成
- **Auto-generated SDK** - 类型安全的数据访问层

### 数据层
- **GraphQL** - 查询语言和API规范
- **PostgreSQL** - 生产级关系型数据库
- **Real-time subscriptions** - 实时数据同步
- **Type-safe operations** - 编译时类型检查

## 📊 数据模型设计

### 核心实体关系

```sql
-- 用户表
User {
  username: String!          # 用户名（唯一）
  email: String!            # 邮箱地址
  displayName: String       # 显示名称
  bio: String              # 个人简介
  profilePictureUrl: String # 头像URL
  createdAt: Timestamp!     # 创建时间
  lastLoginAt: Timestamp    # 最后登录时间
}

-- 帖子表
Post {
  author: User!            # 作者（外键）
  content: String!         # 帖子内容
  postType: String!        # 类型：TEXT/IMAGE/VIDEO
  mediaUrl: String         # 媒体文件URL
  caption: String          # 媒体说明
  createdAt: Timestamp!    # 发布时间
}

-- 评论表
Comment {
  author: User!            # 评论者（外键）
  post: Post!             # 所属帖子（外键）
  text: String!           # 评论内容
  createdAt: Timestamp!   # 评论时间
}

-- 点赞表（复合主键）
Like {
  user: User!             # 点赞用户（外键）
  post: Post!             # 被点赞帖子（外键）
  createdAt: Timestamp!   # 点赞时间
}

-- 关注关系表（复合主键）
Follow {
  follower: User!         # 关注者（外键）
  following: User!        # 被关注者（外键）
  createdAt: Timestamp!   # 关注时间
}

-- 私信表
Message {
  sender: User!           # 发送者（外键）
  receiver: User!         # 接收者（外键）
  content: String!        # 消息内容
  isRead: Boolean         # 是否已读
  createdAt: Timestamp!   # 发送时间
}
```

## 🔧 GraphQL API 设计

### 核心操作类型

#### 📝 帖子管理
```graphql
# 创建帖子
mutation CreatePost($content: String!, $postType: String!, $mediaUrl: String, $caption: String)

# 获取所有帖子（含作者信息）
query GetAllPosts

# 获取用户的帖子
query GetPostsByUser

# 获取帖子评论
query GetPostComments($postId: UUID!)
```

#### 👥 用户交互
```graphql
# 点赞帖子
mutation LikePost($postId: UUID!)

# 获取帖子点赞列表
query GetLikesForPost($postId: UUID!)

# 创建评论
mutation CreateComment($postId: UUID!, $text: String!)

# 关注用户
mutation FollowUser($followingId: UUID!)

# 获取关注者列表
query GetFollowers
```

#### 🔍 用户管理
```graphql
# 创建用户资料
mutation CreateUser($username: String!, $email: String!, $displayName: String)

# 获取用户资料
query GetUserProfile($userId: UUID!)

# 搜索用户
query SearchUsers($username: String!)
```

### 🔐 认证与权限

| 操作类型 | 认证级别 | 说明 |
|----------|----------|------|
| `@auth(level: PUBLIC)` | 公开访问 | 无需登录即可访问 |
| `@auth(level: USER)` | 用户级别 | 需要Firebase认证 |

**上下文注入**:
- `auth.uid` - 当前认证用户ID
- `request.time` - 请求时间戳

## 🛠️ 开发环境配置

### 前置要求
- **Node.js** 18+ 
- **Flutter SDK** 3.0+
- **Firebase CLI** 最新版
- **PostgreSQL** (可选，用于生产环境)

### 🚀 快速启动

#### 1. Firebase项目配置
```bash
# 安装Firebase CLI
npm install -g firebase-tools

# 登录Firebase
firebase login

# 初始化本地项目
firebase init dataconnect
```

#### 2. 启动开发服务器
```bash
# 启动Firebase模拟器
firebase emulators:start --only dataconnect,auth

# 模拟器访问地址：
# - Data Connect: http://localhost:9399
# - Authentication: http://localhost:9099
# - Emulator UI: http://localhost:4000
```

#### 3. Flutter应用配置
```bash
cd social_app

# 配置Firebase项目
flutterfire configure --project=xzqcjnb666

# 安装依赖
flutter pub get

# 运行应用
flutter run
```

#### 4. SDK生成与集成
```bash
# 生成Data Connect SDK
firebase dataconnect:sdk:generate --language=dart

# SDK生成路径：dataconnect-generated/dart/default_connector/
```

## 📱 应用功能特性

### 🎯 已实现功能
- ✅ **用户认证系统** - Firebase Auth集成
- ✅ **帖子发布** - 支持文本、图片、视频
- ✅ **社交互动** - 点赞、评论、关注
- ✅ **用户资料** - 个人信息管理
- ✅ **用户搜索** - 按用户名搜索
- ✅ **实时数据** - GraphQL订阅支持

### 🚧 开发计划
- [ ] **私信系统** - 用户间直接消息
- [ ] **推送通知** - Firebase Cloud Messaging
- [ ] **媒体处理** - 图片/视频上传优化
- [ ] **内容审核** - AI驱动的内容过滤
- [ ] **推荐算法** - 个性化内容推荐
- [ ] **数据分析** - 用户行为跟踪

## 💻 开发最佳实践

### Data Connect 查询优化
```dart
// 类型安全的查询调用
import 'package:default_connector/default_connector.dart';

class PostService {
  final DefaultConnector _connector = DefaultConnector();
  
  // 获取帖子列表
  Future<List<Post>> getAllPosts() async {
    final response = await _connector.getAllPosts.ref().execute();
    return response.data.posts;
  }
  
  // 创建新帖子
  Future<void> createPost(String content, PostType type) async {
    await _connector.createPost.ref(
      content: content,
      postType: type.name,
    ).execute();
  }
}
```

### 认证状态管理
```dart
import 'package:firebase_auth/firebase_auth.dart';

class AuthService {
  final FirebaseAuth _auth = FirebaseAuth.instance;
  
  // 监听认证状态
  Stream<User?> get authStateChanges => _auth.authStateChanges();
  
  // 当前用户
  User? get currentUser => _auth.currentUser;
  
  // 获取认证令牌（用于Data Connect）
  Future<String?> getIdToken() async {
    return await _auth.currentUser?.getIdToken();
  }
}
```

### 错误处理模式
```dart
try {
  final posts = await _postService.getAllPosts();
  setState(() {
    _posts = posts;
    _isLoading = false;
  });
} on DataConnectError catch (e) {
  // 处理Data Connect特定错误
  _handleDataConnectError(e);
} on FirebaseAuthException catch (e) {
  // 处理认证错误
  _handleAuthError(e);
} catch (e) {
  // 处理通用错误
  _handleGenericError(e);
}
```

## 🔍 本地开发调试

### Firebase模拟器使用

#### 查看数据
```bash
# 访问模拟器UI
open http://localhost:4000

# 直接查询PostgreSQL数据
firebase dataconnect:sql:shell --project=xzqcjnb666
```

#### GraphQL Playground
```bash
# 在浏览器中访问
http://localhost:9399/graphql

# 示例查询
query {
  posts {
    id
    content
    author {
      username
    }
  }
}
```

### 日志和监控
```bash
# 查看Data Connect日志
firebase emulators:logs --only dataconnect

# 查看详细调试信息
DEBUG=1 firebase emulators:start
```

## 🚀 部署指南

### 生产环境部署

#### 1. Cloud SQL配置
```bash
# 创建Cloud SQL实例
gcloud sql instances create xzqcjnb666-instance \
  --database-version=POSTGRES_15 \
  --region=us-central1 \
  --tier=db-f1-micro

# 创建数据库
gcloud sql databases create chat-database \
  --instance=xzqcjnb666-instance
```

#### 2. Data Connect部署
```bash
# 部署schema和connectors
firebase deploy --only dataconnect

# 验证部署
firebase dataconnect:services:list
```

#### 3. Flutter应用发布
```bash
# Android APK
flutter build apk --release

# iOS App Store
flutter build ios --release

# Web版本
flutter build web --release
```

## 📊 性能优化

### 查询优化策略
- **批量加载** - 使用DataLoader模式减少N+1查询
- **分页实现** - 大数据集分页加载
- **缓存策略** - 客户端和服务端缓存
- **索引优化** - PostgreSQL索引策略

### 客户端优化
- **懒加载** - 按需加载用户界面
- **图片优化** - 压缩和缓存策略
- **状态管理** - 高效的Flutter状态管理
- **网络优化** - 请求去重和重试机制

## 🧪 测试策略

### 单元测试
```dart
// Data Connect服务测试
test('should create post successfully', () async {
  final post = await postService.createPost('Test content', PostType.text);
  expect(post.content, equals('Test content'));
});
```

### 集成测试
```dart
// 端到端流程测试
testWidgets('user can create and view post', (tester) async {
  await _loginUser(tester);
  await _createPost(tester, 'Test post content');
  expect(find.text('Test post content'), findsOneWidget);
});
```

### API测试
```bash
# 使用Firebase Test Lab
firebase test android models:list
firebase test android run --app app-debug.apk
```

## 📖 学习资源

### 官方文档
- [Firebase Data Connect文档](https://firebase.google.com/docs/data-connect)
- [Flutter Firebase插件](https://firebase.flutter.dev/)
- [GraphQL最佳实践](https://graphql.org/learn/best-practices/)

### 社区资源
- [Firebase开发者社区](https://firebase.google.com/community)
- [Flutter中文文档](https://flutter.cn/)
- [GraphQL中文网](http://graphql.cn/)

## 🤝 贡献指南

1. Fork本项目
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建Pull Request

## 📄 许可证

本项目基于 MIT 许可证开源。详见 [LICENSE](LICENSE) 文件。

---

**项目目标**: 展示Firebase Data Connect的强大能力，构建现代化、可扩展的社交媒体应用，为开发者提供完整的全栈开发参考实现。
