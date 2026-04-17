
import 'dart:collection';
import 'package:flutter/foundation.dart';
import '../../services/network/network_simulator.dart';
import 'base_models.dart';
import 'ethernet_models.dart';
import 'ip_protocols.dart';
import 'tcp_stack.dart';
import 'dns_protocol.dart';
import 'icmp_protocol.dart';
import 'dhcp_protocol.dart';

// NAT Record
class NatEntry {
  final IpAddress internalIp;
  final int internalPort;
  final IpAddress externalIp;
  final int externalPort;
  final DateTime lastUsed;
  
  NatEntry(this.internalIp, this.internalPort, this.externalIp, this.externalPort) 
    : lastUsed = DateTime.now();
    
  bool matchesExternal(IpAddress ip, int port) => externalIp == ip && externalPort == port;
  bool matchesInternal(IpAddress ip, int port) => internalIp == ip && internalPort == port;
}

// Firewall Rule (ACL)
enum FirewallAction { accept, drop, reject }

class FirewallRule {
  final IpAddress? srcIp;
  final IpAddress? dstIp;
  final int? srcPort;
  final int? dstPort;
  final int? protocol;
  final FirewallAction action;

  FirewallRule({
    this.srcIp,
    this.dstIp,
    this.srcPort,
    this.dstPort,
    this.protocol,
    this.action = FirewallAction.drop,
  });

  bool matches(IpPacket packet, {int? srcP, int? dstP}) {
    if (protocol != null && packet.protocol != protocol) return false;
    if (srcIp != null && packet.sourceIp != srcIp) return false;
    if (dstIp != null && packet.destinationIp != dstIp) return false;
    
    if (srcPort != null && srcP != null && srcP != srcPort) return false;
    if (dstPort != null && dstP != null && dstP != dstPort) return false;
    
    return true;
  }
}

// ==========================================
// 基础 IP 设备 (Host & Router share this)
// ==========================================

abstract class IpDevice extends NetworkDevice {
  // ARP 缓存表: IP -> MAC
  final Map<IpAddress, MacAddress> arpTable = {};
  
  // 路由表
  final List<RoutingEntry> routingTable = [];
  
  // 待发送缓冲队列: 等待 ARP 解析的包
  // Target IP -> List of pending IpPackets
  final Map<IpAddress, List<PendingPacket>> _arpPendingQueue = {};
  
  // TCP/IP 协议栈
  late final TcpStack tcpStack;

  IpDevice({
    required String name,
    String? id,
    double x = 0,
    double y = 0,
  }) : super(name: name, id: id, x: x, y: y) {
    tcpStack = TcpStack(this);
  }

  /// 重写添加接口方法，自动创建直连路由
  @override
  void addInterface(NetworkInterface iface) {
    super.addInterface(iface);
    
    // 如果接口有 IP 地址，自动添加直连路由
    if (iface.ipAddress != null) {
      _addDirectRoute(iface);
    }
  }

  /// 为接口添加直连路由
  void _addDirectRoute(NetworkInterface iface) {
    if (iface.ipAddress == null) return;
    
    // 计算网络地址 (假设 /24 子网)
    final parts = iface.ipAddress!.value.split('.');
    if (parts.length != 4) return;
    
    final networkAddr = IpAddress('${parts[0]}.${parts[1]}.${parts[2]}.0');
    
    // 检查是否已存在相同路由
    final exists = routingTable.any((r) => 
      r.destination == networkAddr && r.interfaceName == iface.name);
    
    if (!exists) {
      routingTable.add(RoutingEntry(
        destination: networkAddr,
        netmask: '255.255.255.0',
        interfaceName: iface.name,
      ));
      debugPrint('[$name] Auto-added direct route: $networkAddr/24 via ${iface.name}');
    }
  }

  /// 接收数据包入口
  @override
  void receivePacket(Packet packet, NetworkInterface inInterface) {
    if (packet is EthernetFrame) {
      _processEthernetFrame(packet, inInterface);
    } else {
      debugPrint("[$name] Dropped unknown packet type: ${packet.runtimeType}");
    }
  }

