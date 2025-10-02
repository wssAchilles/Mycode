from flask import render_template, redirect, url_for, flash, request, abort, jsonify, current_app
from flask_login import current_user, login_required
from werkzeug.utils import secure_filename
from datetime import datetime,timezone
from flask import make_response
import os
import uuid
import imghdr
import mimetypes
from app import db, limiter
from app.blog import bp
from app.models import Post, Comment, Category, Tag
from app.blog.forms import PostForm, CommentForm
from app.cache_service import get_cached_posts_list, get_cached_categories, CacheInvalidation
from app.query_optimization import QueryOptimization

def save_uploaded_file(file):
    """保存上传的文件"""
    if file and file.filename:
        # 生成唯一文件名
        filename = secure_filename(file.filename)
        name, ext = os.path.splitext(filename)
        ext = (ext or '').lower()
        allowed_exts = {'.png', '.jpg', '.jpeg', '.gif', '.webp'}

        # 如果扩展名缺失或不在允许列表中，尝试根据 mimetype / 文件内容推断
        if not ext or ext not in allowed_exts:
            inferred_ext = None
            try:
                if getattr(file, 'mimetype', None):
                    inferred_ext = mimetypes.guess_extension(file.mimetype)
                if not inferred_ext:
                    # 使用 imghdr 基于文件内容判断
                    try:
                        file.stream.seek(0)
                    except Exception:
                        pass
                    fmt = imghdr.what(file.stream)
                    mapping = {
                        'jpeg': '.jpg',
                        'png': '.png',
                        'gif': '.gif',
                        'webp': '.webp',
                        'bmp': '.bmp',
                        'tiff': '.tiff',
                    }
                    inferred_ext = mapping.get(fmt)
            except Exception:
                inferred_ext = None

            # 兜底为 .jpg，并确保在允许列表中
            if inferred_ext and inferred_ext.lower() in allowed_exts:
                ext = inferred_ext.lower()
            else:
                ext = '.jpg'

            # 重置流位置，避免保存时文件指针不在开头
            try:
                file.stream.seek(0)
            except Exception:
                pass

        unique_filename = f"{uuid.uuid4().hex}{ext}"
        
        # 确保upload目录存在
        upload_dir = os.path.join(current_app.static_folder, 'img')
        if not os.path.exists(upload_dir):
            os.makedirs(upload_dir)
        
        # 保存文件
        file_path = os.path.join(upload_dir, unique_filename)
        file.save(file_path)
        
        return unique_filename
    return None

import re
def generate_slug(title):
    """
    从标题生成URL友好的slug
    """
    slug = re.sub(r'[^\w\s-]', '', title).strip().lower()
    slug = re.sub(r'[-\s]+', '-', slug)
    return slug

@bp.route('/')
def index():
    """博客首页 - 使用缓存和查询优化"""
    page = request.args.get('page', 1, type=int)
    category_name = request.args.get('category')
    sort_by = request.args.get('sort', 'timestamp')
    
    try:
        # 使用缓存获取文章列表
        cached_posts = get_cached_posts_list(page=page, per_page=5, category=category_name)
        
        # 创建分页对象的模拟
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
                        # 缺省没有content，列表页截取摘要代替，避免模板报错
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
                        self.tags = []
                        # 可选字段
                        self.featured_image = d.get('featured_image') if isinstance(d, dict) else None
                        self.likes = d.get('likes', 0)

                self.items = [PostProxy(item) for item in (data.get('items') or [])]
                self.total = data.get('total', 0)
                self.pages = data.get('pages', 1)
                self.page = data.get('page', 1)
                self.per_page = data.get('per_page', 5)
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
        
        # 使用缓存获取分类（直接使用字典，Jinja2 支持以点访问字典键）
        categories = get_cached_categories()
        
    except Exception as e:
        current_app.logger.error(f"博客缓存获取失败，使用优化查询: {e}")
        # 缓存失败时使用优化的数据库查询
        
        # 获取分类ID（如果指定了分类名称）
        category_id = None
        if category_name:
            category = Category.query.filter_by(name=category_name).first()
            category_id = category.id if category else None
        
        # 使用优化查询获取文章列表
        posts = QueryOptimization.get_posts_with_relations(
            page=page,
            per_page=5,
            category_id=category_id,
            published_only=True,
            order_by=sort_by
        )
        
        # 获取分类列表及文章数量
        categories_with_counts = QueryOptimization.get_categories_with_post_counts()
        categories = [cat[0] for cat in categories_with_counts]
    
    return render_template('blog/index.html', title='博客', posts=posts, categories=categories)

