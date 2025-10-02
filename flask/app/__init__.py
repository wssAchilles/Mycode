from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_login import LoginManager
from flask_mail import Mail
from flask_bcrypt import Bcrypt
from flask_jwt_extended import JWTManager
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_wtf.csrf import CSRFProtect
from flask_caching import Cache
from config import config
import logging
from logging.handlers import RotatingFileHandler
import os

# 扩展实例
db = SQLAlchemy()
migrate = Migrate()
login_manager = LoginManager()
mail = Mail()
bcrypt = Bcrypt()
jwt = JWTManager()
cors = CORS()
csrf = CSRFProtect()
cache = Cache()
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["200 per day", "50 per hour"]
)

# Celery 实例（将在create_app中初始化）
celery = None

def create_app(config_name='default'):
    """应用工厂函数"""
    app = Flask(__name__)
    
    # 加载配置
    app.config.from_object(config[config_name])
    
    # 初始化扩展
    db.init_app(app)
    migrate.init_app(app, db)
    login_manager.init_app(app)
    mail.init_app(app)
    bcrypt.init_app(app)
    jwt.init_app(app)
    cors.init_app(app)
    csrf.init_app(app)
    cache.init_app(app)
    limiter.init_app(app)
    
    # 配置limiter存储
    if app.config.get('RATELIMIT_STORAGE_URL') and app.config['RATELIMIT_STORAGE_URL'] != 'memory://':
        limiter.storage_uri = app.config['RATELIMIT_STORAGE_URL']
    
    # 配置登录管理器
    login_manager.login_view = 'auth.login'
    login_manager.login_message = '请先登录访问此页面。'
    login_manager.login_message_category = 'info'
    
    # 初始化查询性能监控
    from app.query_monitor import init_query_monitoring
    init_query_monitoring(app)
    
    # 注册蓝图
    from app.main import bp as main_bp
    app.register_blueprint(main_bp)
    
    from app.auth import bp as auth_bp
    app.register_blueprint(auth_bp, url_prefix='/auth')
    
    from app.api import bp as api_bp
    app.register_blueprint(api_bp, url_prefix='/api/v1')
    # API 多为 JWT 鉴权的 JSON 请求，默认跳过 CSRF（表单路由仍受 CSRF 保护）
    try:
        csrf.exempt(api_bp)
    except Exception:
        # 兼容在测试或某些环境下未启用 CSRF 的情况
        pass
    
    from app.admin import bp as admin_bp
    app.register_blueprint(admin_bp, url_prefix='/admin')
    
    from app.blog import bp as blog_bp
    app.register_blueprint(blog_bp, url_prefix='/blog')
    
    from app.media import bp as media_bp
    app.register_blueprint(media_bp, url_prefix='/media')
    
    # 错误处理器
    from app.errors import bp as errors_bp
    app.register_blueprint(errors_bp)
    
    # 配置日志
    if not app.debug and not app.testing:
        if app.config['LOG_TO_STDOUT']:
            stream_handler = logging.StreamHandler()
            stream_handler.setLevel(logging.INFO)
            app.logger.addHandler(stream_handler)
        else:
            if not os.path.exists('logs'):
                os.mkdir('logs')
            file_handler = RotatingFileHandler('logs/app.log',
                                             maxBytes=10240, backupCount=10)
            file_handler.setFormatter(logging.Formatter(
                '%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]'))
            file_handler.setLevel(logging.INFO)
            app.logger.addHandler(file_handler)
        
        app.logger.setLevel(logging.INFO)
        app.logger.info('Flask应用启动')
    
    # 添加全局模板变量
    @app.context_processor
    def inject_csrf_token():
        from flask_wtf.csrf import generate_csrf
        return dict(csrf_token=generate_csrf)
    
    # 初始化 Celery (如果没有禁用)
    global celery
    if celery is None and not os.getenv('DISABLE_CELERY'):
        try:
            from app.tasks import init_celery
            celery = init_celery(app)
            app.logger.info('Celery 异步任务系统已初始化')
        except Exception as e:
            app.logger.warning(f'Celery 初始化失败: {e}, 继续启动应用...')
            celery = None
    
    # 注册缓存命令
    from app.cache_commands import init_cache_commands
    init_cache_commands(app)
    app.logger.info('缓存管理命令已注册')
    
    # 初始化搜索服务
    try:
        from app.search_service import init_search_service
        init_search_service(app)
        app.logger.info('高级搜索服务已初始化')
        
        # 初始化搜索索引钩子
        from app.search_hooks import init_search_hooks
        init_search_hooks(app)
        app.logger.info('搜索索引钩子已初始化')
        
        # 注册搜索管理命令
        from app.search_commands import init_search_commands
        init_search_commands(app)
        app.logger.info('搜索管理命令已注册')
    except Exception as e:
        app.logger.warning(f'搜索服务初始化失败: {e}, 将使用基础搜索功能...')

    # 全局安全响应头（CSP/HSTS/Referrer-Policy 等）
    @app.after_request
    def set_security_headers(response):
        # 允许通过配置覆盖 CSP
        csp = app.config.get('CONTENT_SECURITY_POLICY') or (
            "default-src 'self'; "
            "img-src 'self' data: blob:; "
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
            "style-src 'self' 'unsafe-inline'; "
            "font-src 'self' data:; "
            "connect-src 'self'; "
            "frame-ancestors 'self'"
        )
        response.headers.setdefault('Content-Security-Policy', csp)
        response.headers.setdefault('X-Content-Type-Options', 'nosniff')
        response.headers.setdefault('X-Frame-Options', 'SAMEORIGIN')
        response.headers.setdefault('Referrer-Policy', 'strict-origin-when-cross-origin')
        response.headers.setdefault('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
        response.headers.setdefault('Cross-Origin-Opener-Policy', 'same-origin')
        response.headers.setdefault('Cross-Origin-Resource-Policy', 'same-origin')
        # HSTS 仅在非调试/测试（通常为 HTTPS）时开启
        if not app.debug and not app.testing:
            response.headers.setdefault('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
        return response

    return app

from app import models
