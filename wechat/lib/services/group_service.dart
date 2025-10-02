import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:uuid/uuid.dart';
import 'package:path/path.dart' as path;
import '../models/group_model.dart';
import '../models/user_model.dart';
import '../config/filebase_config.dart';
import 'filebase_service.dart';
import 'auth_service.dart';
import 'websocket_service.dart';

/// 群组服务
/// 
/// 负责群组的创建、成员管理、消息同步和数据存储
class GroupService extends ChangeNotifier {
  // 群组缓存
  final Map<String, GroupModel> _groups = {};
  
  // 用户所属群组缓存
  final Map<String, List<String>> _userGroups = {};
  
  // 依赖服务
  final FilebaseService _filebaseService;
  final AuthService _authService;
  final WebSocketService _webSocketService;
  
  // UUID生成器
  final _uuid = Uuid();
  
  // 构造函数
  GroupService(
    this._filebaseService,
    this._authService,
    this._webSocketService,
  ) {
    // 监听用户认证状态变化
    _authService.addListener(_handleAuthChange);
    
    // 如果用户已登录，立即加载群组数据
    if (_authService.isLoggedIn && _authService.currentUser != null) {
      refreshUserGroups(_authService.currentUser!.userId);
    }
  }
  
  /// 处理认证状态变化
  void _handleAuthChange() {
    // 用户登录时加载群组数据，登出时清空缓存
    if (_authService.isLoggedIn && _authService.currentUser != null) {
      refreshUserGroups(_authService.currentUser!.userId);
    } else {
      _groups.clear();
      _userGroups.clear();
      notifyListeners();
    }
  }
  
  /// 获取用户所属的所有群组
  Future<List<GroupModel>> getUserGroups(String userId) async {
    // 先确保用户的群组数据已经刷新
    await refreshUserGroups(userId);
    
    final groupIds = _userGroups[userId] ?? [];
    print('用户 $userId 的群组ID: $groupIds');
    
    // 获取群组列表
    final groups = groupIds
        .map((id) => _groups[id])
        .where((group) => group != null)
        .cast<GroupModel>()
        .toList();
    
    print('用户群组列表: ${groups.length}个, 内容: ${groups.map((g) => g.groupName).toList()}');
    return groups;
  }
  
  /// 获取单个群组
  GroupModel? getGroup(String groupId) {
    return _groups[groupId];
  }
  
  /// 刷新用户群组数据
  Future<void> refreshUserGroups(String userId) async {
    try {
      print('开始刷新用户 $userId 的群组数据');
      
      // 从Filebase获取用户群组列表
      final userGroupsData = await _filebaseService.getJson(
        'userdata',
        'groups/user_groups/$userId.json',
      );
      
      print('用户群组数据: $userGroupsData');
      
      if (userGroupsData != null) {
        // 解析用户群组ID列表
        List<String> groupIds = [];
        
        // 尝试不同的字段名，以适应可能的数据结构差异
        if (userGroupsData['groups'] != null) {
          groupIds = List<String>.from(userGroupsData['groups']);
        } else if (userGroupsData['groupIds'] != null) {
          groupIds = List<String>.from(userGroupsData['groupIds']);
        } else {
          // 尝试直接从对象中获取所有键（假设格式为 {groupId1: true, groupId2: true}）
          groupIds = userGroupsData.keys.where((key) => 
              key != 'userId' && key != 'lastUpdated').toList();
        }
        
        print('解析出的群组ID列表: $groupIds');
        _userGroups[userId] = groupIds;
        
        // 加载每个群组的详情
        for (final groupId in groupIds) {
          final group = await _loadGroupDetails(groupId);
          if (group != null) {
            print('成功加载群组: ${group.groupName} (${group.groupId})');
          }
        }
      } else {
        // 用户没有群组数据，初始化为空列表
        print('未找到用户群组数据，设置为空列表');
        _userGroups[userId] = [];
      }
      
      print('用户 $userId 的群组刷新完成，共 ${_userGroups[userId]?.length ?? 0} 个群组');
      notifyListeners();
    } catch (e) {
      print('刷新用户群组数据失败: $e');
      // 确保即使出错，也设置为空列表而不是null
      _userGroups[userId] = _userGroups[userId] ?? [];
    }
  }
  
