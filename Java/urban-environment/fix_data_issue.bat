@echo off
chcp 65001 >nul
echo 🔧 修复数据显示问题
echo =============================
echo.

echo 1️⃣ 重新生成最新数据...
cd /d "%~dp0scripts"
python nanjing_air_quality_collector.py
echo.

echo 2️⃣ 重启前端服务（清除缓存）...
cd /d "%~dp0frontend"

echo   📌 停止现有服务...
taskkill /F /IM node.exe 2>nul

echo   🧹 清理缓存...
if exist "node_modules\.vite" rd /s /q "node_modules\.vite" 2>nul
if exist ".vite" rd /s /q ".vite" 2>nul

echo   🚀 重新启动开发服务器...
start "Vue Dev Server" cmd /c "npm run dev"

echo.
echo ✅ 修复完成！
echo 📌 请等待5秒后访问: http://localhost:5173/dashboard
echo 📌 调试页面: http://localhost:5173/debug.html
echo 📌 如果问题仍然存在，请按 Ctrl+Shift+R 强制刷新浏览器
echo.
timeout /t 5 /nobreak >nul
echo 🌐 正在打开调试页面...
start http://localhost:5173/debug.html

pause
