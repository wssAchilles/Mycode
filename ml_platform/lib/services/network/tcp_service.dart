import '../../models/network/tcp_models.dart';

/// TCP连接管理服务
class TcpService {
  /// 生成三次握手事件序列
  static List<TcpConnectionEvent> generateHandshakeEvents() {
    List<TcpConnectionEvent> events = [];
    
    // 初始状态
    events.add(TcpConnectionEvent(
      type: TcpEventType.STATE_CHANGE,
      source: 'Server',
      target: 'Server',
      oldState: TcpState.CLOSED,
      newState: TcpState.LISTEN,
      description: '服务器开始监听端口80',
      delay: 0,
    ));

    // 第一次握手：客户端发送SYN
    events.add(TcpConnectionEvent(
      type: TcpEventType.SEND_PACKET,
      source: 'Client',
      target: 'Server',
      packet: TcpPacket(
        source: 'Client',
        target: 'Server',
        syn: true,
        seq: 1000,
      ),
      description: '客户端发送SYN包，请求建立连接',
      delay: 1000,
    ));

    events.add(TcpConnectionEvent(
      type: TcpEventType.STATE_CHANGE,
      source: 'Client',
      target: 'Client',
      oldState: TcpState.CLOSED,
      newState: TcpState.SYN_SENT,
      description: '客户端状态：CLOSED -> SYN_SENT',
      delay: 200,
    ));

    // 服务器接收SYN
    events.add(TcpConnectionEvent(
      type: TcpEventType.RECEIVE_PACKET,
      source: 'Server',
      target: 'Server',
      packet: TcpPacket(
        source: 'Client',
        target: 'Server',
        syn: true,
        seq: 1000,
      ),
      description: '服务器接收到客户端的SYN包',
      delay: 800,
    ));

    events.add(TcpConnectionEvent(
      type: TcpEventType.STATE_CHANGE,
      source: 'Server',
      target: 'Server',
      oldState: TcpState.LISTEN,
      newState: TcpState.SYN_RCVD,
      description: '服务器状态：LISTEN -> SYN_RCVD',
      delay: 200,
    ));

    // 第二次握手：服务器发送SYN+ACK
    events.add(TcpConnectionEvent(
      type: TcpEventType.SEND_PACKET,
      source: 'Server',
      target: 'Client',
      packet: TcpPacket(
        source: 'Server',
        target: 'Client',
        syn: true,
        ack_flag: true,
        seq: 2000,
        ack: 1001,
      ),
      description: '服务器发送SYN+ACK包，确认客户端的请求并请求建立连接',
      delay: 500,
    ));

    // 客户端接收SYN+ACK
    events.add(TcpConnectionEvent(
      type: TcpEventType.RECEIVE_PACKET,
      source: 'Client',
      target: 'Client',
      packet: TcpPacket(
        source: 'Server',
        target: 'Client',
        syn: true,
        ack_flag: true,
        seq: 2000,
        ack: 1001,
      ),
      description: '客户端接收到服务器的SYN+ACK包',
      delay: 800,
    ));

    // 第三次握手：客户端发送ACK
    events.add(TcpConnectionEvent(
      type: TcpEventType.SEND_PACKET,
      source: 'Client',
      target: 'Server',
      packet: TcpPacket(
        source: 'Client',
        target: 'Server',
        ack_flag: true,
        seq: 1001,
        ack: 2001,
      ),
      description: '客户端发送ACK包，确认服务器的SYN',
      delay: 500,
    ));

    events.add(TcpConnectionEvent(
      type: TcpEventType.STATE_CHANGE,
      source: 'Client',
      target: 'Client',
      oldState: TcpState.SYN_SENT,
      newState: TcpState.ESTABLISHED,
      description: '客户端状态：SYN_SENT -> ESTABLISHED',
      delay: 200,
    ));

    // 服务器接收ACK
    events.add(TcpConnectionEvent(
      type: TcpEventType.RECEIVE_PACKET,
      source: 'Server',
      target: 'Server',
      packet: TcpPacket(
        source: 'Client',
        target: 'Server',
        ack_flag: true,
        seq: 1001,
        ack: 2001,
      ),
      description: '服务器接收到客户端的ACK包',
      delay: 800,
    ));

    events.add(TcpConnectionEvent(
      type: TcpEventType.STATE_CHANGE,
      source: 'Server',
      target: 'Server',
      oldState: TcpState.SYN_RCVD,
      newState: TcpState.ESTABLISHED,
      description: '服务器状态：SYN_RCVD -> ESTABLISHED',
      delay: 200,
    ));

    // 连接建立成功
    events.add(TcpConnectionEvent(
      type: TcpEventType.STATE_CHANGE,
      source: 'Connection',
      target: 'Connection',
      description: '🎉 TCP连接建立成功！双方可以开始传输数据',
      delay: 500,
    ));

    return events;
  }

