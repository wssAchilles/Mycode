
import 'package:flutter/foundation.dart';
import 'base_models.dart';
import 'ip_protocols.dart';
import 'device_implementations.dart';

/// ICMP 消息类型
enum IcmpType {
  echoReply,      // 0
  destinationUnreachable, // 3
  echoRequest,    // 8
  timeExceeded,   // 11
}

/// ICMP 消息
class IcmpPacket extends Packet {
  final IcmpType type;
  final int code;
  final int identifier;
  final int sequenceNumber;
  final String? data;

  IcmpPacket({
    required this.type,
    this.code = 0,
    this.identifier = 0,
    this.sequenceNumber = 0,
    this.data,
  });

  @override
  String get name => 'ICMP ${type.name}';

  @override
  String get description {
    switch (type) {
      case IcmpType.echoRequest:
        return 'Echo Request (Ping) seq=$sequenceNumber';
      case IcmpType.echoReply:
        return 'Echo Reply (Pong) seq=$sequenceNumber';
      case IcmpType.destinationUnreachable:
        return 'Destination Unreachable code=$code';
      case IcmpType.timeExceeded:
        return 'Time Exceeded (TTL=0)';
    }
  }

  @override
  int get sizeBytes => 8 + (data?.length ?? 0);

  @override
  Packet copy() => IcmpPacket(
    type: type,
    code: code,
    identifier: identifier,
    sequenceNumber: sequenceNumber,
    data: data,
  );
}

/// ICMP Ping 工具类
class IcmpPinger {
  final IpDevice device;
  
  int _sequenceCounter = 0;
  final int _identifier;
  
  // 待处理的 Echo Request: seq -> (sendTime, Completer)
  final Map<int, DateTime> _pendingRequests = {};
  
  // Ping 结果回调
  void Function(PingResult result)? onResult;

  IcmpPinger(this.device) : _identifier = device.hashCode % 65536;

  /// 发送 Ping
  void ping(IpAddress target) {
    final seq = ++_sequenceCounter;
    
    final icmpRequest = IcmpPacket(
      type: IcmpType.echoRequest,
      identifier: _identifier,
      sequenceNumber: seq,
      data: 'PING',
    );
    
    final ipPacket = IpPacket(
      sourceIp: device.interfaces.values.first.ipAddress!,
      destinationIp: target,
      protocol: IpProtocol.icmp,
      payload: icmpRequest,
    );
    
    _pendingRequests[seq] = DateTime.now();
    
    debugPrint('[${device.name}] Sending ICMP Echo Request to $target (seq=$seq)');
    device.sendIpPacket(ipPacket);
  }

  /// 处理收到的 ICMP 包 (由设备调用)
  void handleIcmpPacket(IpPacket ipPacket, IcmpPacket icmp) {
    switch (icmp.type) {
      case IcmpType.echoRequest:
        // 收到 Ping 请求，发送回复
        _handleEchoRequest(ipPacket, icmp);
        break;
      case IcmpType.echoReply:
        // 收到 Ping 回复
        _handleEchoReply(ipPacket, icmp);
        break;
      case IcmpType.destinationUnreachable:
        _handleUnreachable(ipPacket, icmp);
        break;
      case IcmpType.timeExceeded:
        _handleTimeExceeded(ipPacket, icmp);
        break;
    }
  }

  void _handleEchoRequest(IpPacket ipPacket, IcmpPacket request) {
    debugPrint('[${device.name}] Received Echo Request from ${ipPacket.sourceIp}');
    
    // 构造 Echo Reply
    final reply = IcmpPacket(
      type: IcmpType.echoReply,
      identifier: request.identifier,
      sequenceNumber: request.sequenceNumber,
      data: request.data,
    );
    
    final replyPacket = IpPacket(
      sourceIp: device.interfaces.values.first.ipAddress!,
      destinationIp: ipPacket.sourceIp,
      protocol: IpProtocol.icmp,
      payload: reply,
    );
    
    debugPrint('[${device.name}] Sending Echo Reply to ${ipPacket.sourceIp}');
    device.sendIpPacket(replyPacket);
  }

  void _handleEchoReply(IpPacket ipPacket, IcmpPacket reply) {
    final seq = reply.sequenceNumber;
    
    if (_pendingRequests.containsKey(seq) && reply.identifier == _identifier) {
      final sendTime = _pendingRequests.remove(seq)!;
      final rtt = DateTime.now().difference(sendTime);
      
      debugPrint('[${device.name}] Reply from ${ipPacket.sourceIp}: seq=$seq time=${rtt.inMilliseconds}ms');
      
      onResult?.call(PingResult(
        success: true,
        source: ipPacket.sourceIp,
        sequenceNumber: seq,
        rtt: rtt,
      ));
    }
  }

  void _handleUnreachable(IpPacket ipPacket, IcmpPacket icmp) {
    debugPrint('[${device.name}] Destination Unreachable from ${ipPacket.sourceIp}');
    onResult?.call(PingResult(
      success: false,
      source: ipPacket.sourceIp,
      sequenceNumber: 0,
      error: 'Destination Unreachable',
    ));
  }

  void _handleTimeExceeded(IpPacket ipPacket, IcmpPacket icmp) {
    debugPrint('[${device.name}] Time Exceeded from ${ipPacket.sourceIp}');
    onResult?.call(PingResult(
      success: false,
      source: ipPacket.sourceIp,
      sequenceNumber: 0,
      error: 'TTL Exceeded',
    ));
  }
}

/// Ping 结果
class PingResult {
  final bool success;
  final IpAddress source;
  final int sequenceNumber;
  final Duration? rtt;
  final String? error;

  PingResult({
    required this.success,
    required this.source,
    required this.sequenceNumber,
    this.rtt,
    this.error,
  });

  @override
  String toString() {
    if (success) {
      return 'Reply from $source: seq=$sequenceNumber time=${rtt?.inMilliseconds}ms';
    } else {
      return 'Failed: $error from $source';
    }
  }
}
