
import 'dart:async';
import 'dart:collection';
import 'package:flutter/foundation.dart';
import '../../models/network/base_models.dart';

/// 网络仿真器核心
/// 负责驱动整个网络世界的时钟、事件分发和物理层传输模拟
class NetworkSimulator extends ChangeNotifier {
  // 单例模式
  static final NetworkSimulator _instance = NetworkSimulator._internal();
  factory NetworkSimulator() => _instance;
  NetworkSimulator._internal();

  // ==========================================
  // 拓扑状态 (Topology State)
  // ==========================================
  
  final Map<String, NetworkDevice> _devices = {};
  final List<NetworkLink> _links = [];
  
  List<NetworkDevice> get devices => _devices.values.toList();
  List<NetworkLink> get links => List.unmodifiable(_links);

  // ==========================================
  // 仿真内核 (Simulation Kernel)
  // ==========================================
  
  // 日志记录
  final List<String> _logs = [];
  List<String> get logs => List.unmodifiable(_logs);
  
  void log(String message) {
    if (_logs.length > 500) {
      _logs.removeAt(0); // 简单的循环缓冲
    }
    _logs.add("[${_currentTime.toStringAsFixed(1)}ms] $message");
    notifyListeners();
  }

  /// 全局仿真时间 (毫秒)
  double _currentTime = 0.0;
  double get currentTime => _currentTime;
  
  /// 是否正在运行
  bool _isRunning = false;
  bool get isRunning => _isRunning;
  
  /// 仿真速度倍率 (1.0 = 实时)
  double timeScale = 1.0;
  
  /// 事件队列 (按执行时间排序)
  final SplayTreeMap<double, List<SimEvent>> _eventQueue = 
      SplayTreeMap();

  Timer? _tickTimer;
  
  // ==========================================
  // API: 拓扑管理
  // ==========================================

  void addDevice(NetworkDevice device) {
    _devices[device.id] = device;
    notifyListeners();
  }

  void removeDevice(String deviceId) {
    // 移除相关链路
    _links.removeWhere((l) => 
        l.interface1.device.id == deviceId || 
        l.interface2.device.id == deviceId);
    
    // 断开接口连接状态
    for (var link in _links) {
       // 需要手动清理接口引用状态，或者重新遍历
       // 这里简化处理：假定 rebuild
    }
    
    _devices.remove(deviceId);
    notifyListeners();
  }
  
  /// 连接两个接口
  void addLink(NetworkInterface if1, NetworkInterface if2) {
    if (if1.isConnected || if2.isConnected) {
      throw Exception("Interface is already connected");
    }
    
    final link = NetworkLink(interface1: if1, interface2: if2);
    if1.link = link;
    if2.link = link;
    
    _links.add(link);
    notifyListeners();
  }

  // ==========================================
  // API: 仿真控制
  // ==========================================

  void start() {
    if (_isRunning) return;
    _isRunning = true;
    // 50ms 刷新一次 ui/tick
    _tickTimer = Timer.periodic(const Duration(milliseconds: 50), _onTick);
    notifyListeners();
  }

  void pause() {
    _isRunning = false;
    _tickTimer?.cancel();
    notifyListeners();
  }
  
  void reset() {
    pause();
    _currentTime = 0.0;
    _eventQueue.clear();
    _devices.clear();
    _links.clear();
    notifyListeners();
  }

  /// 调度一个事件
  void scheduleEvent(double delayMs, String description, Function() action) {
    // log("Scheduled: $description in ${delayMs.toStringAsFixed(1)}ms"); // Optional verbose logging
    final executeTime = _currentTime + delayMs;
    final event = SimEvent(
      id: DateTime.now().microsecondsSinceEpoch.toString(), // 简单ID
      executeTime: executeTime,
      description: description,
      action: action,
    );
    
    if (_eventQueue.containsKey(executeTime)) {
      _eventQueue[executeTime]!.add(event);
    } else {
      _eventQueue[executeTime] = [event];
    }
  }

  // ==========================================
  // 物理传输模拟
  // ==========================================

  /// 在链路上发送数据包
  /// [packet]: 数据包
  /// [fromInterface]: 发送接口
  void sendPacket(Packet packet, NetworkInterface fromInterface) {
    if (!fromInterface.isConnected) {
      log("Warning: Drop packet from ${fromInterface.name} (Disconnected)");
      return;
    }
    
    final link = fromInterface.link!;
    final targetInterface = link.getPeer(fromInterface)!;
    
    // 计算传输延迟
    // Transmission Delay = Packet Size / Bandwidth
    // Propagation Delay = Distance / Speed
    // 简化：为了动画可视化效果，强制最小延迟为 2000ms
    double totalDelay = link.propagationDelayMs + (packet.sizeBytes * 8 / (link.bandwidthMbps * 1000));
    if (totalDelay < 2000.0) {
      totalDelay = 2000.0;
    }
    
    // 创建可视化对象
    final transmission = PacketTransmission(
        packet: packet.copy(),
        sourceDetails: fromInterface,
        targetDetails: targetInterface,
        startTime: _currentTime,
        endTime: _currentTime + totalDelay,
    );
    link.activeTransmissions.add(transmission);
    
    scheduleEvent(totalDelay, "Packet Arrival: ${packet.name}", () {
      // 传输结束，从链路可视列表中移除
      link.activeTransmissions.remove(transmission);
      
      // 投递到对端设备
      targetInterface.device.receivePacket(packet.copy(), targetInterface);
    });
  }

  // ==========================================
  // 内部循环
  // ==========================================

  void _onTick(Timer timer) {
    if (!_isRunning) return;
    
    // 增加时间 (假设每次 tick 对应真实时间的流逝 * timeScale)
    // 简单起见，按 50ms 递增
    double delta = 50.0 * timeScale;
    double nextTime = _currentTime + delta;
    
    // 处理此时间段内的所有事件
    while (_eventQueue.isNotEmpty) {
      double firstTime = _eventQueue.firstKey()!;
      if (firstTime <= nextTime) {
        // 执行当前时间点的所有事件
        final events = _eventQueue.remove(firstTime)!;
        for (final event in events) {
          try {
            event.action();
          } catch (e) {
            debugPrint("Error executing simulation event: $e");
          }
        }
      } else {
        break; // 最近的事件也在未来
      }
    }
    
    _currentTime = nextTime;
    
    // 驱动所有设备的 Periodic Check (如 ARP 表过期)
    for (var device in _devices.values) {
      device.onTick(_currentTime);
    }
    
    notifyListeners();
  }
}

/// 仿真事件
class SimEvent {
  final String id;
  final double executeTime;
  final String description;
  final Function() action;

  SimEvent({
    required this.id,
    required this.executeTime,
    required this.description,
    required this.action,
  });
}
