from flask import render_template, request
from app import db
from app.errors import bp

def wants_json_response():
    """检查客户端是否期望JSON响应"""
    return request.accept_mimetypes['application/json'] >= \
        request.accept_mimetypes['text/html']

@bp.app_errorhandler(404)
def not_found_error(error):
    """404错误处理"""
    if wants_json_response():
        return {'error': '页面未找到'}, 404
    return render_template('errors/404.html', title='页面未找到'), 404

@bp.app_errorhandler(403)
def forbidden_error(error):
    """403错误处理"""
    if wants_json_response():
        return {'error': '访问被禁止'}, 403
    return render_template('errors/403.html', title='访问被禁止'), 403

@bp.app_errorhandler(500)
def internal_error(error):
    """500错误处理"""
    db.session.rollback()
    if wants_json_response():
        return {'error': '服务器内部错误'}, 500
    return render_template('errors/500.html', title='服务器错误'), 500

@bp.app_errorhandler(413)
def too_large_error(error):
    """文件过大错误处理"""
    if wants_json_response():
        return {'error': '上传文件过大'}, 413
    return render_template('errors/413.html', title='文件过大'), 413