@bp.route('/post/<int:id>')
def post(id):
    """文章详情页 - 使用查询优化"""
    comments_page = request.args.get('page', 1, type=int)
    
    post, comments = QueryOptimization.get_post_with_comments(
        post_id=id,
        comments_page=comments_page,
        comments_per_page=10
    )
    
    # 增加访问量
    post.views += 1
    db.session.commit()
    
    # 获取相关文章
    related_posts = []
    if post.category_id:
        related_posts = QueryOptimization.get_posts_with_relations(
            page=1,
            per_page=5,
            category_id=post.category_id,
            published_only=True
        ).items
        related_posts = [p for p in related_posts if p.id != post.id]
    
    if len(related_posts) < 5:
        additional_posts = QueryOptimization.get_popular_posts(
            limit=5 - len(related_posts),
            days=90
        )
        related_posts.extend([p for p in additional_posts if p.id != post.id])
    
    form = CommentForm()
    
    return render_template('blog/post.html', title=post.title, 
                         post=post, comments=comments, form=form, related_posts=related_posts[:5])

@bp.route('/post/<int:id>/comment', methods=['POST'])
@login_required
@limiter.limit("5/minute; 50/hour")
def add_comment(id):
    """添加评论"""
    post = Post.query.get_or_404(id)
    form = CommentForm()
    
    if form.validate_on_submit():
        comment = Comment(
            content=form.content.data,
            user_id=current_user.id,
            post_id=post.id
        )
        db.session.add(comment)
        db.session.commit()
        flash('评论发表成功！', 'success')
    
    return redirect(url_for('blog.post', id=id))

@bp.route('/create', methods=['GET', 'POST'])
@login_required
@limiter.limit("10/minute; 100/hour")
def create_post():
    """使用富文本编辑器创建文章"""
    current_app.logger.info(f'访问创建文章页面 - 方法: {request.method}')
    
    if request.method == 'POST':
        current_app.logger.info(f'POST请求数据: {dict(request.form)}')
        current_app.logger.info(f'文件数据: {dict(request.files)}')
    
    form = PostForm()
    current_app.logger.info(f'表单创建完成，CSRF token: {form.csrf_token.data if hasattr(form, "csrf_token") else "无"}')
    
    if form.validate_on_submit():
        current_app.logger.info('表单验证成功，开始创建文章')
        try:
            action = request.form.get('action', 'publish')
            current_app.logger.info(f'操作类型: {action}')
            
            # 确保slug唯一
            slug = form.slug.data or generate_slug(form.title.data)
            original_slug = slug
            counter = 1
            while Post.query.filter_by(slug=slug).first() is not None:
                slug = f"{original_slug}-{counter}"
                counter += 1
            
            # 服务器端内容验证
            if not form.content.data or len(form.content.data.strip()) < 10:
                flash('文章内容不能为空，至少需要10个字符', 'danger')
                return render_template('blog/create_post.html', title='创建文章', form=form)
            
            # 处理文件上传
            featured_image = None
            if form.featured_image.data:
                featured_image = save_uploaded_file(form.featured_image.data)
                current_app.logger.info(f'特色图片上传: {featured_image}')
            
            post = Post(
                title=form.title.data,
                slug=slug,
                content=form.content.data,
                summary=form.summary.data,
                featured_image=featured_image,
                user_id=current_user.id,
                published=(action == 'publish')
            )
            
            # 设置分类
            if form.category.data and form.category.data != 0:
                post.category_id = form.category.data
                current_app.logger.info(f'分类设置: {form.category.data}')
            
            db.session.add(post)
            # 设置发布时间
            if post.published and not post.published_at:
                post.published_at = datetime.utcnow()
            elif not post.published:
                post.published_at = None
            db.session.commit()
            current_app.logger.info(f'文章保存成功，ID: {post.id}')
            
            # 失效相关缓存
            CacheInvalidation.invalidate_posts_cache()
            
            if action == 'publish':
                flash('文章发表成功！', 'success')
                current_app.logger.info(f'文章发布成功，重定向到: blog.post, id={post.id}')
                return redirect(url_for('blog.post', id=post.id))
            else:
                flash('草稿保存成功！', 'info')
                current_app.logger.info(f'草稿保存成功，重定向到: blog.edit_post, id={post.id}')
                return redirect(url_for('blog.edit_post', id=post.id))
                
        except Exception as e:
            db.session.rollback()
            flash(f'发表文章失败：{str(e)}', 'danger')
            current_app.logger.error(f'创建文章失败: {e}', exc_info=True)
    else:
        # 表单验证失败，显示错误信息
        if request.method == 'POST':
            current_app.logger.error(f'表单验证失败，错误信息: {form.errors}')
            for field, errors in form.errors.items():
                for error in errors:
                    flash(f'{getattr(form, field).label.text}: {error}', 'danger')
    
    # AJAX请求保存草稿
    if request.method == 'POST' and request.is_json:
        try:
            data = request.get_json()
            # 这里可以实现自动保存草稿的逻辑
            return jsonify({'success': True, 'message': '草稿已自动保存'})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)})
    
    return render_template('blog/create_post.html', title='创建文章', form=form)

