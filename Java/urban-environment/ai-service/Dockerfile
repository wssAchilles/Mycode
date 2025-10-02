# AI Service Dockerfile
# 基于Python 3.11的优化Docker镜像

# 第一阶段：构建阶段
FROM python:3.11-slim as builder

# 设置工作目录
WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖文件
COPY requirements.txt .

# 安装Python依赖到临时目录
RUN pip install --user --no-cache-dir --upgrade -r requirements.txt

# 第二阶段：运行阶段
FROM python:3.11-slim

# 创建非root用户
RUN groupadd -r aiuser && useradd -r -g aiuser aiuser

# 安装运行时依赖
RUN apt-get update && apt-get install -y \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

# 设置工作目录
WORKDIR /app

# 从构建阶段复制Python包
COPY --from=builder /root/.local /home/aiuser/.local

# 设置Python路径
ENV PATH=/home/aiuser/.local/bin:$PATH

# 复制应用代码
COPY main.py .
COPY train.py .

# 创建models目录
RUN mkdir -p models

# 复制预训练模型（如果存在）
COPY models/ ./models/

# 设置环境变量
ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1
ENV DB_HOST=urban-db
ENV DB_NAME=urban_environment_data
ENV DB_USER=postgres
ENV DB_PASS=postgres
ENV DB_PORT=5432

# 更改文件所有者
RUN chown -R aiuser:aiuser /app

# 切换到非root用户
USER aiuser

# 健康检查
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8000/health')" || exit 1

# 暴露端口
EXPOSE 8000

# 启动命令
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]