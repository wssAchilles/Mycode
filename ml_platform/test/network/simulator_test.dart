
import 'package:flutter_test/flutter_test.dart';
import 'package:ml_platform/models/network/base_models.dart';
import 'package:ml_platform/models/network/device_implementations.dart';
import 'package:ml_platform/models/network/ip_protocols.dart';
import 'package:ml_platform/services/network/network_simulator.dart';

void main() {
  late NetworkSimulator simulator;

  setUp(() {
    simulator = NetworkSimulator();
    simulator.reset();
  });

  test('Simple ARP and Ping Simulation (Host-Host Direct)', () async {
    // 1. Setup Topology
    final hostA = Host(name: 'Host A');
    final ifA = NetworkInterface(
      device: hostA, 
      name: 'eth0', 
      macAddress: const MacAddress('AA:AA:AA:AA:AA:AA'),
      ipAddress: const IpAddress('192.168.1.1')
    );
    hostA.addInterface(ifA);
    // 默认路由: 直连网段
    hostA.routingTable.add(RoutingEntry(
      destination: const IpAddress('192.168.1.0'),
      netmask: '255.255.255.0',
      interfaceName: 'eth0'
    ));
    
    final hostB = Host(name: 'Host B');
    final ifB = NetworkInterface(
      device: hostB, 
      name: 'eth0', 
      macAddress: const MacAddress('BB:BB:BB:BB:BB:BB'),
      ipAddress: const IpAddress('192.168.1.2')
    );
    hostB.addInterface(ifB);
     hostB.routingTable.add(RoutingEntry(
      destination: const IpAddress('192.168.1.0'),
      netmask: '255.255.255.0',
      interfaceName: 'eth0'
    ));

    simulator.addDevice(hostA);
    simulator.addDevice(hostB);
    simulator.addLink(ifA, ifB);
    
    simulator.start();
    simulator.timeScale = 100.0; // Speed up

    // 2. Host A sends Packet to Host B
    // At this point, ARP table is empty.
    final pack = IpPacket(
      sourceIp: ifA.ipAddress!,
      destinationIp: ifB.ipAddress!,
      protocol: IpProtocol.udp,
      id: 1,
    );
    
    print("Action: Host A sending packet to 192.168.1.2");
    hostA.sendIpPacket(pack);
    
    // 3. Wait for simulation
    // Expectation:
    // T+0: Host A sends ARP Request (Broadcast)
    // T+delay: Host B receives ARP Request -> Sends ARP Reply
    // T+2*delay: Host A receives ARP Reply -> Sends Buffered IP Packet
    // T+3*delay: Host B receives IP Packet
    
    await Future.delayed(const Duration(seconds: 2));
    
    // Verify ARP Table in Host A
    expect(hostA.arpTable.containsKey(const IpAddress('192.168.1.2')), true);
    expect(hostA.arpTable[const IpAddress('192.168.1.2')], const MacAddress('BB:BB:BB:BB:BB:BB'));
    
    print("Test Pass: ARP resolution successful");
  });
}
