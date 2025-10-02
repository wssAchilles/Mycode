import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../config/filebase_config.dart';
import '../models/user_model.dart';
import 'filebase_service.dart';

/// 身份验证服务
/// 
/// 负责处理用户注册、登录、登出以及管理用户会话
class AuthService with ChangeNotifier {
  /// 文件存储服务实例
  final FilebaseService _filebaseService;
  
  /// 当前登录的用户
  UserModel? _currentUser;
  
  /// 登录状态
  bool get isLoggedIn => _currentUser != null;
  
  /// 获取当前登录的用户
  UserModel? get currentUser => _currentUser;
  
  /// 构造函数
  AuthService(this._filebaseService);
  
  /// 生成唯一用户ID
  String _generateUserId() {
    final random = Random.secure();
    final values = List<int>.generate(16, (index) => random.nextInt(256));
    return base64Url.encode(values).replaceAll('_', '').replaceAll('-', '').substring(0, 16);
  }
  
  /// 对密码进行哈希处理
  /// 
  /// 注意：在实际生产环境中，应使用更安全的密码哈希算法，
  /// 如 bcrypt、Argon2 或 PBKDF2，并添加盐值。
  /// 这里仅作为简单示例。
  String _hashPassword(String password) {
    final bytes = utf8.encode(password);
    final digest = sha256.convert(bytes);
    return digest.toString();
  }
  
  /// 用户注册
  /// 
  /// [username] - 用户名
  /// [password] - 密码（将会被哈希处理）
  /// 返回注册结果，成功则返回新用户
  Future<UserModel?> register(String username, String password) async {
    try {
      // 检查用户名是否已存在
      final isUsernameTaken = await _isUsernameTaken(username);
      if (isUsernameTaken) {
        print('用户名已存在');
        return null;
      }
      
      // 生成唯一用户ID
      final userId = _generateUserId();
      
      // 对密码进行哈希处理
      final passwordHash = _hashPassword(password);
      
      // 创建新用户
      final newUser = UserModel(
        userId: userId,
        username: username,
        passwordHash: passwordHash,
        avatarIpfsCid: null,
        createdAt: DateTime.now(),
      );
      
      // 保存用户数据到 Filebase
      await _filebaseService.uploadJson(
        FilebaseConfig.userDataBucket, 
        'users/$userId.json', 
        newUser.toJson(),
      );
      
      // 保存用户名到用户ID的映射，方便登录时通过用户名查找用户
      await _saveUsernameMapping(username, userId);
      
      // 设置当前用户并通知监听器
      _currentUser = newUser;
      notifyListeners();
      
      print('用户注册成功: $username');
      return newUser;
    } catch (e) {
      print('注册失败: $e');
      return null;
    }
  }
  
  /// 检查用户名是否已被使用
  Future<bool> _isUsernameTaken(String username) async {
    try {
      // 尝试获取用户名到用户ID的映射
      final usernameMappingKey = 'mappings/username_to_userid.json';
      final mapping = await _filebaseService.downloadJson(
        FilebaseConfig.userDataBucket,
        usernameMappingKey,
      );
      
      // 如果映射存在且包含该用户名，则用户名已被使用
      if (mapping != null && mapping.containsKey(username)) {
        return true;
      }
      
      return false;
    } catch (e) {
      print('检查用户名失败: $e');
      return false;
    }
  }
  
  /// 保存用户名到用户ID的映射
  Future<void> _saveUsernameMapping(String username, String userId) async {
    try {
      final usernameMappingKey = 'mappings/username_to_userid.json';
      
      // 尝试获取现有映射
      Map<String, dynamic> mapping = await _filebaseService.downloadJson(
        FilebaseConfig.userDataBucket,
        usernameMappingKey,
      ) ?? {};
      
      // 添加新的映射
      mapping[username] = userId;
      
      // 保存更新的映射
      await _filebaseService.uploadJson(
        FilebaseConfig.userDataBucket,
        usernameMappingKey,
        mapping,
      );
    } catch (e) {
      print('保存用户名映射失败: $e');
    }
  }
  
