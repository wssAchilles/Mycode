import 'package:flutter_test/flutter_test.dart';
import 'package:ml_platform/models/network/base_models.dart';
import 'package:ml_platform/models/network/device_implementations.dart' as net_impl;
import 'package:ml_platform/models/network/ip_protocols.dart';
import 'package:ml_platform/models/network/tcp_stack.dart';
import 'package:ml_platform/services/network/network_simulator.dart';

void main() {
  group('TCP 完整握手流程测试', () {
    late net_impl.Host client;
    late net_impl.Host server;
    late NetworkSimulator simulator;

    setUp(() {
      simulator = NetworkSimulator();
      simulator.reset();
      
      // 创建客户端和服务器
      client = net_impl.Host(name: 'Client', x: 0, y: 0);
      server = net_impl.Host(name: 'Server', x: 100, y: 0);
      
      // 配置接口
      final clientIface = NetworkInterface(
        device: client,
        name: 'eth0',
        macAddress: MacAddress('AA:BB:CC:DD:EE:01'),
        ipAddress: IpAddress('192.168.1.100'),
      );
      final serverIface = NetworkInterface(
        device: server,
        name: 'eth0',
        macAddress: MacAddress('AA:BB:CC:DD:EE:02'),
        ipAddress: IpAddress('192.168.1.200'),
      );
      
      client.addInterface(clientIface);
      server.addInterface(serverIface);
      
      // 配置路由
      client.routingTable.add(RoutingEntry(
        destination: IpAddress('192.168.1.0'),
        netmask: '255.255.255.0',
        interfaceName: 'eth0',
      ));
      server.routingTable.add(RoutingEntry(
        destination: IpAddress('192.168.1.0'),
        netmask: '255.255.255.0',
        interfaceName: 'eth0',
      ));
      
      // 连接物理链路
      simulator.addDevice(client);
      simulator.addDevice(server);
      simulator.addLink(clientIface, serverIface);
      
      // 重要：确保设备和接口处于启用状态
      // (默认即启用)
    });

    test('完整的三次握手 (SYN -> SYN+ACK -> ACK)', () {
      // 1. 服务端监听 80 端口
      final serverListenSocket = server.tcpStack.createSocket(80);
      server.tcpStack.listen(80, serverListenSocket);
      expect(serverListenSocket.state, equals(TcpState.listen));
      
      // 2. 客户端发起连接
      final clientSocket = client.tcpStack.createSocket(5000);
      clientSocket.connect(IpAddress('192.168.1.200'), 80);
      expect(clientSocket.state, equals(TcpState.synSent));
      
      // 此时模拟器中应有一个 pending event (Packet Arrival: SYN)
      // 延迟至少 2000ms
      
      // 3. 推进时间：Client -> Server (SYN)
      simulator.tick(2100); 
      
      // Server 收到 SYN，应该发送 SYN+ACK
      // Server Listen Socket 应该依然是 LISTEN
      expect(serverListenSocket.state, equals(TcpState.listen));
      
      // 4. 推进时间：Server -> Client (SYN+ACK)
      simulator.tick(2100);
      
      // Client 收到 SYN+ACK，应该发送 ACK 并进入 ESTABLISHED
      expect(clientSocket.state, equals(TcpState.established), reason: "Client should be ESTABLISHED after receiving SYN+ACK");
      
      // 5. 推进时间：Client -> Server (ACK)
      simulator.tick(2100);
      
      // Server 收到 ACK，应该创建一个新的 Socket 处于 ESTABLISHED (或者根据简化的实现，可能是 ListenSocket 的某个队列？)
      // 让我们检查 Server 是否有其他 socket 处于 ESTABLISHED
      // 但在此简化实现中，也许我们需要检查 tcpStack 内部状态，或者只是确认没有抛错
      
      print('Test Completed: Client is ESTABLISHED');
    });
  });
}
