// Node.js服务端示例 - 生成腾讯云COS上传签名
const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// 腾讯云配置
const config = {
    secretId: 'AKID9HF0nU0LTPNCqGoJRSG3mOrBJrFRQCk3',
    secretKey: '94nMjtqNmzzsY0EE1d2DAuQ',  // 注意：实际部署时应该用环境变量
    bucketName: 'my-audio-files-123-1380453532',
    region: 'ap-nanjing'
};

// 生成上传签名
app.post('/api/upload/signature', (req, res) => {
    try {
        const { fileName } = req.body;
        
        // 生成唯一文件名
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        const fileExt = fileName.split('.').pop();
        const objectKey = `audio-files/upload_${timestamp}_${random}.${fileExt}`;
        
        // 生成签名
        const currentTime = Math.floor(Date.now() / 1000);
        const expireTime = currentTime + 3600; // 1小时过期
        const keyTime = `${currentTime};${expireTime}`;
        
        // 生成 SignKey
        const signKey = crypto.createHmac('sha1', config.secretKey).update(keyTime).digest('hex');
        
        // 生成 HttpString
        const httpString = `PUT\n/${objectKey}\n\n\n`;
        
        // 生成 StringToSign
        const sha1HttpString = crypto.createHash('sha1').update(httpString).digest('hex');
        const stringToSign = `sha1\n${keyTime}\n${sha1HttpString}\n`;
        
        // 生成 Signature
        const signature = crypto.createHmac('sha1', signKey).update(stringToSign).digest('hex');
        
        // 生成 Authorization
        const authorization = `q-sign-algorithm=sha1` +
            `&q-ak=${config.secretId}` +
            `&q-sign-time=${keyTime}` +
            `&q-key-time=${keyTime}` +
            `&q-header-list=` +
            `&q-url-param-list=` +
            `&q-signature=${signature}`;
        
        res.json({
            success: true,
            data: {
                objectKey: objectKey,
                uploadUrl: `https://${config.bucketName}.cos.${config.region}.myqcloud.com/${objectKey}`,
                authorization: authorization,
                expires: expireTime
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.listen(3000, () => {
    console.log('Upload signature server running on port 3000');
});