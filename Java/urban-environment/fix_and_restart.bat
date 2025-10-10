@echo off
chcp 65001 >nul
echo 🔧 修复Vue编译错误并重启服务...
echo.

echo 📍 定位到前端目录...
cd /d "%~dp0frontend"

echo 🧹 清理缓存和依赖...
if exist "node_modules\.cache" (
    echo   清理Vite缓存...
    rd /s /q "node_modules\.cache" 2>nul
)

if exist "dist" (
    echo   清理构建目录...
    rd /s /q "dist" 2>nul
)

echo 🔄 重新安装依赖...
call npm install

echo 🚀 重新启动开发服务器...
echo.
echo 请在新窗口中访问: http://localhost:5174/dashboard
echo.

start "Vue Dev Server" cmd /c "npm run dev"

echo ✅ 服务已启动！请检查新窗口中的运行状态。
echo.
pause
