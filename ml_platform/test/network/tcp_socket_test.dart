
import 'package:flutter_test/flutter_test.dart';
import 'package:ml_platform/models/network/base_models.dart';
import 'package:ml_platform/models/network/device_implementations.dart' as net_impl;
import 'package:ml_platform/models/network/ip_protocols.dart';
import 'package:ml_platform/models/network/tcp_stack.dart';
import 'package:ml_platform/services/network/network_simulator.dart';

void main() {
  group('TCP 三次握手测试', () {
    late net_impl.Host client;
    late net_impl.Host server;
    late NetworkSimulator simulator;
    
    setUp(() {
      simulator = NetworkSimulator();
      simulator.reset();
      
      // 创建客户端和服务器
      client = net_impl.Host(name: 'Client', x: 0, y: 0);
      server = net_impl.Host(name: 'Server', x: 100, y: 0);
      
      // 给设备添加接口并配置 IP
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
      
      // 添加直连路由 (同网段)
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
      
      // 连接两个接口
      simulator.addDevice(client);
      simulator.addDevice(server);
      simulator.addLink(clientIface, serverIface);
    });
    
    test('TcpSocket 状态机初始化', () {
      final socket = client.tcpStack.createSocket(5000);
      
      expect(socket.state, equals(TcpState.closed));
      expect(socket.localPort, equals(5000));
    });
    
    test('服务端进入 LISTEN 状态', () {
      final serverSocket = server.tcpStack.createSocket(80);
      server.tcpStack.listen(80, serverSocket);
      
      expect(serverSocket.state, equals(TcpState.listen));
    });
    
    test('客户端发起连接进入 SYN_SENT 状态', () {
      final clientSocket = client.tcpStack.createSocket(5000);
      
      clientSocket.connect(IpAddress('192.168.1.200'), 80);
      
      expect(clientSocket.state, equals(TcpState.synSent));
    });
    
    // 注意: 完整的三次握手测试需要模拟器运行事件循环
    // 这里只测试状态机的基本功能
  });
}
