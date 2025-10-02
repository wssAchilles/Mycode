# MyChatApp 项目结构说明

## 核心目录架构

### 📱 screens/
**用途**: 存放应用的所有页面级Widget
- 每个页面都是一个独立的StatefulWidget或StatelessWidget
- 负责UI展示和用户交互
- 通过调用services层实现业务逻辑
- 包含：登录页、注册页、主页、聊天页等

### 🔧 services/
**用途**: 封装与后端（Firebase）交互的业务逻辑，实现UI与逻辑分离
- AuthService: 用户认证相关逻辑
- ChatService: 聊天消息处理逻辑  
- UserService: 用户数据管理逻辑
- 所有Firebase操作都封装在此层，提供统一的API接口

### 📊 models/
**用途**: 定义数据模型，将Firestore中的文档映射为Dart对象
- UserModel: 用户数据结构 {uid, email, displayName, photoUrl, createdAt}
- MessageModel: 消息数据结构 {messageId, senderId, text, timestamp, status}
- ChatRoomModel: 聊天室数据结构
- 提供JSON序列化/反序列化方法

### 🎨 widgets/
**用途**: 存放可在多个页面中复用的自定义UI组件
- 消息气泡组件
- 用户头像组件
- 输入框组件
- 加载状态组件
- 提高代码复用性，保持UI一致性

## 设计原则
- **分层架构**: UI层(screens) → 业务层(services) → 数据层(models)
- **单一职责**: 每个文件夹负责特定功能领域
- **高内聚低耦合**: 模块间通过清晰接口交互
- **可扩展性**: 便于后续功能迭代和维护
