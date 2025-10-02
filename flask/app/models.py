from datetime import datetime
from flask import current_app
from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from app import db, login_manager
import jwt
from time import time
from sqlalchemy import event
import re

# 用户角色关联表
user_roles = db.Table('user_roles',
    db.Column('user_id', db.Integer, db.ForeignKey('user.id'), primary_key=True),
    db.Column('role_id', db.Integer, db.ForeignKey('role.id'), primary_key=True)
)

# 文章标签关联表
post_tags = db.Table('post_tags',
    db.Column('post_id', db.Integer, db.ForeignKey('post.id'), primary_key=True),
    db.Column('tag_id', db.Integer, db.ForeignKey('tag.id'), primary_key=True)
)

class User(UserMixin, db.Model):
    """用户模型"""
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), index=True, unique=True, nullable=False)
    email = db.Column(db.String(120), index=True, unique=True, nullable=False)
    password_hash = db.Column(db.String(128))
    first_name = db.Column(db.String(64))
    last_name = db.Column(db.String(64))
    avatar = db.Column(db.String(200), default='default-avatar.svg')
    bio = db.Column(db.Text)
    location = db.Column(db.String(64))
    website = db.Column(db.String(200))
    github = db.Column(db.String(200))
    member_since = db.Column(db.DateTime, default=datetime.utcnow, index=True)  # 添加索引
    last_seen = db.Column(db.DateTime, default=datetime.utcnow, index=True)     # 添加索引
    last_password_change = db.Column(db.DateTime, default=datetime.utcnow)
    is_admin = db.Column(db.Boolean, default=False, index=True)  # 添加索引用于管理员查询
    confirmed = db.Column(db.Boolean, default=False, index=True)  # 添加索引
    show_email = db.Column(db.Boolean, default=False)
    allow_comments = db.Column(db.Boolean, default=True)
    email_notifications = db.Column(db.Boolean, default=True)
    
    # 关系
    posts = db.relationship('Post', backref='author', lazy='dynamic')
    comments = db.relationship('Comment', backref='author', lazy='dynamic')
    roles = db.relationship('Role', secondary=user_roles, lazy='subquery',
                           backref=db.backref('users', lazy=True))
    
    def set_password(self, password):
        """设置密码"""
        self.password_hash = generate_password_hash(password)
    
    def check_password(self, password):
        """检查密码"""
        return check_password_hash(self.password_hash, password)
    
    def get_reset_password_token(self, expires_in=600):
        """生成重置密码令牌"""
        return jwt.encode(
            {'reset_password': self.id, 'exp': time() + expires_in},
            current_app.config['SECRET_KEY'], algorithm='HS256')
    
    @staticmethod
    def verify_reset_password_token(token):
        """验证重置密码令牌"""
        try:
            id = jwt.decode(token, current_app.config['SECRET_KEY'],
                          algorithms=['HS256'])['reset_password']
        except:
            return
        return User.query.get(id)
    
    def get_confirmation_token(self, expires_in=3600):
        """生成确认邮箱令牌"""
        return jwt.encode(
            {'confirm': self.id, 'exp': time() + expires_in},
            current_app.config['SECRET_KEY'], algorithm='HS256')
    
    def confirm(self, token):
        """确认邮箱"""
        try:
            data = jwt.decode(token, current_app.config['SECRET_KEY'],
                            algorithms=['HS256'])
        except:
            return False
        if data.get('confirm') != self.id:
            return False
        self.confirmed = True
        db.session.add(self)
        return True
    
    def has_role(self, role_name):
        """检查用户是否有指定角色"""
        return any(role.name == role_name for role in self.roles)
    
    def __repr__(self):
        return f'<User {self.username}>'

class Role(db.Model):
    """角色模型"""
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(64), unique=True, nullable=False, index=True)  # 添加索引
    description = db.Column(db.String(255))
    
    def __repr__(self):
        return f'<Role {self.name}>'

