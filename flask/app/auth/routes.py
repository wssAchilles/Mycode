from flask import render_template, redirect, url_for, flash, request, current_app, jsonify
from flask_login import login_user, logout_user, current_user, login_required
from datetime import datetime, timedelta
from urllib.parse import urlparse as url_parse
import os
import secrets
from werkzeug.utils import secure_filename
from app import db, limiter
from app.auth import bp
from app.auth.forms import (LoginForm, RegistrationForm, 
                          ResetPasswordRequestForm, ResetPasswordForm,
                          EditProfileForm, ChangePasswordForm)
from app.models import User, Post, Comment
from app.auth.email import send_password_reset_email

def save_avatar(form_avatar):
    """保存头像文件"""
    if not form_avatar:
        return None
    
    # 生成随机文件名
    random_hex = secrets.token_hex(8)
    filename = secure_filename(form_avatar.filename)
    _, f_ext = os.path.splitext(filename)
    picture_filename = random_hex + f_ext
    picture_path = os.path.join(current_app.root_path, 'static', 'img', picture_filename)
    
    # 保存文件
    form_avatar.save(picture_path)
    
    # 异步处理头像（生成不同尺寸）
    try:
        from app.tasks_definitions import process_avatar_async
        task_id = process_avatar_async.delay(current_user.id, picture_path)
        current_app.logger.info(f'头像处理异步任务已提交: {task_id}')
    except Exception as e:
        current_app.logger.error(f'头像异步处理失败: {str(e)}')
        # 不影响主流程，只记录错误
    
    return picture_filename

@bp.route('/login', methods=['GET', 'POST'])
@limiter.limit("10/minute; 100/hour")
def login():
    """用户登录"""
    if current_user.is_authenticated:
        return redirect(url_for('main.index'))
    
    form = LoginForm()
    if form.validate_on_submit():
        user = User.query.filter_by(username=form.username.data).first()
        if user and user.check_password(form.password.data):
            login_user(user, remember=form.remember_me.data)
            next_page = request.args.get('next')
            if not next_page or url_parse(next_page).netloc != '':
                next_page = url_for('main.index')
            return redirect(next_page)
        flash('用户名或密码错误', 'danger')
    
    return render_template('auth/login.html', title='登录', form=form)

@bp.route('/logout')
def logout():
    """用户登出"""
    logout_user()
    return redirect(url_for('main.index'))

@bp.route('/register', methods=['GET', 'POST'])
@limiter.limit("5/minute; 50/hour")
def register():
    """用户注册"""
    if current_user.is_authenticated:
        return redirect(url_for('main.index'))
    
    form = RegistrationForm()
    if form.validate_on_submit():
        user = User(username=form.username.data, email=form.email.data)
        user.set_password(form.password.data)
        db.session.add(user)
        db.session.commit()
        
        # 异步发送欢迎邮件
        try:
            from app.auth.email import send_welcome_email_async
            task_id = send_welcome_email_async(user)
            current_app.logger.info(f'欢迎邮件异步任务已提交: {task_id} for user: {user.username}')
        except Exception as e:
            current_app.logger.error(f'发送欢迎邮件失败: {str(e)}')
            # 不影响注册流程，只记录错误
        
        flash('注册成功！请登录。欢迎邮件正在发送中。', 'success')
        return redirect(url_for('auth.login'))
    
    return render_template('auth/register.html', title='注册', form=form)

@bp.route('/reset_password_request', methods=['GET', 'POST'])
@limiter.limit("5/minute; 20/hour")
def reset_password_request():
    """重置密码请求"""
    if current_user.is_authenticated:
        return redirect(url_for('main.index'))
    
    form = ResetPasswordRequestForm()
    if form.validate_on_submit():
        user = User.query.filter_by(email=form.email.data).first()
        if user:
            # 使用异步邮件发送
            task_id = send_password_reset_email(user, use_async=True)
            current_app.logger.info(f'重置密码邮件异步任务已提交: {task_id} for user: {user.username}')
        
        # 无论用户是否存在都显示相同消息（安全考虑）
        flash('重置密码邮件已发送，请检查您的邮箱。如果邮件没有到达，请检查垃圾邮件文件夹。', 'info')
        return redirect(url_for('auth.login'))
    
    return render_template('auth/reset_password_request.html',
                         title='重置密码', form=form)