  /// 加载群组详情
  Future<GroupModel?> _loadGroupDetails(String groupId) async {
    try {
      print('开始加载群组详情: $groupId');
      
      // 从缓存中检查，如果已有，直接返回
      if (_groups[groupId] != null) {
        print('从缓存返回群组详情: $groupId');
        return _groups[groupId];
      }
      
      // 从Filebase获取群组详情，尝试多种可能的路径
      Map<String, dynamic>? groupData;
      
      // 尝试第一种路径格式
      groupData = await _filebaseService.getJson(
        'userdata',
        'groups/details/$groupId.json',
      );
      
      // 如果第一个路径失败，尝试第二种可能的路径
      if (groupData == null) {
        groupData = await _filebaseService.getJson(
          'chatmssages',  // 可能存在的另一个存储桶
          'groups/details/$groupId.json',
        );
      }
      
      // 如果第二个路径也失败，尝试第三种可能的路径
      if (groupData == null) {
        groupData = await _filebaseService.getJson(
          'userdata',
          'groups/$groupId.json',
        );
      }
      
      if (groupData != null) {
        print('成功获取群组详情数据: $groupData');
        
        // 如果ID字段缺失，添加上
        if (groupData['groupId'] == null) {
          groupData['groupId'] = groupId;
        }
        
        try {
        // 解析群组数据
        final group = GroupModel.fromJson(groupData);
        _groups[groupId] = group;
        return group;
        } catch (parseError) {
          print('解析群组数据失败: $parseError, 原始数据: $groupData');
          
          // 尝试构建最小化的群组模型
          final fallbackGroup = GroupModel(
            groupId: groupId,
            groupName: groupData['groupName'] as String? ?? '未命名群组',
            ownerId: groupData['ownerId'] as String? ?? '',
            members: List<String>.from(groupData['members'] ?? []),
            createdAt: DateTime.tryParse(groupData['createdAt'] as String? ?? '') ?? DateTime.now(),
            description: groupData['description'] as String? ?? '',
            groupAvatarIpfsCid: groupData['groupAvatarIpfsCid'] as String? ?? groupData['avatarUrl'] as String?,
          );
          
          _groups[groupId] = fallbackGroup;
          return fallbackGroup;
        }
      }
      
      print('未找到群组详情: $groupId');
      return null;
    } catch (e) {
      print('加载群组详情失败: $e');
      return null;
    }
  }
  
  /// 创建新群组
  /// 
  /// [groupName] 群组名称
  /// [memberIds] 初始成员ID列表
  /// [description] 群组描述
  /// [avatarFile] 群组头像文件
  Future<GroupModel?> createGroup({
    required String groupName,
    required List<String> memberIds,
    String? description,
    File? avatarFile,
  }) async {
    try {
      final currentUser = _authService.currentUser;
      if (currentUser == null) {
        throw Exception('未登录，无法创建群组');
      }
      
      // 生成群组ID
      final groupId = _uuid.v4();
      
      // 确保群主包含在成员列表中
      if (!memberIds.contains(currentUser.userId)) {
        memberIds.add(currentUser.userId);
      }
      
      // 如果提供了头像，上传到IPFS
      String? avatarIpfsCid;
      if (avatarFile != null) {
        final objectKey = 'group_avatars/${DateTime.now().millisecondsSinceEpoch}_${path.basename(avatarFile.path)}';
        avatarIpfsCid = await _filebaseService.uploadFile(
          FilebaseConfig.mediaFilesBucket,
          objectKey,
          avatarFile.path
        );
      }
      
      // 创建群组模型
      final now = DateTime.now();
      final group = GroupModel(
        groupId: groupId,
        groupName: groupName,
        groupAvatarIpfsCid: avatarIpfsCid,
        members: memberIds,
        ownerId: currentUser.userId,
        createdAt: now,
        description: description,
      );
      
      // 保存群组数据到Filebase
      await _filebaseService.uploadJson(
        'userdata',
        'groups/details/$groupId.json',
        group.toJson(),
      );
      
      // 为每个成员更新群组列表
      for (final userId in memberIds) {
        await _addGroupToUserGroupList(userId, groupId);
      }
      
      // 通过WebSocket通知群成员
      _notifyGroupCreated(group);
      
      // 缓存群组数据
      _groups[groupId] = group;
      
      // 更新当前用户的群组列表
      final userGroupIds = _userGroups[currentUser.userId] ?? [];
      if (!userGroupIds.contains(groupId)) {
        userGroupIds.add(groupId);
        _userGroups[currentUser.userId] = userGroupIds;
      }
      
      notifyListeners();
      return group;
    } catch (e) {
      print('创建群组失败: $e');
      return null;
    }
  }
  
