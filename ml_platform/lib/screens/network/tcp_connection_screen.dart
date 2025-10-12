import 'package:flutter/material.dart';
import 'dart:async';
import '../../models/network/tcp_models.dart';
import '../../services/network/tcp_service.dart';

/// 模拟类型
enum SimulationType {
  handshake,
  teardown,
  dataTransfer,
}

/// TCP连接管理可视化界面
class TcpConnectionScreen extends StatefulWidget {
  const TcpConnectionScreen({Key? key}) : super(key: key);

  @override
  State<TcpConnectionScreen> createState() => _TcpConnectionScreenState();
}

class _TcpConnectionScreenState extends State<TcpConnectionScreen>
    with TickerProviderStateMixin {
  // 连接信息
  late TcpConnection _connection;
  
  // 当前事件索引
  int _currentEventIndex = -1;
  
  // 事件列表
  List<TcpConnectionEvent> _events = [];
  
  // 动画控制器
  AnimationController? _packetAnimationController;
  Animation<double>? _packetAnimation;
  
  // 当前动画中的数据包
  TcpPacket? _animatingPacket;
  bool _isPacketGoingRight = true;
  
  // 播放控制
  bool _isPlaying = false;
  bool _isPaused = false;
  Timer? _playbackTimer;
  
  // 滚动控制器
  final ScrollController _logScrollController = ScrollController();
  
  // 模拟类型（已移至文件顶部）
  SimulationType _simulationType = SimulationType.handshake;

  @override
  void initState() {
    super.initState();
    _connection = TcpConnection();
    _initializeSimulation();
  }

  @override
  void dispose() {
    _packetAnimationController?.dispose();
    _playbackTimer?.cancel();
    _logScrollController.dispose();
    super.dispose();
  }

  /// 初始化模拟
  void _initializeSimulation() {
    setState(() {
      _connection.reset();
      _currentEventIndex = -1;
      _isPlaying = false;
      _isPaused = false;
      _animatingPacket = null;
      
      // 根据模拟类型生成事件
      switch (_simulationType) {
        case SimulationType.handshake:
          _events = TcpService.generateHandshakeEvents();
          _connection.serverState = TcpState.CLOSED;
          _connection.clientState = TcpState.CLOSED;
          break;
        case SimulationType.teardown:
          _events = TcpService.generateTeardownEvents();
          _connection.serverState = TcpState.ESTABLISHED;
          _connection.clientState = TcpState.ESTABLISHED;
          break;
        case SimulationType.dataTransfer:
          _events = TcpService.generateDataTransferEvents();
          _connection.serverState = TcpState.ESTABLISHED;
          _connection.clientState = TcpState.ESTABLISHED;
          break;
      }
    });
  }

  /// 播放模拟
  void _playSimulation() {
    if (_currentEventIndex >= _events.length - 1) {
      _initializeSimulation();
    }
    
    setState(() {
      _isPlaying = true;
      _isPaused = false;
    });
    
    _processNextEvent();
  }

  /// 暂停模拟
  void _pauseSimulation() {
    setState(() {
      _isPaused = true;
    });
    _playbackTimer?.cancel();
  }

  /// 停止模拟
  void _stopSimulation() {
    _playbackTimer?.cancel();
    setState(() {
      _isPlaying = false;
      _isPaused = false;
    });
    _initializeSimulation();
  }

  /// 处理下一个事件
  void _processNextEvent() {
    if (!_isPlaying || _isPaused || _currentEventIndex >= _events.length - 1) {
      if (_currentEventIndex >= _events.length - 1) {
        setState(() {
          _isPlaying = false;
        });
      }
      return;
    }

    _currentEventIndex++;
    final event = _events[_currentEventIndex];
    
    // 添加事件到连接历史
    _connection.addEvent(event);
    
    // 处理事件
    _handleEvent(event);
    
    // 滚动日志到底部
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
    _playbackTimer = Timer(Duration(milliseconds: event.delay ?? 500), () {
      _processNextEvent();
    });
  }

  /// 处理事件
  void _handleEvent(TcpConnectionEvent event) {
    setState(() {
      // 处理状态变化
      if (event.type == TcpEventType.STATE_CHANGE) {
        if (event.source == 'Client' && event.newState != null) {
          _connection.clientState = event.newState!;
        } else if (event.source == 'Server' && event.newState != null) {
          _connection.serverState = event.newState!;
        }
      }
      
      // 处理数据包发送
      if (event.type == TcpEventType.SEND_PACKET && event.packet != null) {
        _animatePacket(event.packet!, event.source == 'Client');
      }
    });
  }

  /// 动画显示数据包
  void _animatePacket(TcpPacket packet, bool goingRight) {
    _packetAnimationController?.dispose();
    
    _packetAnimationController = AnimationController(
      duration: const Duration(milliseconds: 800),
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
      _animatingPacket = packet;
      _isPacketGoingRight = goingRight;
    });
    
    _packetAnimationController!.forward().then((_) {
      setState(() {
        _animatingPacket = null;
      });
    });
  }

  /// 步进到下一个事件
  void _stepNext() {
    if (_currentEventIndex < _events.length - 1) {
      _currentEventIndex++;
      final event = _events[_currentEventIndex];
      _connection.addEvent(event);
      _handleEvent(event);
      setState(() {});
      
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
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
          tooltip: '返回',
        ),
        title: const Text('TCP连接管理可视化'),
        centerTitle: true,
        actions: [
          PopupMenuButton<SimulationType>(
            icon: const Icon(Icons.science),
            onSelected: (type) {
              setState(() {
                _simulationType = type;
                _stopSimulation();
                _initializeSimulation();
              });
            },
            itemBuilder: (context) => [
              const PopupMenuItem(
                value: SimulationType.handshake,
                child: Text('三次握手'),
              ),
              const PopupMenuItem(
                value: SimulationType.teardown,
                child: Text('四次挥手'),
              ),
              const PopupMenuItem(
                value: SimulationType.dataTransfer,
                child: Text('数据传输'),
              ),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          // 主视图区域
          Expanded(
            flex: 2,
            child: Container(
              color: Colors.grey[50],
              child: Stack(
                children: [
                  // 客户端和服务器节点
                  Row(
                    children: [
                      // 客户端
                      Expanded(
                        child: _buildEndpoint(
                          'Client',
                          _connection.clientState,
                          _connection.clientAddress,
                          _connection.clientPort,
                          Icons.computer,
                          Colors.blue,
                        ),
                      ),
                      // 连接线和数据包动画
                      Expanded(
                        child: Stack(
                          alignment: Alignment.center,
                          children: [
                            // 连接线
                            Container(
                              height: 2,
                              color: Colors.grey[300],
                            ),
                            // 数据包动画
                            if (_animatingPacket != null)
                              AnimatedBuilder(
                                animation: _packetAnimation!,
                                builder: (context, child) {
                                  final progress = _packetAnimation!.value;
                                  final offset = _isPacketGoingRight
                                      ? progress * 2 - 1
                                      : 1 - progress * 2;
                                  return Transform.translate(
                                    offset: Offset(
                                      MediaQuery.of(context).size.width * 0.2 * offset,
                                      0,
                                    ),
                                    child: _buildPacketWidget(_animatingPacket!),
                                  );
                                },
                              ),
                          ],
                        ),
                      ),
                      // 服务器
                      Expanded(
                        child: _buildEndpoint(
                          'Server',
                          _connection.serverState,
                          _connection.serverAddress,
                          _connection.serverPort,
                          Icons.dns,
                          Colors.green,
                        ),
                      ),
                    ],
                  ),
                  // 标题
                  Positioned(
                    top: 16,
                    left: 0,
                    right: 0,
                    child: Center(
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 24,
                          vertical: 8,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(20),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withOpacity(0.1),
                              blurRadius: 4,
                              offset: const Offset(0, 2),
                            ),
                          ],
                        ),
                        child: Text(
                          _getSimulationTitle(),
                          style: const TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          // 控制按钮
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.05),
                  blurRadius: 4,
                  offset: const Offset(0, -2),
                ),
              ],
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                // 播放/暂停按钮
                IconButton(
                  onPressed: _isPlaying
                      ? (_isPaused ? _playSimulation : _pauseSimulation)
                      : _playSimulation,
                  icon: Icon(
                    _isPlaying
                        ? (_isPaused ? Icons.play_arrow : Icons.pause)
                        : Icons.play_arrow,
                  ),
                  iconSize: 32,
                  color: Theme.of(context).primaryColor,
                ),
                const SizedBox(width: 16),
                // 停止按钮
                IconButton(
                  onPressed: _isPlaying ? _stopSimulation : null,
                  icon: const Icon(Icons.stop),
                  iconSize: 32,
                  color: _isPlaying ? Colors.red : Colors.grey,
                ),
                const SizedBox(width: 16),
                // 步进按钮
                IconButton(
                  onPressed: !_isPlaying && _currentEventIndex < _events.length - 1
                      ? _stepNext
                      : null,
                  icon: const Icon(Icons.skip_next),
                  iconSize: 32,
                  color: !_isPlaying && _currentEventIndex < _events.length - 1
                      ? Theme.of(context).primaryColor
                      : Colors.grey,
                ),
                const SizedBox(width: 32),
                // 进度指示器
                Text(
                  '${_currentEventIndex + 1} / ${_events.length}',
                  style: const TextStyle(fontSize: 16),
                ),
              ],
            ),
          ),
          // 事件日志
          Expanded(
            flex: 1,
            child: Container(
              decoration: BoxDecoration(
                color: Colors.grey[900],
                border: Border(
                  top: BorderSide(color: Colors.grey[700]!),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding: const EdgeInsets.all(12),
                    child: const Text(
                      '事件日志',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                  Expanded(
                    child: ListView.builder(
                      controller: _logScrollController,
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      itemCount: _connection.events.length,
                      itemBuilder: (context, index) {
                        final event = _connection.events[index];
                        return _buildLogEntry(event, index);
                      },
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// 构建端点节点
  Widget _buildEndpoint(
    String name,
    TcpState state,
    String address,
    int port,
    IconData icon,
    Color color,
  ) {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        // 图标
        Container(
          width: 80,
          height: 80,
          decoration: BoxDecoration(
            color: color.withOpacity(0.1),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: color,
              width: 2,
            ),
          ),
          child: Icon(
            icon,
            size: 48,
            color: color,
          ),
        ),
        const SizedBox(height: 12),
        // 名称
        Text(
          name,
          style: const TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 4),
        // 地址
        Text(
          '$address:$port',
          style: TextStyle(
            fontSize: 12,
            color: Colors.grey[600],
          ),
        ),
        const SizedBox(height: 8),
        // 状态
        Container(
          padding: const EdgeInsets.symmetric(
            horizontal: 12,
            vertical: 6,
          ),
          decoration: BoxDecoration(
            color: Color(state.color),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Text(
            state.name,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 12,
              fontWeight: FontWeight.bold,
            ),
          ),
        ),
        const SizedBox(height: 4),
        Text(
          state.chineseDescription,
          style: TextStyle(
            fontSize: 11,
            color: Colors.grey[600],
          ),
        ),
      ],
    );
  }

  /// 构建数据包组件
  Widget _buildPacketWidget(TcpPacket packet) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: _getPacketColor(packet),
        borderRadius: BorderRadius.circular(8),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.2),
            blurRadius: 4,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            packet.flagsDescription,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.bold,
              fontSize: 14,
            ),
          ),
          if (packet.seq != null || packet.ack != null) ...[
            const SizedBox(height: 4),
            Text(
              '${packet.seq != null ? 'SEQ=${packet.seq}' : ''}'
              '${packet.seq != null && packet.ack != null ? ' ' : ''}'
              '${packet.ack != null ? 'ACK=${packet.ack}' : ''}',
              style: const TextStyle(
                color: Colors.white,
                fontSize: 11,
              ),
            ),
          ],
          if (packet.data != null) ...[
            const SizedBox(height: 4),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: Colors.white.withOpacity(0.2),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                packet.data!,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 10,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  /// 构建日志条目
  Widget _buildLogEntry(TcpConnectionEvent event, int index) {
    Color textColor = Colors.white70;
    IconData? icon;
    Color? iconColor;
    
    switch (event.type) {
      case TcpEventType.SEND_PACKET:
        icon = Icons.send;
        iconColor = Colors.blue;
        break;
      case TcpEventType.RECEIVE_PACKET:
        icon = Icons.download;
        iconColor = Colors.green;
        break;
      case TcpEventType.STATE_CHANGE:
        icon = Icons.change_circle;
        iconColor = Colors.orange;
        break;
      case TcpEventType.TIMEOUT:
        icon = Icons.timer_off;
        iconColor = Colors.red;
        break;
      case TcpEventType.ERROR:
        icon = Icons.error;
        iconColor = Colors.red;
        break;
    }
    
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: index <= _currentEventIndex
            ? Colors.white.withOpacity(0.05)
            : Colors.transparent,
        borderRadius: BorderRadius.circular(4),
        border: Border(
          left: BorderSide(
            color: index == _currentEventIndex
                ? Theme.of(context).primaryColor
                : Colors.transparent,
            width: 3,
          ),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (icon != null)
            Icon(
              icon,
              size: 16,
              color: iconColor,
            ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  event.description,
                  style: TextStyle(
                    color: textColor,
                    fontSize: 13,
                  ),
                ),
                if (event.packet != null) ...[
                  const SizedBox(height: 4),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.white.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      event.packet!.shortDescription,
                      style: TextStyle(
                        color: textColor.withOpacity(0.8),
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

  /// 获取数据包颜色
  Color _getPacketColor(TcpPacket packet) {
    if (packet.syn && packet.ack_flag) return Colors.purple;
    if (packet.syn) return Colors.blue;
    if (packet.fin) return Colors.orange;
    if (packet.rst) return Colors.red;
    if (packet.data != null) return Colors.green;
    return Colors.grey;
  }

  /// 获取模拟标题
  String _getSimulationTitle() {
    switch (_simulationType) {
      case SimulationType.handshake:
        return 'TCP 三次握手';
      case SimulationType.teardown:
        return 'TCP 四次挥手';
      case SimulationType.dataTransfer:
        return 'TCP 数据传输';
    }
  }
}
