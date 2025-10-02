import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/models.dart';
import 'user_service.dart';

/// 群组服务
/// 负责群组的创建、管理、消息发送等核心功能
class GroupService {
  static final GroupService _instance = GroupService._internal();
  factory GroupService() => _instance;
  GroupService._internal();

  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final UserService _userService = UserService();

  /// 创建群组
  /// [name] 群组名称
  /// [description] 群组描述
  /// [creatorId] 创建者ID
  /// [memberIds] 初始成员ID列表
  /// [avatarUrl] 群组头像URL
  Future<GroupModel> createGroup({
    required String name,
    String? description,
    required String creatorId,
    required List<String> memberIds,
    String? avatarUrl,
  }) async {
    try {
      // 验证输入
      if (name.trim().isEmpty) {
        throw Exception('群组名称不能为空');
      }
      if (memberIds.isEmpty) {
        throw Exception('群组至少需要一个成员');
      }
      if (!memberIds.contains(creatorId)) {
        memberIds.add(creatorId);
      }

      // 获取创建者信息
      final creator = await _userService.getUserById(creatorId);
      if (creator == null) {
        throw Exception('创建者不存在');
      }

      // 验证所有成员是否存在
      final members = <UserModel>[];
      for (final memberId in memberIds) {
        final user = await _userService.getUserById(memberId);
        if (user != null) {
          members.add(user);
        } else {
          throw Exception('成员 $memberId 不存在');
        }
      }

      // 创建群组成员列表
      // 所有参与者ID包含创建者
      final allParticipantIds = [creatorId, ...memberIds].toSet().toList();

      // 创建群组
      final group = GroupModel(
        groupId: '', // 临时ID，稍后会被Firestore生成的ID替换
        groupName: name.trim(),
        description: description?.trim(),
        groupIconUrl: avatarUrl,
        adminIds: [creatorId],
        participantIds: allParticipantIds,
        createdAt: Timestamp.now(),
      );

      // 保存到Firestore
      final docRef = await _firestore.collection('groups').add(group.toJson());
      
      // 更新群组ID
      await docRef.update({'groupId': docRef.id});
      
      // 创建群组聊天室记录
      await _createGroupChatRoom(docRef.id, group);
      
      // 为每个成员创建群组关联记录
      await _addGroupToMembers(docRef.id, memberIds);

      // 返回完整的群组信息
      return group.copyWith(groupId: docRef.id);
      
    } catch (e) {
      throw Exception('创建群组失败：${e.toString()}');
    }
  }

  /// 为群组成员创建关联记录
  Future<void> _addGroupToMembers(String groupId, List<String> memberIds) async {
    final batch = _firestore.batch();
    
    for (final memberId in memberIds) {
      final memberGroupRef = _firestore
          .collection('users')
          .doc(memberId)
          .collection('groups')
          .doc(groupId);
      
      batch.set(memberGroupRef, {
        'groupId': groupId,
        'joinedAt': Timestamp.now(),
        'role': memberIds.first == memberId ? 'admin' : 'member',
      });
    }
    
    await batch.commit();
  }

  /// 创建群组聊天室
  Future<void> _createGroupChatRoom(String groupId, GroupModel group) async {
    final chatRoom = ChatRoomModel(
      chatRoomId: 'group_$groupId',
      participantIds: group.participantIds,
      lastMessage: '',
      lastMessageTimestamp: null,
      lastMessageSenderId: null,
      unreadCounts: {},
    );

    await _firestore
        .collection('chatRooms')
        .doc('group_$groupId')
        .set(chatRoom.toJson());
  }

  /// 获取用户的群组列表
  Stream<List<GroupModel>> getUserGroups(String userId) {
    return _firestore
        .collection('groups')
        .where('participantIds', arrayContains: userId)
        .orderBy('createdAt', descending: true)
        .snapshots()
        .map((snapshot) {
      return snapshot.docs
          .map((doc) => GroupModel.fromJson(doc.data() as Map<String, dynamic>, doc.id))
          .toList();
    });
  }

  /// 获取群组详细信息
  Future<GroupModel?> getGroupById(String groupId) async {
    try {
      final doc = await _firestore.collection('groups').doc(groupId).get();
      if (doc.exists) {
        return GroupModel.fromJson(doc.data()! as Map<String, dynamic>, doc.id);
      }
      return null;
    } catch (e) {
      throw Exception('获取群组信息失败：${e.toString()}');
    }
  }