  /// 将群组添加到用户的群组列表
  Future<void> _addGroupToUserGroupList(String userId, String groupId) async {
    try {
      // 获取用户现有的群组列表
      final userGroupsData = await _filebaseService.getJson(
        'userdata',
        'groups/user_groups/$userId.json',
      );
      
      List<String> groupIds = [];
      if (userGroupsData != null) {
        groupIds = List<String>.from(userGroupsData['groups'] ?? []);
      }
      
      // 如果群组ID不在列表中，添加它
      if (!groupIds.contains(groupId)) {
        groupIds.add(groupId);
        
        // 保存更新后的群组列表
        await _filebaseService.uploadJson(
          'userdata',
          'groups/user_groups/$userId.json',
          {'groups': groupIds},
        );
        
        // 更新缓存
        _userGroups[userId] = groupIds;
      }
    } catch (e) {
      print('更新用户群组列表失败: $e');
    }
  }
  
  /// 从用户的群组列表中移除群组
  Future<void> _removeGroupFromUserGroupList(String userId, String groupId) async {
    try {
      // 获取用户现有的群组列表
      final userGroupsData = await _filebaseService.getJson(
        'userdata',
        'groups/user_groups/$userId.json',
      );
      
      if (userGroupsData != null) {
        List<String> groupIds = List<String>.from(userGroupsData['groups'] ?? []);
        
        // 移除群组ID
        if (groupIds.contains(groupId)) {
          groupIds.remove(groupId);
          
          // 保存更新后的群组列表
          await _filebaseService.uploadJson(
            'userdata',
            'groups/user_groups/$userId.json',
            {'groups': groupIds},
          );
          
          // 更新缓存
          _userGroups[userId] = groupIds;
        }
      }
    } catch (e) {
      print('从用户群组列表移除群组失败: $e');
    }
  }
  
  /// 更新群组资料
  Future<bool> updateGroupProfile({
    required String groupId,
    String? groupName,
    String? description,
    File? avatarFile,
  }) async {
    try {
      final currentUser = _authService.currentUser;
      if (currentUser == null) {
        throw Exception('未登录，无法更新群组');
      }
      
      // 获取群组
      final group = _groups[groupId];
      if (group == null) {
        throw Exception('群组不存在');
      }
      
      // 验证权限（只有群主和管理员可以更新群组信息）
      if (!group.isOwner(currentUser.userId) && !group.isAdmin(currentUser.userId)) {
        throw Exception('无权限更新群组资料');
      }
      
      // 如果提供了头像，上传到IPFS
      String? avatarIpfsCid;
      if (avatarFile != null) {
        final objectKey = 'group_avatars/${DateTime.now().millisecondsSinceEpoch}_${path.basename(avatarFile.path)}';
        avatarIpfsCid = await _filebaseService.uploadFile(
          FilebaseConfig.mediaFilesBucket,
          objectKey,
          avatarFile.path
        );
      }
      
      // 更新群组信息
      group.updateInfo(
        name: groupName, 
        avatar: avatarFile != null ? avatarIpfsCid : null,
        desc: description,
      );
      
      // 保存更新后的群组数据
      await _filebaseService.uploadJson(
        'userdata',
        'groups/details/$groupId.json',
        group.toJson(),
      );
      
      // 通知群成员群组信息已更新
      _notifyGroupUpdated(group);
      
      notifyListeners();
      return true;
    } catch (e) {
      print('更新群组资料失败: $e');
      return false;
    }
  }
  
