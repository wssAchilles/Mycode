# Telegram Clone - 现代化聊天应用

一个基于React + TypeScript + Node.js构建的全栈Telegram克隆应用，集成AI智能助手、实时通讯、多媒体消息等现代化聊天功能。

## 🚀 项目概述

本项目是一个功能完整的Telegram克隆应用，采用现代化的全栈技术架构，提供实时聊天、AI智能助手、多媒体消息、用户认证等完整功能。项目展示了企业级聊天应用的开发最佳实践。

### 核心特色

- 💬 **实时通讯** - Socket.IO驱动的毫秒级消息同步
- 🤖 **AI智能助手** - 集成Google Gemini和Azure AI服务
- 🔐 **安全认证** - JWT + bcrypt加密的用户认证系统
- 📱 **现代化UI** - React + TypeScript + Vite构建的响应式界面
- 🗄️ **多数据库支持** - MongoDB Atlas + PostgreSQL双数据库架构
- 📸 **多媒体消息** - 支持图片、文件、语音等多种消息类型
- 🌐 **跨平台支持** - Web端完整支持，易于扩展移动端

## 🏗️ 技术架构

### 系统架构图

```mermaid
graph TB
    A[React Frontend] --> B[Socket.IO]
    A --> C[REST API]
    
    B --> D[Node.js Backend]
    C --> D
    
    D --> E[MongoDB Atlas]
    D --> F[PostgreSQL]
    D --> G[AI Services]
    
    G --> H[Google Gemini AI]
    G --> I[Azure OpenAI]
    G --> J[AI Foundry]
    
    D --> K[File Upload System]
    K --> L[Local Storage]
    
    subgraph "Authentication"
        M[JWT Tokens]
        N[bcrypt Encryption]
    end
    
    D --> M
    D --> N
```

### 技术栈详解

#### 前端技术栈
- **React 18** - 现代化前端框架
- **TypeScript** - 类型安全的JavaScript超集
- **Vite** - 快速的构建工具和开发服务器
- **Socket.IO Client** - 实时双向通信
- **Axios** - HTTP客户端
- **React Router** - 路由管理
- **CSS Modules** - 模块化样式管理

#### 后端技术栈
- **Node.js** - JavaScript运行时环境
- **Express.js** - Web应用框架
- **Socket.IO** - 实时通信引擎
- **JWT** - JSON Web Token认证
- **bcryptjs** - 密码加密
- **Multer** - 文件上传中间件
- **CORS** - 跨域资源共享

#### 数据存储
- **MongoDB Atlas** - 云端NoSQL数据库（主要消息存储）
- **PostgreSQL** - 关系型数据库（用户数据）
- **Sequelize** - PostgreSQL ORM
- **Mongoose** - MongoDB ODM

#### AI服务集成
- **Google Gemini AI** - 主要AI对话服务
- **Azure OpenAI** - 备选AI服务
- **AI Foundry** - AI服务统一接口

## 📁 项目结构

