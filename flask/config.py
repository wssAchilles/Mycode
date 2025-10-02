import os
from dotenv import load_dotenv

# 加载环境变量
basedir = os.path.abspath(os.path.dirname(__file__))
load_dotenv(os.path.join(basedir, '.env'))

class Config:
    """基础配置类"""
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'dev-secret-key-change-in-production'
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL') or \
        'sqlite:///' + os.path.join(basedir, 'app.db')
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    # 邮件配置
    MAIL_SERVER = os.environ.get('MAIL_SERVER')
    MAIL_PORT = int(os.environ.get('MAIL_PORT') or 587)
    MAIL_USE_TLS = os.environ.get('MAIL_USE_TLS', 'true').lower() in ['true', 'on', '1']
    MAIL_USERNAME = os.environ.get('MAIL_USERNAME')
    MAIL_PASSWORD = os.environ.get('MAIL_PASSWORD')
    
    # Redis配置
    REDIS_URL = os.environ.get('REDIS_URL') or 'redis://localhost:6379/0'
    
    # Celery配置
    CELERY_BROKER_URL = os.environ.get('CELERY_BROKER_URL') or 'redis://localhost:6379/0'
    CELERY_RESULT_BACKEND = os.environ.get('CELERY_RESULT_BACKEND') or 'redis://localhost:6379/0'
    
    # 缓存配置
    CACHE_TYPE = "SimpleCache"  # 使用简单内存缓存，开发环境更稳定
    CACHE_DEFAULT_TIMEOUT = 300  # 5分钟默认超时
    CACHE_KEY_PREFIX = "flask_app:"
    
    # 缓存过期时间配置（秒）
    CACHE_TIMEOUTS = {
        'posts_list': 600,      # 文章列表缓存10分钟
        'hot_posts': 1800,      # 热门文章缓存30分钟
        'user_stats': 3600,     # 用户统计缓存1小时
        'site_stats': 7200,     # 网站统计缓存2小时
        'categories': 14400,    # 分类信息缓存4小时
        'navigation': 21600,    # 导航栏缓存6小时
        'footer': 43200,        # 页脚缓存12小时
    }
    
    # JWT配置
    JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY') or SECRET_KEY
    JWT_ACCESS_TOKEN_EXPIRES = False
    
    # 分页配置
    POSTS_PER_PAGE = 10
    USERS_PER_PAGE = 20
    MEDIA_PER_PAGE = 20
    
    # 文件上传配置
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16MB
    UPLOAD_FOLDER = os.path.join(basedir, 'uploads')
    
    # 媒体文件配置
    MEDIA_UPLOAD_FOLDER = os.path.join(basedir, 'app', 'static', 'uploads', 'media')
    MEDIA_MAX_FILE_SIZE = {
        'image': 10 * 1024 * 1024,      # 10MB
        'video': 100 * 1024 * 1024,     # 100MB  
        'audio': 50 * 1024 * 1024,      # 50MB
        'document': 20 * 1024 * 1024    # 20MB
    }
    MEDIA_ALLOWED_EXTENSIONS = {
        'image': ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'],
        'video': ['mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'webm'],
        'audio': ['mp3', 'wav', 'ogg', 'aac', 'flac'],
        'document': ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'zip', 'rar']
    }
    
    # 缩略图配置
    THUMBNAIL_SIZES = [(150, 150), (300, 300), (600, 600)]
    THUMBNAIL_QUALITY = 85
    
    # 速率限制配置
    RATELIMIT_STORAGE_URL = os.environ.get('REDIS_URL') or 'memory://'
    
    # 查询性能监控配置
    ENABLE_QUERY_MONITORING = os.environ.get('ENABLE_QUERY_MONITORING', 'False').lower() == 'true'
    SLOW_QUERY_THRESHOLD = float(os.environ.get('SLOW_QUERY_THRESHOLD', '0.1'))  # 100ms
    
    # 日志配置
    LOG_TO_STDOUT = os.environ.get('LOG_TO_STDOUT')

    # 安全响应头：内容安全策略（允许模板中使用的外部资源域名）
    # 如需进一步收紧，可将外部依赖改为本地静态资源后，移除相应域名。
    CONTENT_SECURITY_POLICY = (
        "default-src 'self'; "
        "img-src 'self' data: blob:; "
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; "
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; "
        "font-src 'self' data: https://cdnjs.cloudflare.com; "
        "connect-src 'self'; "
        "frame-ancestors 'self'"
    )

class DevelopmentConfig(Config):
    """开发环境配置"""
    DEBUG = True
    ENABLE_QUERY_MONITORING = True  # 开发环境启用查询监控
    
class TestingConfig(Config):
    """测试环境配置"""
    TESTING = True
    SQLALCHEMY_DATABASE_URI = 'sqlite:///:memory:'
    WTF_CSRF_ENABLED = False
    ENABLE_QUERY_MONITORING = False  # 测试环境关闭查询监控

class ProductionConfig(Config):
    """生产环境配置"""
    DEBUG = False
    ENABLE_QUERY_MONITORING = False  # 生产环境默认关闭，可通过环境变量启用

config = {
    'development': DevelopmentConfig,
    'testing': TestingConfig,
    'production': ProductionConfig,
    'default': DevelopmentConfig
}
