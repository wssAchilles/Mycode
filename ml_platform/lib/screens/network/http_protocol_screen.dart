import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:ml_platform/config/app_theme.dart';
import 'package:ml_platform/utils/responsive_layout.dart';
import 'package:ml_platform/widgets/common/responsive_container.dart';
import '../../models/network/base_models.dart';
import '../../models/network/tcp_stack.dart';

/// HTTP协议模拟界面
class HttpProtocolScreen extends StatefulWidget {
  const HttpProtocolScreen({Key? key}) : super(key: key);

  @override
  State<HttpProtocolScreen> createState() => _HttpProtocolScreenState();
}

class _HttpProtocolScreenState extends State<HttpProtocolScreen> {
  // HTTP请求配置
  String _selectedMethod = 'GET';
  String _requestUrl = 'https://api.example.com/users';
  final Map<String, String> _requestHeaders = {
    'User-Agent': 'Mozilla/5.0',
    'Accept': 'application/json',
  };
  final TextEditingController _headerKeyController = TextEditingController();
  final TextEditingController _headerValueController = TextEditingController();
  
  // HTTP响应
  int _statusCode = 0;
  String _statusText = '';
  final Map<String, String> _responseHeaders = {};
  String _responseBody = '';
  
  // 状态控制
  bool _isRequesting = false;
  String _currentPhase = '';
  
  // 日志
  final List<String> _logs = [];
  final ScrollController _logScrollController = ScrollController();
  
  // 视图控制
  bool _showRawResponse = false;
  
  // URL 输入控制器
  late final TextEditingController _urlController;

  @override
  void initState() {
    super.initState();
    _urlController = TextEditingController(text: _requestUrl);
  }

  @override
  void dispose() {
    _logScrollController.dispose();
    _urlController.dispose();
    _headerKeyController.dispose();
    _headerValueController.dispose();
    super.dispose();
  }

  void _sendHttpRequest() async {
    if (_isRequesting) return;
    
    setState(() {
      _isRequesting = true;
      _logs.clear();
      _responseHeaders.clear();
      _statusCode = 0;
      _statusText = '';
      _responseBody = '';
    });
    
    _addLog('开始HTTP请求');
    
    // Phase 1: DNS解析 (仍然模拟)
    setState(() => _currentPhase = 'DNS解析');
    _addLog('正在解析域名: ${Uri.parse(_requestUrl).host}');
    await Future.delayed(const Duration(milliseconds: 500));
    final serverIp = IpAddress('93.184.216.34');
    _addLog('DNS解析完成: ${serverIp.value}');
    
    // Phase 2: 建立TCP连接 (使用真实 FSM!)
    setState(() => _currentPhase = 'TCP连接');
    _addLog('正在建立TCP连接（三次握手）');
    
    // 创建一个虚拟的 TcpSocket (没有真实设备, 仅用于状态显示)
    final clientSocket = TcpSocket(
        localAddress: IpAddress('192.168.1.100'),
        localPort: 54321,
    );
    
    // 监听状态变化
    clientSocket.onStateChange = (oldState, newState) {
        _addLog('TCP状态: ${oldState.name} -> ${newState.name}');
    };
    
    // 发起连接 (在 UI 演示模式下, 没有真实网络, 所以不会等待 SYN+ACK)
    clientSocket.connect(serverIp, 80);
    
    // 模拟服务器响应 SYN+ACK (演示用)
    await Future.delayed(const Duration(milliseconds: 600));
    _addLog('收到 SYN+ACK (演示模拟)');
    clientSocket.receiveSegment(TcpSegment(
        sourcePort: 80, 
        destinationPort: 54321,
        syn: true, 
        ack: true, 
        sequenceNumber: 2000, 
        acknowledgementNumber: 1001,
    ));
    
    await Future.delayed(const Duration(milliseconds: 400));
    _addLog('TCP连接建立成功 ✅');
    
    // Phase 3: TLS握手（如果是HTTPS）
    if (_requestUrl.startsWith('https://')) {
      setState(() => _currentPhase = 'TLS握手');
      _addLog('正在进行TLS/SSL握手 (演示模拟)');
      await Future.delayed(const Duration(milliseconds: 800));
      _addLog('TLS握手完成，建立安全连接');
    }
    
    // Phase 4: 发送HTTP请求
    setState(() => _currentPhase = '发送请求');
    
    // 构建 Header 字符串
    final buffer = StringBuffer();
    _requestHeaders.forEach((k, v) => buffer.write('$k: $v\r\n'));
    
    final httpRequest = '$_selectedMethod ${Uri.parse(_requestUrl).path} HTTP/1.1\r\nHost: ${Uri.parse(_requestUrl).host}\r\n${buffer.toString()}';
    _addLog('发送: $httpRequest');
    
    // 通过 TcpSocket 发送 HTTP 请求 (演示)
    if (clientSocket.state == TcpState.established) {
        clientSocket.send(httpRequest);
    }
    
    await Future.delayed(const Duration(milliseconds: 600));
    
    // Phase 5: 接收响应
    setState(() => _currentPhase = '接收响应');
    await Future.delayed(const Duration(milliseconds: 800));
    
    _addLog('收到 HTTP 响应 (演示模拟)');
    _simulateHttpResponse();
    
    // 关闭连接 (四次挥手简化演示)
    clientSocket.close();
    await Future.delayed(const Duration(milliseconds: 400));
    
    setState(() {
      _isRequesting = false;
      _currentPhase = '完成';
    });
    
    _addLog('HTTP事务完成');
  }

