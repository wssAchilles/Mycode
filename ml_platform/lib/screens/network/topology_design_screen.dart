
import 'package:flutter/material.dart';
import 'package:ml_platform/config/app_theme.dart';
import '../../models/network/base_models.dart';
import '../../models/network/device_implementations.dart' as net_impl;
import '../../models/network/ip_protocols.dart';
import '../../models/network/tcp_stack.dart';
import '../../services/network/network_simulator.dart';
import 'dart:math' as math;

class TopologyDesignScreen extends StatefulWidget {
  const TopologyDesignScreen({Key? key}) : super(key: key);

  @override
  State<TopologyDesignScreen> createState() => _TopologyDesignScreenState();
}

class _TopologyDesignScreenState extends State<TopologyDesignScreen> {
  final NetworkSimulator _simulator = NetworkSimulator();
  
  // 交互状态
  String? _selectedDeviceId;
  String? _linkingSourceId; // 正在连线的源设备ID
  Offset _dragPosition = Offset.zero; // 临时的连线终点
  bool _isLinkingMode = false; // 是否处于连线模式
  double _logConsoleHeight = 150.0; // 日志控制台高度
  
  @override
  void initState() {
    super.initState();
    // OPTIMIZATION: Do not listen globally. Use AnimatedBuilder for specific sections.
    // _simulator.addListener(_onSimulatorUpdate);
  }

  @override
  void dispose() {
    // _simulator.removeListener(_onSimulatorUpdate);
    super.dispose();
  }

  // void _onSimulatorUpdate() { setState(() {}); }

  void _addHost() {
    final host = net_impl.Host(
      name: 'Host ${_simulator.devices.length + 1}',
      x: 100, 
      y: 100
    );
    // 默认添加一个接口
    host.addInterface(NetworkInterface(
      device: host, 
      name: 'eth0', 
      macAddress: MacAddress.random(),
      ipAddress: IpAddress('192.168.1.${_simulator.devices.length + 10}')
    ));
    _simulator.addDevice(host);
  }

  void _addRouter() {
    final router = net_impl.Router(
      name: 'Router ${_simulator.devices.length + 1}',
      x: 200, 
      y: 200
    );
     // 默认添加两个接口
    router.addInterface(NetworkInterface(
      device: router, 
      name: 'eth0', 
      macAddress: MacAddress.random(),
      ipAddress: IpAddress('192.168.1.1')
    ));
    router.addInterface(NetworkInterface(
      device: router, 
      name: 'eth1', 
      macAddress: MacAddress.random(),
      ipAddress: IpAddress('192.168.2.1')
    ));
    _simulator.addDevice(router);
  }
  
  void _onTapDevice(NetworkDevice device) {
    if (_linkingSourceId != null) {
      // 完成连线
      if (_linkingSourceId != device.id) {
        _createLink(_linkingSourceId!, device.id);
      }
      setState(() {
        _linkingSourceId = null;
      });
    } else {
      // 选中设备
      setState(() {
        _selectedDeviceId = device.id;
      });
    }
  }
  
  void _startLinkMode(NetworkDevice device) {
    setState(() {
      _linkingSourceId = device.id;
      _dragPosition = Offset(device.x + 30, device.y + 30); // 初始
    });
  }
  