  /// 添加成员到群组
  Future<bool> addMemberToGroup({
    required String groupId,
    required String userId,
  }) async {
    try {
      final currentUser = _authService.currentUser;
      if (currentUser == null) {
        throw Exception('未登录，无法添加群成员');
      }
      
      // 获取群组
      final group = _groups[groupId];
      if (group == null) {
        throw Exception('群组不存在');
      }
      
      // 验证权限（只有群主和管理员可以添加成员）
      if (!group.isOwner(currentUser.userId) && !group.isAdmin(currentUser.userId)) {
        throw Exception('无权限添加群成员');
      }
      
      // 如果用户已经是群成员，不再添加
      if (group.isMember(userId)) {
        return true;
      }
      
      // 添加成员到群组
      group.addMember(userId);
      
      // 保存更新后的群组数据
      await _filebaseService.uploadJson(
        'userdata',
        'groups/details/$groupId.json',
        group.toJson(),
      );
      
      // 将群组添加到用户的群组列表
      await _addGroupToUserGroupList(userId, groupId);
      
      // 通知群成员有新成员加入
      _notifyMemberAdded(group, userId);
      
      notifyListeners();
      return true;
    } catch (e) {
      print('添加群成员失败: $e');
      return false;
    }
  }
  
  /// 从群组移除成员
  Future<bool> removeMemberFromGroup({
    required String groupId,
    required String userId,
  }) async {
    try {
      final currentUser = _authService.currentUser;
      if (currentUser == null) {
        throw Exception('未登录，无法移除群成员');
      }
      
      // 获取群组
      final group = _groups[groupId];
      if (group == null) {
        throw Exception('群组不存在');
      }
      
      // 验证权限（自己可以退出，群主和管理员可以移除其他人）
      final isSelf = currentUser.userId == userId;
      if (!isSelf && !group.isOwner(currentUser.userId) && !group.isAdmin(currentUser.userId)) {
        throw Exception('无权限移除群成员');
      }
      
      // 群主不能被移除
      if (group.isOwner(userId) && !isSelf) {
        throw Exception('不能移除群主');
      }
      
      // 从群组移除成员
      final removed = group.removeMember(userId);
      if (!removed) {
        return false;
      }
      
      // 保存更新后的群组数据
      await _filebaseService.uploadJson(
        'userdata',
        'groups/details/$groupId.json',
        group.toJson(),
      );
      
      // 从用户的群组列表中移除群组
      await _removeGroupFromUserGroupList(userId, groupId);
      
      // 通知群成员有成员被移除
      _notifyMemberRemoved(group, userId, isSelf);
      
      notifyListeners();
      return true;
    } catch (e) {
      print('移除群成员失败: $e');
      return false;
    }
  }
  
  /// 解散群组
  Future<bool> dissolveGroup(String groupId) async {
    return disbandGroup(groupId);
  }
  
  /// 解散群组 (dissolveGroup的别名)
  Future<bool> disbandGroup(String groupId) async {
    try {
      final currentUser = _authService.currentUser;
      if (currentUser == null) {
        throw Exception('未登录，无法解散群组');
      }
      
      // 获取群组
      final group = await _loadGroupDetails(groupId);
      if (group == null) {
        throw Exception('群组不存在');
      }
      
      // 检查权限，只有群主可以解散群组
      if (group.ownerId != currentUser.userId) {
        throw Exception('只有群主可以解散群组');
      }
      
      // 通知群成员
      _notifyGroupDissolved(group);
      
      // 从所有成员的群组列表中移除此群组
      for (final memberId in group.members) {
        await _removeGroupFromUserGroupList(memberId, groupId);
      }
      
      // 删除群组详情文件
      await _filebaseService.deleteFile(
        'userdata',
        'groups/details/$groupId.json',
      );
      
      // 清除群组缓存
      _groups.remove(groupId);
      notifyListeners();
      
      return true;
    } catch (e) {
      print('解散群组失败: $e');
      return false;
    }
  }
  