@bp.route('/test-form', methods=['GET', 'POST'])
@login_required
@limiter.limit("30/minute")
def test_form():
    """测试表单提交"""
    form = PostForm()
    
    if request.method == 'POST':
        current_app.logger.info(f'测试表单POST请求，数据: {request.form.to_dict()}')
        
        if form.validate_on_submit():
            current_app.logger.info('测试表单验证成功')
            flash('测试表单提交成功！', 'success')
        else:
            current_app.logger.info(f'测试表单验证失败: {form.errors}')
            for field, errors in form.errors.items():
                for error in errors:
                    flash(f'{getattr(form, field).label.text}: {error}', 'danger')
    
    return render_template('blog/test_form.html', title='表单测试', form=form)

@bp.route('/simple-test', methods=['GET', 'POST'])
@login_required
@limiter.limit("30/minute")
def simple_test():
    """简单表单测试"""
    form = PostForm()
    
    if request.method == 'POST':
        current_app.logger.info(f'简单测试POST请求')
        current_app.logger.info(f'请求数据: {dict(request.form)}')
        
        if form.validate_on_submit():
            current_app.logger.info('简单测试表单验证成功')
            flash('简单测试提交成功！', 'success')
            return redirect(url_for('blog.simple_test'))
        else:
            current_app.logger.info(f'简单测试表单验证失败: {form.errors}')
            for field, errors in form.errors.items():
                for error in errors:
                    flash(f'{getattr(form, field).label.text}: {error}', 'danger')
    
    return render_template('blog/simple_test.html', title='简单测试', form=form)

@bp.route('/edit/<int:id>', methods=['GET', 'POST'])
@login_required
@limiter.limit("30/minute")
def edit_post(id):
    """编辑文章"""
    post = Post.query.get_or_404(id)
    
    # 检查权限
    if post.author != current_user and not current_user.is_admin:
        abort(403)
    
    form = PostForm()
    
    if form.validate_on_submit():
        # 处理文件上传
        if form.featured_image.data:
            featured_image = save_uploaded_file(form.featured_image.data)
            post.featured_image = featured_image
            
        post.title = form.title.data
        post.content = form.content.data
        post.summary = form.summary.data
        old_published = post.published
        post.published = form.published.data
        
        # 设置分类
        if form.category.data and form.category.data != 0:
            post.category_id = form.category.data
        else:
            post.category_id = None
        
        # 重新生成slug
        import re
        post.slug = re.sub(r'[^\w\s-]', '', form.title.data).strip().lower()
        post.slug = re.sub(r'[-\s]+', '-', post.slug)
        
        # 维护发布时间
        if not old_published and post.published and not post.published_at:
            post.published_at = datetime.utcnow()
        elif old_published and not post.published:
            post.published_at = None
        db.session.commit()
        
        # 清除相关缓存
        CacheInvalidation.invalidate_posts_cache()
        CacheInvalidation.invalidate_post_cache(post.id)
        
        flash('文章更新成功！', 'success')
        return redirect(url_for('blog.post', id=post.id))
    elif request.method == 'GET':
        form.title.data = post.title
        form.content.data = post.content
        form.summary.data = post.summary
        form.published.data = post.published
        form.category.data = post.category_id or 0
    
    return render_template('blog/edit_post.html', title='编辑文章', 
                         form=form, post=post)

@bp.route('/category/<name>')
def category(name):
    """分类页面 - 使用查询优化"""
    category = Category.query.filter_by(name=name).first_or_404()
    page = request.args.get('page', 1, type=int)
    
    # 使用优化查询获取分类文章
    posts = QueryOptimization.get_category_posts_optimized(
        category_id=category.id,
        page=page,
        per_page=5
    )
    
    return render_template('blog/category.html', title=f'分类: {category.name}',
                         posts=posts, category=category)

