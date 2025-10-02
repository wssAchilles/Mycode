import 'dart:convert';
import 'dart:io';

/// 创建自包含的HTML播放器
/// 将音频信息直接嵌入HTML文件中，支持离线播放
void main() async {
  print('🎵 创建自包含HTML播放器...\n');
  
  // 解析您刚才的URL参数
  await createPlayerFromUrl();
}

Future<void> createPlayerFromUrl() async {
  // 您的URL中的data参数
  final dataParam = 'eyJ0aXRsZSI6IuiWhOeypS53YXYiLCJzcmMiOiJodHRwczovL215LWF1ZGlvLWZpbGVzLTEyMy0xMzgwNDUzNTMyLmNvcy5hcC1uYW5qaW5nLm15cWNsb3VkLmNvbS9hdWRpby1maWxlcy8lRTglOTYlODQlRTclQjIlQTVfNzA2NDkxLndhdiJ9';
  
  try {
    // 解析参数
    final jsonString = utf8.decode(base64Decode(dataParam));
    final params = jsonDecode(jsonString);
    
    final fileName = params['title'] ?? '音频文件';
    final audioUrl = params['src'] ?? '';
    
    print('📋 解析结果：');
    print('文件名: $fileName');
    print('音频URL: $audioUrl');
    print('');
    
    if (audioUrl.isEmpty) {
      print('❌ 音频URL为空，无法创建播放器');
      return;
    }
    
    // 创建自包含HTML
    final htmlContent = generateSelfContainedHTML(fileName, audioUrl);
    
    // 保存到文件
    final outputFile = File('d:\\Code\\audio_qr_app\\self_contained_player.html');
    await outputFile.writeAsString(htmlContent, encoding: utf8);
    
    print('✅ 自包含播放器创建成功！');
    print('文件路径: ${outputFile.absolute.path}');
    print('');
    print('📱 使用方法：');
    print('1. 双击打开 self_contained_player.html');
    print('2. 或在浏览器中打开该文件');
    print('3. 音频信息已嵌入，支持离线播放');
    
  } catch (e) {
    print('❌ 解析参数失败: $e');
  }
}