```
telegram/
├── telegram-clone-backend/          # 🔧 后端服务
│   ├── src/                        # 源代码目录
│   │   ├── controllers/            # 控制器层
│   │   │   ├── authController.js   # 用户认证控制器
│   │   │   ├── messageController.js # 消息管理控制器
│   │   │   ├── userController.js   # 用户管理控制器
│   │   │   └── aiController.js     # AI服务控制器
│   │   ├── middleware/             # 中间件
│   │   │   ├── auth.js            # JWT认证中间件
│   │   │   ├── upload.js          # 文件上传中间件
│   │   │   └── cors.js            # CORS配置
│   │   ├── models/                # 数据模型
│   │   │   ├── User.js            # 用户模型 (PostgreSQL)
│   │   │   ├── Message.js         # 消息模型 (MongoDB)
│   │   │   └── Conversation.js    # 会话模型 (MongoDB)
│   │   ├── routes/                # 路由定义
│   │   │   ├── auth.js            # 认证路由
│   │   │   ├── messages.js        # 消息路由
│   │   │   ├── users.js           # 用户路由
│   │   │   └── ai.js              # AI服务路由
│   │   ├── services/              # 业务服务层  
│   │   │   ├── aiService.js       # AI服务集成
│   │   │   ├── messageService.js  # 消息处理服务
│   │   │   └── authService.js     # 认证服务
│   │   ├── utils/                 # 工具函数
│   │   │   ├── database.js        # 数据库连接
│   │   │   ├── jwt.js             # JWT工具
│   │   │   └── validation.js      # 数据验证
│   │   ├── config/                # 配置文件
│   │   │   ├── database.js        # 数据库配置
│   │   │   └── ai.js              # AI服务配置
│   │   └── app.js                 # Express应用入口
│   ├── ai-socket-server.js        # AI集成Socket服务器
│   ├── package.json               # 后端依赖配置
│   ├── .env                       # 环境变量配置
│   └── uploads/                   # 文件上传目录
├── telegram-clone-frontend/        # 🎨 前端应用
│   ├── src/                       # 源代码目录
│   │   ├── components/            # React组件
│   │   │   ├── Chat/              # 聊天相关组件
│   │   │   │   ├── ChatWindow.tsx # 聊天窗口主组件
│   │   │   │   ├── MessageList.tsx # 消息列表组件
│   │   │   │   ├── MessageInput.tsx # 消息输入组件
│   │   │   │   └── MessageBubble.tsx # 消息气泡组件
│   │   │   ├── Auth/              # 认证相关组件
│   │   │   │   ├── LoginForm.tsx  # 登录表单
│   │   │   │   └── RegisterForm.tsx # 注册表单
│   │   │   ├── Layout/            # 布局组件
│   │   │   │   ├── Sidebar.tsx    # 侧边栏组件
│   │   │   │   ├── Header.tsx     # 头部组件
│   │   │   │   └── ContactList.tsx # 联系人列表
│   │   │   └── UI/                # 通用UI组件
│   │   │       ├── Button.tsx     # 按钮组件
│   │   │       ├── Input.tsx      # 输入框组件
│   │   │       └── Modal.tsx      # 模态框组件
│   │   ├── hooks/                 # React Hooks
│   │   │   ├── useSocket.ts       # Socket连接Hook
│   │   │   ├── useAuth.ts         # 认证状态Hook
│   │   │   └── useMessages.ts     # 消息管理Hook
│   │   ├── services/              # 前端服务层
│   │   │   ├── api.ts             # API请求服务
│   │   │   ├── socket.ts          # Socket服务
│   │   │   └── auth.ts            # 认证服务
│   │   ├── types/                 # TypeScript类型定义
│   │   │   ├── user.ts            # 用户类型
│   │   │   ├── message.ts         # 消息类型
│   │   │   └── api.ts             # API响应类型
│   │   ├── utils/                 # 工具函数
│   │   │   ├── formatters.ts      # 格式化工具
│   │   │   └── constants.ts       # 常量定义
│   │   ├── styles/                # 样式文件
│   │   │   ├── globals.css        # 全局样式
│   │   │   └── components/        # 组件样式
│   │   ├── pages/                 # 页面组件
│   │   │   ├── ChatPage.tsx       # 聊天主页
│   │   │   ├── LoginPage.tsx      # 登录页面
│   │   │   └── RegisterPage.tsx   # 注册页面
│   │   ├── context/               # React Context
│   │   │   ├── AuthContext.tsx    # 认证上下文
│   │   │   └── SocketContext.tsx  # Socket上下文
│   │   ├── App.tsx                # 应用主组件
│   │   └── main.tsx               # 应用入口
│   ├── package.json               # 前端依赖配置
│   ├── tsconfig.json              # TypeScript配置
│   ├── vite.config.ts             # Vite配置
│   └── index.html                 # HTML模板
├── docker-compose.yml             # Docker编排配置
├── package.json                   # 项目根配置
├── start-all.bat                  # 一键启动脚本
├── AI_INTEGRATION_SUMMARY.md      # AI集成总结文档
├── CONTACT_FIX_SUMMARY.md         # 联系人修复文档
└── 各种测试和调试脚本...
```

## 🗄️ 数据库设计

### MongoDB集合结构（消息存储）

