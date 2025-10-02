"""
缓存服务模块
提供数据查询缓存和页面片段缓存功能
"""

from flask import current_app
from app import cache, db
from app.models import User, Post, Comment, Category
from functools import wraps
import hashlib
import json
from datetime import datetime, timedelta
import logging
from sqlalchemy.orm import selectinload

logger = logging.getLogger(__name__)

class CacheService:
    """缓存服务类"""
    
    @staticmethod
    def get_cache_key(prefix, *args, **kwargs):
        """生成缓存键"""
        # 创建一个包含所有参数的字符串
        cache_data = {
            'args': args,
            'kwargs': kwargs,
            'timestamp': datetime.now().strftime('%Y%m%d%H')  # 按小时分组
        }
        cache_str = json.dumps(cache_data, sort_keys=True)
        cache_hash = hashlib.md5(cache_str.encode()).hexdigest()[:8]
        return f"{prefix}:{cache_hash}"
    
    @staticmethod
    def get_timeout(cache_type):
        """获取缓存超时时间"""
        timeouts = current_app.config.get('CACHE_TIMEOUTS', {})
        return timeouts.get(cache_type, 300)  # 默认5分钟

# 装饰器：数据查询缓存
def cached_query(cache_type, timeout=None):
    """
    数据查询缓存装饰器
    
    Args:
        cache_type: 缓存类型，用于获取超时时间
        timeout: 自定义超时时间（秒）
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            # 生成缓存键
            cache_key = CacheService.get_cache_key(f"query_{cache_type}", *args, **kwargs)
            
            # 尝试从缓存获取
            try:
                cached_result = cache.get(cache_key)
                if cached_result is not None:
                    logger.info(f"Cache hit for {cache_key}")
                    return cached_result
            except Exception as e:
                logger.error(f"Cache get error for {cache_key}: {e}")
            
            # 执行原函数
            result = func(*args, **kwargs)
            
            # 存入缓存
            try:
                cache_timeout = timeout or CacheService.get_timeout(cache_type)
                cache.set(cache_key, result, timeout=cache_timeout)
                logger.info(f"Cache set for {cache_key}, timeout: {cache_timeout}s")
            except Exception as e:
                logger.error(f"Cache set error for {cache_key}: {e}")
            
            return result
        return wrapper
    return decorator

# 装饰器：页面片段缓存
def cached_template(cache_type, timeout=None):
    """
    页面片段缓存装饰器
    
    Args:
        cache_type: 缓存类型
        timeout: 自定义超时时间（秒）
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            # 生成缓存键
            cache_key = CacheService.get_cache_key(f"template_{cache_type}", *args, **kwargs)
            
            # 尝试从缓存获取
            try:
                cached_html = cache.get(cache_key)
                if cached_html is not None:
                    logger.info(f"Template cache hit for {cache_key}")
                    return cached_html
            except Exception as e:
                logger.error(f"Template cache get error for {cache_key}: {e}")
            
            # 执行原函数
            html_content = func(*args, **kwargs)
            
            # 存入缓存
            try:
                cache_timeout = timeout or CacheService.get_timeout(cache_type)
                cache.set(cache_key, html_content, timeout=cache_timeout)
                logger.info(f"Template cache set for {cache_key}, timeout: {cache_timeout}s")
            except Exception as e:
                logger.error(f"Template cache set error for {cache_key}: {e}")
            
            return html_content
        return wrapper
    return decorator