@bp.route('/tag/<name>')
def tag(name):
    """标签页面 - 使用查询优化"""
    tag = Tag.query.filter_by(name=name).first_or_404()
    page = request.args.get('page', 1, type=int)
    
    # 使用优化查询获取标签文章
    posts = QueryOptimization.get_posts_with_relations(
        page=page,
        per_page=5,
        tag_id=tag.id,
        published_only=True,
        order_by='timestamp'
    )
    
    return render_template('blog/tag.html', title=f'标签: {tag.name}',
                         posts=posts, tag=tag)

@bp.route('/delete/<int:id>', methods=['POST'])
@login_required
@limiter.limit("5/minute; 20/hour")
def delete_post(id):
    """删除文章"""
    post = Post.query.get_or_404(id)
    
    # 检查权限：只有文章作者或管理员可以删除
    if post.author != current_user and not current_user.is_admin:
        abort(403)
    
    try:
        # 删除相关的评论
        Comment.query.filter_by(post_id=post.id).delete()
        
        # 删除文章
        db.session.delete(post)
        db.session.commit()
        
        # 清除相关缓存
        CacheInvalidation.invalidate_posts_cache()
        CacheInvalidation.invalidate_post_cache(post.id)
        
        flash('文章已成功删除！', 'success')
        return redirect(url_for('blog.index'))
        
    except Exception as e:
        db.session.rollback()
        flash('删除文章时发生错误，请重试。', 'error')
        return redirect(url_for('blog.post', id=id))

@bp.route('/api/delete/<int:id>', methods=['POST'])
@login_required
@limiter.limit("5/minute; 20/hour")
def api_delete_post(id):
    """API方式删除文章"""
    post = Post.query.get_or_404(id)
    
    # 检查权限：只有文章作者或管理员可以删除
    if post.author != current_user and not current_user.is_admin:
        return jsonify({'success': False, 'message': '您没有权限删除此文章'}), 403
    
    try:
        # 删除相关的评论
        Comment.query.filter_by(post_id=post.id).delete()
        
        # 删除文章
        db.session.delete(post)
        db.session.commit()
        
        # 清除相关缓存
        CacheInvalidation.invalidate_posts_cache()
        CacheInvalidation.invalidate_post_cache(post.id)
        
        return jsonify({'success': True, 'message': '文章已成功删除'})
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': '删除文章时发生错误，请重试'}), 500

@bp.route('/upload_image', methods=['POST'])
@login_required
@limiter.limit("20/minute; 200/hour")
def upload_image():
    """上传图片到富文本编辑器"""
    if 'image' not in request.files:
        return jsonify({'success': False, 'error': '没有上传文件'}), 400
    
    file = request.files['image']
    
    if file.filename == '':
        return jsonify({'success': False, 'error': '没有选择文件'}), 400
    
    # 检查文件类型
    allowed_extensions = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
    if not ('.' in file.filename and 
            file.filename.rsplit('.', 1)[1].lower() in allowed_extensions):
        return jsonify({'success': False, 'error': '不支持的文件格式'}), 400
    
    # 检查文件大小 (5MB)
    file.seek(0, 2)  # 移动到文件末尾
    file_size = file.tell()
    file.seek(0)  # 重置到文件开始
    
    if file_size > 5 * 1024 * 1024:  # 5MB
        return jsonify({'success': False, 'error': '文件大小超过5MB限制'}), 400
    
    try:
        # 生成唯一文件名
        filename = secure_filename(file.filename)
        name, ext = os.path.splitext(filename)
        unique_filename = f"rich_editor_{uuid.uuid4().hex}{ext}"
        
        # 确保上传目录存在
        upload_dir = os.path.join(current_app.static_folder, 'uploads', 'images')
        if not os.path.exists(upload_dir):
            os.makedirs(upload_dir)
        
        # 保存文件
        file_path = os.path.join(upload_dir, unique_filename)
        file.save(file_path)
        
        # 返回文件URL
        file_url = url_for('static', filename=f'uploads/images/{unique_filename}')
        
        return jsonify({'success': True, 'url': file_url})
        
    except Exception as e:
        current_app.logger.error(f"图片上传失败: {str(e)}")
        return jsonify({'success': False, 'error': '上传失败，请重试'}), 500

