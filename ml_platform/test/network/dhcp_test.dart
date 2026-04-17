import 'package:flutter_test/flutter_test.dart';
import 'package:ml_platform/models/network/base_models.dart';
import 'package:ml_platform/models/network/device_implementations.dart' as net_impl;
import 'package:ml_platform/models/network/ip_protocols.dart';
import 'package:ml_platform/models/network/dhcp_protocol.dart';
import 'package:ml_platform/services/network/network_simulator.dart';

void main() {
  group('DHCP Protocol Tests', () {
    late net_impl.Host client;
    late net_impl.Host server;
    late NetworkSimulator simulator;

    setUp(() {
      simulator = NetworkSimulator();
      simulator.reset();
      
      // Client (starts with no IP)
      client = net_impl.Host(name: 'Client');
      final clientIface = NetworkInterface(
        device: client, name: 'eth0', 
        macAddress: MacAddress('CC:CC:CC:CC:CC:01'), 
        ipAddress: null // No IP initially
      );
      client.addInterface(clientIface);
      client.dhcpClient = DhcpClient(client);
      
      // Server
      server = net_impl.Host(name: 'DHCPServer');
      final serverIface = NetworkInterface(
        device: server, name: 'eth0', 
        macAddress: MacAddress('SS:SS:SS:SS:SS:01'), 
        ipAddress: IpAddress('192.168.1.1')
      );
      server.addInterface(serverIface);
      
      server.dhcpServer = DhcpServer(
        device: server,
        startIp: IpAddress('192.168.1.100'),
        endIp: IpAddress('192.168.1.200'),
        netmask: IpAddress('255.255.255.0'),
        gateway: IpAddress('192.168.1.1'),
        dns: IpAddress('8.8.8.8'),
      );
      
      simulator.addDevice(client);
      simulator.addDevice(server);
      simulator.addLink(clientIface, serverIface);
    });

    test('Full DHCP Cycle (Discover -> Offer -> Request -> Ack)', () {
      // 1. Start Client Discovery
      client.dhcpClient!.start(); // Sends DISCOVER (Broadcast)
      
      expect(client.dhcpClient!.state, equals(DhcpClientState.selecting));
      
      // Tick enough time for the full handshake (4 packets * delay)
      // Assuming delay is small, 2.5s is more than enough for everything.
      simulator.tick(2500);
      
      // Client should be Bound
      expect(client.dhcpClient!.state, equals(DhcpClientState.bound));
      
      // Verify IP Assignment
      final assignedIp = client.interfaces['eth0']!.ipAddress;
      expect(assignedIp, isNotNull);
      expect(assignedIp!.value, startsWith('192.168.1.'));
      print('Assigned IP: ${assignedIp.value}');
      
      // Verify Gateway
      final hasGateway = client.routingTable.any((r) => r.destination.value == '0.0.0.0');
      expect(hasGateway, isTrue);
    });
  });
}
