import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import '../services/notification_service.dart';

/// 防沉迷显示组件
/// 
/// 提供用户使用时间统计和健康提醒功能
class AntiAddictionWidget extends StatefulWidget {
  const AntiAddictionWidget({super.key});

  @override
  State<AntiAddictionWidget> createState() => _AntiAddictionWidgetState();
}

class _AntiAddictionWidgetState extends State<AntiAddictionWidget> {
  final NotificationService _notificationService = NotificationService();
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  
  int _todayUsageMinutes = 0;
  int _sessionMinutes = 0;
  bool _isLoading = true;
  DateTime? _sessionStartTime;

  @override
  void initState() {
    super.initState();
    _loadUsageData();
    _startSessionTracking();
  }

  /// 加载今日使用时间数据
  Future<void> _loadUsageData() async {
    try {
      final user = FirebaseAuth.instance.currentUser;
      if (user == null) return;

      final now = DateTime.now();
      final todayStart = DateTime(now.year, now.month, now.day);

      final usageDoc = await _firestore
          .collection('users')
          .doc(user.uid)
          .collection('daily_usage')
          .doc('${todayStart.year}-${todayStart.month.toString().padLeft(2, '0')}-${todayStart.day.toString().padLeft(2, '0')}')
          .get();

      if (usageDoc.exists) {
        final data = usageDoc.data()!;
        setState(() {
          _todayUsageMinutes = data['totalMinutes'] ?? 0;
          _isLoading = false;
        });
      } else {
        setState(() {
          _todayUsageMinutes = 0;
          _isLoading = false;
        });
      }
    } catch (e) {
      debugPrint('加载使用数据失败: $e');
      setState(() {
        _isLoading = false;
      });
    }
  }

  /// 开始会话追踪
  void _startSessionTracking() {
    _sessionStartTime = DateTime.now();
    
    // 每分钟更新一次会话时间
    Stream.periodic(const Duration(minutes: 1)).listen((_) {
      if (_sessionStartTime != null) {
        final sessionDuration = DateTime.now().difference(_sessionStartTime!);
        setState(() {
          _sessionMinutes = sessionDuration.inMinutes;
        });
        
        // 检查是否需要发送提醒
        _checkUsageWarnings();
      }
    });
  }

  /// 检查使用时间警告
  void _checkUsageWarnings() {
    final totalMinutes = _todayUsageMinutes + _sessionMinutes;
    
    // 连续使用30分钟提醒
    if (_sessionMinutes > 0 && _sessionMinutes % 30 == 0) {
      _notificationService.sendUsageWarningNotification(
        '您已连续使用${_sessionMinutes}分钟，建议适当休息'
      );
    }
    
    // 每日使用时间80%警告
    if (totalMinutes >= 96 && totalMinutes < 120) {
      final remaining = 120 - totalMinutes;
      _notificationService.sendUsageWarningNotification(
        '今日已使用${totalMinutes}分钟，还可使用${remaining}分钟'
      );
    }
    
    // 每日使用时间达到上限
    if (totalMinutes >= 120) {
      _showDailyLimitDialog();
    }
  }

