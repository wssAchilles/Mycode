import 'dart:io';
import 'package:http/http.dart' as http;

/// 腾讯云COS静态网站访问调试脚本
/// 用于诊断为什么静态网站无法访问
void main() async {
  await debugCOSAccess();
}

Future<void> debugCOSAccess() async {
  final bucketName = 'my-audio-files-123-1380453532';
  final region = 'ap-nanjing';
  
  print('🔍 开始诊断腾讯云COS静态网站访问问题...\n');
  
  // 1. 测试COS存储桶访问
  print('1️⃣ 测试COS存储桶基础访问...');
  final cosUrl = 'https://$bucketName.cos.$region.myqcloud.com';
  await testUrl(cosUrl, '标准COS域名');
  
  // 2. 测试静态网站域名访问
  print('\n2️⃣ 测试静态网站域名访问...');
  final staticUrl = 'https://$bucketName.cos-website.$region.myqcloud.com';
  await testUrl(staticUrl, '静态网站域名');
  
  // 3. 测试具体的HTML文件
  print('\n3️⃣ 测试具体HTML文件访问...');
  final htmlUrl = '$staticUrl/player_1759049970956.html';
  await testUrl(htmlUrl, 'HTML文件');
  
  // 4. 测试其他可能存在的文件
  print('\n4️⃣ 测试其他可能的文件...');
  final indexUrl = '$staticUrl/index.html';
  await testUrl(indexUrl, 'index.html');
  
  final playUrl = '$staticUrl/play.html';
  await testUrl(playUrl, 'play.html');
  
  print('\n📋 诊断建议：');
  print('1. 如果COS域名可访问但静态网站域名不可访问 → 静态网站功能未开启');
  print('2. 如果静态网站域名可访问但HTML文件不可访问 → 文件不存在或权限问题');
  print('3. 如果都不可访问 → 存储桶不存在或网络问题');
  print('4. 请检查腾讯云控制台中的存储桶配置');
}

Future<void> testUrl(String url, String description) async {
  try {
    print('   测试 $description: $url');
    
    final response = await http.head(
      Uri.parse(url),
    ).timeout(
      Duration(seconds: 10),
      onTimeout: () => throw Exception('请求超时'),
    );
    
    print('   ✅ 状态码: ${response.statusCode}');
    print('   📄 响应头: ${response.headers}');
    
    if (response.statusCode == 200) {
      print('   🎉 访问成功！');
    } else if (response.statusCode == 403) {
      print('   🚫 权限不足，但存储桶存在');
    } else if (response.statusCode == 404) {
      print('   📭 文件不存在');
    } else {
      print('   ⚠️  其他状态码: ${response.statusCode}');
    }
    
  } catch (e) {
    print('   ❌ 访问失败: $e');
    
    if (e.toString().contains('DNS')) {
      print('   💡 可能原因: 域名解析失败，检查域名配置');
    } else if (e.toString().contains('timeout')) {
      print('   💡 可能原因: 网络超时，检查网络连接');
    } else if (e.toString().contains('connection')) {
      print('   💡 可能原因: 连接失败，检查防火墙设置');
    }
  }
}

/// 生成一个简单的测试HTML内容并尝试上传
Future<void> uploadTestHTML() async {
  print('\n🧪 尝试上传测试HTML文件...');
  
  final testHtml = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>COS测试页面</title>
</head>
<body>
    <h1>COS静态网站测试成功</h1>
    <p>生成时间: ${DateTime.now()}</p>
</body>
</html>''';
  
  final bucketDomain = 'my-audio-files-123-1380453532.cos.ap-nanjing.myqcloud.com';
  final fileName = 'test_${DateTime.now().millisecondsSinceEpoch}.html';
  final uploadUrl = 'https://$bucketDomain/$fileName';
  
  try {
    print('   上传到: $uploadUrl');
    
    final response = await http.put(
      Uri.parse(uploadUrl),
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'x-cos-acl': 'public-read',
      },
      body: testHtml,
    );
    
    print('   上传状态码: ${response.statusCode}');
    
    if (response.statusCode == 200 || response.statusCode == 201) {
      print('   ✅ 上传成功！');
      
      // 测试访问
      final staticUrl = 'https://my-audio-files-123-1380453532.cos-website.ap-nanjing.myqcloud.com/$fileName';
      print('   测试访问: $staticUrl');
      
      await Future.delayed(Duration(seconds: 3));
      
      final testResponse = await http.get(Uri.parse(staticUrl));
      print('   访问状态码: ${testResponse.statusCode}');
      
      if (testResponse.statusCode == 200) {
        print('   🎉 测试HTML文件可以正常访问！');
        print('   📄 内容长度: ${testResponse.body.length}');
      }
      
    } else {
      print('   ❌ 上传失败: ${response.statusCode} - ${response.body}');
    }
    
  } catch (e) {
    print('   💥 上传过程出错: $e');
  }
}
