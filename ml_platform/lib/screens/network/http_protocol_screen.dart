import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'dart:async';

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

  @override
  void dispose() {
    _logScrollController.dispose();
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
    
    // Phase 1: DNS解析
    setState(() => _currentPhase = 'DNS解析');
    _addLog('正在解析域名: ${Uri.parse(_requestUrl).host}');
    await Future.delayed(const Duration(milliseconds: 500));
    _addLog('DNS解析完成: 93.184.216.34');
    
    // Phase 2: 建立TCP连接
    setState(() => _currentPhase = 'TCP连接');
    _addLog('正在建立TCP连接（三次握手）');
    await Future.delayed(const Duration(milliseconds: 800));
    _addLog('TCP连接建立成功');
    
    // Phase 3: TLS握手（如果是HTTPS）
    if (_requestUrl.startsWith('https://')) {
      setState(() => _currentPhase = 'TLS握手');
      _addLog('正在进行TLS/SSL握手');
      await Future.delayed(const Duration(milliseconds: 1000));
      _addLog('TLS握手完成，建立安全连接');
    }
    
    // Phase 4: 发送HTTP请求
    setState(() => _currentPhase = '发送请求');
    _addLog('请求行: $_selectedMethod ${Uri.parse(_requestUrl).path} HTTP/1.1');
    _requestHeaders.forEach((key, value) {
      _addLog('请求头: $key: $value');
    });
    await Future.delayed(const Duration(milliseconds: 600));
    
    // Phase 5: 接收响应
    setState(() => _currentPhase = '接收响应');
    await Future.delayed(const Duration(milliseconds: 1200));
    _simulateHttpResponse();
    
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
          ),
        ],
      ),
      body: Row(
        children: [
          // 左侧：请求配置和状态
          Expanded(
            flex: 3,
            child: Column(
              children: [
                // HTTP事务状态
                Card(
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
                            const Text(
                              'HTTP事务流程',
                              style: TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            if (_currentPhase.isNotEmpty)
                              Chip(
                                label: Text(_currentPhase),
                                backgroundColor: _isRequesting
                                    ? Colors.orange
                                    : Colors.green,
                              ),
                          ],
                        ),
                        const SizedBox(height: 20),
                        // 流程指示器
                        _buildFlowIndicator(),
                      ],
                    ),
                  ),
                ),
                // 请求配置
                Card(
                  margin: const EdgeInsets.all(8),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'HTTP请求配置',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
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
                                decoration: const InputDecoration(
                                  labelText: 'URL',
                                  border: OutlineInputBorder(),
                                ),
                                controller: TextEditingController(
                                    text: _requestUrl),
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
                        ElevatedButton.icon(
                          onPressed: _isRequesting ? null : _sendHttpRequest,
                          icon: const Icon(Icons.send),
                          label: const Text('发送请求'),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.teal,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                // 响应信息
                Expanded(
                  child: Card(
                    margin: const EdgeInsets.all(8),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: _statusCode == 0
                                ? Colors.grey.withOpacity(0.1)
                                : _statusCode < 300
                                    ? Colors.green.withOpacity(0.1)
                                    : Colors.red.withOpacity(0.1),
                            border: Border(
                              bottom: BorderSide(color: Colors.grey.shade300),
                            ),
                          ),
                          child: Row(
                            children: [
                              Icon(
                                Icons.download,
                                color: _statusCode == 0
                                    ? Colors.grey
                                    : _statusCode < 300
                                        ? Colors.green
                                        : Colors.red,
                              ),
                              const SizedBox(width: 8),
                              const Text(
                                'HTTP响应',
                                style: TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                              const Spacer(),
                              if (_statusCode > 0)
                                Text(
                                  '$_statusCode $_statusText',
                                  style: TextStyle(
                                    color: _statusCode < 300
                                        ? Colors.green
                                        : Colors.red,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                            ],
                          ),
                        ),
                        Expanded(
                          child: SingleChildScrollView(
                            padding: const EdgeInsets.all(12),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                if (_responseHeaders.isNotEmpty) ...[
                                  const Text(
                                    '响应头：',
                                    style: TextStyle(fontWeight: FontWeight.bold),
                                  ),
                                  const SizedBox(height: 8),
                                  ..._responseHeaders.entries.map((e) => Padding(
                                        padding: const EdgeInsets.symmetric(
                                            vertical: 2),
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
                                  const Text(
                                    '响应体：',
                                    style: TextStyle(fontWeight: FontWeight.bold),
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
                  ),
                ),
              ],
            ),
          ),
          // 右侧：日志
          Expanded(
            flex: 2,
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
                        bottom: BorderSide(color: Colors.grey.shade300),
                      ),
                    ),
                    child: const Row(
                      children: [
                        Icon(Icons.terminal, color: Colors.blue),
                        SizedBox(width: 8),
                        Text(
                          '事务日志',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
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
                                  ? Colors.red
                                  : log.contains('成功')
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
    );
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
                        ? (isCurrent ? Colors.orange : Colors.green)
                        : Colors.grey.shade300,
                  ),
                  child: Center(
                    child: Text(
                      '${index + 1}',
                      style: TextStyle(
                        color: isActive ? Colors.white : Colors.grey,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  phase,
                  style: TextStyle(
                    fontSize: 11,
                    color: isActive ? Colors.black : Colors.grey,
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
