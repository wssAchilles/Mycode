import os
from app import create_app, db
from app.models import User, Post, Comment
from flask_migrate import Migrate

app = create_app(os.getenv('FLASK_CONFIG') or 'default')
migrate = Migrate(app, db)

# 初始化 Celery（在应用创建后）
from app import celery

@app.shell_context_processor
def make_shell_context():
    """为flask shell命令提供上下文"""
    return {'db': db, 'User': User, 'Post': Post, 'Comment': Comment, 'celery': celery}

@app.cli.command()
def test():
    """运行单元测试"""
    import unittest
    tests = unittest.TestLoader().discover('tests')
    unittest.TextTestRunner(verbosity=2).run(tests)

@app.cli.command()
def init_db():
    """初始化数据库"""
    db.create_all()
    print('数据库初始化完成')

@app.cli.command()
def create_admin():
    """创建管理员用户"""
    from app.models import User
    admin = User(
        username='admin',
        email='admin@example.com',
        is_admin=True
    )
    admin.set_password('admin123')
    db.session.add(admin)
    db.session.commit()
    print('管理员用户创建完成')

if __name__ == '__main__':
    app.run(debug=True)
