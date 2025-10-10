@echo off
chcp 65001 >nul
echo 🔧 数据加载问题诊断工具
echo ====================================
echo.

echo 1️⃣ 检查南京数据文件...
if exist "frontend\public\data\nanjing_air_quality.json" (
    echo   ✅ 南京数据文件存在
    for %%I in ("frontend\public\data\nanjing_air_quality.json") do echo   📄 文件大小: %%~zI bytes
    echo   📊 传感器数量:
    findstr /C:"total_sensors" frontend\public\data\nanjing_air_quality.json
) else (
    echo   ❌ 南京数据文件不存在！
)

echo.
echo 2️⃣ 重新生成最新数据...
cd /d "%~dp0scripts"
python nanjing_air_quality_collector.py
echo.

echo 3️⃣ 检查数据文件访问权限...
cd /d "%~dp0frontend\public\data"
if exist "nanjing_air_quality.json" (
    echo   ✅ 可以访问数据文件
    echo   🌍 前端访问路径: http://localhost:5173/data/nanjing_air_quality.json
) else (
    echo   ❌ 无法访问数据文件
)

echo.
echo 4️⃣ 清理浏览器缓存建议...
echo   📌 请在浏览器中按 Ctrl+Shift+R 强制刷新
echo   📌 或者按 F12 打开开发者工具检查 Network 和 Console 标签
echo.

echo 5️⃣ 测试数据文件访问...
echo   🌐 请打开以下链接验证数据文件可访问:
echo   http://localhost:5173/data/nanjing_air_quality.json
echo.

pause
