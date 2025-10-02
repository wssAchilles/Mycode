from flask import render_template, request, current_app, flash, redirect, url_for, jsonify
from app.main import bp
from app.models import Post, User, Category
from app.cache_service import get_cached_posts_list, get_cached_site_stats, get_cached_hot_posts
from app.query_optimization import QueryOptimization
from datetime import datetime

@bp.route('/')
@bp.route('/index')
def index():
    """首页 - 使用缓存和查询优化"""
    page = request.args.get('page', 1, type=int)
    per_page = current_app.config.get('POSTS_PER_PAGE', 5)
    
    # 首先尝试使用缓存获取文章列表
    try:
        cached_posts = get_cached_posts_list(page=page, per_page=per_page)

        # 创建分页对象的模拟（与博客首页保持一致的代理实现）
        class CachedPagination:
            def __init__(self, data):
                # 轻量代理，提供模板所需属性与方法
                class AuthorProxy:
                    def __init__(self, d):
                        self.id = (d or {}).get('id')
                        self.username = (d or {}).get('username')

                class CategoryProxy:
                    def __init__(self, name):
                        self.name = name

                class CommentsProxy:
                    def __init__(self, n):
                        self._n = int(n or 0)
                    def count(self):
                        return self._n

                class PostProxy:
                    def __init__(self, d):
                        self.id = d.get('id')
                        self.title = d.get('title')
                        self.slug = d.get('slug')
                        self.summary = d.get('summary')
                        self.views = d.get('views', 0)
                        # 列表页缺省没有content，使用summary回退，避免模板切片报错
                        self.content = d.get('summary') or ''
                        # 时间字段转换，供strftime使用
                        ts = d.get('published_at')
                        try:
                            self.published_at = datetime.fromisoformat(ts) if ts else None
                        except Exception:
                            self.published_at = None
                        cs = d.get('created_at')
                        try:
                            self.created_at = datetime.fromisoformat(cs) if cs else None
                        except Exception:
                            self.created_at = None
                        # 关联
                        self.author = AuthorProxy(d.get('author'))
                        cat_name = d.get('category')
                        self.category = CategoryProxy(cat_name) if cat_name else None
                        self.comments = CommentsProxy(d.get('comment_count', 0))
                        # 可选字段
                        self.featured_image = d.get('featured_image') if isinstance(d, dict) else None
                        self.likes = d.get('likes', 0)

                self.items = [PostProxy(item) for item in (data.get('items') or [])]
                self.total = data.get('total', 0)
                self.pages = data.get('pages', 1)
                self.page = data.get('page', 1)
                self.per_page = data.get('per_page', per_page)
                self.has_prev = data.get('has_prev', False)
                self.has_next = data.get('has_next', False)
                # 缓存未提供prev_num/next_num时自行计算
                self.prev_num = self.page - 1 if self.has_prev and self.page > 1 else None
                self.next_num = self.page + 1 if self.has_next and self.page < self.pages else None

            # 模拟Flask-SQLAlchemy Pagination.iter_pages 接口
            def iter_pages(self, left_edge=2, left_current=2, right_current=5, right_edge=2):
                last = 0
                for num in range(1, (self.pages or 0) + 1):
                    if (
                        num <= left_edge
                        or (num > self.page - left_current - 1 and num < self.page + right_current)
                        or num > (self.pages - right_edge)
                    ):
                        if last + 1 != num:
                            yield None
                        yield num
                        last = num

        posts = CachedPagination(cached_posts)

        # 获取热门文章用于侧边栏
        hot_posts = get_cached_hot_posts(5)
        
    except Exception as e:
        current_app.logger.error(f"缓存获取失败，使用优化查询: {e}")
        # 缓存失败时使用优化的数据库查询
        posts = QueryOptimization.get_posts_with_relations(
            page=page, 
            per_page=per_page,
            published_only=True,
            order_by='timestamp'
        )
        # 获取热门文章
        hot_posts = QueryOptimization.get_popular_posts(5, 30)
    
    return render_template('index.html', title='首页', posts=posts, hot_posts=hot_posts)

@bp.route('/about')
def about():
    """关于页面"""
    return render_template('about.html', title='关于我们')

@bp.route('/contact', methods=['GET', 'POST'])
def contact():
    """联系页面"""
    if request.method == 'POST':
        # 获取表单数据
        name = request.form.get('name')
        email = request.form.get('email')
        phone = request.form.get('phone')
        subject = request.form.get('subject')
        message = request.form.get('message')
        
        # 简单验证
        if not all([name, email, subject, message]):
            flash('请填写所有必填字段', 'error')
            return render_template('contact.html', title='联系我们')
        
        # 这里可以添加发送邮件或保存到数据库的逻辑
        # 目前只是显示成功消息
        flash(f'感谢您的消息，{name}！我们会尽快回复您。', 'success')
        return redirect(url_for('main.contact'))
    
    return render_template('contact.html', title='联系我们')