  /// 用户登录
  /// 
  /// [username] - 用户名
  /// [password] - 密码
  /// 返回登录结果，成功则返回用户
  Future<UserModel?> login(String username, String password) async {
    print('开始登录流程，用户名: $username');
    
    try {
      // 获取用户ID
      print('正在获取用户ID...');
      final userId = await _getUserIdByUsername(username);
      if (userId == null) {
        print('用户不存在: $username');
        return null;
      }
      print('成功获取用户ID: $userId');
      
      // 获取用户数据
      print('正在获取用户数据...');
      final userData = await _filebaseService.downloadJson(
        FilebaseConfig.userDataBucket,
        'users/$userId.json',
      );
      
      if (userData == null) {
        print('用户数据不存在');
        return null;
      }
      print('成功获取用户数据');
      
      // 解析用户数据
      print('正在解析用户数据...');
      final user = UserModel.fromJson(userData);
      print('用户数据解析成功');
      
      // 验证密码
      print('正在验证密码...');
      final inputPasswordHash = _hashPassword(password);
      if (user.passwordHash != inputPasswordHash) {
        print('密码错误');
        return null;
      }
      print('密码验证成功');
      
      // 设置当前用户并通知监听器
      print('正在设置当前用户...');
      _currentUser = user;
      notifyListeners();
      
      print('登录成功: ${user.username}');
      return user;
    } catch (e) {
      print('登录失败，发生异常: $e');
      return null;
    }
  }
  
  /// 通过用户名获取用户ID
  Future<String?> _getUserIdByUsername(String username) async {
    try {
      final usernameMappingKey = 'mappings/username_to_userid.json';
      final mapping = await _filebaseService.downloadJson(
        FilebaseConfig.userDataBucket,
        usernameMappingKey,
      );
      
      if (mapping != null && mapping.containsKey(username)) {
        return mapping[username] as String;
      }
      
      return null;
    } catch (e) {
      print('获取用户ID失败: $e');
      return null;
    }
  }
  
  /// 登出当前用户
  void logout() {
    _currentUser = null;
    notifyListeners();
    print('用户已登出');
  }
  
  /// 更新用户信息
  /// 
  /// [updatedUser] - 更新后的用户数据
  Future<bool> updateUser(UserModel updatedUser) async {
    try {
      // 保存更新的用户数据
      await _filebaseService.uploadJson(
        FilebaseConfig.userDataBucket,
        'users/${updatedUser.userId}.json',
        updatedUser.toJson(),
      );
      
      // 更新当前用户并通知监听器
      _currentUser = updatedUser;
      notifyListeners();
      
      print('用户信息更新成功: ${updatedUser.username}');
      return true;
    } catch (e) {
      print('更新用户信息失败: $e');
      return false;
    }
  }
  
  /// 更新用户资料
  /// 
  /// 支持同时更新用户名和头像，会根据提供的参数来决定要更新的内容
  /// [newUsername] - 新的用户名，为 null 则不更新
  /// [newAvatarFilePath] - 新的头像文件路径，为 null 则不更新
  Future<UserModel?> updateUserProfile({String? newUsername, String? newAvatarFilePath}) async {
    try {
      if (_currentUser == null) {
        print('未登录，无法更新用户资料');
        return null;
      }
      
      // 复制当前用户数据作为基础
      UserModel updatedUser = _currentUser!;
      String? avatarIpfsCid = updatedUser.avatarIpfsCid;
      String username = updatedUser.username;
      
      // 更新头像（如果提供了新头像）
      if (newAvatarFilePath != null) {
        // 上传头像文件到 Filebase
        final objectKey = 'avatars/${_currentUser!.userId}_${DateTime.now().millisecondsSinceEpoch}.jpg';
        await _filebaseService.uploadFile(
          FilebaseConfig.mediaFilesBucket,
          objectKey,
          newAvatarFilePath,
        );
        
        // 获取 IPFS CID
        avatarIpfsCid = await _filebaseService.getIpfsCid(
          FilebaseConfig.mediaFilesBucket,
          objectKey,
        );
        
        if (avatarIpfsCid == null) {
          print('无法获取头像 IPFS CID');
          return null;
        }
      }
      
      // 更新用户名（如果提供了新用户名）
      if (newUsername != null && newUsername.trim().isNotEmpty && newUsername != username) {
        // 检查新用户名是否已被占用
        final isUsernameTaken = await _isUsernameTaken(newUsername);
        if (isUsernameTaken) {
          print('用户名已存在，无法更新');
          return null;
        }
        
        // 更新用户名到用户ID的映射
        final usernameMappingKey = 'mappings/username_to_userid.json';
        
        // 获取现有映射
        Map<String, dynamic> mapping = await _filebaseService.downloadJson(
          FilebaseConfig.userDataBucket,
          usernameMappingKey,
        ) ?? {};
        
        // 删除旧用户名映射
        mapping.remove(username);
        
        // 添加新用户名映射
        mapping[newUsername] = _currentUser!.userId;
        
        // 保存更新后的映射
        await _filebaseService.uploadJson(
          FilebaseConfig.userDataBucket,
          usernameMappingKey,
          mapping,
        );
        
        // 更新用户名
        username = newUsername;
      }
      
      // 创建更新后的用户对象
      updatedUser = updatedUser.copyWith(
        username: username,
        avatarIpfsCid: avatarIpfsCid,
      );
      
      // 保存更新的用户数据
      final success = await updateUser(updatedUser);
      
      if (success) {
        print('用户资料更新成功');
        return updatedUser;
      } else {
        print('保存用户数据失败');
        return null;
      }
    } catch (e) {
      print('更新用户资料失败: $e');
      return null;
    }
  }
  
