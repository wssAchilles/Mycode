@echo off
chcp 65001 >nul
title 增强版智慧城市环境监测系统

echo.
echo ╔══════════════════════════════════════════════════════════════╗
echo ║            🌟 增强版智慧城市环境监测系统 🌟                    ║
echo ║                                                              ║
echo ║  🌍 全国32城市多源实时数据收集                               ║
echo ║  📊 Vue.js前端动态实时更新                                   ║
echo ║  🚨 智能预警和历史数据分析                                   ║
echo ║  🔄 前端自动刷新和状态监控                                   ║
echo ╚══════════════════════════════════════════════════════════════╝
echo.

REM 设置API密钥
set IQAIR_API_KEY=194adeb6-c17c-4959-91e9-af7af289ef98
echo ✅ API密钥已配置

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
echo 📦 检查Python依赖...
pip install requests aiohttp schedule asyncio >nul 2>&1
if %errorlevel% neq 0 (
    echo ⚠️ 警告: 依赖安装可能失败，请手动运行: pip install requests aiohttp schedule asyncio
)

REM 创建数据目录
if not exist "data" mkdir data
if not exist "frontend\public\data" mkdir frontend\public\data

echo.
echo 🚀 增强系统启动选项:
echo.
echo ═══════ 数据收集选项 ═══════
echo 1. 🌍 运行多源数据收集器 (32城市，真实+模拟数据)
echo 2. 🧪 测试单次数据收集 (验证系统工作)
echo 3. 🔄 启动定时数据收集器 (每30分钟自动更新)
echo.
echo ═══════ 前端展示选项 ═══════
echo 4. 🎨 启动前端开发服务器 (Vue.js实时界面)
echo 5. 🚀 同时启动数据收集+前端服务器 (完整系统)
echo 6. ⚡ 启动增强实时系统 (多源数据+前端动态更新)
echo.
echo ═══════ 系统管理选项 ═══════
echo 7. 📊 查看系统数据状态
echo 8. 🗂️ 查看历史数据和预警记录
echo 9. 🧹 清理所有数据文件
echo.
echo 0. 🚪 退出系统
echo.

set /p choice=请选择功能 (0-9): 

if "%choice%"=="1" (
    echo.
    echo 🌍 启动多源数据收集器...
    echo 📊 将收集32个城市的实时数据
    echo.
    python multi_source_data_collector.py
    echo.
    echo ✅ 数据收集完成！
    goto menu
)

if "%choice%"=="2" (
    echo.
    echo 🧪 执行单次数据收集测试...
    python multi_source_data_collector.py
    echo.
    echo 📁 数据文件状态:
    if exist "data\current_air_quality.json" (
        echo ✅ 当前数据文件已生成
        for %%A in (data\current_air_quality.json) do echo    📅 修改时间: %%~tA
    ) else (
        echo ❌ 数据文件生成失败
    )
    
    if exist "frontend\public\data\current_air_quality.json" (
        echo ✅ 前端数据文件已同步
    ) else (
        echo ⚠️ 前端数据文件同步失败
    )
    goto menu
)

if "%choice%"=="3" (
    echo.
    echo 🔄 启动定时数据收集器...
    echo ⏰ 每30分钟自动更新一次
    echo 💡 按 Ctrl+C 可停止服务
    echo.
    python data_collector_scheduler.py
    goto end
)

if "%choice%"=="4" (
    echo.
    echo 🎨 启动前端开发服务器...
    echo 🌐 访问地址: http://localhost:5174/dashboard
    echo.
    cd frontend
    start /b npm run dev
    cd ..
    
    echo 等待前端服务器启动...
    timeout /t 5 >nul
    echo.
    echo ✅ 前端服务器已启动
    echo 🌐 请访问: http://localhost:5174/dashboard
    echo 💡 按任意键返回主菜单...
    pause >nul
    goto menu
)

if "%choice%"=="5" (
    echo.
    echo 🚀 启动完整系统 (数据收集器 + 前端服务器)...
    echo.
    
    REM 先收集一次数据
    echo 📊 初始数据收集...
    python multi_source_data_collector.py
    
    echo.
    echo 🔄 启动后台数据收集器...
    start /min "数据收集器" python data_collector_scheduler.py
    
    echo 🎨 启动前端服务器...
    cd frontend
    npm run dev
    cd ..
    goto end
)

if "%choice%"=="6" (
    echo.
    echo ⚡ 启动增强实时系统...
    echo 🌟 这是最完整的体验模式！
    echo.
    
    echo 📊 执行初始多源数据收集...
    python multi_source_data_collector.py
    
    echo.
    echo 🔄 启动增强数据收集调度器...
    start /min "增强数据收集" python -c "
import asyncio
import schedule
import time
import subprocess
from datetime import datetime

def run_enhanced_collection():
    print(f'🔄 [{datetime.now().strftime(%%H:%%M:%%S)}] 执行增强数据收集...')
    result = subprocess.run(['python', 'multi_source_data_collector.py'], 
                          capture_output=True, text=True, encoding='utf-8')
    if result.returncode == 0:
        print(f'✅ [{datetime.now().strftime(%%H:%%M:%%S)}] 数据收集成功')
    else:
        print(f'❌ [{datetime.now().strftime(%%H:%%M:%%S)}] 数据收集失败')

# 每30分钟执行一次
schedule.every(30).minutes.do(run_enhanced_collection)

print('🚀 增强数据收集调度器已启动 (30分钟间隔)')
print('💡 按 Ctrl+C 停止服务')

try:
    while True:
        schedule.run_pending()
        time.sleep(60)
except KeyboardInterrupt:
    print('⏹️ 增强数据收集调度器已停止')
"
    
    echo 🎨 启动前端开发服务器...
    timeout /t 3 >nul
    cd frontend
    npm run dev
    cd ..
    goto end
)

