#!/bin/bash

echo ""
echo "==================================="
echo " IQAir 空气质量数据查询工具 设置"
echo "==================================="
echo ""

# 设置API密钥
export IQAIR_API_KEY="194adeb6-c17c-4959-91e9-af7af289ef98"

echo "✅ API密钥已设置"
echo "🔑 API Key: $IQAIR_API_KEY"
echo ""

echo "📦 检查Python环境..."
if ! command -v python3 &> /dev/null; then
    if ! command -v python &> /dev/null; then
        echo "❌ 错误: 未找到Python，请先安装Python"
        echo "Ubuntu/Debian: sudo apt install python3 python3-pip"
        echo "CentOS/RHEL: sudo yum install python3 python3-pip"
        echo "macOS: brew install python3"
        exit 1
    else
        PYTHON_CMD="python"
    fi
else
    PYTHON_CMD="python3"
fi

echo "✅ Python环境正常 ($PYTHON_CMD)"
echo ""

echo "📦 安装依赖库..."
$PYTHON_CMD -m pip install requests > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "✅ requests库安装成功"
else
    echo "❌ 安装requests库失败，请手动安装: pip install requests"
fi

echo ""
echo "🚀 启动空气质量查询..."
echo ""

$PYTHON_CMD air_quality_checker.py

echo ""
echo "🎉 查询完成！"
echo ""
