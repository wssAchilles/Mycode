import '../../models/network/ip_models.dart';

/// IP路由服务
class IpRoutingService {
  /// 创建默认网络拓扑
  static Map<String, dynamic> createDefaultTopology() {
    // 创建节点
    final hostA = NetworkNode(
      id: 'host_a',
      name: 'Host A',
      type: NetworkNodeType.host,
      ipAddress: '192.168.1.10',
      x: 100,
      y: 250,
    );

    final hostB = NetworkNode(
      id: 'host_b',
      name: 'Host B',
      type: NetworkNodeType.host,
      ipAddress: '192.168.3.20',
      x: 700,
      y: 250,
    );

    // 创建路由器R1
    final r1RoutingTable = RoutingTable(nodeName: 'R1');
    r1RoutingTable.addEntry(RoutingEntry(
      destination: '192.168.1.0',
      netmask: '255.255.255.0',
      nextHop: 'Direct',
      interface: 'eth0',
    ));
    r1RoutingTable.addEntry(RoutingEntry(
      destination: '192.168.2.0',
      netmask: '255.255.255.0',
      nextHop: '192.168.2.2',
      interface: 'eth1',
    ));
    r1RoutingTable.addEntry(RoutingEntry(
      destination: '192.168.3.0',
      netmask: '255.255.255.0',
      nextHop: '192.168.2.2',
      interface: 'eth1',
    ));
    r1RoutingTable.addEntry(RoutingEntry(
      destination: '0.0.0.0',
      netmask: '0.0.0.0',
      nextHop: '192.168.2.2',
      interface: 'eth1',
      isDefault: true,
    ));

    final router1 = NetworkNode(
      id: 'router_1',
      name: 'Router R1',
      type: NetworkNodeType.router,
      ipAddress: '192.168.1.1',
      routingTable: r1RoutingTable,
      interfaces: {
        'eth0': '192.168.1.1',
        'eth1': '192.168.2.1',
      },
      x: 250,
      y: 250,
    );

    // 创建路由器R2
    final r2RoutingTable = RoutingTable(nodeName: 'R2');
    r2RoutingTable.addEntry(RoutingEntry(
      destination: '192.168.2.0',
      netmask: '255.255.255.0',
      nextHop: 'Direct',
      interface: 'eth0',
    ));
    r2RoutingTable.addEntry(RoutingEntry(
      destination: '192.168.4.0',
      netmask: '255.255.255.0',
      nextHop: 'Direct',
      interface: 'eth1',
    ));
    r2RoutingTable.addEntry(RoutingEntry(
      destination: '192.168.1.0',
      netmask: '255.255.255.0',
      nextHop: '192.168.2.1',
      interface: 'eth0',
    ));
    r2RoutingTable.addEntry(RoutingEntry(
      destination: '192.168.3.0',
      netmask: '255.255.255.0',
      nextHop: '192.168.4.2',
      interface: 'eth1',
    ));
    r2RoutingTable.addEntry(RoutingEntry(
      destination: '0.0.0.0',
      netmask: '0.0.0.0',
      nextHop: '192.168.4.2',
      interface: 'eth1',
      isDefault: true,
    ));

    final router2 = NetworkNode(
      id: 'router_2',
      name: 'Router R2',
      type: NetworkNodeType.router,
      ipAddress: '192.168.2.2',
      routingTable: r2RoutingTable,
      interfaces: {
        'eth0': '192.168.2.2',
        'eth1': '192.168.4.1',
      },
      x: 400,
      y: 250,
    );

    // 创建路由器R3
    final r3RoutingTable = RoutingTable(nodeName: 'R3');
    r3RoutingTable.addEntry(RoutingEntry(
      destination: '192.168.4.0',
      netmask: '255.255.255.0',
      nextHop: 'Direct',
      interface: 'eth0',
    ));
    r3RoutingTable.addEntry(RoutingEntry(
      destination: '192.168.3.0',
      netmask: '255.255.255.0',
      nextHop: 'Direct',
      interface: 'eth1',
    ));
    r3RoutingTable.addEntry(RoutingEntry(
      destination: '192.168.1.0',
      netmask: '255.255.255.0',
      nextHop: '192.168.4.1',
      interface: 'eth0',
    ));
    r3RoutingTable.addEntry(RoutingEntry(
      destination: '192.168.2.0',
      netmask: '255.255.255.0',
      nextHop: '192.168.4.1',
      interface: 'eth0',
    ));
    r3RoutingTable.addEntry(RoutingEntry(
      destination: '0.0.0.0',
      netmask: '0.0.0.0',
      nextHop: '192.168.4.1',
      interface: 'eth0',
      isDefault: true,
    ));

    final router3 = NetworkNode(
      id: 'router_3',
      name: 'Router R3',
      type: NetworkNodeType.router,
      ipAddress: '192.168.4.2',
      routingTable: r3RoutingTable,
      interfaces: {
        'eth0': '192.168.4.2',
        'eth1': '192.168.3.1',
      },
      x: 550,
      y: 250,
    );

    // 创建网络连接
    final links = [
      NetworkLink(
        id: 'link_1',
        node1Id: 'host_a',
        node2Id: 'router_1',
        bandwidth: 100,
        delay: 5,
      ),
      NetworkLink(
        id: 'link_2',
        node1Id: 'router_1',
        node2Id: 'router_2',
        bandwidth: 1000,
        delay: 10,
      ),
      NetworkLink(
        id: 'link_3',
        node1Id: 'router_2',
        node2Id: 'router_3',
        bandwidth: 1000,
        delay: 10,
      ),
      NetworkLink(
        id: 'link_4',
        node1Id: 'router_3',
        node2Id: 'host_b',
        bandwidth: 100,
        delay: 5,
      ),
    ];

    return {
      'nodes': {
        'host_a': hostA,
        'host_b': hostB,
        'router_1': router1,
        'router_2': router2,
        'router_3': router3,
      },
      'links': links,
    };
  }

