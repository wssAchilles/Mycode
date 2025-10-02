import os
from flask import render_template, redirect, url_for, flash, request, abort, jsonify, current_app, send_file
from flask_login import current_user, login_required
from sqlalchemy import and_, or_, desc, asc
from datetime import datetime

from app import db
from app.media import bp
from app.models import MediaFile, MediaFolder, PostMediaFile, User
from app.media.forms import (MediaUploadForm, MediaEditForm, MediaFolderForm, 
                            MediaSearchForm, MediaBatchOperationForm)
from app.media.utils import MediaFileProcessor


@bp.route('/')
@login_required
def index():
    """媒体库主页"""
    # 获取搜索参数
    form = MediaSearchForm()
    
    # 构建查询
    query = MediaFile.query.filter_by(is_active=True)
    
    # 应用过滤条件
    if form.validate():
        if form.keyword.data:
            keyword = f"%{form.keyword.data}%"
            query = query.filter(
                or_(
                    MediaFile.filename.like(keyword),
                    MediaFile.description.like(keyword),
                    MediaFile.tags.like(keyword),
                    MediaFile.alt_text.like(keyword)
                )
            )
        
        if form.file_type.data:
            query = query.filter_by(file_type=form.file_type.data)
        
        if form.uploader.data:
            query = query.filter_by(uploaded_by=form.uploader.data)
        
        if form.is_public.data:
            query = query.filter_by(is_public=bool(int(form.is_public.data)))
        
        # 排序
        sort_by = form.sort_by.data or 'uploaded_at_desc'
        if sort_by == 'uploaded_at_desc':
            query = query.order_by(desc(MediaFile.uploaded_at))
        elif sort_by == 'uploaded_at_asc':
            query = query.order_by(asc(MediaFile.uploaded_at))
        elif sort_by == 'filename_asc':
            query = query.order_by(asc(MediaFile.filename))
        elif sort_by == 'filename_desc':
            query = query.order_by(desc(MediaFile.filename))
        elif sort_by == 'file_size_desc':
            query = query.order_by(desc(MediaFile.file_size))
        elif sort_by == 'file_size_asc':
            query = query.order_by(asc(MediaFile.file_size))
        elif sort_by == 'download_count_desc':
            query = query.order_by(desc(MediaFile.download_count))
    
    # 分页
    page = request.args.get('page', 1, type=int)
    per_page = current_app.config.get('MEDIA_PER_PAGE', 20)
    media_files = query.paginate(
        page=page, per_page=per_page, error_out=False
    )
    
    # 获取文件夹列表
    folders = MediaFolder.query.filter_by(is_active=True).all()
    
    # 统计信息
    stats = {
        'total_files': MediaFile.query.filter_by(is_active=True).count(),
        'total_size': db.session.query(db.func.sum(MediaFile.file_size)).scalar() or 0,
        'image_count': MediaFile.query.filter_by(is_active=True, file_type='image').count(),
        'video_count': MediaFile.query.filter_by(is_active=True, file_type='video').count(),
        'audio_count': MediaFile.query.filter_by(is_active=True, file_type='audio').count(),
        'document_count': MediaFile.query.filter_by(is_active=True, file_type='document').count(),
    }
    
    return render_template('media/index.html',
                         title='媒体库',
                         media_files=media_files,
                         folders=folders,
                         stats=stats,
                         form=form)


@bp.route('/upload', methods=['GET', 'POST'])
@login_required
def upload():
    """文件上传"""
    form = MediaUploadForm()
    
    if form.validate_on_submit():
        uploaded_files = []
        errors = []
        
        for file in form.files.data:
            try:
                # 处理文件上传
                file_info = MediaFileProcessor.save_file(file, form.folder_id.data)
                
                # 创建数据库记录
                media_file = MediaFile(
                    filename=file_info['filename'],
                    stored_filename=file_info['stored_filename'],
                    file_path=file_info['file_path'],
                    file_url=file_info['file_url'],
                    file_type=file_info['file_type'],
                    mime_type=file_info['mime_type'],
                    file_size=file_info['file_size'],
                    dimensions=file_info['dimensions'],
                    duration=file_info['duration'],
                    description=form.description.data,
                    tags=form.tags.data,
                    uploaded_by=current_user.id,
                    is_public=form.is_public.data
                )
                
                db.session.add(media_file)
                uploaded_files.append(file_info['filename'])
                
            except Exception as e:
                errors.append(f"{file.filename}: {str(e)}")
        
        try:
            db.session.commit()
            
            if uploaded_files:
                flash(f'成功上传 {len(uploaded_files)} 个文件', 'success')
            
            if errors:
                for error in errors:
                    flash(error, 'error')
            
            return redirect(url_for('media.index'))
            
        except Exception as e:
            db.session.rollback()
            flash(f'保存文件信息失败: {str(e)}', 'error')
    
    return render_template('media/upload.html', title='上传文件', form=form)