  /// 更新用户头像
  /// 
  /// [avatarFilePath] - 头像文件路径
  /// 返回更新结果，成功则返回更新后的用户
  Future<UserModel?> updateAvatar(String avatarFilePath) async {
    try {
      if (_currentUser == null) {
        print('未登录，无法更新头像');
        return null;
      }
      
      // 上传头像文件到 Filebase
      final objectKey = 'avatars/${_currentUser!.userId}_${DateTime.now().millisecondsSinceEpoch}.jpg';
      final uploadResult = await _filebaseService.uploadFile(
        FilebaseConfig.mediaFilesBucket,
        objectKey,
        avatarFilePath,
      );
      
      // 获取 IPFS CID
      final cid = await _filebaseService.getIpfsCid(
        FilebaseConfig.mediaFilesBucket,
        objectKey,
      );
      
      if (cid == null) {
        print('无法获取头像 IPFS CID');
        return null;
      }
      
      // 更新用户头像 CID
      final updatedUser = _currentUser!.copyWith(avatarIpfsCid: cid);
      
      // 保存更新的用户数据
      final updateResult = await updateUser(updatedUser);
      
      if (updateResult) {
        print('头像更新成功，IPFS CID: $cid');
        return updatedUser;
      } else {
        print('保存用户数据失败');
        return null;
      }
    } catch (e) {
      print('更新头像失败: $e');
      return null;
    }
  }
  
  /// 使用字节数据更新用户资料（为Web平台设计）
  /// 
  /// [avatarBytes] - 头像图片的字节数据
  /// [newUsername] - 新的用户名，为 null 则不更新
  /// 返回更新结果，成功则返回更新后的用户
  Future<UserModel?> updateUserProfileWithBytes({
    required Uint8List avatarBytes,
    String? newUsername,
  }) async {
    try {
      if (_currentUser == null) {
        print('未登录，无法更新用户资料');
        return null;
      }
      
      var updatedUser = _currentUser!;
      String? avatarIpfsCid;
      String username = updatedUser.username;
      
      // 上传头像字节数据
      if (avatarBytes.isNotEmpty) {
        print('正在上传头像字节数据...');
        final objectKey = 'avatars/${_currentUser!.userId}_${DateTime.now().millisecondsSinceEpoch}.jpg';
        
        // 上传字节数据到 Filebase
        final uploadResult = await _filebaseService.uploadData(
          FilebaseConfig.mediaFilesBucket,
          objectKey,
          avatarBytes,
          'image/jpeg', // 假设是JPEG格式
        );
        
        // 获取 IPFS CID
        avatarIpfsCid = await _filebaseService.getIpfsCid(
          FilebaseConfig.mediaFilesBucket,
          objectKey,
        );
        
        if (avatarIpfsCid == null) {
          print('无法获取头像 IPFS CID');
          return null;
        }
        
        print('头像上传成功，IPFS CID: $avatarIpfsCid');
      }
      
      // 更新用户名
      if (newUsername != null && newUsername.trim().isNotEmpty && newUsername != username) {
        print('正在更新用户名...');
        // 检查用户名是否已被使用
        final isUsernameTaken = await _isUsernameTaken(newUsername);
        if (isUsernameTaken) {
          print('用户名已存在，无法更新');
          return null;
        }
        
        // 更新用户名到用户ID的映射
        final usernameMappingKey = 'mappings/username_to_userid.json';
        
        // 获取现有映射
        Map<String, dynamic> mapping = await _filebaseService.downloadJson(
          FilebaseConfig.userDataBucket,
          usernameMappingKey,
        ) ?? {};
        
        // 删除旧用户名映射
        mapping.remove(username);
        
        // 添加新用户名映射
        mapping[newUsername] = _currentUser!.userId;
        
        // 保存更新后的映射
        await _filebaseService.uploadJson(
          FilebaseConfig.userDataBucket,
          usernameMappingKey,
          mapping,
        );
        
        // 更新用户名
        username = newUsername;
      }
      
      // 创建更新后的用户对象
      updatedUser = updatedUser.copyWith(
        username: username,
        avatarIpfsCid: avatarIpfsCid,
      );
      
      // 保存更新的用户数据
      final success = await updateUser(updatedUser);
      
      if (success) {
        print('用户资料更新成功');
        return updatedUser;
      } else {
        print('保存用户数据失败');
        return null;
      }
    } catch (e) {
      print('更新用户资料失败: $e');
      return null;
    }
  }
  
