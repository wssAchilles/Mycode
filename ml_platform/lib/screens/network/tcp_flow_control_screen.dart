import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'dart:async';
import 'dart:math' as math;
import 'package:ml_platform/config/app_theme.dart';
import 'package:ml_platform/utils/responsive_layout.dart';
import 'package:ml_platform/widgets/common/responsive_container.dart';

/// TCP流量控制模拟界面
class TcpFlowControlScreen extends StatefulWidget {
  const TcpFlowControlScreen({Key? key}) : super(key: key);

  @override
  State<TcpFlowControlScreen> createState() => _TcpFlowControlScreenState();
}

class _TcpFlowControlScreenState extends State<TcpFlowControlScreen>
    with TickerProviderStateMixin {
  // 滑动窗口参数
  int _senderWindowSize = 10;
  int _receiverWindowSize = 10;
  int _currentSenderWindow = 0;
  int _currentReceiverWindow = 10;
  
  // 拥塞控制参数
  double _cwnd = 1.0; // 拥塞窗口
  double _ssthresh = 16.0; // 慢启动阈值
  String _congestionState = 'Slow Start'; // 拥塞状态
  
  // 数据传输参数
  final List<DataPacket> _sentPackets = [];
  final List<DataPacket> _ackedPackets = [];
  final List<DataPacket> _inFlightPackets = [];
  int _nextSeqNum = 0;
  int _lastAckNum = 0;
  
  // 网络参数
  double _networkDelay = 100; // ms
  double _packetLossRate = 0.05; // 5%
  
  // 动画和控制
  bool _isRunning = false;
  Timer? _simulationTimer;
  final List<String> _logs = [];
  final ScrollController _logScrollController = ScrollController();
  
  // 统计数据
  int _totalSent = 0;
  int _totalAcked = 0;
  int _totalLost = 0;
  int _totalRetransmitted = 0;
  double _throughput = 0;

  @override
  void initState() {
    super.initState();
  }

  @override
  void dispose() {
    _simulationTimer?.cancel();
    _logScrollController.dispose();
    super.dispose();
  }

  void _startSimulation() {
    setState(() {
      _isRunning = true;
      _logs.clear();
      _resetStatistics();
    });
    
    _addLog('开始TCP流量控制模拟');
    _addLog('初始拥塞窗口: $_cwnd MSS');
    _addLog('慢启动阈值: $_ssthresh MSS');
    
    _simulationTimer = Timer.periodic(const Duration(milliseconds: 500), (timer) {
      if (!_isRunning) {
        timer.cancel();
        return;
      }
      
      _simulateTransmission();
    });
  }

  void _stopSimulation() {
    setState(() {
      _isRunning = false;
    });
    _simulationTimer?.cancel();
    _addLog('模拟停止');
  }

  void _resetSimulation() {
    _stopSimulation();
    setState(() {
      _sentPackets.clear();
      _ackedPackets.clear();
      _inFlightPackets.clear();
      _nextSeqNum = 0;
      _lastAckNum = 0;
      _cwnd = 1.0;
      _ssthresh = 16.0;
      _congestionState = 'Slow Start';
      _currentSenderWindow = 0;
      _currentReceiverWindow = _receiverWindowSize;
      _logs.clear();
      _resetStatistics();
    });
    _addLog('模拟重置');
  }

  void _resetStatistics() {
    _totalSent = 0;
    _totalAcked = 0;
    _totalLost = 0;
    _totalRetransmitted = 0;
    _throughput = 0;
  }

  void _simulateTransmission() {
    // 发送数据包（基于拥塞窗口和接收窗口）
    int canSend = math.min(
      _cwnd.floor() - _inFlightPackets.length,
      _currentReceiverWindow,
    );
    
    if (canSend > 0) {
      for (int i = 0; i < canSend && i < 3; i++) {
        _sendPacket();
      }
    }
    
    // 模拟ACK接收
    _receiveAcks();
    
    // 更新拥塞控制状态
    _updateCongestionControl();
    
    // 检测超时重传
    _checkTimeouts();
    
    // 更新统计
    _updateStatistics();
  }

  void _sendPacket() {
    final packet = DataPacket(
      seqNum: _nextSeqNum,
      timestamp: DateTime.now(),
      size: 1460, // MSS
    );
    
    setState(() {
      _sentPackets.add(packet);
      _inFlightPackets.add(packet);
      _nextSeqNum++;
      _totalSent++;
      _currentSenderWindow++;
    });
    
    _addLog('发送数据包: SEQ=${packet.seqNum}');
  }

  void _receiveAcks() {
    if (_inFlightPackets.isEmpty) return;
    
    // 模拟网络延迟后的ACK
    final now = DateTime.now();
    final acksToProcess = <DataPacket>[];
    
    for (final packet in _inFlightPackets) {
      final elapsed = now.difference(packet.timestamp).inMilliseconds;
      if (elapsed > _networkDelay) {
        // 模拟丢包
        if (math.Random().nextDouble() > _packetLossRate) {
          acksToProcess.add(packet);
        } else {
          setState(() {
            _totalLost++;
          });
          _addLog('丢包: SEQ=${packet.seqNum}', isError: true);
        }
      }
    }
    
    for (final packet in acksToProcess) {
      setState(() {
        _inFlightPackets.remove(packet);
        _ackedPackets.add(packet);
        _lastAckNum = packet.seqNum + 1;
        _totalAcked++;
        _currentSenderWindow--;
        _currentReceiverWindow = math.min(
          _receiverWindowSize,
          _currentReceiverWindow + 1,
        );
      });
      
      _addLog('收到ACK: ACK=${packet.seqNum + 1}', isSuccess: true);
      
      // 更新拥塞窗口
      _updateCwndOnAck();
    }
  }

  void _updateCwndOnAck() {
    setState(() {
      if (_congestionState == 'Slow Start') {
        _cwnd += 1; // 指数增长
        if (_cwnd >= _ssthresh) {
          _congestionState = 'Congestion Avoidance';
          _addLog('进入拥塞避免阶段');
        }
      } else if (_congestionState == 'Congestion Avoidance') {
        _cwnd += 1.0 / _cwnd; // 线性增长
      }
    });
  }

  void _updateCongestionControl() {
    // 检测是否需要进入快速恢复
    int duplicateAcks = 0;
    if (_ackedPackets.isNotEmpty) {
      final lastAck = _ackedPackets.last.seqNum;
      duplicateAcks = _ackedPackets
          .where((p) => p.seqNum == lastAck)
          .length;
    }
    
    if (duplicateAcks >= 3 && _congestionState != 'Fast Recovery') {
      setState(() {
        _ssthresh = _cwnd / 2;
        _cwnd = _ssthresh + 3;
        _congestionState = 'Fast Recovery';
      });
      _addLog('检测到3个重复ACK，进入快速恢复', isWarning: true);
    }
  }

  void _checkTimeouts() {
    final now = DateTime.now();
    final timedOutPackets = <DataPacket>[];
    
    for (final packet in _inFlightPackets) {
      if (now.difference(packet.timestamp).inMilliseconds > _networkDelay * 4) {
        timedOutPackets.add(packet);
      }
    }
    
    if (timedOutPackets.isNotEmpty) {
      setState(() {
        // 超时处理：进入慢启动
        _ssthresh = _cwnd / 2;
        _cwnd = 1;
        _congestionState = 'Slow Start';
        
        for (final packet in timedOutPackets) {
          _inFlightPackets.remove(packet);
          _totalRetransmitted++;
        }
      });
      
      _addLog('超时重传，重置拥塞窗口', isError: true);
    }
  }

  void _updateStatistics() {
    setState(() {
      if (_totalSent > 0) {
        _throughput = (_totalAcked / _totalSent) * 100;
      }
    });
  }

  void _addLog(String message, {bool isError = false, bool isSuccess = false, bool isWarning = false}) {
    setState(() {
      final timestamp = DateTime.now().toString().substring(11, 19);
      _logs.add('[$timestamp] $message');
    });
    
    // 自动滚动到底部
    Future.delayed(const Duration(milliseconds: 100), () {
      if (_logScrollController.hasClients) {
        _logScrollController.animateTo(
          _logScrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
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
        title: const Text('TCP流量控制模拟'),
        centerTitle: true,
        actions: [
          IconButton(
            icon: const Icon(Icons.help_outline),
            onPressed: _showHelp,
            tooltip: '帮助',
          ),
        ],
      ),
      body: ResponsiveContainer(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: ResponsiveLayout(
          mobile: ListView(
            children: [
              _buildSlidingWindowVisualization(height: 260),
              const SizedBox(height: AppSpacing.md),
              _buildCongestionControlChart(height: 260),
              const SizedBox(height: AppSpacing.md),
              _buildControlPanel(),
              const SizedBox(height: AppSpacing.md),
              _buildParameterPanel(),
              const SizedBox(height: AppSpacing.md),
              _buildStatisticsPanel(),
              const SizedBox(height: AppSpacing.md),
              _buildLogPanel(height: 320),
            ],
          ),
          tablet: _buildDesktopLayout(),
          desktop: _buildDesktopLayout(),
        ),
      ),
    );
  }

  Widget _buildDesktopLayout() {
    return Row(
      children: [
        Expanded(
          flex: 3,
          child: Column(
            children: [
              Expanded(child: _buildSlidingWindowVisualization()),
              Expanded(child: _buildCongestionControlChart()),
              _buildControlPanel(),
            ],
          ),
        ),
        Expanded(
          flex: 2,
          child: Column(
            children: [
              _buildParameterPanel(),
              _buildStatisticsPanel(),
              Expanded(child: _buildLogPanel()),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildSlidingWindowVisualization({double? height}) {
    final content = Card(
      margin: const EdgeInsets.all(8),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '滑动窗口状态',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
            ),
            const SizedBox(height: 16),
            _buildWindowDisplay(
              '发送方',
              _senderWindowSize,
              _currentSenderWindow,
              AppTheme.primary,
            ),
            const SizedBox(height: 16),
            _buildWindowDisplay(
              '接收方',
              _receiverWindowSize,
              _currentReceiverWindow,
              AppTheme.success,
            ),
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildPacketStatus('已发送', _sentPackets.length, AppTheme.primary),
                _buildPacketStatus('已确认', _ackedPackets.length, AppTheme.success),
                _buildPacketStatus('传输中', _inFlightPackets.length, AppTheme.warning),
              ],
            ),
          ],
        ),
      ),
    );

    return height == null ? content : SizedBox(height: height, child: content);
  }

  Widget _buildWindowDisplay(String label, int maxSize, int currentUsed, Color color) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '$label窗口 ($currentUsed/$maxSize)',
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 8),
        LinearProgressIndicator(
          value: maxSize > 0 ? currentUsed / maxSize : 0,
          minHeight: 20,
          backgroundColor: AppTheme.borderStrong,
          valueColor: AlwaysStoppedAnimation<Color>(color),
        ),
      ],
    );
  }

  Widget _buildPacketStatus(String label, int count, Color color) {
    return Column(
      children: [
        Container(
          width: 60,
          height: 60,
          decoration: BoxDecoration(
            color: color.withOpacity(0.1),
            shape: BoxShape.circle,
            border: Border.all(color: color, width: 2),
          ),
          child: Center(
            child: Text(
              count.toString(),
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.bold,
                color: color,
              ),
            ),
          ),
        ),
        const SizedBox(height: 4),
        Text(label),
      ],
    );
  }

  Widget _buildCongestionControlChart({double? height}) {
    final content = Card(
      margin: const EdgeInsets.all(8),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  '拥塞控制状态',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  decoration: BoxDecoration(
                    color: _getCongestionStateColor().withOpacity(0.1),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: _getCongestionStateColor()),
                  ),
                  child: Text(
                    _congestionState,
                    style: TextStyle(
                      color: _getCongestionStateColor(),
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Expanded(
              child: CustomPaint(
                size: Size.infinite,
                painter: CongestionWindowPainter(
                  cwnd: _cwnd,
                  ssthresh: _ssthresh,
                  maxWindow: 32,
                ),
              ),
            ),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildMetric('拥塞窗口', '${_cwnd.toStringAsFixed(1)} MSS'),
                _buildMetric('慢启动阈值', '${_ssthresh.toStringAsFixed(1)} MSS'),
              ],
            ),
          ],
        ),
      ),
    );

    return height == null ? content : SizedBox(height: height, child: content);
  }

  Widget _buildMetric(String label, String value) {
    return Column(
      children: [
        Text(
          label,
          style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12),
        ),
        Text(
          value,
          style: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.bold,
          ),
        ),
      ],
    );
  }

  Color _getCongestionStateColor() {
    switch (_congestionState) {
      case 'Slow Start':
        return AppTheme.success;
      case 'Congestion Avoidance':
        return AppTheme.primary;
      case 'Fast Recovery':
        return AppTheme.warning;
      default:
        return AppTheme.textSecondary;
    }
  }

  Widget _buildControlPanel() {
    return Card(
      margin: const EdgeInsets.all(8),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            ElevatedButton.icon(
              onPressed: _isRunning ? null : _startSimulation,
              icon: const Icon(Icons.play_arrow),
              label: const Text('开始'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.success,
              ),
            ),
            const SizedBox(width: 16),
            ElevatedButton.icon(
              onPressed: _isRunning ? _stopSimulation : null,
              icon: const Icon(Icons.stop),
              label: const Text('停止'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.error,
              ),
            ),
            const SizedBox(width: 16),
            ElevatedButton.icon(
              onPressed: _resetSimulation,
              icon: const Icon(Icons.refresh),
              label: const Text('重置'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildParameterPanel() {
    return Card(
      margin: const EdgeInsets.all(8),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '参数配置',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 12),
            // 发送窗口大小
            _buildSlider(
              '发送窗口',
              _senderWindowSize.toDouble(),
              1,
              20,
              (value) {
                setState(() {
                  _senderWindowSize = value.round();
                });
              },
            ),
            // 接收窗口大小
            _buildSlider(
              '接收窗口',
              _receiverWindowSize.toDouble(),
              1,
              20,
              (value) {
                setState(() {
                  _receiverWindowSize = value.round();
                  _currentReceiverWindow = _receiverWindowSize;
                });
              },
            ),
            // 网络延迟
            _buildSlider(
              '网络延迟',
              _networkDelay,
              10,
              500,
              (value) {
                setState(() {
                  _networkDelay = value;
                });
              },
              suffix: 'ms',
            ),
            // 丢包率
            _buildSlider(
              '丢包率',
              _packetLossRate * 100,
              0,
              20,
              (value) {
                setState(() {
                  _packetLossRate = value / 100;
                });
              },
              suffix: '%',
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSlider(
    String label,
    double value,
    double min,
    double max,
    ValueChanged<double> onChanged, {
    String suffix = '',
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(label),
            Text(
              '${value.toStringAsFixed(0)}$suffix',
              style: const TextStyle(fontWeight: FontWeight.bold),
            ),
          ],
        ),
        Slider(
          value: value,
          min: min,
          max: max,
          onChanged: _isRunning ? null : onChanged,
        ),
      ],
    );
  }

  Widget _buildStatisticsPanel() {
    return Card(
      margin: const EdgeInsets.all(8),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '统计信息',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 12),
            _buildStatRow('总发送', _totalSent.toString()),
            _buildStatRow('已确认', _totalAcked.toString()),
            _buildStatRow('丢包数', _totalLost.toString()),
            _buildStatRow('重传数', _totalRetransmitted.toString()),
            _buildStatRow('吞吐率', '${_throughput.toStringAsFixed(1)}%'),
          ],
        ),
      ),
    );
  }

  Widget _buildStatRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label),
          Text(
            value,
            style: const TextStyle(fontWeight: FontWeight.bold),
          ),
        ],
      ),
    );
  }

  Widget _buildLogPanel({double? height}) {
    final content = Card(
      margin: const EdgeInsets.all(8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: const BoxDecoration(
              color: AppTheme.surfaceHighlight,
              border: Border(
                bottom: BorderSide(color: AppTheme.borderSubtle),
              ),
            ),
            child: Row(
              children: [
                const Icon(Icons.terminal, color: AppTheme.primary, size: 20),
                const SizedBox(width: 8),
                Text(
                  '执行日志',
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                ),
              ],
            ),
          ),
          Expanded(
            child: ListView.builder(
              controller: _logScrollController,
              padding: const EdgeInsets.all(8),
              itemCount: _logs.length,
              itemBuilder: (context, index) {
                final log = _logs[index];
                Color textColor = AppTheme.textSecondary;

                if (log.contains('错误') || log.contains('超时')) {
                  textColor = AppTheme.error;
                } else if (log.contains('ACK')) {
                  textColor = AppTheme.success;
                } else if (log.contains('警告') || log.contains('重复')) {
                  textColor = AppTheme.warning;
                }

                return Padding(
                  padding: const EdgeInsets.symmetric(vertical: 1),
                  child: Text(
                    log,
                    style: TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 11,
                      color: textColor,
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );

    return height == null ? content : SizedBox(height: height, child: content);
  }

  void _showHelp() {
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('TCP流量控制说明'),
          content: const SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '滑动窗口机制',
                  style: TextStyle(fontWeight: FontWeight.bold),
                ),
                SizedBox(height: 8),
                Text('• 发送窗口：控制发送方可以发送的数据量'),
                Text('• 接收窗口：控制接收方可以接收的数据量'),
                Text('• 流量控制：防止发送方发送过快'),
                SizedBox(height: 16),
                Text(
                  '拥塞控制算法',
                  style: TextStyle(fontWeight: FontWeight.bold),
                ),
                SizedBox(height: 8),
                Text('• 慢启动：拥塞窗口指数增长'),
                Text('• 拥塞避免：拥塞窗口线性增长'),
                Text('• 快速恢复：检测到丢包后快速恢复'),
                SizedBox(height: 16),
                Text(
                  'Nagle算法',
                  style: TextStyle(fontWeight: FontWeight.bold),
                ),
                SizedBox(height: 8),
                Text('• 减少小数据包的发送'),
                Text('• 提高网络利用率'),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('确定'),
            ),
          ],
        );
      },
    );
  }
}

