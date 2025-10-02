#!/usr/bin/env python3
"""
数据库迁移脚本
用于处理添加新字段后的数据库更新
"""

from app import create_app, db
from app.models import User, Post, Comment, Category, Tag, Role
from datetime import datetime

def migrate_database():
    """迁移数据库"""
    app = create_app()
    
    with app.app_context():
        print("开始数据库迁移...")
        
        # 删除所有表
        print("删除现有表...")
        db.drop_all()
        
        # 重新创建所有表
        print("创建新表...")
        db.create_all()
        
        # 创建默认角色
        print("创建默认角色...")
        admin_role = Role(name='Admin', description='管理员')
        user_role = Role(name='User', description='普通用户')
        moderator_role = Role(name='Moderator', description='版主')
        
        db.session.add(admin_role)
        db.session.add(user_role)
        db.session.add(moderator_role)
        
        # 创建默认分类
        print("创建默认分类...")
        categories = [
            Category(name='技术', description='技术相关文章'),
            Category(name='生活', description='生活随笔'),
            Category(name='学习', description='学习心得'),
            Category(name='工作', description='工作经验')
        ]
        
        for category in categories:
            db.session.add(category)
        
        # 创建默认标签
        print("创建默认标签...")
        tags = [
            Tag(name='Python'),
            Tag(name='Flask'),
            Tag(name='Web开发'),
            Tag(name='数据库'),
            Tag(name='前端'),
            Tag(name='后端')
        ]
        
        for tag in tags:
            db.session.add(tag)
        
        # 创建管理员账户
        print("创建管理员账户...")
        admin = User(
            username='admin',
            email='admin@example.com',
            first_name='管理员',
            is_admin=True,
            confirmed=True,
            last_password_change=datetime.utcnow(),
            show_email=False,
            allow_comments=True,
            email_notifications=True
        )
        admin.set_password('admin123')
        admin.roles.append(admin_role)
        db.session.add(admin)
        
        # 创建测试用户
        print("创建测试用户...")
        user = User(
            username='testuser',
            email='test@example.com',
            first_name='测试',
            last_name='用户',
            bio='这是一个测试用户',
            confirmed=True,
            last_password_change=datetime.utcnow(),
            show_email=False,
            allow_comments=True,
            email_notifications=True
        )
        user.set_password('test123')
        user.roles.append(user_role)
        db.session.add(user)
        
        # 提交所有更改
        db.session.commit()
        
        print("数据库迁移完成！")
        print("管理员账户: admin / admin123")
        print("测试用户账户: testuser / test123")

if __name__ == '__main__':
    migrate_database()