  /// 添加群组成员
  Future<void> addGroupMembers({
    required String groupId,
    required List<String> memberIds,
    required String operatorId,
  }) async {
    try {
      final group = await getGroupById(groupId);
      if (group == null) {
        throw Exception('群组不存在');
      }

      // 检查操作者权限
      if (!group.participantIds.contains(operatorId)) {
        throw Exception('您不是群组成员');
      }

      if (!group.adminIds.contains(operatorId)) {
        throw Exception('权限不足，只有管理员可以添加成员');
      }

      // 验证新成员并过滤已存在的成员
      final validNewMemberIds = <String>[];
      for (final memberId in memberIds) {
        // 检查是否已经是成员
        if (group.participantIds.contains(memberId)) {
          continue;
        }

        // 验证用户存在
        final user = await _userService.getUserById(memberId);
        if (user != null) {
          validNewMemberIds.add(memberId);
        }
      }

      if (validNewMemberIds.isEmpty) {
        throw Exception('没有有效的新成员');
      }

      // 更新群组参与者列表
      final updatedParticipantIds = [...group.participantIds, ...validNewMemberIds];
      
      await _firestore.collection('groups').doc(groupId).update({
        'participantIds': updatedParticipantIds,
      });

      // 更新聊天室参与者
      await _firestore.collection('chat_rooms').doc('group_$groupId').update({
        'participantIds': updatedParticipantIds,
      });

    } catch (e) {
      throw Exception('添加群组成员失败：${e.toString()}');
    }
  }

  /// 移除群组成员
  Future<void> removeGroupMember({
    required String groupId,
    required String memberIdToRemove,
    required String operatorId,
  }) async {
    try {
      final group = await getGroupById(groupId);
      if (group == null) {
        throw Exception('群组不存在');
      }

      // 检查操作者权限
      if (!group.participantIds.contains(operatorId)) {
        throw Exception('您不是群组成员');
      }
      
      if (!group.participantIds.contains(memberIdToRemove)) {
        throw Exception('要移除的成员不在群组中');
      }

      // 权限检查
      final isOperatorAdmin = group.adminIds.contains(operatorId);
      final isMemberToRemoveAdmin = group.adminIds.contains(memberIdToRemove);
      
      if (!isOperatorAdmin) {
        if (operatorId != memberIdToRemove) {
          throw Exception('权限不足，只能退出自己');
        }
      } else {
        // 管理员不能移除其他管理员，除非是自己
        if (isMemberToRemoveAdmin && operatorId != memberIdToRemove) {
          throw Exception('权限不足，不能移除其他管理员');
        }
      }

      // 如果移除的是最后一个管理员，需要特殊处理
      if (isMemberToRemoveAdmin && group.adminIds.length == 1) {
        if (group.participantIds.length <= 1) {
          // 解散群组
          await _disbandGroup(groupId);
          return;
        } else {
          // 指定第一个非管理员为新管理员
          final newAdminId = group.participantIds.firstWhere(
            (id) => id != memberIdToRemove && !group.adminIds.contains(id),
          );
          
          // 更新管理员列表，移除旧管理员，添加新管理员
          final updatedAdminIds = [newAdminId];
          
          await _firestore.collection('groups').doc(groupId).update({
            'adminIds': updatedAdminIds,
          });
        }
      }

      // 移除成员
      final updatedParticipantIds = group.participantIds
          .where((id) => id != memberIdToRemove)
          .toList();
      
      // 如果移除的是管理员，也需要从管理员列表中移除
      final updatedAdminIds = group.adminIds
          .where((id) => id != memberIdToRemove)
          .toList();

      await _firestore.collection('groups').doc(groupId).update({
        'participantIds': updatedParticipantIds,
        'adminIds': updatedAdminIds,
      });

      // 更新聊天室参与者
      await _firestore.collection('chat_rooms').doc('group_$groupId').update({
        'participantIds': updatedParticipantIds,
      });

      // 移除成员的群组关联
      await _firestore
          .collection('users')
          .doc(memberIdToRemove)
          .collection('groups')
          .doc(groupId)
          .delete();

    } catch (e) {
      throw Exception('移除群组成员失败：${e.toString()}');
    }
  }

