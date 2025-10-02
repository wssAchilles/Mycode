@echo off
echo 🔍 检查数据库服务状态...
echo.

echo 📊 MongoDB 服务状态:
sc query MongoDB
echo.

echo 🐘 PostgreSQL 服务状态:
sc query postgresql-x64-16
echo.

echo 🔴 Redis/Memurai 服务状态:
sc query Redis 2>nul || sc query Memurai 2>nul || echo Redis/Memurai 服务未找到
echo.

echo 📡 检查端口占用情况:
echo MongoDB (端口 27017):
netstat -an | findstr :27017
echo.

echo PostgreSQL (端口 5432):
netstat -an | findstr :5432
echo.

echo Redis (端口 6379):
netstat -an | findstr :6379
echo.

echo ✅ 检查完成！
pause