  /// 生成路由事件序列
  static List<RoutingEvent> generateRoutingEvents({
    required String sourceIp,
    required String destinationIp,
    required Map<String, NetworkNode> nodes,
    int initialTTL = 64,
  }) {
    List<RoutingEvent> events = [];
    
    // 创建数据包
    final packet = IpPacket(
      sourceIp: sourceIp,
      destinationIp: destinationIp,
      ttl: initialTTL,
      data: 'Hello, World!',
    );

    // 找到源主机
    NetworkNode? currentNode = nodes.values.firstWhere(
      (node) => node.ipAddress == sourceIp,
      orElse: () => nodes['host_a']!,
    );

    events.add(RoutingEvent(
      type: 'packet_created',
      nodeId: currentNode?.id ?? '',
      description: '创建IP数据包',
      packet: packet,
      delay: 1000,
    ));

    events.add(RoutingEvent(
      type: 'encapsulation',
      nodeId: currentNode?.id ?? '',
      description: '数据封装成IP数据包\nSource: $sourceIp\nDestination: $destinationIp\nTTL: ${packet.ttl}',
      packet: packet,
      delay: 800,
    ));

    // 开始路由
    bool reachedDestination = false;
    int hopCount = 0;
    NetworkNode? previousNode;

    while (!reachedDestination && packet.ttl > 0 && hopCount < 10) {
      hopCount++;
      
      // 如果当前节点是目标
      if (currentNode?.ipAddress == destinationIp) {
        events.add(RoutingEvent(
          type: 'packet_received',
          nodeId: currentNode?.id ?? '',
          description: '数据包到达目标主机',
          packet: packet,
          delay: 500,
        ));

        events.add(RoutingEvent(
          type: 'decapsulation',
          nodeId: currentNode?.id ?? '',
          description: '解封装IP数据包，提取数据: "${packet.data}"',
          packet: packet,
          delay: 800,
        ));

        reachedDestination = true;
        break;
      }

      // 如果是路由器，查找路由表
      if (currentNode?.isRouter == true) {
        String? nextNodeId = _findBestRoute(currentNode?.routingTable?.entries ?? [], destinationIp);
        
        if (nextNodeId == null) {
          events.add(RoutingEvent(
            type: 'no_route',
            nodeId: currentNode?.id ?? '',
            description: '❌ 未找到到 $destinationIp 的路由',
            packet: packet,
            delay: 500,
          ));

          // 发送ICMP目标不可达
          events.add(RoutingEvent(
            type: 'icmp_sent',
            nodeId: currentNode?.id ?? '',
            description: '发送ICMP目标不可达消息给源主机',
            delay: 500,
          ));
          break;
        }

        events.add(RoutingEvent(
          type: 'routing_lookup',
          nodeId: currentNode?.id ?? '',
          description: '查询路由表',
          packet: packet,
          routingEntry: RoutingEntry(
            destination: destinationIp,
            netmask: '255.255.255.0',
            nextHop: nextNodeId,
            interface: 'eth0',
          ),
          delay: 600,
        ));

        events.add(RoutingEvent(
          type: 'route_found',
          nodeId: currentNode?.id ?? '',
          description: '找到路由: $nextNodeId',
          packet: packet,
          routingEntry: RoutingEntry(
            destination: destinationIp,
            netmask: '255.255.255.0',
            nextHop: nextNodeId,
            interface: 'eth0',
          ),
          delay: 400,
        ));

        // 减少TTL
        if (!packet.decrementTTL()) {
          events.add(RoutingEvent(
            type: 'ttl_exceeded',
            nodeId: currentNode?.id ?? '',
            description: '⚠️ TTL已降至0，丢弃数据包',
            packet: packet,
            delay: 500,
          ));

          // 发送ICMP超时消息
          events.add(RoutingEvent(
            type: 'icmp_sent',
            nodeId: currentNode?.id ?? '',
            description: '发送ICMP时间超时消息给源主机',
            delay: 500,
          ));
          break;
        }

        events.add(RoutingEvent(
          type: 'ttl_decrement',
          nodeId: currentNode?.id ?? '',
          description: 'TTL减1，当前值: ${packet.ttl}',
          packet: packet,
          delay: 300,
        ));

        // 转发数据包
        NetworkNode? nextNode;
        try {
          nextNode = nodes.values.firstWhere((node) => node.id == nextNodeId);
        } catch (e) {
          nextNode = null;
        }
        
        if (nextNode != null && nextNode != previousNode) {
          events.add(RoutingEvent(
            type: 'packet_forward',
            nodeId: currentNode?.id ?? '',
            description: '转发数据包到 ${nextNode.name}',
            packet: packet,
            delay: 800,
          ));
          
          packet.addToPath(nextNode.id);
          previousNode = currentNode;
          currentNode = nextNode;
        } else {
          events.add(RoutingEvent(
            type: 'routing_loop',
            nodeId: currentNode?.id ?? '',
            description: '⚠️ 检测到路由环路',
            packet: packet,
            delay: 500,
          ));
          break;
        }
      } else if (currentNode?.isHost == true) {
        // 主机需要通过默认网关
        NetworkNode? gateway;
        try {
          gateway = nodes.values.firstWhere((node) => node.isRouter && node.id == 'router_1');
        } catch (e) {
          gateway = null;
        }
        
        if (gateway != null && gateway != currentNode) {
          events.add(RoutingEvent(
            type: 'use_gateway',
            nodeId: currentNode?.id ?? '',
            description: '使用默认网关 ${gateway.name}',
            packet: packet,
            delay: 500,
          ));
          
          previousNode = currentNode;
          currentNode = gateway;
          
          events.add(RoutingEvent(
            type: 'packet_forward',
            nodeId: currentNode?.id ?? '',
            description: '数据包转发到网关',
            packet: packet,
            delay: 800,
          ));
          
          packet.addToPath(currentNode?.id ?? '');
        } else {
          // 无法到达目标
          events.add(RoutingEvent(
            type: 'unreachable',
            nodeId: currentNode?.id ?? '',
            description: '❌ 无法到达目标主机',
            packet: packet,
            delay: 500,
          ));
          break;
        }
      }
    }

    // 如果没有到达目标
    if (!reachedDestination) {
      events.add(RoutingEvent(
        type: 'timeout',
        nodeId: currentNode?.id ?? '',
        description: '❌ 路由超时',
        packet: packet,
        delay: 1000,
      ));
    }

    return events;
  }