if "%choice%"=="7" (
    echo.
    echo 📊 系统数据状态检查
    echo ═══════════════════════════════════════
    
    if exist "data\current_air_quality.json" (
        echo ✅ 当前数据文件: 存在
        for %%A in (data\current_air_quality.json) do (
            echo    📁 文件大小: %%~zA 字节
            echo    📅 修改时间: %%~tA
        )
        
        echo.
        echo 📊 数据内容摘要:
        python -c "
import json
try:
    with open('data/current_air_quality.json', 'r', encoding='utf-8') as f:
        data = json.load(f)
    print(f'   🏙️ 城市总数: {data[\"total_cities\"]}')
    print(f'   🚨 异常城市: {data[\"abnormal_cities\"]}')
    print(f'   📈 平均AQI: {data[\"average_aqi\"]}')
    print(f'   🔍 数据源构成:')
    if 'data_sources' in data:
        print(f'      - API数据: {data[\"data_sources\"].get(\"api_data\", 0)}个城市')
        print(f'      - 模拟数据: {data[\"data_sources\"].get(\"simulation_data\", 0)}个城市')
    print(f'   ⏰ 更新时间: {data[\"update_time\"]}')
except Exception as e:
    print(f'   ❌ 读取失败: {e}')
" 2>nul
    ) else (
        echo ❌ 当前数据文件: 不存在
        echo    💡 请先运行数据收集功能
    )
    
    echo.
    if exist "frontend\public\data\current_air_quality.json" (
        echo ✅ 前端数据文件: 已同步
        for %%A in (frontend\public\data\current_air_quality.json) do (
            echo    📅 同步时间: %%~tA
        )
    ) else (
        echo ⚠️ 前端数据文件: 未同步
        echo    💡 前端可能显示旧数据或无数据
    )
    
    echo.
    goto menu
)

if "%choice%"=="8" (
    echo.
    echo 🗂️ 历史数据和预警记录
    echo ═══════════════════════════════════════
    
    if exist "data\air_quality_history.json" (
        echo ✅ 历史数据文件: 存在
        for %%A in (data\air_quality_history.json) do (
            echo    📁 文件大小: %%~zA 字节
            echo    📅 修改时间: %%~tA
        )
    ) else (
        echo ⚠️ 历史数据文件: 不存在
    )
    
    if exist "data\alerts.json" (
        echo ✅ 预警记录文件: 存在
        for %%A in (data\alerts.json) do (
            echo    📁 文件大小: %%~zA 字节
            echo    📅 修改时间: %%~tA
        )
    ) else (
        echo ✅ 预警记录文件: 不存在 (无预警记录)
    )
    
    echo.
    goto menu
)

if "%choice%"=="9" (
    echo.
    echo 🧹 清理系统数据文件
    echo ⚠️ 这将删除所有历史数据和缓存文件
    echo.
    set /p confirm=确认清理？(y/N): 
    
    if /i "%confirm%"=="y" (
        echo.
        echo 🗑️ 正在清理数据文件...
        
        if exist "data\current_air_quality.json" (
            del "data\current_air_quality.json" >nul 2>&1
            echo ✅ 已删除: current_air_quality.json
        )
        
        if exist "data\air_quality_history.json" (
            del "data\air_quality_history.json" >nul 2>&1
            echo ✅ 已删除: air_quality_history.json  
        )
        
        if exist "data\alerts.json" (
            del "data\alerts.json" >nul 2>&1
            echo ✅ 已删除: alerts.json
        )
        
        if exist "frontend\public\data\current_air_quality.json" (
            del "frontend\public\data\current_air_quality.json" >nul 2>&1
            echo ✅ 已删除: 前端数据文件
        )
        
        echo.
        echo ✅ 数据清理完成！
    ) else (
        echo 🚫 清理操作已取消
    )
    
    echo.
    goto menu
)

if "%choice%"=="0" (
    echo.
    echo 👋 感谢使用增强版智慧城市环境监测系统！
    echo 🌟 您的系统功能包括:
    echo    • 32个城市多源数据收集
    echo    • 前端实时动态更新
    echo    • 智能预警和历史分析
    echo    • 完整的可视化界面
    echo.
    goto end
)

echo ❌ 无效选择，请重新输入 (0-9)
echo.
goto choice

:menu
echo.
echo ═══════════════════════════════════════
echo 💡 提示: 选择 6 体验完整的增强实时系统
echo 💡 前端地址: http://localhost:5174/dashboard  
echo ═══════════════════════════════════════
echo.
echo 按任意键返回主菜单...
pause >nul
cls
goto choice

:choice
echo.
echo 🚀 增强系统启动选项:
echo.
echo ═══════ 数据收集选项 ═══════
echo 1. 🌍 运行多源数据收集器 (32城市，真实+模拟数据)
echo 2. 🧪 测试单次数据收集 (验证系统工作)
echo 3. 🔄 启动定时数据收集器 (每30分钟自动更新)
echo.
echo ═══════ 前端展示选项 ═══════
echo 4. 🎨 启动前端开发服务器 (Vue.js实时界面)
echo 5. 🚀 同时启动数据收集+前端服务器 (完整系统)
echo 6. ⚡ 启动增强实时系统 (多源数据+前端动态更新)
echo.
echo ═══════ 系统管理选项 ═══════
echo 7. 📊 查看系统数据状态
echo 8. 🗂️ 查看历史数据和预警记录  
echo 9. 🧹 清理所有数据文件
echo.
echo 0. 🚪 退出系统
echo.

set /p choice=请选择功能 (0-9): 
goto choice

:end
echo.
echo 🎉 系统运行结束
pause
