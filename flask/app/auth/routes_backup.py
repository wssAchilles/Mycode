from flask import render_template, redirect, url_for, flash, request, current_app
from flask import render_template, redirect, url_for, flash, request, current_app
from flask_login import login_user, logout_user, current_user, login_required
from datetime import datetime, timedelta
import os
import secrets
from werkzeug.utils import secure_filename
from app import db
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
    
    return picture_filename

@bp.route('/login', methods=['GET', 'POST'])
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
def register():
from datetime import datetime, timedelta
import os
import secrets
from werkzeug.utils import secure_filename
from app import db
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
    _, f_ext = os.path.splitext(form_avatar.filename)
    avatar_filename = random_hex + f_ext
    
    # 确保上传目录存在
    upload_path = os.path.join(current_app.root_path, 'static', 'img', 'avatars')
    if not os.path.exists(upload_path):
        os.makedirs(upload_path)
    
    # 保存文件
    avatar_path = os.path.join(upload_path, avatar_filename)
    form_avatar.save(avatar_path)
    
    return f'avatars/{avatar_filename}'

@bp.route('/login', methods=['GET', 'POST'])
def login():
    """用户登录"""
    if current_user.is_authenticated:
        return redirect(url_for('main.index'))
    
    form = LoginForm()
    if form.validate_on_submit():
        user = User.query.filter_by(username=form.username.data).first()
        if user is None or not user.check_password(form.password.data):
            flash('用户名或密码错误', 'error')
            return redirect(url_for('auth.login'))
        
        login_user(user, remember=form.remember_me.data)
        next_page = request.args.get('next')
        # 简单的安全检查，避免开放重定向
        if not next_page or next_page.startswith('http'):
            next_page = url_for('main.index')
        return redirect(next_page)
    
    return render_template('auth/login.html', title='登录', form=form)

@bp.route('/logout')
def logout():
    """用户登出"""
    logout_user()
    return redirect(url_for('main.index'))

@bp.route('/register', methods=['GET', 'POST'])
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
        flash('注册成功！请登录。', 'success')
        return redirect(url_for('auth.login'))
    
    return render_template('auth/register.html', title='注册', form=form)

@bp.route('/reset_password_request', methods=['GET', 'POST'])
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
def reset_password(token):
    """重置密码"""
    if current_user.is_authenticated:
        return redirect(url_for('main.index'))
    
    user = User.verify_reset_password_token(token)
    if not user:
        return redirect(url_for('main.index'))
    
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
    """用户个人资料"""
    # 获取用户统计数据
    user_stats = {
        'post_count': Post.query.filter_by(user_id=current_user.id).count(),
        'comment_count': Comment.query.filter_by(user_id=current_user.id).count(),
        'total_views': db.session.query(db.func.sum(Post.views)).filter_by(user_id=current_user.id).scalar() or 0
    }
    
    # 计算加入天数
    days_since_joined = (datetime.utcnow() - current_user.member_since).days
    
    # 获取最近的文章
    recent_posts = Post.query.filter_by(user_id=current_user.id).order_by(
        Post.timestamp.desc()).limit(10).all()
    
    # 获取最近的评论
    recent_comments = Comment.query.filter_by(user_id=current_user.id).order_by(
        Comment.timestamp.desc()).limit(10).all()
    
    return render_template('auth/profile.html', title='个人资料', 
                         user=current_user, user_stats=user_stats,
                         days_since_joined=days_since_joined,
                         recent_posts=recent_posts, recent_comments=recent_comments)

@bp.route('/edit_profile', methods=['GET', 'POST'])
@login_required
def edit_profile():
    """编辑个人资料"""
    try:
        form = EditProfileForm(
            original_username=current_user.username, 
            original_email=current_user.email
        )
        
        # 调试：验证 form 对象是否有 avatar 属性
        if not hasattr(form, 'avatar'):
            print("ERROR: EditProfileForm 缺少 avatar 字段！")
            flash('表单初始化错误，请重试', 'error')
            return redirect(url_for('auth.profile'))
        
        if form.validate_on_submit():
            # 处理头像上传
            if form.avatar.data:
                avatar_file = save_avatar(form.avatar.data)
                if avatar_file:
                    # 删除旧头像文件（如果不是默认头像）
                    if current_user.avatar and current_user.avatar != 'default-avatar.svg':
                        old_avatar_path = os.path.join(current_app.root_path, 'static', 'img', current_user.avatar)
                        if os.path.exists(old_avatar_path):
                            os.remove(old_avatar_path)
                    current_user.avatar = avatar_file
            
            # 更新其他字段
            current_user.username = form.username.data
            current_user.email = form.email.data
            current_user.first_name = form.first_name.data
            current_user.last_name = form.last_name.data
            current_user.bio = form.bio.data
            current_user.location = form.location.data
            current_user.website = form.website.data
            
            # 处理额外的表单字段
            current_user.github = request.form.get('github', '')
            current_user.show_email = 'show_email' in request.form
            current_user.allow_comments = 'allow_comments' in request.form
            current_user.email_notifications = 'email_notifications' in request.form
            db.session.commit()
            flash('个人资料已更新！', 'success')
            return redirect(url_for('auth.profile'))
        elif request.method == 'GET':
            form.username.data = current_user.username
            form.email.data = current_user.email
            form.first_name.data = current_user.first_name
            form.last_name.data = current_user.last_name
            form.bio.data = current_user.bio
            form.location.data = current_user.location
            form.website.data = current_user.website
        
        return render_template('auth/edit_profile.html', title='编辑资料', form=form)
        
    except Exception as e:
        print(f"ERROR in edit_profile: {e}")
        import traceback
        traceback.print_exc()
        flash('编辑资料时发生错误，请重试', 'error')
        return redirect(url_for('auth.profile'))

@bp.route('/change_password', methods=['GET', 'POST'])
@login_required
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
        return {'success': True, 'avatar_url': avatar_url}
    
    except Exception as e:
        print(f"重置头像错误: {e}")
        return {'success': False, 'message': '重置头像失败，请重试'}

@bp.route('/delete-account', methods=['POST'])
@login_required
def delete_account():
    """删除用户账户"""
    try:
        user_id = current_user.id
        username = current_user.username
        
        # 删除用户相关的数据
        # 1. 删除用户的文章
        from app.models import Post
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
        return {'success': True, 'message': '账户已成功删除'}
    
    except Exception as e:
        db.session.rollback()
        print(f"删除账户错误: {e}")
        return {'success': False, 'message': '删除账户失败，请重试'}
