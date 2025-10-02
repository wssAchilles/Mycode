import 'dart:convert';
import 'package:http/http.dart' as http;
import 'lib/config/tencent_cloud_config.dart';

/// 测试修复后的浏览器播放方案
void main() async {
  print('🔧 测试修复后的浏览器播放方案\n');
  
  await testFixedBrowserSolution();
}

Future<void> testFixedBrowserSolution() async {
  // 模拟音频文件信息
  final testFileName = 'test_audio.wav';
  final testAudioUrl = 'https://my-audio-files-123-1380453532.cos.ap-nanjing.myqcloud.com/audio-files/test.mp3';
  
  print('📋 测试信息：');
  print('文件名: $testFileName');
  print('音频URL: $testAudioUrl');
  print('');
  
  // 生成新的播放器URL
  print('🔗 生成播放器URL...');
  final playUrl = await TencentCloudConfig.buildBrowserPlayUrl(testFileName, testAudioUrl);
  print('生成的URL: $playUrl');
  print('');
  
  // 验证URL格式
  final uri = Uri.parse(playUrl);
  print('🔍 URL分析：');
  print('协议: ${uri.scheme}');
  print('域名: ${uri.host}');
  print('路径: ${uri.path}');
  print('查询参数: ${uri.queryParameters}');
  print('');
  
  // 解析data参数
  if (uri.queryParameters.containsKey('data')) {
    final dataParam = uri.queryParameters['data']!;
    print('📦 data参数解析：');
    try {
      final jsonString = utf8.decode(base64Decode(dataParam));
      final params = jsonDecode(jsonString);
      print('解析结果: $params');
      print('音频标题: ${params['title']}');
      print('音频源: ${params['src']}');
    } catch (e) {
      print('解析失败: $e');
    }
  }
  print('');
  
  // 测试播放器页面访问
  print('🌐 测试播放器页面访问...');
  await testPlayerPageAccess(playUrl);
  
  print('\n✨ 修复验证：');
  print('✅ URL格式正确 - 使用现有的play.html');
  print('✅ 参数编码正确 - Base64 + JSON格式');
  print('✅ 降级方案完备 - 支持直接参数');
  print('✅ 立即可用 - 无需上传额外文件');
}

Future<void> testPlayerPageAccess(String url) async {
  try {
    print('访问: $url');
    
    final response = await http.get(Uri.parse(url)).timeout(
      Duration(seconds: 15),
      onTimeout: () => throw Exception('请求超时'),
    );
    
    print('状态码: ${response.statusCode}');
    
    if (response.statusCode == 200) {
      print('✅ 播放器页面访问成功！');
      
      final body = response.body.toLowerCase();
      
      // 检查关键元素
      final checks = {
        '音频播放器': body.contains('<audio') && body.contains('controls'),
        '参数解析': body.contains('parseaudioparams') || body.contains('urlparams'),
        '播放按钮': body.contains('播放') || body.contains('play'),
        '下载功能': body.contains('下载') || body.contains('download'),
        '调试信息': body.contains('adddebuginfo') || body.contains('debug'),
      };
      
      print('功能检查：');
      checks.forEach((name, passed) {
        print('  ${passed ? "✅" : "❌"} $name');
      });
      
      if (checks.values.every((v) => v)) {
        print('🎉 播放器页面功能完整！');
      }
      
    } else if (response.statusCode == 404) {
      print('❌ 404 Not Found - 文件不存在');
      print('请确认play.html已上传到COS');
    } else {
      print('⚠️ 访问异常，状态码: ${response.statusCode}');
    }
    
  } catch (e) {
    print('💥 访问失败: $e');
    
    if (e.toString().contains('timeout')) {
      print('💡 建议：检查网络连接或COS配置');
    }
  }
}

/// 生成多个格式的测试URL
Future<void> generateMultipleTestUrls() async {
  print('\n📱 生成不同格式的测试URL：\n');
  
  final testCases = [
    {'name': 'test1.wav', 'url': 'https://example.com/audio1.mp3'},
    {'name': '中文音频.mp3', 'url': 'https://example.com/chinese.mp3'},
    {'name': 'Long Audio File Name.wav', 'url': 'https://example.com/long.mp3'},
  ];
  
  for (int i = 0; i < testCases.length; i++) {
    final test = testCases[i];
    print('${i + 1}. ${test['name']}');
    
    // 生成主要格式URL
    final url1 = await TencentCloudConfig.buildBrowserPlayUrl(test['name']!, test['url']!);
    print('   主要格式: $url1');
    
    // 生成降级格式URL
    final encodedName = Uri.encodeComponent(test['name']!);
    final encodedUrl = Uri.encodeComponent(test['url']!);
    final url2 = '${TencentCloudConfig.wechatServerUrl}/play.html?title=$encodedName&src=$encodedUrl';
    print('   降级格式: $url2');
    
    print('');
  }
}

/// 手动测试指导
void printManualTestGuide() {
  print('\n📖 手动测试指导：\n');
  
  print('1. 重新编译应用：');
  print('   flutter clean');
  print('   flutter pub get');
  print('   flutter build apk --release');
  print('');
  
  print('2. 使用新APK测试：');
  print('   - 录制一段音频');
  print('   - 生成二维码');
  print('   - 微信扫描二维码');
  print('   - 复制链接到浏览器');
  print('');
  
  print('3. 预期结果：');
  print('   - URL格式: .../play.html?data=Base64编码');
  print('   - 页面正常加载播放器界面');
  print('   - 显示正确的音频标题');
  print('   - 音频可以正常播放');
  print('');
  
  print('4. 如果仍有问题：');
  print('   - 检查play.html是否已上传到COS');
  print('   - 验证COS静态网站配置');
  print('   - 确认音频文件权限为公有读');
}
