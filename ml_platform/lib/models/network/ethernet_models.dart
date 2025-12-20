
import 'base_models.dart';

// ==========================================
// 以太网 (Ethernet)
// ==========================================

/// 以太类型
class EtherType {
  static const int ipv4 = 0x0800;
  static const int arp = 0x0806;
  static const int ipv6 = 0x86DD;
}

/// 以太网帧
class EthernetFrame extends Packet {
  final MacAddress destination;
  final MacAddress source;
  final int etherType;
  final Packet payload;
  final int? fcs; // Frame Check Sequence (模拟用，可选)

  EthernetFrame({
    required this.destination,
    required this.source,
    required this.etherType,
    required this.payload,
    this.fcs,
  });

  @override
  String get name => 'Ethernet Frame';

  @override
  String get description => 'To: $destination, From: $source, Type: 0x${etherType.toRadixString(16)}';

  @override
  int get sizeBytes => 14 + payload.sizeBytes + 4; // Header 14 + Payload + FCS 4

  @override
  Packet copy() {
    return EthernetFrame(
      destination: destination, // MacAddress is immutable
      source: source,
      etherType: etherType,
      payload: payload.copy(),
      fcs: fcs,
    );
  }
}

// ==========================================
// ARP (Address Resolution Protocol)
// ==========================================

class ArpOpcode {
  static const int request = 1;
  static const int reply = 2;
}

/// ARP 数据包
class ArpPacket extends Packet {
  final int hardwareType; // 1 = Ethernet
  final int protocolType; // 0x0800 = IPv4
  final int operation; // 1 = Request, 2 = Reply
  
  final MacAddress senderMac;
  final IpAddress senderIp;
  
  final MacAddress targetMac; // Request时为0
  final IpAddress targetIp;

  ArpPacket({
    this.hardwareType = 1,
    this.protocolType = 0x0800,
    required this.operation,
    required this.senderMac,
    required this.senderIp,
    required this.targetMac,
    required this.targetIp,
  });

  bool get isRequest => operation == ArpOpcode.request;
  bool get isReply => operation == ArpOpcode.reply;

  @override
  String get name => 'ARP ${isRequest ? "Request" : "Reply"}';

  @override
  String get description {
    if (isRequest) {
      return 'Who has $targetIp? Tell $senderIp';
    } else {
      return '$senderIp is at $senderMac';
    }
  }

  @override
  int get sizeBytes => 28; // Standard ARP size

  @override
  Packet copy() {
    return ArpPacket(
      hardwareType: hardwareType,
      protocolType: protocolType,
      operation: operation,
      senderMac: senderMac,
      senderIp: senderIp,
      targetMac: targetMac,
      targetIp: targetIp,
    );
  }
}