@bp.route('/search')
def search():
    """高级搜索页面 - 使用全文搜索引擎"""
    query = request.args.get('q', '').strip()
    page = request.args.get('page', 1, type=int)
    per_page = current_app.config.get('POSTS_PER_PAGE', 10)
    category_filter = request.args.get('category', '')
    author_filter = request.args.get('author', '')
    sort_by = request.args.get('sort', 'relevance')  # relevance, date, views
    
    if query:
        # 使用高级搜索服务
        from app.search_service import get_search_service
        search_service = get_search_service()
        
        # 构建过滤器
        filters = {}
        if category_filter:
            filters['category'] = category_filter
        if author_filter:
            filters['author'] = author_filter
        
        # 执行搜索
        search_results = search_service.search(
            query_text=query,
            page=page,
            per_page=per_page,
            filters=filters
        )
        
        # 如果全文搜索失败，回退到基础搜索
        if 'error' in search_results:
            current_app.logger.warning(f"全文搜索失败，使用基础搜索: {search_results['error']}")
            posts = QueryOptimization.search_posts_optimized(
                query_text=query,
                page=page,
                per_page=per_page
            )
            search_results = {
                'results': [],
                'total': posts.total,
                'page': posts.page,
                'per_page': posts.per_page,
                'pages': posts.pages,
                'has_prev': posts.has_prev,
                'has_next': posts.has_next,
                'suggestions': [],
                'fallback_posts': posts
            }
    else:
        # 如果没有搜索词，返回空结果
        search_results = {
            'results': [],
            'total': 0,
            'page': 1,
            'per_page': per_page,
            'pages': 0,
            'has_prev': False,
            'has_next': False,
            'suggestions': []
        }
    
    # 获取分类和作者用于过滤选项
    categories = Category.query.all()
    authors = User.query.join(Post).distinct().all()
    
    return render_template('search_advanced.html', 
                         title='搜索结果', 
                         search_results=search_results,
                         query=query,
                         categories=categories,
                         authors=authors,
                         current_category=category_filter,
                         current_author=author_filter,
                         current_sort=sort_by)

@bp.route('/search/suggestions')
def search_suggestions():
    """搜索建议API - 自动补全功能"""
    query = request.args.get('q', '').strip()
    limit = request.args.get('limit', 10, type=int)
    
    if not query or len(query) < 2:
        return jsonify([])
    
    try:
        from app.search_service import get_search_service
        search_service = get_search_service()
        
        # 获取搜索建议
        suggestions = search_service.get_search_suggestions(query, limit)
        
        # 格式化建议结果
        formatted_suggestions = []
        for suggestion in suggestions:
            formatted_suggestions.append({
                'text': suggestion['text'],
                'type': suggestion['type'],
                'score': suggestion['score']
            })
        
        return jsonify(formatted_suggestions)
        
    except Exception as e:
        current_app.logger.error(f"获取搜索建议失败: {e}")
        return jsonify([])

@bp.route('/search/popular')
def popular_searches():
    """热门搜索API"""
    limit = request.args.get('limit', 10, type=int)
    
    try:
        from app.search_service import get_search_service
        search_service = get_search_service()
        
        popular_terms = search_service.get_popular_searches(limit)
        return jsonify(popular_terms)
        
    except Exception as e:
        current_app.logger.error(f"获取热门搜索失败: {e}")
        return jsonify([])

@bp.route('/statistics')
def statistics():
    """统计页面 - 使用优化查询"""
    try:
        # 首先尝试从缓存获取
        stats = get_cached_site_stats()
    except Exception as e:
        current_app.logger.error(f"缓存统计获取失败，使用优化查询: {e}")
        # 缓存失败时使用优化查询
        stats = QueryOptimization.get_statistics_optimized()
    
    # 获取分类统计
    categories = QueryOptimization.get_categories_with_post_counts()
    
    # 获取标签统计
    tags = QueryOptimization.get_tags_with_post_counts(20)
    
    # 获取最近活动
    recent_activities = QueryOptimization.get_recent_activity(15)
    
    return render_template('statistics.html', 
                         title='网站统计',
                         stats=stats,
                         categories=categories,
                         tags=tags,
                         recent_activities=recent_activities)


@bp.route('/toast-test')
def toast_test():
    """Toast通知系统测试页面"""
    flash('欢迎来到Toast测试页面！', 'success')
    flash('这是一个信息消息示例', 'info')
    flash('请注意：这是警告消息', 'warning')
    return render_template('toast_test.html', title='Toast通知测试')
