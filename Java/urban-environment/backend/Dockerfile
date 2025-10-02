# Spring Boot应用的Dockerfile
FROM openjdk:21-jdk-slim

LABEL maintainer="Urban Environment Team"
LABEL description="Urban Environment Analytics Platform Backend"

# --- 把安装系统依赖的步骤放在最前面 ---
# 切换为阿里云的 APT 软件源，然后再执行更新和安装
RUN sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y curl \
    && rm -rf /var/lib/apt/lists/*

# 设置工作目录
WORKDIR /app

# 复制Gradle构建文件和源代码
COPY build.gradle settings.gradle gradlew ./
COPY gradle gradle
COPY src src

# 构建应用
RUN chmod +x gradlew && ./gradlew build -x test

# --- 【调试命令】 ---
# 列出 build 目录下的所有文件，让我们看看 JAR 文件到底生成在了哪里


# 复制构建的JAR文件
RUN cp build/libs/*.jar app.jar

# 暴露端口
EXPOSE 8080

# 设置JVM参数
ENV JAVA_OPTS="-Xmx512m -Xms256m"

# 启动应用 (ENTRYPOINT 必须是文件末尾的指令之一)
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]