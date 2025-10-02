import unittest
from unittest.mock import patch, MagicMock
from datetime import datetime

from app import create_app, db, cache
from app.models import User, Post, Category


class ApiPostsTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app('testing')
        self.app_context = self.app.app_context()
        self.app_context.push()
        db.create_all()
        self.client = self.app.test_client()
        # 确保缓存不影响测试
        try:
            cache.clear()
        except Exception:
            pass

        # 创建一个默认用户
        self.user = User(username='alice', email='alice@example.com')
        self.user.set_password('password')
        db.session.add(self.user)
        db.session.commit()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        try:
            cache.clear()
        except Exception:
            pass
        self.app_context.pop()

    def _create_post(self, title='Test Post', published=True, published_at=None, views=0):
        post = Post(
            title=title,
            content='content',
            summary='summary',
            user_id=self.user.id,
            published=published,
            published_at=published_at or datetime.utcnow(),
            views=views,
        )
        db.session.add(post)
        db.session.commit()
        return post

    def test_get_posts_cached_empty(self):
        resp = self.client.get('/api/v1/posts')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()

        # 结构断言
        self.assertIn('posts', data)
        self.assertIn('total', data)
        self.assertIn('pages', data)
        self.assertIn('current_page', data)

        self.assertEqual(data['posts'], [])
        self.assertEqual(data['total'], 0)

    def test_get_posts_cached_with_items(self):
        # 两篇文章：一篇已发布一篇未发布
        p1 = self._create_post(title='Published Post', published=True, views=5)
        _ = self._create_post(title='Draft Post', published=False)

        resp = self.client.get('/api/v1/posts')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()

        # 只返回已发布文章
        self.assertEqual(data['total'], 1)
        self.assertEqual(len(data['posts']), 1)

        item = data['posts'][0]
        # 字段一致性
        for key in ['id', 'title', 'slug', 'summary', 'published_at', 'author', 'views']:
            self.assertIn(key, item)
        self.assertEqual(item['id'], p1.id)
        self.assertEqual(item['title'], 'Published Post')
        self.assertEqual(item['author'], self.user.username)  # 路由层将 dict.author 映射成 username 字符串
        self.assertEqual(item['views'], 5)
        # published_at 为 ISO 字符串
        self.assertIsInstance(item['published_at'], (str, type(None)))

    @patch('app.api.routes.get_search_service')
    def test_get_posts_search_branch_basic(self, mock_get_service):
        # 构造假的搜索服务
        fake_service = MagicMock()
        fake_results = {
            'results': [{
                'id': 101,
                'title': 'Hello World',
                'slug': 'hello-world',
                'summary': 'greeting',
                'timestamp': datetime(2023, 1, 2, 3, 4, 5),
                'author': 'alice',
                'views': 123
            }],
            'total': 1,
            'pages': 1,
            'page': 1,
            'has_prev': False,
            'has_next': False,
            'suggestions': ['hello'],
            'query': 'hello'
        }
        fake_service.search.return_value = fake_results
        mock_get_service.return_value = fake_service

        resp = self.client.get('/api/v1/posts?q=hello')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()

        # 结构断言（搜索分支特有字段）
        for k in ['posts', 'total', 'pages', 'current_page', 'has_prev', 'has_next', 'suggestions', 'query']:
            self.assertIn(k, data)
        self.assertEqual(data['query'], 'hello')
        self.assertEqual(data['total'], 1)
        self.assertEqual(len(data['posts']), 1)

        item = data['posts'][0]
        for key in ['id', 'title', 'slug', 'summary', 'published_at', 'author', 'views']:
            self.assertIn(key, item)
        self.assertEqual(item['id'], 101)
        self.assertEqual(item['title'], 'Hello World')
        self.assertEqual(item['author'], 'alice')
        self.assertEqual(item['views'], 123)
        # 路由将 timestamp -> published_at(ISO)
        self.assertEqual(item['published_at'], '2023-01-02T03:04:05')

    @patch('app.api.routes.get_search_service')
    def test_get_posts_search_branch_with_filters(self, mock_get_service):
        # 构造假的搜索服务并捕获入参
        captured = {}

        class FakeSearchService:
            def search(self, q, page=1, per_page=10, filters=None):
                captured['q'] = q
                captured['page'] = page
                captured['per_page'] = per_page
                captured['filters'] = filters or {}
                return {
                    'results': [],
                    'total': 0,
                    'pages': 0,
                    'page': page,
                    'has_prev': False,
                    'has_next': False,
                    'suggestions': [],
                    'query': q,
                }

        mock_get_service.return_value = FakeSearchService()

        resp = self.client.get('/api/v1/posts?q=flask&category=Tech&author=alice&tags=python,flask')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data['query'], 'flask')

        # 断言 filters 被正确解析并传递
        self.assertEqual(captured['q'], 'flask')
        self.assertEqual(captured['filters'].get('category'), 'Tech')
        self.assertEqual(captured['filters'].get('author'), 'alice')
        # tags 只取第一个
        self.assertEqual(captured['filters'].get('tags'), 'python')

    def test_get_posts_category_filter_by_name(self):
        # 创建分类并关联文章
        tech = Category(name='Tech')
        life = Category(name='Life')
        db.session.add_all([tech, life])
        db.session.commit()

        p1 = self._create_post(title='Tech A', published=True)
        p1.category = tech
        p2 = self._create_post(title='Life A', published=True)
        p2.category = life
        db.session.commit()

        resp = self.client.get('/api/v1/posts?category=Tech')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data['total'], 1)
        self.assertEqual(len(data['posts']), 1)
        self.assertEqual(data['posts'][0]['title'], 'Tech A')

    def test_get_posts_pagination(self):
        # 创建 12 篇已发布文章
        for i in range(12):
            self._create_post(title=f'Post {i+1}', published=True)

        resp = self.client.get('/api/v1/posts?per_page=5&page=2')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data['total'], 12)
        self.assertEqual(data['pages'], 3)
        self.assertEqual(data['current_page'], 2)
        self.assertEqual(len(data['posts']), 5)

    def test_get_post_detail_unpublished_404(self):
        p = self._create_post(title='Hidden', published=False)
        resp = self.client.get(f'/api/v1/posts/{p.id}')
        self.assertEqual(resp.status_code, 404)
        data = resp.get_json()
        self.assertIn('message', data)

    def test_get_post_detail_published_increments_views(self):
        p = self._create_post(title='Visible', published=True, views=0)
        resp = self.client.get(f'/api/v1/posts/{p.id}')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        # 视图字段存在且自增
        self.assertIn('views', data)
        self.assertEqual(data['views'], 1)
        # DB 中也已自增
        refreshed = Post.query.get(p.id)
        self.assertEqual(refreshed.views, 1)
        # 详情字段存在
        for key in ['id', 'title', 'slug', 'content', 'summary', 'published_at', 'author']:
            self.assertIn(key, data)

    @patch('app.api.routes.get_search_service')
    def test_get_posts_search_exception_fallback_to_cached(self, mock_get_service):
        class BoomService:
            def search(self, *args, **kwargs):
                raise RuntimeError('search failed')
        mock_get_service.return_value = BoomService()

        # 准备一篇文章用于回退列表
        self._create_post(title='Fallback', published=True)

        resp = self.client.get('/api/v1/posts?q=anything')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        # 回退结构（不包含 query/suggestions）
        for key in ['posts', 'total', 'pages', 'current_page']:
            self.assertIn(key, data)
        self.assertNotIn('query', data)
        self.assertNotIn('suggestions', data)


if __name__ == '__main__':
    unittest.main(verbosity=2)
