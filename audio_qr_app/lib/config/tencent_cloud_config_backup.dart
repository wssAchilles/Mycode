import 'dart:convert';
import '../services/tencent_cos_service.dart';

/// 腾讯云COS配置类
/// 🚨 安全警告：当前使用匿名访问模式，实际部署需要实现服务端签名！
/// 生产环境必须：
/// 1. 移除客户端密钥
/// 2. 实现服务端临时密钥服务
/// 3. 使用HTTPS和访问控制
class TencentCloudConfig {
  // 腾讯云密钥配置
  static const String secretId = 'AKID9HF0nU0LTPNCqGoJRSG3mOrBJrFRQCk3';
  static const String secretKey = '94nMjtqNmzzsY0EE0YszsY0EE1d2DAuQ';
  
  // COS存储桶配置 - 请替换为您的实际配置
  static const String bucketName = 'my-audio-files-123-1380453532'; // 您的存储桶名称
  static const String region = 'ap-nanjing'; // 您的存储桶所在地域
  
  // 上传文件的路径前缀
  static const String uploadPrefix = 'audio-files/';
  
  // 文件访问权限设置
  static const String acl = 'public-read'; // 公共读取权限，便于生成二维码链接
  
  // 可选：自定义域名（CDN域名）
  static const String? customDomain = null; // 如: 'https://your-custom-domain.com'
  
  // 腾讯云COS静态网站地址 - 与音频文件同一存储桶
  static const String wechatServerUrl = 'https://my-audio-files-123-1380453532.cos-website.ap-nanjing.myqcloud.com';
  
  // 签名有效期（秒）
  static const int signatureExpire = 3600; // 1小时
  
  // 支持的文件类型
  static const List<String> supportedExtensions = [
    'mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'wma',
    'mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv'
  ];
  
  // 最大文件大小（字节）
  static const int maxFileSize = 100 * 1024 * 1024; // 100MB
  
  /// 获取存储桶的完整域名
  static String get bucketDomain {
    return '$bucketName.cos.$region.myqcloud.com';
  }
  
  /// 获取文件访问URL的基础地址
  static String get baseUrl {
    if (customDomain != null) {
      return customDomain!;
    }
    return 'https://$bucketDomain';
  }
  /// 生成完整的文件访问URL
  static String buildFileUrl(String fileName) {
    return '$baseUrl/$uploadPrefix$fileName';
  }
  