#### 消息集合 (messages)
```javascript
{
  _id: ObjectId,
  conversationId: String,      // 会话ID
  senderId: String,            // 发送者ID
  recipientId: String,         // 接收者ID
  content: String,             // 消息内容
  messageType: String,         // 消息类型: 'text', 'image', 'file', 'ai'
  timestamp: Date,             // 发送时间
  isRead: Boolean,             // 是否已读
  aiResponse: {                // AI响应数据
    model: String,             // AI模型名称
    provider: String,          // AI服务商
    tokens: Number             // 消耗的Token数量
  },
  attachments: [{              // 附件信息
    filename: String,
    originalName: String,
    mimeType: String,
    size: Number,
    path: String
  }]
}
```

#### 会话集合 (conversations)
```javascript
{
  _id: ObjectId,
  participants: [String],      // 参与者用户ID数组
  lastMessage: {               // 最后一条消息
    content: String,
    timestamp: Date,
    senderId: String
  },
  createdAt: Date,
  updatedAt: Date,
  isGroup: Boolean,            // 是否为群聊
  groupName: String,           // 群组名称（如果是群聊）
  unreadCounts: {              // 未读消息计数
    [userId]: Number
  }
}
```

### PostgreSQL表结构（用户数据）

#### 用户表 (users)
```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100),
    avatar_url VARCHAR(255),
    bio TEXT,
    is_online BOOLEAN DEFAULT false,
    last_seen TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### 联系人关系表 (contacts)
```sql
CREATE TABLE contacts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    contact_id INTEGER REFERENCES users(id),
    is_blocked BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, contact_id)
);
```

## 🚀 快速开始

### 环境要求

- **Node.js**: 18.0+
- **npm**: 9.0+
- **MongoDB Atlas**: 云端MongoDB实例
- **PostgreSQL**: 15.0+
- **AI服务API密钥**: Google Gemini / Azure OpenAI

### 安装步骤

#### 1. 克隆项目
```bash
git clone <your-repository-url>
cd telegram
```

#### 2. 环境配置

##### 后端环境配置
```bash
cd telegram-clone-backend
cp .env.example .env
```

编辑 `.env` 文件：
```env
# 服务器配置
PORT=5000
NODE_ENV=development

# MongoDB Atlas配置
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/telegram_clone

# PostgreSQL配置
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=telegram_clone
PG_USERNAME=postgres
PG_PASSWORD=your_password

# JWT配置
JWT_SECRET=your_super_secret_key
JWT_EXPIRES_IN=7d

# AI服务配置
GEMINI_API_KEY=your_gemini_api_key
AZURE_OPENAI_API_KEY=your_azure_api_key
AZURE_OPENAI_ENDPOINT=your_azure_endpoint

# 文件上传配置
UPLOAD_PATH=./uploads
MAX_FILE_SIZE=10485760
```

##### 前端环境配置
```bash
cd ../telegram-clone-frontend
```

创建 `.env` 文件：
```env
VITE_API_URL=http://localhost:5000
VITE_SOCKET_URL=http://localhost:5000
```

#### 3. 数据库初始化

##### PostgreSQL数据库
```sql
-- 创建数据库
CREATE DATABASE telegram_clone;

-- 连接到数据库并创建表
\c telegram_clone;

-- 执行上述SQL表结构创建语句
```

##### MongoDB Atlas
1. 创建MongoDB Atlas集群
2. 获取连接字符串
3. 更新 `.env` 文件中的 `MONGODB_URI`

#### 4. 安装依赖

```bash
# 安装根目录依赖
npm install

# 安装后端依赖
cd telegram-clone-backend
npm install

# 安装前端依赖
cd ../telegram-clone-frontend  
npm install
```

#### 5. 启动应用

##### 方式一：一键启动（推荐）
```bash
# 在项目根目录运行
start-all.bat
```

##### 方式二：分别启动
```bash
# 启动后端服务
cd telegram-clone-backend
npm run dev