  void _processEthernetFrame(EthernetFrame frame, NetworkInterface inInterface) {
    // 1. 检查 MAC 地址是否匹配 (或广播)
    if (frame.destination != inInterface.macAddress && 
        frame.destination != MacAddress.broadcast) {
      // 混杂模式可接收，否则丢弃
      return; 
    }

    // 2. 根据 EtherType 分发
    if (frame.etherType == EtherType.ipv4) {
      if (frame.payload is IpPacket) {
        _processIpPacket(frame.payload as IpPacket, inInterface);
      }
    } else if (frame.etherType == EtherType.arp) {
      if (frame.payload is ArpPacket) {
        _processArpPacket(frame.payload as ArpPacket, inInterface);
      }
    }
  }

  void _processArpPacket(ArpPacket arp, NetworkInterface inInterface) {
    // 学习发送者的 MAC (通用行为)
    arpTable[arp.senderIp] = arp.senderMac;
    
    // 检查是否有挂起的包在等待这个 IP
    _flushPendingPackets(arp.senderIp);

    if (arp.isRequest) {
      // 如果是在问我
      if (arp.targetIp == inInterface.ipAddress) {
        // 回复 ARP Reply
        final reply = ArpPacket(
          operation: ArpOpcode.reply,
          senderMac: inInterface.macAddress,
          senderIp: inInterface.ipAddress!,
          targetMac: arp.senderMac,
          targetIp: arp.senderIp,
        );
        
        final frame = EthernetFrame(
          destination: arp.senderMac,
          source: inInterface.macAddress,
          etherType: EtherType.arp,
          payload: reply,
        );
        
        NetworkSimulator().sendPacket(frame, inInterface);
      }
    }
  }
  
  void _processIpPacket(IpPacket packet, NetworkInterface inInterface) {
     // 查找是否是给自己的
     bool isForMe = false;
     for (var iface in interfaces.values) {
       if (iface.ipAddress == packet.destinationIp || 
           packet.destinationIp.value == '255.255.255.255') {
         isForMe = true;
         break;
       }
     }
     
     if (isForMe) {
       onReceiveIpPacket(packet);
     } else {
       // 需要转发?
       forwardIpPacket(packet, inInterface);
     }
  }
  
  /// 上层处理 IP 包 (由子类 Host 实现具体逻辑)
  void onReceiveIpPacket(IpPacket packet);

  /// 转发 IP 包 (由 Router 实现)
  void forwardIpPacket(IpPacket packet, NetworkInterface? incomingInterface);

  // ==========================================
  // 发送逻辑 (Sending Logic)
  // ==========================================

  /// 发送 IP 包 (核心入口)
  void sendIpPacket(IpPacket packet) {
    // 1. 路由查找 next hop
    RoutingEntry? route = _findRoute(packet.destinationIp);
    
    // Special handling for Limited Broadcast (255.255.255.255)
    if (route == null && packet.destinationIp.value == '255.255.255.255') {
       // Broadcast on all interfaces (or just the first one for simplicity in this model)
       if (interfaces.isNotEmpty) {
         final iface = interfaces.values.first;
         _sendOrQueuePacket(packet, iface, packet.destinationIp);
         return;
       }
    }

    if (route == null) {
      debugPrint("[$name] No route to host: ${packet.destinationIp}");
      return; // ICMP Destination Unreachable
    }
    
    final outInterface = interfaces[route.interfaceName];
    if (outInterface == null) {
      debugPrint("[$name] Interface ${route.interfaceName} not found");
      return;
    }

    // 2. 确定下一跳 IP
    // 如果是直连路由, nextHop 就是 目的IP
    // 如果是网关路由, nextHop 就是 route.nextHop
    final nextHopIp = route.nextHop ?? packet.destinationIp;
    
    // 3. ARP 封装
    _sendOrQueuePacket(packet, outInterface, nextHopIp);
  }
  

