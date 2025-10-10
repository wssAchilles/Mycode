# -*- coding: utf-8 -*-
"""
空气质量数据定时收集器

这个脚本负责定时运行数据收集，为前端提供持续更新的数据源。
支持：
1. 定时自动收集数据
2. 数据变化检测和预警
3. 服务状态监控
4. 自动重试机制

运行方式：
python data_collector_scheduler.py

作者: AI Assistant
日期: 2025-10-09
"""

import schedule
import time
import sys
import threading
from datetime import datetime, timedelta
from china_cities_air_quality import ChinaAirQualityService
import json
import os

# 设置stdout编码为utf-8
if sys.platform.startswith('win'):
    import codecs
    sys.stdout = codecs.getwriter("utf-8")(sys.stdout.detach())


class DataCollectorScheduler:
    """数据收集调度器"""
    
    def __init__(self):
        self.service = ChinaAirQualityService()
        self.is_running = True
        self.last_success_time = None
        self.consecutive_failures = 0
        self.max_failures = 3
        
        # 预警阈值
        self.alert_thresholds = {
            'high_aqi_cities': 5,      # 超过5个城市AQI异常时预警
            'average_aqi_increase': 20  # 平均AQI增长超过20时预警
        }
    
    def collect_data_job(self):
        """数据收集任务"""
        try:
            print(f"\n{'='*60}")
            print(f"🕐 定时数据收集开始 - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
            print(f"{'='*60}")
            
            # 执行数据收集
            self.service.run_data_collection()
            
            # 更新成功状态
            self.last_success_time = datetime.now()
            self.consecutive_failures = 0
            
            # 检查数据变化和生成预警
            self.check_data_changes()
            
            print(f"✅ 数据收集成功完成 - {datetime.now().strftime('%H:%M:%S')}")
            
        except Exception as e:
            self.consecutive_failures += 1
            print(f"❌ 数据收集失败 (连续失败{self.consecutive_failures}次): {e}")
            
            if self.consecutive_failures >= self.max_failures:
                print(f"🚨 连续失败次数达到{self.max_failures}次，需要人工检查！")
                self.send_failure_alert()
    
    def check_data_changes(self):
        """检查数据变化并生成预警"""
        try:
            # 读取当前数据
            if not os.path.exists(self.service.current_data_file):
                return
            
            with open(self.service.current_data_file, 'r', encoding='utf-8') as f:
                current_data = json.load(f)
            
            # 读取历史数据
            if not os.path.exists(self.service.history_data_file):
                return
            
            with open(self.service.history_data_file, 'r', encoding='utf-8') as f:
                history_data = json.load(f)
            
            # 分析数据变化
            if len(history_data) >= 2:
                previous_record = history_data[-2]  # 倒数第二条记录
                current_record = history_data[-1]   # 最新记录
                
                # 检查异常城市数量变化
                abnormal_change = current_record['abnormal_cities'] - previous_record['abnormal_cities']
                
                # 检查平均AQI变化
                aqi_change = current_record['average_aqi'] - previous_record['average_aqi']
                
                print(f"\n📊 数据变化分析:")
                print(f"   异常城市数量: {previous_record['abnormal_cities']} → {current_record['abnormal_cities']} ({abnormal_change:+d})")
                print(f"   平均AQI: {previous_record['average_aqi']} → {current_record['average_aqi']} ({aqi_change:+.1f})")
                
                # 生成预警
                alerts = []
                
                if current_record['abnormal_cities'] >= self.alert_thresholds['high_aqi_cities']:
                    alerts.append(f"🔴 高污染预警：{current_record['abnormal_cities']}个城市空气质量异常")
                
                if aqi_change >= self.alert_thresholds['average_aqi_increase']:
                    alerts.append(f"📈 污染加重预警：全国平均AQI上升{aqi_change:.1f}")
                
                if abnormal_change >= 3:
                    alerts.append(f"⚠️ 异常扩散预警：新增{abnormal_change}个异常城市")
                
                if alerts:
                    print(f"\n🚨 自动预警:")
                    for alert in alerts:
                        print(f"   {alert}")
                    
                    # 保存预警记录
                    self.save_alert_record(alerts, current_record)
                else:
                    print(f"✅ 数据变化正常，无需预警")
        
        except Exception as e:
            print(f"❌ 数据变化分析失败: {e}")
    
    def save_alert_record(self, alerts: list, data_record: dict):
        """保存预警记录"""
        try:
            alert_file = f"{self.service.data_dir}/alerts.json"
            
            # 读取现有预警记录
            alert_records = []
            if os.path.exists(alert_file):
                with open(alert_file, 'r', encoding='utf-8') as f:
                    alert_records = json.load(f)
            
            # 添加新预警记录
            new_alert = {
                'timestamp': datetime.now().isoformat(),
                'alerts': alerts,
                'data_snapshot': {
                    'total_cities': data_record['total_cities'],
                    'abnormal_cities': data_record['abnormal_cities'],
                    'average_aqi': data_record['average_aqi']
                }
            }
            
            alert_records.append(new_alert)
            
            # 只保留最近7天的预警记录
            cutoff_time = datetime.now() - timedelta(days=7)
            alert_records = [
                record for record in alert_records
                if datetime.fromisoformat(record['timestamp']) > cutoff_time
            ]
            
            # 保存预警记录
            with open(alert_file, 'w', encoding='utf-8') as f:
                json.dump(alert_records, f, ensure_ascii=False, indent=2)
            
            print(f"💾 预警记录已保存: {len(alerts)}条预警")
            
        except Exception as e:
            print(f"❌ 保存预警记录失败: {e}")
    
    def send_failure_alert(self):
        """发送失败预警"""
        failure_msg = f"""
🚨 数据收集系统故障预警

时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
状态: 连续失败 {self.consecutive_failures} 次
最后成功时间: {self.last_success_time.strftime('%Y-%m-%d %H:%M:%S') if self.last_success_time else '未知'}

建议检查:
1. 网络连接状态
2. API密钥有效性
3. 系统资源使用情况
4. 服务器状态

请及时处理以确保数据服务正常！
        """
        
        print(failure_msg)
        
        # 这里可以集成邮件、短信、钉钉等通知方式
        # 暂时保存到文件
        try:
            with open(f"{self.service.data_dir}/failure_alerts.txt", 'a', encoding='utf-8') as f:
                f.write(failure_msg + "\n" + "="*60 + "\n")
        except:
            pass
    
    def print_system_status(self):
        """打印系统状态"""
        status_lines = [
            f"🖥️  系统状态监控 - {datetime.now().strftime('%H:%M:%S')}",
            f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
            f"📊 运行状态: {'正常' if self.consecutive_failures == 0 else f'异常(连续失败{self.consecutive_failures}次)'}",
            f"⏰ 最后成功: {self.last_success_time.strftime('%H:%M:%S') if self.last_success_time else '未执行'}",
            f"📁 数据目录: {self.service.data_dir}",
            f"🔄 下次收集: {schedule.next_run().strftime('%H:%M:%S')}" if schedule.jobs else "无任务",
        ]
        
        # 检查数据文件
        if os.path.exists(self.service.current_data_file):
            try:
                with open(self.service.current_data_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                status_lines.append(f"📈 最新数据: {data['total_cities']}城市, 异常{data['abnormal_cities']}个, 平均AQI:{data['average_aqi']}")
            except:
                status_lines.append(f"❌ 数据文件读取失败")
        else:
            status_lines.append(f"⚠️ 暂无数据文件")
        
        print("\n".join(status_lines))
    
    def setup_schedule(self):
        """设置定时任务"""
        # 每30分钟收集一次数据
        schedule.every(30).minutes.do(self.collect_data_job)
        
        # 每小时打印一次系统状态
        schedule.every().hour.do(self.print_system_status)
        
        # 可以添加更多定时任务
        # schedule.every().day.at("06:00").do(self.daily_report)  # 每日报告
        # schedule.every().monday.at("09:00").do(self.weekly_summary)  # 周报
        
        print("⏰ 定时任务设置完成:")
        print("   - 每30分钟收集数据")
        print("   - 每小时显示状态")
    
    def run_forever(self):
        """持续运行调度器"""
        print("🚀 空气质量数据收集调度器启动")
        print("=" * 50)
        
        # 立即执行一次数据收集
        print("🔄 执行初次数据收集...")
        self.collect_data_job()
        
        # 设置定时任务
        self.setup_schedule()
        
        print(f"\n✅ 调度器已启动，按 Ctrl+C 停止")
        print(f"📅 当前时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"🔄 下次数据收集: {schedule.next_run().strftime('%Y-%m-%d %H:%M:%S')}")
        
        try:
            while self.is_running:
                schedule.run_pending()
                time.sleep(60)  # 每分钟检查一次
                
        except KeyboardInterrupt:
            print(f"\n⏹️  收到停止信号，正在关闭调度器...")
            self.is_running = False
            
        except Exception as e:
            print(f"❌ 调度器运行异常: {e}")
            
        finally:
            print("👋 数据收集调度器已停止")
    
    def run_once(self):
        """执行一次数据收集（用于测试）"""
        print("🧪 测试模式：执行一次数据收集")
        self.collect_data_job()


if __name__ == "__main__":
    """主程序入口"""
    
    # 检查命令行参数
    if len(sys.argv) > 1 and sys.argv[1] == "--once":
        # 测试模式：只执行一次
        scheduler = DataCollectorScheduler()
        scheduler.run_once()
    else:
        # 正常模式：持续运行
        scheduler = DataCollectorScheduler()
        scheduler.run_forever()