  /// 生成四次挥手事件序列
  static List<TcpConnectionEvent> generateTeardownEvents() {
    List<TcpConnectionEvent> events = [];
    
    // 初始状态：连接已建立
    events.add(TcpConnectionEvent(
      type: TcpEventType.STATE_CHANGE,
      source: 'Connection',
      target: 'Connection',
      description: '当前连接状态：ESTABLISHED（已建立）',
      delay: 0,
    ));

    // 第一次挥手：客户端发送FIN
    events.add(TcpConnectionEvent(
      type: TcpEventType.SEND_PACKET,
      source: 'Client',
      target: 'Server',
      packet: TcpPacket(
        source: 'Client',
        target: 'Server',
        fin: true,
        ack_flag: true,
        seq: 5000,
        ack: 8000,
      ),
      description: '客户端发送FIN包，请求断开连接',
      delay: 1000,
    ));

    events.add(TcpConnectionEvent(
      type: TcpEventType.STATE_CHANGE,
      source: 'Client',
      target: 'Client',
      oldState: TcpState.ESTABLISHED,
      newState: TcpState.FIN_WAIT_1,
      description: '客户端状态：ESTABLISHED -> FIN_WAIT_1',
      delay: 200,
    ));

    // 服务器接收FIN
    events.add(TcpConnectionEvent(
      type: TcpEventType.RECEIVE_PACKET,
      source: 'Server',
      target: 'Server',
      packet: TcpPacket(
        source: 'Client',
        target: 'Server',
        fin: true,
        ack_flag: true,
        seq: 5000,
        ack: 8000,
      ),
      description: '服务器接收到客户端的FIN包',
      delay: 800,
    ));

    // 第二次挥手：服务器发送ACK
    events.add(TcpConnectionEvent(
      type: TcpEventType.SEND_PACKET,
      source: 'Server',
      target: 'Client',
      packet: TcpPacket(
        source: 'Server',
        target: 'Client',
        ack_flag: true,
        seq: 8000,
        ack: 5001,
      ),
      description: '服务器发送ACK包，确认收到客户端的FIN',
      delay: 500,
    ));

    events.add(TcpConnectionEvent(
      type: TcpEventType.STATE_CHANGE,
      source: 'Server',
      target: 'Server',
      oldState: TcpState.ESTABLISHED,
      newState: TcpState.CLOSE_WAIT,
      description: '服务器状态：ESTABLISHED -> CLOSE_WAIT',
      delay: 200,
    ));

    // 客户端接收ACK
    events.add(TcpConnectionEvent(
      type: TcpEventType.RECEIVE_PACKET,
      source: 'Client',
      target: 'Client',
      packet: TcpPacket(
        source: 'Server',
        target: 'Client',
        ack_flag: true,
        seq: 8000,
        ack: 5001,
      ),
      description: '客户端接收到服务器的ACK包',
      delay: 800,
    ));

    events.add(TcpConnectionEvent(
      type: TcpEventType.STATE_CHANGE,
      source: 'Client',
      target: 'Client',
      oldState: TcpState.FIN_WAIT_1,
      newState: TcpState.FIN_WAIT_2,
      description: '客户端状态：FIN_WAIT_1 -> FIN_WAIT_2',
      delay: 200,
    ));

    // 第三次挥手：服务器发送FIN
    events.add(TcpConnectionEvent(
      type: TcpEventType.SEND_PACKET,
      source: 'Server',
      target: 'Client',
      packet: TcpPacket(
        source: 'Server',
        target: 'Client',
        fin: true,
        ack_flag: true,
        seq: 8000,
        ack: 5001,
      ),
      description: '服务器发送FIN包，表示服务器也准备断开连接',
      delay: 1000,
    ));

    events.add(TcpConnectionEvent(
      type: TcpEventType.STATE_CHANGE,
      source: 'Server',
      target: 'Server',
      oldState: TcpState.CLOSE_WAIT,
      newState: TcpState.LAST_ACK,
      description: '服务器状态：CLOSE_WAIT -> LAST_ACK',
      delay: 200,
    ));

    // 客户端接收FIN
    events.add(TcpConnectionEvent(
      type: TcpEventType.RECEIVE_PACKET,
      source: 'Client',
      target: 'Client',
      packet: TcpPacket(
        source: 'Server',
        target: 'Client',
        fin: true,
        ack_flag: true,
        seq: 8000,
        ack: 5001,
      ),
      description: '客户端接收到服务器的FIN包',
      delay: 800,
    ));

    // 第四次挥手：客户端发送ACK
    events.add(TcpConnectionEvent(
      type: TcpEventType.SEND_PACKET,
      source: 'Client',
      target: 'Server',
      packet: TcpPacket(
        source: 'Client',
        target: 'Server',
        ack_flag: true,
        seq: 5001,
        ack: 8001,
      ),
      description: '客户端发送ACK包，确认服务器的FIN',
      delay: 500,
    ));

    events.add(TcpConnectionEvent(
      type: TcpEventType.STATE_CHANGE,
      source: 'Client',
      target: 'Client',
      oldState: TcpState.FIN_WAIT_2,
      newState: TcpState.TIME_WAIT,
      description: '客户端状态：FIN_WAIT_2 -> TIME_WAIT',
      delay: 200,
    ));

    // 服务器接收ACK
    events.add(TcpConnectionEvent(
      type: TcpEventType.RECEIVE_PACKET,
      source: 'Server',
      target: 'Server',
      packet: TcpPacket(
        source: 'Client',
        target: 'Server',
        ack_flag: true,
        seq: 5001,
        ack: 8001,
      ),
      description: '服务器接收到客户端的ACK包',
      delay: 800,
    ));

    events.add(TcpConnectionEvent(
      type: TcpEventType.STATE_CHANGE,
      source: 'Server',
      target: 'Server',
      oldState: TcpState.LAST_ACK,
      newState: TcpState.CLOSED,
      description: '服务器状态：LAST_ACK -> CLOSED',
      delay: 200,
    ));

    // TIME_WAIT超时
    events.add(TcpConnectionEvent(
      type: TcpEventType.STATE_CHANGE,
      source: 'Client',
      target: 'Client',
      description: '客户端等待2MSL时间（约30-120秒）...',
      delay: 2000,
    ));

    events.add(TcpConnectionEvent(
      type: TcpEventType.STATE_CHANGE,
      source: 'Client',
      target: 'Client',
      oldState: TcpState.TIME_WAIT,
      newState: TcpState.CLOSED,
      description: '客户端状态：TIME_WAIT -> CLOSED',
      delay: 200,
    ));

    // 连接关闭完成
    events.add(TcpConnectionEvent(
      type: TcpEventType.STATE_CHANGE,
      source: 'Connection',
      target: 'Connection',
      description: '✅ TCP连接已完全关闭',
      delay: 500,
    ));

    return events;
  }

