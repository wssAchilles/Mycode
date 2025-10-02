import 'package:cloud_firestore/cloud_firestore.dart';

/// 位置类型枚举
enum LocationType {
  /// 当前位置
  currentLocation,
  /// 兴趣点
  pointOfInterest,
  /// 实时位置
  liveLocation
}

/// 位置数据模型类
/// 
/// 对应位置分享消息的数据结构
/// 严格遵循项目铁律定义
class LocationModel {
  /// 位置唯一ID
  final String locationId;
  
  /// 位置类型
  final LocationType type;
  
  /// 纬度
  final double latitude;
  
  /// 经度
  final double longitude;
  
  /// 位置名称
  final String? name;
  
  /// 地址
  final String? address;
  
  /// Google Places ID
  final String? placeId;
  
  /// 实时位置分享的过期时间
  final Timestamp? expiresAt;
  
  /// 分享者UID
  final String sharedBy;
  
  /// 构造函数
  const LocationModel({
    required this.locationId,
    required this.type,
    required this.latitude,
    required this.longitude,
    this.name,
    this.address,
    this.placeId,
    this.expiresAt,
    required this.sharedBy,
  });
  
  /// 从Firestore文档数据创建LocationModel实例
  /// 
  /// [json] Firestore文档的数据
  /// [id] 文档ID（locationId）
  factory LocationModel.fromJson(Map<String, dynamic> json, String id) {
    return LocationModel(
      locationId: id,
      type: _locationTypeFromString(json['type']),
      latitude: (json['latitude'] ?? 0.0).toDouble(),
      longitude: (json['longitude'] ?? 0.0).toDouble(),
      name: json['name'],
      address: json['address'],
      placeId: json['placeId'],
      expiresAt: json['expiresAt'],
      sharedBy: json['sharedBy'] ?? '',
    );
  }
  
  /// 将LocationModel实例转换为可存储到Firestore的Map
  Map<String, dynamic> toJson() {
    return {
      'locationId': locationId,
      'type': _locationTypeToString(type),
      'latitude': latitude,
      'longitude': longitude,
      'name': name,
      'address': address,
      'placeId': placeId,
      'expiresAt': expiresAt,
      'sharedBy': sharedBy,
    };
  }
  
  /// 创建LocationModel的副本，可选择性地更新某些字段
  LocationModel copyWith({
    String? locationId,
    LocationType? type,
    double? latitude,
    double? longitude,
    String? name,
    String? address,
    String? placeId,
    Timestamp? expiresAt,
    String? sharedBy,
  }) {
    return LocationModel(
      locationId: locationId ?? this.locationId,
      type: type ?? this.type,
      latitude: latitude ?? this.latitude,
      longitude: longitude ?? this.longitude,
      name: name ?? this.name,
      address: address ?? this.address,
      placeId: placeId ?? this.placeId,
      expiresAt: expiresAt ?? this.expiresAt,
      sharedBy: sharedBy ?? this.sharedBy,
    );
  }
  
  /// 将LocationType枚举转换为字符串
  static String _locationTypeToString(LocationType type) {
    return type.toString().split('.').last;
  }
  
  /// 将字符串转换为LocationType枚举
  static LocationType _locationTypeFromString(String? typeString) {
    switch (typeString) {
      case 'currentLocation':
        return LocationType.currentLocation;
      case 'pointOfInterest':
        return LocationType.pointOfInterest;
      case 'liveLocation':
        return LocationType.liveLocation;
      default:
        return LocationType.currentLocation;
    }
  }
}
