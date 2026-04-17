/// TCP协议模型定义
class TcpPacket {
  final int? seq;           // 序列号
  final int? ack;           // 确认号
  final bool syn;           // SYN标志位
  final bool ack_flag;      // ACK标志位
  final bool fin;           // FIN标志位
  final bool rst;           // RST标志位
  final String? data;       // 数据内容
  final String source;      // 源端
  final String target;      // 目标端

  TcpPacket({
    this.seq,
    this.ack,
    this.syn = false,
    this.ack_flag = false,
    this.fin = false,
    this.rst = false,
    this.data,
    required this.source,
    required this.target,
  });

  /// 获取数据包的标志位描述
  String get flagsDescription {
    List<String> flags = [];
    if (syn) flags.add('SYN');
    if (ack_flag) flags.add('ACK');
    if (fin) flags.add('FIN');
    if (rst) flags.add('RST');
    return flags.join(' ');
  }

  /// 获取数据包的简短描述
  String get shortDescription {
    String desc = flagsDescription;
    if (seq != null) desc += ' SEQ=$seq';
    if (ack != null) desc += ' ACK=$ack';
    return desc;
  }

  @override
  String toString() {
    return '$source -> $target: $shortDescription${data != null ? ' DATA="$data"' : ''}';
  }
}

/// TCP连接状态枚举
enum TcpState {
  CLOSED,         // 关闭
  LISTEN,         // 监听
  SYN_SENT,       // 已发送SYN
  SYN_RCVD,       // 已接收SYN
  ESTABLISHED,    // 连接已建立
  FIN_WAIT_1,     // 终止等待1
  FIN_WAIT_2,     // 终止等待2
  CLOSE_WAIT,     // 关闭等待
  CLOSING,        // 正在关闭
  LAST_ACK,       // 最后确认
  TIME_WAIT,      // 时间等待
}

/// TCP状态扩展方法
extension TcpStateExtension on TcpState {
  /// 获取状态的中文描述
  String get chineseDescription {
    switch (this) {
      case TcpState.CLOSED:
        return '关闭';
      case TcpState.LISTEN:
        return '监听';
      case TcpState.SYN_SENT:
        return '同步已发送';
      case TcpState.SYN_RCVD:
        return '同步收到';
      case TcpState.ESTABLISHED:
        return '已建立连接';
      case TcpState.FIN_WAIT_1:
        return '终止等待1';
      case TcpState.FIN_WAIT_2:
        return '终止等待2';
      case TcpState.CLOSE_WAIT:
        return '关闭等待';
      case TcpState.CLOSING:
        return '正在关闭';
      case TcpState.LAST_ACK:
        return '最后确认';
      case TcpState.TIME_WAIT:
        return '时间等待';
    }
  }

  /// 获取状态的颜色
  int get color {
    switch (this) {
      case TcpState.CLOSED:
        return 0xFFE0E0E0;
      case TcpState.LISTEN:
        return 0xFF4CAF50;
      case TcpState.SYN_SENT:
      case TcpState.SYN_RCVD:
        return 0xFF2196F3;
      case TcpState.ESTABLISHED:
        return 0xFF8BC34A;
      case TcpState.FIN_WAIT_1:
      case TcpState.FIN_WAIT_2:
      case TcpState.CLOSE_WAIT:
      case TcpState.CLOSING:
      case TcpState.LAST_ACK:
        return 0xFFFF9800;
      case TcpState.TIME_WAIT:
        return 0xFF9E9E9E;
    }
  }
}

/// TCP事件类型枚举
enum TcpEventType {
  SEND_PACKET,    // 发送数据包
  RECEIVE_PACKET, // 接收数据包
  STATE_CHANGE,   // 状态变化
  TIMEOUT,        // 超时
  ERROR,          // 错误
}

/// TCP连接事件
class TcpConnectionEvent {
  final TcpEventType type;
  final String source;
  final String target;
  final TcpPacket? packet;
  final TcpState? oldState;
  final TcpState? newState;
  final String description;
  final DateTime timestamp;
  final int? delay; // 动画延迟（毫秒）

  TcpConnectionEvent({
    required this.type,
    required this.source,
    required this.target,
    this.packet,
    this.oldState,
    this.newState,
    required this.description,
    DateTime? timestamp,
    this.delay = 500,
  }) : timestamp = timestamp ?? DateTime.now();

  /// 获取事件的简短描述
  String get shortDescription {
    if (type == TcpEventType.SEND_PACKET) {
      return '$source 发送: ${packet?.flagsDescription ?? ""}';
    } else if (type == TcpEventType.STATE_CHANGE) {
      return '$source: ${oldState?.name} -> ${newState?.name}';
    }
    return description;
  }
}

/// TCP连接信息
class TcpConnection {
  final String clientAddress;
  final int clientPort;
  final String serverAddress;
  final int serverPort;
  TcpState clientState;
  TcpState serverState;
  int clientSeq;
  int serverSeq;
  final List<TcpConnectionEvent> events;

  TcpConnection({
    this.clientAddress = '192.168.1.100',
    this.clientPort = 5000,
    this.serverAddress = '192.168.1.200',
    this.serverPort = 80,
    this.clientState = TcpState.CLOSED,
    this.serverState = TcpState.CLOSED,
    this.clientSeq = 1000,
    this.serverSeq = 2000,
    List<TcpConnectionEvent>? events,
  }) : events = events ?? [];

  /// 添加事件
  void addEvent(TcpConnectionEvent event) {
    events.add(event);
  }

  /// 清空事件
  void clearEvents() {
    events.clear();
  }

  /// 重置连接状态
  void reset() {
    clientState = TcpState.CLOSED;
    serverState = TcpState.CLOSED;
    clientSeq = 1000;
    serverSeq = 2000;
    clearEvents();
  }
}
