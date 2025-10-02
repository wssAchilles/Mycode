import 'package:http/http.dart' as http;
import 'lib/config/tencent_cloud_config.dart';

/// 测试音频文件URL访问
void main() async {
  print('🧪 测试音频文件URL访问...\n');
  
  // 模拟一个音频文件URL
  final testFileName = 'test_audio.wav';
  final audioUrl = TencentCloudConfig.buildFileUrl(testFileName);
  
  print('📋 生成的音频URL: $audioUrl');
  print('🔗 URL分析:');
  print('   域名: ${Uri.parse(audioUrl).host}');
  print('   路径: ${Uri.parse(audioUrl).path}');
  print('');
  
  // 测试访问
  try {
    print('🔍 测试访问音频URL...');
    final response = await http.head(Uri.parse(audioUrl)).timeout(Duration(seconds: 10));
    
    print('   状态码: ${response.statusCode}');
    
    if (response.statusCode == 200) {
      print('   ✅ 音频文件可以访问！');
      print('   📊 Content-Type: ${response.headers['content-type']}');
      print('   📏 Content-Length: ${response.headers['content-length']}');
    } else if (response.statusCode == 404) {
      print('   ❌ 音频文件不存在 (404)');
      print('   💡 建议: 先上传一个测试音频文件');
    } else if (response.statusCode == 403) {
      print('   ❌ 权限不足 (403)');
      print('   💡 建议: 检查存储桶和文件的公有读权限');
    } else {
      print('   ⚠️  其他错误: ${response.statusCode}');
    }
    
  } catch (e) {
    print('   ❌ 连接失败: $e');
    
    if (e.toString().contains('timeout')) {
      print('   💡 建议: 网络超时，可能是网络连接问题');
    } else if (e.toString().contains('proxy')) {
      print('   💡 建议: 代理连接问题，尝试关闭代理');
    }
  }
  
  print('\n🎯 解决方案:');
  print('1. 确保存储桶设置为公有读');
  print('2. 确保audio-files文件夹有音频文件'); 
  print('3. 检查手机网络环境（关闭代理/VPN）');
  print('4. 测试直接在电脑浏览器访问上面的URL');
}
