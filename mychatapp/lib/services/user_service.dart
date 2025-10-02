import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:image_picker/image_picker.dart';
import 'dart:io';
import '../models/user_model.dart';

/// 用户数据服务
/// 负责用户数据的获取、更新和管理，与Firestore users集合交互
class UserService {
  static final UserService _instance = UserService._internal();
  factory UserService() => _instance;
  UserService._internal();

  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final FirebaseStorage _storage = FirebaseStorage.instance;
  final ImagePicker _imagePicker = ImagePicker();
  final String _collectionName = 'users';

  /// 获取所有用户的实时流
  /// 返回Stream<List<UserModel>>，用于HomeScreen实时监听用户数据变化
  Stream<List<UserModel>> getAllUsersStream() {
    return _firestore
        .collection(_collectionName)
        .orderBy('createdAt', descending: false)
        .snapshots()
        .map((snapshot) {
      return snapshot.docs
          .map((doc) => UserModel.fromJson(doc.data() as Map<String, dynamic>, doc.id))
          .toList();
    });
  }

  /// 获取除当前用户外的所有用户流
  /// 用于HomeScreen过滤掉当前已登录的用户
  Stream<List<UserModel>> getAllUsersExceptCurrentStream(String currentUserId) {
    return _firestore
        .collection(_collectionName)
        .where(FieldPath.documentId, isNotEqualTo: currentUserId)
        .orderBy(FieldPath.documentId)
        .orderBy('createdAt', descending: false)
        .snapshots()
        .map((snapshot) {
      return snapshot.docs
          .map((doc) => UserModel.fromJson(doc.data() as Map<String, dynamic>, doc.id))
          .toList();
    });
  }

  /// 根据用户ID获取单个用户信息
  Future<UserModel?> getUserById(String userId) async {
    try {
      DocumentSnapshot doc = await _firestore
          .collection(_collectionName)
          .doc(userId)
          .get();

      if (doc.exists) {
        return UserModel.fromJson(doc.data() as Map<String, dynamic>, doc.id);
      }
      return null;
    } catch (e) {
      throw Exception('获取用户信息失败：${e.toString()}');
    }
  }

  /// 根据用户ID获取用户信息流（实时监听）
  Stream<UserModel?> getUserByIdStream(String userId) {
    return _firestore
        .collection(_collectionName)
        .doc(userId)
        .snapshots()
        .map((doc) {
      if (doc.exists) {
        return UserModel.fromJson(doc.data() as Map<String, dynamic>, doc.id);
      }
      return null;
    });
  }

  /// 根据邮箱查找用户
  Future<UserModel?> getUserByEmail(String email) async {
    try {
      QuerySnapshot query = await _firestore
          .collection(_collectionName)
          .where('email', isEqualTo: email)
          .limit(1)
          .get();

      if (query.docs.isNotEmpty) {
        return UserModel.fromJson(query.docs.first.data() as Map<String, dynamic>, query.docs.first.id);
      }
      return null;
    } catch (e) {
      throw Exception('查找用户失败：${e.toString()}');
    }
  }

  /// 根据邮箱搜索用户（用于好友系统）
  /// 支持精确匹配和前缀匹配
  Future<List<UserModel>> searchUsersByEmail(String email) async {
    try {
      if (email.trim().isEmpty) {
        return [];
      }

      String emailLower = email.toLowerCase().trim();
      
      // 先尝试精确匹配
      QuerySnapshot exactQuery = await _firestore
          .collection(_collectionName)
          .where('email', isEqualTo: emailLower)
          .get();

      if (exactQuery.docs.isNotEmpty) {
        return exactQuery.docs
            .map((doc) => UserModel.fromJson(doc.data() as Map<String, dynamic>, doc.id))
            .toList();
      }

      // 如果没有精确匹配，尝试前缀匹配
      // 注意：Firestore的前缀查询需要特殊处理
      QuerySnapshot prefixQuery = await _firestore
          .collection(_collectionName)
          .where('email', isGreaterThanOrEqualTo: emailLower)
          .where('email', isLessThan: '${emailLower}z')
          .limit(10)
          .get();

      return prefixQuery.docs
          .map((doc) => UserModel.fromJson(doc.data() as Map<String, dynamic>, doc.id))
          .where((user) => user.email.toLowerCase().startsWith(emailLower))
          .toList();
    } catch (e) {
      throw Exception('搜索用户失败：${e.toString()}');
    }
  }

