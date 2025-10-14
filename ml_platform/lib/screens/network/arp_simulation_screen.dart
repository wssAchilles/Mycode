import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'dart:async';

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
      body: Row(
        children: [
          // 左侧：网络拓扑和控制面板
          Expanded(
            flex: 3,
            child: Column(
              children: [
                // 网络拓扑图
                Expanded(
                  flex: 2,
                  child: Card(
                    margin: const EdgeInsets.all(8),
                    child: Stack(
                      children: [
                        // 背景网格
                        CustomPaint(
                          size: Size.infinite,
                          painter: GridPainter(),
                        ),
                        // 设备节点
                        ..._buildDeviceNodes(),
                        // 动画效果
                        if (_isAnimating) _buildAnimation(),
                      ],
                    ),
                  ),
                ),
                // 控制面板
                Card(
                  margin: const EdgeInsets.all(8),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'ARP请求配置',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 16),
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
                            const SizedBox(width: 16),
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
                        const SizedBox(height: 16),
                        Row(
                          children: [
                            ElevatedButton.icon(
                              onPressed: _isAnimating ? null : _startArpRequest,
                              icon: const Icon(Icons.send),
                              label: const Text('发送ARP请求'),
                            ),
                            const SizedBox(width: 16),
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
                ),
              ],
            ),
          ),
          // 右侧：ARP表和日志
          Expanded(
            flex: 2,
            child: Column(
              children: [
                // ARP缓存表
                Expanded(
                  child: Card(
                    margin: const EdgeInsets.all(8),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: Colors.purple.withOpacity(0.1),
                            border: Border(
                              bottom: BorderSide(
                                color: Colors.grey.shade300,
                              ),
                            ),
                          ),
                          child: const Row(
                            children: [
                              Icon(Icons.table_chart, color: Colors.purple),
                              SizedBox(width: 8),
                              Text(
                                'ARP缓存表',
                                style: TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ],
                          ),
                        ),
                        Expanded(
                          child: ListView(
                            padding: const EdgeInsets.all(8),
                            children: [
                              _buildArpTableHeader(),
                              ..._arpTable.map(_buildArpTableRow),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                // 执行日志
                Expanded(
                  child: Card(
                    margin: const EdgeInsets.all(8),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: Colors.blue.withOpacity(0.1),
                            border: Border(
                              bottom: BorderSide(
                                color: Colors.grey.shade300,
                              ),
                            ),
                          ),
                          child: Row(
                            children: [
                              const Icon(Icons.terminal, color: Colors.blue),
                              const SizedBox(width: 8),
                              const Text(
                                '执行日志',
                                style: TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                              const Spacer(),
                              if (_currentStep > 0)
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 8,
                                    vertical: 4,
                                  ),
                                  decoration: BoxDecoration(
                                    color: Colors.green,
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: Text(
                                    '步骤 $_currentStep/6',
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 12,
                                    ),
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
                              return Padding(
                                padding: const EdgeInsets.symmetric(vertical: 2),
                                child: Text(
                                  _logs[index],
                                  style: TextStyle(
                                    fontFamily: 'monospace',
                                    fontSize: 12,
                                    color: _logs[index].contains('错误')
                                        ? Colors.red
                                        : _logs[index].contains('步骤')
                                            ? Colors.blue
                                            : _logs[index].contains('完成')
                                                ? Colors.green
                                                : Colors.black87,
                                  ),
                                ),
                              );
                            },
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
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
                  ? Colors.blue.withOpacity(0.2)
                  : isTarget
                      ? Colors.green.withOpacity(0.2)
                      : Colors.grey.withOpacity(0.1),
              border: Border.all(
                color: isSelected
                    ? Colors.blue
                    : isTarget
                        ? Colors.green
                        : Colors.grey,
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
                      ? Colors.blue
                      : isTarget
                          ? Colors.green
                          : Colors.grey[700],
                ),
                const SizedBox(height: 4),
                Text(
                  device.name,
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                Text(
                  device.ipAddress,
                  style: const TextStyle(
                    fontSize: 10,
                    color: Colors.grey,
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
          bottom: BorderSide(color: Colors.grey.shade300),
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
          bottom: BorderSide(color: Colors.grey.shade200),
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
                    ? Colors.blue.withOpacity(0.1)
                    : Colors.green.withOpacity(0.1),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                entry.type,
                style: TextStyle(
                  fontSize: 12,
                  color: entry.type == 'Static' ? Colors.blue : Colors.green,
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
      ..color = Colors.grey.withOpacity(0.1)
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
      ..color = Colors.orange.withOpacity(0.3 * (1 - radius / 400))
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
      ..color = Colors.green
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round;

    final currentX = start.dx + (end.dx - start.dx) * progress;
    final currentY = start.dy + (end.dy - start.dy) * progress;

    canvas.drawLine(start, Offset(currentX, currentY), paint);

    // 绘制箭头
    if (progress > 0) {
      final arrowPaint = Paint()
        ..color = Colors.green
        ..style = PaintingStyle.fill;

      canvas.drawCircle(Offset(currentX, currentY), 6, arrowPaint);
    }
  }

  @override
  bool shouldRepaint(UnicastPainter oldDelegate) {
    return oldDelegate.progress != progress;
  }
}