  void _createLink(String dev1Id, String dev2Id) {
    // 简单查找未连接的接口并连接
    // 实际项目中应弹出对话框让用户选择接口
    final dev1 = _simulator.devices.firstWhere((d) => d.id == dev1Id);
    final dev2 = _simulator.devices.firstWhere((d) => d.id == dev2Id);
    
    NetworkInterface? if1;
    NetworkInterface? if2;
    
    // 找空闲接口
    for (var i in dev1.interfaces.values) {
      if (!i.isConnected) {
        if1 = i;
        break;
      }
    }
    for (var i in dev2.interfaces.values) {
      if (!i.isConnected) {
        if2 = i;
        break;
      }
    }
    
    if (if1 != null && if2 != null) {
      _simulator.addLink(if1, if2);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Linked ${dev1.name} (${if1.name}) <-> ${dev2.name} (${if2.name})'))
      );
    } else {
       ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No free interfaces available!'))
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
            icon: const Icon(Icons.arrow_back),
            onPressed: () => Navigator.of(context).pop(),
            tooltip: '返回',
        ),
        title: const Text('Network Topology Designer'),
        actions: [
          IconButton(
            icon: Icon(_simulator.isRunning ? Icons.pause : Icons.play_arrow),
            tooltip: _simulator.isRunning ? '暂停模拟' : '开始模拟',
            onPressed: () {
              if (_simulator.isRunning) {
                _simulator.pause();
              } else {
                _simulator.start();
              }
            },
          ),
          IconButton(
            icon: const Icon(Icons.delete_outline),
            tooltip: '重置拓扑',
            onPressed: () => _simulator.reset(),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: Row(
              children: [
                // 左侧工具栏
                NavigationRail(
                  selectedIndex: null,
                  onDestinationSelected: (int index) {
                    if (index == 0) _addHost();
                    if (index == 1) _addRouter();
                  },
                  labelType: NavigationRailLabelType.all,
                  destinations: const [
                    NavigationRailDestination(
                      icon: Icon(Icons.computer),
                      label: Text('Host'),
                    ),
                    NavigationRailDestination(
                      icon: Icon(Icons.router),
                      label: Text('Router'),
                    ),
                  ],
                  trailing: Padding(
                    padding: const EdgeInsets.only(top: 20),
                    child: Column(
                      children: [
                        const Divider(),
                        Tooltip(
                          message: _isLinkingMode ? 'Exit Link Mode' : 'Enter Link Mode',
                          child: IconButton(
                            icon: Icon(
                              Icons.cable,
                              color: _isLinkingMode ? AppTheme.primary : AppTheme.textSecondary,
                            ),
                            isSelected: _isLinkingMode,
                            onPressed: () {
                              setState(() {
                                _isLinkingMode = !_isLinkingMode;
                                _linkingSourceId = null; // Reset temp state
                              });
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                  content: Text(_isLinkingMode 
                                    ? 'Link Mode: Drag from one device to another to connect.' 
                                    : 'Move Mode: Drag devices to rearrange.'),
                                  duration: const Duration(seconds: 1),
                                )
                              );
                            },
                          ),
                        ),
                        Text(_isLinkingMode ? 'Linking' : 'Move', style: const TextStyle(fontSize: 10)),
                      ],
                    ),
                  ),
                ),
                const VerticalDivider(thickness: 1, width: 1),
                // 主要画布区域
                Expanded(
                  child: Listener(
                    onPointerMove: (event) {
                      // If in global linking mode (if we implemented it globally), handle here.
                      // ... (rest unchanged)
                    },
                    child: GestureDetector(
                      onTap: () {
                        // 取消选择/连线
                        setState(() {
                          _selectedDeviceId = null;
                          _linkingSourceId = null;
                        });
                      },
                      child: Container(
                        color: AppTheme.surface,
                        child: Stack(
                          children: [
                            // 1. 绘制连线
                            CustomPaint(
                              size: Size.infinite,
                              painter: TopologyLinkPainter(
                                devices: _simulator.devices,
                                links: _simulator.links,
                                linkingSourceId: _linkingSourceId,
                                dragPosition: _dragPosition,
                              ),
                            ),
                            
                            // 2. 绘制设备节点
                            ..._simulator.devices.map((device) {
                              return Positioned(
                                left: device.x,
                                top: device.y,
                                child: DraggableNetworkNode(
                                  device: device,
                                  isSelected: device.id == _selectedDeviceId,
                                  isLinkingMode: _isLinkingMode,
                                  onTap: () => _onTapDevice(device),
                                  onDragUpdate: (delta, iconCenterGlobal) {
                                      // ... (rest unchanged for update logic is complex, better use replace if heavy change but drag update is same)
                                      // Wait, I should keep the drag update logic or re-paste it.
                                      // Since I am replacing the 'body' structure to include Column->Expanded(Row)->LogConsole.
                                      // I will re-paste the drag logic carefully.
                                      if (_isLinkingMode) {
                                        // Linking Logic
                                        if (_linkingSourceId == null) {
                                            // Start linking
                                            setState(() {
                                                _linkingSourceId = device.id;
                                                _dragPosition = Offset(device.x + 30, device.y + 30);
                                            });
                                        } else {
                                            // Update line end
                                            setState(() {
                                                _dragPosition += delta;
                                            });
                                        }
                                      } else {
                                        // Move Logic
                                        setState(() {
                                          device.x += delta.dx;
                                          device.y += delta.dy;
                                        });
                                      }
                                  },
                                  onDragEnd: (dropOffset) {
                                      // ... same end logic
                                      if (_isLinkingMode && _linkingSourceId != null) {
                                          _checkForLinkTarget(_dragPosition);
                                          setState(() {
                                              _linkingSourceId = null;
                                          });
                                      }
                                  },
                                   onDoubleTap: () {}, 
                                ),
                              );
                            }).toList(),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
                // 右侧属性面板
                if (_selectedDeviceId != null)
                  AnimatedBuilder(
                    animation: _simulator,
                    builder: (context, child) => _buildPropertyPanel(),
                  ),
              ],
            ),
          ),
          // 底部日志控制台
          // Resize Handle
          GestureDetector(
            onVerticalDragUpdate: (details) {
              setState(() {
                _logConsoleHeight -= details.delta.dy;
                _logConsoleHeight = _logConsoleHeight.clamp(50.0, 500.0);
              });
            },
            child: MouseRegion(
              cursor: SystemMouseCursors.resizeUpDown,
              child: Container(
                height: 8,
                width: double.infinity,
                color: AppTheme.borderStrong,
                alignment: Alignment.center,
                child: Container(
                    width: 40, 
                    height: 4, 
                    decoration: BoxDecoration(
                        color: AppTheme.borderSubtle,
                        borderRadius: BorderRadius.circular(2)
                    )
                ),
              ),
            ),
          ),
          AnimatedBuilder(
            animation: _simulator,
            builder: (context, child) => _buildLogConsole(),
          ),
        ],
      ),
    );
  }
  
  void _checkForLinkTarget(Offset dropPosition) {
    // Simple collision detection (center distance < 40)
    // Assumes Device size is 60x60, radius 30.
    for (var device in _simulator.devices) {
        if (device.id == _linkingSourceId) continue;
        
        final center = Offset(device.x + 30, device.y + 30);
        final dist = (center - dropPosition).distance;
        
        if (dist < 40) {
            _createLink(_linkingSourceId!, device.id);
            break;
        }
    }
  }

  Widget _buildPropertyPanel() {
    // 查找选中的设备
    final device = _simulator.devices.cast<net_impl.IpDevice?>().firstWhere(
      (d) => d?.id == _selectedDeviceId, 
      orElse: () => null,
    );
    
    // 如果找不到设备，返回空面板
    if (device == null) {
      return Container(
        width: 300,
        color: AppTheme.surface,
        padding: const EdgeInsets.all(16),
        child: const Center(
          child: Text(
            'No device selected',
            style: TextStyle(color: AppTheme.textSecondary),
          ),
        ),
      );
    }
    
    return Container(
      width: 300,
      color: AppTheme.surface,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
                Expanded(
                  child: Text(
                    'Properties: ${device.name}',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close),
                  tooltip: '关闭面板',
                  onPressed: () => setState(() => _selectedDeviceId = null),
                ),
            ]
          ),
          const Divider(),
          if (device is net_impl.IpDevice) ...[
             const Divider(),
             const Text('ARP Table:', style: TextStyle(fontWeight: FontWeight.bold)),
             _buildArpTable(device as net_impl.IpDevice),
             const SizedBox(height: 8),
          ],
          if (device is net_impl.Host) ...[
             const Divider(),
             _buildPingTool(device as net_impl.Host),
          ],
          if (device is net_impl.Router) ...[
             const Divider(),
             const Text('Routing Table:', style: TextStyle(fontWeight: FontWeight.bold)),
             _buildRoutingTable(device as net_impl.Router),
          ],
          if (device is net_impl.IpDevice) ...[
             const Divider(),
             const Text('TCP Connections:', style: TextStyle(fontWeight: FontWeight.bold)),
             _buildTcpConnectionsPanel(device as net_impl.IpDevice),
          ],
          const SizedBox(height: 20),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
                const Text('Interfaces:', style: TextStyle(fontWeight: FontWeight.bold)),
                TextButton.icon(
                    icon: const Icon(Icons.add, size: 16),
                    label: const Text("Add"),
                    onPressed: () {
                        setState(() {
                             final newName = 'eth${device.interfaces.length}';
                             device.addInterface(NetworkInterface(
                                device: device,
                                name: newName,
                                macAddress: MacAddress.random(),
                                ipAddress: device is net_impl.Router 
                                    ? IpAddress('10.0.${device.interfaces.length}.1') 
                                    : null 
                             ));
                        });
                    },
                )
            ],
          ),
          Expanded(
            child: ListView(
                children: device.interfaces.values.map((iface) => ListTile(
                    title: Text(iface.name),
                    subtitle: Text('${iface.ipAddress?.toString() ?? "No IP"}\n${iface.macAddress}'),
                    isThreeLine: true,
                    trailing: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                            Icon(iface.isConnected ? Icons.link : Icons.link_off, 
                                color: iface.isConnected
                                    ? AppTheme.success
                                    : AppTheme.textSecondary),
                            if (iface.isConnected)
                                IconButton(
                                    icon: const Icon(Icons.close, color: AppTheme.error, size: 20),
                                    onPressed: () {
                                        // TODO: Implement Disconnect
                                    },
                                    tooltip: '断开连接',
                                )
                        ]
                    ),
                )).toList(),
            ),
          )
        ],
      ),
    );
  }

  // --- Ping Tool ---
  final TextEditingController _pingTargetController = TextEditingController();

  Widget _buildPingTool(net_impl.Host host) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Ping Tool', style: TextStyle(fontWeight: FontWeight.bold)),
        const SizedBox(height: 4),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _pingTargetController,
                decoration: const InputDecoration(
                  labelText: 'Target IP',
                  isDense: true,
                  border: OutlineInputBorder(),
                ),
              ),
            ),
            const SizedBox(width: 8),
            ElevatedButton(
              onPressed: () {
                final targetIp = _pingTargetController.text;
                if (targetIp.isEmpty) return;
                
                try {
                  // 使用完整的 ICMP Ping 工具
                  final ip = IpAddress(targetIp);
                  
                  if (host.interfaces.isNotEmpty) {
                      // 设置 Ping 结果回调
                      host.icmpPinger.onResult = (result) {
                          _simulator.log("PING: ${result.toString()}");
                      };
                      
                      _simulator.log("Host ${host.name}: Sending ICMP Echo Request to $targetIp");
                      host.icmpPinger.ping(ip);
                  } else {
                      _simulator.log("Error: Host has no configured interfaces");
                  }
                  
                } catch (e) {
                   ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
                }
              },
              child: const Text('Ping'),
            ),
          ],
        ),
        const Divider(),
      ],
    );
  }

  // --- Helper Tables ---

  Widget _buildArpTable(net_impl.IpDevice device) {
    if (device.arpTable.isEmpty) {
      return const Text(
        " (Empty set)",
        style: TextStyle(color: AppTheme.textSecondary, fontSize: 12),
      );
    }
    return Column(
      children: device.arpTable.entries.map((e) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(e.key.toString(), style: const TextStyle(fontSize: 12)),
            const Icon(Icons.arrow_right_alt, size: 12, color: AppTheme.textSecondary),
            Text(e.value.toString().substring(15), style: const TextStyle(fontSize: 12, fontFamily: 'monospace')), // Abbreviate MAC
          ],
        ),
      )).toList(),
      
    );
  }

  Widget _buildRoutingTable(net_impl.Router router) {
    if (router.routingTable.isEmpty) {
      return const Text(
        " (Default only)",
        style: TextStyle(color: AppTheme.textSecondary, fontSize: 12),
      );
    }
    return Column(
      children: router.routingTable.map((route) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(
          children: [
             Expanded(child: Text("${route.destination}/${route.prefixLength}", style: const TextStyle(fontSize: 11))),
             const Icon(Icons.chevron_right, size: 12),
             Expanded(
               child: Text(
                 route.nextHop?.toString() ?? "Direct",
                 style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary),
               ),
             ),
          ],
        ),
      )).toList(),
    );
  }

  Widget _buildTcpConnectionsPanel(net_impl.IpDevice device) {
    // 获取设备的 TCP 栈中的活跃连接
    // 注意: 热重载后旧实例可能未正确初始化, 需要防护
    List<int> listeningPorts;
    List<TcpSocket> connections;
    
    try {
      final tcpStack = device.tcpStack;
      listeningPorts = tcpStack.getListeningPorts();
      connections = tcpStack.getActiveConnections();
    } catch (e) {
      // tcpStack 未初始化 (可能是热重载问题)
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 4),
        child: Text(
          " (刷新页面以查看)",
          style: TextStyle(color: AppTheme.warning, fontSize: 12),
        ),
      );
    }
    
    if (listeningPorts.isEmpty && connections.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 4),
        child: Text(
          " (无活跃连接)",
          style: TextStyle(color: AppTheme.textSecondary, fontSize: 12),
        ),
      );
    }
    
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // 监听端口
        if (listeningPorts.isNotEmpty) ...[
          const Text(
            "  监听:",
            style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
          ),
          ...listeningPorts.map((port) => Padding(
            padding: const EdgeInsets.only(left: 8, top: 2),
            child: Row(
              children: [
                const Icon(Icons.hearing, size: 12, color: AppTheme.success),
                const SizedBox(width: 4),
                Text(":$port", style: const TextStyle(fontSize: 11, fontFamily: 'monospace')),
                const Text(
                  " LISTEN",
                  style: TextStyle(fontSize: 10, color: AppTheme.success),
                ),
              ],
            ),
          )),
        ],
        // 活跃连接
        if (connections.isNotEmpty) ...[
          const SizedBox(height: 4),
          const Text(
            "  连接:",
            style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
          ),
          ...connections.map((conn) => Padding(
            padding: const EdgeInsets.only(left: 8, top: 2),
            child: Row(
              children: [
                Icon(
                  conn.state == TcpState.established ? Icons.check_circle : Icons.sync,
                  size: 12, 
                  color: _getTcpStateColor(conn.state),
                ),
                const SizedBox(width: 4),
                Expanded(
                  child: Text(
                    ":${conn.localPort} ↔ ${conn.remoteAddress?.value ?? '?'}:${conn.remotePort ?? '?'}",
                    style: const TextStyle(fontSize: 10, fontFamily: 'monospace'),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                  decoration: BoxDecoration(
                    color: _getTcpStateColor(conn.state).withOpacity(0.2),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    conn.state.name.toUpperCase(),
                    style: TextStyle(fontSize: 9, color: _getTcpStateColor(conn.state)),
                  ),
                ),
              ],
            ),
          )),
        ],
      ],
    );
  }

  Color _getTcpStateColor(TcpState state) {
    switch (state) {
      case TcpState.closed:
        return AppTheme.textSecondary;
      case TcpState.listen:
        return AppTheme.success;
      case TcpState.synSent:
      case TcpState.synReceived:
        return AppTheme.warning;
      case TcpState.established:
        return AppTheme.info;
      case TcpState.finWait1:
      case TcpState.finWait2:
      case TcpState.closeWait:
      case TcpState.closing:
      case TcpState.lastAck:
        return AppTheme.warning;
      case TcpState.timeWait:
        return AppTheme.secondary;
    }
  }

  // --- Log Console ---
  Widget _buildLogConsole() {
      return Container(
          height: _logConsoleHeight,
          color: AppTheme.surface,
          width: double.infinity,
          child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                  Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                             const Text(
                               "Simulation Logs",
                               style: TextStyle(
                                 color: AppTheme.textPrimary,
                                 fontWeight: FontWeight.bold,
                               ),
                             ),
                             Text(
                               "Time: ${_simulator.currentTime.toStringAsFixed(1)} ms",
                               style: TextStyle(color: AppTheme.success),
                             ),
                          ],
                      ),
                  ),
                  const Divider(height: 1, color: AppTheme.borderSubtle),
                  Expanded(
                      child: ListView.builder(
                          padding: const EdgeInsets.all(8),
                          itemCount: _simulator.logs.length,
                          // reverse: true, // Show new at bottom? usually yes.
                          // But our logs are added to end. So auto scroll isbetter.
                          itemBuilder: (context, index) {
                              // Show latest at bottom, so iterate normally.
                              // Reverse the list view?
                              // Let's show latest at top for easier reading without scroll?
                              // Or standard terminal style.
                              final log = _simulator.logs[_simulator.logs.length - 1 - index];
                              return Text(
                                log,
                                style: const TextStyle(
                                  color: AppTheme.textSecondary,
                                  fontFamily: 'monospace',
                                  fontSize: 12,
                                ),
                              );
                          },
                      ),
                  )
              ],
          ),
      );
  }
}