  /// 搜索用户（按显示名称或邮箱）
  Stream<List<UserModel>> searchUsersStream(String searchQuery, String currentUserId) {
    if (searchQuery.trim().isEmpty) {
      return getAllUsersExceptCurrentStream(currentUserId);
    }

    // Firestore不支持复杂的文本搜索，这里提供基础的前缀匹配
    String searchLower = searchQuery.toLowerCase();
    
    return _firestore
        .collection(_collectionName)
        .where(FieldPath.documentId, isNotEqualTo: currentUserId)
        .orderBy(FieldPath.documentId)
        .snapshots()
        .map((snapshot) {
      return snapshot.docs
          .map((doc) => UserModel.fromJson(doc.data() as Map<String, dynamic>, doc.id))
          .where((user) {
            String displayName = user.displayName.toLowerCase();
            String email = user.email.toLowerCase();
            return displayName.contains(searchLower) || email.contains(searchLower);
          })
          .toList();
    });
  }

  /// 更新用户信息
  Future<void> updateUser(String userId, Map<String, dynamic> data) async {
    try {
      await _firestore
          .collection(_collectionName)
          .doc(userId)
          .update(data);
    } catch (e) {
      throw Exception('更新用户信息失败：${e.toString()}');
    }
  }

  /// 更新用户FCM令牌
  Future<void> updateFCMToken(String userId, String? fcmToken) async {
    try {
      await _firestore
          .collection(_collectionName)
          .doc(userId)
          .update({'fcmToken': fcmToken});
    } catch (e) {
      throw Exception('更新FCM令牌失败：${e.toString()}');
    }
  }

  /// 更新用户在线状态（扩展功能，第二阶段使用）
  Future<void> updateUserOnlineStatus(String userId, bool isOnline) async {
    try {
      await _firestore
          .collection(_collectionName)
          .doc(userId)
          .update({
            'isOnline': isOnline,
            'lastSeen': FieldValue.serverTimestamp(),
          });
    } catch (e) {
      throw Exception('更新在线状态失败：${e.toString()}');
    }
  }

  /// 获取用户统计信息
  Future<Map<String, int>> getUserStats() async {
    try {
      QuerySnapshot snapshot = await _firestore
          .collection(_collectionName)
          .get();

      int totalUsers = snapshot.docs.length;
      int onlineUsers = snapshot.docs
          .where((doc) {
            Map<String, dynamic> data = doc.data() as Map<String, dynamic>;
            return data['isOnline'] == true;
          })
          .length;

      return {
        'totalUsers': totalUsers,
        'onlineUsers': onlineUsers,
      };
    } catch (e) {
      throw Exception('获取用户统计失败：${e.toString()}');
    }
  }

  /// 创建或更新用户文档
  Future<void> createOrUpdateUser(UserModel user) async {
    try {
      await _firestore
          .collection(_collectionName)
          .doc(user.uid)
          .set(user.toJson(), SetOptions(merge: true));
    } catch (e) {
      throw Exception('创建或更新用户失败：${e.toString()}');
    }
  }

  /// 删除用户文档
  Future<void> deleteUser(String userId) async {
    try {
      await _firestore
          .collection(_collectionName)
          .doc(userId)
          .delete();
    } catch (e) {
      throw Exception('删除用户失败：${e.toString()}');
    }
  }

  /// 批量获取多个用户信息
  Future<List<UserModel>> getUsersByIds(List<String> userIds) async {
    if (userIds.isEmpty) return [];

    try {
      // Firestore的in查询限制为10个元素
      List<UserModel> allUsers = [];
      
      for (int i = 0; i < userIds.length; i += 10) {
        List<String> batch = userIds.skip(i).take(10).toList();
        
        QuerySnapshot query = await _firestore
            .collection(_collectionName)
            .where(FieldPath.documentId, whereIn: batch)
            .get();
            
        List<UserModel> batchUsers = query.docs
            .map((doc) => UserModel.fromJson(doc.data() as Map<String, dynamic>, doc.id))
            .toList();
            
        allUsers.addAll(batchUsers);
      }
      
      return allUsers;
    } catch (e) {
      throw Exception('批量获取用户信息失败：${e.toString()}');
    }
  }