  void _sendOrQueuePacket(IpPacket packet, NetworkInterface outInterface, IpAddress nextHopIp) {
    // Special case for Broadcast IP -> Broadcast MAC
    if (nextHopIp.value == '255.255.255.255') {
       final frame = EthernetFrame(
        destination: MacAddress.broadcast,
        source: outInterface.macAddress,
        etherType: EtherType.ipv4,
        payload: packet,
      );
      NetworkSimulator().sendPacket(frame, outInterface);
      return;
    }

    if (arpTable.containsKey(nextHopIp)) {
      // ARP 命中，直接发送
      final destMac = arpTable[nextHopIp]!;
      final frame = EthernetFrame(
        destination: destMac,
        source: outInterface.macAddress,
        etherType: EtherType.ipv4,
        payload: packet,
      );
      NetworkSimulator().sendPacket(frame, outInterface);
    } else {
      // ARP 未命中，挂起并发送 ARP Request
      if (!_arpPendingQueue.containsKey(nextHopIp)) {
        _arpPendingQueue[nextHopIp] = [];
        _sendArpRequest(nextHopIp, outInterface);
      }
      _arpPendingQueue[nextHopIp]!.add(PendingPacket(packet, outInterface));
    }
  }
  
  void _sendArpRequest(IpAddress targetIp, NetworkInterface outInterface) {
    final arpReq = ArpPacket(
      operation: ArpOpcode.request,
      senderMac: outInterface.macAddress,
      senderIp: outInterface.ipAddress!, // 假设接口有IP
      targetMac: MacAddress('00:00:00:00:00:00'), // Ignored in request
      targetIp: targetIp
    );
    
    final frame = EthernetFrame(
      destination: MacAddress.broadcast,
      source: outInterface.macAddress,
      etherType: EtherType.arp,
      payload: arpReq,
    );
    
    NetworkSimulator().sendPacket(frame, outInterface);
  }
  
  void _flushPendingPackets(IpAddress ip) {
    if (_arpPendingQueue.containsKey(ip)) {
      final destMac = arpTable[ip]!;
      final pendingList = _arpPendingQueue.remove(ip)!;
      
      for (var pp in pendingList) {
        final frame = EthernetFrame(
          destination: destMac,
          source: pp.outInterface.macAddress,
          etherType: EtherType.ipv4,
          payload: pp.packet, // 原包
        );
        NetworkSimulator().sendPacket(frame, pp.outInterface);
      }
    }
  }

  RoutingEntry? _findRoute(IpAddress destIp) {
    // 最长前缀匹配
    RoutingEntry? bestMatch;
    int maxPrefixLen = -1;
    
    for (var entry in routingTable) {
      if (entry.matches(destIp)) {
        if (entry.prefixLength > maxPrefixLen) {
          maxPrefixLen = entry.prefixLength;
          bestMatch = entry;
        }
      }
    }
    return bestMatch;
  }
  
  @override
  void onTick(double currentTime) {
    // 这里可以处理 ARP 缓存过期
  }
}

class PendingPacket {
  final IpPacket packet;
  final NetworkInterface outInterface;
  PendingPacket(this.packet, this.outInterface);
}

// ==========================================
// 具体设备: 主机 (Host)
// ==========================================

class Host extends IpDevice {
  // DNS 服务 (可选, 作为服务器)
  DnsServer? dnsServer;
  
  // DNS 解析器 (可选, 作为客户端)
  DnsResolver? dnsResolver;
  
  // DHCP (可选)
  DhcpClient? dhcpClient;
  DhcpServer? dhcpServer;
  
  // ICMP Ping 工具
  late final IcmpPinger icmpPinger;
  
  Host({
    required String name,
    String? id,
    double x = 0, double y = 0
  }) : super(name: name, id: id, x: x, y: y) {
    icmpPinger = IcmpPinger(this);
  }

  @override
  void onReceiveIpPacket(IpPacket packet) {
    // 收到发给自己的包
    debugPrint("[$name] Received IP packet from ${packet.sourceIp}: ${packet.description}");
    
    if (packet.protocol == IpProtocol.icmp) {
       // 处理 ICMP (Ping)
       if (packet.payload is IcmpPacket) {
           icmpPinger.handleIcmpPacket(packet, packet.payload as IcmpPacket);
       }
    } else if (packet.protocol == IpProtocol.tcp) {
       // 传递给 TCP 协议栈处理
       tcpStack.handleIncomingIpPacket(packet);
    } else if (packet.protocol == IpProtocol.udp) {
       // 处理 UDP 数据报 (DNS 等)
       if (packet.payload is UdpDatagram) {
           final datagram = packet.payload as UdpDatagram;
           
           // 如果是 DNS 端口 (53), 交给 DNS 服务器处理
           if (datagram.destinationPort == 53 && dnsServer != null) {
               dnsServer!.handleDnsQuery(packet, datagram);
           }
           // 如果是 DNS 响应 (源端口 53), 交给 DNS 解析器处理
           else if (datagram.sourcePort == 53 && dnsResolver != null) {
               final response = DnsMessage.deserialize(datagram.data);
               if (response != null) {
                   dnsResolver!.handleDnsResponse(response);
               }
           }
            // DHCP Server (Port 67)
            else if (datagram.destinationPort == 67 && dhcpServer != null) {
               if (datagram.payload is DhcpPacket) {
                 dhcpServer!.handleDhcpMessage(packet, datagram, datagram.payload as DhcpPacket);
               }
            }
            // DHCP Client (Port 68)
            else if (datagram.destinationPort == 68 && dhcpClient != null) {
               if (datagram.payload is DhcpPacket) {
                 dhcpClient!.handleDhcpMessage(packet, datagram, datagram.payload as DhcpPacket);
               }
            }
       }
    }
  }

