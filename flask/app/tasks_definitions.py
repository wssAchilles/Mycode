"""
Celery 任务定义模块
提供具体的异步任务实现，并在 set_celery_instance() 中注册为 Celery 任务。
"""

from typing import List, Dict, Any
import logging

from flask import current_app, render_template
from flask_mail import Message

# 延迟导入，避免在非应用上下文时报错或循环导入
# 按需在任务执行时使用到 app.mail / app.models

logger = logging.getLogger(__name__)

# Celery 实例与任务占位（供其它模块导入 .delay 调用）
celery_app = None
send_async_email = None
send_password_reset_email_async = None
process_avatar_async = None
cleanup_old_files_async = None
batch_database_operation_async = None


def set_celery_instance(celery):
    """注入 Celery 实例并注册任务。
    调用时机：在 app.tasks.init_celery(app) 中调用。
    """
    global celery_app
    global send_async_email, send_password_reset_email_async
    global process_avatar_async, cleanup_old_files_async, batch_database_operation_async

    celery_app = celery

    # 实际任务实现函数（在 Flask 上下文中运行，由 make_celery 的 ContextTask 保证）
    def _send_async_email(subject: str, sender: str, recipients: List[str], text_body: str = "", html_body: str = "") -> Dict[str, Any]:
        from app import mail
        msg = Message(subject, sender=sender, recipients=recipients)
        msg.body = text_body or ""
        msg.html = html_body or ""
        mail.send(msg)
        logger.info(f"异步邮件已发送至: {recipients}")
        return {"status": "sent", "recipients": recipients}

    def _send_password_reset_email_async(user_id: int) -> Dict[str, Any]:
        from app.models import User
        from app import mail
        user = User.query.get(user_id)
        if not user:
            return {"status": "error", "message": f"User {user_id} not found"}

        token = user.get_reset_password_token()
        subject = "[Flask App] 重置密码"
        sender = current_app.config.get("MAIL_USERNAME")
        text_body = render_template("email/reset_password.txt", user=user, token=token)
        html_body = render_template("email/reset_password.html", user=user, token=token)

        msg = Message(subject, sender=sender, recipients=[user.email])
        msg.body = text_body
        msg.html = html_body
        mail.send(msg)
        logger.info(f"重置密码邮件已发送: user={user.username} ({user.id})")
        return {"status": "sent", "user_id": user_id}

    def _process_avatar_async(user_id: int) -> Dict[str, Any]:
        # 占位实现：这里可添加实际的头像处理逻辑（裁剪/压缩/存储）
        logger.info(f"处理用户头像: user_id={user_id}")
        return {"status": "ok", "user_id": user_id}

    def _cleanup_old_files_async(days: int = 30) -> Dict[str, Any]:
        # 占位实现：可扫描 uploads/ 目录并清理过期文件
        logger.info(f"清理过期文件: > {days} 天")
        cleaned = 0
        return {"status": "ok", "cleaned": cleaned, "days": days}

    def _batch_database_operation_async(operations: List[Dict[str, Any]] | None = None) -> Dict[str, Any]:
        # 占位实现：根据 operations 执行批量数据库操作
        count = len(operations) if operations else 0
        logger.info(f"批量数据库操作: {count} 项")
        return {"status": "ok", "count": count}

    # 注册为 Celery 任务，并将任务对象暴露为模块级变量，供外部 .delay() 调用
    send_async_email = celery.task(name="app.send_async_email")(_send_async_email)
    send_password_reset_email_async = celery.task(name="app.send_password_reset_email_async")(_send_password_reset_email_async)
    process_avatar_async = celery.task(name="app.process_avatar_async")(_process_avatar_async)
    cleanup_old_files_async = celery.task(name="app.cleanup_old_files_async")(_cleanup_old_files_async)
    batch_database_operation_async = celery.task(name="app.batch_database_operation_async")(_batch_database_operation_async)

    logger.info("Celery 任务已注册：send_async_email, send_password_reset_email_async, process_avatar_async, cleanup_old_files_async, batch_database_operation_async")


__all__ = [
    "set_celery_instance",
    "send_async_email",
    "send_password_reset_email_async",
    "process_avatar_async",
    "cleanup_old_files_async",
    "batch_database_operation_async",
]
