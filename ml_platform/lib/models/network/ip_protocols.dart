
import 'base_models.dart';

// ==========================================
// IP 协议 (Internet Protocol)
// ==========================================

class IpProtocol {
  static const int icmp = 1;
  static const int tcp = 6;
  static const int udp = 17;
}

class IpPacket extends Packet {
  final IpAddress sourceIp;
  final IpAddress destinationIp;
  int ttl;
  final int protocol; // e.g., 6 (TCP), 17 (UDP)
  final Packet? payload; // 承载的上层协议包 (如 TcpPacket, IcmpMessage)
  
  // 仿真用 ID
  final int id; 

  IpPacket({
    required this.sourceIp,
    required this.destinationIp,
    this.ttl = 64,
    required this.protocol,
    this.payload,
    int? id,
  }) : id = id ?? DateTime.now().microsecondsSinceEpoch;

  @override
  String get name => 'IP Packet';

  @override
  String get description => 'Src: $sourceIp, Dst: $destinationIp, Proto: $protocol, TTL: $ttl';

  @override
  int get sizeBytes => 20 + (payload?.sizeBytes ?? 0); // Header 20 + Payload

  @override
  Packet copy() {
    return IpPacket(
      sourceIp: sourceIp,
      destinationIp: destinationIp,
      ttl: ttl,
      protocol: protocol,
      payload: payload?.copy(),
      id: id,
    );
  }
}

// ==========================================
// 路由 (Routing)
// ==========================================

class RoutingEntry {
  final IpAddress destination;
  final String netmask; // e.g., "255.255.255.0"
  final IpAddress? nextHop; // 如果为空，表示直连 (Directly Connected)
  final String interfaceName; // 出接口名称
  final int metric;
  
  RoutingEntry({
    required this.destination,
    required this.netmask,
    this.nextHop,
    required this.interfaceName,
    this.metric = 1,
  });
  
  // 判断是否是网关路由 (非直连)
  bool get isGateway => nextHop != null;

  /// 检查IP是否匹配此路由条目
  bool matches(IpAddress ip) {
    if (destination.value == '0.0.0.0' && netmask == '0.0.0.0') return true; // Default Route
    
    return ip.inSameSubnet(destination, netmask);
  }
  
  /// 获取掩码长度 (用于最长前缀匹配)
  int get prefixLength {
    if (destination.value == '0.0.0.0') return 0;
    // 简单计算：统计 1 的个数
    // 这里简化处理：直接根据 string 长度估算 或者 解析
    // TODO: 实现更精准的掩码长度计算
    return netmask.split('.').where((p) => p != '0').length * 8; 
  }
}