  @override
  void forwardIpPacket(IpPacket packet, NetworkInterface? incomingInterface) {
    // Host 默认不转发，除非开启转发功能
    debugPrint("[$name] Dropped packet not for me (Forwarding disabled)");
  }
}

// ==========================================
// 具体设备: 路由器 (Router)
// ==========================================

class Router extends IpDevice {
  // NAT 状态
  bool enableNat = false;
  NetworkInterface? natExternalInterface; // 外网接口 (WAN)
  // PAT 表: External Port -> Entry
  final Map<int, NatEntry> _natTable = {};
  int _nextNatPort = 10000;
  
  // 防火墙 (Inbound/Outbound logic simplified to just "Forwarding Check")
  final List<FirewallRule> firewallRules = [];
  bool enableFirewall = false;
  FirewallAction defaultAction = FirewallAction.accept;

  Router({
    required String name,
    String? id,
    double x = 0, double y = 0
  }) : super(name: name, id: id, x: x, y: y);

  @override
  void onReceiveIpPacket(IpPacket packet) {
    // 路由器收到发给自己的包 (通常是管理流量或 ICMP Ping 接口)
    debugPrint("[$name] Packet for Router Interface: ${packet.description}");
  }

  @override
  void forwardIpPacket(IpPacket packet, NetworkInterface? incomingInterface) {
    // === Firewall Check ===
    if (enableFirewall) {
      // Extract ports if possible
      int? srcP, dstP;
      if (packet.payload is UdpDatagram) {
        srcP = (packet.payload as UdpDatagram).sourcePort;
        dstP = (packet.payload as UdpDatagram).destinationPort;
      }
      // TCP ports extracting? (Currently TCP payload is TcpSegment, but we cast to dynamic in _handleNat)
      // Actually TcpSegment has sourcePort/distinationPort in tcp_stack.dart? 
      // Packet.payload type is Packet. TcpSegment IS Packet.
      // Let's assume we can access them if we import tcp_stack.dart (which is imported).
      if (packet.payload is TcpSegment) {
         srcP = (packet.payload as TcpSegment).sourcePort;
         dstP = (packet.payload as TcpSegment).destinationPort;
      }
      
      FirewallAction action = defaultAction;
      for (var rule in firewallRules) {
        if (rule.matches(packet, srcP: srcP, dstP: dstP)) {
          action = rule.action;
          break; // First match wins
        }
      }
      
      if (action == FirewallAction.drop) {
        debugPrint('[Firewall] Dropped packet: ${packet.description}');
        return;
      } else if (action == FirewallAction.reject) {
        debugPrint('[Firewall] Rejected packet: ${packet.description}');
        // Send ICMP Unreachable?
        return;
      }
    }
  
    // 路由器核心逻辑: 转发
    if (packet.ttl <= 1) {
      debugPrint("[$name] Packet TTL expired: ${packet.description}");
      // Send ICMP Time Exceeded
      final icmp = IcmpPacket(
          type: IcmpType.timeExceeded,
          code: 0, // TTL expired in transit
          data: "TTL Expired: ${packet.description}", 
      );
      
      // 使用入口接口 IP 作为源 IP (如果存在), 否则使用第一个接口 IP
      final srcIp = incomingInterface?.ipAddress ?? interfaces.values.first.ipAddress!;
      
      final errorPacket = IpPacket(
          sourceIp: srcIp,
          destinationIp: packet.sourceIp,
          protocol: IpProtocol.icmp,
          payload: icmp,
      );
      
      sendIpPacket(errorPacket);
      return;
    }
    
    packet.ttl -= 1; // 修改了 TTL, 需要重新计算 Checksum (如果模拟的话)
    
    // 重新通过路由表发送
    // 注意: 这里并没有修改 packet 引用，而是基于原包内容继续发送
    // 在真实世界中这里会修改包头
    
    // === NAT Logic ===
    if (enableNat && natExternalInterface != null) {
       _handleNat(packet, incomingInterface);
       // sendIpPacket called inside _handleNat if creating new packet, 
       // OR we modify packet and call sendIpPacket.
    } else {
       sendIpPacket(packet);
    }
  }

