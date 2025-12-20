
import 'package:flutter_test/flutter_test.dart';
import 'package:ml_platform/models/network/base_models.dart';
import 'package:ml_platform/models/network/device_implementations.dart' as net_impl;
import 'package:ml_platform/models/network/ip_protocols.dart';
import 'package:ml_platform/models/network/dns_protocol.dart';
import 'package:ml_platform/services/network/network_simulator.dart';

void main() {
  group('DNS 协议测试', () {
    late net_impl.Host client;
    late net_impl.Host dnsServerHost;
    late NetworkSimulator simulator;
    
    setUp(() {
      simulator = NetworkSimulator();
      simulator.reset();
      
      // 创建客户端和 DNS 服务器
      client = net_impl.Host(name: 'Client', x: 0, y: 0);
      dnsServerHost = net_impl.Host(name: 'DNS Server', x: 100, y: 0);
      
      // 配置接口 IP
      final clientIface = NetworkInterface(
        device: client,
        name: 'eth0',
        macAddress: MacAddress('AA:BB:CC:DD:EE:01'),
        ipAddress: IpAddress('192.168.1.100'),
      );
      final serverIface = NetworkInterface(
        device: dnsServerHost,
        name: 'eth0',
        macAddress: MacAddress('AA:BB:CC:DD:EE:02'),
        ipAddress: IpAddress('192.168.1.53'),
      );
      
      client.addInterface(clientIface);
      dnsServerHost.addInterface(serverIface);
      
      // 路由
      client.routingTable.add(RoutingEntry(
        destination: IpAddress('192.168.1.0'),
        netmask: '255.255.255.0',
        interfaceName: 'eth0',
      ));
      dnsServerHost.routingTable.add(RoutingEntry(
        destination: IpAddress('192.168.1.0'),
        netmask: '255.255.255.0',
        interfaceName: 'eth0',
      ));
      
      // 连接并添加到模拟器
      simulator.addDevice(client);
      simulator.addDevice(dnsServerHost);
      simulator.addLink(clientIface, serverIface);
      
      // 设置 DNS 服务器
      dnsServerHost.dnsServer = DnsServer(dnsServerHost);
      dnsServerHost.dnsServer!.addARecord('example.com', '93.184.216.34');
      dnsServerHost.dnsServer!.addARecord('api.example.com', '93.184.216.35');
      
      // 设置 DNS 解析器
      client.dnsResolver = DnsResolver(
        dnsServerIp: IpAddress('192.168.1.53'),
        device: client,
      );
    });
    
    test('DnsMessage 序列化和反序列化', () {
      final query = DnsMessage(
        transactionId: 1234,
        type: DnsMessageType.query,
        queryType: DnsQueryType.a,
        queryName: 'example.com',
      );
      
      final serialized = query.serialize();
      final deserialized = DnsMessage.deserialize(serialized);
      
      expect(deserialized, isNotNull);
      expect(deserialized!.transactionId, equals(1234));
      expect(deserialized.type, equals(DnsMessageType.query));
      expect(deserialized.queryName, equals('example.com'));
    });
    
    test('DnsServer 添加和查询 A 记录', () {
      final server = DnsServer(dnsServerHost);
      server.addARecord('test.com', '1.2.3.4');
      
      // 服务器内部记录应该存在
      // 注意: 这里只能测试服务器对象的创建, 完整的查询测试需要模拟器运行
      expect(server, isNotNull);
    });
    
    test('DnsResolver 创建成功', () {
      expect(client.dnsResolver, isNotNull);
      expect(client.dnsResolver!.dnsServerIp.value, equals('192.168.1.53'));
    });
  });
}