# 启动前端应用（新终端）
cd telegram-clone-frontend
npm run dev
```

#### 6. 访问应用
- **前端应用**: http://localhost:5173
- **后端API**: http://localhost:5000
- **Socket.IO**: ws://localhost:5000

## 💬 核心功能详解

### 实时通讯系统

#### Socket.IO事件处理
```javascript
// 后端事件监听
io.on('connection', (socket) => {
  // 用户上线
  socket.on('user_online', (userId) => {
    socket.join(`user_${userId}`);
    // 更新在线状态
  });

  // 发送消息
  socket.on('send_message', async (messageData) => {
    // 保存消息到数据库
    const message = await saveMessage(messageData);
    
    // 广播给接收者
    socket.to(`user_${messageData.recipientId}`)
          .emit('receive_message', message);
  });

  // 输入状态
  socket.on('typing', (data) => {
    socket.to(`user_${data.recipientId}`)
          .emit('user_typing', data);
  });
});
```

#### 前端Socket集成
```typescript
// useSocket Hook
export const useSocket = (userId: string) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    const newSocket = io(SOCKET_URL, {
      auth: { userId }
    });

    newSocket.on('receive_message', (message: Message) => {
      setMessages(prev => [...prev, message]);
    });

    setSocket(newSocket);
    return () => newSocket.close();
  }, [userId]);

  const sendMessage = (message: MessageInput) => {
    socket?.emit('send_message', message);
  };

  return { socket, messages, sendMessage };
};
```

### AI智能助手集成

#### 多AI服务支持
```javascript
// AI服务统一接口
class AIService {
  async generateResponse(message, options = {}) {
    try {
      // 优先使用Gemini
      if (process.env.GEMINI_API_KEY) {
        return await this.callGemini(message, options);
      }
      
      // 备选Azure OpenAI
      if (process.env.AZURE_OPENAI_API_KEY) {
        return await this.callAzureOpenAI(message, options);
      }
      
      throw new Error('No AI service available');
    } catch (error) {
      console.error('AI service error:', error);
      return { error: 'AI服务暂时不可用' };
    }
  }