  void _simulateHttpResponse() {
    setState(() {
      _statusCode = _selectedMethod == 'GET' ? 200 : 201;
      _statusText = _statusCode == 200 ? 'OK' : 'Created';
      
      _responseHeaders['Content-Type'] = 'application/json';
      _responseHeaders['Content-Length'] = '256';
      _responseHeaders['Server'] = 'nginx/1.18.0';
      _responseHeaders['Date'] = DateTime.now().toUtc().toString();
      _responseHeaders['Connection'] = 'keep-alive';
      _responseHeaders['Cache-Control'] = 'max-age=3600';
      
      if (_statusCode == 200) {
        _responseBody = '''
{
  "id": 1,
  "name": "John Doe",
  "email": "john@example.com",
  "created_at": "${DateTime.now().toIso8601String()}"
}''';
      }
    });
    
    _addLog('状态行: HTTP/1.1 $_statusCode $_statusText');
    _responseHeaders.forEach((key, value) {
      _addLog('响应头: $key: $value');
    });
    if (_responseBody.isNotEmpty) {
      _addLog('响应体: $_responseBody');
    }
  }

  String _getRawResponseText() {
    if (_statusCode == 0) return '';
    final buffer = StringBuffer();
    buffer.writeln('HTTP/1.1 $_statusCode $_statusText');
    _responseHeaders.forEach((k, v) => buffer.writeln('$k: $v'));
    buffer.writeln();
    buffer.write(_responseBody);
    return buffer.toString();
  }

