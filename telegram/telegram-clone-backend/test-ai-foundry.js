// 测试Azure AI Foundry集成
require('dotenv').config();
const axios = require('axios');

async function testAiFounryIntegration() {
  try {
    console.log('🧪 开始测试Azure AI Foundry集成...');
    
    // 从环境变量获取配置
    const azureEndpoint = process.env.AZURE_AI_ENDPOINT;
    const azureApiKey = process.env.AZURE_API_KEY;
    const projectName = process.env.AZURE_PROJECT_NAME;
    const apiVersion = process.env.AZURE_API_VERSION || '2023-09-01-preview';
    
    if (!azureEndpoint || !azureApiKey || !projectName) {
      console.error('❌ 环境变量缺失: 请检查AZURE_AI_ENDPOINT、AZURE_API_KEY和AZURE_PROJECT_NAME');
      return;
    }
    
    console.log(`📄 配置信息:
- 端点: ${azureEndpoint}
- 项目: ${projectName}
- API密钥: ${azureApiKey.substring(0, 5)}...${azureApiKey.substring(azureApiKey.length - 5)}`);
    
    // 构建Azure AI Foundry API URL，使用环境变量中的API版本
    const apiUrl = `${azureEndpoint}/api/projects/${projectName}/completions?api-version=${apiVersion}`;
    console.log(`🔗 完整API URL: ${apiUrl}`);
    
    // 历史消息示例
    const historyMessages = [
      { author: 'user', content: '你是谁？' },
      { author: 'bot', content: '我是一个AI助手，随时为您提供帮助。' }
    ];
    
    // 构建请求体 - Azure AI Foundry格式
    const requestBody = {
      prompt: '你能帮我总结一下我们的对话吗？',
      temperature: 0.7,
      max_tokens: 800,
      top_p: 0.95,
      conversation_history: historyMessages
    };
    
    console.log('📤 发送请求...');
    // 发送请求
    const response = await axios.post(apiUrl, requestBody, {
      headers: {
        'Ocp-Apim-Subscription-Key': azureApiKey,
        'Content-Type': 'application/json'
      },
      timeout: 20000,
      validateStatus: null // 不自动抛出错误
    });
    
    // 检查响应
    console.log(`🔍 响应状态码: ${response.status}`);
    
    if (response.status >= 200 && response.status < 300) {
      console.log('✅ 请求成功!');
      console.log('📥 响应结构:', JSON.stringify(response.data, null, 2));
      
      // 尝试提取AI回复 - 根据实际响应结构调整
      const aiMessage = response.data?.completion || 
                       response.data?.choices?.[0]?.text || 
                       response.data?.response || 
                       response.data?.message;
      
      console.log('\n🤖 AI回复:\n', aiMessage || '无法提取AI回复');
    } else {
      console.error('❌ 请求失败!');
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
testAiFounryIntegration();