  /// 查找最佳路由
  static String? _findBestRoute(List<RoutingEntry> routingTable, String destinationIp) {
    for (final entry in routingTable) {
      if (_isInSubnet(destinationIp, entry.destination, entry.netmask)) {
        return entry.nextHop;
      }
    }
    return null;
  }

  /// 检查IP是否在子网中
  static bool _isInSubnet(String ip, String network, String netmask) {
    // 简化的子网匹配逻辑
    final ipParts = ip.split('.');
    final networkParts = network.split('.');
    final maskParts = netmask.split('.');
    
    for (int i = 0; i < 4; i++) {
      final ipByte = int.tryParse(ipParts[i]) ?? 0;
      final networkByte = int.tryParse(networkParts[i]) ?? 0;
      final maskByte = int.tryParse(maskParts[i]) ?? 0;
      
      if ((ipByte & maskByte) != (networkByte & maskByte)) {
        return false;
      }
    }
    return true;
  }

  /// 生成Traceroute事件序列
  static List<RoutingEvent> generateTracerouteEvents({
    required String sourceIp,
    required String destinationIp,
    required Map<String, NetworkNode> nodes,
  }) {
    List<RoutingEvent> events = [];
    
    for (int ttl = 1; ttl <= 5; ttl++) {
      final traceEvents = generateRoutingEvents(
        sourceIp: sourceIp,
        destinationIp: destinationIp,
        nodes: nodes,
        initialTTL: ttl,
      );
      
      events.addAll(traceEvents);
      
      // 检查是否到达目标
      final hasReached = traceEvents.any((event) => event.type == 'packet_received');
      if (hasReached) break;
    }
    
    return events;
  }
}