class Post(db.Model):
    """文章模型"""
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False, index=True)
    slug = db.Column(db.String(200), unique=True, index=True)
    summary = db.Column(db.Text)
    content = db.Column(db.Text)
    keywords = db.Column(db.String(200))  # SEO关键词
    status = db.Column(db.String(20), default='draft')  # draft/published/archived
    featured = db.Column(db.Boolean, default=False)  # 是否特色文章
    featured_image = db.Column(db.String(255))  # 特色图片路径
    views = db.Column(db.Integer, default=0)
    reading_time = db.Column(db.Integer)  # 阅读时间(分钟)
    published_at = db.Column(db.DateTime, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    category_id = db.Column(db.Integer, db.ForeignKey('category.id'))
    published = db.Column(db.Boolean, default=False, index=True)
    # 外键
    # user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False, index=True)  # 添加索引
    # category_id = db.Column(db.Integer, db.ForeignKey('category.id'), index=True)  # 添加索引
    
    # 关系
    comments = db.relationship('Comment', backref='post', lazy='dynamic',
                             cascade='all, delete-orphan')
    tags = db.relationship('Tag', secondary=post_tags, lazy='subquery',
                          backref=db.backref('posts', lazy=True))
    
    # 复合索引定义
    __table_args__ = (
        db.Index('ix_post_published_timestamp', 'published', 'published_at'),  # 用于首页文章列表
        db.Index('ix_post_category_published', 'category_id', 'published'),  # 用于分类页面
        db.Index('ix_post_user_published', 'user_id', 'published'),         # 用于用户文章列表
        db.Index('ix_post_views_published', 'views', 'published'),          # 用于热门文章
    )
    
    def __repr__(self):
        return f'<Post {self.title}>'

class Category(db.Model):
    """分类模型"""
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(64), unique=True, nullable=False, index=True)  # 添加索引
    description = db.Column(db.Text)
    
    # 关系
    posts = db.relationship('Post', backref='category', lazy='dynamic')
    
    def __repr__(self):
        return f'<Category {self.name}>'

class Tag(db.Model):
    """标签模型"""
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(64), unique=True, nullable=False, index=True)  # 添加索引
    color = db.Column(db.String(7), default='#007bff')  # 颜色代码
    
    def __repr__(self):
        return f'<Tag {self.name}>'

class Comment(db.Model):
    """评论模型"""
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, index=True, default=datetime.utcnow)
    approved = db.Column(db.Boolean, default=True, index=True)  # 添加索引用于过滤已审核评论
    
    # 外键
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False, index=True)  # 添加索引
    post_id = db.Column(db.Integer, db.ForeignKey('post.id'), nullable=False, index=True)  # 添加索引
    parent_id = db.Column(db.Integer, db.ForeignKey('comment.id'), index=True)  # 添加索引
    
    # 自引用关系（回复评论）
    replies = db.relationship('Comment', backref=db.backref('parent', remote_side=[id]),
                             lazy='dynamic')
    
    # 复合索引定义
    __table_args__ = (
        db.Index('ix_comment_post_approved', 'post_id', 'approved'),      # 用于文章评论列表
        db.Index('ix_comment_user_timestamp', 'user_id', 'timestamp'),    # 用于用户评论历史
        db.Index('ix_comment_approved_timestamp', 'approved', 'timestamp'), # 用于管理员审核
    )
    
    def __repr__(self):
        return f'<Comment {self.id}>'

@login_manager.user_loader
def load_user(user_id):
    """加载用户回调函数"""
    return User.query.get(int(user_id))


