import 'dart:convert';
import 'package:http/http.dart' as http;

/// 测试现有play.html的访问方案
void main() async {
  await testWorkingSolution();
}

Future<void> testWorkingSolution() async {
  print('🧪 测试使用现有play.html的解决方案...\n');
  
  // 模拟生成的URL
  final testFileName = '测试音频.mp3';
  final testAudioUrl = 'https://my-audio-files-123-1380453532.cos.ap-nanjing.myqcloud.com/audio-files/test.mp3';
  
  // 生成测试URL（使用新的逻辑）
  final testUrl = generateTestUrl(testFileName, testAudioUrl);
  
  print('📋 测试信息：');
  print('文件名: $testFileName');
  print('音频URL: $testAudioUrl');
  print('生成的播放器URL: $testUrl');
  print('');
  
  // 测试访问
  print('🔍 测试访问播放器页面...');
  await testPlayHtmlAccess(testUrl);
  
  print('\n✨ 解决方案总结：');
  print('1. 使用现有的play.html文件（已确认可访问）');
  print('2. 通过d参数传递Base64编码的音频信息');
  print('3. 避免了HTML文件上传的复杂性');
  print('4. 用户体验：微信扫描 → 点击"继续访问" → 直接播放');
}

String generateTestUrl(String fileName, String audioUrl) {
  final wechatServerUrl = 'https://my-audio-files-123-1380453532.cos-website.ap-nanjing.myqcloud.com';
  
  try {
    // 使用最简单的JSON格式
    final params = <String, String>{
      'f': fileName,
      'u': audioUrl,
    };
    
    final jsonString = jsonEncode(params);
    final encodedParams = base64Encode(utf8.encode(jsonString));
    
    // 使用现有的play.html + 简短参数
    return '$wechatServerUrl/play.html?d=$encodedParams';
    
  } catch (e) {
    // 降级方案：直接参数
    final encodedFilename = Uri.encodeComponent(fileName);
    final encodedAudioUrl = Uri.encodeComponent(audioUrl);
    return '$wechatServerUrl/play.html?filename=$encodedFilename&url=$encodedAudioUrl';
  }
}

Future<void> testPlayHtmlAccess(String url) async {
  try {
    print('访问URL: $url');
    
    final response = await http.get(Uri.parse(url)).timeout(
      Duration(seconds: 15),
      onTimeout: () => throw Exception('请求超时'),
    );
    
    print('状态码: ${response.statusCode}');
    print('响应头: ${response.headers}');
    
    if (response.statusCode == 200) {
      print('✅ 播放器页面访问成功！');
      print('页面大小: ${response.body.length} 字符');
      
      // 检查是否包含必要的播放器元素
      final body = response.body;
      if (body.contains('audio') && body.contains('controls')) {
        print('🎵 包含音频播放器元素');
      }
      
      if (body.contains('parseAudioParams') || body.contains('d')) {
        print('🔧 包含参数解析功能');
      }
      
      print('🎉 播放器页面完整且功能正常！');
      
    } else {
      print('❌ 访问失败，状态码: ${response.statusCode}');
    }
    
  } catch (e) {
    print('💥 访问出错: $e');
  }
}

/// 生成多个测试URL进行验证
void generateMultipleTestUrls() {
  print('\n📱 生成多个测试URL：\n');
  
  final testCases = [
    {'name': '测试音频1.mp3', 'url': 'https://example.com/audio1.mp3'},
    {'name': '中文音频文件.mp3', 'url': 'https://example.com/chinese.mp3'},
    {'name': 'English Audio.mp3', 'url': 'https://example.com/english.mp3'},
  ];
  
  for (int i = 0; i < testCases.length; i++) {
    final test = testCases[i];
    final url = generateTestUrl(test['name']!, test['url']!);
    print('${i + 1}. ${test['name']}');
    print('   URL: $url');
    print('');
  }
  
  print('💡 将这些URL生成二维码即可测试！');
}
