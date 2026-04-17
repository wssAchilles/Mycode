
import 'package:flutter/foundation.dart';
import 'base_models.dart';
import 'ip_protocols.dart';
import 'device_implementations.dart';
import 'dns_protocol.dart'; // For UdpDatagram

/// DHCP 消息类型
enum DhcpMessageType {
  discover, // Client -> Server (Broadcast)
  offer,    // Server -> Client
  request,  // Client -> Server
  ack,      // Server -> Client
  nak,      // Server -> Client
}

/// DHCP 选项 Keys
class DhcpOptions {
  static const int subnetMask = 1;
  static const int router = 3;
  static const int dnsServer = 6;
}

/// DHCP 报文
class DhcpPacket extends Packet {
  final DhcpMessageType type;
  final int transactionId;
  final MacAddress clientMac;
  final IpAddress? yourIp; // IP assigned by server (yiaddr)
  final IpAddress? serverIp; // (siaddr)
  final Map<int, String> options;

  DhcpPacket({
    required this.type,
    required this.transactionId,
    required this.clientMac,
    this.yourIp,
    this.serverIp,
    this.options = const {},
  });

  @override
  String get name => 'DHCP ${type.name.toUpperCase()}';

  @override
  String get description => 'Type: ${type.name}, XID: $transactionId, Client: $clientMac, IP: ${yourIp ?? "0.0.0.0"}';

  @override
  int get sizeBytes => 240; 

  @override
  Packet copy() => DhcpPacket(
    type: type,
    transactionId: transactionId,
    clientMac: clientMac,
    yourIp: yourIp,
    serverIp: serverIp,
    options: Map.from(options),
  );
}

// ==========================================
// DHCP Server Logic
// ==========================================

class DhcpServer {
  final IpDevice device;
  final IpAddress startIp;
  final IpAddress endIp;
  final IpAddress netmask;
  final IpAddress gateway;
  final IpAddress dns;
  
  // IP 租约表: IP -> MacAddress
  final Map<IpAddress, MacAddress> _leases = {};
  
  DhcpServer({
    required this.device,
    required this.startIp,
    required this.endIp,
    required this.netmask,
    required this.gateway,
    required this.dns,
  });

  void handleDhcpMessage(IpPacket ipPacket, UdpDatagram udp, DhcpPacket dhcp) {
    debugPrint('[DHCP Server] Received ${dhcp.type} from ${dhcp.clientMac} (XID: ${dhcp.transactionId})');
    
    switch (dhcp.type) {
      case DhcpMessageType.discover:
        _handleDiscover(dhcp, ipPacket);
        break;
      case DhcpMessageType.request:
        _handleRequest(dhcp, ipPacket);
        break;
      default:
        break;
    }
  }

  void _handleDiscover(DhcpPacket dhcp, IpPacket originalPacket) {
    // 1. 分配 IP
    final ip = _allocateIp(dhcp.clientMac);
    if (ip == null) {
      debugPrint('[DHCP Server] No IPs available');
      return;
    }
    
    // 2. 发送 Offer
    final offer = DhcpPacket(
      type: DhcpMessageType.offer,
      transactionId: dhcp.transactionId,
      clientMac: dhcp.clientMac,
      yourIp: ip,
      serverIp: device.interfaces.values.first.ipAddress,
      options: {
        DhcpOptions.subnetMask: netmask.value,
        DhcpOptions.router: gateway.value,
        DhcpOptions.dnsServer: dns.value,
      },
    );
    
    // Server 发送 Offer 通常是单播 (如果知道 Client L2) 或广播
    // 在模拟中，因为 Client 还没有 IP，我们发送到广播 IP (255.255.255.255) 并依靠 L2 Mac 投递?
    // 或者直接回复给 origin source ip如果是非 0.0.0.0?
    // DHCP Discover Source IP 是 0.0.0.0.
    // 所以我们需要发送到 Broadcast IP.
    
    _sendReply(offer);
  }

  void _handleRequest(DhcpPacket dhcp, IpPacket originalPacket) {
    final requestedIp = dhcp.yourIp;
    if (requestedIp == null) return;
    
    // 确认分配 (简单逻辑: 信任 Request)
    _leases[requestedIp] = dhcp.clientMac;
    
    debugPrint('[DHCP Server] Assigned $requestedIp to ${dhcp.clientMac}');
    
    final ack = DhcpPacket(
      type: DhcpMessageType.ack,
      transactionId: dhcp.transactionId,
      clientMac: dhcp.clientMac,
      yourIp: requestedIp,
      serverIp: device.interfaces.values.first.ipAddress,
      options: {
        DhcpOptions.subnetMask: netmask.value,
        DhcpOptions.router: gateway.value,
        DhcpOptions.dnsServer: dns.value,
      },
    );
    
    _sendReply(ack);
  }

