@echo off
chcp 65001 >nul

REM 微信服务器快速部署脚本 (Windows版本)
REM Quick WeChat Server Deployment Script (Windows Version)

echo 🚀 开始部署微信音频服务器...
echo Starting WeChat Audio Server Deployment...

REM 检查Node.js环境
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 错误：未找到Node.js，请先安装Node.js
    echo Error: Node.js not found, please install Node.js first
    pause
    exit /b 1
)

echo ✅ Node.js已安装
node --version

REM 安装依赖
echo 📦 安装依赖包...
echo Installing dependencies...
call npm install

if %errorlevel% neq 0 (
    echo ❌ 依赖安装失败
    pause
    exit /b 1
)

echo ✅ 依赖安装成功

REM 选择部署方式
echo.
echo 请选择部署方式 / Please choose deployment method:
echo 1^) 本地测试 ^(Local Testing^)
echo 2^) 部署到Vercel ^(Deploy to Vercel^)
echo 3^) 部署到Railway ^(Deploy to Railway^)
echo 4^) 只启动服务器 ^(Just start server^)
echo.

set /p choice=请输入选择 (1-4): 

if "%choice%"=="1" goto local
if "%choice%"=="2" goto vercel
if "%choice%"=="3" goto railway
if "%choice%"=="4" goto server
goto local

:local
echo 🏠 启动本地测试服务器...
echo Starting local test server...
echo 服务器将在 http://localhost:3000 启动
echo Server will start at http://localhost:3000
echo.
echo 请在另一个终端中运行以下命令更新Flutter配置：
echo Please run the following command in another terminal to update Flutter config:
echo flutter build apk --debug
echo.
node wechat_server.js
goto end

:vercel
echo ☁️ 部署到Vercel...
vercel --version >nul 2>&1
if %errorlevel% neq 0 (
    echo 安装Vercel CLI...
    call npm i -g vercel
)
echo 请登录Vercel账户：
call vercel login
echo 开始部署...
call vercel --prod
goto end

:railway
echo 🚂 部署到Railway...
railway --version >nul 2>&1
if %errorlevel% neq 0 (
    echo 安装Railway CLI...
    call npm install -g @railway/cli
)
echo 请登录Railway账户：
call railway login
echo 开始部署...
call railway deploy
goto end

:server
echo 🚀 启动服务器...
node wechat_server.js
goto end

:end
pause