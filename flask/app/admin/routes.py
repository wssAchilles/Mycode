from flask import render_template, redirect, url_for, flash, request
from flask_login import login_required, current_user
from app import db
from app.admin import bp
from app.admin.utils import admin_required
from app.models import User, Post, Comment, Category, Tag
from app.blog.forms import CategoryForm, TagForm, PostForm
from app.admin.forms import EditUserForm  # Import EditUserForm

@bp.route('/')
@login_required
@admin_required
def index():
    """管理员仪表板"""
    # 统计信息
    user_count = User.query.count()
    post_count = Post.query.count()
    comment_count = Comment.query.count()
    category_count = Category.query.count()
    
    # 最新文章
    recent_posts = Post.query.order_by(Post.created_at.desc()).limit(5).all()
    
    # 最新评论
    recent_comments = Comment.query.order_by(Comment.timestamp.desc()).limit(5).all()
    
    return render_template('admin/dashboard.html', title='管理仪表板',
                         user_count=user_count, post_count=post_count,
                         comment_count=comment_count, category_count=category_count,
                         recent_posts=recent_posts, recent_comments=recent_comments)

@bp.route('/users')
@login_required
@admin_required
def users():
    """用户管理"""
    page = request.args.get('page', 1, type=int)
    users = User.query.order_by(User.member_since.desc()).paginate(
        page=page, per_page=20, error_out=False)
    
    return render_template('admin/users.html', title='用户管理', users=users)

@bp.route('/posts')
@login_required
@admin_required
def posts():
    """文章管理"""
    page = request.args.get('page', 1, type=int)
    posts = Post.query.order_by(Post.created_at.desc()).paginate(
        page=page, per_page=20, error_out=False)
    
    return render_template('admin/posts.html', title='文章管理', posts=posts)

@bp.route('/comments')
@login_required
@admin_required
def comments():
    """评论管理"""
    page = request.args.get('page', 1, type=int)
    comments = Comment.query.order_by(Comment.timestamp.desc()).paginate(
        page=page, per_page=20, error_out=False)
    
    return render_template('admin/comments.html', title='评论管理', comments=comments)

@bp.route('/categories')
@login_required
@admin_required
def categories():
    """分类管理"""
    page = request.args.get('page', 1, type=int)
    categories = Category.query.order_by(Category.name).paginate(
        page=page, per_page=20, error_out=False
    )
    return render_template('admin/categories.html', title='分类管理', 
                         categories=categories)

@bp.route('/categories/new', methods=['GET', 'POST'])
@login_required
@admin_required
def new_category():
    """新建分类"""
    form = CategoryForm()
    if form.validate_on_submit():
        # 名称唯一性校验
        exists = Category.query.filter(Category.name == form.name.data).first()
        if exists:
            form.name.errors.append('分类名称已存在，请更换。')
        else:
            category = Category(
                name=form.name.data,
                description=form.description.data
            )
            db.session.add(category)
            db.session.commit()
            flash('分类创建成功！', 'success')
            return redirect(url_for('admin.categories'))
    
    return render_template('admin/new_category.html', title='新建分类', form=form)

@bp.route('/tags')
@login_required
@admin_required
def tags():
    """标签管理"""
    page = request.args.get('page', 1, type=int)
    tags = Tag.query.order_by(Tag.name).paginate(
        page=page, per_page=20, error_out=False
    )
    return render_template('admin/tags.html', title='标签管理', tags=tags)

@bp.route('/tags/new', methods=['GET', 'POST'])
@login_required
@admin_required
def new_tag():
    """新建标签"""
    form = TagForm()
    if form.validate_on_submit():
        # 名称唯一性校验
        exists = Tag.query.filter(Tag.name == form.name.data).first()
        if exists:
            form.name.errors.append('标签名称已存在，请更换。')
        else:
            tag = Tag(
                name=form.name.data,
                color=form.color.data
            )
            db.session.add(tag)
            db.session.commit()
            flash('标签创建成功！', 'success')
            return redirect(url_for('admin.tags'))
    
    return render_template('admin/new_tag.html', title='新建标签', form=form)

@bp.route('/categories/<int:category_id>/edit', methods=['GET', 'POST'])
@login_required
@admin_required
def edit_category(category_id):
    """编辑分类"""
    category = Category.query.get_or_404(category_id)
    form = CategoryForm()
    if form.validate_on_submit():
        # 名称唯一性校验（排除自身）
        exists = Category.query.filter(Category.name == form.name.data, Category.id != category.id).first()
        if exists:
            form.name.errors.append('分类名称已存在，请更换。')
        else:
            category.name = form.name.data
            category.description = form.description.data
            db.session.commit()
            flash('分类已更新', 'success')
            return redirect(url_for('admin.categories'))
    elif request.method == 'GET':
        form.name.data = category.name
        form.description.data = category.description
    return render_template('admin/edit_category.html', title='编辑分类', form=form, category=category)

