# Urban Environment Phase 2 完整启动脚本 (PowerShell)
# 此脚本将启动整个容器化的系统

Write-Host "🚀 启动 Urban Environment Phase 2 系统..." -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green

# 检查Docker是否运行
try {
    docker info | Out-Null
} catch {
    Write-Host "❌ 错误: Docker 未运行，请先启动 Docker" -ForegroundColor Red
    exit 1
}

# 检查docker-compose是否可用
if (!(Get-Command docker-compose -ErrorAction SilentlyContinue)) {
    Write-Host "❌ 错误: docker-compose 未找到，请安装 Docker Compose" -ForegroundColor Red
    exit 1
}

Write-Host "📦 构建并启动所有服务..." -ForegroundColor Yellow
docker-compose up --build -d

Write-Host "⏳ 等待服务启动..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

Write-Host "🔍 检查服务状态..." -ForegroundColor Yellow
docker-compose ps

Write-Host ""
Write-Host "🎉 系统启动完成！" -ForegroundColor Green
Write-Host ""
Write-Host "📊 可用服务:" -ForegroundColor Cyan
Write-Host "  • PostgreSQL/TimescaleDB: localhost:5432" -ForegroundColor White
Write-Host "  • Kafka: localhost:29092" -ForegroundColor White
Write-Host "  • Zookeeper: localhost:2181" -ForegroundColor White
Write-Host "  • Spring Boot API: http://localhost:8080" -ForegroundColor White
Write-Host "  • 健康检查: http://localhost:8080/actuator/health" -ForegroundColor White
Write-Host ""
Write-Host "📝 要查看日志，使用:" -ForegroundColor Cyan
Write-Host "  docker-compose logs -f [service-name]" -ForegroundColor White
Write-Host ""
Write-Host "🛑 要停止所有服务，使用:" -ForegroundColor Cyan
Write-Host "  docker-compose down" -ForegroundColor White
Write-Host ""
Write-Host "💡 现在可以运行 Python IoT 模拟器:" -ForegroundColor Cyan
Write-Host "  python scripts/iot_simulator.py" -ForegroundColor White
