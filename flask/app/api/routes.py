from flask import jsonify, request, current_app
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity
from app import db, cache, limiter
from app.api import bp
from app.models import User, Post, Comment
from app.api.auth import token_required
from app.cache_service import get_cached_posts_list, get_cached_post_detail, CacheInvalidation

@bp.route('/auth/login', methods=['POST'])
@limiter.limit("10/minute; 100/hour")
def login():
    """API登录"""
    data = request.get_json()
    
    if not data or not data.get('username') or not data.get('password'):
        return jsonify({'message': '用户名和密码不能为空'}), 400
    
    user = User.query.filter_by(username=data['username']).first()
    
    if not user or not user.check_password(data['password']):
        return jsonify({'message': '用户名或密码错误'}), 401
    
    access_token = create_access_token(identity=user.id)
    
    return jsonify({
        'access_token': access_token,
        'user': {
            'id': user.id,
            'username': user.username,
            'email': user.email
        }
    })

@bp.route('/auth/register', methods=['POST'])
@limiter.limit("5/minute; 50/hour")
def register():
    """API注册"""
    data = request.get_json()
    
    if not data or not data.get('username') or not data.get('email') or not data.get('password'):
        return jsonify({'message': '用户名、邮箱和密码不能为空'}), 400
    
    if User.query.filter_by(username=data['username']).first():
        return jsonify({'message': '用户名已存在'}), 400
    
    if User.query.filter_by(email=data['email']).first():
        return jsonify({'message': '邮箱已被注册'}), 400
    
    user = User(username=data['username'], email=data['email'])
    user.set_password(data['password'])
    db.session.add(user)
    db.session.commit()
    
    return jsonify({'message': '注册成功'}), 201

@bp.route('/posts', methods=['GET'])
@limiter.limit("60/minute")
def get_posts():
    """获取文章列表，支持全文搜索与缓存"""
    page = request.args.get('page', 1, type=int)
    per_page = min(request.args.get('per_page', 10, type=int), 100)
    q = request.args.get('q', type=str, default='')
    category = request.args.get('category', type=str)
    author = request.args.get('author', type=str)
    tags = request.args.get('tags', type=str)

    # 如果提供了搜索关键词，走高级搜索（含Whoosh，自动回退到基础搜索）
    if q and q.strip():
        try:
            from app.search_service import get_search_service
            search_service = get_search_service()
            if search_service:
                filters = {}
                if category:
                    filters['category'] = category
                if author:
                    filters['author'] = author
                # 可选：对单一 tag 精确过滤（Whoosh Term 为精确匹配）
                if tags:
                    first_tag = tags.split(',')[0].strip()
                    if first_tag:
                        filters['tags'] = first_tag

                results = search_service.search(q, page=page, per_page=per_page, filters=filters)

                posts_payload = [{
                    'id': item.get('id'),
                    'title': item.get('title'),
                    'slug': item.get('slug'),
                    'summary': item.get('summary'),
                    'published_at': item.get('timestamp').isoformat() if item.get('timestamp') else None,
                    'author': item.get('author'),
                    'views': item.get('views')
                } for item in results.get('results', [])]

                return jsonify({
                    'posts': posts_payload,
                    'total': results.get('total', 0),
                    'pages': results.get('pages', (results.get('total', 0) + per_page - 1) // max(per_page, 1)),
                    'current_page': results.get('page', page),
                    'has_prev': results.get('has_prev', page > 1),
                    'has_next': results.get('has_next', False),
                    'suggestions': results.get('suggestions', []),
                    'query': results.get('query', q)
                })
        except Exception as e:
            current_app.logger.error(f"搜索失败，回退到基础列表: {e}")
            # 回退到基础列表查询（下面的缓存路径）

    # 没有关键词：使用缓存的文章列表（可按分类名或ID过滤）
    cached = get_cached_posts_list(page=page, per_page=per_page, category=category)
    posts_payload = [{
        'id': item['id'],
        'title': item['title'],
        'slug': item.get('slug'),
        'summary': item.get('summary'),
        'published_at': item.get('published_at'),
        'author': item.get('author', {}).get('username') if isinstance(item.get('author'), dict) else item.get('author'),
        'views': item.get('views')
    } for item in cached.get('items', [])]

    return jsonify({
        'posts': posts_payload,
        'total': cached.get('total', 0),
        'pages': cached.get('pages', 0),
        'current_page': cached.get('page', page)
    })

@bp.route('/search/suggest', methods=['GET'])
@limiter.limit("30/minute")
@cache.cached(timeout=60, query_string=True)
def search_suggest():
    """搜索建议/自动补全接口"""
    q = request.args.get('q', type=str, default='')
    limit = request.args.get('limit', 10, type=int)
    if not q or not q.strip():
        return jsonify([])
    try:
        from app.search_service import get_search_service
        service = get_search_service()
        if not service:
            return jsonify([])
        suggestions = service.get_search_suggestions(q, limit=limit) or []
        return jsonify(suggestions)
    except Exception as e:
        current_app.logger.error(f"获取搜索建议失败: {e}")
        return jsonify([])

@bp.route('/search/popular', methods=['GET'])
@limiter.limit("10/minute")
@cache.cached(timeout=300, query_string=True)
def search_popular():
    """热门搜索词接口"""
    limit = request.args.get('limit', 10, type=int)
    try:
        from app.search_service import get_search_service
        service = get_search_service()
        if not service:
            return jsonify([])
        popular = service.get_popular_searches(limit=limit) or []
        # 统一返回数组形式（若为简单字符串数组则直接返回）
        return jsonify(popular)
    except Exception as e:
        current_app.logger.error(f"获取热门搜索失败: {e}")
        return jsonify([])

@bp.route('/posts/<int:id>', methods=['GET'])
@limiter.limit("120/minute")
def get_post(id):
    """获取单篇文章"""
    post = Post.query.get_or_404(id)

    if not post.published:
        return jsonify({'message': '文章未发布'}), 404

    # 安全自增浏览量
    try:
        post.views = (post.views or 0) + 1
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"自增浏览量失败: {e}")

    # 失效该文章相关缓存
    try:
        CacheInvalidation.invalidate_post_cache(post.id)
    except Exception as e:
        current_app.logger.error(f"文章缓存失效失败: {e}")

    # 通过缓存方法获取并返回最新详情
    detail = get_cached_post_detail(post.id)
    if not detail:
        return jsonify({'message': '文章未发布'}), 404

    return jsonify(detail)