  /// 解散群组
  Future<void> _disbandGroup(String groupId) async {
    await _firestore.collection('groups').doc(groupId).update({
      'isActive': false,
      'updatedAt': Timestamp.now(),
    });

    await _firestore.collection('chatRooms').doc('group_$groupId').update({
      'isActive': false,
      'updatedAt': Timestamp.now(),
    });
  }

  /// 更新群组信息
  Future<void> updateGroupInfo({
    required String groupId,
    required String operatorId,
    String? name,
    String? description,
    String? avatarUrl,
  }) async {
    try {
      final group = await getGroupById(groupId);
      if (group == null) {
        throw Exception('群组不存在');
      }

      // 检查操作者权限
      // 检查操作者权限
      if (!group.participantIds.contains(operatorId)) {
        throw Exception('您不是群组成员');
      }

      if (!group.adminIds.contains(operatorId)) {
        throw Exception('权限不足，只有管理员可以修改群组信息');
      }

      final updateData = <String, dynamic>{};

      if (name != null && name.trim().isNotEmpty) {
        updateData['groupName'] = name.trim();
      }
      if (description != null) {
        updateData['description'] = description.trim();
      }
      if (avatarUrl != null) {
        updateData['groupIconUrl'] = avatarUrl;
      }

      await _firestore.collection('groups').doc(groupId).update(updateData);

    } catch (e) {
      throw Exception('更新群组信息失败：${e.toString()}');
    }
  }

  /// 发送群组消息
  Future<void> sendGroupMessage({
    required String groupId,
    required String senderId,
    String? text,
    MediaAttachmentModel? attachment,
  }) async {
    try {
      // 验证消息内容
      if ((text == null || text.trim().isEmpty) && attachment == null) {
        throw Exception('消息内容不能为空');
      }

      final group = await getGroupById(groupId);
      if (group == null) {
        throw Exception('群组不存在');
      }

      // 验证发送者是否为群组成员
      if (!group.participantIds.contains(senderId)) {
        throw Exception('您不是群组成员');
      }

      // 确定消息类型和媒体URL
      MessageType messageType;
      String? mediaUrl;
      String? attachmentId;
      String messageText = text ?? '';

      if (attachment != null) {
        attachmentId = attachment.attachmentId;
        mediaUrl = attachment.downloadUrl;
        switch (attachment.mediaType) {
          case MediaType.image:
            messageType = MessageType.image;
            if (messageText.isEmpty) messageText = '[图片]';
            break;
          case MediaType.audio:
            messageType = MessageType.audio;
            if (messageText.isEmpty) messageText = '[语音]';
            break;
          case MediaType.video:
            messageType = MessageType.video;
            if (messageText.isEmpty) messageText = '[视频]';
            break;
          case MediaType.document:
            messageType = MessageType.document;
            if (messageText.isEmpty) messageText = '[文档]';
            break;
        }
      } else {
        messageType = MessageType.text;
      }

      // 创建消息
      final message = MessageModel(
        messageId: '',
        senderId: senderId,
        chatRoomId: 'group_$groupId',
        text: messageText,
        timestamp: Timestamp.now(),
        status: MessageStatus.sent,
        messageType: messageType,
        mediaUrl: mediaUrl,
        attachmentId: attachmentId,
        replyToMessageId: null,
        reactions: [],
      );

      final batch = _firestore.batch();

      // 添加消息到messages集合
      final messageRef = _firestore.collection('messages').doc();
      final finalMessage = message.copyWith(messageId: messageRef.id);
      batch.set(messageRef, finalMessage.toJson());

      // 更新群组最后消息信息
      final groupRef = _firestore.collection('groups').doc(groupId);
      batch.update(groupRef, {
        'lastMessageText': messageText,
        'lastMessageTime': message.timestamp,
        'lastMessageSenderId': senderId,
        'updatedAt': message.timestamp,
      });

      // 更新聊天室信息
      final chatRoomRef = _firestore.collection('chatRooms').doc('group_$groupId');
      batch.update(chatRoomRef, {
        'lastMessage': messageText,
        'lastMessageTime': message.timestamp,
        'lastMessageSenderId': senderId,
        'updatedAt': message.timestamp,
      });

      await batch.commit();

    } catch (e) {
      throw Exception('发送群组消息失败：${e.toString()}');
    }
  }

