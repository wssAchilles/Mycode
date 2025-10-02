import 'dart:io';
import 'package:http/http.dart' as http;

/// 测试COS访问状态
void main() async {
  print('🧪 测试COS访问状态...\n');
  
  // 测试不同的URL格式
  final urls = [
    'https://my-audio-files-123-1380453532.cos.ap-nanjing.myqcloud.com/',
    'https://my-audio-files-123-1380453532.cos-website.ap-nanjing.myqcloud.com/',
    'https://my-audio-files-123-1380453532.cos-website.ap-nanjing.myqcloud.com/play.html',
  ];
  
  for (final url in urls) {
    await testUrl(url);
  }
  
  print('\n📋 解决建议：');
  print('1. 检查网络代理设置');
  print('2. 尝试关闭VPN/代理');
  print('3. 检查COS静态网站配置');
  print('4. 验证存储桶权限设置');
}

Future<void> testUrl(String url) async {
  try {
    print('🔗 测试URL: $url');
    
    final response = await http.get(
      Uri.parse(url),
      headers: {'User-Agent': 'Mozilla/5.0 (compatible; TestClient/1.0)'}
    ).timeout(Duration(seconds: 10));
    
    print('   ✅ 状态码: ${response.statusCode}');
    print('   📝 响应长度: ${response.body.length} 字符');
    
    if (response.statusCode == 200) {
      print('   🎉 访问成功！\n');
    } else {
      print('   ⚠️  HTTP错误: ${response.statusCode}\n');
    }
    
  } catch (e) {
    print('   ❌ 连接失败: $e\n');
    
    if (e.toString().contains('proxy')) {
      print('   💡 提示: 检查代理设置');
    } else if (e.toString().contains('timeout')) {
      print('   💡 提示: 网络超时，检查网络连接');
    } else if (e.toString().contains('certificate')) {
      print('   💡 提示: SSL证书问题');
    }
    print('');
  }
}
