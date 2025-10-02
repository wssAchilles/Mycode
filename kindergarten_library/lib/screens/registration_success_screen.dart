import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'dart:io';

/// 注册成功页面 - 引导用户完成邮箱验证
class RegistrationSuccessScreen extends StatelessWidget {
  final String email;
  
  const RegistrationSuccessScreen({
    super.key,
    required this.email,
  });

  /// 尝试打开邮箱应用
  void _openEmailApp(BuildContext context) {
    try {
      if (Platform.isAndroid) {
        // Android上尝试打开邮箱应用
        _showEmailOptions(context);
      } else if (Platform.isIOS) {
        // iOS上尝试打开邮箱应用
        _showEmailOptions(context);
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('无法自动打开邮箱，请手动打开邮箱应用'),
          backgroundColor: Colors.orange,
        ),
      );
    }
  }

  /// 显示邮箱应用选项
  void _showEmailOptions(BuildContext context) {
    showModalBottomSheet(
      context: context,
      builder: (context) => Container(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              '选择邮箱应用',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 20),
            ListTile(
              leading: const Icon(Icons.email, color: Colors.blue),
              title: const Text('默认邮箱'),
              subtitle: const Text('打开系统默认邮箱应用'),
              onTap: () {
                Navigator.pop(context);
                _launchEmailApp('mailto:');
              },
            ),
            ListTile(
              leading: const Icon(Icons.web, color: Colors.green),
              title: const Text('网页邮箱'),
              subtitle: const Text('在浏览器中打开邮箱'),
              onTap: () {
                Navigator.pop(context);
                _showWebEmailOptions(context);
              },
            ),
            const SizedBox(height: 10),
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('取消'),
            ),
          ],
        ),
      ),
    );
  }

  /// 显示网页邮箱选项
  void _showWebEmailOptions(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('网页邮箱'),
        content: const Text('请手动在浏览器中访问您的邮箱网站\n（如 Gmail、QQ邮箱、163邮箱等）'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('知道了'),
          ),
        ],
      ),
    );
  }

  /// 尝试启动邮箱应用
  void _launchEmailApp(String url) {
    // 这里可以使用url_launcher插件来打开邮箱
    // 由于没有添加该依赖，这里只是示例
    debugPrint('尝试打开邮箱: $url');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.green[50],
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: Icon(Icons.arrow_back, color: Colors.green[700]),
          onPressed: () => Navigator.pop(context),
        ),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(32.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              // 成功图标
              Container(
                width: 120,
                height: 120,
                decoration: BoxDecoration(
                  color: Colors.green[100],
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  Icons.mark_email_read_outlined,
                  size: 60,
                  color: Colors.green[700],
                ),
              ),
              const SizedBox(height: 32),
              
              // 标题
              Text(
                '注册成功！',
                style: TextStyle(
                  fontSize: 28,
                  fontWeight: FontWeight.bold,
                  color: Colors.green[800],
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              
              // 副标题
              const Text(
                '验证邮件已发送',
                style: TextStyle(
                  fontSize: 18,
                  color: Colors.grey,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 32),
              
              // 说明文字
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(12),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.green.withOpacity(0.1),
                      blurRadius: 10,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
                child: Column(
                  children: [
                    Icon(
                      Icons.info_outline,
                      color: Colors.green[600],
                      size: 24,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      '我们已向以下邮箱发送了验证链接：',
                      style: TextStyle(
                        fontSize: 16,
                        color: Colors.grey[700],
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 8,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.green[50],
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        email,
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                          color: Colors.green[800],
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    const Text(
                      '请点击邮件中的验证链接来激活您的账户。点击链接后，应用将自动为您完成登录。',
                      style: TextStyle(
                        fontSize: 14,
                        color: Colors.grey,
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 32),
              
              // 打开邮箱按钮
              SizedBox(
                width: double.infinity,
                height: 48,
                child: ElevatedButton.icon(
                  onPressed: () => _openEmailApp(context),
                  icon: const Icon(Icons.mail_outline),
                  label: const Text(
                    '打开邮箱应用',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.green,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              
              // 稍后验证按钮
              SizedBox(
                width: double.infinity,
                height: 48,
                child: OutlinedButton(
                  onPressed: () {
                    // 返回到登录页面
                    Navigator.of(context).popUntil((route) => route.isFirst);
                  },
                  style: OutlinedButton.styleFrom(
                    side: BorderSide(color: Colors.green[700]!),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  child: Text(
                    '稍后验证',
                    style: TextStyle(
                      fontSize: 16,
                      color: Colors.green[700],
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 32),
              
              // 提示信息
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.blue[50],
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                    color: Colors.blue[200]!,
                    width: 1,
                  ),
                ),
                child: Row(
                  children: [
                    Icon(
                      Icons.lightbulb_outline,
                      color: Colors.blue[600],
                      size: 20,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        '未收到邮件？请检查垃圾邮件文件夹',
                        style: TextStyle(
                          fontSize: 12,
                          color: Colors.blue[700],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