@bp.route('/create_rich', methods=['GET', 'POST'])
@login_required
@limiter.limit("10/minute; 100/hour")
def create_post_rich():
    """使用富文本编辑器创建文章"""
    form = PostForm()
    
    if form.validate_on_submit():
        action = request.form.get('action', 'publish')
        
        # 处理文件上传
        featured_image = None
        if form.featured_image.data:
            featured_image = save_uploaded_file(form.featured_image.data)
        
        post = Post(
            title=form.title.data,
            content=form.content.data,
            summary=form.summary.data,
            featured_image=featured_image,
            user_id=current_user.id,
            published=(action == 'publish')
        )
        
        # 设置分类
        if form.category.data and form.category.data != 0:
            post.category_id = form.category.data
        
        # 生成slug
        import re
        post.slug = re.sub(r'[^\w\s-]', '', form.title.data).strip().lower()
        post.slug = re.sub(r'[-\s]+', '-', post.slug)
        
        db.session.add(post)
        db.session.commit()
        
        # 失效相关缓存
        CacheInvalidation.invalidate_posts_cache()
        
        if action == 'publish':
            flash('文章发表成功！', 'success')
            return redirect(url_for('blog.post', id=post.id))
        else:
            flash('草稿保存成功！', 'info')
            return redirect(url_for('blog.edit_post', id=post.id))
    
    # AJAX请求保存草稿
    if request.method == 'POST' and request.is_json:
        try:
            data = request.get_json()
            # 这里可以实现自动保存草稿的逻辑
            return jsonify({'success': True, 'message': '草稿已自动保存'})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)})
    
    return render_template('blog/create_post_rich.html', title='创建文章', form=form)

@bp.route('/my_posts')
@login_required
def my_posts():
    """我的文章列表 - 使用查询优化"""
    page = request.args.get('page', 1, type=int)
    
    # 使用优化查询获取用户文章
    posts = QueryOptimization.get_user_posts_optimized(
        user_id=current_user.id,
        page=page,
        per_page=10,
        include_drafts=True
    )
    
    return render_template('blog/my_posts.html', title='我的文章', posts=posts)

@bp.route('/drafts')
@login_required
def drafts():
    """草稿箱 - 使用查询优化"""
    page = request.args.get('page', 1, type=int)
    
    # 获取用户的草稿
    posts = QueryOptimization.get_posts_with_relations(
        page=page,
        per_page=10,
        user_id=current_user.id,
        published_only=False,
        drafts_only=True
    )
    
    return render_template('blog/drafts.html', title='草稿箱', posts=posts)

@bp.route('/api/publish/<int:id>', methods=['POST'])
@login_required
@limiter.limit("10/minute; 50/hour")
def api_publish_draft(id):
    """API方式发布草稿"""
    post = Post.query.get_or_404(id)
    
    # 检查权限：只有文章作者可以发布
    if post.author != current_user:
        return jsonify({'success': False, 'message': '您没有权限发布此文章'}), 403
    
    # 检查是否为草稿
    if post.published:
        return jsonify({'success': False, 'message': '文章已经发布了'}), 400
    
    try:
        # 发布文章
        post.published = True
        post.published_at = datetime.now(timezone.utc)
        db.session.commit()
        
        # 清除相关缓存
        CacheInvalidation.invalidate_posts_cache()
        
        return jsonify({'success': True, 'message': '草稿已成功发布'})
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"发布草稿失败: {str(e)}")
        return jsonify({'success': False, 'message': '发布草稿时发生错误，请重试'}), 500

@bp.route('/sitemap.xml', methods=['GET'])
def sitemap():
    """生成sitemap.xml"""
    pages = []
    
    # 添加静态页面
    for rule in current_app.url_map.iter_rules():
        if "GET" in rule.methods and not rule.arguments and not rule.rule.startswith("/admin"):
            try:
                url = url_for(rule.endpoint, _external=True)
            except Exception:
                # 兜底：如果无法反向生成URL，则使用rule字符串
                url = rule.rule
            pages.append([url, datetime.utcnow().strftime('%Y-%m-%d')])
    
    # 添加文章页面
    posts = Post.query.filter_by(published=True).all()
    for post in posts:
        url = url_for('blog.post', id=post.id, _external=True)
        last_mod = post.updated_at or getattr(post, 'published_at', None) or getattr(post, 'created_at', None)
        date_str = last_mod.strftime('%Y-%m-%d') if last_mod else datetime.utcnow().strftime('%Y-%m-%d')
        pages.append([url, date_str])
    
    # 生成XML
    sitemap_xml = render_template('sitemap_template.xml', pages=pages)
    response = make_response(sitemap_xml)
    response.headers['Content-Type'] = 'application/xml'
    
    return response
