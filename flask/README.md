# Flask大型项目

这是一个功能完整的Flask Web应用程序，包含了现代Web开发所需的各种功能和最佳实践。

## 功能特性

### 🔐 用户认证系统
- 用户注册、登录、登出
- 密码重置功能
- 用户个人资料管理
- 邮箱验证（可选）

### 📝 博客系统
- 文章发布和编辑
- 分类和标签管理
- 评论系统
- 文章搜索功能

### 🔧 管理后台
- 用户管理
- 文章管理
- 评论审核
- 分类和标签管理

### 🚀 RESTful API
- JWT认证
- 文章CRUD接口
- 用户认证接口
- 评论管理接口

### 🎨 前端界面
- 响应式设计
- Bootstrap 5
- 现代化UI组件
- 移动端适配

## 项目结构

```
flask-app/
├── app/                    # 应用程序包
│   ├── __init__.py        # 应用工厂
│   ├── models.py          # 数据模型
│   ├── main/              # 主要蓝图
│   ├── auth/              # 认证蓝图
│   ├── blog/              # 博客蓝图
│   ├── admin/             # 管理蓝图
│   ├── api/               # API蓝图
│   ├── errors/            # 错误处理
│   ├── templates/         # 模板文件
│   └── static/            # 静态文件
├── migrations/            # 数据库迁移
├── tests/                 # 测试文件
├── logs/                  # 日志文件
├── uploads/               # 上传文件
├── config.py              # 配置文件
├── requirements.txt       # 依赖包
├── run.py                 # 应用入口
├── Dockerfile            # Docker配置
└── docker-compose.yml    # Docker Compose配置
```

## 安装和运行

### 前提条件
- Python 3.8+
- pip
- Git

### 1. 克隆项目
```bash
git clone <repository-url>
cd flask-app
```

### 2. 创建虚拟环境
```bash
python -m venv venv
# Windows
venv\Scripts\activate
# macOS/Linux
source venv/bin/activate
```

### 3. 安装依赖
```bash
pip install -r requirements.txt
```

### 4. 配置环境变量
复制 `.env.example` 到 `.env` 并配置相应的环境变量：
```bash
cp .env.example .env
```

### 5. 初始化数据库
```bash
flask db init
flask db migrate -m "Initial migration"
flask db upgrade
```

### 6. 创建管理员用户
```bash
flask create-admin
```

### 7. 运行应用
```bash
python run.py
```

访问 http://localhost:5000

## Docker部署

### 使用Docker Compose
```bash
docker-compose up -d
```

### 单独构建Docker镜像
```bash
docker build -t flask-app .
docker run -p 5000:5000 flask-app
```

## API文档

### 认证接口

#### 登录
```
POST /api/v1/auth/login
Content-Type: application/json

{
    "username": "your_username",
    "password": "your_password"
}
```

#### 注册
```
POST /api/v1/auth/register
Content-Type: application/json

{
    "username": "new_username",
    "email": "email@example.com",
    "password": "password"
}
```

### 文章接口

#### 获取文章列表
```
GET /api/v1/posts?page=1&per_page=10
```

#### 获取单篇文章
```
GET /api/v1/posts/{id}
```

#### 创建文章
```
POST /api/v1/posts
Authorization: Bearer {access_token}
Content-Type: application/json

{
    "title": "文章标题",
    "content": "文章内容",
    "summary": "文章摘要",
    "published": true
}
```

## 测试

运行所有测试：
```bash
flask test
```

运行特定测试：
```bash
python -m pytest tests/test_models.py
```

## 贡献指南

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 技术栈

### 后端
- **Flask** - Web框架
- **SQLAlchemy** - ORM
- **Flask-Login** - 用户会话管理
- **Flask-JWT-Extended** - JWT认证
- **Flask-Mail** - 邮件发送
- **Flask-WTF** - 表单处理
- **Flask-Migrate** - 数据库迁移

### 前端
- **Bootstrap 5** - CSS框架
- **Font Awesome** - 图标库
- **JavaScript (ES6+)** - 前端交互

### 数据库
- **SQLite** (开发环境)
- **PostgreSQL** (生产环境)
- **Redis** (缓存和会话)

### 部署
- **Docker** - 容器化
- **Nginx** - Web服务器
- **Gunicorn** - WSGI服务器

## 许可证

MIT License - 查看 [LICENSE](LICENSE) 文件了解详情

## 联系方式

如有问题或建议，请创建 Issue 或联系项目维护者。
