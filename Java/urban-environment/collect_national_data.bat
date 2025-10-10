@echo off
chcp 65001 >nul
echo ====================================
echo 🌏 全国空气质量数据收集器（南京重点关注）
echo ====================================
echo.

echo 📍 设置API密钥...
set IQAIR_API_KEY=194adeb6-c17c-4959-91e9-af7af289ef98

echo 🐍 运行全国数据收集器...
cd /d "%~dp0scripts"
python national_air_quality_collector.py

echo.
echo ✅ 全国数据收集完成！
echo.
echo 📊 数据统计：
echo    - 📡 传感器总数: 73个
echo    - 🎯 南京传感器: 26个（11个区县，重点关注）
echo    - 🌍 其他城市: 47个（16个重点城市）
echo    - 📄 数据文件: frontend\public\data\current_air_quality.json
echo    - 📄 南京详细: frontend\public\data\nanjing_air_quality.json
echo.
echo 🌐 现在访问前端查看效果：
echo    http://localhost:5173/dashboard
echo.
echo 💡 提示: 按 Ctrl+Shift+R 强制刷新浏览器以获取最新数据
echo.
pause