  /// 生成浏览器播放URL - 直接使用参数方式（稳定方案）
  /// 暂时禁用自包含HTML生成，使用更稳定的参数传递方式
  static Future<String> buildBrowserPlayUrl(String fileName, String audioUrl) async {
    if (wechatServerUrl.isEmpty) {
      return audioUrl;
    }
    
    try {
      print('生成浏览器播放URL: $fileName');
      
      // 直接使用参数方式（更稳定）
      final playUrl = _buildParameterizedUrl(fileName, audioUrl);
      print('生成的播放URL: $playUrl');
      
      return playUrl;
      /* 暂时禁用自包含HTML方案，因为上传可能失败
      // 生成自包含的HTML内容
      final htmlContent = generateSelfContainedPlayerHTML(fileName, audioUrl);
      
      if (htmlContent.isNotEmpty) {
        /// 生成浏览器播放URL（直接返回音频文件URL）
  static Future<String> buildBrowserPlayUrl(String fileName, String audioUrl) async {
    try {
      print('生成浏览器播放URL: $fileName');
      print('直接返回音频文件URL: $audioUrl');
      
      // 直接返回音频文件的URL，浏览器会自动播放
      return audioUrl;
      
    } catch (e) {
      print('生成播放URL异常: $e');
      // 降级方案：仍然返回音频URL
      return audioUrl;
    }
  }
  
  /// 生成参数化URL（使用重定向页面确保参数保存）
  static String _buildParameterizedUrl(String fileName, String audioUrl) {
    try {
      final params = <String, String>{
        'title': fileName,
        'src': audioUrl,
      };
      
      final jsonString = jsonEncode(params);
      final encodedParams = base64Encode(utf8.encode(jsonString));
      
      // 使用集成播放器页面，避免跳转和localStorage问题
      return '$wechatServerUrl/player.html?data=$encodedParams';
    } catch (e) {
      final encodedFilename = Uri.encodeComponent(fileName);
      final encodedAudioUrl = Uri.encodeComponent(audioUrl);
      // 降级到直接访问play.html
      return '$wechatServerUrl/play.html?title=$encodedFilename&src=$encodedAudioUrl';
    }
  }
  
  /// 上传HTML到COS
  static Future<String?> _uploadHTMLToCOS(String htmlContent, String fileName) async {
    try {
      print('开始上传HTML文件到COS: $fileName');
      
      // 需要先导入TencentCOSService
      // 这里直接调用，在文件顶部需要添加import
      final uploadResult = await TencentCOSService.uploadHTMLContent(
        htmlContent,
        fileName,
      );
      
      if (uploadResult.success) {
        print('HTML文件上传成功: ${uploadResult.url}');
        return uploadResult.url;
      } else {
        print('HTML文件上传失败: ${uploadResult.error}');
        return null;
      }
      
    } catch (e) {
      print('HTML上传到COS异常: $e');
      return null;
    }
  }
  
  /// 生成并上传自包含的HTML播放器
  static Future<String?> generateAndUploadPlayer(String fileName, String audioUrl) async {
    try {
      // 生成HTML内容
      final htmlContent = generatePlayerHTML(fileName, audioUrl, '');
      
      if (htmlContent.isEmpty) {
        print('HTML内容生成失败');
        return null;
      }
      
      // 生成文件名
      final timestamp = DateTime.now().millisecondsSinceEpoch;
      final safeFileName = fileName.replaceAll(RegExp(r'[^\u4e00-\u9fa5\w\-_.]'), '_');
      final htmlFileName = 'player_${safeFileName}_$timestamp.html';
      
      print('生成自包含播放器: $htmlFileName');
      
      // 这里需要调用COS上传服务
      // 在实际应用中，需要在上传音频文件后调用此方法
      
      return '$wechatServerUrl/$htmlFileName';
      
    } catch (e) {
      print('生成播放器失败: $e');
      return null;
    }
  }
  
  /// 兼容旧方法名
  static Future<String> buildWechatPlayUrl(String fileName, String audioUrl) async {
    return await buildBrowserPlayUrl(fileName, audioUrl);
  }
  
  /// 生成自包含的HTML播放器内容（支持离线播放）
  static String generateSelfContainedPlayerHTML(String fileName, String audioUrl) {
    try {
      // 转义特殊字符
      final safeFileName = fileName.replaceAll('"', '&quot;').replaceAll("'", '&#39;');
      final safeAudioUrl = audioUrl.replaceAll('"', '&quot;').replaceAll("'", '&#39;');
      
      return '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>$safeFileName | $safeAudioUrl</title>
    
    <!-- 嵌入的音频信息 -->
    <meta name="audio-title" content="$safeFileName">
    <meta name="audio-src" content="$safeAudioUrl">
    <script type="application/json" id="audio-data">
    {
      "title": "$safeFileName",
      "src": "$safeAudioUrl",
      "generateTime": "${DateTime.now().toIso8601String()}"
    }
    </script>
    
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px;
        }
        .container {
            background: rgba(255, 255, 255, 0.95); backdrop-filter: blur(10px); border-radius: 20px;
            padding: 40px; box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1); max-width: 500px; width: 100%; text-align: center;
        }
        .title { font-size: 28px; color: #2c3e50; margin-bottom: 10px; font-weight: 700; }
        .subtitle { color: #7f8c8d; font-size: 14px; margin-bottom: 25px; }
        .filename {
            color: #34495e; margin-bottom: 25px; padding: 15px;
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
            border-radius: 12px; word-break: break-all; font-size: 16px; font-weight: 500;
            border-left: 4px solid #667eea;
        }
        .audio-container {
            margin-bottom: 25px; padding: 20px; background: #f8f9fa;
            border-radius: 15px; border: 2px dashed #dee2e6;
        }
        .audio-player { width: 100%; border-radius: 12px; outline: none; }
        .button-group { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; margin-bottom: 20px; }
        .btn {
            display: inline-flex; align-items: center; justify-content: center; text-decoration: none;
            padding: 14px 24px; border-radius: 25px; font-weight: 600; font-size: 16px;
            transition: all 0.3s ease; border: none; cursor: pointer; min-width: 120px; gap: 8px;
        }
        .btn-primary {
            background: linear-gradient(45deg, #667eea, #764ba2); color: white;
            box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
        }
        .btn-secondary {
            background: linear-gradient(45deg, #28a745, #20c997); color: white;
            box-shadow: 0 4px 15px rgba(40, 167, 69, 0.4);
        }
        .btn:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(102, 126, 234, 0.6); }
        .tips {
            margin-top: 20px; color: #6c757d; font-size: 14px; line-height: 1.8;
            padding: 15px; background: #f8f9fa; border-radius: 10px; border-left: 3px solid #17a2b8;
        }
        .debug-info {
            margin-top: 20px; padding: 15px; background: #f1f3f4; border-radius: 10px;
            font-family: monospace; font-size: 12px; text-align: left; max-height: 200px;
            overflow-y: auto; border: 1px solid #dee2e6;
        }
        .error-message, .success-message {
            padding: 15px; border-radius: 10px; margin-top: 15px; border: 1px solid;
        }
        .error-message { background: #f8d7da; color: #721c24; border-color: #f5c6cb; }
        .success-message { background: #d4edda; color: #155724; border-color: #c3e6cb; display: none; }
        @media (max-width: 480px) {
            .container { padding: 25px 20px; }
            .title { font-size: 24px; }
            .filename { font-size: 14px; padding: 12px; }
            .btn { padding: 12px 20px; font-size: 14px; min-width: 100px; }
            .button-group { flex-direction: column; align-items: center; }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1 class="title">🎵</h1>
        <p class="subtitle">自包含音频播放器</p>
        <div class="filename" id="filenameDisplay">$safeFileName</div>
        <div class="audio-container">
            <audio class="audio-player" id="audioPlayer" controls preload="auto">
                您的浏览器不支持音频播放功能。
            </audio>
        </div>
        <div class="button-group">
            <button class="btn btn-primary" id="playBtn" onclick="togglePlay()">
                <span id="playText">播放</span>
            </button>
            <a href="$safeAudioUrl" class="btn btn-secondary" target="_blank" download="$safeFileName">
                📥 下载音频
            </a>
        </div>
        
        <div class="tips">
            💡 <strong>自包含播放器</strong><br>
            • 音频信息已嵌入页面，支持离线播放<br>
            • 扫码后可直接在浏览器中播放<br>
            • 建议在WiFi环境下使用以节省流量
        </div>
        
        <div class="error-message" id="errorMessage" style="display: none;"></div>
        <div class="success-message" id="successMessage"></div>
        <div class="debug-info" id="debugInfo"></div>
    </div>
    
    <script>
        let audioPlayer = null, isPlaying = false;
        const elements = {
            audioPlayer: document.getElementById('audioPlayer'),
            filenameDisplay: document.getElementById('filenameDisplay'),
            playText: document.getElementById('playText'),
            errorMessage: document.getElementById('errorMessage'),
            debugInfo: document.getElementById('debugInfo')
        };
        
        document.addEventListener('DOMContentLoaded', function() {
            addDebugInfo('页面加载完成，开始初始化');
            initializePlayer();
        });
        
        function initializePlayer() {
            const audioData = parseAudioParams();
            if (!audioData.audioUrl) {
                showError('错误：缺少音频URL参数。');
                return;
            }
            
            elements.audioPlayer.src = audioData.audioUrl;
            elements.filenameDisplay.textContent = audioData.filename;
            audioPlayer = elements.audioPlayer;
            setupAudioEventListeners();
            addDebugInfo('播放器初始化成功');
        }
        
        function parseAudioParams() {
            addDebugInfo('开始解析音频参数');
            addDebugInfo('完整URL: ' + window.location.href);
            
            const isOfflineMode = window.location.protocol === 'file:' || 
                                 window.location.href.startsWith('content://');
            addDebugInfo('离线模式: ' + isOfflineMode);
            
            if (isOfflineMode) {
                return parseOfflineAudioInfo();
            }
            
            const urlParams = new URLSearchParams(window.location.search);
            const dataParam = urlParams.get('data');
            if (dataParam) {
                try {
                    const jsonString = atob(dataParam);
                    const params = JSON.parse(jsonString);
                    addDebugInfo('data参数解析成功');
                    return {
                        audioUrl: params.src || params.u,
                        filename: params.title || params.f || '音频文件'
                    };
                } catch (e) {
                    addDebugInfo('data参数解析失败: ' + e.message);
                }
            }
            
            return parseOfflineAudioInfo();
        }
        
        function parseOfflineAudioInfo() {
            const audioDataScript = document.getElementById('audio-data');
            if (audioDataScript) {
                try {
                    const audioData = JSON.parse(audioDataScript.textContent);
                    addDebugInfo('从脚本标签获取音频信息成功');
                    return {
                        audioUrl: audioData.src,
                        filename: audioData.title
                    };
                } catch (e) {
                    addDebugInfo('脚本标签解析失败: ' + e.message);
                }
            }
            
            const titleMeta = document.querySelector('meta[name="audio-title"]');
            const srcMeta = document.querySelector('meta[name="audio-src"]');
            if (titleMeta && srcMeta) {
                addDebugInfo('从meta标签获取音频信息');
                return {
                    audioUrl: srcMeta.content,
                    filename: titleMeta.content
                };
            }
            
            addDebugInfo('离线模式：无法获取音频信息');
            return { audioUrl: null, filename: '音频文件' };
        }
        
        function setupAudioEventListeners() {
            if (!audioPlayer) return;
            audioPlayer.addEventListener('play', () => {
                isPlaying = true;
                elements.playText.textContent = '暂停';
            });
            audioPlayer.addEventListener('pause', () => {
                isPlaying = false;
                elements.playText.textContent = '播放';
            });
            audioPlayer.addEventListener('error', () => {
                showError('音频加载失败，请检查网络连接');
            });
        }
        
        function togglePlay() {
            if (!audioPlayer) return;
            if (isPlaying) {
                audioPlayer.pause();
            } else {
                audioPlayer.play().catch(() => {
                    showError('播放失败，请检查音频文件');
                });
            }
        }
        
        function showError(message) {
            elements.errorMessage.style.display = 'block';
            elements.errorMessage.textContent = message;
            addDebugInfo('错误: ' + message);
        }
        
        function addDebugInfo(message) {
            const timestamp = new Date().toLocaleTimeString();
            const debugLine = timestamp + ': ' + message;
            elements.debugInfo.innerHTML += debugLine + '<br>';
            elements.debugInfo.scrollTop = elements.debugInfo.scrollHeight;
        }
    </script>
</body>
</html>''';
      
    } catch (e) {
      print('生成自包含HTML失败: $e');
      return '';
    }
  }
  
  /// 生成自包含的HTML播放器内容
  static String generatePlayerHTML(String fileName, String audioUrl, String templatePath) {
    try {
      // 这里应该读取模板文件，但在Flutter中我们直接返回模板字符串
      final template = _getPlayerTemplate();
      
      final now = DateTime.now();
      final generateTime = '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')} ${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
      
      // 替换模板中的占位符
      return template
          .replaceAll('{{AUDIO_TITLE}}', fileName)
          .replaceAll('{{AUDIO_URL}}', audioUrl)
          .replaceAll('{{GENERATE_TIME}}', generateTime);
          
    } catch (e) {
      print('生成HTML播放器失败: $e');
      return '';
    }
  }
  
  /// 获取播放器模板（简化版，实际项目中应该从文件读取）
  static String _getPlayerTemplate() {
    return '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
    <title>{{AUDIO_TITLE}} - 音频播放器</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'PingFang SC', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 15px;
        }
        .container {
            background: white; border-radius: 20px; padding: 30px 25px; max-width: 420px; width: 100%;
            box-shadow: 0 25px 50px rgba(0,0,0,0.15); text-align: center; position: relative;
        }
        .container::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, #667eea, #764ba2); }
        .title { color: #2c3e50; margin-bottom: 8px; font-size: 28px; font-weight: 700; }
        .subtitle { color: #7f8c8d; font-size: 14px; margin-bottom: 25px; }
        .filename { color: #34495e; margin-bottom: 25px; padding: 15px; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 12px; word-break: break-all; font-size: 16px; font-weight: 500; border-left: 4px solid #667eea; }
        .audio-container { margin-bottom: 25px; padding: 20px; background: #f8f9fa; border-radius: 15px; border: 2px dashed #dee2e6; }
        .audio-player { width: 100%; border-radius: 12px; outline: none; }
        .button-group { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; margin-bottom: 20px; }
        .btn { display: inline-flex; align-items: center; justify-content: center; text-decoration: none; padding: 14px 24px; border-radius: 25px; font-weight: 600; font-size: 16px; transition: all 0.3s ease; border: none; cursor: pointer; min-width: 120px; gap: 8px; }
        .btn-primary { background: linear-gradient(45deg, #667eea, #764ba2); color: white; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4); }
        .btn-secondary { background: linear-gradient(45deg, #28a745, #20c997); color: white; box-shadow: 0 4px 15px rgba(40, 167, 69, 0.4); }
        .tips { margin-top: 20px; color: #6c757d; font-size: 14px; line-height: 1.8; padding: 15px; background: #f8f9fa; border-radius: 10px; border-left: 3px solid #17a2b8; }
        .info { margin-top: 20px; color: #495057; font-size: 13px; line-height: 1.6; padding: 15px; background: #e9ecef; border-radius: 10px; border-left: 3px solid #6c757d; }
        @media (max-width: 480px) { .container { padding: 25px 20px; } .title { font-size: 24px; } .filename { font-size: 14px; padding: 12px; } .btn { padding: 12px 20px; font-size: 14px; min-width: 100px; } .button-group { flex-direction: column; align-items: center; } }
    </style>
</head>
<body>
    <div class="container">
        <h1 class="title">🎵</h1>
        <p class="subtitle">音频播放器</p>
        <div class="filename">{{AUDIO_TITLE}}</div>
        <div class="audio-container">
            <audio class="audio-player" controls preload="auto" src="{{AUDIO_URL}}">
                您的浏览器不支持音频播放功能。
            </audio>
        </div>
        <div class="button-group">
            <button class="btn btn-primary" onclick="document.querySelector('audio').play()">
                ▶️ 播放
            </button>
            <a href="{{AUDIO_URL}}" class="btn btn-secondary" target="_blank" download="{{AUDIO_TITLE}}">
                📥 下载音频
            </a>
        </div>
        <div class="tips">
            💡 <strong>使用提示：</strong><br>
            • 点击播放按钮开始播放音频<br>
            • 支持浏览器内直接播放和下载<br>
            • 可以保存此页面离线播放
        </div>
        <div class="info">
            📱 <strong>离线播放说明：</strong><br>
            此页面已包含完整的播放器功能，可以保存到本地离线使用。<br>
            生成时间：{{GENERATE_TIME}}
        </div>
    </div>
</body>
</html>''';
  }
  
  /// 生成简短随机ID
  static String _generateShortId() {
    final random = DateTime.now().millisecondsSinceEpoch % 999999;
    return random.toString();
  }
  
  /// 生成路径风格的ID
  static String _generatePathId() {
    final chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    final random = DateTime.now().millisecondsSinceEpoch;
    var result = '';
    var num = random;
    for (int i = 0; i < 6; i++) {
      result += chars[num % chars.length];
      num ~/= chars.length;
    }
    return result;
  }
  
  /// 生成简单的播放URL（用于测试）
  static String buildSimplePlayUrl(String fileName, String audioUrl) {
    if (wechatServerUrl.isEmpty) return audioUrl;
    
    final params = <String, String>{
      'f': fileName,
      'u': audioUrl,
    };
    final jsonString = jsonEncode(params);
    final encodedParams = base64Encode(utf8.encode(jsonString));
    return '$wechatServerUrl/play.html?data=$encodedParams';
  }
  
  /// 验证文件是否支持
  static bool isSupportedFile(String fileName) {
    final extension = fileName.split('.').last.toLowerCase();
    return supportedExtensions.contains(extension);
  }
  
  /// 验证文件大小是否在允许范围内
  static bool isValidFileSize(int fileSize) {
    return fileSize <= maxFileSize;
  }
}