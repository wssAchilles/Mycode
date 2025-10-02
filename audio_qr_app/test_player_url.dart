import 'dart:convert';

/// 测试player.html URL生成
void main() {
  print('🧪 测试player.html URL生成\n');
  
  // 测试数据
  final testFileName = '测试音频.wav';
  final testAudioUrl = 'https://my-audio-files-123-1380453532.cos.ap-nanjing.myqcloud.com/audio-files/test.wav';
  
  // 生成参数
  final params = {
    'title': testFileName,
    'src': testAudioUrl,
  };
  
  final jsonString = jsonEncode(params);
  final encodedParams = base64Encode(utf8.encode(jsonString));
  
  // 生成完整URL
  final baseUrl = 'https://my-audio-files-123-1380453532.cos-website.ap-nanjing.myqcloud.com';
  final fullUrl = '$baseUrl/player.html?data=$encodedParams';
  
  print('📋 生成的URL信息：');
  print('文件名: $testFileName');
  print('音频URL: $testAudioUrl');
  print('');
  print('🔗 完整URL：');
  print(fullUrl);
  print('');
  print('📊 URL分析：');
  print('Base URL: $baseUrl/player.html');
  print('参数长度: ${encodedParams.length} 字符');
  print('JSON数据: $jsonString');
  print('Base64编码: $encodedParams');
  print('');
  print('✅ 测试步骤：');
  print('1. 复制上面的完整URL');
  print('2. 在浏览器中粘贴访问');
  print('3. 应该看到加载动画然后显示播放器');
  print('4. 如果成功，说明URL格式正确');
}
