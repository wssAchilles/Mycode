import 'lib/config/tencent_cloud_config.dart';
import 'lib/services/tencent_cos_service.dart';

/// 离线播放器使用示例
/// 展示如何生成自包含的HTML播放器，避免微信URL参数检测问题
void main() async {
  // 示例：生成离线播放器
  await generateOfflinePlayer();
}

/// 生成自包含的HTML播放器示例
Future<void> generateOfflinePlayer() async {
  try {
    // 模拟音频文件信息
    final fileName = '测试音频文件.mp3';
    final audioUrl = 'https://my-audio-files-123-1380453532.cos.ap-nanjing.myqcloud.com/audio-files/test_audio.mp3';
    
    print('🎵 开始生成离线播放器...');
    
    // 第一步：生成HTML内容
    final htmlContent = TencentCloudConfig.generatePlayerHTML(
      fileName, 
      audioUrl, 
      ''  // 模板路径（这里直接使用内置模板）
    );
    
    if (htmlContent.isEmpty) {
      print('❌ HTML内容生成失败');
      return;
    }
    
    print('✅ HTML内容生成成功，长度：${htmlContent.length} 字符');
    
    // 第二步：生成唯一的HTML文件名
    final timestamp = DateTime.now().millisecondsSinceEpoch;
    final htmlFileName = 'player_${timestamp}.html';
    
    print('📁 HTML文件名：$htmlFileName');
    
    // 第三步：上传HTML文件到COS
    print('📤 正在上传HTML文件到腾讯云COS...');
    
    final uploadResult = await TencentCOSService.uploadHTMLContent(
      htmlContent,
      htmlFileName,
    );
    
    if (uploadResult.success) {
      print('🎉 上传成功！');
      print('🔗 播放器URL：${uploadResult.url}');
      
      // 第四步：生成二维码URL（这就是最终的URL）
      final qrCodeUrl = uploadResult.url!;
      print('📱 二维码内容：$qrCodeUrl');
      
      print('\n📋 使用说明：');
      print('1. 生成二维码：$qrCodeUrl');
      print('2. 用户扫描二维码');
      print('3. 如果微信提示"非官方网页"，点击"可在浏览器打开此网页来下载文件"');
      print('4. 下载HTML文件后，用浏览器打开即可离线播放');
      print('5. 或者直接在浏览器中访问该URL在线播放');
      
    } else {
      print('❌ 上传失败：${uploadResult.error}');
    }
    
  } catch (e) {
    print('💥 生成离线播放器时出错：$e');
  }
}

/// 批量生成多个播放器示例
Future<void> batchGenerateOfflinePlayers() async {
  final audioFiles = [
    {'name': '音频1.mp3', 'url': 'https://example.com/audio1.mp3'},
    {'name': '音频2.mp3', 'url': 'https://example.com/audio2.mp3'},
    {'name': '音频3.mp3', 'url': 'https://example.com/audio3.mp3'},
  ];
  
  print('🔄 开始批量生成播放器...');
  
  for (int i = 0; i < audioFiles.length; i++) {
    final audio = audioFiles[i];
    print('\n--- 处理第${i + 1}个音频文件 ---');
    
    final htmlContent = TencentCloudConfig.generatePlayerHTML(
      audio['name']!,
      audio['url']!,
      '',
    );
    
    final timestamp = DateTime.now().millisecondsSinceEpoch + i;
    final htmlFileName = 'player_${timestamp}.html';
    
    final result = await TencentCOSService.uploadHTMLContent(
      htmlContent,
      htmlFileName,
    );
    
    if (result.success) {
      print('✅ ${audio['name']} - 播放器生成成功');
      print('   URL: ${result.url}');
    } else {
      print('❌ ${audio['name']} - 生成失败: ${result.error}');
    }
    
    // 避免请求过于频繁
    await Future.delayed(Duration(milliseconds: 500));
  }
  
  print('\n🎉 批量生成完成！');
}

/// 清理过期的播放器文件（可选功能）
Future<void> cleanupExpiredPlayers() async {
  print('🧹 清理过期播放器文件...');
  
  // 这里可以实现清理逻辑
  // 例如：删除超过7天的播放器HTML文件
  
  print('💡 提示：可以在COS控制台设置生命周期规则自动删除过期文件');
}
