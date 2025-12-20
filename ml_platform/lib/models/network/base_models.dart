
import 'dart:collection';
import 'package:uuid/uuid.dart';

/// 全局唯一ID生成器
final _uuid = Uuid();

// ==========================================
// 基础地址类型 (Address Types)
// ==========================================

/// MAC地址值对象
class MacAddress {
  final String value;

  const MacAddress(this.value);

  /// 生成随机MAC地址
  static MacAddress random() {
    // 简单生成一个本地测试用的MAC
    return MacAddress('AA:BB:CC:DD:EE:${_uuid.v4().substring(0, 2).toUpperCase()}');
  }

  @override
  String toString() => value;

  @override
  bool operator ==(Object other) => other is MacAddress && other.value == value;

  @override
  int get hashCode => value.hashCode;
  
  /// 广播MAC地址
  static const broadcast = MacAddress('FF:FF:FF:FF:FF:FF');
}

/// IP地址值对象
class IpAddress {
  final String value;

  const IpAddress(this.value);

  /// 检查是否在同一子网
  bool inSameSubnet(IpAddress other, String netmask) {
    // TODO: 实现真实的子网掩码校验逻辑
    // 简单实现：假设都是 /24
    final parts1 = value.split('.');
    final parts2 = other.value.split('.');
    if (parts1.length != 4 || parts2.length != 4) return false;
    return parts1[0] == parts2[0] && 
           parts1[1] == parts2[1] && 
           parts1[2] == parts2[2];
  }

  @override
  String toString() => value;
  
  @override
  bool operator ==(Object other) => other is IpAddress && other.value == value;

  @override
  int get hashCode => value.hashCode;
}

// ==========================================
// 数据包基类 (Packet Base)
// ==========================================

/// 网络数据包抽象基类
/// 所有层级的包（EthernetFrame, IpPacket, TcpPacket）都应实现此接口或继承此累
abstract class Packet {
  String get name; // 显示名称，如 "TCP SYN"
  String get description; // 详细描述
  int get sizeBytes; // 包大小（用于计算延迟）
  
  /// 深度复制
  Packet copy();
}

// ==========================================
// 网络接口与设备 (Interface & Device)
// ==========================================

/// 网络接口 (相当于网卡)
class NetworkInterface {
  final String name; // e.g., "eth0"
  MacAddress macAddress;
  IpAddress? ipAddress;
  String? netmask; // e.g., "255.255.255.0"
  
  /// 连接的链路 (Link)
  NetworkLink? link;
  
  /// 所属设备
  final NetworkDevice device;

  NetworkInterface({
    required this.device,
    required this.name,
    required this.macAddress,
    this.ipAddress,
    this.netmask = '255.255.255.0',
  });

  bool get isConnected => link != null;
}

/// 表示链路上正在传输的数据包 (用于可视化动画)
class PacketTransmission {
  final String id;
  final Packet packet;
  final NetworkInterface sourceDetails; // 发送方接口
  final NetworkInterface targetDetails; // 接收方接口
  final double startTime; // 开始传输的仿真时间
  final double endTime; // 预计到达的仿真时间
  double progress = 0.0; // 0.0 ~ 1.0 (由UI或各种Tick更新)

  PacketTransmission({
    required this.packet,
    required this.sourceDetails,
    required this.targetDetails,
    required this.startTime,
    required this.endTime,
  }) : id = _uuid.v4();
}

/// 物理链路 (连接两个接口)
class NetworkLink {
  final String id;
  final NetworkInterface interface1;
  final NetworkInterface interface2;
  
  // 物理属性
  double lengthMeters; // 线缆长度
  double propagationDelayMs; // 物理传播延迟 (通常忽略不计，除非卫星)
  double bandwidthMbps; // 带宽 (影响传输延迟)
  
  // 可视化状态：链路上的数据包
  final List<PacketTransmission> activeTransmissions = [];

  NetworkLink({
    String? id,
    required this.interface1,
    required this.interface2,
    this.lengthMeters = 10.0,
    this.propagationDelayMs = 1.0,
    this.bandwidthMbps = 100.0,
  }) : id = id ?? _uuid.v4();

  /// 获取对端接口
  NetworkInterface? getPeer(NetworkInterface source) {
    if (source == interface1) return interface2;
    if (source == interface2) return interface1;
    return null;
  }
}

/// 抽象网络设备
abstract class NetworkDevice {
  final String id;
  String name;
  final Map<String, NetworkInterface> interfaces = {};
  
  // 3D/2D 坐标（用于拓扑图）
  double x;
  double y;

  NetworkDevice({
    String? id,
    required this.name,
    this.x = 0,
    this.y = 0,
  }) : id = id ?? _uuid.v4();

  /// 添加接口
  void addInterface(NetworkInterface iface) {
    interfaces[iface.name] = iface;
  }
  
  /// 接收数据包 (由 Simulator 调用)
  /// [packet] 收到的包
  /// [inInterface] 接收接口
  void receivePacket(Packet packet, NetworkInterface inInterface);
  
  /// (Tick 驱动) 设备内部处理逻辑，如路由查表、ARP超时等
  void onTick(double currentTime);
}
