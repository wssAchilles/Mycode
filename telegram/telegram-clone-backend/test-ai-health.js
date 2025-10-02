// 测试Azure AI健康检查端点
require('dotenv').config();
const axios = require('axios');

async function testAiHealth() {
  try {
    console.log('🧪 开始测试Azure AI健康状态...');
    
    // 从环境变量获取配置
    const azureEndpoint = process.env.AZURE_AI_ENDPOINT;
    const azureApiKey = process.env.AZURE_API_KEY;
    const projectName = process.env.AZURE_PROJECT_NAME;
    const apiVersion = process.env.AZURE_API_VERSION || '2023-09-01-preview';
    
    if (!azureEndpoint || !azureApiKey || !projectName) {
      console.error('❌ 环境变量缺失: 请检查AZURE_AI_ENDPOINT、AZURE_API_KEY和AZURE_PROJECT_NAME');
      return;
    }
    
    // 构建健康检查URL，使用环境变量中的API版本
    const healthUrl = `${azureEndpoint}/api/projects/${projectName}/status?api-version=${apiVersion}`;
    console.log(`🔗 健康检查URL: ${healthUrl}`);
    
    console.log('📤 发送请求...');
    // 发送请求
    const response = await axios.get(healthUrl, {
      headers: {
        'Ocp-Apim-Subscription-Key': azureApiKey,
        'Accept': 'application/json'
      },
      timeout: 10000,
      validateStatus: null // 不自动抛出错误
    });
    
    console.log(`🔍 响应状态码: ${response.status}`);
    
    if (response.status >= 200 && response.status < 300) {
      console.log('✅ 健康检查成功!');
      console.log('📥 响应数据:', JSON.stringify(response.data, null, 2));
    } else {
      console.error(`❌ 健康检查失败! 状态码: ${response.status}`);
      console.error('🔍 错误详情:', response.data);
    }
    
  } catch (error) {
    console.error('❌ 测试失败:', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText
    });
    
    if (error.response?.data) {
      console.error('🔍 响应数据:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

// 执行测试
testAiHealth();
