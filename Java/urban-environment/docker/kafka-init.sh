#!/bin/bash

# Kafka 主题初始化脚本
# 等待Kafka服务完全启动，然后创建所需的主题

echo "等待Kafka服务启动..."

# 等待Kafka可用
until kafka-topics --bootstrap-server kafka:9092 --list > /dev/null 2>&1; do
  echo "Kafka尚未就绪，等待5秒..."
  sleep 5
done

echo "Kafka服务已启动，开始创建主题..."

# 创建sensor-data-topic主题
kafka-topics --bootstrap-server kafka:9092 \
             --create \
             --topic sensor-data-topic \
             --partitions 3 \
             --replication-factor 1 \
             --if-not-exists

echo "主题创建完成，当前主题列表："
kafka-topics --bootstrap-server kafka:9092 --list

echo "Kafka初始化完成！"
