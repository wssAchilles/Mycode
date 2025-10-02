#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
AI Service 测试脚本
用于测试训练的模型和API服务
"""

import requests
import json
import time

def test_ai_service(base_url="http://localhost:8001"):
    """测试AI服务的各个端点"""
    
    print("🧪 AI异常检测服务测试")
    print("=" * 50)
    
    # 1. 健康检查
    print("1. 健康检查...")
    try:
        response = requests.get(f"{base_url}/health")
        print(f"   状态: {response.status_code}")
        print(f"   响应: {response.json()}")
    except Exception as e:
        print(f"   ❌ 健康检查失败: {e}")
        return False
    
    # 2. 模型信息
    print("\n2. 模型信息...")
    try:
        response = requests.get(f"{base_url}/model-info")
        print(f"   状态: {response.status_code}")
        print(f"   响应: {json.dumps(response.json(), indent=2)}")
    except Exception as e:
        print(f"   ❌ 模型信息获取失败: {e}")
    
    # 3. 异常检测测试
    print("\n3. 异常检测测试...")
    
    test_cases = [
        {"pm25": 15.5, "expected": "正常"},
        {"pm25": 25.0, "expected": "可能正常"},
        {"pm25": 45.0, "expected": "可能异常"},
        {"pm25": 100.0, "expected": "很可能异常"},
        {"pm25": 5.0, "expected": "可能异常（过低）"},
    ]
    
    for i, case in enumerate(test_cases, 1):
        try:
            response = requests.post(
                f"{base_url}/predict",
                json={"pm25": case["pm25"]},
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code == 200:
                result = response.json()
                anomaly_status = "异常" if result["is_anomaly"] else "正常"
                print(f"   测试 {i}: PM2.5={case['pm25']}")
                print(f"           预测: {anomaly_status}")
                print(f"           分数: {result['anomaly_score']}")
                print(f"           置信度: {result['confidence']}")
                print(f"           期望: {case['expected']}")
            else:
                print(f"   ❌ 测试 {i} 失败: HTTP {response.status_code}")
                
        except Exception as e:
            print(f"   ❌ 测试 {i} 异常: {e}")
    
    print("\n✅ 测试完成!")
    return True

def benchmark_api(base_url="http://localhost:8001", num_requests=100):
    """API性能基准测试"""
    print(f"\n🚀 性能测试 ({num_requests} 次请求)")
    print("=" * 50)
    
    times = []
    successes = 0
    
    for i in range(num_requests):
        start_time = time.time()
        try:
            response = requests.post(
                f"{base_url}/predict",
                json={"pm25": 25.0 + (i % 20)},
                timeout=5
            )
            end_time = time.time()
            
            if response.status_code == 200:
                times.append(end_time - start_time)
                successes += 1
            
            if (i + 1) % 10 == 0:
                print(f"   进度: {i + 1}/{num_requests}")
                
        except Exception as e:
            print(f"   请求 {i + 1} 失败: {e}")
    
    if times:
        avg_time = sum(times) / len(times)
        min_time = min(times)
        max_time = max(times)
        success_rate = successes / num_requests * 100
        
        print(f"\n📊 性能统计:")
        print(f"   成功率: {success_rate:.1f}%")
        print(f"   平均响应时间: {avg_time:.3f}s")
        print(f"   最快响应: {min_time:.3f}s")
        print(f"   最慢响应: {max_time:.3f}s")
        print(f"   每秒处理: {1/avg_time:.1f} 请求")

if __name__ == "__main__":
    # 基础功能测试
    success = test_ai_service()
    
    # 性能测试（可选）
    if success:
        user_input = input("\n是否进行性能测试？(y/n): ")
        if user_input.lower() == 'y':
            benchmark_api()
    
    print("\n🎯 测试脚本执行完成!")