# 缓存失效函数
class CacheInvalidation:
    """缓存失效管理"""
    
    @staticmethod
    def invalidate_posts_cache():
        """失效文章相关缓存"""
        patterns = [
            'query_posts_list:*',
            'query_hot_posts:*',
            'template_posts_*:*',
            'query_site_stats:*'
        ]
        CacheInvalidation._delete_by_patterns(patterns)
    
    @staticmethod
    def invalidate_user_cache(user_id=None):
        """失效用户相关缓存"""
        patterns = [
            'query_user_stats:*',
            'query_site_stats:*'
        ]
        if user_id:
            patterns.append(f'query_user_profile:{user_id}:*')
        CacheInvalidation._delete_by_patterns(patterns)
    
    @staticmethod
    def invalidate_post_cache(post_id):
        """清理特定文章缓存"""
        patterns = [
            f'cached_post:{post_id}',
            f'related_posts:{post_id}',
            # 使用通配，因 query 缓存键包含哈希而非明文 post_id
            'query_post_detail:*'
        ]
        CacheInvalidation._delete_by_patterns(patterns)
        logger.info(f"Invalidated cache for post {post_id}")

    @staticmethod
    def invalidate_navigation_cache():
        """失效导航栏缓存"""
        patterns = ['template_navigation:*']
        CacheInvalidation._delete_by_patterns(patterns)
    
    @staticmethod
    def invalidate_all_template_cache():
        """失效所有模板缓存"""
        patterns = ['template_*:*']
        CacheInvalidation._delete_by_patterns(patterns)
    
    @staticmethod
    def _delete_by_patterns(patterns):
        """根据模式删除缓存"""
        try:
            # 获取Redis连接
            redis_client = cache.cache._write_client
            
            for pattern in patterns:
                # 查找匹配的键
                keys = redis_client.keys(f"{current_app.config.get('CACHE_KEY_PREFIX', '')}{pattern}")
                if keys:
                    redis_client.delete(*keys)
                    logger.info(f"Invalidated {len(keys)} cache entries for pattern: {pattern}")
        except Exception as e:
            logger.error(f"Cache invalidation error: {e}")

# 数据查询缓存函数
@cached_query('posts_list')
def get_cached_posts_list(page=1, per_page=10, category=None):
    """获取缓存的文章列表"""
    # 基础查询 + 预加载，避免 N+1
    query = Post.query.filter_by(published=True).options(
        selectinload(Post.author),
        selectinload(Post.category)
    )

    if category:
        # 支持按照分类名称、ID或Category对象进行过滤
        if isinstance(category, str):
            query = query.join(Category).filter(Category.name == category)
        elif isinstance(category, int):
            query = query.filter(Post.category_id == category)
        else:
            query = query.filter_by(category=category)

    # 以发布时间优先，其次创建时间排序，确保没有 published_at 的文章也能稳定排序
    posts = query.order_by(db.func.coalesce(Post.published_at, Post.created_at).desc()).paginate(
        page=page, per_page=per_page, error_out=False
    )

    # 批量统计评论数（仅统计已审核）
    post_ids = [p.id for p in posts.items]
    comment_counts = {}
    if post_ids:
        rows = (
            db.session.query(Comment.post_id, db.func.count(Comment.id))
            .filter(Comment.post_id.in_(post_ids), Comment.approved == True)
            .group_by(Comment.post_id)
            .all()
        )
        comment_counts = {post_id: cnt for post_id, cnt in rows}

    # 转换为可序列化的格式
    return {
        'items': [{
            'id': post.id,
            'title': post.title,
            'slug': post.slug,
            'summary': post.summary,
            'views': post.views,
            'likes': getattr(post, 'likes', 0),
            'featured_image': post.featured_image,
            'published_at': post.published_at.isoformat() if post.published_at else None,
            'created_at': post.created_at.isoformat() if hasattr(post, 'created_at') and post.created_at else None,
            'author': {
                'id': post.author.id if post.author else None,
                'username': post.author.username if post.author else None,
            },
            'category': post.category.name if post.category else None,
            'comment_count': int(comment_counts.get(post.id, 0)),
        } for post in posts.items],
        'total': posts.total,
        'pages': posts.pages,
        'page': posts.page,
        'per_page': posts.per_page,
        'has_prev': posts.has_prev,
        'has_next': posts.has_next,
        'prev_num': posts.prev_num,
        'next_num': posts.next_num,
    }

@cached_query('post_detail')
def get_cached_post_detail(post_id):
    """获取缓存的文章详情"""
    post = Post.query.get_or_404(post_id)
    if not post.published:
        # 未发布不缓存，交由上层处理
        return None

    return {
        'id': post.id,
        'title': post.title,
        'slug': post.slug,
        'content': post.content,
        'summary': post.summary,
        'published_at': post.published_at.isoformat() if post.published_at else None,
        'updated_at': post.updated_at.isoformat() if post.updated_at else None,
        'author': {
            'id': post.author.id if post.author else None,
            'username': post.author.username if post.author else None
        },
        'category': post.category.name if post.category else None,
        'tags': [tag.name for tag in post.tags],
        'views': post.views
    }

