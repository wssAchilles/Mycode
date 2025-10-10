@echo off
echo.
echo ===================================
echo  IQAir 空气质量数据查询工具 设置
echo ===================================
echo.

REM 设置API密钥
set IQAIR_API_KEY=194adeb6-c17c-4959-91e9-af7af289ef98

echo ✅ API密钥已设置
echo 🔑 API Key: %IQAIR_API_KEY%
echo.

echo 📦 检查Python环境...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 错误: 未找到Python，请先安装Python
    echo 下载地址: https://www.python.org/downloads/
    pause
    exit /b 1
)

echo ✅ Python环境正常
echo.

echo 📦 安装依赖库...
pip install requests >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 安装requests库失败，请手动安装: pip install requests
) else (
    echo ✅ requests库安装成功
)

echo.
echo 🚀 启动空气质量查询...
echo.

python air_quality_checker.py

echo.
echo 🎉 查询完成！
echo.
pause
