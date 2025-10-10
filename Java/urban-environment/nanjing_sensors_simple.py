# -*- coding: utf-8 -*-
"""
南京市传感器数据生成器 - 简化版

生成南京市11个区的详细传感器数据，避免编码问题
"""

import json
import os
import random
import time
from datetime import datetime

# 南京市区域详细信息
NANJING_DISTRICTS = {
    'xuanwu': {'name': '玄武区', 'lat': 32.0507, 'lng': 118.7973, 'base_aqi': 75, 'sensors': 4},
    'qinhuai': {'name': '秦淮区', 'lat': 32.0353, 'lng': 118.7973, 'base_aqi': 72, 'sensors': 4},
    'jianye': {'name': '建邺区', 'lat': 32.0037, 'lng': 118.7209, 'base_aqi': 68, 'sensors': 5},
    'gulou': {'name': '鼓楼区', 'lat': 32.0663, 'lng': 118.7697, 'base_aqi': 78, 'sensors': 4},
    'pukou': {'name': '浦口区', 'lat': 32.0588, 'lng': 118.6278, 'base_aqi': 65, 'sensors': 4},
    'qixia': {'name': '栖霞区', 'lat': 32.0947, 'lng': 118.9066, 'base_aqi': 73, 'sensors': 4},
    'yuhuatai': {'name': '雨花台区', 'lat': 31.9919, 'lng': 118.7797, 'base_aqi': 70, 'sensors': 4},
    'jiangning': {'name': '江宁区', 'lat': 31.9523, 'lng': 118.8400, 'base_aqi': 67, 'sensors': 6},
    'liuhe': {'name': '六合区', 'lat': 32.3426, 'lng': 118.8273, 'base_aqi': 62, 'sensors': 4},
    'lishui': {'name': '溧水区', 'lat': 31.6534, 'lng': 119.0286, 'base_aqi': 58, 'sensors': 4},
    'gaochun': {'name': '高淳区', 'lat': 31.3269, 'lng': 118.8756, 'base_aqi': 55, 'sensors': 4}
}

def generate_nanjing_sensors():
    """生成南京市传感器数据"""
    print("正在生成南京市详细传感器数据...")
    
    all_sensors = []
    current_hour = datetime.now().hour
    
    # 时间因子
    if 7 <= current_hour <= 9 or 17 <= current_hour <= 19:
        time_factor = 1.2
    elif 22 <= current_hour or current_hour <= 5:
        time_factor = 0.8
    else:
        time_factor = 1.0
    
    sensor_id = 1
    
    for district_code, info in NANJING_DISTRICTS.items():
        district_name = info['name']
        base_lat = info['lat']
        base_lng = info['lng']
        base_aqi = info['base_aqi']
        sensor_count = info['sensors']
        
        print(f"生成 {district_name} 传感器数据...")
        
        for i in range(sensor_count):
            # 在区域内随机分布传感器
            lat_offset = (random.random() - 0.5) * 0.02  # 约2km范围
            lng_offset = (random.random() - 0.5) * 0.02
            
            sensor_lat = base_lat + lat_offset
            sensor_lng = base_lng + lng_offset
            
            # 计算AQI
            random_factor = 0.8 + random.random() * 0.4
            aqi = int(base_aqi * time_factor * random_factor)
            aqi = max(20, min(200, aqi))
            
            # 计算其他参数
            pm25 = round(aqi * 0.6 + random.uniform(-5, 5), 1)
            pm25 = max(5, pm25)
            
            temperature = round(18 + random.uniform(-2, 3), 1)
            humidity = int(60 + random.uniform(-10, 15))
            
            sensor_data = {
                'id': f'NJ_{sensor_id:03d}',
                'city': 'Nanjing',
                'city_chinese': '南京',
                'province': '江苏省',
                'district': district_name,
                'location': f'{district_name}-{i+1}号站点',
                'pm25': pm25,
                'aqi': aqi,
                'temperature': temperature,
                'humidity': humidity,
                'wind_speed': round(random.uniform(0.5, 4.0), 1),
                'status': '异常' if aqi > 100 else '正常',
                'latitude': round(sensor_lat, 6),
                'longitude': round(sensor_lng, 6),
                'lastUpdate': datetime.now().isoformat(),
                'data_source': 'Nanjing_Enhanced_Network'
            }
            
            all_sensors.append(sensor_data)
            sensor_id += 1
    
    return all_sensors

def save_sensor_data(sensors):
    """保存传感器数据"""
    # 确保目录存在
    os.makedirs('data', exist_ok=True)
    os.makedirs('frontend/public/data', exist_ok=True)
    
    # 统计信息
    total = len(sensors)
    abnormal = len([s for s in sensors if s['status'] == '异常'])
    avg_aqi = round(sum(s['aqi'] for s in sensors) / total, 1)
    
    output_data = {
        'update_time': datetime.now().isoformat(),
        'city_focus': '南京市',
        'total_sensors': total,
        'abnormal_sensors': abnormal,
        'average_aqi': avg_aqi,
        'sensors': sorted(sensors, key=lambda x: x['aqi'], reverse=True)
    }
    
    # 保存到主数据目录
    with open('data/nanjing_sensors_detailed.json', 'w', encoding='utf-8') as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)
    
    # 同步到前端
    with open('frontend/public/data/nanjing_sensors_detailed.json', 'w', encoding='utf-8') as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)
    
    print(f"数据保存完成:")
    print(f"  总传感器: {total}个")
    print(f"  异常传感器: {abnormal}个")
    print(f"  平均AQI: {avg_aqi}")
    
    # 按区统计
    district_stats = {}
    for sensor in sensors:
        district = sensor['district']
        if district not in district_stats:
            district_stats[district] = {'count': 0, 'abnormal': 0, 'avg_aqi': 0}
        
        district_stats[district]['count'] += 1
        if sensor['status'] == '异常':
            district_stats[district]['abnormal'] += 1
        district_stats[district]['avg_aqi'] += sensor['aqi']
    
    print("\n各区传感器分布:")
    for district, stats in district_stats.items():
        avg_aqi = round(stats['avg_aqi'] / stats['count'], 1)
        print(f"  {district}: {stats['count']}个传感器, 异常{stats['abnormal']}个, 平均AQI:{avg_aqi}")

def main():
    """主函数"""
    print("=== 南京市环境监测传感器网络数据生成 ===")
    print(f"开始时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    
    # 生成传感器数据
    sensors = generate_nanjing_sensors()
    
    print()
    
    # 保存数据
    save_sensor_data(sensors)
    
    print("\n=== 数据生成完成 ===")

if __name__ == "__main__":
    main()
