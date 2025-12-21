
import 'package:flutter/foundation.dart';
import 'base_models.dart';
import 'ip_protocols.dart';
// 注意: 不直接导入 device_implementations.dart 以避免循环依赖
// IpDevice 类型通过 dynamic 或泛型处理
import '../../services/network/network_simulator.dart';

/// TCP 段 (用于传输的 wire 格式, 作为 IpPacket 的 payload)
class TcpSegment extends Packet {
  final int sourcePort;
  final int destinationPort;
  int sequenceNumber;
  int acknowledgementNumber;
  
  // 标志位
  bool syn;
  bool ack;
  bool fin;
  bool rst;
  bool psh;
  bool urg;
  
  int windowSize;
  final String? data;

  TcpSegment({
    required this.sourcePort,
    required this.destinationPort,
    this.sequenceNumber = 0,
    this.acknowledgementNumber = 0,
    this.syn = false,
    this.ack = false,
    this.fin = false,
    this.rst = false,
    this.psh = false,
    this.urg = false,
    this.windowSize = 65535,
    this.data,
  });

  @override
  String get name {
    List<String> flags = [];
    if (syn) flags.add('SYN');
    if (ack) flags.add('ACK');
    if (fin) flags.add('FIN');
    if (rst) flags.add('RST');
    if (psh) flags.add('PSH');
    return 'TCP ${flags.join("+")}';
  }

  @override
  String get description => '$name SEQ=$sequenceNumber ACK=$acknowledgementNumber';

  @override
  int get sizeBytes => 20 + (data?.length ?? 0); // TCP 头部 20 字节 + 数据

  @override
  Packet copy() => TcpSegment(
    sourcePort: sourcePort,
    destinationPort: destinationPort,
    sequenceNumber: sequenceNumber,
    acknowledgementNumber: acknowledgementNumber,
    syn: syn, ack: ack, fin: fin, rst: rst, psh: psh, urg: urg,
    windowSize: windowSize,
    data: data,
  );
}

/// TCP 状态机
enum TcpState {
  closed,
  listen,
  synSent,
  synReceived,
  established,
  finWait1,
  finWait2,
  closeWait,
  closing,
  lastAck,
  timeWait,
}

/// TCP Socket 抽象 (每个连接一个)
/// 这是 FSM 的核心实现
class TcpSocket extends ChangeNotifier {
  // 连接信息
  final IpAddress localAddress;
  final int localPort;
  IpAddress? remoteAddress;
  int? remotePort;
  
  // 状态
  TcpState _state = TcpState.closed;
  TcpState get state => _state;
  
  // 序列号管理
  int _sendNextSeq = 1000; // ISN (Initial Sequence Number)
  int _sendUnackedSeq = 1000;
  int _recvNextSeq = 0;
  
  // 发送/接收缓冲区
  final List<String> _sendBuffer = [];
  final List<String> _recvBuffer = [];
  List<String> get receivedData => List.unmodifiable(_recvBuffer);
  
  // 状态事件日志 (用于 UI 显示)
  final List<String> _log = [];
  List<String> get log => List.unmodifiable(_log);
  
  // 回调
  void Function(TcpState oldState, TcpState newState)? onStateChange;
  void Function(String data)? onDataReceived;
  void Function()? onConnectionEstablished;
  void Function()? onConnectionClosed;
  
  // 所属设备 (用于发送)
  // 注意: 使用 dynamic 以避免循环导入
  final dynamic _device;
  
  TcpSocket({
    required this.localAddress,
    required this.localPort,
    dynamic device,
  }) : _device = device;

  void _log_(String message) {
    final logMsg = "[${DateTime.now().toString().substring(11, 19)}] $message";
    _log.add(logMsg);
    debugPrint("TcpSocket ($localPort): $message");
    notifyListeners();
  }

  void _setState(TcpState newState) {
    final old = _state;
    _state = newState;
    _log_("状态转换: ${old.name} -> ${newState.name}");
    onStateChange?.call(old, newState);
    notifyListeners();
  }

  // ==========================================
  // 主动操作 API
  // ==========================================

  /// 客户端: 发起连接
  void connect(IpAddress remoteAddr, int remoteP) {
    if (_state != TcpState.closed) {
      _log_("错误: 只能在 CLOSED 状态下发起连接");
      return;
    }
    
    remoteAddress = remoteAddr;
    remotePort = remoteP;
    
    // 注册到 Stack 以便接收返回包
    try {
      _device.tcpStack.registerActiveConnection(this);
    } catch (e) {
      debugPrint("Warning: Failed to register socket with device stack: $e");
    }
    
    // 发送 SYN
    _sendSegment(TcpSegment(
      sourcePort: localPort,
      destinationPort: remoteP,
      sequenceNumber: _sendNextSeq,
      syn: true,
    ));
    _sendNextSeq++;
    
    _setState(TcpState.synSent);
  }

  /// 服务端: 开始监听
  void listen() {
    if (_state != TcpState.closed) {
      _log_("错误: 只能在 CLOSED 状态下开始监听");
      return;
    }
    _setState(TcpState.listen);
  }

