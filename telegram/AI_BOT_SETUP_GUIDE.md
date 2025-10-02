# 🤖 AI 机器人设置指南

## 📋 完整操作步骤

### 步骤 1: 确保后端服务器运行
首先启动后端服务器以确保数据库表已创建：

```bash
# 进入后端目录
cd D:\Code\telegram\telegram-clone-backend

# 安装依赖（如果还没安装）
npm install

# 启动后端服务器
npm run dev
```

**等待看到以下日志后再继续：**

```text
✅ PostgreSQL 连接成功
✅ MongoDB 连接成功  
✅ Redis 连接成功
✅ Sequelize 模型关联已配置
🔌 Socket.IO 服务器已启动
📡 服务器运行在端口 5000
```

### 步骤 2: 停止后端服务器

在确认数据库表已创建后，按 `Ctrl+C` 停止后端服务器。

### 步骤 3: 运行 AI 机器人设置脚本

在后端目录中运行设置脚本：

```bash
# 确保在正确的目录
cd D:\Code\telegram\telegram-clone-backend

# 运行 AI 机器人设置脚本
node setup-ai-bot.js
```

**预期输出：**

```text
🤖 设置 AI 机器人用户...
✅ 数据库连接成功
🔧 创建 Gemini AI 机器人用户...
✅ Gemini AI 机器人用户创建成功:
   ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   用户名: Gemini AI
   邮箱: gemini@ai.bot
🔍 验证 AI 机器人用户创建成功
🎉 AI 机器人设置完成！
```

### 步骤 4: 重新启动后端服务器

```bash
# 在后端目录中
npm run dev
```

### 步骤 5: 启动前端应用

打开新的终端窗口：

```bash
# 进入前端目录
cd D:\Code\telegram\telegram-clone-frontend

# 启动前端应用
npm run dev
```

### 步骤 6: 测试 AI 聊天功能

1. 在浏览器中打开 `http://localhost:5173`
2. 登录（用户名: root, 密码: 123456）
3. 在聊天界面发送：`/ai 你好，请介绍一下你自己`
4. 等待来自 "Gemini AI" 的回复

## 🔧 故障排除

### 问题 1: "relation users does not exist"

**原因**: 数据库表尚未创建

**解决方案**:

1. 先启动后端服务器 (`npm run dev`)
2. 等待数据库表创建完成
3. 停止服务器后再运行设置脚本

### 问题 2: "MODULE_NOT_FOUND"

**原因**: 缺少必要的 npm 包

**解决方案**:

```bash
cd D:\Code\telegram\telegram-clone-backend
npm install sequelize bcryptjs pg dotenv
```

### 问题 3: 数据库连接失败

**原因**: PostgreSQL 服务未运行或配置错误

**解决方案**:

1. 确保 PostgreSQL 服务正在运行
2. 检查 `.env` 文件中的数据库配置
3. 确认数据库 `telegram_clone` 已创建

### 问题 4: AI 机器人已存在

**现象**: 脚本显示 "Gemini AI 机器人用户已存在"

**说明**: 这是正常的，说明 AI 机器人已经设置完成

## ✅ 验证清单

完成设置后，请验证以下项目：

- [ ] 后端服务器正常启动（端口 5000）
- [ ] 前端应用正常启动（端口 5173）
- [ ] 可以正常登录到应用
- [ ] 发送 `/ai 你好` 收到 AI 回复
- [ ] AI 回复显示来自 "Gemini AI" 用户
- [ ] 后端日志显示 AI 请求处理成功

## 🎯 成功标志

当你看到以下情况时，说明 AI 机器人设置完全成功：

1. ✅ 脚本运行无错误，显示 "AI 机器人设置完成！"
2. ✅ 后端日志显示处理 AI 请求
3. ✅ 前端收到来自 "Gemini AI" 的回复
4. ✅ AI 回复内容合理且为中文

## 📞 需要帮助？

如果遇到问题，请提供以下信息：

1. 具体的错误消息
2. 运行脚本时的完整输出
3. 后端服务器的日志
4. 当前的操作步骤

----

**注意**：确保在正确的目录 `D:\Code\telegram\telegram-clone-backend` 中运行所有命令！
