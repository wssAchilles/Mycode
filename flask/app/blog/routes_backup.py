from flask import render_template, redirect, url_for, flash, request, abort, jsonify, current_app
from flask_login import current_user, login_required
from werkzeug.utils import secure_filename
import os
import uuid
from app import db
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
                         posts=posts, category=category)og import bp
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

@bp.route('/')
def index():
    """博客首页 - 使用缓存和查询优化"""
    page = request.args.get('page', 1, type=int)
    category_name = request.args.get('category')
    sort_by = request.args.get('sort', 'timestamp')  # 支持排序: timestamp, views, likes
    
    try:
        # 使用缓存获取文章列表
        cached_posts = get_cached_posts_list(page=page, per_page=5, category=category_name)
        
        # 创建分页对象的模拟
        class CachedPagination:
            def __init__(self, data):
                self.items = [type('Post', (), item) for item in data['items']]
                self.total = data['total']
                self.pages = data['pages']
                self.page = data['page']
                self.per_page = data['per_page']
                self.has_prev = data['has_prev']
                self.has_next = data['has_next']
                self.prev_num = data.get('prev_num')
                self.next_num = data.get('next_num')
        
        posts = CachedPagination(cached_posts)
        
        # 使用缓存获取分类
        categories_data = get_cached_categories()
        categories = [type('Category', (), {'name': cat['name'], 'post_count': cat['post_count']}) 
                     for cat in categories_data]
        
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
        categories = [cat[0] for cat in categories_with_counts]  # 提取Category对象
    
    return render_template('blog/index.html', title='博客', posts=posts, categories=categories)

@bp.route('/post/<int:id>')
def post(id):
    """文章详情页 - 使用查询优化"""
    # 使用优化查询获取文章和评论
    comments_page = request.args.get('page', 1, type=int)
    
    post, comments = QueryOptimization.get_post_with_comments(
        post_id=id,
        comments_page=comments_page,
        comments_per_page=10
    )
    
    # 增加访问量
    post.views += 1
    db.session.commit()
    
    # 获取相关文章 - 基于分类和标签的相关性
    related_posts = []
    if post.category_id:
        related_posts = QueryOptimization.get_posts_with_relations(
            page=1,
            per_page=5,
            category_id=post.category_id,
            published_only=True
        ).items
        # 排除当前文章
        related_posts = [p for p in related_posts if p.id != post.id]
    
    # 如果相关文章不足，补充其他文章
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
def create_post():
    """创建文章"""
    form = PostForm()
    
    if form.validate_on_submit():
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
            published=form.published.data
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
        
        flash('文章发表成功！', 'success')
        return redirect(url_for('blog.post', id=post.id))
    
    return render_template('blog/create_post.html', title='创建文章', form=form)

@bp.route('/edit/<int:id>', methods=['GET', 'POST'])
@login_required
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
    """分类页面"""
    category = Category.query.filter_by(name=name).first_or_404()
    page = request.args.get('page', 1, type=int)
    posts = Post.query.filter_by(category=category, published=True).order_by(
        Post.timestamp.desc()).paginate(
        page=page, per_page=5, error_out=False)
    
    return render_template('blog/category.html', title=f'分类: {category.name}',
                         posts=posts, category=category)

@bp.route('/tag/<name>')
def tag(name):
    """标签页面"""
    tag = Tag.query.filter_by(name=name).first_or_404()
    page = request.args.get('page', 1, type=int)
    posts = tag.posts.filter_by(published=True).order_by(
        Post.timestamp.desc()).paginate(
        page=page, per_page=5, error_out=False)
    
    return render_template('blog/tag.html', title=f'标签: {tag.name}',
                         posts=posts, tag=tag)

@bp.route('/delete/<int:id>', methods=['POST'])
@login_required
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
