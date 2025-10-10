@echo off
chcp 65001 >nul
echo ====================================
echo 🚀 南京市空气质量数据收集测试
echo ====================================
echo.

echo 📍 设置API密钥...
set IQAIR_API_KEY=194adeb6-c17c-4959-91e9-af7af289ef98

echo 🐍 运行数据收集器...
cd /d "%~dp0scripts"
python nanjing_air_quality_collector.py

echo.
echo ✅ 数据收集完成！
echo.
echo 📊 查看生成的数据文件：
echo    - frontend\public\data\nanjing_air_quality.json
echo    - frontend\public\data\nanjing_air_quality_history.json
echo.
echo 🌐 启动前端查看效果：
echo    cd frontend
echo    npm run dev
echo    然后访问: http://localhost:5174/dashboard
echo.
pause