  /// 生成数据传输事件序列
  static List<TcpConnectionEvent> generateDataTransferEvents() {
    List<TcpConnectionEvent> events = [];
    
    // 客户端发送数据
    events.add(TcpConnectionEvent(
      type: TcpEventType.SEND_PACKET,
      source: 'Client',
      target: 'Server',
      packet: TcpPacket(
        source: 'Client',
        target: 'Server',
        ack_flag: true,
        seq: 3000,
        ack: 4000,
        data: 'Hello, Server!',
      ),
      description: '客户端发送数据："Hello, Server!"',
      delay: 1000,
    ));

    // 服务器接收数据
    events.add(TcpConnectionEvent(
      type: TcpEventType.RECEIVE_PACKET,
      source: 'Server',
      target: 'Server',
      packet: TcpPacket(
        source: 'Client',
        target: 'Server',
        ack_flag: true,
        seq: 3000,
        ack: 4000,
        data: 'Hello, Server!',
      ),
      description: '服务器接收到数据："Hello, Server!"',
      delay: 800,
    ));

    // 服务器发送ACK确认
    events.add(TcpConnectionEvent(
      type: TcpEventType.SEND_PACKET,
      source: 'Server',
      target: 'Client',
      packet: TcpPacket(
        source: 'Server',
        target: 'Client',
        ack_flag: true,
        seq: 4000,
        ack: 3014, // 3000 + 14字节数据
      ),
      description: '服务器发送ACK确认收到数据',
      delay: 500,
    ));

    // 服务器回复数据
    events.add(TcpConnectionEvent(
      type: TcpEventType.SEND_PACKET,
      source: 'Server',
      target: 'Client',
      packet: TcpPacket(
        source: 'Server',
        target: 'Client',
        ack_flag: true,
        seq: 4000,
        ack: 3014,
        data: 'Hello, Client!',
      ),
      description: '服务器回复数据："Hello, Client!"',
      delay: 500,
    ));

    // 客户端接收数据
    events.add(TcpConnectionEvent(
      type: TcpEventType.RECEIVE_PACKET,
      source: 'Client',
      target: 'Client',
      packet: TcpPacket(
        source: 'Server',
        target: 'Client',
        ack_flag: true,
        seq: 4000,
        ack: 3014,
        data: 'Hello, Client!',
      ),
      description: '客户端接收到数据："Hello, Client!"',
      delay: 800,
    ));

    // 客户端发送ACK确认
    events.add(TcpConnectionEvent(
      type: TcpEventType.SEND_PACKET,
      source: 'Client',
      target: 'Server',
      packet: TcpPacket(
        source: 'Client',
        target: 'Server',
        ack_flag: true,
        seq: 3014,
        ack: 4014, // 4000 + 14字节数据
      ),
      description: '客户端发送ACK确认收到数据',
      delay: 500,
    ));

    return events;
  }
}
