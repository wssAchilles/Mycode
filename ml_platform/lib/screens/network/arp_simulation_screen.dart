import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../config/app_theme.dart';
import '../../utils/responsive_layout.dart';
import '../../widgets/common/responsive_container.dart';

/// ARP协议模拟界面
class ArpSimulationScreen extends StatefulWidget {
  const ArpSimulationScreen({Key? key}) : super(key: key);

  @override
  State<ArpSimulationScreen> createState() => _ArpSimulationScreenState();
}

class _ArpSimulationScreenState extends State<ArpSimulationScreen> 
    with TickerProviderStateMixin {
  // ARP缓存表
  final List<ArpEntry> _arpTable = [];
  
  // 网络中的设备
  final List<NetworkDevice> _devices = [
    NetworkDevice(
      name: 'PC-A',
      ipAddress: '192.168.1.10',
      macAddress: 'AA:BB:CC:DD:EE:F1',
      position: const Offset(100, 200),
    ),
    NetworkDevice(
      name: 'PC-B',
      ipAddress: '192.168.1.20',
      macAddress: 'AA:BB:CC:DD:EE:F2',
      position: const Offset(300, 200),
    ),
    NetworkDevice(
      name: 'Router',
      ipAddress: '192.168.1.1',
      macAddress: 'AA:BB:CC:DD:EE:F0',
      position: const Offset(500, 200),
    ),
    NetworkDevice(
      name: 'Server',
      ipAddress: '192.168.1.100',
      macAddress: 'AA:BB:CC:DD:EE:F3',
      position: const Offset(700, 200),
    ),
  ];
  
  // 当前选中的源设备和目标IP
  NetworkDevice? _selectedSource;
  String _targetIp = '';
  
  // 动画控制
  AnimationController? _animationController;
  Animation<double>? _animation;
  bool _isAnimating = false;
  
  // 日志记录
  final List<String> _logs = [];
  final ScrollController _logScrollController = ScrollController();
  
  // ARP步骤
  int _currentStep = 0;
  Timer? _stepTimer;

  @override
  void initState() {
    super.initState();
    _initializeArpTable();
  }

  @override
  void dispose() {
    _animationController?.dispose();
    _stepTimer?.cancel();
    _logScrollController.dispose();
    super.dispose();
  }

  void _initializeArpTable() {
    // 初始化一些已知的ARP缓存
    _arpTable.add(ArpEntry(
      ipAddress: '192.168.1.1',
      macAddress: 'AA:BB:CC:DD:EE:F0',
      ttl: 120,
      type: 'Static',
    ));
  }

  void _startArpRequest() {
    if (_selectedSource == null || _targetIp.isEmpty) {
      _showSnackBar('请选择源设备并输入目标IP地址');
      return;
    }
    
    // 查找目标设备
    NetworkDevice? targetDevice = _devices.firstWhere(
      (d) => d.ipAddress == _targetIp,
      orElse: () => NetworkDevice(
        name: 'Unknown',
        ipAddress: _targetIp,
        macAddress: 'Unknown',
        position: const Offset(0, 0),
      ),
    );
    
    if (targetDevice.macAddress == 'Unknown') {
      _addLog('错误: 目标IP地址 $_targetIp 不存在于网络中');
      return;
    }
    
    setState(() {
      _isAnimating = true;
      _currentStep = 0;
      _logs.clear();
    });
    
    _setupAnimation();
    _executeArpSteps(targetDevice);
  }

  void _setupAnimation() {
    _animationController = AnimationController(
      duration: const Duration(seconds: 3),
      vsync: this,
    );
    
    _animation = CurvedAnimation(
      parent: _animationController!,
      curve: Curves.easeInOut,
    );
    
    _animationController!.forward();
  }

  void _executeArpSteps(NetworkDevice targetDevice) {
    _stepTimer?.cancel();
    
    final steps = [
      () {
        _addLog('步骤 1: ${_selectedSource!.name} 检查本地ARP缓存表');
        
        // 检查缓存
        final cached = _arpTable.firstWhere(
          (e) => e.ipAddress == _targetIp,
          orElse: () => ArpEntry(
            ipAddress: '',
            macAddress: '',
            ttl: 0,
            type: '',
          ),
        );
        
        if (cached.ipAddress.isNotEmpty) {
          _addLog('  找到缓存: IP=$_targetIp -> MAC=${cached.macAddress}');
          _addLog('ARP解析完成（从缓存获取）');
          _completeAnimation();
          return false;
        } else {
          _addLog('  缓存未命中，需要发送ARP请求');
          return true;
        }
      },
      () {
        _addLog('步骤 2: 构造ARP请求包');
        _addLog('  发送方MAC: ${_selectedSource!.macAddress}');
        _addLog('  发送方IP: ${_selectedSource!.ipAddress}');
        _addLog('  目标MAC: FF:FF:FF:FF:FF:FF (广播)');
        _addLog('  目标IP: $_targetIp');
        return true;
      },
      () {
        _addLog('步骤 3: 广播ARP请求到局域网');
        _addLog('  所有设备都会收到此广播包');
        return true;
      },
      () {
        _addLog('步骤 4: 各设备处理ARP请求');
        
        for (final device in _devices) {
          if (device == _selectedSource) continue;
          
          if (device.ipAddress == _targetIp) {
            _addLog('  ${device.name} (${device.ipAddress}): 这是我的IP，准备应答');
          } else {
            _addLog('  ${device.name} (${device.ipAddress}): 不是我的IP，丢弃');
          }
        }
        return true;
      },
      () {
        _addLog('步骤 5: ${targetDevice.name} 发送ARP应答');
        _addLog('  应答MAC: ${targetDevice.macAddress}');
        _addLog('  应答IP: ${targetDevice.ipAddress}');
        _addLog('  目标MAC: ${_selectedSource!.macAddress}');
        _addLog('  目标IP: ${_selectedSource!.ipAddress}');
        return true;
      },
      () {
        _addLog('步骤 6: ${_selectedSource!.name} 接收ARP应答');
        _addLog('  更新ARP缓存表');
        
        // 添加到缓存
        setState(() {
          _arpTable.removeWhere((e) => e.ipAddress == _targetIp);
          _arpTable.add(ArpEntry(
            ipAddress: _targetIp,
            macAddress: targetDevice.macAddress,
            ttl: 300,
            type: 'Dynamic',
          ));
        });
        
        _addLog('  已添加: IP=$_targetIp -> MAC=${targetDevice.macAddress}');
        _addLog('ARP解析完成！');
        _completeAnimation();
        return false;
      },
    ];
    
    int currentIndex = 0;
    _stepTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (currentIndex < steps.length) {
        setState(() {
          _currentStep = currentIndex + 1;
        });
        
        final continueSteps = steps[currentIndex]();
        currentIndex++;
        
        if (!continueSteps) {
          timer.cancel();
        }
      } else {
        timer.cancel();
      }
    });
  }

  void _completeAnimation() {
    Future.delayed(const Duration(seconds: 1), () {
      setState(() {
        _isAnimating = false;
        _currentStep = 0;
      });
      _animationController?.dispose();
      _animationController = null;
    });
  }

  void _addLog(String message) {
    setState(() {
      _logs.add('[${DateTime.now().toString().substring(11, 19)}] $message');
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

  void _clearArpTable() {
    setState(() {
      _arpTable.removeWhere((e) => e.type == 'Dynamic');
      _addLog('已清空动态ARP缓存');
    });
  }

  void _showSnackBar(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
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
        title: const Text('ARP协议模拟'),
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
        child: ResponsiveLayout(
          mobile: ListView(
            children: [
              _buildTopologyCard(height: 320),
              const SizedBox(height: AppSpacing.md),
              _buildControlPanelCard(),
              const SizedBox(height: AppSpacing.md),
              _buildArpTableCard(height: 280),
              const SizedBox(height: AppSpacing.md),
              _buildLogCard(height: 300),
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
              Expanded(flex: 2, child: _buildTopologyCard()),
              _buildControlPanelCard(),
            ],
          ),
        ),
        Expanded(
          flex: 2,
          child: Column(
            children: [
              Expanded(child: _buildArpTableCard()),
              Expanded(child: _buildLogCard()),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildTopologyCard({double? height}) {
    final content = Stack(
      children: [
        CustomPaint(
          size: Size.infinite,
          painter: GridPainter(),
        ),
        ..._buildDeviceNodes(),
        if (_isAnimating) _buildAnimation(),
      ],
    );

    return Card(
      margin: const EdgeInsets.all(AppSpacing.md),
      child: height == null ? content : SizedBox(height: height, child: content),
    );
  }

  Widget _buildControlPanelCard() {
    return Card(
      margin: const EdgeInsets.all(AppSpacing.md),
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'ARP请求配置',
              style: Theme.of(context).textTheme.displaySmall,
            ),
            const SizedBox(height: AppSpacing.lg),
            Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<NetworkDevice>(
                    value: _selectedSource,
                    decoration: const InputDecoration(
                      labelText: '源设备',
                      border: OutlineInputBorder(),
                    ),
                    items: _devices.map((device) {
                      return DropdownMenuItem(
                        value: device,
                        child: Text('${device.name} (${device.ipAddress})'),
                      );
                    }).toList(),
                    onChanged: (value) {
                      setState(() {
                        _selectedSource = value;
                      });
                    },
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: TextField(
                    decoration: const InputDecoration(
                      labelText: '目标IP地址',
                      border: OutlineInputBorder(),
                      hintText: '例如: 192.168.1.20',
                    ),
                    onChanged: (value) {
                      setState(() {
                        _targetIp = value;
                      });
                    },
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.lg),
            Row(
              children: [
                ElevatedButton.icon(
                  onPressed: _isAnimating ? null : _startArpRequest,
                  icon: const Icon(Icons.send),
                  label: const Text('发送ARP请求'),
                ),
                const SizedBox(width: AppSpacing.md),
                OutlinedButton.icon(
                  onPressed: _clearArpTable,
                  icon: const Icon(Icons.clear),
                  label: const Text('清空缓存'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildArpTableCard({double? height}) {
    final content = Column(
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
          child: Row(
            children: [
              const Icon(Icons.table_chart, color: AppTheme.primary),
              const SizedBox(width: AppSpacing.sm),
              Text(
                'ARP缓存表',
                style: Theme.of(context).textTheme.headlineMedium,
              ),
            ],
          ),
        ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(AppSpacing.md),
            children: [
              _buildArpTableHeader(),
              ..._arpTable.map(_buildArpTableRow),
            ],
          ),
        ),
      ],
    );

    return Card(
      margin: const EdgeInsets.all(AppSpacing.md),
      child: height == null ? content : SizedBox(height: height, child: content),
    );
  }

  Widget _buildLogCard({double? height}) {
    final content = Column(
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
          child: Row(
            children: [
              const Icon(Icons.terminal, color: AppTheme.info),
              const SizedBox(width: AppSpacing.sm),
              Text(
                '执行日志',
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              const Spacer(),
              if (_currentStep > 0)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.sm,
                    vertical: AppSpacing.xs,
                  ),
                  decoration: BoxDecoration(
                    color: AppTheme.success.withOpacity(0.2),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppTheme.success),
                  ),
                  child: Text(
                    '步骤 $_currentStep/6',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: AppTheme.success,
                          fontWeight: FontWeight.w700,
                        ),
                  ),
                ),
            ],
          ),
        ),
        Expanded(
          child: ListView.builder(
            controller: _logScrollController,
            padding: const EdgeInsets.all(AppSpacing.md),
            itemCount: _logs.length,
            itemBuilder: (context, index) {
              final log = _logs[index];
              Color color = AppTheme.textSecondary;
              if (log.contains('错误')) {
                color = AppTheme.error;
              } else if (log.contains('步骤')) {
                color = AppTheme.info;
              } else if (log.contains('完成')) {
                color = AppTheme.success;
              }
              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Text(
                  log,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: color,
                      ),
                ),
              );
            },
          ),
        ),
      ],
    );

    return Card(
      margin: const EdgeInsets.all(AppSpacing.md),
      child: height == null ? content : SizedBox(height: height, child: content),
    );
  }

  List<Widget> _buildDeviceNodes() {
    return _devices.map((device) {
      final isSelected = device == _selectedSource;
      final isTarget = device.ipAddress == _targetIp;
      
      return Positioned(
        left: device.position.dx - 40,
        top: device.position.dy - 40,
        child: GestureDetector(
          onTap: () {
            setState(() {
              _selectedSource = device;
            });
          },
          child: Container(
            width: 80,
            height: 80,
            decoration: BoxDecoration(
              color: isSelected
                  ? AppTheme.primary.withOpacity(0.2)
                  : isTarget
                      ? AppTheme.success.withOpacity(0.2)
                      : AppTheme.surfaceHighlight.withOpacity(0.6),
              border: Border.all(
                color: isSelected
                    ? AppTheme.primary
                    : isTarget
                        ? AppTheme.success
                        : AppTheme.borderStrong,
                width: 2,
              ),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  device.name.contains('Router')
                      ? Icons.router
                      : device.name.contains('Server')
                          ? Icons.dns
                          : Icons.computer,
                  size: 24,
                  color: isSelected
                      ? AppTheme.primary
                      : isTarget
                          ? AppTheme.success
                          : AppTheme.textSecondary,
                ),
                const SizedBox(height: 4),
                Text(
                  device.name,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        fontWeight: FontWeight.bold,
                        color: AppTheme.textPrimary,
                      ),
                ),
                Text(
                  device.ipAddress,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        fontSize: 10,
                        color: AppTheme.textSecondary,
                      ),
                ),
              ],
            ),
          ),
        ),
      );
    }).toList();
  }

  Widget _buildAnimation() {
    if (_animation == null || _selectedSource == null) {
      return const SizedBox.shrink();
    }
    
    return AnimatedBuilder(
      animation: _animation!,
      builder: (context, child) {
        final progress = _animation!.value;
        
        // 广播动画（步骤3）
        if (_currentStep == 3) {
          return CustomPaint(
            size: Size.infinite,
            painter: BroadcastPainter(
              center: _selectedSource!.position,
              radius: progress * 400,
            ),
          );
        }
        
        // 单播响应动画（步骤5）
        if (_currentStep == 5) {
          final targetDevice = _devices.firstWhere(
            (d) => d.ipAddress == _targetIp,
            orElse: () => _selectedSource!,
          );
          
          return CustomPaint(
            size: Size.infinite,
            painter: UnicastPainter(
              start: targetDevice.position,
              end: _selectedSource!.position,
              progress: progress,
            ),
          );
        }
        
        return const SizedBox.shrink();
      },
    );
  }

  Widget _buildArpTableHeader() {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        border: Border(
          bottom: const BorderSide(color: AppTheme.borderSubtle),
        ),
      ),
      child: const Row(
        children: [
          Expanded(
            flex: 2,
            child: Text(
              'IP地址',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
          ),
          Expanded(
            flex: 3,
            child: Text(
              'MAC地址',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
          ),
          Expanded(
            child: Text(
              'TTL',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
          ),
          Expanded(
            child: Text(
              '类型',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildArpTableRow(ArpEntry entry) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        border: Border(
          bottom: const BorderSide(color: AppTheme.borderSubtle),
        ),
      ),
      child: Row(
        children: [
          Expanded(
            flex: 2,
            child: Text(
              entry.ipAddress,
              style: const TextStyle(fontFamily: 'monospace'),
            ),
          ),
          Expanded(
            flex: 3,
            child: Text(
              entry.macAddress,
              style: const TextStyle(fontFamily: 'monospace'),
            ),
          ),
          Expanded(
            child: Text(
              '${entry.ttl}s',
              style: const TextStyle(fontFamily: 'monospace'),
            ),
          ),
          Expanded(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: entry.type == 'Static'
                    ? AppTheme.primary.withOpacity(0.2)
                    : AppTheme.success.withOpacity(0.2),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                entry.type,
                style: TextStyle(
                  fontSize: 12,
                  color: entry.type == 'Static'
                      ? AppTheme.primary
                      : AppTheme.success,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _showHelp() {
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('ARP协议说明'),
          content: const SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'ARP（Address Resolution Protocol）地址解析协议用于将IP地址解析为MAC地址。',
                  style: TextStyle(fontWeight: FontWeight.bold),
                ),
                SizedBox(height: 16),
                Text('工作流程：'),
                Text('1. 源设备检查本地ARP缓存'),
                Text('2. 如果缓存未命中，构造ARP请求包'),
                Text('3. 广播ARP请求到局域网'),
                Text('4. 目标设备接收并识别请求'),
                Text('5. 目标设备发送ARP应答'),
                Text('6. 源设备更新ARP缓存表'),
                SizedBox(height: 16),
                Text(
                  '缓存类型：',
                  style: TextStyle(fontWeight: FontWeight.bold),
                ),
                Text('• Static：静态配置，不会过期'),
                Text('• Dynamic：动态学习，有TTL限制'),
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
class NetworkDevice {
  final String name;
  final String ipAddress;
  final String macAddress;
  final Offset position;

  NetworkDevice({
    required this.name,
    required this.ipAddress,
    required this.macAddress,
    required this.position,
  });
}

class ArpEntry {
  final String ipAddress;
  final String macAddress;
  final int ttl;
  final String type;

  ArpEntry({
    required this.ipAddress,
    required this.macAddress,
    required this.ttl,
    required this.type,
  });
}

// 自定义绘制器
class GridPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = AppTheme.borderSubtle
      ..strokeWidth = 1;

    const gridSize = 50.0;
    
    for (double x = 0; x <= size.width; x += gridSize) {
      canvas.drawLine(
        Offset(x, 0),
        Offset(x, size.height),
        paint,
      );
    }
    
    for (double y = 0; y <= size.height; y += gridSize) {
      canvas.drawLine(
        Offset(0, y),
        Offset(size.width, y),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class BroadcastPainter extends CustomPainter {
  final Offset center;
  final double radius;

  BroadcastPainter({
    required this.center,
    required this.radius,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = AppTheme.warning.withOpacity(0.3 * (1 - radius / 400))
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;

    canvas.drawCircle(center, radius, paint);
  }

  @override
  bool shouldRepaint(BroadcastPainter oldDelegate) {
    return oldDelegate.radius != radius;
  }
}

class UnicastPainter extends CustomPainter {
  final Offset start;
  final Offset end;
  final double progress;

  UnicastPainter({
    required this.start,
    required this.end,
    required this.progress,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = AppTheme.success
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round;

    final currentX = start.dx + (end.dx - start.dx) * progress;
    final currentY = start.dy + (end.dy - start.dy) * progress;

    canvas.drawLine(start, Offset(currentX, currentY), paint);

    // 绘制箭头
    if (progress > 0) {
      final arrowPaint = Paint()
        ..color = AppTheme.success
        ..style = PaintingStyle.fill;

      canvas.drawCircle(Offset(currentX, currentY), 6, arrowPaint);
    }
  }

  @override
  bool shouldRepaint(UnicastPainter oldDelegate) {
    return oldDelegate.progress != progress;
  }
}