@bp.route('/posts', methods=['POST'])
@jwt_required()
@limiter.limit("20/minute")
def create_post():
    """创建文章"""
    current_user_id = get_jwt_identity()
    data = request.get_json()
    
    if not data or not data.get('title') or not data.get('content'):
        return jsonify({'message': '标题和内容不能为空'}), 400
    
    post = Post(
        title=data['title'],
        content=data['content'],
        summary=data.get('summary', ''),
        user_id=current_user_id,
        published=data.get('published', False)
    )
    
    db.session.add(post)
    db.session.commit()
    
    return jsonify({
        'message': '文章创建成功',
        'post_id': post.id
    }), 201

@bp.route('/posts/<int:id>/comments', methods=['GET'])
@limiter.limit("120/minute")
def get_comments(id):
    """获取文章评论"""
    post = Post.query.get_or_404(id)
    
    comments = Comment.query.filter_by(post_id=id, approved=True).order_by(
        Comment.timestamp.desc()).all()
    
    return jsonify({
        'comments': [{
            'id': comment.id,
            'content': comment.content,
            'timestamp': comment.timestamp.isoformat(),
            'author': comment.author.username
        } for comment in comments]
    })

@bp.route('/posts/<int:id>/comments', methods=['POST'])
@jwt_required()
@limiter.limit("30/minute")
def create_comment(id):
    """创建评论"""
    current_user_id = get_jwt_identity()
    post = Post.query.get_or_404(id)
    data = request.get_json()
    
    if not data or not data.get('content'):
        return jsonify({'message': '评论内容不能为空'}), 400
    
    comment = Comment(
        content=data['content'],
        user_id=current_user_id,
        post_id=id
    )
    
    db.session.add(comment)
    db.session.commit()
    
    return jsonify({
        'message': '评论发表成功',
        'comment_id': comment.id
    }), 201

@bp.route('/user/profile', methods=['GET'])
@jwt_required()
@limiter.limit("60/minute")
def get_profile():
    """获取用户资料"""
    current_user_id = get_jwt_identity()
    user = User.query.get_or_404(current_user_id)
    
    return jsonify({
        'id': user.id,
        'username': user.username,
        'email': user.email,
        'first_name': user.first_name,
        'last_name': user.last_name,
        'bio': user.bio,
        'location': user.location,
        'website': user.website,
        'member_since': user.member_since.isoformat(),
        'last_seen': user.last_seen.isoformat()
    })

@bp.route('/search/stats', methods=['GET'])
@limiter.limit("10/minute")
def search_stats():
    """获取搜索索引统计信息"""
    try:
        from app.search_service import get_search_service
        search_service = get_search_service()
        
        stats = search_service.get_stats()
        return jsonify(stats)
        
    except Exception as e:
        current_app.logger.error(f"获取搜索统计失败: {e}")
        return jsonify({
            'total_documents': 0,
            'index_size': 0,
            'last_updated': None,
            'error': '搜索服务不可用'
        }), 500
