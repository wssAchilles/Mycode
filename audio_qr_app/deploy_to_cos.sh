#!/bin/bash

# 腾讯云COS静态网站自动化部署脚本
# 适用于音频二维码播放页面部署

echo "🚀 开始部署音频播放页面到腾讯云COS..."
echo "=========================================="

# 配置变量
SECRET_ID="AKID9HF0nU0LTPNCqGoJRSG3mOrBJrFRQCk3"
SECRET_KEY="94nMjtqNmzzsY0EE0YszsY0EE1d2DAuQ"
BUCKET_NAME="my-audio-files-123-1380453532"
REGION="ap-nanjing"

echo "📋 配置信息:"
echo "  存储桶: $BUCKET_NAME"
echo "  地区: $REGION"
echo ""

# 第一步：安装腾讯云CLI工具
echo "📦 步骤1: 安装腾讯云CLI工具..."
pip install tencent-cloud-sdk-python-cos
pip install tccli

if [ $? -eq 0 ]; then
    echo "✅ tccli 安装成功"
else
    echo "❌ tccli 安装失败，请检查Python和pip环境"
    exit 1
fi

# 第二步：配置腾讯云CLI认证信息
echo ""
echo "🔑 步骤2: 配置腾讯云CLI认证..."
tccli configure set secretId $SECRET_ID
tccli configure set secretKey $SECRET_KEY  
tccli configure set region $REGION
tccli configure set output json

echo "✅ 认证配置完成"

# 第三步：设置存储桶访问权限为公有读
echo ""
echo "🔓 步骤3: 设置存储桶访问权限..."
# 将存储桶ACL设置为public-read，允许公网访问静态网站
tccli cos PutBucketAcl \
    --Bucket $BUCKET_NAME \
    --ACL public-read

if [ $? -eq 0 ]; then
    echo "✅ 存储桶权限设置成功 (public-read)"
else
    echo "⚠️ 存储桶权限设置可能失败，但不影响后续步骤"
fi

# 第四步：上传静态文件到COS
echo ""
echo "📤 步骤4: 上传静态文件..."

# 检查play.html文件是否存在
if [ ! -f "play.html" ]; then
    echo "❌ 错误: play.html 文件不存在，请确保文件在当前目录"
    exit 1
fi

# 上传play.html到存储桶根目录
tccli cos PutObject \
    --Bucket $BUCKET_NAME \
    --Key "play.html" \
    --Body "play.html" \
    --ContentType "text/html" \
    --CacheControl "public, max-age=31536000"

if [ $? -eq 0 ]; then
    echo "✅ play.html 上传成功"
else
    echo "❌ play.html 上传失败"
    exit 1
fi

# 可选：如果有index.html也一起上传
if [ -f "index.html" ]; then
    echo "📤 发现index.html，正在上传..."
    tccli cos PutObject \
        --Bucket $BUCKET_NAME \
        --Key "index.html" \
        --Body "index.html" \
        --ContentType "text/html" \
        --CacheControl "public, max-age=31536000"
    
    if [ $? -eq 0 ]; then
        echo "✅ index.html 上传成功"
    fi
fi

# 第五步：开启静态网站功能
echo ""
echo "🌐 步骤5: 开启COS静态网站功能..."

# 为存储桶开启静态网站托管功能，设置index.html为默认首页
tccli cos PutBucketWebsite \
    --Bucket $BUCKET_NAME \
    --WebsiteConfiguration '{
        "IndexDocument": {
            "Suffix": "play.html"
        },
        "ErrorDocument": {
            "Key": "play.html"
        }
    }'

if [ $? -eq 0 ]; then
    echo "✅ 静态网站功能开启成功"
    echo "  - 默认首页: play.html"
    echo "  - 错误页面: play.html"
else
    echo "❌ 静态网站功能开启失败"
    exit 1
fi

# 第六步：配置CORS规则（支持跨域访问）
echo ""
echo "🔀 步骤6: 配置CORS跨域规则..."

tccli cos PutBucketCors \
    --Bucket $BUCKET_NAME \
    --CORSConfiguration '{
        "CORSRules": [
            {
                "AllowedOrigins": ["*"],
                "AllowedMethods": ["GET", "HEAD"],
                "AllowedHeaders": ["*"],
                "MaxAgeSeconds": 86400
            }
        ]
    }'

if [ $? -eq 0 ]; then
    echo "✅ CORS规则配置成功"
else
    echo "⚠️ CORS规则配置可能失败，但不影响基本功能"
fi

# 第七步：生成访问URL并验证
echo ""
echo "🎉 部署完成！"
echo "=========================================="

# 根据腾讯云规则生成静态网站访问URL
WEBSITE_URL="https://${BUCKET_NAME}.cos-website.${REGION}.myqcloud.com"

echo "📍 您的静态网站地址:"
echo "  $WEBSITE_URL"
echo ""
echo "📱 播放页面完整URL示例:"
echo "  ${WEBSITE_URL}/play.html?filename=示例音频.mp3&url=https://example.com/audio.mp3"
echo ""

# 尝试验证部署是否成功
echo "🔍 正在验证部署状态..."
echo "请稍等片刻让DNS生效，然后在浏览器中访问上述URL进行测试。"

echo ""
echo "✅ 自动化部署完成！"
echo "📝 请保存上述URL，并更新您的Flutter应用配置。"
echo ""
echo "💡 提示："
echo "  1. DNS生效可能需要5-10分钟"  
echo "  2. 如果访问失败，请检查存储桶权限和文件上传状态"
echo "  3. 确保音频文件URL可以正常访问"
echo "=========================================="