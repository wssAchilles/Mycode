import 'package:supabase_flutter/supabase_flutter.dart';
import '../models/profile.dart';

/// 全局认证和用户状态管理服务
/// 负责管理当前登录用户的完整信息，包括角色权限
class AuthService {
  static final AuthService _instance = AuthService._internal();
  factory AuthService() => _instance;
  AuthService._internal();

  final SupabaseClient _supabase = Supabase.instance.client;
  
  Profile? _currentProfile;
  
  /// 获取当前用户的完整资料信息
  Profile? get currentProfile => _currentProfile;
  
  /// 获取当前用户ID
  String? get currentUserId => _supabase.auth.currentUser?.id;
  
  /// 判断用户是否已登录
  bool get isLoggedIn => _supabase.auth.currentUser != null;
  
  /// 判断当前用户是否为管理员
  bool get isAdmin => _currentProfile?.isAdmin ?? false;
  
  /// 判断当前用户是否为普通老师
  bool get isTeacher => _currentProfile?.isTeacher ?? true;

  /// 初始化用户状态 - 在应用启动和登录后调用
  Future<void> initializeUserState() async {
    final user = _supabase.auth.currentUser;
    if (user != null) {
      await _loadUserProfile(user.id);
    } else {
      _currentProfile = null;
    }
  }

  /// 从数据库加载用户完整资料信息
  Future<void> _loadUserProfile(String userId) async {
    try {
      final response = await _supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .single();
      
      _currentProfile = Profile.fromJson(response);
    } catch (e) {
      print('加载用户资料失败: $e');
      _currentProfile = null;
    }
  }

  /// 用户登录后调用，更新用户状态
  Future<void> onUserLoggedIn() async {
    await initializeUserState();
  }

  /// 用户登出后调用，清理用户状态
  void onUserLoggedOut() {
    _currentProfile = null;
  }

  /// 刷新当前用户资料信息
  Future<void> refreshCurrentProfile() async {
    if (currentUserId != null) {
      await _loadUserProfile(currentUserId!);
    }
  }

  /// 更新用户资料信息
  Future<void> updateProfile({
    String? fullName,
    String? role,
  }) async {
    if (currentUserId == null) return;

    try {
      final Map<String, dynamic> updates = {};
      if (fullName != null) updates['full_name'] = fullName;
      if (role != null) updates['role'] = role;

      if (updates.isNotEmpty) {
        await _supabase
            .from('profiles')
            .update(updates)
            .eq('id', currentUserId!);
        
        // 更新本地缓存
        await refreshCurrentProfile();
      }
    } catch (e) {
      throw Exception('更新用户资料失败: $e');
    }
  }

  /// 检查是否有访问管理员功能的权限
  bool hasAdminAccess() {
    return isLoggedIn && isAdmin;
  }

  /// 获取用户显示名称
  String get displayName {
    return _currentProfile?.fullName ?? '未知用户';
  }

  /// 获取用户角色显示名称
  String get roleDisplayName {
    switch (_currentProfile?.role) {
      case 'admin':
        return '超级管理员';
      case 'teacher':
        return '普通老师';
      default:
        return '未知角色';
    }
  }
}
