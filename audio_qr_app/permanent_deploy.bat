@echo off
chcp 65001 >nul
cls

echo.
echo ================================
echo    永久微信服务器部署工具
echo    Permanent WeChat Server Deploy
echo ================================
echo.

echo 🚀 正在为您的音频二维码应用部署永久服务器...
echo.

REM 检查必要工具
echo 📋 检查环境...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 错误：未找到Node.js
    echo 请从 https://nodejs.org 下载安装Node.js
    pause
    exit /b 1
)

vercel --version >nul 2>&1
if %errorlevel% neq 0 (
    echo 📦 安装Vercel CLI...
    call npm install -g vercel
    if %errorlevel% neq 0 (
        echo ❌ Vercel CLI安装失败
        pause
        exit /b 1
    )
)

echo ✅ 环境检查完成
echo.

REM 创建部署目录
echo 📁 准备部署文件...
if not exist "deploy_server" (
    mkdir deploy_server
)

REM 复制必要文件
copy /Y "wechat_server.js" "deploy_server\" >nul
copy /Y "wechat_download_page.html" "deploy_server\" >nul
copy /Y "package.json" "deploy_server\" >nul
copy /Y "vercel.json" "deploy_server\" >nul

echo ✅ 文件准备完成
echo.

REM 切换到部署目录
cd deploy_server

echo 🚀 开始部署到Vercel...
echo.

REM 部署到Vercel
call vercel --prod

if %errorlevel% neq 0 (
    echo ❌ 部署失败
    cd ..
    pause
    exit /b 1
)

echo.
echo ✅ 服务器部署成功！
echo.

REM 获取部署URL（从输出中提取）
echo 📋 部署信息已保存到 .vercel/project.json
echo.

cd ..

echo 🔄 更新Flutter配置...

REM 提示用户手动更新配置（因为部署URL是动态的）
echo.
echo ⚠️  重要：请手动更新以下配置文件
echo 📄 文件：lib\config\tencent_cloud_config.dart
echo 🔧 修改：将 wechatServerUrl 改为您的Vercel部署地址
echo.
echo 💡 您的Vercel部署地址已显示在上面的输出中
echo 📋 格式：https://your-project-name.vercel.app
echo.

echo 📱 编译生产版本APK...
call flutter build apk --release

if %errorlevel% neq 0 (
    echo ❌ APK编译失败
    echo 请检查Flutter环境和项目配置
    pause
    exit /b 1
)

echo.
echo ✅ 所有操作完成！
echo.
echo 🎉 永久解决方案已部署：
echo ✅ Vercel服务器：永久可用的HTTPS地址
echo ✅ 微信友好：支持微信内直接播放
echo ✅ 自动扩展：支持高并发访问
echo ✅ 零成本：使用Vercel免费套餐
echo.
echo 📱 下一步：
echo 1. 安装新编译的APK到手机
echo 2. 上传音频并生成二维码
echo 3. 用微信扫描测试
echo.
echo 💾 APK位置：build\app\outputs\flutter-apk\app-release.apk
echo.

pause