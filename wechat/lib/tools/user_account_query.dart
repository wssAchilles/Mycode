import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/auth_service.dart';

/// 用户账号查询工具（开发/测试用）
/// 
/// 用于查看数据库中的所有用户账号信息
class UserAccountQueryTool extends StatefulWidget {
  @override
  _UserAccountQueryToolState createState() => _UserAccountQueryToolState();
}

class _UserAccountQueryToolState extends State<UserAccountQueryTool> {
  Map<String, Map<String, dynamic>>? _userAccounts;
  bool _isLoading = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _queryUserAccounts();
  }

  /// 查询所有用户账号
  Future<void> _queryUserAccounts() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final authService = Provider.of<AuthService>(context, listen: false);
      final accounts = await authService.getAllUserAccounts();
      
      setState(() {
        _userAccounts = accounts;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _errorMessage = '查询失败: $e';
        _isLoading = false;
      });
    }
  }

  /// 构建用户账号卡片
  Widget _buildUserAccountCard(String username, Map<String, dynamic> accountInfo) {
    return Card(
      margin: EdgeInsets.symmetric(vertical: 8, horizontal: 16),
      child: Padding(
        padding: EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 用户名
            Row(
              children: [
                Icon(Icons.person, color: Colors.blue),
                SizedBox(width: 8),
                Text(
                  '用户名: $username',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: Colors.blue,
                  ),
                ),
              ],
            ),
            SizedBox(height: 12),
            
            // 用户ID
            _buildInfoRow('用户ID', accountInfo['userId'] ?? '未知', Icons.fingerprint),
            
            // 密码哈希
            _buildInfoRow('密码哈希', accountInfo['passwordHash'] ?? '未知', Icons.lock),
            
            // 创建时间
            if (accountInfo['createdAt'] != null)
              _buildInfoRow('创建时间', accountInfo['createdAt'], Icons.access_time),
            
            // 头像信息
            if (accountInfo['avatarIpfsCid'] != null)
              _buildInfoRow('头像CID', accountInfo['avatarIpfsCid'], Icons.image),
            
            // 备注
            if (accountInfo['note'] != null)
              Container(
                margin: EdgeInsets.only(top: 8),
                padding: EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: Colors.orange.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Row(
                  children: [
                    Icon(Icons.info, color: Colors.orange, size: 16),
                    SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        accountInfo['note'],
                        style: TextStyle(
                          color: Colors.orange[800],
                          fontSize: 12,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              
            // 错误信息
            if (accountInfo['error'] != null)
              Container(
                margin: EdgeInsets.only(top: 8),
                padding: EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: Colors.red.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Row(
                  children: [
                    Icon(Icons.error, color: Colors.red, size: 16),
                    SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        accountInfo['error'],
                        style: TextStyle(
                          color: Colors.red[800],
                          fontSize: 12,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  /// 构建信息行
  Widget _buildInfoRow(String label, String value, IconData icon) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 16, color: Colors.grey[600]),
          SizedBox(width: 8),
          Expanded(
            child: RichText(
              text: TextSpan(
                style: TextStyle(color: Colors.black, fontSize: 14),
                children: [
                  TextSpan(
                    text: '$label: ',
                    style: TextStyle(fontWeight: FontWeight.w500),
                  ),
                  TextSpan(
                    text: value,
                    style: TextStyle(fontFamily: 'monospace'),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('用户账号查询工具'),
        backgroundColor: Colors.blue,
        actions: [
          IconButton(
            icon: Icon(Icons.refresh),
            onPressed: _queryUserAccounts,
            tooltip: '刷新',
          ),
        ],
      ),
      body: Column(
        children: [
          // 顶部信息栏
          Container(
            width: double.infinity,
            padding: EdgeInsets.all(16),
            color: Colors.blue.withOpacity(0.1),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '🔍 用户账号数据库查询结果',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                    color: Colors.blue[800],
                  ),
                ),
                SizedBox(height: 4),
                Text(
                  '以下是您应用中注册的所有用户账号信息',
                  style: TextStyle(
                    fontSize: 12,
                    color: Colors.blue[600],
                  ),
                ),
                if (_userAccounts != null)
                  Text(
                    '共找到 ${_userAccounts!.length} 个用户账号',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                      color: Colors.green[700],
                    ),
                  ),
              ],
            ),
          ),
          
          // 内容区域
          Expanded(
            child: _isLoading
                ? Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        CircularProgressIndicator(),
                        SizedBox(height: 16),
                        Text('正在查询用户账号...'),
                      ],
                    ),
                  )
                : _errorMessage != null
                    ? Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.error, size: 64, color: Colors.red),
                            SizedBox(height: 16),
                            Text(
                              _errorMessage!,
                              style: TextStyle(color: Colors.red),
                              textAlign: TextAlign.center,
                            ),
                            SizedBox(height: 16),
                            ElevatedButton(
                              onPressed: _queryUserAccounts,
                              child: Text('重试'),
                            ),
                          ],
                        ),
                      )
                    : _userAccounts == null || _userAccounts!.isEmpty
                        ? Center(
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(Icons.people_outline, size: 64, color: Colors.grey),
                                SizedBox(height: 16),
                                Text(
                                  '没有找到任何用户账号',
                                  style: TextStyle(
                                    fontSize: 16,
                                    color: Colors.grey[600],
                                  ),
                                ),
                                SizedBox(height: 8),
                                Text(
                                  '请先注册一些用户账号',
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: Colors.grey[500],
                                  ),
                                ),
                              ],
                            ),
                          )
                        : ListView.builder(
                            itemCount: _userAccounts!.length,
                            itemBuilder: (context, index) {
                              final username = _userAccounts!.keys.elementAt(index);
                              final accountInfo = _userAccounts![username]!;
                              return _buildUserAccountCard(username, accountInfo);
                            },
                          ),
          ),
        ],
      ),
    );
  }
}
