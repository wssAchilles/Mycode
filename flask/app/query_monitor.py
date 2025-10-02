"""
数据库查询性能监控工具
监控查询执行时间、N+1查询问题、慢查询等
"""

import time
import logging
from functools import wraps
from flask import current_app, g
from sqlalchemy import event
from sqlalchemy.engine import Engine
import sqlite3

# 配置日志
query_logger = logging.getLogger('query_performance')
query_logger.setLevel(logging.INFO)

# 查询统计
query_stats = {
    'total_queries': 0,
    'slow_queries': 0,
    'query_times': [],
    'n_plus_one_detection': []
}

def monitor_queries():
    """启用查询监控"""
    @event.listens_for(Engine, "before_cursor_execute")
    def receive_before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        """查询执行前"""
        context._query_start_time = time.time()
        
        # 存储查询信息用于N+1检测
        if not hasattr(g, 'query_stack'):
            g.query_stack = []
        
        g.query_stack.append({
            'statement': statement,
            'parameters': parameters,
            'start_time': context._query_start_time
        })

    @event.listens_for(Engine, "after_cursor_execute")
    def receive_after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        """查询执行后"""
        if hasattr(context, '_query_start_time'):
            execution_time = time.time() - context._query_start_time
            
            # 更新统计
            query_stats['total_queries'] += 1
            query_stats['query_times'].append(execution_time)
            
            # 检测慢查询 (超过100ms)
            if execution_time > 0.1:
                query_stats['slow_queries'] += 1
                query_logger.warning(f"慢查询检测: {execution_time:.3f}s - {statement[:100]}...")
            
            # 检测N+1查询
            if hasattr(g, 'query_stack') and len(g.query_stack) > 1:
                detect_n_plus_one_queries()
            
            # 记录查询详情（开发环境）
            if current_app.debug:
                query_logger.info(f"查询执行: {execution_time:.3f}s - {statement[:100]}...")

def detect_n_plus_one_queries():
    """检测N+1查询问题"""
    if not hasattr(g, 'query_stack') or len(g.query_stack) < 2:
        return
    
    recent_queries = g.query_stack[-10:]  # 检查最近10个查询
    similar_queries = {}
    
    for query in recent_queries:
        # 简化查询语句进行匹配
        normalized = normalize_query(query['statement'])
        if normalized in similar_queries:
            similar_queries[normalized] += 1
        else:
            similar_queries[normalized] = 1
    
    # 检测重复查询
    for normalized, count in similar_queries.items():
        if count >= 3:  # 3次以上相似查询
            query_stats['n_plus_one_detection'].append({
                'pattern': normalized,
                'count': count,
                'timestamp': time.time()
            })
            query_logger.warning(f"疑似N+1查询: {normalized} 执行了 {count} 次")

def normalize_query(statement):
    """标准化查询语句用于匹配"""
    # 移除参数占位符和具体值
    normalized = statement.lower()
    # 简单的参数替换
    import re
    normalized = re.sub(r'\?\s*', '?', normalized)
    normalized = re.sub(r'=\s*\?', '=?', normalized)
    normalized = re.sub(r'in\s*\([^)]+\)', 'in(?)', normalized)
    return normalized[:100]  # 截取前100字符

def query_performance_decorator(operation_name):
    """查询性能装饰器"""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            start_time = time.time()
            
            # 重置查询栈
            g.query_stack = []
            
            try:
                result = func(*args, **kwargs)
                execution_time = time.time() - start_time
                
                # 记录操作性能
                query_count = len(g.query_stack) if hasattr(g, 'query_stack') else 0
                
                if execution_time > 0.5:  # 操作超过500ms
                    query_logger.warning(
                        f"慢操作: {operation_name} 耗时 {execution_time:.3f}s, "
                        f"执行了 {query_count} 个查询"
                    )
                
                if current_app.debug:
                    query_logger.info(
                        f"操作: {operation_name} 完成, "
                        f"耗时: {execution_time:.3f}s, "
                        f"查询数: {query_count}"
                    )
                
                return result
            finally:
                # 清理查询栈
                if hasattr(g, 'query_stack'):
                    del g.query_stack
        
        return wrapper
    return decorator

