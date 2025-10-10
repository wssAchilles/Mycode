# -*- coding: utf-8 -*-
"""
增强南京市传感器数据收集器

专门为南京市创建详细的传感器网络，包括：
1. 全市11个区详细覆盖
2. 重点区域多传感器布设
3. 精确的地理坐标定位
4. 真实的环境数据模拟

作者: AI Assistant
日期: 2025-10-09
"""

import json
import os
import random
import time
from datetime import datetime
from typing import Dict, List, Any

# 南京市详细区域信息
NANJING_DISTRICTS = {
    '玄武区': {
        'coordinates': {'lat': 32.0507, 'lng': 118.7973},
        'locations': [
            {'name': '新街口商圈', 'lat_offset': 0.000, 'lng_offset': 0.000, 'type': '商业区'},
            {'name': '玄武湖公园', 'lat_offset': 0.015, 'lng_offset': 0.005, 'type': '公园'},
            {'name': '南京站', 'lat_offset': 0.012, 'lng_offset': -0.008, 'type': '交通枢纽'},
            {'name': '玄武门', 'lat_offset': 0.005, 'lng_offset': -0.003, 'type': '历史区'},
        ],
        'base_aqi': 75,
        'characteristics': '商业繁华，交通密集'
    },
    '秦淮区': {
        'coordinates': {'lat': 32.0353, 'lng': 118.7973},
        'locations': [
            {'name': '夫子庙', 'lat_offset': -0.012, 'lng_offset': 0.008, 'type': '旅游区'},
            {'name': '中华门', 'lat_offset': -0.018, 'lng_offset': -0.005, 'type': '历史区'},
            {'name': '老门东', 'lat_offset': -0.008, 'lng_offset': 0.012, 'type': '文化区'},
            {'name': '秦淮河畔', 'lat_offset': -0.005, 'lng_offset': 0.015, 'type': '水域'},
        ],
        'base_aqi': 72,
        'characteristics': '历史文化，旅游热点'
    },
    '建邺区': {
        'coordinates': {'lat': 32.0037, 'lng': 118.7209},
        'locations': [
            {'name': '河西新城', 'lat_offset': 0.008, 'lng_offset': -0.015, 'type': '新区'},
            {'name': '奥体中心', 'lat_offset': -0.005, 'lng_offset': -0.012, 'type': '体育区'},
            {'name': '江心洲', 'lat_offset': -0.025, 'lng_offset': 0.008, 'type': '生态区'},
            {'name': '南京眼', 'lat_offset': 0.012, 'lng_offset': -0.008, 'type': '地标'},
            {'name': '河西CBD', 'lat_offset': 0.015, 'lng_offset': -0.018, 'type': '商务区'},
        ],
        'base_aqi': 68,
        'characteristics': '现代化新区，环境较好'
    },
    '鼓楼区': {
        'coordinates': {'lat': 32.0663, 'lng': 118.7697},
        'locations': [
            {'name': '鼓楼广场', 'lat_offset': 0.000, 'lng_offset': 0.000, 'type': '中心区'},
            {'name': '南京大学', 'lat_offset': 0.025, 'lng_offset': -0.015, 'type': '教育区'},
            {'name': '湖南路商圈', 'lat_offset': 0.012, 'lng_offset': 0.008, 'type': '商业区'},
            {'name': '清凉山', 'lat_offset': -0.018, 'lng_offset': -0.022, 'type': '公园'},
        ],
        'base_aqi': 78,
        'characteristics': '文教区域，人口密集'
    },
    '浦口区': {
        'coordinates': {'lat': 32.0588, 'lng': 118.6278},
        'locations': [
            {'name': '江浦街道', 'lat_offset': 0.000, 'lng_offset': 0.000, 'type': '行政区'},
            {'name': '桥北新区', 'lat_offset': 0.015, 'lng_offset': 0.025, 'type': '新区'},
            {'name': '老山森林公园', 'lat_offset': -0.035, 'lng_offset': -0.028, 'type': '生态区'},
            {'name': '高新技术开发区', 'lat_offset': 0.022, 'lng_offset': 0.018, 'type': '工业区'},
        ],
        'base_aqi': 65,
        'characteristics': '江北新区，生态环境好'
    },
    '栖霞区': {
        'coordinates': {'lat': 32.0947, 'lng': 118.9066},
        'locations': [
            {'name': '栖霞山', 'lat_offset': 0.025, 'lng_offset': 0.035, 'type': '风景区'},
            {'name': '仙林大学城', 'lat_offset': -0.015, 'lng_offset': -0.025, 'type': '教育区'},
            {'name': '龙潭港', 'lat_offset': 0.045, 'lng_offset': 0.055, 'type': '港口区'},
            {'name': '马群街道', 'lat_offset': -0.008, 'lng_offset': -0.012, 'type': '居住区'},
        ],
        'base_aqi': 73,
        'characteristics': '教育科研，风景名胜'
    },
    '雨花台区': {
        'coordinates': {'lat': 31.9919, 'lng': 118.7797},
        'locations': [
            {'name': '雨花台烈士陵园', 'lat_offset': 0.000, 'lng_offset': 0.000, 'type': '纪念区'},
            {'name': '软件谷', 'lat_offset': -0.025, 'lng_offset': 0.015, 'type': '科技区'},
            {'name': '中华门外', 'lat_offset': 0.015, 'lng_offset': -0.008, 'type': '交通区'},
            {'name': '板桥新城', 'lat_offset': -0.035, 'lng_offset': -0.025, 'type': '新区'},
        ],
        'base_aqi': 70,
        'characteristics': '软件产业，科技创新'
    },
    '江宁区': {
        'coordinates': {'lat': 31.9523, 'lng': 118.8400},
        'locations': [
            {'name': '东山街道', 'lat_offset': 0.000, 'lng_offset': 0.000, 'type': '行政区'},
            {'name': '江宁大学城', 'lat_offset': 0.025, 'lng_offset': -0.018, 'type': '教育区'},
            {'name': '汤山温泉', 'lat_offset': 0.055, 'lng_offset': 0.045, 'type': '旅游区'},
            {'name': '禄口机场', 'lat_offset': -0.065, 'lng_offset': 0.035, 'type': '机场'},
            {'name': '科学园', 'lat_offset': 0.015, 'lng_offset': 0.022, 'type': '科研区'},
            {'name': '秣陵街道', 'lat_offset': -0.025, 'lng_offset': -0.015, 'type': '居住区'},
        ],
        'base_aqi': 67,
        'characteristics': '大学科研，交通便利'
    },
    '六合区': {
        'coordinates': {'lat': 32.3426, 'lng': 118.8273},
        'locations': [
            {'name': '雄州街道', 'lat_offset': 0.000, 'lng_offset': 0.000, 'type': '行政区'},
            {'name': '金牛湖', 'lat_offset': -0.045, 'lng_offset': -0.035, 'type': '水域'},
            {'name': '程桥街道', 'lat_offset': 0.025, 'lng_offset': 0.018, 'type': '工业区'},
            {'name': '龙袍镇', 'lat_offset': -0.055, 'lng_offset': 0.065, 'type': '农业区'},
        ],
        'base_aqi': 62,
        'characteristics': '远郊区域，空气清新'
    },
    '溧水区': {
        'coordinates': {'lat': 31.6534, 'lng': 119.0286},
        'locations': [
            {'name': '溧水中心', 'lat_offset': 0.000, 'lng_offset': 0.000, 'type': '县城'},
            {'name': '天生桥', 'lat_offset': 0.035, 'lng_offset': -0.025, 'type': '景区'},
            {'name': '开发区', 'lat_offset': -0.015, 'lng_offset': 0.022, 'type': '工业区'},
            {'name': '石湫镇', 'lat_offset': -0.045, 'lng_offset': -0.038, 'type': '乡镇'},
        ],
        'base_aqi': 58,
        'characteristics': '生态良好，污染较少'
    },
    '高淳区': {
        'coordinates': {'lat': 31.3269, 'lng': 118.8756},
        'locations': [
            {'name': '淳溪街道', 'lat_offset': 0.000, 'lng_offset': 0.000, 'type': '县城'},
            {'name': '固城湖', 'lat_offset': -0.025, 'lng_offset': 0.035, 'type': '湖泊'},
            {'name': '国际慢城', 'lat_offset': 0.045, 'lng_offset': -0.028, 'type': '生态区'},
            {'name': '桠溪镇', 'lat_offset': 0.032, 'lng_offset': -0.018, 'type': '乡镇'},
        ],
        'base_aqi': 55,
        'characteristics': '国际慢城，生态优美'
    }
}