  /// 发送数据
  void send(String data) {
    if (_state != TcpState.established) {
      _log_("错误: 只能在 ESTABLISHED 状态下发送数据");
      return;
    }
    
    _sendBuffer.add(data);
    
    // 立即发送
    _sendSegment(TcpSegment(
      sourcePort: localPort,
      destinationPort: remotePort!,
      sequenceNumber: _sendNextSeq,
      acknowledgementNumber: _recvNextSeq,
      ack: true,
      psh: true,
      data: data,
    ));
    _sendNextSeq += data.length;
  }

  /// 关闭连接
  void close() {
    if (_state == TcpState.established || _state == TcpState.closeWait) {
      _sendSegment(TcpSegment(
        sourcePort: localPort,
        destinationPort: remotePort!,
        sequenceNumber: _sendNextSeq,
        acknowledgementNumber: _recvNextSeq,
        ack: true,
        fin: true,
      ));
      _sendNextSeq++;
      
      if (_state == TcpState.established) {
        _setState(TcpState.finWait1);
      } else {
        _setState(TcpState.lastAck);
      }
    }
  }

  // ==========================================
  // 被动操作: 接收段 (由 IpDevice 调用)
  // ==========================================

  /// 处理收到的 TCP 段
  void receiveSegment(TcpSegment segment) {
    _log_("收到: ${segment.name} SEQ=${segment.sequenceNumber} ACK=${segment.acknowledgementNumber}");
    
    switch (_state) {
      case TcpState.listen:
        _handleListenState(segment);
        break;
      case TcpState.synSent:
        _handleSynSentState(segment);
        break;
      case TcpState.synReceived:
        _handleSynReceivedState(segment);
        break;
      case TcpState.established:
        _handleEstablishedState(segment);
        break;
      case TcpState.finWait1:
        _handleFinWait1State(segment);
        break;
      case TcpState.finWait2:
        _handleFinWait2State(segment);
        break;
      case TcpState.closeWait:
        // 等待应用层调用 close()
        break;
      case TcpState.lastAck:
        if (segment.ack) {
          _setState(TcpState.closed);
          onConnectionClosed?.call();
        }
        break;
      case TcpState.timeWait:
        // 等待 2MSL 超时
        break;
      default:
        _log_("忽略: 状态 ${_state.name} 下收到的段");
    }
  }

  void _handleListenState(TcpSegment segment) {
    if (segment.syn && !segment.ack) {
      // 收到 SYN, 记录客户端信息
      // remoteAddress 已由 TcpStack 在创建 socket 时设置
      remotePort = segment.sourcePort;
      _recvNextSeq = segment.sequenceNumber + 1;
      
      // 发送 SYN+ACK
      _sendSegment(TcpSegment(
        sourcePort: localPort,
        destinationPort: segment.sourcePort,
        sequenceNumber: _sendNextSeq,
        acknowledgementNumber: _recvNextSeq,
        syn: true,
        ack: true,
      ));
      _sendNextSeq++;
      
      _setState(TcpState.synReceived);
    }
  }

  void _handleSynSentState(TcpSegment segment) {
    if (segment.syn && segment.ack) {
      // 收到 SYN+ACK
      _recvNextSeq = segment.sequenceNumber + 1;
      
      // 发送 ACK (完成三次握手)
      _sendSegment(TcpSegment(
        sourcePort: localPort,
        destinationPort: remotePort!,
        sequenceNumber: _sendNextSeq,
        acknowledgementNumber: _recvNextSeq,
        ack: true,
      ));
      
      _setState(TcpState.established);
      onConnectionEstablished?.call();
    }
  }

  void _handleSynReceivedState(TcpSegment segment) {
    if (segment.ack) {
      // 收到 ACK, 三次握手完成
      _setState(TcpState.established);
      onConnectionEstablished?.call();
    }
  }

  void _handleEstablishedState(TcpSegment segment) {
    if (segment.fin) {
      // 对方要求关闭
      _recvNextSeq = segment.sequenceNumber + 1;
      
      // 发送 ACK
      _sendSegment(TcpSegment(
        sourcePort: localPort,
        destinationPort: remotePort!,
        sequenceNumber: _sendNextSeq,
        acknowledgementNumber: _recvNextSeq,
        ack: true,
      ));
      
      _setState(TcpState.closeWait);
      // 此时应用层应该调用 close() 来完成四次挥手
    } else if (segment.data != null) {
      // 收到数据
      _recvBuffer.add(segment.data!);
      _recvNextSeq += segment.data!.length;
      
      // 发送 ACK
      _sendSegment(TcpSegment(
        sourcePort: localPort,
        destinationPort: remotePort!,
        sequenceNumber: _sendNextSeq,
        acknowledgementNumber: _recvNextSeq,
        ack: true,
      ));
      
      onDataReceived?.call(segment.data!);
    }
  }