class MediaFile(db.Model):
    """媒体文件模型"""
    id = db.Column(db.Integer, primary_key=True)
    filename = db.Column(db.String(255), nullable=False)  # 原始文件名
    stored_filename = db.Column(db.String(255), nullable=False, unique=True)  # 存储的唯一文件名
    file_path = db.Column(db.String(500), nullable=False)  # 文件相对路径
    file_url = db.Column(db.String(500), nullable=False)  # 文件访问URL
    file_type = db.Column(db.String(50), nullable=False)  # 文件类型 (image, video, audio, document)
    mime_type = db.Column(db.String(100), nullable=False)  # MIME类型
    file_size = db.Column(db.Integer, nullable=False)  # 文件大小（字节）
    dimensions = db.Column(db.String(50))  # 图片/视频尺寸 (width,height)
    duration = db.Column(db.Integer)  # 视频/音频时长（秒）
    description = db.Column(db.Text)  # 文件描述
    alt_text = db.Column(db.String(255))  # 图片替代文本
    tags = db.Column(db.String(500))  # 标签（逗号分隔）
    
    # 上传信息
    uploaded_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    uploaded_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    
    # 使用统计
    download_count = db.Column(db.Integer, default=0)
    last_accessed = db.Column(db.DateTime)
    
    # 状态
    is_active = db.Column(db.Boolean, default=True, index=True)
    is_public = db.Column(db.Boolean, default=True, index=True)  # 是否公开可见
    
    # 关系
    uploader = db.relationship('User', backref='media_files')
    
    # 复合索引
    __table_args__ = (
        db.Index('ix_media_type_active', 'file_type', 'is_active'),
        db.Index('ix_media_user_uploaded', 'uploaded_by', 'uploaded_at'),
        db.Index('ix_media_public_type', 'is_public', 'file_type'),
    )
    
    def __repr__(self):
        return f'<MediaFile {self.filename}>'
    
    @property
    def is_image(self):
        """是否为图片文件"""
        return self.file_type == 'image'
    
    @property
    def is_video(self):
        """是否为视频文件"""
        return self.file_type == 'video'
    
    @property
    def is_audio(self):
        """是否为音频文件"""
        return self.file_type == 'audio'
    
    @property
    def is_document(self):
        """是否为文档文件"""
        return self.file_type == 'document'
    
    @property
    def formatted_size(self):
        """格式化文件大小"""
        if self.file_size < 1024:
            return f"{self.file_size} B"
        elif self.file_size < 1024 * 1024:
            return f"{self.file_size / 1024:.1f} KB"
        elif self.file_size < 1024 * 1024 * 1024:
            return f"{self.file_size / (1024 * 1024):.1f} MB"
        else:
            return f"{self.file_size / (1024 * 1024 * 1024):.1f} GB"
    
    @property
    def thumbnail_url(self):
        """获取缩略图URL"""
        if self.is_image:
            # 如果是图片，返回原图URL（可以后续添加缩略图生成逻辑）
            return self.file_url
        elif self.is_video:
            # 视频缩略图（可以后续添加视频帧提取逻辑）
            return '/static/img/video-thumbnail.png'
        elif self.is_audio:
            return '/static/img/audio-icon.png'
        else:
            return '/static/img/document-icon.png'
    
    def increment_download_count(self):
        """增加下载计数"""
        self.download_count += 1
        self.last_accessed = datetime.utcnow()
        db.session.commit()
    
    def get_tags_list(self):
        """获取标签列表"""
        if self.tags:
            return [tag.strip() for tag in self.tags.split(',') if tag.strip()]
        return []
    
    def set_tags_list(self, tags_list):
        """设置标签列表"""
        if tags_list:
            self.tags = ','.join([tag.strip() for tag in tags_list if tag.strip()])
        else:
            self.tags = None


class MediaFolder(db.Model):
    """媒体文件夹模型"""
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text)
    parent_id = db.Column(db.Integer, db.ForeignKey('media_folder.id'))
    
    # 创建信息
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # 状态
    is_active = db.Column(db.Boolean, default=True)
    
    # 关系
    creator = db.relationship('User', backref='media_folders')
    parent = db.relationship('MediaFolder', remote_side=[id], backref='subfolders')
    
    def __repr__(self):
        return f'<MediaFolder {self.name}>'
    
    @property
    def full_path(self):
        """获取完整路径"""
        if self.parent:
            return f"{self.parent.full_path}/{self.name}"
        return self.name


class PostMediaFile(db.Model):
    """文章-媒体文件关联表"""
    id = db.Column(db.Integer, primary_key=True)
    post_id = db.Column(db.Integer, db.ForeignKey('post.id'), nullable=False)
    media_file_id = db.Column(db.Integer, db.ForeignKey('media_file.id'), nullable=False)
    usage_type = db.Column(db.String(50), nullable=False)  # featured, content, gallery
    order_index = db.Column(db.Integer, default=0)  # 在文章中的显示顺序
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # 关系
    post = db.relationship('Post', backref='media_associations')
    media_file = db.relationship('MediaFile', backref='post_associations')
    
    # 复合索引
    __table_args__ = (
        db.Index('ix_post_media_usage', 'post_id', 'usage_type'),
        db.Index('ix_post_media_order', 'post_id', 'order_index'),
    )
    
    def __repr__(self):
        return f'<PostMediaFile post={self.post_id} media={self.media_file_id}>'

@event.listens_for(Post, 'before_update')
def before_post_update(mapper, connection, target):
    """
    在更新Post前自动处理slug冲突
    如果slug已存在(除自己外)，自动添加后缀
    """
    if target.slug:
        # 查找是否有其他文章使用了相同的slug
        existing = Post.query.filter(
            Post.slug == target.slug,
            Post.id != target.id
        ).first()
        
        if existing:
            # 如果slug已存在，添加ID后缀
            target.slug = f"{target.slug}-{target.id}"
            # 同时更新updated_at时间戳
            target.updated_at = datetime.utcnow()
