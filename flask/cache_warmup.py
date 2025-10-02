#!/usr/bin/env python
"""
缓存预热脚本
用于在应用启动后预热常用缓存，提高首次访问性能
"""

import sys
import os

# 添加项目根目录到Python路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import create_app, db
from app.cache_service import CacheWarmup
from app.models import Post, Category, User
import time

def warm_up_caches():
    """预热缓存"""
    app = create_app()
    
    with app.app_context():
        print("开始缓存预热...")
        start_time = time.time()
        
        try:
            # 预热文章列表缓存
            print("- 预热文章列表缓存...")
            CacheWarmup.warm_posts_cache()
            
            # 预热分类缓存
            print("- 预热分类缓存...")
            CacheWarmup.warm_categories_cache()
            
            # 预热热门文章缓存
            print("- 预热热门文章缓存...")
            CacheWarmup.warm_hot_posts_cache()
            
            # 预热用户统计缓存
            print("- 预热用户统计缓存...")
            users = User.query.limit(10).all()
            for user in users:
                CacheWarmup.warm_user_stats_cache(user.id)
            
            # 预热最新文章缓存（首页）
            print("- 预热最新文章缓存...")
            for page in range(1, 4):  # 预热前3页
                try:
                    from app.cache_service import get_cached_posts_list
                    get_cached_posts_list(page=page, per_page=5)
                except Exception as e:
                    print(f"  预热第{page}页失败: {e}")
            
            end_time = time.time()
            print(f"缓存预热完成！耗时: {end_time - start_time:.2f} 秒")
            
        except Exception as e:
            print(f"缓存预热失败: {e}")
            return False
            
        return True

if __name__ == "__main__":
    success = warm_up_caches()
    sys.exit(0 if success else 1)
