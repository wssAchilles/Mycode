const fs = require('fs');
const path = require('path');

// 获取HTML模板内容
const getHtmlTemplate = () => {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>音频播放 - AUDIO_FILENAME</title>
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
            background: white;
            border-radius: 20px;
            padding: 30px;
            max-width: 400px;
            width: 100%;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            text-align: center;
        }
        
        .title {
            color: #333;
            margin-bottom: 20px;
            font-size: 24px;
            font-weight: 600;
        }
        
        .filename {
            color: #666;
            margin-bottom: 30px;
            padding: 10px;
            background: #f8f9fa;
            border-radius: 10px;
            word-break: break-all;
        }
        
        .audio-player {
            width: 100%;
            margin-bottom: 20px;
            border-radius: 10px;
        }
        
        .download-btn {
            display: inline-block;
            background: linear-gradient(45deg, #667eea, #764ba2);
            color: white;
            text-decoration: none;
            padding: 12px 30px;
            border-radius: 25px;
            font-weight: 500;
            transition: transform 0.2s;
        }
        
        .download-btn:hover {
            transform: translateY(-2px);
        }
        
        .tips {
            margin-top: 20px;
            color: #888;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1 class="title">🎵 音频播放</h1>
        <div class="filename">AUDIO_FILENAME</div>
        
        <audio class="audio-player" controls preload="auto">
            <source src="AUDIO_URL" type="audio/mpeg">
            <source src="AUDIO_URL" type="audio/wav">
            <source src="AUDIO_URL" type="audio/mp4">
            您的浏览器不支持音频播放。
        </audio>
        
        <a href="AUDIO_URL" class="download-btn" download="AUDIO_FILENAME">
            📥 下载音频
        </a>
        
        <div class="tips">
            💡 点击播放按钮收听音频<br>
            📱 支持微信内直接播放
        </div>
    </div>
    
    <script>
        // 自动播放（某些浏览器可能阻止）
        document.addEventListener('DOMContentLoaded', function() {
            const audio = document.querySelector('audio');
            
            // 用户交互后尝试播放
            document.addEventListener('click', function() {
                audio.play().catch(function(error) {
                    console.log('自动播放失败:', error);
                });
            }, { once: true });
            
            // 监听音频加载事件
            audio.addEventListener('loadstart', function() {
                console.log('开始加载音频');
            });
            
            audio.addEventListener('canplay', function() {
                console.log('音频可以播放');
            });
            
            audio.addEventListener('error', function(e) {
                console.error('音频加载错误:', e);
                alert('音频加载失败，请检查网络连接');
            });
        });
    </script>
</body>
</html>`;
};

module.exports = (req, res) => {
    // 设置CORS头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // 处理OPTIONS预检请求
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    // 只处理GET请求
    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    
    // 从查询参数中获取文件名和音频URL
    const filename = req.query.filename || '音频文件';
    const audioUrl = req.query.url;
    
    if (!audioUrl) {
        res.status(400).json({ error: '缺少音频URL参数' });
        return;
    }
    
    try {
        // 获取HTML模板并替换占位符
        let htmlTemplate = getHtmlTemplate();
        htmlTemplate = htmlTemplate.replace(/AUDIO_URL/g, audioUrl);
        htmlTemplate = htmlTemplate.replace(/AUDIO_FILENAME/g, filename);
        
        // 设置响应头
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        
        // 发送HTML响应
        res.status(200).send(htmlTemplate);
    } catch (error) {
        console.error('生成HTML失败:', error);
        res.status(500).json({ 
            error: '服务器内部错误',
            message: error.message 
        });
    }
};