  async callGemini(message, options) {
    const response = await fetch(`${GEMINI_API_URL}/generateContent`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GEMINI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: message,
        maxTokens: options.maxTokens || 1000,
        temperature: options.temperature || 0.7
      })
    });
    
    return await response.json();
  }
}
```

#### AI消息处理
```typescript
// AI消息组件
const AIMessageBubble: React.FC<{ message: AIMessage }> = ({ message }) => {
  const [isLoading, setIsLoading] = useState(false);
  
  return (
    <div className="ai-message-bubble">
      <div className="ai-header">
        <span className="ai-badge">🤖 AI Assistant</span>
        <span className="ai-model">{message.aiResponse?.model}</span>
      </div>
      
      <div className="message-content">
        {message.content}
      </div>
      
      {message.aiResponse && (
        <div className="ai-footer">
          <span className="token-count">
            Tokens: {message.aiResponse.tokens}
          </span>
        </div>
      )}
    </div>
  );
};
```

### 文件上传系统

#### 多媒体消息支持
```javascript
// 文件上传中间件配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../uploads');
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    const extension = path.extname(file.originalname);
    cb(null, `${uniqueName}${extension}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|txt/;
    const extname = allowedTypes.test(path.extname(file.originalname));
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('不支持的文件类型'));
    }
  }
});
```

## 🧪 测试和调试

### 自动化测试套件

项目包含完整的测试脚本：

#### 后端测试
```bash
# API接口测试
node test-api-direct.js

# 数据库连接测试
node test-databases.js

# Socket通信测试
node test-socket-messaging.js

# AI服务集成测试
node test-ai-integration.js

# 用户认证测试
node test-auth.js

# 消息持久化测试
node test-message-persistence.js
```

#### 前端测试
```bash
# 组件单元测试
npm test

# E2E测试
npm run test:e2e

# 类型检查
npm run type-check
```

### 调试工具

#### 数据库状态检查
```bash
# 安全检查数据库连接
check-databases-safe.bat

# 详细数据库状态
check-databases.bat
```

#### 前端健康检查
```javascript
// check-frontend-health.js
const checkFrontendHealth = () => {
  // 检查React应用状态
  // 检查Socket连接
  // 检查API可用性
  // 生成健康报告
};
```

## 🚢 部署指南

### Docker容器化部署

#### Docker Compose配置
```yaml
version: '3.8'
services:
  backend:
    build: ./telegram-clone-backend
    ports:
      - "5000:5000"
    environment:
      - NODE_ENV=production
      - MONGODB_URI=${MONGODB_URI}
      - PG_HOST=postgres
    depends_on:
      - postgres
      - redis

  frontend:
    build: ./telegram-clone-frontend
    ports:
      - "80:80"
    depends_on:
      - backend

  postgres:
    image: postgres:15
    environment:
      - POSTGRES_DB=telegram_clone
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=${PG_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  postgres_data:
```

#### 部署命令
```bash
# 构建并启动所有服务
docker-compose up -d

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f backend
```

### 云服务部署

#### Vercel部署（前端）
```bash
# 安装Vercel CLI
npm i -g vercel

# 部署前端
cd telegram-clone-frontend
vercel --prod
```

#### Railway部署（后端）
```bash
# 安装Railway CLI
npm install -g @railway/cli

# 部署后端
cd telegram-clone-backend
railway deploy
```

## 📊 性能优化

### 前端性能优化

#### 代码分割和懒加载
```typescript
// 路由懒加载
const ChatPage = lazy(() => import('./pages/ChatPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));

// 组件懒加载
const AIAssistant = lazy(() => import('./components/AIAssistant'));
```

#### 消息虚拟化
```typescript
// 大量消息列表虚拟化
const VirtualMessageList = ({ messages }: { messages: Message[] }) => {
  return (
    <FixedSizeList
      height={600}
      itemCount={messages.length}
      itemSize={80}
      itemData={messages}
    >
      {MessageItem}
    </FixedSizeList>
  );
};
```

### 后端性能优化

#### 数据库查询优化
```javascript
// MongoDB索引优化
db.messages.createIndex({ conversationId: 1, timestamp: -1 });
db.messages.createIndex({ senderId: 1, recipientId: 1 });
db.conversations.createIndex({ participants: 1 });

// PostgreSQL索引
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_contacts_user_id ON contacts(user_id);
```

#### Redis缓存策略
```javascript
// 缓存活跃会话
const cacheActiveConversation = async (userId, conversationId) => {
  const key = `active_conversation:${userId}`;
  await redis.setex(key, 3600, conversationId); // 1小时过期
};

// 缓存用户在线状态
const cacheUserOnlineStatus = async (userId, isOnline) => {
  const key = `user_online:${userId}`;
  await redis.setex(key, 300, isOnline ? '1' : '0'); // 5分钟过期
};
```

## 🔒 安全考虑

### 认证安全
- **JWT令牌安全** - 短期访问令牌 + 长期刷新令牌
- **密码加密** - bcrypt加盐哈希
- **API访问控制** - 基于角色的权限管理

### 数据安全
- **输入验证** - 所有用户输入严格验证
- **SQL注入防护** - 参数化查询
- **XSS防护** - 内容转义和CSP策略
- **CSRF防护** - CSRF令牌验证

### 通信安全
- **HTTPS强制** - 所有通信加密传输
- **Socket.IO认证** - 连接时验证用户身份
- **消息加密** - 敏感消息端到端加密

## 🤝 贡献指南

1. Fork 项目仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

### 开发规范
- **代码风格** - 遵循ESLint和Prettier配置
- **类型安全** - TypeScript严格模式
- **测试覆盖** - 新功能必须包含测试
- **文档更新** - 重要更改需更新文档

## 📄 许可证

本项目基于 MIT 许可证开源。详见 [LICENSE](LICENSE) 文件。

## 📚 学习资源

### 官方文档
- [React官方文档](https://react.dev/)
- [TypeScript文档](https://www.typescriptlang.org/)
- [Socket.IO文档](https://socket.io/docs/)
- [MongoDB文档](https://docs.mongodb.com/)

### 推荐教程
- [Node.js + Socket.IO实时聊天应用](https://socket.io/get-started/chat)
- [React + TypeScript最佳实践](https://react-typescript-cheatsheet.netlify.app/)
- [MongoDB Atlas入门指南](https://docs.atlas.mongodb.com/)

## 📞 技术支持

如有问题或建议，请通过以下方式联系：
- 创建 [GitHub Issue](https://github.com/your-repo/issues)
- 发送邮件至：support@telegram-clone.com
- 查看 [项目Wiki](https://github.com/your-repo/wiki)

---

**开发团队** | **最后更新**: 2024年10月10日

构建现代化的实时通讯体验！ 🚀
