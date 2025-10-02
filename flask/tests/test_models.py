import unittest
from app import create_app, db
from app.models import User, Post


class UserModelCase(unittest.TestCase):
    def setUp(self):
        self.app = create_app('testing')
        self.app_context = self.app.app_context()
        self.app_context.push()
        db.create_all()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        self.app_context.pop()

    def test_password_hashing(self):
        """测试密码哈希"""
        u = User(username='test', email='test@example.com')
        u.set_password('password')
        self.assertFalse(u.check_password('wrong'))
        self.assertTrue(u.check_password('password'))

    def test_user_creation(self):
        """测试用户创建"""
        u = User(username='test', email='test@example.com')
        u.set_password('password')
        db.session.add(u)
        db.session.commit()
        
        self.assertEqual(User.query.count(), 1)
        user = User.query.first()
        self.assertEqual(user.username, 'test')
        self.assertEqual(user.email, 'test@example.com')

    def test_post_creation(self):
        """测试文章创建"""
        u = User(username='test', email='test@example.com')
        u.set_password('password')
        db.session.add(u)
        db.session.commit()
        
        p = Post(title='Test Post', content='Test content', user_id=u.id)
        db.session.add(p)
        db.session.commit()
        
        self.assertEqual(Post.query.count(), 1)
        post = Post.query.first()
        self.assertEqual(post.title, 'Test Post')
        self.assertEqual(post.author, u)

if __name__ == '__main__':
    unittest.main(verbosity=2)
