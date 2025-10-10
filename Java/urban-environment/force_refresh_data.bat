@echo off
echo 强制刷新南京传感器数据...

echo 1. 重新生成南京数据...
cd /d "%~dp0scripts"
python nanjing_air_quality_collector.py

echo 2. 复制数据到多个位置确保访问...
cd /d "%~dp0"
copy "frontend\public\data\nanjing_air_quality.json" "frontend\src\data\nanjing_air_quality.json" 2>nul
mkdir "frontend\src\assets\data" 2>nul
copy "frontend\public\data\nanjing_air_quality.json" "frontend\src\assets\data\nanjing_air_quality.json" 2>nul

echo 3. 数据文件已生成完成！
echo    请按 Ctrl+Shift+R 强制刷新浏览器
echo    或访问 http://localhost:5173/debug.html 查看调试信息

pause