  /// 检查用户是否存在
  Future<bool> userExists(String userId) async {
    try {
      DocumentSnapshot doc = await _firestore
          .collection(_collectionName)
          .doc(userId)
          .get();
      return doc.exists;
    } catch (e) {
      return false;
    }
  }

  /// 获取最近注册的用户
  Stream<List<UserModel>> getRecentUsersStream({int limit = 10}) {
    return _firestore
        .collection(_collectionName)
        .orderBy('createdAt', descending: true)
        .limit(limit)
        .snapshots()
        .map((snapshot) {
      return snapshot.docs
          .map((doc) => UserModel.fromJson(doc.data() as Map<String, dynamic>, doc.id))
          .toList();
    });
  }

  /// 更新用户昵称
  /// 严格遵循UserModel数据结构，更新Firestore中的displayName字段
  Future<void> updateDisplayName(String userId, String newDisplayName) async {
    try {
      if (newDisplayName.trim().isEmpty) {
        throw Exception('昵称不能为空');
      }

      await _firestore
          .collection(_collectionName)
          .doc(userId)
          .update({'displayName': newDisplayName.trim()});
    } catch (e) {
      throw Exception('更新昵称失败：${e.toString()}');
    }
  }

  /// 更新用户头像
  /// 从相册选择图片，上传到Firebase Storage，然后更新photoUrl字段
  Future<String?> updateUserProfilePicture(String userId) async {
    try {
      // 从相册选择图片
      final XFile? pickedFile = await _imagePicker.pickImage(
        source: ImageSource.gallery,
        maxWidth: 512,
        maxHeight: 512,
        imageQuality: 80,
      );

      if (pickedFile == null) {
        return null; // 用户取消选择
      }

      File imageFile = File(pickedFile.path);

      // 上传到Firebase Storage
      // 必须符合安全规则的路径格式：avatars/{userId}/{文件名}
      String fileName = 'profile_${DateTime.now().millisecondsSinceEpoch}.jpg';
      Reference ref = _storage.ref().child('avatars/$userId/$fileName');

      UploadTask uploadTask = ref.putFile(imageFile);
      TaskSnapshot snapshot = await uploadTask;

      // 获取下载URL
      String downloadUrl = await snapshot.ref.getDownloadURL();

      // 更新Firestore中的photoUrl字段
      await _firestore
          .collection(_collectionName)
          .doc(userId)
          .update({'photoUrl': downloadUrl});

      return downloadUrl;
    } catch (e) {
      throw Exception('更新头像失败：${e.toString()}');
    }
  }

  /// 从相机拍摄并更新用户头像
  Future<String?> updateUserProfilePictureFromCamera(String userId) async {
    try {
      // 从相机拍摄图片
      final XFile? pickedFile = await _imagePicker.pickImage(
        source: ImageSource.camera,
        maxWidth: 512,
        maxHeight: 512,
        imageQuality: 80,
      );

      if (pickedFile == null) {
        return null; // 用户取消拍摄
      }

      File imageFile = File(pickedFile.path);

      // 上传到Firebase Storage
      // 必须符合安全规则的路径格式：avatars/{userId}/{文件名}
      String fileName = 'profile_${DateTime.now().millisecondsSinceEpoch}.jpg';
      Reference ref = _storage.ref().child('avatars/$userId/$fileName');

      UploadTask uploadTask = ref.putFile(imageFile);
      TaskSnapshot snapshot = await uploadTask;

      // 获取下载URL
      String downloadUrl = await snapshot.ref.getDownloadURL();

      // 更新Firestore中的photoUrl字段
      await _firestore
          .collection(_collectionName)
          .doc(userId)
          .update({'photoUrl': downloadUrl});

      return downloadUrl;
    } catch (e) {
      throw Exception('拍摄并更新头像失败：${e.toString()}');
    }
  }
}