@bp.route('/file/<int:file_id>')
@login_required
def file_detail(file_id):
    """文件详情"""
    media_file = MediaFile.query.get_or_404(file_id)
    
    # 检查权限
    if not media_file.is_public and media_file.uploaded_by != current_user.id and not current_user.is_admin:
        abort(403)
    
    # 增加访问计数
    media_file.last_accessed = datetime.utcnow()
    db.session.commit()
    
    # 获取关联的文章
    associated_posts = db.session.query(PostMediaFile).filter_by(
        media_file_id=file_id
    ).join(PostMediaFile.post).all()
    
    return render_template('media/file_detail.html',
                         title=f'文件详情 - {media_file.filename}',
                         media_file=media_file,
                         associated_posts=associated_posts)


@bp.route('/file/<int:file_id>/edit', methods=['GET', 'POST'])
@login_required
def edit_file(file_id):
    """编辑文件信息"""
    media_file = MediaFile.query.get_or_404(file_id)
    
    # 检查权限
    if media_file.uploaded_by != current_user.id and not current_user.is_admin:
        abort(403)
    
    form = MediaEditForm()
    
    if form.validate_on_submit():
        media_file.filename = form.filename.data
        media_file.description = form.description.data
        media_file.alt_text = form.alt_text.data
        media_file.tags = form.tags.data
        media_file.is_public = form.is_public.data
        
        if current_user.is_admin:
            media_file.is_active = form.is_active.data
        
        try:
            db.session.commit()
            flash('文件信息已更新', 'success')
            return redirect(url_for('media.file_detail', file_id=file_id))
        except Exception as e:
            db.session.rollback()
            flash(f'更新失败: {str(e)}', 'error')
    
    # 填充表单
    if request.method == 'GET':
        form.filename.data = media_file.filename
        form.description.data = media_file.description
        form.alt_text.data = media_file.alt_text
        form.tags.data = media_file.tags
        form.is_public.data = media_file.is_public
        form.is_active.data = media_file.is_active
    
    return render_template('media/edit_file.html',
                         title=f'编辑文件 - {media_file.filename}',
                         form=form,
                         media_file=media_file)


@bp.route('/file/<int:file_id>/delete', methods=['POST'])
@login_required
def delete_file(file_id):
    """删除文件"""
    media_file = MediaFile.query.get_or_404(file_id)
    
    # 检查权限
    if media_file.uploaded_by != current_user.id and not current_user.is_admin:
        abort(403)
    
    try:
        # 删除物理文件
        MediaFileProcessor.delete_file(media_file)
        
        # 删除数据库记录
        db.session.delete(media_file)
        db.session.commit()
        
        flash('文件已删除', 'success')
    except Exception as e:
        db.session.rollback()
        flash(f'删除失败: {str(e)}', 'error')
    
    return redirect(url_for('media.index'))


@bp.route('/file/<int:file_id>/download')
@login_required
def download_file(file_id):
    """下载文件"""
    media_file = MediaFile.query.get_or_404(file_id)
    
    # 检查权限
    if not media_file.is_public and media_file.uploaded_by != current_user.id and not current_user.is_admin:
        abort(403)
    
    # 增加下载计数
    media_file.increment_download_count()
    
    # 返回文件
    file_path = os.path.join(current_app.static_folder, media_file.file_path)
    
    if os.path.exists(file_path):
        return send_file(file_path, as_attachment=True, download_name=media_file.filename)
    else:
        abort(404)


@bp.route('/folders')
@login_required
def folders():
    """文件夹管理"""
    folders = MediaFolder.query.filter_by(is_active=True).all()
    return render_template('media/folders.html', title='文件夹管理', folders=folders)


@bp.route('/folder/create', methods=['GET', 'POST'])
@login_required
def create_folder():
    """创建文件夹"""
    form = MediaFolderForm()
    
    if form.validate_on_submit():
        folder = MediaFolder(
            name=form.name.data,
            description=form.description.data,
            parent_id=form.parent_id.data if form.parent_id.data else None,
            created_by=current_user.id
        )
        
        try:
            db.session.add(folder)
            db.session.commit()
            flash('文件夹创建成功', 'success')
            return redirect(url_for('media.folders'))
        except Exception as e:
            db.session.rollback()
            flash(f'创建失败: {str(e)}', 'error')
    
    return render_template('media/create_folder.html', title='创建文件夹', form=form)


