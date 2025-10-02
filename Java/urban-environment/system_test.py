#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
完整系统测试脚本
测试从IoT模拟器到AI异常检测的完整数据流
"""

import requests
import time
import json

def test_complete_system():
    """测试完整系统的各个组件"""
    
    print("🧪 完整AI异常检测系统测试")
    print("=" * 60)
    
    # 1. 测试AI服务
    print("1. 测试AI异常检测服务...")
    try:
        # 健康检查
        ai_health = requests.get("http://localhost:8001/health").json()
        print(f"   ✅ AI服务状态: {ai_health['status']}")
        
        # 异常检测测试
        test_data = {"pm25": 35.0}
        ai_result = requests.post("http://localhost:8001/predict", json=test_data).json()
        status = "异常" if ai_result["is_anomaly"] else "正常"
        print(f"   ✅ 异常检测: PM2.5={test_data['pm25']} → {status} (分数: {ai_result['anomaly_score']:.4f})")
        
    except Exception as e:
        print(f"   ❌ AI服务测试失败: {e}")
        return False
    
    # 2. 测试Java后端
    print("\n2. 测试Java后端服务...")
    try:
        # 健康检查
        backend_health = requests.get("http://localhost:8080/actuator/health").json()
        print(f"   ✅ 后端服务状态: {backend_health['status']}")
        
        # 获取最新数据
        latest_data = requests.get("http://localhost:8080/api/data/latest").json()
        print(f"   ✅ 数据库记录数: {len(latest_data)} 条")
        if latest_data:
            latest = latest_data[0]
            print(f"   ✅ 最新数据: PM2.5={latest['pm25']}, 时间={latest['timestamp']}")
        
        # 测试热力图API
        heatmap_data = requests.get("http://localhost:8080/api/data/heatmap").json()
        print(f"   ✅ 热力图数据: {len(heatmap_data)} 个数据点")
        
    except Exception as e:
        print(f"   ❌ Java后端测试失败: {e}")
        return False
    
    # 3. 测试前端
    print("\n3. 测试Vue.js前端...")
    try:
        frontend_response = requests.get("http://localhost:5173/", timeout=5)
        print(f"   ✅ 前端服务状态: HTTP {frontend_response.status_code}")
    except Exception as e:
        print(f"   ⚠️ 前端服务可能未启动: {e}")
    
    # 4. 系统集成测试
    print("\n4. 系统集成验证...")
    print("   🔄 请启动IoT模拟器发送数据...")
    print("   📊 监控AI服务日志: docker-compose logs ai-service -f")
    print("   📊 监控后端日志: docker-compose logs backend -f")
    
    return True

def monitor_ai_predictions():
    """监控AI预测活动"""
    print("\n🔍 监控AI预测活动 (30秒)...")
    
    start_time = time.time()
    prediction_count = 0
    
    while time.time() - start_time < 30:
        try:
            # 这里我们无法直接监控，但可以通过健康检查确认服务运行
            health = requests.get("http://localhost:8001/health", timeout=1)
            if health.status_code == 200:
                print(".", end="", flush=True)
            time.sleep(1)
        except:
            print("x", end="", flush=True)
            time.sleep(1)
    
    print(f"\n   监控完成")

def system_status_summary():
    """系统状态总结"""
    print("\n📈 系统状态总结")
    print("=" * 60)
    
    services = [
        ("AI服务", "http://localhost:8001/health"),
        ("Java后端", "http://localhost:8080/actuator/health"),
        ("Vue前端", "http://localhost:5173/")
    ]
    
    for service_name, url in services:
        try:
            response = requests.get(url, timeout=3)
            status = "🟢 运行中" if response.status_code == 200 else f"🟡 状态码: {response.status_code}"
        except:
            status = "🔴 不可用"
        
        print(f"   {service_name}: {status}")
    
    print(f"\n🌐 访问地址:")
    print(f"   AI服务API: http://localhost:8001")
    print(f"   Java后端API: http://localhost:8080")
    print(f"   Vue.js前端: http://localhost:5173")
    
    print(f"\n🔧 管理命令:")
    print(f"   查看所有服务: docker-compose ps")
    print(f"   AI服务日志: docker-compose logs ai-service -f")
    print(f"   后端日志: docker-compose logs backend -f")
    print(f"   重启AI服务: docker-compose restart ai-service")
    
    print(f"\n🧪 测试命令:")
    print(f"   测试AI预测: curl -X POST http://localhost:8001/predict -H \"Content-Type: application/json\" -d '{{\"pm25\": 35.0}}'")
    print(f"   获取最新数据: curl http://localhost:8080/api/data/latest")
    print(f"   启动IoT模拟器: python scripts/iot_simulator.py")

if __name__ == "__main__":
    print("🚀 启动完整系统测试...")
    
    success = test_complete_system()
    
    if success:
        print("\n✅ 基础测试通过！")
        
        user_input = input("\n是否监控AI预测活动？(y/n): ")
        if user_input.lower() == 'y':
            monitor_ai_predictions()
        
        system_status_summary()
        
        print("\n🎯 测试完成！系统已准备就绪。")
        print("💡 建议：启动IoT模拟器开始实时数据流测试")
    else:
        print("\n❌ 系统测试失败，请检查服务状态")
    
    print("\n" + "=" * 60)