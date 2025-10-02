import 'package:geolocator/geolocator.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/location_model.dart';
import '../models/message_model.dart';
import 'chat_service.dart';

/// 位置服务类
/// 
/// 处理位置获取、权限管理和位置消息发送
/// 严格遵循项目数据模型规范
class LocationService {
  static final LocationService _instance = LocationService._internal();
  factory LocationService() => _instance;
  LocationService._internal();

  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final ChatService _chatService = ChatService();

  /// 获取当前设备位置
  /// 
  /// 返回设备的经纬度坐标
  /// 会自动处理位置权限请求
  Future<Position?> getCurrentLocation() async {
    try {
      // 检查位置权限
      bool hasPermission = await _checkLocationPermission();
      if (!hasPermission) {
        throw Exception('位置权限被拒绝');
      }

      // 检查位置服务是否启用
      bool serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        throw Exception('位置服务未启用，请在设置中开启位置服务');
      }

      // 获取当前位置
      Position position = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
        timeLimit: const Duration(seconds: 10),
      );

      return position;
    } catch (e) {
      throw Exception('获取位置失败：${e.toString()}');
    }
  }

  /// 检查和请求位置权限
  Future<bool> _checkLocationPermission() async {
    PermissionStatus permission = await Permission.location.status;
    
    if (permission == PermissionStatus.denied) {
      permission = await Permission.location.request();
    }
    
    if (permission == PermissionStatus.permanentlyDenied) {
      // 引导用户到设置页面
      await Permission.location.request();
      return false;
    }
    
    return permission == PermissionStatus.granted;
  }

  /// 发送当前位置消息到聊天室
  /// 
  /// [chatRoomId] 聊天室ID
  /// [senderId] 发送者UID
  /// [receiverId] 接收者UID
  /// [name] 可选的位置名称
  /// [address] 可选的地址信息
  Future<void> shareCurrentLocationMessage({
    required String chatRoomId,
    required String senderId,
    required String receiverId,
    String? name,
    String? address,
  }) async {
    try {
      // 获取当前位置
      Position? position = await getCurrentLocation();
      if (position == null) {
        throw Exception('无法获取当前位置');
      }

      // 创建位置模型
      String locationId = _firestore.collection('locations').doc().id;
      LocationModel locationModel = LocationModel(
        locationId: locationId,
        type: LocationType.currentLocation,
        latitude: position.latitude,
        longitude: position.longitude,
        name: name ?? '我的位置',
        address: address,
        sharedBy: senderId,
      );

      // 保存位置数据到Firestore
      await _firestore
          .collection('locations')
          .doc(locationId)
          .set(locationModel.toJson());

      // 发送位置消息
      await _chatService.sendMessage(
        receiverId: receiverId,
        senderId: senderId,
        text: '[位置]',
      );
    } catch (e) {
      throw Exception('发送位置消息失败：${e.toString()}');
    }
  }

  /// 发送兴趣点(POI)位置消息
  /// 
  /// [chatRoomId] 聊天室ID
  /// [senderId] 发送者UID
  /// [receiverId] 接收者UID
  /// [latitude] 纬度
  /// [longitude] 经度
  /// [name] 地点名称
  /// [address] 地址
  /// [placeId] Google Places ID
  Future<void> sharePOILocationMessage({
    required String chatRoomId,
    required String senderId,
    required String receiverId,
    required double latitude,
    required double longitude,
    required String name,
    String? address,
    String? placeId,
  }) async {
    try {
      // 创建位置模型
      String locationId = _firestore.collection('locations').doc().id;
      LocationModel locationModel = LocationModel(
        locationId: locationId,
        type: LocationType.pointOfInterest,
        latitude: latitude,
        longitude: longitude,
        name: name,
        address: address,
        placeId: placeId,
        sharedBy: senderId,
      );

      // 保存位置数据到Firestore
      await _firestore
          .collection('locations')
          .doc(locationId)
          .set(locationModel.toJson());

      // 发送POI消息
      await _chatService.sendMessage(
        receiverId: receiverId,
        senderId: senderId,
        text: '[兴趣点] ${name}',
      );
    } catch (e) {
      throw Exception('发送POI位置消息失败：${e.toString()}');
    }
  }

  /// 开始实时位置分享
  /// 
  /// [chatRoomId] 聊天室ID
  /// [senderId] 发送者UID
  /// [receiverId] 接收者UID
  /// [durationMinutes] 分享时长（分钟）
  Future<void> startLiveLocationSharing({
    required String chatRoomId,
    required String senderId,
    required String receiverId,
    required int durationMinutes,
  }) async {
    try {
      // 获取当前位置
      Position? position = await getCurrentLocation();
      if (position == null) {
        throw Exception('无法获取当前位置');
      }

      // 计算过期时间
      Timestamp expiresAt = Timestamp.fromDate(
        DateTime.now().add(Duration(minutes: durationMinutes)),
      );

      // 创建位置模型
      String locationId = _firestore.collection('locations').doc().id;
      LocationModel locationModel = LocationModel(
        locationId: locationId,
        type: LocationType.liveLocation,
        latitude: position.latitude,
        longitude: position.longitude,
        name: '实时位置',
        expiresAt: expiresAt,
        sharedBy: senderId,
      );

      // 保存位置数据到Firestore
      await _firestore
          .collection('locations')
          .doc(locationId)
          .set(locationModel.toJson());

      // 发送实时位置消息
      await _chatService.sendMessage(
        receiverId: receiverId,
        senderId: senderId,
        text: '[实时位置] 分享 ${durationMinutes} 分钟',
      );

      // 启动位置更新定时器（每30秒更新一次）
      _startLocationUpdateTimer(locationId, durationMinutes);
    } catch (e) {
      throw Exception('开始实时位置分享失败：${e.toString()}');
    }
  }

  /// 启动位置更新定时器
  void _startLocationUpdateTimer(String locationId, int durationMinutes) {
    // TODO: 实现定时更新位置的功能
    // 这里需要使用Timer.periodic每30秒更新一次位置
    // 当达到过期时间时停止更新
  }

  /// 根据位置ID获取位置信息
  Future<LocationModel?> getLocationById(String locationId) async {
    try {
      DocumentSnapshot doc = await _firestore
          .collection('locations')
          .doc(locationId)
          .get();

      if (doc.exists) {
        return LocationModel.fromJson(
          doc.data() as Map<String, dynamic>, 
          doc.id,
        );
      }
      return null;
    } catch (e) {
      throw Exception('获取位置信息失败：${e.toString()}');
    }
  }

  /// 获取位置信息流（实时监听）
  Stream<LocationModel?> getLocationByIdStream(String locationId) {
    return _firestore
        .collection('locations')
        .doc(locationId)
        .snapshots()
        .map((doc) {
      if (doc.exists) {
        return LocationModel.fromJson(
          doc.data() as Map<String, dynamic>,
          doc.id,
        );
      }
      return null;
    });
  }

  /// 停止实时位置分享
  Future<void> stopLiveLocationSharing(String locationId) async {
    try {
      await _firestore
          .collection('locations')
          .doc(locationId)
          .update({
        'expiresAt': Timestamp.now(), // 设置为当前时间，表示立即过期
      });
    } catch (e) {
      throw Exception('停止实时位置分享失败：${e.toString()}');
    }
  }

  /// 计算两个位置之间的距离（米）
  double calculateDistance({
    required double lat1,
    required double lon1,
    required double lat2,
    required double lon2,
  }) {
    return Geolocator.distanceBetween(lat1, lon1, lat2, lon2);
  }

  /// 格式化距离显示
  String formatDistance(double distanceInMeters) {
    if (distanceInMeters < 1000) {
      return '${distanceInMeters.round()}m';
    } else {
      double km = distanceInMeters / 1000;
      return '${km.toStringAsFixed(1)}km';
    }
  }

  /// 生成Google静态地图URL（用于消息预览）
  String generateStaticMapUrl({
    required double latitude,
    required double longitude,
    int zoom = 15,
    String size = '300x200',
    String? apiKey,
  }) {
    if (apiKey == null) {
      // 如果没有API Key，返回一个占位符URL
      return 'https://via.placeholder.com/300x200/CCCCCC/666666?text=地图预览';
    }
    
    return 'https://maps.googleapis.com/maps/api/staticmap?'
        'center=$latitude,$longitude'
        '&zoom=$zoom'
        '&size=$size'
        '&markers=color:red%7C$latitude,$longitude'
        '&key=$apiKey';
  }
}
