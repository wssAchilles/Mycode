"""
数据库查询优化服务
提供优化的查询方法，解决N+1查询问题，提供高效的分页和搜索功能
"""

from flask import current_app
from sqlalchemy import text, func, and_, or_
from sqlalchemy.orm import joinedload, subqueryload, selectinload, contains_eager
from app import db
from app.models import Post, User, Comment, Category, Tag
import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

class QueryOptimization:
    """查询优化服务类"""
    
    @staticmethod
    def get_posts_with_relations(page=1, per_page=5, category_id=None, tag_id=None, 
                                user_id=None, published_only=True, order_by='timestamp'):
        """
        获取文章列表，预加载所有关联数据，避免N+1查询问题
        
        Args:
            page: 页码
            per_page: 每页数量
            category_id: 分类ID过滤
            tag_id: 标签ID过滤
            user_id: 用户ID过滤
            published_only: 是否只显示已发布文章
            order_by: 排序字段 ('timestamp', 'views', 'likes', 'title')
        """
        # 基础查询，使用joinedload预加载关联数据
        query = Post.query.options(
            joinedload(Post.author),           # 预加载作者信息
            joinedload(Post.category),         # 预加载分类信息
            selectinload(Post.tags)            # 预加载标签信息（多对多关系）
            # 注意：comments使用lazy='dynamic'，不能用于eager loading
        )
        
        # 应用过滤条件
        if published_only:
            query = query.filter(Post.published == True)
        
        if category_id:
            query = query.filter(Post.category_id == category_id)
            
        if tag_id:
            query = query.join(Post.tags).filter(Tag.id == tag_id)
            
        if user_id:
            query = query.filter(Post.user_id == user_id)
        
        # 应用排序
        if order_by == 'views':
            query = query.order_by(Post.views.desc(), Post.published_at.desc())
        elif order_by == 'likes':
            query = query.order_by(Post.likes.desc(), Post.published_at.desc())
        elif order_by == 'title':
            query = query.order_by(Post.title.asc())
        else:  # timestamp
            query = query.order_by(Post.published_at.desc())
        
        # 执行分页查询
        return query.paginate(
            page=page, 
            per_page=per_page, 
            error_out=False,
            max_per_page=100  # 限制最大每页数量
        )
    
    @staticmethod
    def get_post_with_comments(post_id, comments_page=1, comments_per_page=10):
        """
        获取文章详情及其评论，预加载所有关联数据
        
        Args:
            post_id: 文章ID
            comments_page: 评论页码
            comments_per_page: 每页评论数
        """
        # 获取文章，预加载作者、分类、标签
        post = Post.query.options(
            joinedload(Post.author),
            joinedload(Post.category),
            selectinload(Post.tags)
        ).get_or_404(post_id)
        
        # 获取评论，预加载作者信息
        comments = Comment.query.options(
            joinedload(Comment.author)
        ).filter(
            Comment.post_id == post_id,
            Comment.approved == True,
            Comment.parent_id.is_(None)  # 只获取顶级评论
        ).order_by(Comment.timestamp.asc()).paginate(
            page=comments_page,
            per_page=comments_per_page,
            error_out=False
        )
        
        return post, comments
    
    @staticmethod
    def get_user_posts_optimized(user_id, page=1, per_page=10, published_only=True):
        """
        获取用户的文章列表，优化查询
        
        Args:
            user_id: 用户ID
            page: 页码
            per_page: 每页数量
            published_only: 是否只显示已发布文章
        """
        query = Post.query.options(
            joinedload(Post.category),
            selectinload(Post.tags)
        ).filter(Post.user_id == user_id)
        
        if published_only:
            query = query.filter(Post.published == True)
        
        return query.order_by(Post.published_at.desc()).paginate(
            page=page,
            per_page=per_page,
            error_out=False
        )
    
    @staticmethod
    def get_category_posts_optimized(category_id, page=1, per_page=10):
        """
        获取分类下的文章列表，优化查询
        
        Args:
            category_id: 分类ID
            page: 页码
            per_page: 每页数量
        """
        return Post.query.options(
            joinedload(Post.author),
            joinedload(Post.category),
            selectinload(Post.tags)
        ).filter(
            Post.category_id == category_id,
            Post.published == True
        ).order_by(Post.published_at.desc()).paginate(
            page=page,
            per_page=per_page,
            error_out=False
        )
    
    @staticmethod
    def get_popular_posts(limit=10, days=30):
        """
        获取热门文章，基于浏览量
        
        Args:
            limit: 返回数量
            days: 时间范围（天）
        """
        cutoff_date = datetime.now() - timedelta(days=days)
        
        return Post.query.options(
            joinedload(Post.author),
            joinedload(Post.category)
        ).filter(
            Post.published == True,
            Post.published_at >= cutoff_date
        ).order_by(
            Post.views.desc()  # 仅基于浏览量排序
        ).limit(limit).all()
    
    @staticmethod
    def search_posts_optimized(query_text, page=1, per_page=10):
        """
        搜索文章，优化查询性能
        
        Args:
            query_text: 搜索关键词
            page: 页码
            per_page: 每页数量
        """
        # 使用全文搜索（如果数据库支持）或LIKE查询
        search_pattern = f'%{query_text}%'
        
        query = Post.query.options(
            joinedload(Post.author),
            joinedload(Post.category),
            selectinload(Post.tags)
        ).filter(
            and_(
                Post.published == True,
                or_(
                    Post.title.ilike(search_pattern),
                    Post.content.ilike(search_pattern),
                    Post.summary.ilike(search_pattern)
                )
            )
        ).order_by(
            # 标题匹配优先级更高
            func.case([
                (Post.title.ilike(search_pattern), 1),
            ], else_=2),
            Post.published_at.desc()
        )
        
        return query.paginate(
            page=page,
            per_page=per_page,
            error_out=False
        )
    
    @staticmethod
    def get_user_comments_optimized(user_id, page=1, per_page=20):
        """
        获取用户评论列表，预加载文章信息
        
        Args:
            user_id: 用户ID
            page: 页码
            per_page: 每页数量
        """
        return Comment.query.options(
            joinedload(Comment.post).joinedload(Post.author),
            joinedload(Comment.post).joinedload(Post.category)
        ).filter(
            Comment.user_id == user_id,
            Comment.approved == True
        ).order_by(Comment.timestamp.desc()).paginate(
            page=page,
            per_page=per_page,
            error_out=False
        )
    
    @staticmethod
    def get_statistics_optimized():
        """
        获取站点统计信息，使用优化的聚合查询
        
        Returns:
            dict: 包含各种统计数据的字典
        """
        # 使用单次查询获取多个统计数据
        stats = db.session.query(
            func.count(Post.id).label('total_posts'),
            func.count(func.case([(Post.published == True, 1)])).label('published_posts'),
            func.sum(Post.views).label('total_views'),
            func.sum(Post.likes).label('total_likes')
        ).first()
        
        user_stats = db.session.query(
            func.count(User.id).label('total_users'),
            func.count(func.case([(User.confirmed == True, 1)])).label('confirmed_users')
        ).first()
        
        comment_stats = db.session.query(
            func.count(Comment.id).label('total_comments'),
            func.count(func.case([(Comment.approved == True, 1)])).label('approved_comments')
        ).first()
        
        category_stats = db.session.query(
            func.count(Category.id).label('total_categories')
        ).first()
        
        return {
            'posts': {
                'total': stats.total_posts or 0,
                'published': stats.published_posts or 0,
                'total_views': stats.total_views or 0,
                'total_likes': stats.total_likes or 0
            },
            'users': {
                'total': user_stats.total_users or 0,
                'confirmed': user_stats.confirmed_users or 0
            },
            'comments': {
                'total': comment_stats.total_comments or 0,
                'approved': comment_stats.approved_comments or 0
            },
            'categories': {
                'total': category_stats.total_categories or 0
            }
        }
    
    @staticmethod
    def get_categories_with_post_counts():
        """
        获取分类列表及其文章数量，使用JOIN查询避免N+1问题
        
        Returns:
            list: 包含分类和文章数量的列表
        """
        return db.session.query(
            Category,
            func.count(Post.id).label('post_count')
        ).outerjoin(
            Post, and_(Category.id == Post.category_id, Post.published == True)
        ).group_by(Category.id).order_by(Category.name).all()
    
    @staticmethod
    def get_tags_with_post_counts(limit=20):
        """
        获取标签列表及其文章数量
        
        Args:
            limit: 返回数量限制
            
        Returns:
            list: 包含标签和文章数量的列表
        """
        from app.models import post_tags
        
        return db.session.query(
            Tag,
            func.count(Post.id).label('post_count')
        ).join(
            post_tags, Tag.id == post_tags.c.tag_id
        ).join(
            Post, and_(Post.id == post_tags.c.post_id, Post.published == True)
        ).group_by(Tag.id).order_by(
            func.count(Post.id).desc()
        ).limit(limit).all()
    
    @staticmethod
    def get_recent_activity(limit=20):
        """
        获取最近活动，包括新文章和新评论
        
        Args:
            limit: 返回数量限制
            
        Returns:
            list: 按时间排序的活动列表
        """
        # 获取最近的文章
        recent_posts = db.session.query(
            Post.id,
            Post.title,
            Post.published_at,
            Post.user_id,
            User.username,
            func.literal('post').label('type')
        ).join(User).filter(
            Post.published == True
        ).order_by(Post.published_at.desc()).limit(limit).subquery()
        
        # 获取最近的评论
        recent_comments = db.session.query(
            Comment.id,
            Comment.content.label('title'),
            Comment.timestamp,
            Comment.user_id,
            User.username,
            func.literal('comment').label('type')
        ).join(User).filter(
            Comment.approved == True
        ).order_by(Comment.timestamp.desc()).limit(limit).subquery()
        
        # 合并结果并按时间排序
        # 这里简化处理，实际可以使用UNION ALL
        activities = []
        
        posts = db.session.query(recent_posts).all()
        comments = db.session.query(recent_comments).all()
        
        for post in posts:
            activities.append({
                'id': post.id,
                'title': post.title,
                'timestamp': post.published_at,
                'user_id': post.user_id,
                'username': post.username,
                'type': 'post'
            })
        
        for comment in comments:
            activities.append({
                'id': comment.id,
                'title': comment.title[:50] + '...' if len(comment.title) > 50 else comment.title,
                'timestamp': comment.timestamp,
                'user_id': comment.user_id,
                'username': comment.username,
                'type': 'comment'
            })
        
        # 按时间排序
        activities.sort(key=lambda x: x['timestamp'], reverse=True)
        return activities[:limit]


class PaginationHelper:
    """分页助手类，提供高效的分页功能"""
    
    @staticmethod
    def create_pagination(query, page, per_page, error_out=False, max_per_page=100):
        """
        创建优化的分页对象
        
        Args:
            query: SQLAlchemy查询对象
            page: 当前页码
            per_page: 每页数量
            error_out: 是否在页码错误时抛出异常
            max_per_page: 最大每页数量
        """
        # 限制每页最大数量，防止性能问题
        if per_page > max_per_page:
            per_page = max_per_page
        
        return query.paginate(
            page=page,
            per_page=per_page,
            error_out=error_out,
            max_per_page=max_per_page
        )
    
    @staticmethod
    def get_pagination_info(pagination):
        """
        获取分页信息
        
        Args:
            pagination: SQLAlchemy分页对象
            
        Returns:
            dict: 分页信息字典
        """
        return {
            'page': pagination.page,
            'pages': pagination.pages,
            'per_page': pagination.per_page,
            'total': pagination.total,
            'has_prev': pagination.has_prev,
            'has_next': pagination.has_next,
            'prev_num': pagination.prev_num,
            'next_num': pagination.next_num
        }
