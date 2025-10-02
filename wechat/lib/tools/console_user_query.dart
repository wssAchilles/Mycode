import 'dart:io';
import '../services/auth_service.dart';
import '../services/filebase_service.dart';

/// 控制台用户账号查询工具
/// 
/// 直接在控制台运行，用于快速查询用户账号信息
Future<void> main() async {
  print('=== 微信应用用户账号查询工具 ===');
  print('');
  
  try {
    // 初始化服务
    final filebaseService = FilebaseService();
    final authService = AuthService(filebaseService);
    
    print('🔍 正在查询用户账号数据库...');
    print('');
    
    // 查询所有用户账号
    final userAccounts = await authService.getAllUserAccounts();
    
    if (userAccounts == null || userAccounts.isEmpty) {
      print('❌ 没有找到任何用户账号');
      print('');
      print('💡 建议：');
      print('   1. 确认应用中已经注册了用户');
      print('   2. 检查网络连接和Filebase配置');
      return;
    }
    
    print('✅ 查询成功！找到 ${userAccounts.length} 个用户账号');
    print('');
    print('📋 用户账号列表：');
    print('=' * 80);
    
    int index = 1;
    for (String username in userAccounts.keys) {
      final accountInfo = userAccounts[username]!;
      
      print('');
      print('👤 用户 #$index');
      print('   用户名: $username');
      print('   用户ID: ${accountInfo['userId']}');
      print('   密码哈希: ${accountInfo['passwordHash']}');
      
      if (accountInfo['createdAt'] != null) {
        print('   创建时间: ${accountInfo['createdAt']}');
      }
      
      if (accountInfo['avatarIpfsCid'] != null) {
        print('   头像CID: ${accountInfo['avatarIpfsCid']}');
      } else {
        print('   头像: 未设置');
      }
      
      if (accountInfo['error'] != null) {
        print('   ⚠️  错误: ${accountInfo['error']}');
      }
      
      if (accountInfo['note'] != null) {
        print('   📝 备注: ${accountInfo['note']}');
      }
      
      print('   ' + '-' * 50);
      index++;
    }
    
    print('');
    print('🔐 安全提醒：');
    print('   • 密码已使用SHA-256哈希算法加密');
    print('   • 无法从哈希值反推出原始密码');
    print('   • 这是正常的安全措施');
    print('');
    print('💻 常用测试账号建议：');
    print('   • 用户名: admin, 密码: 123456');
    print('   • 用户名: test1, 密码: 123456');
    print('   • 用户名: test2, 密码: 123456');
    print('');
    
  } catch (e) {
    print('❌ 查询失败: $e');
    print('');
    print('🔧 可能的解决方案：');
    print('   1. 检查网络连接');
    print('   2. 确认Filebase服务配置正确');
    print('   3. 确认应用权限设置');
  }
  
  print('=== 查询完成 ===');
}

/// 获取用户输入
String? getUserInput(String prompt) {
  stdout.write(prompt);
  return stdin.readLineSync();
}

/// 等待用户按键
void waitForUser() {
  print('');
  print('按回车键继续...');
  stdin.readLineSync();
}