/// 生成自包含的HTML播放器
String generateSelfContainedHTML(String fileName, String audioUrl) {
  return '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>$fileName | $audioUrl</title>
    
    <!-- 嵌入的音频信息 -->
    <meta name="audio-title" content="$fileName">
    <meta name="audio-src" content="$audioUrl">
    <script type="application/json" id="audio-data">
    {
      "title": "$fileName",
      "src": "$audioUrl",
      "generateTime": "${DateTime.now().toIso8601String()}"
    }
    </script>
    
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        
        .container {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
            max-width: 500px;
            width: 100%;
            text-align: center;
        }
        
        .title {
            font-size: 28px;
            color: #2c3e50;
            margin-bottom: 10px;
            font-weight: 700;
        }
        
        .subtitle {
            color: #7f8c8d;
            font-size: 14px;
            margin-bottom: 25px;
        }
        
        .filename {
            color: #34495e;
            margin-bottom: 25px;
            padding: 15px;
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
            border-radius: 12px;
            word-break: break-all;
            font-size: 16px;
            font-weight: 500;
            border-left: 4px solid #667eea;
        }
        
        .audio-container {
            margin-bottom: 25px;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 15px;
            border: 2px dashed #dee2e6;
        }
        
        .audio-player {
            width: 100%;
            border-radius: 12px;
            outline: none;
        }
        
        .button-group {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
            justify-content: center;
            margin-bottom: 20px;
        }
        
        .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            text-decoration: none;
            padding: 14px 24px;
            border-radius: 25px;
            font-weight: 600;
            font-size: 16px;
            transition: all 0.3s ease;
            border: none;
            cursor: pointer;
            min-width: 120px;
            gap: 8px;
        }
        
        .btn-primary {
            background: linear-gradient(45deg, #667eea, #764ba2);
            color: white;
            box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
        }
        
        .btn-secondary {
            background: linear-gradient(45deg, #28a745, #20c997);
            color: white;
            box-shadow: 0 4px 15px rgba(40, 167, 69, 0.4);
        }
        
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(102, 126, 234, 0.6);
        }
        
        .tips {
            margin-top: 20px;
            color: #6c757d;
            font-size: 14px;
            line-height: 1.8;
            padding: 15px;
            background: #f8f9fa;
            border-radius: 10px;
            border-left: 3px solid #17a2b8;
        }
        
        .debug-info {
            margin-top: 20px;
            padding: 15px;
            background: #f1f3f4;
            border-radius: 10px;
            font-family: monospace;
            font-size: 12px;
            text-align: left;
            max-height: 200px;
            overflow-y: auto;
            border: 1px solid #dee2e6;
        }
        
        .error-message {
            background: #f8d7da;
            color: #721c24;
            padding: 15px;
            border-radius: 10px;
            margin-top: 15px;
            border: 1px solid #f5c6cb;
        }
        
        .success-message {
            background: #d4edda;
            color: #155724;
            padding: 15px;
            border-radius: 10px;
            margin-top: 15px;
            border: 1px solid #c3e6cb;
            display: none;
        }
        
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
        <div class="filename" id="filenameDisplay">$fileName</div>
        <div class="audio-container">
            <audio class="audio-player" id="audioPlayer" controls preload="auto">
                您的浏览器不支持音频播放功能。
            </audio>
        </div>
        <div class="button-group">
            <button class="btn btn-primary" id="playBtn" onclick="togglePlay()">
                <span id="playText">播放</span>
            </button>
            <a href="$audioUrl" class="btn btn-secondary" id="downloadBtn" target="_blank" download="$fileName">
                📥 下载音频
            </a>
        </div>
        
        <div class="tips">
            💡 <strong>自包含播放器</strong><br>
            • 音频信息已嵌入页面，支持离线播放<br>
            • 可保存此HTML文件到本地使用<br>
            • 建议在WiFi环境下使用以节省流量<br>
            • 生成时间: ${DateTime.now().toString()}
        </div>
        
        <div class="error-message" id="errorMessage" style="display: none;"></div>
        <div class="success-message" id="successMessage"></div>
        <div class="debug-info" id="debugInfo"></div>
    </div>
    
    <script>
        // 全局变量
        let audioPlayer = null;
        let isPlaying = false;
        
        // DOM元素
        const elements = {
            audioPlayer: document.getElementById('audioPlayer'),
            filenameDisplay: document.getElementById('filenameDisplay'),
            playBtn: document.getElementById('playBtn'),
            playText: document.getElementById('playText'),
            downloadBtn: document.getElementById('downloadBtn'),
            errorMessage: document.getElementById('errorMessage'),
            successMessage: document.getElementById('successMessage'),
            debugInfo: document.getElementById('debugInfo')
        };
        
        // 页面加载完成后初始化
        document.addEventListener('DOMContentLoaded', function() {
            addDebugInfo('页面加载完成，开始初始化');
            initializePlayer();
        });
        
        // 初始化播放器
        function initializePlayer() {
            const audioData = parseAudioParams();
            
            if (!audioData.audioUrl) {
                showError('错误：缺少音频URL参数。请确保链接包含正确的参数。');
                return;
            }
            
            // 设置音频源和文件名
            elements.audioPlayer.src = audioData.audioUrl;
            elements.filenameDisplay.textContent = audioData.filename;
            elements.downloadBtn.href = audioData.audioUrl;
            elements.downloadBtn.download = audioData.filename;
            
            // 设置全局变量
            audioPlayer = elements.audioPlayer;
            
            // 添加音频事件监听器
            setupAudioEventListeners();
            
            addDebugInfo('播放器初始化成功');
            addDebugInfo('音频URL: ' + audioData.audioUrl);
            addDebugInfo('文件名: ' + audioData.filename);
        }
        
        // 解析音频参数
        function parseAudioParams() {
            addDebugInfo('开始解析音频参数');
            addDebugInfo('完整URL: ' + window.location.href);
            
            // 检测是否为离线模式
            const isOfflineMode = window.location.protocol === 'file:' || 
                                 window.location.href.startsWith('content://') ||
                                 window.location.href.startsWith('android_asset://');
            
            addDebugInfo('离线模式: ' + isOfflineMode);
            
            if (isOfflineMode) {
                addDebugInfo('检测到离线模式，从嵌入数据获取音频信息');
                return parseOfflineAudioInfo();
            }
            
            // 在线模式：解析URL参数
            const urlParams = new URLSearchParams(window.location.search);
            addDebugInfo('查询参数: ' + window.location.search);
            
            // 解析data参数
            const dataParam = urlParams.get('data');
            if (dataParam) {
                addDebugInfo('找到data参数');
                try {
                    const jsonString = atob(dataParam);
                    const params = JSON.parse(jsonString);
                    
                    addDebugInfo('data参数解析成功: ' + JSON.stringify(params));
                    
                    return {
                        audioUrl: params.src || params.u || params.source,
                        filename: params.title || params.f || params.n || params.content || '音频文件'
                    };
                } catch (e) {
                    addDebugInfo('data参数解析失败: ' + e.message);
                }
            }
            
            // 降级处理
            return parseOfflineAudioInfo();
        }
        
        // 离线模式音频信息解析
        function parseOfflineAudioInfo() {
            addDebugInfo('开始解析离线模式音频信息');
            
            // 方法1: 从页面嵌入的脚本标签中读取
            const audioDataScript = document.getElementById('audio-data');
            if (audioDataScript) {
                try {
                    const audioData = JSON.parse(audioDataScript.textContent);
                    addDebugInfo('从脚本标签获取音频信息成功: ' + JSON.stringify(audioData));
                    return {
                        audioUrl: audioData.src || audioData.url,
                        filename: audioData.title || audioData.name || '音频文件'
                    };
                } catch (e) {
                    addDebugInfo('脚本标签解析失败: ' + e.message);
                }
            }
            
            // 方法2: 从meta标签中读取
            const titleMeta = document.querySelector('meta[name="audio-title"]');
            const srcMeta = document.querySelector('meta[name="audio-src"]');
            if (titleMeta && srcMeta) {
                addDebugInfo('从meta标签获取音频信息');
                return {
                    audioUrl: srcMeta.content,
                    filename: titleMeta.content
                };
            }
            
            // 方法3: 从页面标题中提取
            const pageTitle = document.title;
            if (pageTitle && pageTitle.includes('|')) {
                const parts = pageTitle.split('|');
                if (parts.length >= 2) {
                    addDebugInfo('从页面标题提取音频信息');
                    return {
                        audioUrl: parts[1].trim(),
                        filename: parts[0].trim()
                    };
                }
            }
            
            // 默认错误处理
            addDebugInfo('离线模式：无法获取音频信息');
            return {
                audioUrl: null,
                filename: '音频文件'
            };
        }
        
        // 设置音频事件监听器
        function setupAudioEventListeners() {
            if (!audioPlayer) return;
            
            audioPlayer.addEventListener('loadstart', () => addDebugInfo('开始加载音频'));
            audioPlayer.addEventListener('canplay', () => addDebugInfo('音频可以播放'));
            audioPlayer.addEventListener('play', () => {
                isPlaying = true;
                elements.playText.textContent = '暂停';
                addDebugInfo('音频开始播放');
            });
            audioPlayer.addEventListener('pause', () => {
                isPlaying = false;
                elements.playText.textContent = '播放';
                addDebugInfo('音频暂停');
            });
            audioPlayer.addEventListener('error', (e) => {
                showError('音频加载失败，请检查音频URL或网络连接');
                addDebugInfo('音频错误: ' + e.message);
            });
        }
        
        // 播放/暂停切换
        function togglePlay() {
            if (!audioPlayer) return;
            
            if (isPlaying) {
                audioPlayer.pause();
            } else {
                audioPlayer.play().catch(error => {
                    console.error('播放失败:', error);
                    showError('播放失败，请检查音频文件或网络连接');
                });
            }
        }
        
        // 显示错误信息
        function showError(message) {
            elements.errorMessage.style.display = 'block';
            elements.errorMessage.textContent = message;
            addDebugInfo('错误: ' + message);
        }
        
        // 添加调试信息
        function addDebugInfo(message) {
            const timestamp = new Date().toLocaleTimeString();
            const debugLine = timestamp + ': ' + message;
            
            elements.debugInfo.innerHTML += debugLine + '<br>';
            elements.debugInfo.scrollTop = elements.debugInfo.scrollHeight;
            
            console.log(debugLine);
        }
    </script>
</body>
</html>''';
}