  /// 获取群组消息流
  Stream<List<MessageModel>> getGroupMessagesStream(String groupId) {
    return _firestore
        .collection('messages')
        .where('chatRoomId', isEqualTo: 'group_$groupId')
        .orderBy('timestamp', descending: true)
        .limit(50)
        .snapshots()
        .map((snapshot) {
      return snapshot.docs
          .map((doc) => MessageModel.fromJson(doc.data() as Map<String, dynamic>, doc.id))
          .toList();
    });
  }

  /// 更新成员角色
  Future<void> updateMemberRole({
    required String groupId,
    required String targetMemberId,
    required GroupRole newRole,
    required String operatorId,
  }) async {
    try {
      final group = await getGroupById(groupId);
      if (group == null) {
        throw Exception('群组不存在');
      }

      // 检查操作者权限
      if (!group.participantIds.contains(operatorId)) {
        throw Exception('您不是群组成员');
      }
      
      if (!group.participantIds.contains(targetMemberId)) {
        throw Exception('目标成员不在群组中');
      }
      
      if (!group.adminIds.contains(operatorId)) {
        throw Exception('权限不足，只有管理员可以修改成员角色');
      }

      // 更新成员角色 - 根据新角色更新管理员列表
      final currentAdminIds = group.adminIds.toList();
      final isCurrentlyAdmin = currentAdminIds.contains(targetMemberId);
      
      if (newRole == GroupRole.admin && !isCurrentlyAdmin) {
        // 添加为管理员
        currentAdminIds.add(targetMemberId);
      } else if (newRole == GroupRole.member && isCurrentlyAdmin) {
        // 从管理员中移除
        currentAdminIds.remove(targetMemberId);
      }

      await _firestore.collection('groups').doc(groupId).update({
        'adminIds': currentAdminIds,
      });

      // 更新用户的群组关联记录
      await _firestore
          .collection('users')
          .doc(targetMemberId)
          .collection('groups')
          .doc(groupId)
          .update({
        'role': newRole.name,
      });

    } catch (e) {
      throw Exception('更新成员角色失败：${e.toString()}');
    }
  }

  /// 添加群组管理员
  Future<void> addGroupAdmin({
    required String groupId,
    required String newAdminId,
    required String operatorId,
  }) async {
    try {
      final group = await getGroupById(groupId);
      if (group == null) {
        throw Exception('群组不存在');
      }

      // 检查操作者权限
      if (!group.participantIds.contains(operatorId)) {
        throw Exception('您不是群组成员');
      }
      
      if (!group.participantIds.contains(newAdminId)) {
        throw Exception('目标成员不在群组中');
      }
      
      // 只有群主（第一个管理员）可以添加管理员
      if (group.adminIds.isEmpty || group.adminIds.first != operatorId) {
        throw Exception('权限不足，只有群主可以添加管理员');
      }

      // 如果已经是管理员，则不需要操作
      if (group.adminIds.contains(newAdminId)) {
        return;
      }

      // 添加为管理员
      final currentAdminIds = group.adminIds.toList();
      currentAdminIds.add(newAdminId);

      await _firestore.collection('groups').doc(groupId).update({
        'adminIds': currentAdminIds,
      });

    } catch (e) {
      throw Exception('添加管理员失败：${e.toString()}');
    }
  }

  /// 移除群组管理员
  Future<void> removeGroupAdmin({
    required String groupId,
    required String adminIdToRemove,
    required String operatorId,
  }) async {
    try {
      final group = await getGroupById(groupId);
      if (group == null) {
        throw Exception('群组不存在');
      }

      // 检查操作者权限
      if (!group.participantIds.contains(operatorId)) {
        throw Exception('您不是群组成员');
      }
      
      // 只有群主（第一个管理员）可以移除管理员
      if (group.adminIds.isEmpty || group.adminIds.first != operatorId) {
        throw Exception('权限不足，只有群主可以移除管理员');
      }

      // 不能移除群主自己
      if (group.adminIds.first == adminIdToRemove) {
        throw Exception('不能移除群主');
      }

      // 如果不是管理员，则不需要操作
      if (!group.adminIds.contains(adminIdToRemove)) {
        return;
      }

      // 从管理员中移除
      final currentAdminIds = group.adminIds.toList();
      currentAdminIds.remove(adminIdToRemove);

      await _firestore.collection('groups').doc(groupId).update({
        'adminIds': currentAdminIds,
      });

    } catch (e) {
      throw Exception('移除管理员失败：${e.toString()}');
    }
  }
}
