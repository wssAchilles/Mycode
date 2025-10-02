const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// 启用CORS
app.use(cors());

// 解析JSON和URL编码的请求体
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 提供静态文件服务
app.use('/static', express.static('public'));

// 微信友好的音频播放页面
app.get('/play/:filename', (req, res) => {
    const filename = decodeURIComponent(req.params.filename);
    const audioUrl = req.query.url;
    
    if (!audioUrl) {
        return res.status(400).send('缺少音频URL参数');
    }
    
    // 读取HTML模板
    const templatePath = path.join(__dirname, 'wechat_download_page.html');
    
    try {
        let htmlTemplate = fs.readFileSync(templatePath, 'utf8');
        
        // 替换模板中的占位符
        htmlTemplate = htmlTemplate.replace(/AUDIO_URL/g, audioUrl);
        htmlTemplate = htmlTemplate.replace(/AUDIO_FILENAME/g, filename);
        
        // 设置响应头
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        
        // 发送生成的HTML
        res.send(htmlTemplate);
    } catch (error) {
        console.error('读取HTML模板失败:', error);
        res.status(500).send('服务器内部错误');
    }
});

// 健康检查端点
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        service: 'audio-qr-server'
    });
});

// API端点：生成播放页面URL
app.post('/api/generate-play-url', (req, res) => {
    const { filename, audioUrl } = req.body;
    
    if (!filename || !audioUrl) {
        return res.status(400).json({
            error: '缺少必要参数',
            required: ['filename', 'audioUrl']
        });
    }
    
    // 生成播放页面URL
    const baseUrl = req.protocol + '://' + req.get('host');
    const playUrl = `${baseUrl}/play/${encodeURIComponent(filename)}?url=${encodeURIComponent(audioUrl)}`;
    
    res.json({
        success: true,
        playUrl: playUrl,
        filename: filename,
        audioUrl: audioUrl
    });
});

// 错误处理中间件
app.use((err, req, res, next) => {
    console.error('服务器错误:', err);
    res.status(500).json({
        error: '服务器内部错误',
        message: err.message
    });
});

// 404处理
app.use((req, res) => {
    res.status(404).json({
        error: '页面未找到',
        path: req.path,
        method: req.method
    });
});

// Vercel Serverless函数导出
module.exports = app;

// 本地开发时启动服务器
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🚀 音频播放服务器已启动`);
        console.log(`📍 本地地址: http://localhost:${PORT}`);
        console.log(`📱 播放页面: http://localhost:${PORT}/play/示例文件.mp3?url=音频URL`);
        console.log(`🔧 API端点: http://localhost:${PORT}/api/generate-play-url`);
        console.log(`❤️  健康检查: http://localhost:${PORT}/health`);
    });
}