import 'package:flutter_test/flutter_test.dart';
import 'package:ml_platform/models/network/base_models.dart';
import 'package:ml_platform/models/network/device_implementations.dart' as net_impl;
import 'package:ml_platform/models/network/ip_protocols.dart';
import 'package:ml_platform/models/network/icmp_protocol.dart';
import 'package:ml_platform/models/network/dns_protocol.dart';
import 'package:ml_platform/services/network/network_simulator.dart';

void main() {
  group('Routing & TTL Tests', () {
    late net_impl.Host hostA;
    late net_impl.Host hostB;
    late net_impl.Router router;
    late NetworkSimulator simulator;

    setUp(() {
      simulator = NetworkSimulator();
      simulator.reset();
      
      // Layout: HostA [1.10] -- [1.1] Router [2.1] -- [2.10] HostB
      
      hostA = net_impl.Host(name: 'HostA');
      hostB = net_impl.Host(name: 'HostB');
      router = net_impl.Router(name: 'Router');
      
      // Interface Config
      // Network 1: 192.168.1.0/24
      final ifaceA = NetworkInterface(
        device: hostA, name: 'eth0', 
        macAddress: MacAddress('AA:00:00:00:00:01'), ipAddress: IpAddress('192.168.1.10')
      );
      hostA.addInterface(ifaceA);
      
      final ifaceR1 = NetworkInterface(
        device: router, name: 'eth0', 
        macAddress: MacAddress('RR:00:00:00:00:01'), ipAddress: IpAddress('192.168.1.1')
      );
      router.addInterface(ifaceR1);
      
      // Network 2: 192.168.2.0/24
      final ifaceB = NetworkInterface(
        device: hostB, name: 'eth0', 
        macAddress: MacAddress('BB:00:00:00:00:01'), ipAddress: IpAddress('192.168.2.10')
      );
      hostB.addInterface(ifaceB);

      final ifaceR2 = NetworkInterface(
        device: router, name: 'eth1', 
        macAddress: MacAddress('RR:00:00:00:00:02'), ipAddress: IpAddress('192.168.2.1')
      );
      router.addInterface(ifaceR2);
      
      // Routes
      // Host A: Default gateway -> 192.168.1.1
      hostA.routingTable.add(RoutingEntry(
        destination: IpAddress('0.0.0.0'), netmask: '0.0.0.0',
        nextHop: IpAddress('192.168.1.1'), interfaceName: 'eth0'
      ));
      
      // Host B: Default gateway -> 192.168.2.1
      hostB.routingTable.add(RoutingEntry(
        destination: IpAddress('0.0.0.0'), netmask: '0.0.0.0',
        nextHop: IpAddress('192.168.2.1'), interfaceName: 'eth0'
      ));
      
      // Router knows both networks (Direct connected, auto added)
      
      // Physical Links
      simulator.addDevice(hostA);
      simulator.addDevice(hostB);
      simulator.addDevice(router);
      
      simulator.addLink(ifaceA, ifaceR1);
      simulator.addLink(ifaceR2, ifaceB);
    });

    test('TTL Expiry Test', () async {
      bool timeExceededReceived = false;
      
      // Monitor HostA for ICMP Time Exceeded
      // Override onReceiveIpPacket or listen to logs?
      // Better: we can inspect HostA's received packets by intercepting or checking logs?
      // But Host.onReceiveIpPacket prints log.
      // Modifying Host to allow callback for test?
      
      // Instead, let's verify by adding a custom handler or simpler: 
      // check if Router sends the packet.
      
      // Send Packet from A to B with TTL=1
      // Hop 1: A -> Router. Router receives. TTL=1.
      // Router logic: if TTL<=1 -> Send ICMP Time Exceeded.
      
      final packet = IpPacket(
        sourceIp: IpAddress('192.168.1.10'),
        destinationIp: IpAddress('192.168.2.10'),
        protocol: IpProtocol.udp,
        ttl: 1, // Intentional TTL 1
        payload: UdpDatagram(sourcePort: 1234, destinationPort: 5678, data: "Hello"),
      );
      
      hostA.sendIpPacket(packet);
      
      // Step 1: A sends to Router (Need ARP)
      simulator.tick(3000); // Allow ARP + Transmission
      
      // Step 2: Router processes. Should generate ICMP Time Exceeded back to A.
      simulator.tick(3000); // Allow Router -> A
      
      // How to verify HostA received it?
      // We can create a subclass of Host for testing, or just rely on console output?
      // Or we can check if HostA has received any packet?
      // Host doesn't expose received buffer.
      
      // Let's rely on the fact that if we send Ping with TTL=1, ping result should be error.
      // Host.icmpPinger handles Time Exceeded.
      
      final pinger = hostA.icmpPinger;
      PingResult? lastResult;
      pinger.onResult = (res) {
        lastResult = res;
      };
      
      // Create a manual ICMP Echo Request with TTL 1
      final pingPacket = IpPacket(
        sourceIp: IpAddress('192.168.1.10'),
        destinationIp: IpAddress('192.168.2.10'),
        protocol: IpProtocol.icmp,
        ttl: 1, // TTL 1
        payload: IcmpPacket(
          type: IcmpType.echoRequest,
          identifier: 1234,
          sequenceNumber: 1,
          data: "Ping with TTL 1"
        )
      );
      
      // To trigger pinger correctly, we need to register potential pending request manually 
      // OR mostly just send the packet and expect the callback to be called.
      // But pinger._handleTimeExceeded calls onResult with error.
      // It doesn't check _pendingRequests for Time Exceeded? 
      // Let's check icmp_protocol.dart: _handleTimeExceeded(ipPacket, icmp) -> calls onResult directly.
      
      print('Sending Ping with TTL=1...');
      hostA.sendIpPacket(pingPacket);
      
      // Tick simulator
      simulator.tick(3000); // A -> Router
      simulator.tick(3000); // Router -> A (Time Exceeded)
      
      expect(lastResult, isNotNull);
      expect(lastResult!.success, isFalse);
      expect(lastResult!.error, contains('TTL Exceeded'));
      expect(lastResult!.source.value, anyOf('192.168.1.1', '192.168.2.1')); // Router IP
    });

    test('Normal Routing Test (TTL > 1)', () {
      PingResult? lastResult;
      hostA.icmpPinger.onResult = (res) => lastResult = res;
      
      // Use helper to perform ping
      hostA.icmpPinger.ping(IpAddress('192.168.2.10'));
      
      // 1. A -> Router (ARP Request + Reply + Echo Request)
      simulator.tick(3000); 
      // 2. Router -> B (ARP Request + Reply + Echo Request forwarded)
      simulator.tick(3000);
      // 3. B -> Router (Echo Reply)
      simulator.tick(3000);
      // 4. Router -> A (Echo Reply forwarded)
      simulator.tick(3000);
      
      // Wait extra for async delays
      simulator.tick(1000);
      
      expect(lastResult, isNotNull);
      expect(lastResult!.success, isTrue);
      expect(lastResult!.source.value, equals('192.168.2.10'));
    });
  });
}
