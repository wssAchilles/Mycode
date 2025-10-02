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
    
    // 健康检查响应
    res.status(200).json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        service: 'audio-qr-server',
        method: req.method,
        url: req.url
    });
};