  /// 更新群组头像
  /// 
  /// [groupId] 群组ID
  /// [avatarFile] 新的头像文件
  Future<bool> updateGroupAvatar({
    required String groupId,
    required File avatarFile,
  }) async {
    try {
      final currentUser = _authService.currentUser;
      if (currentUser == null) {
        throw Exception('未登录，无法更新群组头像');
      }
      
      // 获取群组
      final group = await _loadGroupDetails(groupId);
      if (group == null) {
        throw Exception('群组不存在');
      }
      
      // 检查权限，只有群主和管理员可以更新群组头像
      if (group.ownerId != currentUser.userId && !group.adminIds.contains(currentUser.userId)) {
        throw Exception('只有群主和管理员可以更新群组头像');
      }
      
      // 上传头像文件到 Filebase
      final objectKey = 'groups/avatars/${groupId}_${DateTime.now().millisecondsSinceEpoch}.jpg';
      
      final avatarUrl = await _filebaseService.uploadFile(
        FilebaseConfig.mediaFilesBucket,
        objectKey,
        avatarFile.path,
      );
      
      if (avatarUrl == null) {
        throw Exception('上传头像失败');
      }
      
      // 从URL中提取IPFS CID
      String? ipfsCid = null;
      if (avatarUrl != null) {
        // 提取IPFS CID，格式通常为 https://ipfs.filebase.io/ipfs/QmXXXXX
        final urlParts = avatarUrl.split('/ipfs/');
        if (urlParts.length >= 2) {
          ipfsCid = urlParts.last;
          print('提取的IPFS CID: $ipfsCid');
        }
      }
      
      // 更新群组信息
      final updatedGroup = group.copyWith(
        groupAvatarIpfsCid: ipfsCid,
      );
      
      // 保存到 Filebase
      await _filebaseService.uploadJson(
        FilebaseConfig.userDataBucket,
        'groups/details/${groupId}.json',
        updatedGroup.toJson(),
      );
      
      // 更新缓存
      _groups[groupId] = updatedGroup;
      notifyListeners();
      
      // 通知群成员群组信息已更新
      _notifyGroupUpdated(updatedGroup);
      
      return true;
    } catch (e) {
      print('更新群组头像失败: $e');
      return false;
    }
  }
  
  /// 使用字节数据更新群组头像（为Web平台设计）
  /// 
  /// [groupId] 群组ID
  /// [avatarBytes] 新的头像字节数据
  Future<bool> updateGroupAvatarWithBytes({
    required String groupId,
    required Uint8List avatarBytes,
  }) async {
    try {
      final currentUser = _authService.currentUser;
      if (currentUser == null) {
        throw Exception('未登录，无法更新群组头像');
      }
      
      // 获取群组
      final group = await _loadGroupDetails(groupId);
      if (group == null) {
        throw Exception('群组不存在');
      }
      
      // 检查权限，只有群主和管理员可以更新群组头像
      if (group.ownerId != currentUser.userId && !group.adminIds.contains(currentUser.userId)) {
        throw Exception('只有群主和管理员可以更新群组头像');
      }
      
      // 上传头像字节数据到 Filebase
      final objectKey = 'groups/avatars/${groupId}_${DateTime.now().millisecondsSinceEpoch}.jpg';
      
      final avatarUrl = await _filebaseService.uploadData(
        FilebaseConfig.mediaFilesBucket,
        objectKey,
        avatarBytes,
        'image/jpeg', // 假设是JPEG格式
      );
      
      if (avatarUrl == null) {
        throw Exception('上传头像失败');
      }
      
      // 从URL中提取IPFS CID
      String? ipfsCid = null;
      if (avatarUrl != null) {
        // 提取IPFS CID，格式通常为 https://ipfs.filebase.io/ipfs/QmXXXXX
        final urlParts = avatarUrl.split('/ipfs/');
        if (urlParts.length >= 2) {
          ipfsCid = urlParts.last;
          print('提取的IPFS CID: $ipfsCid');
        }
      }
      
      // 更新群组信息
      final updatedGroup = group.copyWith(
        groupAvatarIpfsCid: ipfsCid,
      );
      
      // 保存到 Filebase
      await _filebaseService.uploadJson(
        FilebaseConfig.userDataBucket,
        'groups/details/${groupId}.json',
        updatedGroup.toJson(),
      );
      
      // 更新缓存
      _groups[groupId] = updatedGroup;
      notifyListeners();
      
      // 通知群成员群组信息已更新
      _notifyGroupUpdated(updatedGroup);
      
      return true;
    } catch (e) {
      print('更新群组头像失败: $e');
      return false;
    }
  }
  
