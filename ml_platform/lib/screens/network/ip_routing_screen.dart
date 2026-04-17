import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:ml_platform/config/app_theme.dart';
import 'package:ml_platform/utils/responsive_layout.dart';
import 'package:ml_platform/widgets/common/responsive_container.dart';
import '../../models/network/ip_models.dart';
import '../../services/network/ip_routing_service.dart';

/// IP数据包路由可视化界面
class IpRoutingScreen extends StatefulWidget {
  const IpRoutingScreen({Key? key}) : super(key: key);

  @override
  State<IpRoutingScreen> createState() => _IpRoutingScreenState();
}

class _IpRoutingScreenState extends State<IpRoutingScreen>
    with TickerProviderStateMixin {
  // 网络拓扑
  late Map<String, NetworkNode> _nodes;
  late List<NetworkLink> _links;
  
  // 路由事件
  List<RoutingEvent> _events = [];
  int _currentEventIndex = -1;
  
  // 动画控制
  AnimationController? _packetAnimationController;
  Animation<double>? _packetAnimation;
  IpPacket? _currentPacket;
  String? _animatingFromNode;
  String? _animatingToNode;
  
  // 播放控制
  bool _isPlaying = false;
  Timer? _playbackTimer;
  
  // UI控制
  final ScrollController _logScrollController = ScrollController();
  String? _selectedNodeId;
  RoutingEntry? _highlightedEntry;
  
  // 输入控制器
  final TextEditingController _sourceIpController = 
      TextEditingController(text: '192.168.1.10');
  final TextEditingController _destinationIpController = 
      TextEditingController(text: '192.168.3.20');
  final TextEditingController _ttlController = 
      TextEditingController(text: '64');

  @override
  void initState() {
    super.initState();
    _initializeTopology();
  }

  @override
  void dispose() {
    _packetAnimationController?.dispose();
    _playbackTimer?.cancel();
    _logScrollController.dispose();
    _sourceIpController.dispose();
    _destinationIpController.dispose();
    _ttlController.dispose();
    super.dispose();
  }

  /// 初始化网络拓扑
  void _initializeTopology() {
    final topology = IpRoutingService.createDefaultTopology();
    setState(() {
      _nodes = topology['nodes'];
      _links = topology['links'];
      _currentEventIndex = -1;
      _events = [];
      _currentPacket = null;
    });
  }

  /// 开始路由模拟
  void _startRouting() {
    final sourceIp = _sourceIpController.text.trim();
    final destinationIp = _destinationIpController.text.trim();
    final ttl = int.tryParse(_ttlController.text) ?? 64;
    
    if (sourceIp.isEmpty || destinationIp.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('请输入源IP和目标IP')),
      );
      return;
    }
    
    setState(() {
      _events = IpRoutingService.generateRoutingEvents(
        sourceIp: sourceIp,
        destinationIp: destinationIp,
        nodes: _nodes,
        initialTTL: ttl,
      );
      _currentEventIndex = -1;
      _currentPacket = null;
      _isPlaying = true;
    });
    
    _playNextEvent();
  }

  /// 开始Traceroute
  void _startTraceroute() {
    final sourceIp = _sourceIpController.text.trim();
    final destinationIp = _destinationIpController.text.trim();
    
    setState(() {
      _events = IpRoutingService.generateTracerouteEvents(
        sourceIp: sourceIp,
        destinationIp: destinationIp,
        nodes: _nodes,
      );
      _currentEventIndex = -1;
      _currentPacket = null;
      _isPlaying = true;
    });
    
    _playNextEvent();
  }

  /// 播放下一个事件
  void _playNextEvent() {
    if (!_isPlaying || _currentEventIndex >= _events.length - 1) {
      setState(() {
        _isPlaying = false;
      });
      return;
    }
    
    _currentEventIndex++;
    final event = _events[_currentEventIndex];
    
    // 处理事件
    _handleEvent(event);
    
    // 滚动日志
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_logScrollController.hasClients) {
        _logScrollController.animateTo(
          _logScrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
    
    // 安排下一个事件
    _playbackTimer = Timer(
      Duration(milliseconds: event.delay ?? 500),
      _playNextEvent,
    );
  }

  /// 处理事件
  void _handleEvent(RoutingEvent event) {
    setState(() {
      _selectedNodeId = event.nodeId;
      
      // 更新当前数据包
      if (event.packet != null) {
        _currentPacket = event.packet;
      }
      
      // 高亮路由表条目
      if (event.routingEntry != null) {
        _highlightedEntry = event.routingEntry;
      } else {
        _highlightedEntry = null;
      }
      
      // 处理数据包转发动画
      if (event.type == 'packet_forward') {
        _animatePacketTransfer(event.nodeId);
      }
    });
  }

  /// 动画显示数据包传输
  void _animatePacketTransfer(String fromNodeId) {
    if (_currentEventIndex < _events.length - 1) {
      // 查找下一个节点
      for (int i = _currentEventIndex + 1; i < _events.length; i++) {
        final nextEvent = _events[i];
        if (nextEvent.type == 'packet_arrive') {
          _startPacketAnimation(fromNodeId, nextEvent.nodeId);
          break;
        }
      }
    }
  }

  /// 开始数据包动画
  void _startPacketAnimation(String fromId, String toId) {
    _packetAnimationController?.dispose();
    
    _packetAnimationController = AnimationController(
      duration: const Duration(milliseconds: 600),
      vsync: this,
    );
    
    _packetAnimation = Tween<double>(
      begin: 0.0,
      end: 1.0,
    ).animate(CurvedAnimation(
      parent: _packetAnimationController!,
      curve: Curves.easeInOut,
    ));
    
    setState(() {
      _animatingFromNode = fromId;
      _animatingToNode = toId;
    });
    
    _packetAnimationController!.forward().then((_) {
      setState(() {
        _animatingFromNode = null;
        _animatingToNode = null;
      });
    });
  }

  /// 停止模拟
  void _stopSimulation() {
    _playbackTimer?.cancel();
    setState(() {
      _isPlaying = false;
      _currentEventIndex = -1;
      _events = [];
      _currentPacket = null;
      _selectedNodeId = null;
      _highlightedEntry = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
          tooltip: '返回',
        ),
        title: const Text('IP数据包路由模拟'),
        centerTitle: true,
      ),
      body: ResponsiveContainer(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: ResponsiveLayout(
          mobile: ListView(
            children: [
              _buildControlPanel(),
              const SizedBox(height: AppSpacing.md),
              SizedBox(height: 360, child: _buildTopologyView()),
              const SizedBox(height: AppSpacing.md),
              SizedBox(height: 300, child: _buildEventLogPanel()),
            ],
          ),
          tablet: _buildDesktopLayout(),
          desktop: _buildDesktopLayout(),
        ),
      ),
    );
  }

  Widget _buildDesktopLayout() {
    return Column(
      children: [
        _buildControlPanel(),
        const SizedBox(height: AppSpacing.md),
        Expanded(
          child: Row(
            children: [
              Expanded(flex: 3, child: _buildTopologyView()),
              const SizedBox(width: AppSpacing.md),
              Expanded(flex: 1, child: _buildEventLogPanel()),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildControlPanel() {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(12),
        boxShadow: AppShadows.soft,
      ),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _sourceIpController,
                  decoration: const InputDecoration(
                    labelText: '源IP地址',
                    hintText: '192.168.1.10',
                    border: OutlineInputBorder(),
                    contentPadding: EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 8,
                    ),
                  ),
                  enabled: !_isPlaying,
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: TextField(
                  controller: _destinationIpController,
                  decoration: const InputDecoration(
                    labelText: '目标IP地址',
                    hintText: '192.168.3.20',
                    border: OutlineInputBorder(),
                    contentPadding: EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 8,
                    ),
                  ),
                  enabled: !_isPlaying,
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              SizedBox(
                width: 100,
                child: TextField(
                  controller: _ttlController,
                  decoration: const InputDecoration(
                    labelText: 'TTL',
                    hintText: '64',
                    border: OutlineInputBorder(),
                    contentPadding: EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 8,
                    ),
                  ),
                  keyboardType: TextInputType.number,
                  enabled: !_isPlaying,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              ElevatedButton.icon(
                onPressed: _isPlaying ? null : _startRouting,
                icon: const Icon(Icons.send),
                label: const Text('发送数据包'),
              ),
              const SizedBox(width: AppSpacing.md),
              ElevatedButton.icon(
                onPressed: _isPlaying ? null : _startTraceroute,
                icon: const Icon(Icons.radar),
                label: const Text('Traceroute'),
              ),
              const SizedBox(width: AppSpacing.md),
              ElevatedButton.icon(
                onPressed: _isPlaying ? _stopSimulation : null,
                icon: const Icon(Icons.stop),
                label: const Text('停止'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppTheme.error,
                  foregroundColor: AppTheme.textPrimary,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildTopologyView() {
    return Container(
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Stack(
        children: [
          CustomPaint(
            painter: NetworkTopologyPainter(
              nodes: _nodes,
              links: _links,
              selectedNodeId: _selectedNodeId,
              currentPacket: _currentPacket,
              animatingFromNode: _animatingFromNode,
              animatingToNode: _animatingToNode,
              animationProgress: _packetAnimation?.value ?? 0,
            ),
            size: Size.infinite,
          ),
          ..._nodes.entries.map((entry) {
            final node = entry.value;
            return Positioned(
              left: node.x - 40,
              top: node.y - 40,
              child: _buildNodeWidget(node),
            );
          }).toList(),
          if (_currentPacket != null)
            Positioned(
              top: 16,
              left: 16,
              child: _buildPacketInfo(_currentPacket!),
            ),
        ],
      ),
    );
  }

  Widget _buildEventLogPanel() {
    return Container(
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(AppSpacing.md),
            decoration: const BoxDecoration(
              color: AppTheme.surfaceHighlight,
              border: Border(
                bottom: BorderSide(color: AppTheme.borderSubtle),
              ),
            ),
            child: Text(
              '路由事件日志',
              style: Theme.of(context).textTheme.headlineMedium,
            ),
          ),
          Expanded(
            child: ListView.builder(
              controller: _logScrollController,
              padding: const EdgeInsets.all(AppSpacing.md),
              itemCount: _currentEventIndex + 1,
              itemBuilder: (context, index) {
                if (index >= _events.length) {
                  return const SizedBox.shrink();
                }
                final event = _events[index];
                return _buildEventLogEntry(event, index);
              },
            ),
          ),
        ],
      ),
    );
  }

  /// 构建节点组件
  Widget _buildNodeWidget(NetworkNode node) {
    final isSelected = node.id == _selectedNodeId;
    final color = node.isHost ? AppTheme.primary : AppTheme.success;
    
    return GestureDetector(
      onTap: () {
        setState(() {
          _selectedNodeId = node.id;
        });
      },
      child: Column(
        children: [
          Container(
            width: 80,
            height: 80,
            decoration: BoxDecoration(
              color: isSelected ? color.withOpacity(0.2) : AppTheme.surface,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                color: isSelected ? color : AppTheme.borderStrong,
                width: isSelected ? 2 : 1,
              ),
              boxShadow: AppShadows.soft,
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  node.isHost ? Icons.computer : Icons.router,
                  color: color,
                  size: 32,
                ),
                const SizedBox(height: 4),
                Text(
                  node.name,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        fontWeight: FontWeight.bold,
                        color: AppTheme.textPrimary,
                      ),
                ),
                Text(
                  node.ipAddress,
                  style: TextStyle(
                    fontSize: 10,
                    color: AppTheme.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          // 路由表（仅路由器）
          if (node.isRouter && node.routingTable != null && isSelected)
            Container(
              margin: const EdgeInsets.only(top: 8),
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: AppTheme.surface,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppTheme.borderSubtle),
                boxShadow: AppShadows.soft,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    '路由表',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 4),
                  ...node.routingTable!.entries.map((entry) {
                    final isHighlighted = entry == _highlightedEntry;
                    return Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 4,
                        vertical: 2,
                      ),
                      margin: const EdgeInsets.only(bottom: 2),
                      decoration: BoxDecoration(
                        color: isHighlighted
                            ? AppTheme.warning.withOpacity(0.3)
                            : Colors.transparent,
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        entry.displayText,
                        style: TextStyle(
                          fontSize: 9,
                          fontWeight: isHighlighted
                              ? FontWeight.bold
                              : FontWeight.normal,
                        ),
                      ),
                    );
                  }).toList(),
                ],
              ),
            ),
        ],
      ),
    );
  }

  /// 构建数据包信息
  Widget _buildPacketInfo(IpPacket packet) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(8),
        boxShadow: AppShadows.soft,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'IP数据包',
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              const Icon(Icons.label, size: 14, color: AppTheme.textSecondary),
              const SizedBox(width: 4),
              Text(
                'ID: #${packet.id}',
                style: const TextStyle(fontSize: 12),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              const Icon(Icons.upload, size: 14, color: AppTheme.primary),
              const SizedBox(width: 4),
              Text(
                'Source: ${packet.sourceIp}',
                style: const TextStyle(fontSize: 12),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              const Icon(Icons.download, size: 14, color: AppTheme.success),
              const SizedBox(width: 4),
              Text(
                'Dest: ${packet.destinationIp}',
                style: const TextStyle(fontSize: 12),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              Icon(
                Icons.timer,
                size: 14,
                color: packet.ttl <= 5 ? AppTheme.error : AppTheme.warning,
              ),
              const SizedBox(width: 4),
              Text(
                'TTL: ${packet.ttl}',
                style: TextStyle(
                  fontSize: 12,
                  color: packet.ttl <= 5 ? AppTheme.error : AppTheme.textPrimary,
                  fontWeight: packet.ttl <= 5 ? FontWeight.bold : FontWeight.normal,
                ),
              ),
            ],
          ),
          if (packet.data != null) ...[
            const SizedBox(height: 4),
            Row(
              children: [
                const Icon(Icons.message, size: 14, color: AppTheme.textSecondary),
                const SizedBox(width: 4),
                Expanded(
                  child: Text(
                    'Data: ${packet.data}',
                    style: const TextStyle(fontSize: 12),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  /// 构建事件日志条目
  Widget _buildEventLogEntry(RoutingEvent event, int index) {
    IconData icon;
    Color iconColor;
    
    switch (event.type) {
      case 'packet_created':
        icon = Icons.add_circle;
        iconColor = AppTheme.primary;
        break;
      case 'encapsulation':
        icon = Icons.wrap_text;
        iconColor = AppTheme.secondary;
        break;
      case 'routing_lookup':
        icon = Icons.search;
        iconColor = AppTheme.warning;
        break;
      case 'route_found':
        icon = Icons.check_circle;
        iconColor = AppTheme.success;
        break;
      case 'packet_forward':
        icon = Icons.send;
        iconColor = AppTheme.primary;
        break;
      case 'packet_arrive':
        icon = Icons.download;
        iconColor = AppTheme.success;
        break;
      case 'ttl_decrement':
        icon = Icons.remove_circle;
        iconColor = AppTheme.warning;
        break;
      case 'ttl_exceeded':
        icon = Icons.warning;
        iconColor = AppTheme.error;
        break;
      case 'decapsulation':
        icon = Icons.unfold_more;
        iconColor = AppTheme.secondary;
        break;
      case 'delivery_success':
        icon = Icons.check_circle;
        iconColor = AppTheme.success;
        break;
      case 'delivery_failed':
        icon = Icons.error;
        iconColor = AppTheme.error;
        break;
      default:
        icon = Icons.info;
        iconColor = AppTheme.textSecondary;
    }
    
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: index == _currentEventIndex
            ? AppTheme.primary.withOpacity(0.1)
            : Colors.transparent,
        borderRadius: BorderRadius.circular(4),
        border: Border(
          left: BorderSide(
            color: index == _currentEventIndex
                ? AppTheme.primary
                : Colors.transparent,
            width: 3,
          ),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 16, color: iconColor),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  event.description,
                  style: const TextStyle(fontSize: 12),
                ),
                if (event.routingEntry != null) ...[
                  const SizedBox(height: 4),
                  Container(
                    padding: const EdgeInsets.all(4),
                    decoration: BoxDecoration(
                      color: AppTheme.warning.withOpacity(0.2),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      event.routingEntry!.displayText,
                      style: const TextStyle(
                        fontSize: 11,
                        fontFamily: 'monospace',
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// 网络拓扑绘制器
class NetworkTopologyPainter extends CustomPainter {
  final Map<String, NetworkNode> nodes;
  final List<NetworkLink> links;
  final String? selectedNodeId;
  final IpPacket? currentPacket;
  final String? animatingFromNode;
  final String? animatingToNode;
  final double animationProgress;

  NetworkTopologyPainter({
    required this.nodes,
    required this.links,
    this.selectedNodeId,
    this.currentPacket,
    this.animatingFromNode,
    this.animatingToNode,
    this.animationProgress = 0,
  });

  @override
  void paint(Canvas canvas, Size size) {
    // 绘制连接线
    final linkPaint = Paint()
      ..color = AppTheme.borderStrong
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke;

    for (final link in links) {
      final node1 = nodes[link.node1Id];
      final node2 = nodes[link.node2Id];
      
      if (node1 != null && node2 != null) {
        canvas.drawLine(
          Offset(node1.x, node1.y),
          Offset(node2.x, node2.y),
          linkPaint,
        );
        
        // 绘制连接线标签
        final midX = (node1.x + node2.x) / 2;
        final midY = (node1.y + node2.y) / 2;
        
        final textPainter = TextPainter(
          text: TextSpan(
            text: '${link.bandwidth}Mbps',
            style: TextStyle(
              fontSize: 10,
              color: AppTheme.textSecondary,
            ),
          ),
          textDirection: TextDirection.ltr,
        );
        textPainter.layout();
        textPainter.paint(
          canvas,
          Offset(midX - textPainter.width / 2, midY - 15),
        );
      }
    }

    // 绘制动画数据包
    if (animatingFromNode != null && animatingToNode != null) {
      final fromNode = nodes[animatingFromNode];
      final toNode = nodes[animatingToNode];
      
      if (fromNode != null && toNode != null) {
        final x = fromNode.x + (toNode.x - fromNode.x) * animationProgress;
        final y = fromNode.y + (toNode.y - fromNode.y) * animationProgress;
        
        final packetPaint = Paint()
          ..color = AppTheme.warning
          ..style = PaintingStyle.fill;
        
        canvas.drawCircle(
          Offset(x, y),
          8,
          packetPaint,
        );
        
        // 绘制数据包标签
        if (currentPacket != null) {
          final textPainter = TextPainter(
            text: TextSpan(
              text: 'TTL:${currentPacket!.ttl}',
              style: const TextStyle(
                fontSize: 9,
                color: AppTheme.textPrimary,
                fontWeight: FontWeight.bold,
              ),
            ),
            textDirection: TextDirection.ltr,
          );
          textPainter.layout();
          textPainter.paint(
            canvas,
            Offset(x - textPainter.width / 2, y - 4),
          );
        }
      }
    }
  }

  @override
  bool shouldRepaint(NetworkTopologyPainter oldDelegate) {
    return true;
  }
}
