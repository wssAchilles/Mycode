from functools import wraps
from flask import jsonify, request
from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity
from app.models import User

def token_required(f):
    """装饰器：验证JWT令牌"""
    @wraps(f)
    def decorated(*args, **kwargs):
        try:
            verify_jwt_in_request()
            current_user_id = get_jwt_identity()
            current_user = User.query.get(current_user_id)
            if not current_user:
                return jsonify({'message': '用户不存在'}), 401
        except Exception as e:
            return jsonify({'message': '令牌无效'}), 401
        
        return f(current_user, *args, **kwargs)
    
    return decorated

def admin_required(f):
    """装饰器：需要管理员权限"""
    @wraps(f)
    def decorated(*args, **kwargs):
        try:
            verify_jwt_in_request()
            current_user_id = get_jwt_identity()
            current_user = User.query.get(current_user_id)
            if not current_user or not current_user.is_admin:
                return jsonify({'message': '需要管理员权限'}), 403
        except Exception as e:
            return jsonify({'message': '令牌无效'}), 401
        
        return f(current_user, *args, **kwargs)
    
    return decorated