// 数据模型
class DataPacket {
  final int seqNum;
  final DateTime timestamp;
  final int size;

  DataPacket({
    required this.seqNum,
    required this.timestamp,
    required this.size,
  });
}

// 拥塞窗口绘制器
class CongestionWindowPainter extends CustomPainter {
  final double cwnd;
  final double ssthresh;
  final double maxWindow;

  CongestionWindowPainter({
    required this.cwnd,
    required this.ssthresh,
    required this.maxWindow,
  });

  @override
  void paint(Canvas canvas, Size size) {
    // 绘制网格
    final gridPaint = Paint()
      ..color = AppTheme.borderSubtle
      ..strokeWidth = 1;

    for (int i = 0; i <= 5; i++) {
      final y = size.height * i / 5;
      canvas.drawLine(Offset(0, y), Offset(size.width, y), gridPaint);
    }

    // 绘制慢启动阈值线
    final ssthreshY = size.height * (1 - ssthresh / maxWindow);
    final ssthreshPaint = Paint()
      ..color = AppTheme.warning
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke;

    // 绘制虚线效果
    const dashWidth = 5.0;
    const dashSpace = 5.0;
    double startX = 0;
    while (startX < size.width) {
      canvas.drawLine(
        Offset(startX, ssthreshY),
        Offset(math.min(startX + dashWidth, size.width), ssthreshY),
        ssthreshPaint,
      );
      startX += dashWidth + dashSpace;
    }

    // 绘制拥塞窗口柱状图
    final cwndHeight = size.height * (cwnd / maxWindow);
    final cwndRect = Rect.fromLTWH(
      size.width * 0.3,
      size.height - cwndHeight,
      size.width * 0.4,
      cwndHeight,
    );

    final cwndPaint = Paint()
      ..color = AppTheme.primary.withOpacity(0.7)
      ..style = PaintingStyle.fill;

    canvas.drawRect(cwndRect, cwndPaint);

    // 绘制边框
    final borderPaint = Paint()
      ..color = AppTheme.primary
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke;

    canvas.drawRect(cwndRect, borderPaint);
  }

  @override
  bool shouldRepaint(CongestionWindowPainter oldDelegate) {
    return oldDelegate.cwnd != cwnd || oldDelegate.ssthresh != ssthresh;
  }
}