@bp.route('/batch-operation', methods=['POST'])
@login_required
def batch_operation():
    """批量操作"""
    form = MediaBatchOperationForm()
    
    if form.validate_on_submit():
        try:
            media_ids = [int(id) for id in form.media_ids.data.split(',')]
            media_files = MediaFile.query.filter(MediaFile.id.in_(media_ids)).all()
            
            # 检查权限
            for media_file in media_files:
                if media_file.uploaded_by != current_user.id and not current_user.is_admin:
                    flash(f'没有权限操作文件: {media_file.filename}', 'error')
                    return redirect(url_for('media.index'))
            
            operation = form.operation.data
            success_count = 0
            
            if operation == 'delete':
                for media_file in media_files:
                    MediaFileProcessor.delete_file(media_file)
                    db.session.delete(media_file)
                    success_count += 1
            
            elif operation == 'set_public':
                for media_file in media_files:
                    media_file.is_public = True
                    success_count += 1
            
            elif operation == 'set_private':
                for media_file in media_files:
                    media_file.is_public = False
                    success_count += 1
            
            elif operation == 'add_tags':
                new_tags = form.tags_to_add.data
                if new_tags:
                    for media_file in media_files:
                        existing_tags = media_file.get_tags_list()
                        new_tags_list = [tag.strip() for tag in new_tags.split(',')]
                        combined_tags = list(set(existing_tags + new_tags_list))
                        media_file.set_tags_list(combined_tags)
                        success_count += 1
            
            elif operation == 'remove_tags':
                tags_to_remove = form.tags_to_remove.data
                if tags_to_remove:
                    tags_to_remove_list = [tag.strip() for tag in tags_to_remove.split(',')]
                    for media_file in media_files:
                        existing_tags = media_file.get_tags_list()
                        filtered_tags = [tag for tag in existing_tags if tag not in tags_to_remove_list]
                        media_file.set_tags_list(filtered_tags)
                        success_count += 1
            
            db.session.commit()
            flash(f'批量操作完成，处理了 {success_count} 个文件', 'success')
            
        except Exception as e:
            db.session.rollback()
            flash(f'批量操作失败: {str(e)}', 'error')
    
    return redirect(url_for('media.index'))


# API 路由用于前端交互

@bp.route('/api/files')
@login_required
def api_files():
    """获取文件列表API"""
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    file_type = request.args.get('type')
    keyword = request.args.get('keyword')
    
    query = MediaFile.query.filter_by(is_active=True)
    
    if file_type:
        query = query.filter_by(file_type=file_type)
    
    if keyword:
        keyword_filter = f"%{keyword}%"
        query = query.filter(
            or_(
                MediaFile.filename.like(keyword_filter),
                MediaFile.description.like(keyword_filter),
                MediaFile.tags.like(keyword_filter)
            )
        )
    
    # 权限过滤
    if not current_user.is_admin:
        query = query.filter(
            or_(
                MediaFile.is_public == True,
                MediaFile.uploaded_by == current_user.id
            )
        )
    
    files = query.order_by(desc(MediaFile.uploaded_at)).paginate(
        page=page, per_page=per_page, error_out=False
    )
    
    return jsonify({
        'files': [{
            'id': f.id,
            'filename': f.filename,
            'file_url': f.file_url,
            'thumbnail_url': MediaFileProcessor.get_thumbnail_url(f),
            'file_type': f.file_type,
            'file_size': f.formatted_size,
            'uploaded_at': f.uploaded_at.strftime('%Y-%m-%d %H:%M'),
            'dimensions': f.dimensions,
            'alt_text': f.alt_text
        } for f in files.items],
        'pagination': {
            'page': files.page,
            'pages': files.pages,
            'per_page': files.per_page,
            'total': files.total,
            'has_next': files.has_next,
            'has_prev': files.has_prev
        }
    })


@bp.route('/api/file/<int:file_id>/use')
@login_required
def api_use_file(file_id):
    """获取文件使用信息API"""
    media_file = MediaFile.query.get_or_404(file_id)
    
    # 检查权限
    if not media_file.is_public and media_file.uploaded_by != current_user.id and not current_user.is_admin:
        abort(403)
    
    return jsonify({
        'id': media_file.id,
        'filename': media_file.filename,
        'file_url': media_file.file_url,
        'alt_text': media_file.alt_text or media_file.filename,
        'dimensions': media_file.dimensions,
        'file_type': media_file.file_type
    })


@bp.route('/api/upload', methods=['POST'])
@login_required
def api_upload():
    """API文件上传（用于编辑器）"""
    if 'file' not in request.files:
        return jsonify({'error': '没有文件'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': '没有选择文件'}), 400
    
    try:
        # 处理文件上传
        file_info = MediaFileProcessor.save_file(file)
        
        # 创建数据库记录
        media_file = MediaFile(
            filename=file_info['filename'],
            stored_filename=file_info['stored_filename'],
            file_path=file_info['file_path'],
            file_url=file_info['file_url'],
            file_type=file_info['file_type'],
            mime_type=file_info['mime_type'],
            file_size=file_info['file_size'],
            dimensions=file_info['dimensions'],
            duration=file_info['duration'],
            uploaded_by=current_user.id,
            is_public=True
        )
        
        db.session.add(media_file)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'file': {
                'id': media_file.id,
                'filename': media_file.filename,
                'file_url': media_file.file_url,
                'file_type': media_file.file_type,
                'thumbnail_url': MediaFileProcessor.get_thumbnail_url(media_file)
            }
        })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400