  /// 显示每日限制对话框
  void _showDailyLimitDialog() {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        title: const Row(
          children: [
            Icon(Icons.warning, color: Colors.orange),
            SizedBox(width: 8),
            Text('每日使用限制'),
          ],
        ),
        content: const Text(
          '您今日的使用时间已达到建议上限（120分钟）。\n\n'
          '为了您的身心健康，建议暂停使用，明天再继续。',
        ),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.of(context).pop();
              // 可以选择性地退出应用或导航到其他页面
            },
            child: const Text('我知道了'),
          ),
        ],
      ),
    );
  }

  /// 获取使用时间状态颜色
  Color _getUsageStatusColor(int minutes) {
    if (minutes < 60) return Colors.green;
    if (minutes < 96) return Colors.orange;
    return Colors.red;
  }

  /// 获取使用时间状态文本
  String _getUsageStatusText(int minutes) {
    if (minutes < 60) return '健康使用';
    if (minutes < 96) return '适度使用';
    if (minutes < 120) return '接近上限';
    return '超出建议';
  }

  /// 格式化时间显示
  String _formatDuration(int minutes) {
    final hours = minutes ~/ 60;
    final mins = minutes % 60;
    if (hours > 0) {
      return '${hours}小时${mins}分钟';
    }
    return '${mins}分钟';
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(16.0),
          child: Center(
            child: CircularProgressIndicator(),
          ),
        ),
      );
    }

    final totalMinutes = _todayUsageMinutes + _sessionMinutes;
    final progressValue = (totalMinutes / 120).clamp(0.0, 1.0);
    final statusColor = _getUsageStatusColor(totalMinutes);
    final statusText = _getUsageStatusText(totalMinutes);

    return Card(
      elevation: 2,
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 标题
            Row(
              children: [
                Icon(
                  Icons.access_time,
                  color: statusColor,
                ),
                const SizedBox(width: 8),
                const Text(
                  '使用时间统计',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const Spacer(),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: statusColor.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: statusColor),
                  ),
                  child: Text(
                    statusText,
                    style: TextStyle(
                      color: statusColor,
                      fontWeight: FontWeight.bold,
                      fontSize: 12,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),

            // 进度条
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      '今日总计: ${_formatDuration(totalMinutes)}',
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    Text(
                      '120分钟',
                      style: TextStyle(
                        fontSize: 14,
                        color: Colors.grey[600],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                LinearProgressIndicator(
                  value: progressValue,
                  backgroundColor: Colors.grey[300],
                  valueColor: AlwaysStoppedAnimation<Color>(statusColor),
                  minHeight: 8,
                ),
              ],
            ),
            const SizedBox(height: 16),

            // 详细统计
            Row(
              children: [
                Expanded(
                  child: _buildStatItem(
                    icon: Icons.today,
                    label: '本次会话',
                    value: _formatDuration(_sessionMinutes),
                    color: Colors.blue,
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: _buildStatItem(
                    icon: Icons.history,
                    label: '剩余时间',
                    value: totalMinutes >= 120 
                        ? '已超出' 
                        : _formatDuration(120 - totalMinutes),
                    color: totalMinutes >= 120 ? Colors.red : Colors.green,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),

            // 健康提示
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.blue.withOpacity(0.1),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: Colors.blue.withOpacity(0.3)),
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.lightbulb_outline,
                    color: Colors.blue[600],
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '健康提示',
                          style: TextStyle(
                            color: Colors.blue[600],
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const Text(
                          '建议每30分钟休息10分钟，保护视力健康',
                          style: TextStyle(fontSize: 12),
                        ),
                      ],
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

  /// 构建统计项目组件
  Widget _buildStatItem({
    required IconData icon,
    required String label,
    required String value,
    required Color color,
  }) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: color, size: 20),
              const SizedBox(width: 4),
              Text(
                label,
                style: TextStyle(
                  fontSize: 12,
                  color: Colors.grey[600],
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.bold,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}

/// 防沉迷设置页面
class AntiAddictionSettingsPage extends StatefulWidget {
  const AntiAddictionSettingsPage({super.key});

  @override
  State<AntiAddictionSettingsPage> createState() => _AntiAddictionSettingsPageState();
}

class _AntiAddictionSettingsPageState extends State<AntiAddictionSettingsPage> {
  bool _enableNotifications = true;
  int _dailyLimitMinutes = 120;
  int _warningIntervalMinutes = 30;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('防沉迷设置'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // 通知设置
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    '通知设置',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 16),
                  SwitchListTile(
                    title: const Text('启用提醒通知'),
                    subtitle: const Text('开启后会定时发送使用时间提醒'),
                    value: _enableNotifications,
                    onChanged: (value) {
                      setState(() {
                        _enableNotifications = value;
                      });
                    },
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          // 时间限制设置
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    '时间限制',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 16),
                  ListTile(
                    title: const Text('每日使用上限'),
                    subtitle: Text('${_dailyLimitMinutes}分钟'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () {
                      _showTimePicker(
                        context,
                        '每日使用上限',
                        _dailyLimitMinutes,
                        (value) => setState(() => _dailyLimitMinutes = value),
                      );
                    },
                  ),
                  const Divider(),
                  ListTile(
                    title: const Text('提醒间隔'),
                    subtitle: Text('${_warningIntervalMinutes}分钟'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () {
                      _showTimePicker(
                        context,
                        '提醒间隔',
                        _warningIntervalMinutes,
                        (value) => setState(() => _warningIntervalMinutes = value),
                      );
                    },
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          // 统计信息
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    '使用统计',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 16),
                  ListTile(
                    title: const Text('查看使用历史'),
                    subtitle: const Text('查看过去7天的使用记录'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () {
                      // 导航到使用历史页面
                    },
                  ),
                  const Divider(),
                  ListTile(
                    title: const Text('导出数据'),
                    subtitle: const Text('将使用数据导出为CSV文件'),
                    trailing: const Icon(Icons.download),
                    onTap: () {
                      // 导出数据功能
                    },
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// 显示时间选择器
  void _showTimePicker(
    BuildContext context,
    String title,
    int currentValue,
    Function(int) onChanged,
  ) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: SizedBox(
          height: 150,
          child: Column(
            children: [
              Text('当前设置: ${currentValue}分钟'),
              const SizedBox(height: 16),
              Expanded(
                child: ListView.builder(
                  itemCount: 12,
                  itemBuilder: (context, index) {
                    final minutes = (index + 1) * 15;
                    return ListTile(
                      title: Text('${minutes}分钟'),
                      selected: minutes == currentValue,
                      onTap: () {
                        onChanged(minutes);
                        Navigator.of(context).pop();
                      },
                    );
                  },
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('取消'),
          ),
        ],
      ),
    );
  }
}