  /// 管理员相关操作 ///
  
  /// 添加管理员
  Future<bool> addGroupAdmin({
    required String groupId,
    required String userId,
  }) async {
    try {
      final currentUser = _authService.currentUser;
      if (currentUser == null) {
        throw Exception('未登录，无法添加管理员');
      }
      
      // 获取群组
      final group = _groups[groupId];
      if (group == null) {
        throw Exception('群组不存在');
      }
      
      // 验证权限（只有群主可以添加管理员）
      if (!group.isOwner(currentUser.userId)) {
        throw Exception('只有群主可以添加管理员');
      }
      
      // 添加管理员
      final added = group.addAdmin(userId);
      if (!added) {
        return false;
      }
      
      // 保存更新后的群组数据
      await _filebaseService.uploadJson(
        'userdata',
        'groups/details/$groupId.json',
        group.toJson(),
      );
      
      // 通知群成员有新管理员
      _notifyAdminAdded(group, userId);
      
      notifyListeners();
      return true;
    } catch (e) {
      print('添加管理员失败: $e');
      return false;
    }
  }
  
  /// 移除管理员
  Future<bool> removeGroupAdmin({
    required String groupId,
    required String userId,
  }) async {
    try {
      final currentUser = _authService.currentUser;
      if (currentUser == null) {
        throw Exception('未登录，无法移除管理员');
      }
      
      // 获取群组
      final group = _groups[groupId];
      if (group == null) {
        throw Exception('群组不存在');
      }
      
      // 验证权限（只有群主可以移除管理员）
      if (!group.isOwner(currentUser.userId)) {
        throw Exception('只有群主可以移除管理员');
      }
      
      // 移除管理员
      final removed = group.removeAdmin(userId);
      if (!removed) {
        return false;
      }
      
      // 保存更新后的群组数据
      await _filebaseService.uploadJson(
        'userdata',
        'groups/details/$groupId.json',
        group.toJson(),
      );
      
      // 通知群成员管理员被移除
      _notifyAdminRemoved(group, userId);
      
      notifyListeners();
      return true;
    } catch (e) {
      print('移除管理员失败: $e');
      return false;
    }
  }
  
  /// WebSocket通知方法 ///
  
  /// 通知群组创建
  void _notifyGroupCreated(GroupModel group) {
    for (final memberId in group.members) {
      // 跳过自己
      if (memberId == _authService.currentUser?.userId) continue;
      
      _webSocketService.emitEvent('group_created', {
        'groupId': group.groupId,
        'groupName': group.groupName,
        'ownerId': group.ownerId,
        'ownerName': _authService.currentUser?.username ?? '',
        'timestamp': DateTime.now().toIso8601String(),
      }, targetUserId: memberId);
    }
  }
  
  /// 通知群组更新
  void _notifyGroupUpdated(GroupModel group) {
    // 本地更新 - 强制刷新本地缓存和UI
    WidgetsBinding.instance.addPostFrameCallback((_) {
      print('触发本地群组更新通知: ${group.groupId} ${group.groupName}');
      notifyListeners(); // 通知所有监听此服务的组件刷新
    });
    
    // 远程通知 - 通知其他成员
    for (final memberId in group.members) {
      // 跳过自己
      if (memberId == _authService.currentUser?.userId) continue;
      
      _webSocketService.emitEvent('group_updated', {
        'groupId': group.groupId,
        'groupName': group.groupName,
        'updaterId': _authService.currentUser?.userId ?? '',
        'updaterName': _authService.currentUser?.username ?? '',
        'timestamp': DateTime.now().toIso8601String(),
      }, targetUserId: memberId);
    }
  }
  