  IpAddress? _allocateIp(MacAddress clientMac) {
    // 检查是否已有租约
    for (var entry in _leases.entries) {
      if (entry.value == clientMac) return entry.key;
    }
    
    // 简单的线性分配
    final parts = startIp.value.split('.').map(int.parse).toList();
    final endParts = endIp.value.split('.').map(int.parse).toList();
    
    int current = parts[3];
    int max = endParts[3];
    
    for (int i = current; i <= max; i++) {
       final ipStr = '${parts[0]}.${parts[1]}.${parts[2]}.$i';
       final ip = IpAddress(ipStr);
       // 检查是否被占用
       bool occupied = false;
       for (var k in _leases.keys) {
         if (k == ip) occupied = true;
       }
       
       if (!occupied) {
         return ip;
       }
    }
    return null;
  }
  
  void _sendReply(DhcpPacket payload) {
    final udp = UdpDatagram(
      sourcePort: 67,
      destinationPort: 68,
      payload: payload,
    );
    
    // DHCP Server 回复通常是广播，因为 Client 还没有配置 IP
    final ipPacket = IpPacket(
      sourceIp: device.interfaces.values.first.ipAddress!,
      destinationIp: IpAddress('255.255.255.255'),
      protocol: IpProtocol.udp,
      payload: udp,
    );
    
    device.sendIpPacket(ipPacket);
  }
}

// ==========================================
// DHCP Client Logic
// ==========================================

enum DhcpClientState {
  init,
  selecting,
  requesting,
  bound,
}

class DhcpClient {
  final IpDevice device;
  DhcpClientState state = DhcpClientState.init;
  int _transactionId = 0;
  
  DhcpClient(this.device);
  
  void start() {
    debugPrint('[DHCP Client] Starting Discovery...');
    state = DhcpClientState.selecting;
    _sendDiscover();
  }
  
  void handleDhcpMessage(IpPacket ipPacket, UdpDatagram udp, DhcpPacket dhcp) {
    if (dhcp.transactionId != _transactionId) return;
    
    debugPrint('[DHCP Client] Received ${dhcp.type} in state $state');
    
    switch (state) {
      case DhcpClientState.selecting:
        if (dhcp.type == DhcpMessageType.offer) {
          _handleOffer(dhcp);
        }
        break;
      case DhcpClientState.requesting:
        if (dhcp.type == DhcpMessageType.ack) {
          _handleAck(dhcp);
        }
        break;
      default:
        break;
    }
  }
  
  void _sendDiscover() {
    _transactionId = DateTime.now().millisecondsSinceEpoch % 10000;
    
    final discover = DhcpPacket(
      type: DhcpMessageType.discover,
      transactionId: _transactionId,
      clientMac: device.interfaces.values.first.macAddress,
    );
    
    _broadcast(discover);
  }
  
  void _handleOffer(DhcpPacket offer) {
    debugPrint('[DHCP Client] Received Offer: ${offer.yourIp} from ${offer.serverIp}');
    
    // 发送 Request
    state = DhcpClientState.requesting;
    
    final request = DhcpPacket(
      type: DhcpMessageType.request,
      transactionId: _transactionId,
      clientMac: device.interfaces.values.first.macAddress,
      yourIp: offer.yourIp, // Requesting this IP
      serverIp: offer.serverIp,
    );
    
    _broadcast(request);
  }
  
  void _handleAck(DhcpPacket ack) {
    debugPrint('[DHCP Client] Received ACK! Bound to ${ack.yourIp}');
    state = DhcpClientState.bound;
    
    // 配置 IP
    // 假设第一个接口
    final iface = device.interfaces.values.first;
    iface.ipAddress = ack.yourIp;
    
    // 配置网关/路由
    if (ack.options.containsKey(DhcpOptions.router)) {
      final gateway = IpAddress(ack.options[DhcpOptions.router]!);
      device.routingTable.add(RoutingEntry(
        destination: IpAddress('0.0.0.0'),
        netmask: '0.0.0.0',
        nextHop: gateway,
        interfaceName: iface.name,
      ));
      debugPrint('[DHCP Client] Configured Default Gateway: $gateway');
    }
    
    // 配置 DNS (暂存到 Host?)
    // if (ack.options.containsKey(DhcpOptions.dnsServer)) ...
  }
  
  void _broadcast(DhcpPacket payload) {
    final udp = UdpDatagram(
      sourcePort: 68,
      destinationPort: 67,
      payload: payload,
    );
    
    final ipPacket = IpPacket(
      sourceIp: IpAddress('0.0.0.0'),
      destinationIp: IpAddress('255.255.255.255'), 
      protocol: IpProtocol.udp,
      payload: udp,
    );
    
    device.sendIpPacket(ipPacket);
  }
}
