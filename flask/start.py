"""
Flask应用启动脚本
这个脚本会初始化数据库并启动Flask应用程序
"""

import os
from app import create_app, db
from app.models import User, Post, Comment, Category, Tag, MediaFile, MediaFolder

# 创建应用实例
app = create_app(os.getenv('FLASK_CONFIG') or 'development')

# 添加SEO配置
app.config['SITE_DESCRIPTION'] = '您的专业博客想·网站，分享技术文章和开发经验'
app.config['SITE_KEYWORDS'] = 'Python,Flask,博客,技术文章,编程'

# 在应用上下文中创建数据库表
with app.app_context():
    # 创建所有数据库表
    db.create_all()
    
    # 添加sitemap路由
    @app.route('/sitemap.xml')
    def sitemap():
        from flask import make_response, url_for, request
        from datetime import datetime
        from app.models import Post
        
        pages = []
        base_url = request.url_root.rstrip('/')  # 自动获取当前域名
        
        # 添加静态路由
        static_routes = ['/', '/about', '/contact']  # 添加您的静态路由
        for route in static_routes:
            pages.append('<url><loc>' + base_url + route + '</loc><lastmod>' + datetime.now().strftime("%Y-%m-%d") + '</lastmod></url>')
        
        # 添加文章
        posts = Post.query.filter_by(published=True).all()
        for post in posts:
            url = url_for('blog.post', id=post.id, _external=True)
            pages.append('<url><loc>' + url + '</loc><lastmod>' + post.updated_at.strftime("%Y-%m-%d") + '</lastmod></url>')
        
        # 生成sitemap XML
        sitemap_xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
        sitemap_xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        sitemap_xml += '\n'.join(pages) + '\n'
        sitemap_xml += '</urlset>'
        
        response = make_response(sitemap_xml)
        response.headers['Content-Type'] = 'application/xml'
        return response
    
    # 检查是否已有管理员用户
    admin = User.query.filter_by(username='admin').first()
    if not admin:
        # 创建默认管理员用户
        admin = User(
            username='admin',
            email='admin@example.com',
            is_admin=True,
            confirmed=True
        )
        admin.set_password('admin123')
        db.session.add(admin)
        
        # 创建一些示例分类
        categories = [
            Category(name='技术', description='技术相关文章'),
            Category(name='生活', description='生活感悟文章'),
            Category(name='教程', description='教程和指南')
        ]
        for category in categories:
            db.session.add(category)
        
        # 创建一些示例标签
        tags = [
            Tag(name='Python', color='#3776ab'),
            Tag(name='Flask', color='#000000'),
            Tag(name='Web开发', color='#61dafb'),
            Tag(name='后端', color='#4caf50')
        ]
        for tag in tags:
            db.session.add(tag)
        
        # 创建示例文章
        db.session.commit()  # 先提交分类和标签，确保它们有ID
        
        sample_post = Post(
            title='欢迎使用Flask博客系统',
            slug='welcome-to-flask-blog',
            content='''## 系统功能

- 用户认证系统
- 博客发布平台
- 管理后台
- RESTful API
- 响应式前端

## 开始使用

1. 使用管理员账号登录（用户名: admin, 密码: admin123）
2. 访问管理后台进行系统配置
3. 开始发布您的第一篇文章

祝您使用愉快！
            ''',
            summary='这是一个功能完整的Flask Web应用程序示例',
            user_id=admin.id,  # 使用admin用户的ID
            published=True,
            category_id=1  # 技术分类
        )
        db.session.add(sample_post)
        db.session.commit()
        
        # 创建媒体目录结构
        upload_folder = app.config.get('UPLOAD_FOLDER', 'app/static/uploads')
        media_dirs = [
            upload_folder,
            os.path.join(upload_folder, 'media'),
            os.path.join(upload_folder, 'media', 'thumbnails'),
            'logs'
        ]
        
        for dir_path in media_dirs:
            os.makedirs(dir_path, exist_ok=True)
        
        # 创建默认媒体文件夹
        default_folder = MediaFolder.query.filter_by(name='默认').first()
        if not default_folder:
            default_folder = MediaFolder(
                name='默认',
                description='默认文件夹',
                created_by=1
            )
            db.session.add(default_folder)
            db.session.commit()
            print("📂 已创建默认媒体文件夹")
        
        print("✅ 数据库初始化完成！")
        print("📝 管理员账号: admin / admin123")
        print("📁 媒体管理: http://localhost:5000/media/")
        print("🌐 应用地址: http://localhost:5000")
    else:
        print("✅ 数据库已存在，跳过初始化")

if __name__ == '__main__':
    print("🚀 启动Flask应用程序...")
    app.run(debug=True, host='0.0.0.0', port=5000)
