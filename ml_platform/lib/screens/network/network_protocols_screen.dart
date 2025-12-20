
import 'package:flutter/material.dart';
import '../../screens/network/topology_design_screen.dart';

// Since the user might not have a direct link yet, I'll update the NetworkProtocolsScreen logic
// Or create a temporary entry point if NetworkProtocolsScreen doesn't exist yet.
// The plan said "NEW lib/screens/network/network_protocols_screen.dart".
// I will create that file as the main entry point.

class NetworkProtocolsScreen extends StatelessWidget {
  const NetworkProtocolsScreen({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Network Protocols'),
      ),
      body: ListView(
        children: [
          ListTile(
            leading: const Icon(Icons.hub),
            title: const Text('Topology Designer (New)'),
            subtitle: const Text('Build your own network and simulate traffic'),
            onTap: () {
              Navigator.of(context).push(MaterialPageRoute(
                builder: (context) => const TopologyDesignScreen(),
              ));
            },
          ),
          // Legacy placeholders
          ListTile(
            leading: const Icon(Icons.compare_arrows),
            title: const Text('TCP Handshake (Legacy)'),
            onTap: () {
               // Navigation to legacy screens if needed
            },
          ),
        ],
      ),
    );
  }
}