  void _addLog(String message) {
    setState(() {
      _logs.add('[${DateTime.now().toString().substring(11, 19)}] $message');
    });
    
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
        title: const Text('HTTP协议模拟'),
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
              _buildTransactionCard(),
              const SizedBox(height: AppSpacing.md),
              _buildRequestConfigCard(),
              const SizedBox(height: AppSpacing.md),
              _buildResponsePanel(height: 320),
              const SizedBox(height: AppSpacing.md),
              _buildLogPanel(height: 260),
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
              _buildTransactionCard(),
              _buildRequestConfigCard(),
              Expanded(child: _buildResponsePanel()),
            ],
          ),
        ),
        Expanded(
          flex: 2,
          child: _buildLogPanel(),
        ),
      ],
    );
  }

  Widget _buildTransactionCard() {
    return Card(
      margin: const EdgeInsets.all(8),
      child: Container(
        height: 200,
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'HTTP事务流程',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                ),
                if (_currentPhase.isNotEmpty)
                  Chip(
                    label: Text(_currentPhase),
                    backgroundColor: _isRequesting
                        ? AppTheme.warning.withOpacity(0.2)
                        : AppTheme.success.withOpacity(0.2),
                    labelStyle: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: AppTheme.textPrimary,
                          fontWeight: FontWeight.w600,
                        ),
                  ),
              ],
            ),
            const SizedBox(height: 20),
            _buildFlowIndicator(),
          ],
        ),
      ),
    );
  }

  Widget _buildRequestConfigCard() {
    return Card(
      margin: const EdgeInsets.all(8),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'HTTP请求配置',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                SizedBox(
                  width: 120,
                  child: DropdownButtonFormField<String>(
                    value: _selectedMethod,
                    decoration: const InputDecoration(
                      labelText: '方法',
                      border: OutlineInputBorder(),
                    ),
                    items: ['GET', 'POST', 'PUT', 'DELETE']
                        .map((method) => DropdownMenuItem(
                              value: method,
                              child: Text(method),
                            ))
                        .toList(),
                    onChanged: (value) {
                      setState(() {
                        _selectedMethod = value!;
                      });
                    },
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextField(
                    controller: _urlController,
                    textDirection: TextDirection.ltr,
                    decoration: const InputDecoration(
                      labelText: 'URL',
                      border: OutlineInputBorder(),
                    ),
                    onChanged: (value) {
                      setState(() {
                        _requestUrl = value;
                      });
                    },
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Text(
              'Headers',
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
            ),
            const SizedBox(height: 8),
            ..._requestHeaders.entries.map((e) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: Row(
                    children: [
                      Text(
                        '${e.key}: ${e.value}',
                        style: const TextStyle(fontSize: 12, fontFamily: 'monospace'),
                      ),
                      const SizedBox(width: 8),
                      IconButton(
                        icon: const Icon(Icons.close, size: 16, color: AppTheme.textSecondary),
                        tooltip: '移除请求头',
                        onPressed: () => setState(() => _requestHeaders.remove(e.key)),
                      ),
                    ],
                  ),
                )),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _headerKeyController,
                    decoration: const InputDecoration(labelText: 'Key', isDense: true),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _headerValueController,
                    decoration: const InputDecoration(labelText: 'Value', isDense: true),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.add_circle, color: AppTheme.primary),
                  tooltip: '添加请求头',
                  onPressed: () {
                    if (_headerKeyController.text.isNotEmpty &&
                        _headerValueController.text.isNotEmpty) {
                      setState(() {
                        _requestHeaders[_headerKeyController.text] =
                            _headerValueController.text;
                        _headerKeyController.clear();
                        _headerValueController.clear();
                      });
                    }
                  },
                ),
              ],
            ),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: _isRequesting ? null : _sendHttpRequest,
              icon: const Icon(Icons.send),
              label: const Text('发送请求'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildResponsePanel({double? height}) {
    final content = Card(
      margin: const EdgeInsets.all(8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: _statusCode == 0
                  ? AppTheme.surfaceHighlight
                  : _statusCode < 300
                      ? AppTheme.success.withOpacity(0.15)
                      : AppTheme.error.withOpacity(0.15),
              border: const Border(
                bottom: BorderSide(color: AppTheme.borderSubtle),
              ),
            ),
            child: Row(
              children: [
                Icon(
                  Icons.download,
                  color: _statusCode == 0
                      ? AppTheme.textSecondary
                      : _statusCode < 300
                          ? AppTheme.success
                          : AppTheme.error,
                ),
                const SizedBox(width: 8),
                Text(
                  'HTTP响应',
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                ),
                const Spacer(),
                IconButton(
                  icon: Icon(_showRawResponse ? Icons.visibility_off : Icons.code),
                  tooltip: _showRawResponse ? '显示格式化视图' : '显示原始报文',
                  onPressed: () => setState(() => _showRawResponse = !_showRawResponse),
                  iconSize: 20,
                  constraints: const BoxConstraints(),
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                ),
                const SizedBox(width: 8),
                if (_statusCode > 0 && !_showRawResponse)
                  Text(
                    '$_statusCode $_statusText',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: _statusCode < 300
                              ? AppTheme.success
                              : AppTheme.error,
                          fontWeight: FontWeight.w700,
                        ),
                  ),
              ],
            ),
          ),
          Expanded(
            child: _showRawResponse
                ? Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    color: AppTheme.surface,
                    child: SingleChildScrollView(
                      child: SelectableText(
                        _getRawResponseText(),
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 12,
                        ),
                      ),
                    ),
                  )
                : SingleChildScrollView(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (_responseHeaders.isNotEmpty) ...[
                          Text(
                            '响应头',
                            style: Theme.of(context).textTheme.titleSmall?.copyWith(
                                  fontWeight: FontWeight.w700,
                                ),
                          ),
                          const SizedBox(height: 8),
                          ..._responseHeaders.entries.map((e) => Padding(
                                padding: const EdgeInsets.symmetric(vertical: 2),
                                child: Text(
                                  '${e.key}: ${e.value}',
                                  style: const TextStyle(
                                    fontFamily: 'monospace',
                                    fontSize: 12,
                                  ),
                                ),
                              )),
                        ],
                        if (_responseBody.isNotEmpty) ...[
                          const SizedBox(height: 16),
                          Text(
                            '响应体',
                            style: Theme.of(context).textTheme.titleSmall?.copyWith(
                                  fontWeight: FontWeight.w700,
                                ),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            _responseBody,
                            style: const TextStyle(
                              fontFamily: 'monospace',
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
          ),
        ],
      ),
    );

    return height == null ? content : SizedBox(height: height, child: content);
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
                const Icon(Icons.terminal, color: AppTheme.primary),
                const SizedBox(width: 8),
                Text(
                  '事务日志',
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
                return Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: Text(
                    log,
                    style: TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 11,
                      color: log.contains('错误')
                          ? AppTheme.error
                          : log.contains('成功')
                              ? AppTheme.success
                              : AppTheme.textSecondary,
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

  Widget _buildFlowIndicator() {
    final phases = ['DNS解析', 'TCP连接', 'TLS握手', '发送请求', '接收响应'];
    final currentIndex = phases.indexOf(_currentPhase);
    
    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: phases.asMap().entries.map((entry) {
            final index = entry.key;
            final phase = entry.value;
            final isActive = index <= currentIndex;
            final isCurrent = index == currentIndex;
            
            return Column(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: isActive
                        ? (isCurrent
                            ? AppTheme.warning
                            : AppTheme.success)
                        : AppTheme.surfaceHighlight,
                  ),
                  child: Center(
                    child: Text(
                      '${index + 1}',
                      style: TextStyle(
                        color: isActive ? AppTheme.textPrimary : AppTheme.textSecondary,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  phase,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: isActive
                            ? AppTheme.textPrimary
                            : AppTheme.textSecondary,
                      ),
                ),
              ],
            );
          }).toList(),
        ),
      ],
    );
  }

  void _showHelp() {
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('HTTP协议说明'),
          content: const SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('HTTP是应用层协议，用于传输超文本数据。'),
                SizedBox(height: 16),
                Text('HTTP方法：', style: TextStyle(fontWeight: FontWeight.bold)),
                Text('• GET: 获取资源'),
                Text('• POST: 创建资源'),
                Text('• PUT: 更新资源'),
                Text('• DELETE: 删除资源'),
                SizedBox(height: 16),
                Text('状态码：', style: TextStyle(fontWeight: FontWeight.bold)),
                Text('• 2xx: 成功'),
                Text('• 3xx: 重定向'),
                Text('• 4xx: 客户端错误'),
                Text('• 5xx: 服务器错误'),
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
