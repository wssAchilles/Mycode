#!/bin/bash

# Urban Environment Phase 2 完整启动脚本
# 此脚本将启动整个容器化的系统

echo "🚀 启动 Urban Environment Phase 2 系统..."
echo "========================================"

# 检查Docker是否运行
if ! docker info > /dev/null 2>&1; then
    echo "❌ 错误: Docker 未运行，请先启动 Docker"
    exit 1
fi

# 检查docker-compose是否可用
if ! command -v docker-compose > /dev/null 2>&1; then
    echo "❌ 错误: docker-compose 未找到，请安装 Docker Compose"
    exit 1
fi

echo "📦 构建并启动所有服务..."
docker-compose up --build -d

echo "⏳ 等待服务启动..."
sleep 10

echo "🔍 检查服务状态..."
docker-compose ps

echo ""
echo "🎉 系统启动完成！"
echo ""
echo "📊 可用服务:"
echo "  • PostgreSQL/TimescaleDB: localhost:5432"
echo "  • Kafka: localhost:29092"
echo "  • Zookeeper: localhost:2181"
echo "  • Spring Boot API: http://localhost:8080"
echo "  • 健康检查: http://localhost:8080/actuator/health"
echo ""
echo "📝 要查看日志，使用:"
echo "  docker-compose logs -f [service-name]"
echo ""
echo "🛑 要停止所有服务，使用:"
echo "  docker-compose down"
echo ""
echo "💡 现在可以运行 Python IoT 模拟器:"
echo "  python scripts/iot_simulator.py"