@cached_query('hot_posts')
def get_cached_hot_posts(limit=5):
    """获取热门文章（基于评论数）"""
    posts = (
        db.session.query(Post, db.func.count(Comment.id).label('comment_count'))
        .outerjoin(Comment, db.and_(Comment.post_id == Post.id, Comment.approved == True))
        .filter(Post.published == True)
        .options(selectinload(Post.author))
        .group_by(Post.id)
        .order_by(
            db.desc('comment_count'),
            (Post.published_at.desc() if hasattr(Post, 'published_at') else Post.created_at.desc()),
        )
        .limit(limit)
        .all()
    )

    return [
        {
            'id': row.Post.id,
            'title': row.Post.title,
            'comment_count': int(row.comment_count or 0),
            'timestamp': (
                (row.Post.published_at or row.Post.created_at).isoformat()
                if (row.Post.published_at or row.Post.created_at)
                else None
            ),
            'author': {
                'id': row.Post.user_id,
                'username': row.Post.author.username if row.Post.author else 'Unknown',
            },
        }
        for row in posts
    ]

@cached_query('user_stats')
def get_cached_user_stats(user_id):
    """获取用户统计信息"""
    user = User.query.get_or_404(user_id)
    
    stats = {
        'total_posts': user.posts.filter_by(published=True).count(),
        'total_comments': Comment.query.filter_by(user_id=user_id).count(),
        'join_date': user.created_at.isoformat() if hasattr(user, 'created_at') else None,
        'last_seen': user.last_seen.isoformat() if hasattr(user, 'last_seen') and user.last_seen else None
    }
    
    return stats

@cached_query('site_stats')
def get_cached_site_stats():
    """获取网站统计信息"""
    stats = {
        'total_users': User.query.count(),
        'total_posts': Post.query.filter_by(published=True).count(),
        'total_comments': Comment.query.count(),
        'recent_users': User.query.order_by(User.id.desc()).limit(5).count(),
        'updated_at': datetime.now().isoformat()
    }
    
    return stats

@cached_query('categories')
def get_cached_categories():
    """获取分类列表及文章数量"""
    categories = (
        db.session.query(
            Category.id.label('id'),
            Category.name.label('name'),
            db.func.count(Post.id).label('post_count'),
        )
        .join(Post, Post.category_id == Category.id)
        .filter(Post.published == True)
        .group_by(Category.id, Category.name)
        .order_by(db.desc('post_count'))
        .all()
    )

    return [
        {
            'name': cat.name,
            'post_count': int(cat.post_count or 0),
        }
        for cat in categories
    ]

# 模板片段缓存函数
@cached_template('navigation')
def get_cached_navigation(user_authenticated=False):
    """获取缓存的导航栏HTML"""
    from flask import render_template_string
    
    categories = get_cached_categories()
    
    nav_template = """
    <nav class="navbar navbar-expand-lg navbar-dark bg-primary">
        <div class="container">
            <a class="navbar-brand" href="{{ url_for('main.index') }}">Flask Blog</a>
            
            <div class="navbar-nav me-auto">
                <a class="nav-link" href="{{ url_for('main.index') }}">首页</a>
                <div class="nav-item dropdown">
                    <a class="nav-link dropdown-toggle" href="#" role="button" data-bs-toggle="dropdown">
                        分类
                    </a>
                    <ul class="dropdown-menu">
                        {% for category in categories %}
                        <li><a class="dropdown-item" href="{{ url_for('blog.category', name=category.name) }}">
                            {{ category.name }} ({{ category.post_count }})
                        </a></li>
                        {% endfor %}
                    </ul>
                </div>
            </div>
            
            <div class="navbar-nav ms-auto">
                {% if user_authenticated %}
                <a class="nav-link" href="{{ url_for('auth.profile') }}">个人资料</a>
                <a class="nav-link" href="{{ url_for('auth.logout') }}">退出</a>
                {% else %}
                <a class="nav-link" href="{{ url_for('auth.login') }}">登录</a>
                <a class="nav-link" href="{{ url_for('auth.register') }}">注册</a>
                {% endif %}
            </div>
        </div>
    </nav>
    """
    
    return render_template_string(nav_template, categories=categories, user_authenticated=user_authenticated)