@bp.route('/categories/<int:category_id>/delete', methods=['POST'])
@login_required
@admin_required
def delete_category(category_id):
    """删除分类（当无文章关联时）"""
    category = Category.query.get_or_404(category_id)
    # 阻止删除仍有关联文章的分类
    if category.posts.count() > 0:
        flash('该分类下仍有关联文章，无法删除。请先迁移或删除关联文章。', 'warning')
        return redirect(url_for('admin.categories'))
    db.session.delete(category)
    db.session.commit()
    flash('分类已删除', 'success')
    return redirect(url_for('admin.categories'))

@bp.route('/tags/<int:tag_id>/edit', methods=['GET', 'POST'])
@login_required
@admin_required
def edit_tag(tag_id):
    """编辑标签"""
    tag = Tag.query.get_or_404(tag_id)
    form = TagForm()
    if form.validate_on_submit():
        # 名称唯一性校验（排除自身）
        exists = Tag.query.filter(Tag.name == form.name.data, Tag.id != tag.id).first()
        if exists:
            form.name.errors.append('标签名称已存在，请更换。')
        else:
            tag.name = form.name.data
            tag.color = form.color.data
            db.session.commit()
            flash('标签已更新', 'success')
            return redirect(url_for('admin.tags'))
    elif request.method == 'GET':
        form.name.data = tag.name
        form.color.data = tag.color
    return render_template('admin/edit_tag.html', title='编辑标签', form=form, tag=tag)

@bp.route('/tags/<int:tag_id>/delete', methods=['POST'])
@login_required
@admin_required
def delete_tag(tag_id):
    """删除标签（当无文章关联时）"""
    tag = Tag.query.get_or_404(tag_id)
    # 阻止删除仍有关联文章的标签
    if tag.posts and len(tag.posts) > 0:
        flash('该标签仍与文章关联，无法删除。请先移除文章中的该标签。', 'warning')
        return redirect(url_for('admin.tags'))
    db.session.delete(tag)
    db.session.commit()
    flash('标签已删除', 'success')
    return redirect(url_for('admin.tags'))

@bp.route('/create-post', methods=['GET', 'POST'])
@login_required
@admin_required
def create_post():
    """创建新文章"""
    form = PostForm()
    if form.validate_on_submit():
        post = Post(
            title=form.title.data,
            content=form.content.data,
            author=current_user
        )
        db.session.add(post)
        db.session.commit()
        flash('文章已创建', 'success')
        return redirect(url_for('admin.posts'))
    return render_template('admin/edit_post.html', title='创建文章', form=form)

@bp.route('/edit-post/<int:post_id>', methods=['GET', 'POST'])
@login_required
@admin_required
def edit_post(post_id):
    """编辑文章"""
    post = Post.query.get_or_404(post_id)
    form = PostForm()
    if form.validate_on_submit():
        post.title = form.title.data
        post.content = form.content.data
        db.session.commit()
        flash('文章已更新', 'success')
        return redirect(url_for('admin.posts'))
    elif request.method == 'GET':
        form.title.data = post.title
        form.content.data = post.content
    return render_template('admin/edit_post.html', title='编辑文章', form=form, post=post)

@bp.route('/delete-post/<int:post_id>')
@login_required
@admin_required
def delete_post(post_id):
    """删除文章"""
    post = Post.query.get_or_404(post_id)
    db.session.delete(post)
    db.session.commit()
    flash('文章已删除', 'success')
    return redirect(url_for('admin.posts'))

@bp.route('/posts/<int:id>/delete', methods=['POST'])
@login_required
@admin_required
def delete_post_old(id):
    """删除文章"""
    post = Post.query.get_or_404(id)
    db.session.delete(post)
    db.session.commit()
    flash('文章已删除！', 'success')
    return redirect(url_for('admin.posts'))

@bp.route('/comments/<int:id>/approve', methods=['POST'])
@login_required
@admin_required
def approve_comment(id):
    """审核通过评论"""
    comment = Comment.query.get_or_404(id)
    comment.approved = True
    db.session.commit()
    flash('评论已审核通过！', 'success')
    return redirect(url_for('admin.comments'))

@bp.route('/comments/<int:id>/delete', methods=['POST'])
@login_required
@admin_required
def delete_comment(id):
    """删除评论"""
    comment = Comment.query.get_or_404(id)
    db.session.delete(comment)
    db.session.commit()
    flash('评论已删除！', 'success')
    return redirect(url_for('admin.comments'))

@bp.route('/edit-user/<int:user_id>', methods=['GET', 'POST'])
@login_required
@admin_required
def edit_user(user_id):
    """编辑用户"""
    user = User.query.get_or_404(user_id)
    form = EditUserForm()
    
    if form.validate_on_submit():
        user.username = form.username.data
        user.email = form.email.data
        user.is_admin = form.is_admin.data
        user.confirmed = form.confirmed.data
        db.session.commit()
        flash('用户信息已更新', 'success')
        return redirect(url_for('admin.users'))
    
    elif request.method == 'GET':
        form.username.data = user.username
        form.email.data = user.email
        form.is_admin.data = user.is_admin
        form.confirmed.data = user.confirmed
    
    return render_template('admin/edit_user.html', title='编辑用户', form=form, user=user)
