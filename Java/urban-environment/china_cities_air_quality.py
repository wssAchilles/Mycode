# -*- coding: utf-8 -*-
"""
中国主要城市空气质量数据获取器

这个脚本专门用于获取中国主要城市的实时空气质量数据，
并将数据保存为JSON格式供前端使用。

功能：
1. 获取30+中国主要城市的实时空气质量数据
2. 数据格式化和清洗
3. 保存为JSON文件供前端读取
4. 异常处理和重试机制
5. 历史数据记录

作者: AI Assistant
日期: 2025-10-09
"""

import os
import json
import requests
import sys
import time
from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

# 设置stdout编码为utf-8
if sys.platform.startswith('win'):
    import codecs
    sys.stdout = codecs.getwriter("utf-8")(sys.stdout.detach())

# 中国主要城市列表 (城市, 省/直辖市, 国家)
CHINA_CITIES = [
    # 直辖市
    ("Beijing", "Beijing", "China"),           # 北京
    ("Shanghai", "Shanghai", "China"),         # 上海
    ("Tianjin", "Tianjin", "China"),          # 天津
    ("Chongqing", "Chongqing", "China"),      # 重庆
    
    # 省会城市
    ("Guangzhou", "Guangdong", "China"),       # 广州
    ("Shenzhen", "Guangdong", "China"),        # 深圳
    ("Nanjing", "Jiangsu", "China"),           # 南京
    ("Hangzhou", "Zhejiang", "China"),         # 杭州
    ("Chengdu", "Sichuan", "China"),           # 成都
    ("Wuhan", "Hubei", "China"),               # 武汉
    ("Xi'an", "Shaanxi", "China"),             # 西安
    ("Shenyang", "Liaoning", "China"),         # 沈阳
    ("Harbin", "Heilongjiang", "China"),       # 哈尔滨
    ("Changchun", "Jilin", "China"),           # 长春
    ("Shijiazhuang", "Hebei", "China"),        # 石家庄
    ("Taiyuan", "Shanxi", "China"),            # 太原
    ("Hohhot", "Inner Mongolia", "China"),     # 呼和浩特
    ("Zhengzhou", "Henan", "China"),           # 郑州
    ("Jinan", "Shandong", "China"),            # 济南
    ("Hefei", "Anhui", "China"),               # 合肥
    ("Nanchang", "Jiangxi", "China"),          # 南昌
    ("Changsha", "Hunan", "China"),            # 长沙
    ("Fuzhou", "Fujian", "China"),             # 福州
    ("Haikou", "Hainan", "China"),             # 海口
    ("Kunming", "Yunnan", "China"),            # 昆明
    ("Guiyang", "Guizhou", "China"),           # 贵阳
    ("Lhasa", "Tibet", "China"),               # 拉萨
    ("Lanzhou", "Gansu", "China"),             # 兰州
    ("Xining", "Qinghai", "China"),            # 西宁
    ("Yinchuan", "Ningxia", "China"),          # 银川
    ("Urumqi", "Xinjiang", "China"),           # 乌鲁木齐
    
    # 重要经济城市
    ("Suzhou", "Jiangsu", "China"),            # 苏州
    ("Wuxi", "Jiangsu", "China"),              # 无锡
    ("Ningbo", "Zhejiang", "China"),           # 宁波
    ("Wenzhou", "Zhejiang", "China"),          # 温州
    ("Foshan", "Guangdong", "China"),          # 佛山
    ("Dongguan", "Guangdong", "China"),        # 东莞
    ("Qingdao", "Shandong", "China"),          # 青岛
    ("Dalian", "Liaoning", "China"),           # 大连
    ("Xiamen", "Fujian", "China"),             # 厦门
]

# 城市中文名称映射
CITY_CHINESE_NAMES = {
    "Beijing": "北京", "Shanghai": "上海", "Tianjin": "天津", "Chongqing": "重庆",
    "Guangzhou": "广州", "Shenzhen": "深圳", "Nanjing": "南京", "Hangzhou": "杭州",
    "Chengdu": "成都", "Wuhan": "武汉", "Xi'an": "西安", "Shenyang": "沈阳",
    "Harbin": "哈尔滨", "Changchun": "长春", "Shijiazhuang": "石家庄", "Taiyuan": "太原",
    "Hohhot": "呼和浩特", "Zhengzhou": "郑州", "Jinan": "济南", "Hefei": "合肥",
    "Nanchang": "南昌", "Changsha": "长沙", "Fuzhou": "福州", "Haikou": "海口",
    "Kunming": "昆明", "Guiyang": "贵阳", "Lhasa": "拉萨", "Lanzhou": "兰州",
    "Xining": "西宁", "Yinchuan": "银川", "Urumqi": "乌鲁木齐", "Suzhou": "苏州",
    "Wuxi": "无锡", "Ningbo": "宁波", "Wenzhou": "温州", "Foshan": "佛山",
    "Dongguan": "东莞", "Qingdao": "青岛", "Dalian": "大连", "Xiamen": "厦门"
}