  /// 通知成员添加
  void _notifyMemberAdded(GroupModel group, String newMemberId) {
    // 通知现有成员有新成员加入
    for (final memberId in group.members) {
      // 跳过自己和新成员
      if (memberId == _authService.currentUser?.userId || memberId == newMemberId) continue;
      
      _webSocketService.emitEvent('group_member_added', {
        'groupId': group.groupId,
        'groupName': group.groupName,
        'newMemberId': newMemberId,
        'addedBy': _authService.currentUser?.userId ?? '',
        'addedByName': _authService.currentUser?.username ?? '',
        'timestamp': DateTime.now().toIso8601String(),
      }, targetUserId: memberId);
    }
    
    // 通知新成员被添加到群组
    _webSocketService.emitEvent('added_to_group', {
      'groupId': group.groupId,
      'groupName': group.groupName,
      'addedBy': _authService.currentUser?.userId ?? '',
      'addedByName': _authService.currentUser?.username ?? '',
      'timestamp': DateTime.now().toIso8601String(),
    }, targetUserId: newMemberId);
  }
  
  /// 通知成员移除
  void _notifyMemberRemoved(GroupModel group, String removedMemberId, bool isSelf) {
    // 通知现有成员有成员被移除
    for (final memberId in group.members) {
      // 跳过自己
      if (memberId == _authService.currentUser?.userId) continue;
      
      _webSocketService.emitEvent('group_member_removed', {
        'groupId': group.groupId,
        'groupName': group.groupName,
        'removedMemberId': removedMemberId,
        'removedBy': _authService.currentUser?.userId ?? '',
        'removedByName': _authService.currentUser?.username ?? '',
        'isSelf': isSelf,
        'timestamp': DateTime.now().toIso8601String(),
      }, targetUserId: memberId);
    }
    
    // 如果不是自己退出，通知被移除的成员
    if (!isSelf) {
      _webSocketService.emitEvent('removed_from_group', {
        'groupId': group.groupId,
        'groupName': group.groupName,
        'removedBy': _authService.currentUser?.userId ?? '',
        'removedByName': _authService.currentUser?.username ?? '',
        'timestamp': DateTime.now().toIso8601String(),
      }, targetUserId: removedMemberId);
    }
  }
  
  /// 通知管理员添加
  void _notifyAdminAdded(GroupModel group, String newAdminId) {
    for (final memberId in group.members) {
      // 跳过自己
      if (memberId == _authService.currentUser?.userId) continue;
      
      _webSocketService.emitEvent('group_admin_added', {
        'groupId': group.groupId,
        'groupName': group.groupName,
        'newAdminId': newAdminId,
        'addedBy': _authService.currentUser?.userId ?? '',
        'addedByName': _authService.currentUser?.username ?? '',
        'timestamp': DateTime.now().toIso8601String(),
      }, targetUserId: memberId);
    }
  }
  
  /// 通知管理员移除
  void _notifyAdminRemoved(GroupModel group, String removedAdminId) {
    for (final memberId in group.members) {
      // 跳过自己
      if (memberId == _authService.currentUser?.userId) continue;
      
      _webSocketService.emitEvent('group_admin_removed', {
        'groupId': group.groupId,
        'groupName': group.groupName,
        'removedAdminId': removedAdminId,
        'removedBy': _authService.currentUser?.userId ?? '',
        'removedByName': _authService.currentUser?.username ?? '',
        'timestamp': DateTime.now().toIso8601String(),
      }, targetUserId: memberId);
    }
  }
  
  /// 通知群组解散
  void _notifyGroupDissolved(GroupModel group) {
    for (final memberId in group.members) {
      // 跳过自己
      if (memberId == _authService.currentUser?.userId) continue;
      
      _webSocketService.emitEvent('group_dissolved', {
        'groupId': group.groupId,
        'groupName': group.groupName,
        'dissolvedBy': _authService.currentUser?.userId ?? '',
        'dissolvedByName': _authService.currentUser?.username ?? '',
        'timestamp': DateTime.now().toIso8601String(),
      }, targetUserId: memberId);
    }
  }
  
  @override
  void dispose() {
    _authService.removeListener(_handleAuthChange);
    super.dispose();
  }
}