@bp.route('/reset_password/<token>', methods=['GET', 'POST'])
@limiter.limit("10/minute")
def reset_password(token):
    """重置密码"""
    if current_user.is_authenticated:
        return redirect(url_for('main.index'))
    
    user = User.verify_reset_password_token(token)
    if not user:
        flash('重置密码链接无效或已过期', 'danger')
        return redirect(url_for('auth.reset_password_request'))
    
    form = ResetPasswordForm()
    if form.validate_on_submit():
        user.set_password(form.password.data)
        db.session.commit()
        flash('密码重置成功！', 'success')
        return redirect(url_for('auth.login'))
    
    return render_template('auth/reset_password.html', form=form)

@bp.route('/profile')
@login_required
def profile():
    """用户资料页面"""
    page = request.args.get('page', 1, type=int)
    posts = current_user.posts.order_by(Post.created_at.desc()).paginate(
        page=page, per_page=current_app.config['POSTS_PER_PAGE'], error_out=False)
    
    # 获取用户统计信息
    user_stats = {
        'post_count': current_user.posts.count(),
        'comment_count': Comment.query.filter_by(user_id=current_user.id).count(),
        'total_views': sum(post.views for post in current_user.posts) if current_user.posts else 0,
        'member_since': current_user.created_at.strftime('%Y年%m月') if hasattr(current_user, 'created_at') else '未知',
        'last_seen': current_user.last_seen.strftime('%Y-%m-%d %H:%M') if hasattr(current_user, 'last_seen') and current_user.last_seen else '未知'
    }
    
    return render_template('auth/profile.html', title='个人资料', 
                         posts=posts, user=current_user, user_stats=user_stats,
                         recent_posts=posts.items)

@bp.route('/edit_profile', methods=['GET', 'POST'])
@login_required
@limiter.limit("15/minute")
def edit_profile():
    """编辑用户资料"""
    try:
        # 创建表单实例，传入当前用户信息
        form = EditProfileForm(obj=current_user)
        
        if form.validate_on_submit():
            # 更新基本信息
            current_user.username = form.username.data
            current_user.email = form.email.data
            current_user.bio = form.bio.data if hasattr(form, 'bio') and form.bio else ''
            
            # 处理头像上传
            if hasattr(form, 'avatar') and form.avatar and form.avatar.data:
                try:
                    # 删除旧头像
                    if current_user.avatar and current_user.avatar != 'default-avatar.svg':
                        old_avatar_path = os.path.join(current_app.root_path, 'static', 'img', current_user.avatar)
                        if os.path.exists(old_avatar_path):
                            os.remove(old_avatar_path)
                    
                    # 保存新头像
                    avatar_filename = save_avatar(form.avatar.data)
                    if avatar_filename:
                        current_user.avatar = avatar_filename
                        flash('头像上传成功！正在后台处理不同尺寸...', 'success')
                
                except Exception as avatar_exc:
                    print(f"头像处理错误: {avatar_exc}")
                    flash('头像上传失败，请重试', 'error')
            
            # 保存到数据库
            db.session.commit()
            flash('资料更新成功！', 'success')
            return redirect(url_for('auth.profile'))
        
        return render_template('auth/edit_profile.html', title='编辑资料', form=form)
        
    except Exception as e:
        print(f"ERROR in edit_profile: {e}")
        import traceback
        traceback.print_exc()
        flash('编辑资料时发生错误，请重试', 'error')
        return redirect(url_for('auth.profile'))

@bp.route('/change_password', methods=['GET', 'POST'])
@login_required
@limiter.limit("5/minute; 30/hour")
def change_password():
    """修改密码"""
    form = ChangePasswordForm()
    
    if form.validate_on_submit():
        # 验证当前密码
        if not current_user.check_password(form.old_password.data):
            flash('当前密码不正确，请重新输入。', 'error')
            return render_template('auth/change_password.html', title='修改密码', form=form)
        
        # 更新密码
        current_user.set_password(form.password.data)
        current_user.last_password_change = datetime.utcnow()
        db.session.commit()
        
        flash('密码已成功修改！为了安全，建议您重新登录。', 'success')
        return redirect(url_for('auth.profile'))
    
    return render_template('auth/change_password.html', title='修改密码', form=form)

