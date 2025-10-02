#!/usr/bin/env python
# -*- coding: utf-8 -*-

# 注意：运行此脚本前需要先安装kafka-python库
# 安装命令: pip install kafka-python

import time
import random
import json
from datetime import datetime, timezone
from kafka import KafkaProducer

# 常量定义
KAFKA_BOOTSTRAP_SERVERS = "localhost:29092"
KAFKA_TOPIC = "sensor-data-topic"
DEVICE_ID = "sensor-tokyo-01"
BASE_LATITUDE = 35.6895  # 东京市区的基础纬度
BASE_LONGITUDE = 139.6917  # 东京市区的基础经度

def generate_data():
    """
    生成模拟的传感器数据
    
    返回:
        dict: 传感器数据字典
    """
    # 添加少量随机偏移（-0.01到0.01之间）
    latitude = BASE_LATITUDE + random.uniform(-0.01, 0.01)
    longitude = BASE_LONGITUDE + random.uniform(-0.01, 0.01)
    
    # 生成随机的PM2.5值（5.0到35.0之间）
    pm25 = round(random.uniform(5.0, 35.0), 2)
    
    # 生成当前UTC时间并格式化为ISO 8601字符串
    timestamp = datetime.now(timezone.utc).isoformat()
    
    # 构建并返回数据字典
    return {
        "deviceId": DEVICE_ID,
        "latitude": latitude,
        "longitude": longitude,
        "pm25": pm25,
        "timestamp": timestamp
    }

def send_to_kafka(producer, data):
    """
    将数据发送到Kafka主题
    
    参数:
        producer (KafkaProducer): Kafka生产者实例
        data (dict): 要发送的数据字典
    """
    try:
        # 发送数据到Kafka主题
        producer.send(KAFKA_TOPIC, data)
        producer.flush()  # 确保消息被立即发送
        print(f"数据发送成功到Kafka主题 '{KAFKA_TOPIC}': {data}")
    except Exception as e:
        print(f"发送到Kafka时出错: {str(e)}")

if __name__ == "__main__":
    print("启动IoT传感器数据模拟器...")
    print(f"设备ID: {DEVICE_ID}")
    print(f"基础位置: 纬度={BASE_LATITUDE}, 经度={BASE_LONGITUDE}")
    print(f"Kafka服务器: {KAFKA_BOOTSTRAP_SERVERS}")
    print(f"Kafka主题: {KAFKA_TOPIC}")
    print("按Ctrl+C终止程序\n")
    
    # 创建Kafka生产者
    producer = KafkaProducer(
        bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
        value_serializer=lambda v: json.dumps(v).encode('utf-8')
    )
    
    try:
        while True:
            # 生成数据
            data = generate_data()
            
            # 发送数据到Kafka
            send_to_kafka(producer, data)
            
            # 等待5秒
            time.sleep(5)
    except KeyboardInterrupt:
        print("\n程序已被用户终止")
    finally:
        # 关闭Kafka生产者
        producer.close()
