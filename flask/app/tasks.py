"""
Celery 异步任务处理模块
提供邮件发送、文件处理等异步任务功能
"""

from celery import Celery
import logging

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def make_celery(app):
    """创建 Celery 实例"""
    celery = Celery(
        app.import_name,
        backend=app.config.get('CELERY_RESULT_BACKEND'),
        broker=app.config.get('CELERY_BROKER_URL')
    )
    
    # 更新 Celery 配置
    celery.conf.update(
        task_serializer='json',
        accept_content=['json'],
        result_serializer='json',
        timezone='Asia/Shanghai',
        enable_utc=True,
        task_track_started=True,
        task_time_limit=30 * 60,  # 30分钟超时
        task_soft_time_limit=25 * 60,  # 25分钟软超时
        worker_prefetch_multiplier=1,
        worker_max_tasks_per_child=1000,
    )
    
    class ContextTask(celery.Task):
        """带有 Flask 应用上下文的任务基类"""
        def __call__(self, *args, **kwargs):
            with app.app_context():
                return self.run(*args, **kwargs)
    
    celery.Task = ContextTask
    return celery

def init_celery(app):
    """初始化 Celery"""
    global celery
    celery = make_celery(app)
    
    # 设置任务定义模块中的 Celery 实例（使用相对导入避免路径解析问题）
    from .tasks_definitions import set_celery_instance
    set_celery_instance(celery)
    
    return celery

# 全局 Celery 实例
celery = None

# 任务状态查询辅助函数
def get_task_status(task_id):
    """获取任务状态"""
    if not celery:
        return {'status': 'error', 'message': 'Celery 未初始化'}
    
    try:
        task = celery.AsyncResult(task_id)
        return {
            'task_id': task_id,
            'status': task.status,
            'result': task.result if task.ready() else None,
            'info': task.info
        }
    except Exception as exc:
        logger.error(f"获取任务状态失败: {str(exc)}")
        return {'status': 'error', 'message': str(exc)}

def cancel_task(task_id):
    """取消任务"""
    if not celery:
        return {'status': 'error', 'message': 'Celery 未初始化'}
    
    try:
        celery.control.revoke(task_id, terminate=True)
        logger.info(f"任务已取消: {task_id}")
        return {'status': 'success', 'message': f'任务 {task_id} 已取消'}
    except Exception as exc:
        logger.error(f"取消任务失败: {str(exc)}")
        return {'status': 'error', 'message': str(exc)}

# 导入任务定义（在文件末尾导入避免循环导入）
def import_tasks():
    """导入任务定义"""
    try:
        from . import tasks_definitions
        return tasks_definitions
    except ImportError as e:
        logger.error(f"导入任务定义失败: {e}")
        return None
