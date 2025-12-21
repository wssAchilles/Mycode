
import 'package:flutter/foundation.dart';
import 'base_models.dart';
import 'ip_protocols.dart';
import 'device_implementations.dart';
import '../../services/network/network_simulator.dart';

// ==========================================
// UDP 数据报 (UDP Datagram)
// ==========================================

/// UDP 数据报 (用于 DNS 等无连接协议)
class UdpDatagram extends Packet {
  final int sourcePort;
  final int destinationPort;
  final String data;
  final Packet? payload; // For simulation: carrying complex objects vs raw bytes

  UdpDatagram({
    required this.sourcePort,
    required this.destinationPort,
    this.data = '',
    this.payload,
  });

  @override
  String get name => 'UDP';

  @override
  String get description => 'UDP $sourcePort -> $destinationPort';

  @override
  int get sizeBytes => 8 + (payload?.sizeBytes ?? data.length);

  @override
  Packet copy() => UdpDatagram(
    sourcePort: sourcePort,
    destinationPort: destinationPort,
    data: data,
    payload: payload?.copy(),
  );
}

// ==========================================
// DNS 协议 (DNS Protocol)
// ==========================================

/// DNS 查询类型
enum DnsQueryType {
  a,      // IPv4 地址
  aaaa,   // IPv6 地址
  cname,  // 别名
  mx,     // 邮件交换
  ns,     // 域名服务器
  txt,    // 文本记录
}

/// DNS 消息类型
enum DnsMessageType {
  query,    // 查询
  response, // 响应
}

/// DNS 响应码
enum DnsResponseCode {
  noError,        // 成功
  formatError,    // 格式错误
  serverFailure,  // 服务器失败
  nameError,      // 域名不存在 (NXDOMAIN)
  notImplemented, // 未实现
  refused,        // 拒绝
}

/// DNS 消息 (简化版)
class DnsMessage {
  final int transactionId;
  final DnsMessageType type;
  final DnsQueryType queryType;
  final String queryName;
  final DnsResponseCode? responseCode;
  final List<DnsResourceRecord> answers;

  DnsMessage({
    required this.transactionId,
    required this.type,
    required this.queryType,
    required this.queryName,
    this.responseCode,
    this.answers = const [],
  });

  /// 序列化为字符串 (简化, 真实 DNS 使用二进制格式)
  String serialize() {
    final buffer = StringBuffer();
    buffer.write('DNS|');
    buffer.write('$transactionId|');
    buffer.write('${type.name}|');
    buffer.write('${queryType.name}|');
    buffer.write('$queryName|');
    if (type == DnsMessageType.response) {
      buffer.write('${responseCode?.name}|');
      for (var answer in answers) {
        buffer.write('${answer.name}:${answer.type.name}:${answer.data};');
      }
    }
    return buffer.toString();
  }

  /// 从字符串反序列化
  static DnsMessage? deserialize(String data) {
    try {
      final parts = data.split('|');
      if (parts.isEmpty || parts[0] != 'DNS') return null;
      
      final transactionId = int.parse(parts[1]);
      final type = DnsMessageType.values.firstWhere((e) => e.name == parts[2]);
      final queryType = DnsQueryType.values.firstWhere((e) => e.name == parts[3]);
      final queryName = parts[4];
      
      if (type == DnsMessageType.query) {
        return DnsMessage(
          transactionId: transactionId,
          type: type,
          queryType: queryType,
          queryName: queryName,
        );
      } else {
        final responseCode = DnsResponseCode.values.firstWhere((e) => e.name == parts[5]);
        final answers = <DnsResourceRecord>[];
        if (parts.length > 6 && parts[6].isNotEmpty) {
          for (var answerStr in parts[6].split(';')) {
            if (answerStr.isEmpty) continue;
            final answerParts = answerStr.split(':');
            answers.add(DnsResourceRecord(
              name: answerParts[0],
              type: DnsQueryType.values.firstWhere((e) => e.name == answerParts[1]),
              data: answerParts[2],
              ttl: 3600,
            ));
          }
        }
        return DnsMessage(
          transactionId: transactionId,
          type: type,
          queryType: queryType,
          queryName: queryName,
          responseCode: responseCode,
          answers: answers,
        );
      }
    } catch (e) {
      debugPrint('DnsMessage.deserialize error: $e');
      return null;
    }
  }
}

/// DNS 资源记录 (RR)
class DnsResourceRecord {
  final String name;
  final DnsQueryType type;
  final String data; // 例如 IP 地址
  final int ttl;

  DnsResourceRecord({
    required this.name,
    required this.type,
    required this.data,
    this.ttl = 3600,
  });
}

