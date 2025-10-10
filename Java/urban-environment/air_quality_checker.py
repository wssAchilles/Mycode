#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
IQAir API 空气质量数据获取脚本

这个脚本用于从IQAir API获取指定城市的实时空气质量数据。
使用前请确保已设置环境变量 IQAIR_API_KEY。

依赖库:
- requests: 用于发送HTTP请求
- os: 用于从环境变量中读取API密钥
- json: 用于处理API返回的数据

使用方法:
# Windows (Command Prompt):
set IQAIR_API_KEY=your-api-key-here
python air_quality_checker.py

# Windows (PowerShell):
$env:IQAIR_API_KEY="your-api-key-here"
python air_quality_checker.py

# Linux/Mac:
export IQAIR_API_KEY="your-api-key-here"
python air_quality_checker.py

作者: AI Assistant
版本: 1.0
日期: 2025-10-09
"""

import os
import json
import requests
from typing import Optional, Dict, Any
from datetime import datetime


def get_city_air_quality(city: str, state: str, country: str) -> Optional[Dict[str, Any]]:
    """
    从IQAir API获取指定城市的空气质量数据
    
    Args:
        city (str): 城市名称（英文）
        state (str): 州/省/都道府县名称（英文）
        country (str): 国家名称（英文）
    
    Returns:
        Dict[str, Any]: 成功时返回包含空气质量信息的字典
        None: 失败时返回None
        
    返回的字典结构:
        {
            'city': str,
            'state': str, 
            'country': str,
            'aqi_us': int,
            'main_pollutant_us': str,
            'temperature_celsius': int,
            'humidity_percent': int,
            'wind_speed_ms': float,
            'timestamp': str,
            'data_time': str
        }
    """
    
    # 1. 检查API密钥
    api_key = os.getenv('IQAIR_API_KEY')
    if not api_key:
        print("❌ 错误：未设置环境变量 IQAIR_API_KEY")
        print("请先设置API密钥：")
        print("Windows CMD: set IQAIR_API_KEY=your-api-key")
        print("Windows PowerShell: $env:IQAIR_API_KEY=\"your-api-key\"")
        print("Linux/Mac: export IQAIR_API_KEY=\"your-api-key\"")
        return None
    
    # 2. 构建API请求
    base_url = "https://api.airvisual.com/v2/city"
    params = {
        'city': city,
        'state': state, 
        'country': country,
        'key': api_key
    }
    
    print(f"🔍 正在查询 {city}, {state}, {country} 的空气质量数据...")
    
    try:
        # 3. 发送HTTP请求
        response = requests.get(base_url, params=params, timeout=10)
        
        # 4. 检查HTTP状态码
        if response.status_code != 200:
            print(f"❌ HTTP请求失败，状态码: {response.status_code}")
            if response.status_code == 401:
                print("错误：API密钥无效或已过期")
            elif response.status_code == 404:
                print("错误：API端点未找到")
            elif response.status_code == 429:
                print("错误：API调用频率超限，请稍后重试")
            else:
                print(f"错误：服务器返回错误 {response.status_code}")
            return None
            
    except requests.exceptions.ConnectionError:
        print("❌ 网络连接错误：无法连接到IQAir服务器")
        print("请检查网络连接并重试")
        return None
    except requests.exceptions.Timeout:
        print("❌ 请求超时：服务器响应时间过长")
        print("请稍后重试")
        return None
    except requests.exceptions.RequestException as e:
        print(f"❌ 网络请求发生异常: {e}")
        return None
    
    try:
        # 5. 解析JSON响应
        data = response.json()
        
        # 6. 检查API响应状态
        if data.get('status') != 'success':
            print(f"❌ API调用失败: {data.get('status', '未知错误')}")
            if 'message' in data:
                print(f"详细信息: {data['message']}")
            
            # 常见错误处理
            if data.get('status') == 'fail':
                print("可能的原因：")
                print("- 城市名称拼写错误")
                print("- 该城市不在IQAir数据库中")
                print("- 州/省名称不正确")
                print("- 国家名称不正确")
            return None
            
    except json.JSONDecodeError:
        print("❌ 服务器返回数据格式错误：无法解析JSON")
        return None
    except Exception as e:
        print(f"❌ 数据解析发生异常: {e}")
        return None
    
    try:
        # 7. 提取关键数据
        current_data = data['data']['current']
        pollution = current_data['pollution']
        weather = current_data['weather']
        location = data['data']
        
        # 8. 构建返回数据
        result = {
            'city': location['city'],
            'state': location['state'],
            'country': location['country'],
            'aqi_us': pollution['aqius'],
            'main_pollutant_us': pollution['mainus'],
            'temperature_celsius': weather['tp'],
            'humidity_percent': weather['hu'],
            'wind_speed_ms': weather['ws'],
            'timestamp': pollution['ts'],
            'data_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        }
        
        return result
        
    except KeyError as e:
        print(f"❌ 数据格式异常：缺少必要字段 {e}")
        print("API返回的数据结构可能已发生变化")
        return None
    except Exception as e:
        print(f"❌ 数据处理发生异常: {e}")
        return None


def format_pollutant_name(pollutant_code: str) -> str:
    """
    将污染物代码转换为中文名称
    
    Args:
        pollutant_code (str): 污染物代码
        
    Returns:
        str: 中文污染物名称
    """
    pollutant_map = {
        'p2': 'PM2.5',
        'p1': 'PM10', 
        'o3': '臭氧(O3)',
        'n2': '二氧化氮(NO2)',
        's2': '二氧化硫(SO2)',
        'co': '一氧化碳(CO)'
    }
    return pollutant_map.get(pollutant_code, f"未知污染物({pollutant_code})")


def get_aqi_level(aqi: int) -> tuple[str, str]:
    """
    根据AQI值返回空气质量等级和颜色
    
    Args:
        aqi (int): AQI数值
        
    Returns:
        tuple: (等级描述, 颜色代码)
    """
    if aqi <= 50:
        return "优秀", "🟢"
    elif aqi <= 100:
        return "中等", "🟡"  
    elif aqi <= 150:
        return "对敏感人群不健康", "🟠"
    elif aqi <= 200:
        return "不健康", "🔴"
    elif aqi <= 300:
        return "非常不健康", "🟣"
    else:
        return "危险", "🟤"


def print_air_quality_report(data: Dict[str, Any]) -> None:
    """
    格式化打印空气质量报告
    
    Args:
        data (Dict[str, Any]): 空气质量数据字典
    """
    level, color_emoji = get_aqi_level(data['aqi_us'])
    pollutant_name = format_pollutant_name(data['main_pollutant_us'])
    
    print("\n" + "="*60)
    print(f"🌍 {data['city']}, {data['state']}, {data['country']} 实时空气质量报告")
    print("="*60)
    print(f"{color_emoji} AQI (美标): {data['aqi_us']} - {level}")
    print(f"🏭 主要污染物: {pollutant_name}")
    print(f"🌡️  温度: {data['temperature_celsius']}°C")
    print(f"💧 湿度: {data['humidity_percent']}%")
    print(f"💨 风速: {data['wind_speed_ms']} m/s")
    print(f"⏰ 数据更新时间: {data['timestamp']}")
    print(f"📊 查询时间: {data['data_time']}")
    print("="*60)
    
    # 健康建议
    if data['aqi_us'] <= 50:
        print("💚 空气质量良好，适合户外活动")
    elif data['aqi_us'] <= 100:
        print("💛 空气质量尚可，敏感人群应减少户外活动")
    elif data['aqi_us'] <= 150:
        print("🧡 空气质量对敏感人群不健康，建议减少户外活动")
    elif data['aqi_us'] <= 200:
        print("❤️ 空气质量不健康，所有人群应减少户外活动")
    else:
        print("💜 空气质量危险，建议避免户外活动")
    
    print()


if __name__ == "__main__":
    """
    主程序入口 - 示例用法
    """
    print("🌟 IQAir 空气质量数据查询工具")
    print("=" * 40)
    
    # 示例查询 - 可以修改为您想查询的城市
    test_cities = [
        ("Tokyo", "Tokyo", "Japan"),
        ("Beijing", "Beijing", "China"),
        ("Los Angeles", "California", "USA"),
        ("London", "England", "UK")
    ]
    
    print("🔍 正在查询示例城市的空气质量数据...\n")
    
    successful_queries = 0
    
    for city, state, country in test_cities:
        print(f"📍 查询: {city}, {state}, {country}")
        
        # 调用核心函数
        result = get_city_air_quality(city, state, country)
        
        if result:
            print_air_quality_report(result)
            successful_queries += 1
        else:
            print(f"❌ 无法获取 {city} 的数据\n")
            
        print("-" * 60 + "\n")
    
    # 总结
    print(f"📈 查询完成！成功获取 {successful_queries}/{len(test_cities)} 个城市的数据")
    
    if successful_queries == 0:
        print("\n💡 提示:")
        print("1. 请确保已正确设置环境变量 IQAIR_API_KEY")
        print("2. 检查网络连接是否正常")
        print("3. 确认API密钥是否有效")
        print("4. 城市名称需要使用英文")
    
    print("\n🎉 感谢使用IQAir空气质量查询工具！")
