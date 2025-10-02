@echo off
echo 正在启动 Telegram Clone 应用...

echo.
echo 🚀 启动后端服务器 (端口 5000)...
cd telegram-clone-backend
start "Backend Server" cmd /k "npm run dev"

echo.
echo 🌐 启动前端开发服务器 (端口 5173)...
cd ..\telegram-clone-frontend  
start "Frontend Server" cmd /k "npm run dev"

echo.
echo ✅ 两个服务器都在启动中...
echo 🔗 前端: http://localhost:5173
echo 🔗 后端: http://localhost:5000
echo.
echo 请等待几秒钟让服务器完全启动，然后访问前端地址。
pause