// ==========================================
// DNS 服务 (DNS Service)
// ==========================================

/// DNS 解析器 (客户端)
class DnsResolver {
  final IpAddress dnsServerIp;
  final IpDevice device;
  
  int _transactionCounter = 0;
  
  // 缓存: domain -> (ip, expireTime)
  final Map<String, (IpAddress, DateTime)> _cache = {};
  
  // 待处理的查询: transactionId -> Completer
  final Map<int, void Function(DnsMessage?)> _pendingQueries = {};

  DnsResolver({
    required this.dnsServerIp,
    required this.device,
  });

  /// 解析域名
  Future<IpAddress?> resolve(String domain) async {
    // 1. 检查缓存
    if (_cache.containsKey(domain)) {
      final (ip, expire) = _cache[domain]!;
      if (DateTime.now().isBefore(expire)) {
        debugPrint('DnsResolver: Cache hit for $domain -> $ip');
        return ip;
      }
      _cache.remove(domain);
    }
    
    // 2. 发送 DNS 查询
    final transactionId = ++_transactionCounter;
    final query = DnsMessage(
      transactionId: transactionId,
      type: DnsMessageType.query,
      queryType: DnsQueryType.a,
      queryName: domain,
    );
    
    IpAddress? result;
    bool completed = false;
    
    _pendingQueries[transactionId] = (response) {
      if (response != null && response.answers.isNotEmpty) {
        final ip = IpAddress(response.answers.first.data);
        _cache[domain] = (ip, DateTime.now().add(Duration(seconds: response.answers.first.ttl)));
        result = ip;
      }
      completed = true;
    };
    
    // 发送 UDP 数据报
    _sendDnsQuery(query);
    
    // 等待响应 (超时 5 秒)
    final deadline = DateTime.now().add(const Duration(seconds: 5));
    while (!completed && DateTime.now().isBefore(deadline)) {
      await Future.delayed(const Duration(milliseconds: 100));
    }
    
    _pendingQueries.remove(transactionId);
    return result;
  }

  void _sendDnsQuery(DnsMessage query) {
    final datagram = UdpDatagram(
      sourcePort: 53000 + query.transactionId % 1000,
      destinationPort: 53,
      data: query.serialize(),
    );
    
    final ipPacket = IpPacket(
      sourceIp: device.interfaces.values.first.ipAddress!,
      destinationIp: dnsServerIp,
      protocol: IpProtocol.udp,
      payload: datagram,
    );
    
    device.sendIpPacket(ipPacket);
  }

  /// 处理收到的 DNS 响应 (由 IpDevice 调用)
  void handleDnsResponse(DnsMessage response) {
    if (_pendingQueries.containsKey(response.transactionId)) {
      _pendingQueries[response.transactionId]!(response);
    }
  }
}

/// DNS 服务器
class DnsServer {
  final IpDevice device;
  
  // 域名记录: domain -> IP
  final Map<String, String> _records = {};

  DnsServer(this.device);

  /// 添加 A 记录
  void addARecord(String domain, String ip) {
    _records[domain] = ip;
  }

  /// 处理 DNS 请求 (由 IpDevice 调用)
  void handleDnsQuery(IpPacket packet, UdpDatagram datagram) {
    final query = DnsMessage.deserialize(datagram.data);
    if (query == null || query.type != DnsMessageType.query) return;
    
    debugPrint('DnsServer: Query for ${query.queryName}');
    
    DnsMessage response;
    if (_records.containsKey(query.queryName)) {
      response = DnsMessage(
        transactionId: query.transactionId,
        type: DnsMessageType.response,
        queryType: query.queryType,
        queryName: query.queryName,
        responseCode: DnsResponseCode.noError,
        answers: [
          DnsResourceRecord(
            name: query.queryName,
            type: DnsQueryType.a,
            data: _records[query.queryName]!,
          ),
        ],
      );
    } else {
      response = DnsMessage(
        transactionId: query.transactionId,
        type: DnsMessageType.response,
        queryType: query.queryType,
        queryName: query.queryName,
        responseCode: DnsResponseCode.nameError,
      );
    }
    
    // 发送响应
    final responseDatagram = UdpDatagram(
      sourcePort: 53,
      destinationPort: datagram.sourcePort,
      data: response.serialize(),
    );
    
    final ipResponse = IpPacket(
      sourceIp: device.interfaces.values.first.ipAddress!,
      destinationIp: packet.sourceIp,
      protocol: IpProtocol.udp,
      payload: responseDatagram,
    );
    
    device.sendIpPacket(ipResponse);
  }
}
