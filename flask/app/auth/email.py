from flask import render_template, current_app
from flask_mail import Message
from app import mail

def send_email(subject, sender, recipients, text_body, html_body):
    """同步发送邮件（保留用于紧急情况）"""
    msg = Message(subject, sender=sender, recipients=recipients)
    msg.body = text_body
    msg.html = html_body
    mail.send(msg)

def send_email_async(subject, sender, recipients, text_body, html_body):
    """异步发送邮件"""
    from ..tasks_definitions import send_async_email
    
    # 提交异步任务
    task = send_async_email.delay(subject, sender, recipients, text_body, html_body)
    current_app.logger.info(f'异步邮件任务已提交: {task.id}')
    return task.id

def send_password_reset_email(user, use_async=True):
    """发送重置密码邮件
    
    Args:
        user: 用户对象
        use_async: 是否使用异步发送，默认True
    
    Returns:
        task_id: 异步任务ID（如果use_async=True）
        None: 同步发送（如果use_async=False）
    """
    if use_async:
        # 使用异步任务
        from ..tasks_definitions import send_password_reset_email_async
        task = send_password_reset_email_async.delay(user.id)
        current_app.logger.info(f'异步重置密码邮件任务已提交: {task.id} for user: {user.username}')
        return task.id
    else:
        # 同步发送（紧急情况下使用）
        token = user.get_reset_password_token()
        send_email('[Flask App] 重置密码',
                   sender=current_app.config['MAIL_USERNAME'],
                   recipients=[user.email],
                   text_body=render_template('email/reset_password.txt',
                                           user=user, token=token),
                   html_body=render_template('email/reset_password.html',
                                           user=user, token=token))
        current_app.logger.info(f'同步重置密码邮件已发送给用户: {user.username}')
        return None

def send_welcome_email_async(user):
    """发送欢迎邮件（异步）"""
    subject = '[Flask App] 欢迎加入！'
    sender = current_app.config['MAIL_USERNAME']
    recipients = [user.email]
    
    text_body = render_template('email/welcome.txt', user=user)
    html_body = render_template('email/welcome.html', user=user)
    
    return send_email_async(subject, sender, recipients, text_body, html_body)

def send_account_deletion_confirmation_async(user):
    """发送账户删除确认邮件（异步）"""
    subject = '[Flask App] 账户删除确认'
    sender = current_app.config['MAIL_USERNAME']
    recipients = [user.email]
    
    text_body = render_template('email/account_deleted.txt', user=user)
    html_body = render_template('email/account_deleted.html', user=user)
    
    return send_email_async(subject, sender, recipients, text_body, html_body)
