@echo off
chcp 65001 >nul
title 智慧城市环境监测数据系统

echo.
echo ╔══════════════════════════════════════════════════════════════╗
echo ║                智慧城市环境监测数据系统                        ║
echo ║                                                              ║
echo ║  🌍 全国30+城市实时空气质量数据收集                           ║
echo ║  📊 Vue.js前端可视化展示                                     ║
echo ║  🚨 智能预警和历史数据分析                                   ║
echo ╚══════════════════════════════════════════════════════════════╝
echo.

REM 设置API密钥
set IQAIR_API_KEY=194adeb6-c17c-4959-91e9-af7af289ef98
echo ✅ API密钥已设置

REM 检查Python环境
echo 🔍 检查运行环境...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 错误: 未找到Python，请先安装Python 3.x
    echo    下载地址: https://www.python.org/downloads/
    pause
    exit /b 1
)

REM 安装依赖
echo 📦 安装Python依赖...
pip install requests schedule >nul 2>&1
if %errorlevel% neq 0 (
    echo ⚠️ 警告: 依赖安装可能失败，请手动运行: pip install requests schedule
)

REM 创建数据目录
if not exist "data" mkdir data
if not exist "frontend\public\data" mkdir frontend\public\data

echo.
echo 🚀 系统启动选项:
echo 1. 启动数据收集器 (持续运行，每30分钟更新)
echo 2. 执行一次数据收集 (测试模式)
echo 3. 启动前端开发服务器
echo 4. 同时启动数据收集器和前端服务器
echo 5. 查看已收集的数据
echo 0. 退出
echo.

set /p choice=请选择 (1-5, 0退出): 

if "%choice%"=="1" (
    echo.
    echo 🔄 启动持续数据收集器...
    echo 按 Ctrl+C 可停止数据收集
    echo.
    python data_collector_scheduler.py
    goto end
)

if "%choice%"=="2" (
    echo.
    echo 🧪 执行单次数据收集测试...
    python china_cities_air_quality.py
    echo.
    echo 📁 数据已保存到 data\ 目录
    echo 🌐 复制到前端目录...
    copy data\current_air_quality.json frontend\public\data\ >nul 2>&1
    if %errorlevel%==0 (
        echo ✅ 数据已同步到前端
    ) else (
        echo ⚠️ 前端数据同步失败，请手动复制
    )
    goto menu
)

if "%choice%"=="3" (
    echo.
    echo 🎨 启动前端开发服务器...
    cd frontend
    npm run dev
    cd ..
    goto end
)

if "%choice%"=="4" (
    echo.
    echo 🚀 同时启动数据收集器和前端服务器...
    echo 📊 数据收集器将在后台运行
    echo 🌐 前端服务器: http://localhost:5174
    echo.
    
    REM 启动数据收集器（后台）
    start /min "数据收集器" python data_collector_scheduler.py
    
    REM 等待2秒让数据收集器启动
    timeout /t 2 >nul
    
    REM 启动前端服务器
    cd frontend
    npm run dev
    cd ..
    goto end
)

if "%choice%"=="5" (
    echo.
    echo 📊 查看数据收集状态...
    
    if exist "data\current_air_quality.json" (
        echo ✅ 当前数据文件存在
        for %%A in (data\current_air_quality.json) do (
            echo 📅 文件修改时间: %%~tA
            echo 📁 文件大小: %%~zA 字节
        )
        
        REM 显示数据摘要
        python -c "
import json
try:
    with open('data/current_air_quality.json', 'r', encoding='utf-8') as f:
        data = json.load(f)
    print(f'📊 数据摘要:')
    print(f'   总城市数: {data[\"total_cities\"]}')
    print(f'   异常城市: {data[\"abnormal_cities\"]}')
    print(f'   平均AQI: {data[\"average_aqi\"]}')
    print(f'   更新时间: {data[\"update_time\"]}')
except:
    print('❌ 数据文件读取失败')
" 2>nul
    ) else (
        echo ❌ 暂无数据文件，请先执行数据收集
    )
    
    if exist "data\air_quality_history.json" (
        echo ✅ 历史数据文件存在
        for %%A in (data\air_quality_history.json) do (
            echo 📅 历史文件修改时间: %%~tA
        )
    ) else (
        echo ⚠️ 暂无历史数据
    )
    
    if exist "data\alerts.json" (
        echo ✅ 预警记录文件存在
        for %%A in (data\alerts.json) do (
            echo 📅 预警文件修改时间: %%~tA
        )
    ) else (
        echo ✅ 暂无预警记录
    )
    
    echo.
    goto menu
)

if "%choice%"=="0" (
    echo 👋 感谢使用智慧城市环境监测数据系统！
    goto end
)

echo ❌ 无效选择，请重新输入
goto menu

:menu
echo.
echo 按任意键返回主菜单...
pause >nul
goto choice

:end
echo.
pause
