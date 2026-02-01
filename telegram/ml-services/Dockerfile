# 使用官方 Python 3.11 Slim 镜像 (轻量级)
FROM python:3.11-slim

# 禁用 Python 输出缓冲 (确保日志实时显示)
ENV PYTHONUNBUFFERED=1


# 设置工作目录
WORKDIR /app

# 安装必要的系统依赖 (若需要)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖文件
COPY requirements.txt .

# 安装 Python 依赖
# --no-cache-dir 减小镜像体积
RUN pip install --no-cache-dir -r requirements.txt

# 复制整个服务代码 (包含 data/ 和 models/)
COPY . .

# 创建非 root 用户 (安全最佳实践)
RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser

# 暴露端口 (Render 会自动设置 PORT 环境变量)
ENV PORT=8000
EXPOSE 8000

# 启动命令
# 使用 $PORT 环境变量适配 Render
CMD uvicorn app:app --host 0.0.0.0 --port $PORT