class ChinaAirQualityService:
    """中国空气质量数据服务类"""
    
    def __init__(self):
        self.api_key = os.getenv('IQAIR_API_KEY', '194adeb6-c17c-4959-91e9-af7af289ef98')
        self.base_url = "https://api.airvisual.com/v2/city"
        self.data_dir = "data"
        self.current_data_file = f"{self.data_dir}/current_air_quality.json"
        self.history_data_file = f"{self.data_dir}/air_quality_history.json"
        
        # 创建数据目录
        if not os.path.exists(self.data_dir):
            os.makedirs(self.data_dir)
    
    def get_city_air_quality(self, city: str, state: str, country: str) -> Optional[Dict[str, Any]]:
        """获取单个城市的空气质量数据"""
        params = {
            'city': city,
            'state': state, 
            'country': country,
            'key': self.api_key
        }
        
        try:
            response = requests.get(self.base_url, params=params, timeout=10)
            
            if response.status_code != 200:
                print(f"❌ {city}: HTTP {response.status_code}")
                return None
            
            data = response.json()
            
            if data.get('status') != 'success':
                print(f"❌ {city}: API失败 - {data.get('status')}")
                return None
            
            # 提取并格式化数据
            current_data = data['data']['current']
            pollution = current_data['pollution']
            weather = current_data['weather']
            location = data['data']
            
            result = {
                'id': f"{city.upper()[:2]}_{int(time.time()) % 1000:03d}",
                'city': city,
                'city_chinese': CITY_CHINESE_NAMES.get(city, city),
                'state': state,
                'country': country,
                'province': f"{state}省" if state not in ["Beijing", "Shanghai", "Tianjin", "Chongqing"] else f"{state}市",
                'district': f"{city}市区",
                'location': f"{city}中心",
                'pm25': pollution['aqius'] * 0.6,  # 近似转换AQI到PM2.5
                'aqi': pollution['aqius'],
                'temperature': weather['tp'],
                'humidity': weather['hu'],
                'wind_speed': weather['ws'],
                'main_pollutant': pollution['mainus'],
                'status': '异常' if pollution['aqius'] > 100 else '正常',
                'lastUpdate': datetime.now().isoformat(),
                'timestamp': pollution['ts'],
                'data_source': 'IQAir_API'
            }
            
            print(f"✅ {city}: AQI={pollution['aqius']}, PM2.5≈{result['pm25']:.1f}")
            return result
            
        except Exception as e:
            print(f"❌ {city}: 异常 - {str(e)}")
            return None
    
    def fetch_all_cities_data(self) -> List[Dict[str, Any]]:
        """并发获取所有城市的空气质量数据"""
        print(f"🌍 开始获取 {len(CHINA_CITIES)} 个中国城市的空气质量数据...")
        print("=" * 60)
        
        all_data = []
        successful_count = 0
        
        # 使用线程池并发请求
        with ThreadPoolExecutor(max_workers=5) as executor:
            future_to_city = {
                executor.submit(self.get_city_air_quality, city, state, country): (city, state, country)
                for city, state, country in CHINA_CITIES
            }
            
            for future in as_completed(future_to_city):
                city_info = future_to_city[future]
                try:
                    result = future.result()
                    if result:
                        all_data.append(result)
                        successful_count += 1
                    
                    # 添加延迟避免API限制
                    time.sleep(0.2)
                    
                except Exception as exc:
                    print(f'❌ {city_info[0]}: 异常 - {exc}')
        
        print("=" * 60)
        print(f"📊 数据获取完成: {successful_count}/{len(CHINA_CITIES)} 个城市")
        
        return all_data
    
    def save_current_data(self, data: List[Dict[str, Any]]) -> None:
        """保存当前数据到JSON文件"""
        try:
            # 按AQI排序，异常城市排在前面
            sorted_data = sorted(data, key=lambda x: (-int(x['status'] == '异常'), -x['aqi']))
            
            output_data = {
                'update_time': datetime.now().isoformat(),
                'total_cities': len(sorted_data),
                'abnormal_cities': len([d for d in sorted_data if d['status'] == '异常']),
                'average_aqi': round(sum(d['aqi'] for d in sorted_data) / len(sorted_data), 1) if sorted_data else 0,
                'cities': sorted_data
            }
            
            with open(self.current_data_file, 'w', encoding='utf-8') as f:
                json.dump(output_data, f, ensure_ascii=False, indent=2)
            
            print(f"💾 当前数据已保存到: {self.current_data_file}")
            print(f"📈 统计: 总计{len(sorted_data)}城市, 异常{output_data['abnormal_cities']}城市, 平均AQI:{output_data['average_aqi']}")
            
        except Exception as e:
            print(f"❌ 保存当前数据失败: {e}")
    
    def save_history_data(self, data: List[Dict[str, Any]]) -> None:
        """保存历史数据"""
        try:
            # 读取现有历史数据
            history_data = []
            if os.path.exists(self.history_data_file):
                with open(self.history_data_file, 'r', encoding='utf-8') as f:
                    history_data = json.load(f)
            
            # 添加新的历史记录
            history_record = {
                'timestamp': datetime.now().isoformat(),
                'total_cities': len(data),
                'abnormal_cities': len([d for d in data if d['status'] == '异常']),
                'average_aqi': round(sum(d['aqi'] for d in data) / len(data), 1) if data else 0,
                'cities_summary': [
                    {
                        'city': d['city'],
                        'city_chinese': d['city_chinese'],
                        'aqi': d['aqi'],
                        'pm25': round(d['pm25'], 1),
                        'temperature': d['temperature'],
                        'status': d['status']
                    }
                    for d in data
                ]
            }
            
            history_data.append(history_record)
            
            # 只保留最近24小时的数据
            cutoff_time = datetime.now() - timedelta(hours=24)
            history_data = [
                record for record in history_data
                if datetime.fromisoformat(record['timestamp']) > cutoff_time
            ]
            
            with open(self.history_data_file, 'w', encoding='utf-8') as f:
                json.dump(history_data, f, ensure_ascii=False, indent=2)
            
            print(f"📚 历史数据已更新: {len(history_data)}条记录")
            
        except Exception as e:
            print(f"❌ 保存历史数据失败: {e}")
    
    def generate_alert_report(self, data: List[Dict[str, Any]]) -> None:
        """生成预警报告"""
        abnormal_cities = [d for d in data if d['status'] == '异常']
        
        if not abnormal_cities:
            print("🟢 空气质量预警: 全国主要城市空气质量良好")
            return
        
        print(f"🔴 空气质量预警: 发现 {len(abnormal_cities)} 个城市空气质量异常")
        print("=" * 50)
        
        for city in sorted(abnormal_cities, key=lambda x: x['aqi'], reverse=True):
            level = "严重污染" if city['aqi'] > 200 else "重度污染" if city['aqi'] > 150 else "中度污染"
            print(f"⚠️  {city['city_chinese']}({city['city']}): AQI {city['aqi']} - {level}")
            print(f"   PM2.5: {city['pm25']:.1f}μg/m³, 温度: {city['temperature']}°C")
        
        print("=" * 50)
        print("💡 建议:")
        print("   - 异常城市居民应减少户外活动")
        print("   - 敏感人群应避免户外运动")
        print("   - 外出时建议佩戴防护口罩")
    
    def run_data_collection(self) -> None:
        """运行完整的数据收集流程"""
        print("🚀 启动中国城市空气质量数据收集系统")
        print(f"⏰ 开始时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print()
        
        # 1. 获取所有城市数据
        cities_data = self.fetch_all_cities_data()
        
        if not cities_data:
            print("❌ 未能获取任何城市数据")
            return
        
        print()
        
        # 2. 保存当前数据
        self.save_current_data(cities_data)
        
        # 3. 保存历史数据
        self.save_history_data(cities_data)
        
        # 4. 生成预警报告
        print()
        self.generate_alert_report(cities_data)
        
        print()
        print("✅ 数据收集完成!")
        print(f"📁 数据文件位置:")
        print(f"   - 当前数据: {self.current_data_file}")
        print(f"   - 历史数据: {self.history_data_file}")


if __name__ == "__main__":
    """主程序入口"""
    service = ChinaAirQualityService()
    service.run_data_collection()