class EnhancedNanjingDataCollector:
    """增强南京市传感器数据收集器"""
    
    def __init__(self):
        self.data_dir = "data"
        self.ensure_data_dir()
    
    def ensure_data_dir(self):
        """确保数据目录存在"""
        if not os.path.exists(self.data_dir):
            os.makedirs(self.data_dir)
    
    def generate_sensor_id(self, district: str, location_idx: int, sensor_idx: int) -> str:
        """生成传感器ID"""
        district_code = {
            '玄武区': 'XW', '秦淮区': 'QH', '建邺区': 'JY', '鼓楼区': 'GL',
            '浦口区': 'PK', '栖霞区': 'QX', '雨花台区': 'YH', '江宁区': 'JN',
            '六合区': 'LH', '溧水区': 'LS', '高淳区': 'GC'
        }.get(district, 'NJ')
        
        return f"NJ_{district_code}_{location_idx:02d}_{sensor_idx:02d}"
    
    def calculate_realistic_aqi(self, district: str, location_type: str, hour: int) -> int:
        """计算真实的AQI值"""
        base_aqi = NANJING_DISTRICTS[district]['base_aqi']
        
        # 位置类型影响
        location_factor = {
            '商业区': 1.3, '交通枢纽': 1.4, '工业区': 1.5,
            '居住区': 1.1, '教育区': 1.0, '公园': 0.8,
            '生态区': 0.7, '水域': 0.6, '风景区': 0.65,
            '新区': 0.9, '农业区': 0.6, '县城': 0.8
        }.get(location_type, 1.0)
        
        # 时间影响（早晚高峰）
        if 7 <= hour <= 9 or 17 <= hour <= 19:
            time_factor = 1.2
        elif 22 <= hour or hour <= 5:
            time_factor = 0.8
        else:
            time_factor = 1.0
        
        # 季节影响（10月秋季）
        season_factor = 0.9
        
        # 随机波动
        random_factor = 0.85 + random.random() * 0.3
        
        aqi = int(base_aqi * location_factor * time_factor * season_factor * random_factor)
        return max(15, min(300, aqi))  # 限制在合理范围
    
    def generate_enhanced_sensor_data(self) -> List[Dict[str, Any]]:
        """生成增强的南京市传感器数据"""
        print("🌟 生成南京市详细传感器网络数据...")
        print("=" * 60)
        
        all_sensors = []
        current_hour = datetime.now().hour
        total_sensors = 0
        
        for district, info in NANJING_DISTRICTS.items():
            district_sensors = []
            
            for loc_idx, location in enumerate(info['locations']):
                # 每个重要位置放置2-3个传感器
                sensors_per_location = 3 if location['type'] in ['商业区', '交通枢纽', '新区'] else 2
                
                for sensor_idx in range(sensors_per_location):
                    # 计算传感器坐标（在位置周围小范围分布）
                    base_lat = info['coordinates']['lat'] + location['lat_offset']
                    base_lng = info['coordinates']['lng'] + location['lng_offset']
                    
                    # 传感器间的微小偏移
                    sensor_lat = base_lat + (random.random() - 0.5) * 0.003
                    sensor_lng = base_lng + (random.random() - 0.5) * 0.003
                    
                    # 生成传感器数据
                    aqi = self.calculate_realistic_aqi(district, location['type'], current_hour)
                    pm25 = round(aqi * 0.6 + random.uniform(-8, 8), 1)
                    pm25 = max(5, pm25)
                    
                    sensor_data = {
                        'id': self.generate_sensor_id(district, loc_idx, sensor_idx),
                        'city': 'Nanjing',
                        'city_chinese': '南京',
                        'province': '江苏省',
                        'district': district,
                        'location': f"{location['name']}-{sensor_idx+1}号",
                        'location_type': location['type'],
                        'pm25': pm25,
                        'aqi': aqi,
                        'temperature': round(18 + random.uniform(-3, 4), 1),
                        'humidity': int(60 + random.uniform(-15, 20)),
                        'wind_speed': round(random.uniform(0.5, 6.0), 1),
                        'main_pollutant': 'p2',
                        'status': '异常' if aqi > 100 else '正常',
                        'latitude': round(sensor_lat, 6),
                        'longitude': round(sensor_lng, 6),
                        'lastUpdate': datetime.now().isoformat(),
                        'timestamp': datetime.now().isoformat(),
                        'data_source': 'Enhanced_Nanjing_Network'
                    }
                    
                    district_sensors.append(sensor_data)
                    all_sensors.append(sensor_data)
                    total_sensors += 1
            
            print(f"✅ {district}: {len(district_sensors)}个传感器 (基础AQI: {info['base_aqi']})")
        
        print("=" * 60)
        print(f"🎯 南京市传感器网络创建完成:")
        print(f"   📊 总传感器数量: {total_sensors}个")
        print(f"   🏘️ 覆盖区域: {len(NANJING_DISTRICTS)}个区")
        print(f"   📍 监测点位: {sum(len(info['locations']) for info in NANJING_DISTRICTS.values())}个")
        
        return all_sensors
    
    def save_nanjing_data(self, sensors: List[Dict[str, Any]]) -> None:
        """保存南京市传感器数据"""
        # 按AQI排序
        sorted_sensors = sorted(sensors, key=lambda x: (-int(x['status'] == '异常'), -x['aqi']))
        
        # 统计信息
        total_sensors = len(sorted_sensors)
        abnormal_sensors = len([s for s in sorted_sensors if s['status'] == '异常'])
        average_aqi = round(sum(s['aqi'] for s in sorted_sensors) / total_sensors, 1)
        
        # 按区域统计
        district_stats = {}
        for sensor in sorted_sensors:
            district = sensor['district']
            if district not in district_stats:
                district_stats[district] = {'count': 0, 'abnormal': 0, 'avg_aqi': 0}
            
            district_stats[district]['count'] += 1
            if sensor['status'] == '异常':
                district_stats[district]['abnormal'] += 1
            district_stats[district]['avg_aqi'] += sensor['aqi']
        
        # 计算各区平均值
        for district in district_stats:
            if district_stats[district]['count'] > 0:
                district_stats[district]['avg_aqi'] = round(
                    district_stats[district]['avg_aqi'] / district_stats[district]['count'], 1
                )
        
        # 构建输出数据
        output_data = {
            'update_time': datetime.now().isoformat(),
            'city_focus': '南京市',
            'total_sensors': total_sensors,
            'abnormal_sensors': abnormal_sensors,
            'average_aqi': average_aqi,
            'district_statistics': district_stats,
            'data_source': 'Enhanced_Nanjing_Network',
            'sensors': sorted_sensors
        }
        
        # 保存南京专用数据文件
        nanjing_file = f"{self.data_dir}/nanjing_sensors_detailed.json"
        with open(nanjing_file, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, ensure_ascii=False, indent=2)
        
        # 同步到前端
        frontend_file = "frontend/public/data/nanjing_sensors_detailed.json"
        try:
            os.makedirs(os.path.dirname(frontend_file), exist_ok=True)
            with open(frontend_file, 'w', encoding='utf-8') as f:
                json.dump(output_data, f, ensure_ascii=False, indent=2)
            print(f"✅ 南京数据已同步到前端: {frontend_file}")
        except Exception as e:
            print(f"⚠️ 前端数据同步失败: {e}")
        
        print(f"💾 南京市详细数据已保存: {nanjing_file}")
        print(f"📊 统计: {total_sensors}传感器, 异常{abnormal_sensors}个, 平均AQI:{average_aqi}")
        
        # 显示区域统计
        print(f"\n📍 各区传感器分布:")
        for district, stats in district_stats.items():
            status = "🔴" if stats['abnormal'] > 0 else "🟢"
            print(f"   {status} {district}: {stats['count']}个传感器, 异常{stats['abnormal']}个, 平均AQI:{stats['avg_aqi']}")
    
    def run_nanjing_collection(self):
        """运行南京市数据收集"""
        print("启动南京市环境监测传感器网络数据收集")
        print(f"开始时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print()
        
        # 生成传感器数据
        sensors = self.generate_enhanced_sensor_data()
        
        if sensors:
            print()
            # 保存数据
            self.save_nanjing_data(sensors)
            print()
            # 生成报告
            self.generate_nanjing_report(sensors)
        else:
            print("❌ 未能生成传感器数据")
    
    def generate_nanjing_report(self, sensors: List[Dict[str, Any]]):
        """生成南京市专项报告"""
        print(f"📋 南京市环境监测专项报告")
        print("=" * 50)
        
        # 空气质量最好和最差的区域
        district_quality = {}
        for sensor in sensors:
            district = sensor['district']
            if district not in district_quality:
                district_quality[district] = []
            district_quality[district].append(sensor['aqi'])
        
        # 计算各区平均AQI
        district_avg = {}
        for district, aqis in district_quality.items():
            district_avg[district] = round(sum(aqis) / len(aqis), 1)
        
        # 排序
        best_districts = sorted(district_avg.items(), key=lambda x: x[1])[:3]
        worst_districts = sorted(district_avg.items(), key=lambda x: x[1], reverse=True)[:3]
        
        print("🌟 空气质量最佳区域:")
        for district, avg_aqi in best_districts:
            characteristic = NANJING_DISTRICTS[district]['characteristics']
            print(f"   🟢 {district}: 平均AQI {avg_aqi} - {characteristic}")
        
        print("\n⚠️ 需要关注的区域:")
        for district, avg_aqi in worst_districts:
            characteristic = NANJING_DISTRICTS[district]['characteristics']
            print(f"   🟡 {district}: 平均AQI {avg_aqi} - {characteristic}")
        
        # 传感器密度分析
        print(f"\n📊 传感器网络密度分析:")
        total_locations = sum(len(info['locations']) for info in NANJING_DISTRICTS.values())
        print(f"   📍 监测点位总数: {total_locations}个")
        print(f"   🔢 传感器总数: {len(sensors)}个")
        print(f"   📈 平均密度: {len(sensors)/len(NANJING_DISTRICTS):.1f}个传感器/区")
        
        print(f"\n🎯 南京市环境监测网络特点:")
        print(f"   • 全覆盖: 11个区域全部部署传感器")
        print(f"   • 高密度: 重点区域多传感器布设")
        print(f"   • 精确定位: 精确到具体地标位置")
        print(f"   • 分类管理: 按区域功能差异化监测")


def main():
    """主函数"""
    collector = EnhancedNanjingDataCollector()
    collector.run_nanjing_collection()


if __name__ == "__main__":
    main()