  void _handleFinWait1State(TcpSegment segment) {
    if (segment.ack && !segment.fin) {
      _setState(TcpState.finWait2);
    } else if (segment.fin) {
      _recvNextSeq = segment.sequenceNumber + 1;
      
      _sendSegment(TcpSegment(
        sourcePort: localPort,
        destinationPort: remotePort!,
        sequenceNumber: _sendNextSeq,
        acknowledgementNumber: _recvNextSeq,
        ack: true,
      ));
      
      if (segment.ack) {
        _setState(TcpState.timeWait);
      } else {
        _setState(TcpState.closing);
      }
    }
  }

  void _handleFinWait2State(TcpSegment segment) {
    if (segment.fin) {
      _recvNextSeq = segment.sequenceNumber + 1;
      
      _sendSegment(TcpSegment(
        sourcePort: localPort,
        destinationPort: remotePort!,
        sequenceNumber: _sendNextSeq,
        acknowledgementNumber: _recvNextSeq,
        ack: true,
      ));
      
      _setState(TcpState.timeWait);
      
      // TODO: 启动 2MSL 定时器
      // NetworkSimulator().scheduleEvent(2 * MSL, "TIME_WAIT timeout", () { _setState(TcpState.closed); });
    }
  }

  // ==========================================
  // 内部发送
  // ==========================================

  void _sendSegment(TcpSegment segment) {
    _log_("发送: ${segment.name} SEQ=${segment.sequenceNumber} ACK=${segment.acknowledgementNumber}");
    
    if (_device != null && remoteAddress != null) {
      // 通过 IP 层发送
      final ipPacket = IpPacket(
        sourceIp: localAddress,
        destinationIp: remoteAddress!,
        protocol: IpProtocol.tcp,
        payload: segment,
      );
      _device!.sendIpPacket(ipPacket);
    } else {
      // 仅用于 UI 演示 (没有真实设备)
      debugPrint("TcpSocket: 模拟发送 ${segment.name} 到 $remoteAddress:$remotePort");
    }
  }
}

/// TCP 连接管理器 (每个 IpDevice 一个)
class TcpStack {
  // 注意: 使用 dynamic 以避免循环导入
  final dynamic device;
  
  // 监听中的 Sockets: port -> socket
  final Map<int, TcpSocket> _listeningPorts = {};
  
  // 活跃连接: (localPort, remoteAddr, remotePort) -> socket
  final Map<String, TcpSocket> _connections = {};

  TcpStack(this.device);

  /// 创建并绑定一个 Socket
  TcpSocket createSocket(int localPort) {
    final socket = TcpSocket(
      localAddress: device.interfaces.values.first.ipAddress!,
      localPort: localPort,
      device: device,
    );
    return socket;
  }
  
  /// 开始监听端口
  void listen(int port, TcpSocket socket) {
    socket.listen();
    _listeningPorts[port] = socket;
  }

  /// 注册活跃连接 (供客户端 Connect 使用)
  void registerActiveConnection(TcpSocket socket) {
    if (socket.remoteAddress == null || socket.remotePort == null) return;
    final key = _connectionKey(socket.localPort, socket.remoteAddress!, socket.remotePort!);
    _connections[key] = socket;
  }

  /// 处理收到的 IP 包 (由 IpDevice 调用)
  void handleIncomingIpPacket(IpPacket packet) {
    if (packet.payload is! TcpSegment) return;
    
    final segment = packet.payload as TcpSegment;
    final destPort = segment.destinationPort;
    
    // 查找已建立的连接
    final connKey = _connectionKey(destPort, packet.sourceIp, segment.sourcePort);
    if (_connections.containsKey(connKey)) {
      _connections[connKey]!.receiveSegment(segment);
      return;
    }
    
    // 查找监听 Socket
    if (_listeningPorts.containsKey(destPort)) {
      final listenSocket = _listeningPorts[destPort]!;
      
      // 如果是 SYN, 创建新的连接 Socket
      if (segment.syn && !segment.ack) {
        final newSocket = TcpSocket(
          localAddress: listenSocket.localAddress,
          localPort: destPort,
          device: device,
        );
        newSocket.remoteAddress = packet.sourceIp;
        newSocket.remotePort = segment.sourcePort;
        newSocket._state = TcpState.listen; // 从 listen 开始处理
        
        _connections[connKey] = newSocket;
        newSocket.receiveSegment(segment);
      } else {
        listenSocket.receiveSegment(segment);
      }
      return;
    }
    
    // 找不到目标, 发送 RST
    debugPrint("TcpStack: 收到未知端口 $destPort 的段, 忽略");
  }

  String _connectionKey(int localPort, IpAddress remoteAddr, int remotePort) {
    return "$localPort-$remoteAddr-$remotePort";
  }

  // --- UI 访问器 ---
  
  /// 获取所有监听端口
  List<int> getListeningPorts() => _listeningPorts.keys.toList();
  
  /// 获取所有活跃连接的 Socket
  List<TcpSocket> getActiveConnections() => _connections.values.toList();
}