@bp.route('/reset-avatar', methods=['POST'])
@login_required
@limiter.limit("10/minute")
def reset_avatar():
    """重置头像为默认头像"""
    try:
        # 如果用户有自定义头像，删除文件
        if current_user.avatar and current_user.avatar != 'default-avatar.svg':
            old_avatar_path = os.path.join(current_app.root_path, 'static', 'img', current_user.avatar)
            if os.path.exists(old_avatar_path):
                os.remove(old_avatar_path)
        
        # 重置为默认头像
        current_user.avatar = 'default-avatar.svg'
        db.session.commit()
        
        avatar_url = url_for('static', filename='img/default-avatar.svg')
        return jsonify({'success': True, 'avatar_url': avatar_url})
    
    except Exception as e:
        print(f"重置头像错误: {e}")
        return jsonify({'success': False, 'message': '重置头像失败，请重试'})

@bp.route('/delete-account', methods=['POST'])
@login_required
@limiter.limit("2/minute; 10/hour")
def delete_account():
    """删除用户账户"""
    try:
        user_id = current_user.id
        username = current_user.username
        user_email = current_user.email
        
        # 异步发送账户删除确认邮件
        try:
            from app.auth.email import send_account_deletion_confirmation_async
            task_id = send_account_deletion_confirmation_async(current_user)
            current_app.logger.info(f'账户删除确认邮件异步任务已提交: {task_id}')
        except Exception as email_exc:
            current_app.logger.error(f'发送删除确认邮件失败: {str(email_exc)}')
        
        # 删除用户相关的数据
        # 1. 删除用户的文章
        user_posts = Post.query.filter_by(user_id=user_id).all()
        for post in user_posts:
            db.session.delete(post)
        
        # 2. 删除用户的评论
        user_comments = Comment.query.filter_by(user_id=user_id).all()
        for comment in user_comments:
            db.session.delete(comment)
        
        # 3. 删除头像文件（如果不是默认头像）
        if current_user.avatar and current_user.avatar != 'default-avatar.svg':
            old_avatar_path = os.path.join(current_app.root_path, 'static', 'img', current_user.avatar)
            if os.path.exists(old_avatar_path):
                os.remove(old_avatar_path)
        
        # 4. 删除用户账户
        db.session.delete(current_user)
        db.session.commit()
        
        # 登出用户
        logout_user()
        
        print(f"用户账户已删除: {username} (ID: {user_id})")
        return jsonify({'success': True, 'message': '账户已成功删除'})
    
    except Exception as e:
        db.session.rollback()
        print(f"删除账户错误: {e}")
        return jsonify({'success': False, 'message': '删除账户失败，请重试'})

# 新增：任务状态查询API
@bp.route('/task-status/<task_id>')
@login_required  
@limiter.limit("60/minute")
def task_status(task_id):
    """查询异步任务状态"""
    try:
        from app.tasks import get_task_status
        status = get_task_status(task_id)
        return jsonify(status)
    except Exception as e:
        current_app.logger.error(f'查询任务状态失败: {str(e)}')
        return jsonify({'status': 'error', 'message': str(e)})

@bp.route('/cancel-task/<task_id>', methods=['POST'])
@login_required
@limiter.limit("10/minute")
def cancel_task_route(task_id):
    """取消异步任务"""
    try:
        from app.tasks import cancel_task
        result = cancel_task(task_id)
        return jsonify(result)
    except Exception as e:
        current_app.logger.error(f'取消任务失败: {str(e)}')
        return jsonify({'status': 'error', 'message': str(e)})

@bp.route('/post/<int:post_id>/comments')
@login_required
@limiter.limit("60/minute")
def post_comments(post_id):
    """文章评论"""
    post = Post.query.get_or_404(post_id)
    page = request.args.get('page', 1, type=int)
    comments = Comment.query.order_by(Comment.timestamp.desc()).filter_by(post_id=post.id).paginate(
        page=page, per_page=10, error_out=False)
    return render_template('auth/post_comments.html', title='文章评论', 
                         comments=comments, post=post, page=page)
