#!/usr/bin/env python3
"""
Celery Worker 启动脚本
用于启动 Celery worker 进程处理异步任务
"""

import os
import sys
sys.path.append('.')

from app import create_app
from app.tasks import init_celery

def start_worker():
    """启动 Celery worker"""
    # 创建 Flask 应用
    app = create_app(os.getenv('FLASK_CONFIG') or 'default')
    
    # 初始化 Celery
    celery = init_celery(app)
    
    print("Celery Worker 已启动，等待任务...")
    print("可用任务:")
    print("- send_async_email: 异步发送邮件")
    print("- send_password_reset_email_async: 异步发送重置密码邮件") 
    print("- process_avatar_async: 异步处理头像")
    print("- cleanup_old_files_async: 异步清理旧文件")
    print("- batch_database_operation_async: 异步批量数据库操作")
    print("\n按 Ctrl+C 停止worker...")
    
    # 启动 worker
    celery.worker_main(['worker', '--loglevel=info', '--concurrency=2'])

if __name__ == '__main__':
    start_worker()
