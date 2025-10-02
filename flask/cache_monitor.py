"""
缓存性能监控工具
监控缓存使用情况和性能指标
"""

import time
import psutil
import sys
import os

# 添加项目根目录到Python路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import create_app, cache
from app.models import Post, User, Category
import logging

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('cache_monitor.log'),
        logging.StreamHandler()
    ]
)

logger = logging.getLogger(__name__)

class CacheMonitor:
    """缓存监控器"""
    
    def __init__(self):
        self.app = create_app()
        self.start_time = time.time()
        self.stats = {
            'cache_hits': 0,
            'cache_misses': 0,
            'cache_operations': 0,
            'response_times': []
        }
    
    def test_cache_performance(self):
        """测试缓存性能"""
        with self.app.app_context():
            logger.info("开始缓存性能测试...")
            
            # 测试基本缓存操作
            self._test_basic_cache_operations()
            
            # 测试数据查询缓存
            self._test_data_query_cache()
            
            # 测试并发性能
            self._test_concurrent_performance()
            
            # 生成报告
            self._generate_report()
    
    def _test_basic_cache_operations(self):
        """测试基本缓存操作"""
        logger.info("测试基本缓存操作...")
        
        # 设置操作
        start_time = time.time()
        for i in range(1000):
            cache.set(f'test_key_{i}', f'test_value_{i}', timeout=300)
        set_time = time.time() - start_time
        
        # 获取操作
        start_time = time.time()
        for i in range(1000):
            value = cache.get(f'test_key_{i}')
            if value:
                self.stats['cache_hits'] += 1
            else:
                self.stats['cache_misses'] += 1
        get_time = time.time() - start_time
        
        # 删除操作
        start_time = time.time()
        for i in range(1000):
            cache.delete(f'test_key_{i}')
        delete_time = time.time() - start_time
        
        logger.info(f"SET 操作: 1000次, 耗时: {set_time:.3f}s, 平均: {set_time/1000*1000:.3f}ms")
        logger.info(f"GET 操作: 1000次, 耗时: {get_time:.3f}s, 平均: {get_time/1000*1000:.3f}ms")
        logger.info(f"DELETE 操作: 1000次, 耗时: {delete_time:.3f}s, 平均: {delete_time/1000*1000:.3f}ms")
        
        self.stats['response_times'].extend([set_time, get_time, delete_time])
    
    def _test_data_query_cache(self):
        """测试数据查询缓存"""
        logger.info("测试数据查询缓存...")
        
        try:
            from app.cache_service import get_cached_posts_list, get_cached_categories
            
            # 测试文章列表缓存
            start_time = time.time()
            posts = get_cached_posts_list(page=1, per_page=10)
            posts_time = time.time() - start_time
            logger.info(f"文章列表缓存: 耗时 {posts_time:.3f}s")
            
            # 测试分类缓存
            start_time = time.time()
            categories = get_cached_categories()
            categories_time = time.time() - start_time
            logger.info(f"分类缓存: 耗时 {categories_time:.3f}s")
            
            self.stats['response_times'].extend([posts_time, categories_time])
            
        except Exception as e:
            logger.error(f"数据查询缓存测试失败: {e}")
    
    def _test_concurrent_performance(self):
        """测试并发性能"""
        logger.info("测试并发性能...")
        
        import threading
        import queue
        
        results = queue.Queue()
        
        def worker():
            start_time = time.time()
            for i in range(100):
                cache.set(f'concurrent_key_{threading.current_thread().ident}_{i}', f'value_{i}')
                cache.get(f'concurrent_key_{threading.current_thread().ident}_{i}')
            end_time = time.time()
            results.put(end_time - start_time)
        
        # 创建多个线程
        threads = []
        start_time = time.time()
        
        for i in range(10):  # 10个并发线程
            thread = threading.Thread(target=worker)
            threads.append(thread)
            thread.start()
        
        # 等待所有线程完成
        for thread in threads:
            thread.join()
        
        total_time = time.time() - start_time
        
        # 收集结果
        thread_times = []
        while not results.empty():
            thread_times.append(results.get())
        
        avg_thread_time = sum(thread_times) / len(thread_times) if thread_times else 0
        
        logger.info(f"并发测试: 10个线程, 总耗时: {total_time:.3f}s, 平均线程时间: {avg_thread_time:.3f}s")
        
        # 清理测试数据
        for i in range(10):
            for j in range(100):
                cache.delete(f'concurrent_key_{i}_{j}')
    
    def _generate_report(self):
        """生成性能报告"""
        logger.info("生成性能报告...")
        
        total_time = time.time() - self.start_time
        
        # 系统信息
        memory_info = psutil.virtual_memory()
        cpu_percent = psutil.cpu_percent(interval=1)
        
        report = f"""
================ 缓存性能测试报告 ================
测试时间: {time.strftime('%Y-%m-%d %H:%M:%S')}
总耗时: {total_time:.3f}s

缓存统计:
- 缓存命中: {self.stats['cache_hits']}
- 缓存未命中: {self.stats['cache_misses']}
- 总操作数: {self.stats['cache_hits'] + self.stats['cache_misses']}
- 命中率: {self.stats['cache_hits']/(self.stats['cache_hits'] + self.stats['cache_misses'])*100:.2f}%

性能指标:
- 平均响应时间: {sum(self.stats['response_times'])/len(self.stats['response_times'])*1000:.3f}ms
- 最快响应时间: {min(self.stats['response_times'])*1000:.3f}ms
- 最慢响应时间: {max(self.stats['response_times'])*1000:.3f}ms

系统资源:
- 内存使用率: {memory_info.percent:.1f}%
- CPU使用率: {cpu_percent:.1f}%
- 可用内存: {memory_info.available / (1024**3):.2f}GB

建议:
{'✅ 缓存性能良好' if sum(self.stats['response_times'])/len(self.stats['response_times']) < 0.1 else '⚠️  考虑优化缓存配置'}
{'✅ 命中率理想' if self.stats['cache_hits']/(self.stats['cache_hits'] + self.stats['cache_misses']) > 0.8 else '⚠️  考虑调整缓存策略'}
===============================================
        """
        
        logger.info(report)
        
        # 保存报告到文件
        with open(f'cache_performance_report_{int(time.time())}.txt', 'w', encoding='utf-8') as f:
            f.write(report)
    
    def monitor_realtime(self, duration=60):
        """实时监控缓存使用情况"""
        logger.info(f"开始实时监控缓存使用情况，持续 {duration} 秒...")
        
        start_time = time.time()
        
        while time.time() - start_time < duration:
            try:
                # 获取缓存统计
                if hasattr(cache.cache, '_cache'):
                    redis_client = cache.cache._cache
                    info = redis_client.info()
                    
                    memory_usage = info.get('used_memory_human', 'Unknown')
                    keyspace_hits = info.get('keyspace_hits', 0)
                    keyspace_misses = info.get('keyspace_misses', 0)
                    
                    if keyspace_hits + keyspace_misses > 0:
                        hit_rate = keyspace_hits / (keyspace_hits + keyspace_misses) * 100
                    else:
                        hit_rate = 0
                    
                    logger.info(f"内存使用: {memory_usage}, 命中率: {hit_rate:.2f}%, "
                              f"命中: {keyspace_hits}, 未命中: {keyspace_misses}")
                
                time.sleep(5)  # 每5秒监控一次
                
            except Exception as e:
                logger.error(f"监控失败: {e}")
                break

def main():
    """主函数"""
    import argparse
    
    parser = argparse.ArgumentParser(description='缓存性能监控工具')
    parser.add_argument('--mode', choices=['test', 'monitor'], default='test',
                      help='运行模式: test(性能测试) 或 monitor(实时监控)')
    parser.add_argument('--duration', type=int, default=60,
                      help='监控持续时间(秒)')
    
    args = parser.parse_args()
    
    monitor = CacheMonitor()
    
    if args.mode == 'test':
        monitor.test_cache_performance()
    elif args.mode == 'monitor':
        monitor.monitor_realtime(args.duration)

if __name__ == "__main__":
    main()
