#!/bin/bash

# 微信服务器快速部署脚本
# Quick WeChat Server Deployment Script

echo "🚀 开始部署微信音频服务器..."
echo "Starting WeChat Audio Server Deployment..."

# 检查Node.js环境
if ! command -v node &> /dev/null; then
    echo "❌ 错误：未找到Node.js，请先安装Node.js"
    echo "Error: Node.js not found, please install Node.js first"
    exit 1
fi

echo "✅ Node.js已安装: $(node --version)"

# 安装依赖
echo "📦 安装依赖包..."
echo "Installing dependencies..."
npm install

if [ $? -eq 0 ]; then
    echo "✅ 依赖安装成功"
else
    echo "❌ 依赖安装失败"
    exit 1
fi

# 选择部署方式
echo ""
echo "请选择部署方式 / Please choose deployment method:"
echo "1) 本地测试 (Local Testing)"
echo "2) 部署到Vercel (Deploy to Vercel)"
echo "3) 部署到Railway (Deploy to Railway)"
echo "4) 只启动服务器 (Just start server)"

read -p "请输入选择 (1-4): " choice

case $choice in
    1)
        echo "🏠 启动本地测试服务器..."
        echo "Starting local test server..."
        echo "服务器将在 http://localhost:3000 启动"
        echo "Server will start at http://localhost:3000"
        echo ""
        echo "请在另一个终端中运行以下命令更新Flutter配置："
        echo "Please run the following command in another terminal to update Flutter config:"
        echo "flutter build apk --debug"
        echo ""
        node wechat_server.js
        ;;
    2)
        echo "☁️ 部署到Vercel..."
        if ! command -v vercel &> /dev/null; then
            echo "安装Vercel CLI..."
            npm i -g vercel
        fi
        echo "请登录Vercel账户："
        vercel login
        echo "开始部署..."
        vercel --prod
        ;;
    3)
        echo "🚂 部署到Railway..."
        if ! command -v railway &> /dev/null; then
            echo "安装Railway CLI..."
            npm install -g @railway/cli
        fi
        echo "请登录Railway账户："
        railway login
        echo "开始部署..."
        railway deploy
        ;;
    4)
        echo "🚀 启动服务器..."
        node wechat_server.js
        ;;
    *)
        echo "❌ 无效选择，启动本地服务器..."
        node wechat_server.js
        ;;
esac