@cached_template('footer')
def get_cached_footer():
    """获取缓存的页脚HTML"""
    from flask import render_template_string
    
    site_stats = get_cached_site_stats()
    
    footer_template = """
    <footer class="bg-dark text-light py-4 mt-5">
        <div class="container">
            <div class="row">
                <div class="col-md-6">
                    <h5>Flask Blog</h5>
                    <p>一个现代化的博客平台</p>
                </div>
                <div class="col-md-6">
                    <h6>网站统计</h6>
                    <p>
                        用户: {{ site_stats.total_users }} | 
                        文章: {{ site_stats.total_posts }} | 
                        评论: {{ site_stats.total_comments }}
                    </p>
                    <small class="text-muted">更新时间: {{ site_stats.updated_at[:16] }}</small>
                </div>
            </div>
            <hr>
            <div class="text-center">
                <p>&copy; 2024 Flask Blog. All rights reserved.</p>
            </div>
        </div>
    </footer>
    """
    
    return render_template_string(footer_template, site_stats=site_stats)

@cached_template('sidebar')
def get_cached_sidebar():
    """获取缓存的侧边栏HTML"""
    from flask import render_template_string
    
    hot_posts = get_cached_hot_posts(5)
    categories = get_cached_categories()
    
    sidebar_template = """
    <div class="sidebar">
        <!-- 热门文章 -->
        <div class="card mb-4">
            <div class="card-header">
                <h5>热门文章</h5>
            </div>
            <div class="card-body">
                {% for post in hot_posts %}
                <div class="mb-2">
                    <a href="{{ url_for('blog.post', id=post.id) }}" class="text-decoration-none">
                        {{ post.title }}
                    </a>
                    <small class="text-muted d-block">
                        {{ post.comment_count }} 评论
                    </small>
                </div>
                {% endfor %}
            </div>
        </div>
        
        <!-- 分类统计 -->
        <div class="card mb-4">
            <div class="card-header">
                <h5>分类</h5>
            </div>
            <div class="card-body">
                {% for category in categories %}
                <div class="d-flex justify-content-between">
                    <a href="{{ url_for('blog.category', name=category.name) }}" 
                       class="text-decoration-none">{{ category.name }}</a>
                    <span class="badge bg-secondary">{{ category.post_count }}</span>
                </div>
                {% endfor %}
            </div>
        </div>
    </div>
    """
    
    return render_template_string(sidebar_template, hot_posts=hot_posts, categories=categories)

# 缓存预热函数
def warm_up_cache():
    """缓存预热 - 在应用启动时调用"""
    try:
        logger.info("开始缓存预热...")
        
        # 预热基础数据
        get_cached_site_stats()
        get_cached_categories()
        get_cached_hot_posts()
        
        # 预热首页文章列表
        get_cached_posts_list(page=1, per_page=10)
        
        # 预热模板片段
        get_cached_navigation(False)
        get_cached_navigation(True)
        get_cached_footer()
        get_cached_sidebar()
        
        logger.info("缓存预热完成")
    except Exception as e:
        logger.error(f"缓存预热失败: {e}")

# 定期清理过期缓存的任务（配合Celery使用）
def cleanup_expired_cache():
    """清理过期缓存"""
    try:
        # 获取Redis连接
        redis_client = cache.cache._write_client
        
        # 删除所有过期的键
        # Redis会自动处理过期键，这里主要是记录日志
        info = redis_client.info('keyspace')
        logger.info(f"Redis keyspace info: {info}")
        
        return {"status": "success", "message": "缓存清理完成"}
    except Exception as e:
        logger.error(f"缓存清理失败: {e}")
        return {"status": "error", "message": str(e)}