  /// 获取用户信息
  /// 
  /// [userId] - 用户ID
  /// 返回用户信息，如果不存在则返回 null
  Future<UserModel?> getUserInfo(String userId) async {
    try {
      // 获取用户数据
      final userData = await _filebaseService.downloadJson(
        FilebaseConfig.userDataBucket,
        'users/$userId.json',
      );
      
      if (userData == null) {
        print('用户数据不存在: $userId');
        return null;
      }
      
      // 解析用户数据
      return UserModel.fromJson(userData);
    } catch (e) {
      print('获取用户信息失败: $e');
      return null;
    }
  }
  
  /// 通过用户名查找用户
  /// 
  /// [username] - 要查找的用户名
  /// 返回用户信息，如果不存在则返回 null
  Future<UserModel?> findUserByUsername(String username) async {
    try {
      // 通过用户名获取用户ID
      final userId = await _getUserIdByUsername(username);
      if (userId == null) {
        print('未找到用户: $username');
        return null;
      }
      
      // 通过用户ID获取用户信息
      return await getUserInfo(userId);
    } catch (e) {
      print('通过用户名查找用户失败: $e');
      return null;
    }
  }
  
  /// 获取所有用户账号列表（开发/测试用）
  /// 
  /// 返回用户名和用户ID的映射列表
  /// 注意：密码已经过哈希处理，无法直接查看原始密码
  Future<Map<String, Map<String, dynamic>>?> getAllUserAccounts() async {
    try {
      print('正在查询所有用户账号...');
      
      // 获取用户名到用户ID的映射
      final usernameMappingKey = 'mappings/username_to_userid.json';
      final usernameMapping = await _filebaseService.downloadJson(
        FilebaseConfig.userDataBucket,
        usernameMappingKey,
      );
      
      if (usernameMapping == null || usernameMapping.isEmpty) {
        print('没有找到任何用户账号');
        return null;
      }
      
      Map<String, Map<String, dynamic>> userAccounts = {};
      
      // 遍历所有用户名，获取详细信息
      for (String username in usernameMapping.keys) {
        final userId = usernameMapping[username] as String;
        
        try {
          // 获取用户数据
          final userData = await _filebaseService.downloadJson(
            FilebaseConfig.userDataBucket,
            'users/$userId.json',
          );
          
          if (userData != null) {
            userAccounts[username] = {
              'userId': userId,
              'username': username,
              'passwordHash': userData['passwordHash'] ?? '未知',
              'avatarIpfsCid': userData['avatarIpfsCid'],
              'createdAt': userData['createdAt'],
              'note': '原始密码已加密，无法查看'
            };
          }
        } catch (e) {
          print('获取用户 $username 的详细信息失败: $e');
          userAccounts[username] = {
            'userId': userId,
            'username': username,
            'error': '无法获取详细信息'
          };
        }
      }
      
      print('查询完成，共找到 ${userAccounts.length} 个用户账号');
      return userAccounts;
    } catch (e) {
      print('查询用户账号失败: $e');
      return null;
    }
  }
}