  void _handleNat(IpPacket packet, NetworkInterface? incomingInterface) {
    // 简单判断: Lan -> Wan (SNAT), Wan -> Lan (DNAT)
    bool isLanToWan = incomingInterface != natExternalInterface;
    
    if (isLanToWan) {
      if (packet.protocol == IpProtocol.udp && packet.payload is UdpDatagram) {
         _performSnat(packet, packet.payload as UdpDatagram, natExternalInterface!);
      } else if (packet.protocol == IpProtocol.tcp && packet.payload is dynamic) { // TODO: TCP NAT
         // Simplified NAT for UDP only for now (DNS/DHCP usually don't traverse NAT in this sim?)
         // Ideally handle TCP
         // For now, if not handled, just forward.
         sendIpPacket(packet);
      } else {
         sendIpPacket(packet);
      }
    } else {
      // Wan -> Lan (DNAT)
      if (packet.protocol == IpProtocol.udp && packet.payload is UdpDatagram) {
         _performDnat(packet, packet.payload as UdpDatagram);
      } else {
         sendIpPacket(packet);
      }
    }
  }
  
  void _performSnat(IpPacket packet, UdpDatagram udp, NetworkInterface wanIface) {
    // 查找现有的 NAT 条目
    NatEntry? entry;
    // Search internal match
    for (var e in _natTable.values) {
       if (e.matchesInternal(packet.sourceIp, udp.sourcePort)) {
         entry = e;
         break;
       }
    }
    
    if (entry == null) {
      // 新建映射
      int extPort = _nextNatPort++;
      entry = NatEntry(
        packet.sourceIp, 
        udp.sourcePort, 
        wanIface.ipAddress!, 
        extPort
      );
      _natTable[extPort] = entry;
      // Also map reverse?
    }
    
    debugPrint('[NAT] SNAT: ${packet.sourceIp}:${udp.sourcePort} -> ${entry.externalIp}:${entry.externalPort}');
    
    // 创建新包 (修改源 IP/Port)
    final newUdp = UdpDatagram(
      sourcePort: entry.externalPort,
      destinationPort: udp.destinationPort,
      data: udp.data,
      payload: udp.payload
    );
    
    final newIp = IpPacket(
      sourceIp: entry.externalIp,
      destinationIp: packet.destinationIp,
      protocol: packet.protocol,
      ttl: packet.ttl,
      payload: newUdp
    );
    
    sendIpPacket(newIp);
  }
  
  void _performDnat(IpPacket packet, UdpDatagram udp) {
    // 目的端口必须在 NAT 表中
    final entry = _natTable[udp.destinationPort];
    if (entry == null) {
      debugPrint('[NAT] DNAT failed: No entry for port ${udp.destinationPort}');
      // Drop or Send
      sendIpPacket(packet);
      return;
    }
    
    debugPrint('[NAT] DNAT: ${packet.destinationIp}:${udp.destinationPort} -> ${entry.internalIp}:${entry.internalPort}');
    
    // 创建新包 (修改目的 IP/Port)
    final newUdp = UdpDatagram(
      sourcePort: udp.sourcePort,
      destinationPort: entry.internalPort,
      data: udp.data,
      payload: udp.payload
    );
    
    final newIp = IpPacket(
      sourceIp: packet.sourceIp,
      destinationIp: entry.internalIp,
      protocol: packet.protocol,
      ttl: packet.ttl,
      payload: newUdp
    );
    
    sendIpPacket(newIp);
  }
}
