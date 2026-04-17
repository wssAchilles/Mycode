/// IP网络模型定义
import 'dart:math';

/// IP数据包
class IpPacket {
  final String sourceIp;
  final String destinationIp;
  int ttl;
  final String protocol;
  final String? data;
  final int id;
  final DateTime timestamp;
  String currentLocation;
  List<String> path;

  IpPacket({
    required this.sourceIp,
    required this.destinationIp,
    this.ttl = 64,
    this.protocol = 'TCP',
    this.data,
    int? id,
    DateTime? timestamp,
    String? currentLocation,
    List<String>? path,
  }) : id = id ?? Random().nextInt(65535),
        timestamp = timestamp ?? DateTime.now(),
        currentLocation = currentLocation ?? sourceIp,
        path = path ?? [sourceIp];

  /// 减少TTL
  bool decrementTTL() {
    ttl--;
    return ttl > 0;
  }

  /// 添加路径节点
  void addToPath(String node) {
    path.add(node);
    currentLocation = node;
  }

  /// 获取简短描述
  String get shortDescription {
    return 'Packet #$id: $sourceIp → $destinationIp (TTL: $ttl)';
  }

  /// 复制包
  IpPacket copyWith({
    String? sourceIp,
    String? destinationIp,
    int? ttl,
    String? protocol,
    String? data,
    String? currentLocation,
    List<String>? path,
  }) {
    return IpPacket(
      sourceIp: sourceIp ?? this.sourceIp,
      destinationIp: destinationIp ?? this.destinationIp,
      ttl: ttl ?? this.ttl,
      protocol: protocol ?? this.protocol,
      data: data ?? this.data,
      id: id,
      timestamp: timestamp,
      currentLocation: currentLocation ?? this.currentLocation,
      path: path ?? List.from(this.path),
    );
  }
}

/// 路由表条目
class RoutingEntry {
  final String destination;
  final String netmask;
  final String nextHop;
  final String interface;
  final int metric;
  final bool isDefault;

  RoutingEntry({
    required this.destination,
    required this.netmask,
    required this.nextHop,
    required this.interface,
    this.metric = 1,
    this.isDefault = false,
  });

  /// 检查IP是否匹配此路由条目
  bool matches(String ip) {
    if (isDefault) return true;
    
    // 简化的IP匹配逻辑
    if (destination == 'default' || destination == '0.0.0.0') {
      return true;
    }
    
    // 检查网络前缀匹配
    final destParts = destination.split('.');
    final ipParts = ip.split('.');
    final maskParts = netmask.split('.');
    
    for (int i = 0; i < 4; i++) {
      int mask = int.parse(maskParts[i]);
      if (mask == 255) {
        if (destParts[i] != ipParts[i]) {
          return false;
        }
      } else if (mask > 0) {
        // 部分匹配
        int destByte = int.parse(destParts[i]);
        int ipByte = int.parse(ipParts[i]);
        if ((destByte & mask) != (ipByte & mask)) {
          return false;
        }
      }
    }
    return true;
  }

  String get displayText {
    if (isDefault) {
      return 'Default → $nextHop';
    }
    return '$destination/$netmask → $nextHop';
  }
}

/// 路由表
class RoutingTable {
  final String nodeName;
  final List<RoutingEntry> entries;

  RoutingTable({
    required this.nodeName,
    List<RoutingEntry>? entries,
  }) : entries = entries ?? [];

  /// 添加路由条目
  void addEntry(RoutingEntry entry) {
    entries.add(entry);
  }

  /// 查找下一跳
  String? findNextHop(String destinationIp) {
    // 首先查找最具体的匹配
    RoutingEntry? bestMatch;
    int bestMaskLength = -1;
    
    for (final entry in entries) {
      if (entry.matches(destinationIp)) {
        // 计算掩码长度（简化版）
        int maskLength = entry.isDefault ? 0 : 
            entry.netmask.split('.').map((s) => 
              int.parse(s).toRadixString(2).replaceAll('0', '').length
            ).reduce((a, b) => a + b);
        
        if (maskLength > bestMaskLength) {
          bestMatch = entry;
          bestMaskLength = maskLength;
        }
      }
    }
    
    return bestMatch?.nextHop;
  }

  /// 获取匹配的路由条目
  RoutingEntry? getMatchingEntry(String destinationIp) {
    RoutingEntry? bestMatch;
    int bestMaskLength = -1;
    
    for (final entry in entries) {
      if (entry.matches(destinationIp)) {
        int maskLength = entry.isDefault ? 0 : 
            entry.netmask.split('.').map((s) => 
              int.parse(s).toRadixString(2).replaceAll('0', '').length
            ).reduce((a, b) => a + b);
        
        if (maskLength > bestMaskLength) {
          bestMatch = entry;
          bestMaskLength = maskLength;
        }
      }
    }
    
    return bestMatch;
  }
}

/// 网络节点类型
enum NetworkNodeType {
  host,
  router,
  networkSwitch,
}

/// 网络节点
class NetworkNode {
  final String id;
  final String name;
  final NetworkNodeType type;
  final String ipAddress;
  final RoutingTable? routingTable;
  final Map<String, String> interfaces; // 接口名 -> IP地址
  final double x;
  final double y;

  NetworkNode({
    required this.id,
    required this.name,
    required this.type,
    required this.ipAddress,
    this.routingTable,
    Map<String, String>? interfaces,
    this.x = 0,
    this.y = 0,
  }) : interfaces = interfaces ?? {};

  bool get isRouter => type == NetworkNodeType.router;
  bool get isHost => type == NetworkNodeType.host;
}

/// 网络连接
class NetworkLink {
  final String id;
  final String node1Id;
  final String node2Id;
  final int bandwidth; // Mbps
  final int delay; // ms
  final double packetLoss; // 0-1

  NetworkLink({
    required this.id,
    required this.node1Id,
    required this.node2Id,
    this.bandwidth = 100,
    this.delay = 10,
    this.packetLoss = 0.0,
  });
}

/// 路由事件
class RoutingEvent {
  final DateTime timestamp;
  final String type;
  final String nodeId;
  final String description;
  final IpPacket? packet;
  final RoutingEntry? routingEntry;
  final int? delay;

  RoutingEvent({
    DateTime? timestamp,
    required this.type,
    required this.nodeId,
    required this.description,
    this.packet,
    this.routingEntry,
    this.delay = 500,
  }) : timestamp = timestamp ?? DateTime.now();
}

/// ICMP消息类型
enum IcmpType {
  echoRequest,
  echoReply,
  destinationUnreachable,
  timeExceeded,
  parameterProblem,
  sourceQuench,
  redirect,
}

/// ICMP消息
class IcmpMessage {
  final IcmpType type;
  final int code;
  final String sourceIp;
  final String destinationIp;
  final String? data;
  final IpPacket? originalPacket;

  IcmpMessage({
    required this.type,
    this.code = 0,
    required this.sourceIp,
    required this.destinationIp,
    this.data,
    this.originalPacket,
  });

  String get description {
    switch (type) {
      case IcmpType.echoRequest:
        return 'Echo Request (Ping)';
      case IcmpType.echoReply:
        return 'Echo Reply (Pong)';
      case IcmpType.destinationUnreachable:
        return 'Destination Unreachable';
      case IcmpType.timeExceeded:
        return 'Time Exceeded (TTL = 0)';
      case IcmpType.parameterProblem:
        return 'Parameter Problem';
      case IcmpType.sourceQuench:
        return 'Source Quench';
      case IcmpType.redirect:
        return 'Redirect';
    }
  }
}