class QueryAnalyzer:
    """查询分析器"""
    
    @staticmethod
    def get_performance_stats():
        """获取性能统计"""
        if not query_stats['query_times']:
            return {
                'total_queries': 0,
                'avg_time': 0,
                'max_time': 0,
                'slow_queries': 0,
                'n_plus_one_issues': 0
            }
        
        times = query_stats['query_times']
        return {
            'total_queries': query_stats['total_queries'],
            'avg_time': sum(times) / len(times),
            'max_time': max(times),
            'slow_queries': query_stats['slow_queries'],
            'n_plus_one_issues': len(query_stats['n_plus_one_detection']),
            'slow_query_percentage': (query_stats['slow_queries'] / query_stats['total_queries'] * 100) if query_stats['total_queries'] > 0 else 0
        }
    
    @staticmethod
    def reset_stats():
        """重置统计数据"""
        global query_stats
        query_stats = {
            'total_queries': 0,
            'slow_queries': 0,
            'query_times': [],
            'n_plus_one_detection': []
        }
    
    @staticmethod
    def get_optimization_suggestions():
        """获取优化建议"""
        suggestions = []
        stats = QueryAnalyzer.get_performance_stats()
        
        if stats['slow_query_percentage'] > 10:
            suggestions.append("慢查询比例过高，建议检查索引优化")
        
        if stats['n_plus_one_issues'] > 0:
            suggestions.append("检测到N+1查询问题，建议使用joinedload或selectinload预加载")
        
        if stats['avg_time'] > 0.05:
            suggestions.append("平均查询时间较长，建议优化查询语句和数据库结构")
        
        if stats['total_queries'] > 50:
            suggestions.append("查询数量较多，建议使用缓存减少数据库访问")
        
        return suggestions

def init_query_monitoring(app):
    """初始化查询监控"""
    if app.config.get('ENABLE_QUERY_MONITORING', False):
        monitor_queries()
        app.logger.info("数据库查询监控已启用")
    
    # 添加性能统计路由（仅开发环境）
    if app.debug:
        @app.route('/debug/query-stats')
        def query_stats_debug():
            from flask import jsonify
            stats = QueryAnalyzer.get_performance_stats()
            suggestions = QueryAnalyzer.get_optimization_suggestions()
            
            return jsonify({
                'stats': stats,
                'suggestions': suggestions,
                'recent_n_plus_one': query_stats['n_plus_one_detection'][-5:]  # 最近5个N+1问题
            })

# 常用的优化查询示例
class OptimizedQueries:
    """优化查询示例集合"""
    
    @staticmethod
    @query_performance_decorator("获取文章列表")
    def get_posts_with_author_and_category(page=1, per_page=10):
        """获取文章列表，避免N+1查询"""
        from app.models import Post
        from sqlalchemy.orm import joinedload
        
        return Post.query.options(
            joinedload(Post.author),
            joinedload(Post.category)
        ).filter(
            Post.published == True
        ).order_by(
            Post.timestamp.desc()
        ).paginate(
            page=page,
            per_page=per_page,
            error_out=False
        )
    
    @staticmethod
    @query_performance_decorator("获取文章详情")
    def get_post_with_all_relations(post_id):
        """获取文章详情，预加载所有关联数据"""
        from app.models import Post
        from sqlalchemy.orm import joinedload, selectinload
        
        return Post.query.options(
            joinedload(Post.author),
            joinedload(Post.category),
            selectinload(Post.tags),
            selectinload(Post.comments).joinedload('author')
        ).filter(Post.id == post_id).first()
    
    @staticmethod
    @query_performance_decorator("统计查询")
    def get_aggregate_stats():
        """获取聚合统计，避免多次查询"""
        from app.models import Post, User, Comment
        from sqlalchemy import func
        from app import db
        
        return db.session.query(
            func.count(Post.id).label('total_posts'),
            func.count(User.id).label('total_users'),
            func.count(Comment.id).label('total_comments'),
            func.sum(Post.views).label('total_views')
        ).select_from(Post).outerjoin(User).outerjoin(Comment).first()

# 查询优化建议装饰器
def suggest_optimization(message):
    """查询优化建议装饰器"""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            if current_app.debug:
                query_logger.info(f"优化建议: {message}")
            return func(*args, **kwargs)
        return wrapper
    return decorator