// 节点组件
class DraggableNetworkNode extends StatelessWidget {
  final NetworkDevice device;
  final bool isSelected;
  final bool isLinkingMode;
  final VoidCallback onTap;
  final VoidCallback onDoubleTap;
  final Function(Offset delta, Offset globalPosition) onDragUpdate;
  final Function(Offset dropPosition) onDragEnd;

  const DraggableNetworkNode({
    Key? key,
    required this.device,
    required this.isSelected,
    this.isLinkingMode = false,
    required this.onTap,
    required this.onDoubleTap,
    required this.onDragUpdate,
    required this.onDragEnd,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      onDoubleTap: onDoubleTap,
      onPanUpdate: (details) {
        onDragUpdate(details.delta, details.globalPosition);
      },
      onPanEnd: (details) {
          onDragEnd(Offset.zero); // Position logic moved to parent via state tracking
      },
      child: Container(
        width: 60,
        height: 60,
        decoration: BoxDecoration(
          color: AppTheme.surface,
          shape: BoxShape.circle,
          border: Border.all(
            color: isSelected ? AppTheme.primary : AppTheme.borderStrong,
            width: isSelected ? 3 : 1,
          ),
          boxShadow: [
            BoxShadow(
                blurRadius: 5, 
                color: isLinkingMode
                    ? AppTheme.primary.withOpacity(0.3)
                    : AppTheme.borderSubtle,
                spreadRadius: isLinkingMode ? 2 : 0,
            )
          ],
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              device is net_impl.Router ? Icons.router : Icons.computer,
              color: device is net_impl.Router
                  ? AppTheme.warning
                  : AppTheme.primary,
            ),
            Text(
              device.name,
              style: const TextStyle(fontSize: 10),
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }
}

// 连线绘制器
class TopologyLinkPainter extends CustomPainter {
  final List<NetworkDevice> devices;
  final List<NetworkLink> links;
  final String? linkingSourceId;
  final Offset dragPosition;

  TopologyLinkPainter({
    required this.devices,
    required this.links,
    this.linkingSourceId,
    this.dragPosition = Offset.zero,
  }) : super(repaint: NetworkSimulator());

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = AppTheme.borderStrong
      ..strokeWidth = 2;

    // 绘制已存在的连接
    for (var link in links) {
      final dev1 = link.interface1.device;
      final dev2 = link.interface2.device;
      
      // Center of device (assuming 60x60 size)
      final p1 = Offset(dev1.x + 30, dev1.y + 30);
      final p2 = Offset(dev2.x + 30, dev2.y + 30);
      
      canvas.drawLine(p1, p2, paint);
      
      // 绘制数据包动画
      final currentTime = NetworkSimulator().currentTime;
      for (var transmission in link.activeTransmissions) {
          // Progress 0.0 -> 1.0
          double t = (currentTime - transmission.startTime) / (transmission.endTime - transmission.startTime);
          if (t < 0) t = 0;
          if (t > 1) t = 1;
          
          Offset startPos = p1;
          Offset endPos = p2;
          
          // Determine direction
          if (transmission.sourceDetails.device == dev2) {
             startPos = p2;
             endPos = p1;
          }
          
          final currentPos = Offset.lerp(startPos, endPos, t)!;
          
          // Draw Packet
          final packetPaint = Paint()..color = AppTheme.secondary;
          canvas.drawCircle(currentPos, 6, packetPaint);
          
          // Optional: Label
          // final textSpan = TextSpan(text: "IP", style: TextStyle(color: Colors.white, fontSize: 8));
          // final textPainter = TextPainter(text: textSpan, textDirection: TextDirection.ltr);
          // textPainter.layout();
          // textPainter.paint(canvas, currentPos - Offset(4, 4));
      }
    }

    // 绘制正在拖拽的连接
    if (linkingSourceId != null) {
      try {
        final source = devices.firstWhere((d) => d.id == linkingSourceId);
        final pStart = Offset(source.x + 30, source.y + 30);
        
        final dashPaint = Paint()
          ..color = AppTheme.primary
          ..strokeWidth = 2
          ..style = PaintingStyle.stroke;
          
        canvas.drawLine(pStart, dragPosition, dashPaint);
      } catch (e) {
        // ignore
      }
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => true;
}
