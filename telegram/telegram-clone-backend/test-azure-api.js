// 测试Azure AI API连接
require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

// 记录环境变量到日志文件以便分析
function logEnvironmentVariables() {
  try {
    const envVars = {
      AZURE_AI_ENDPOINT: process.env.AZURE_AI_ENDPOINT || '未设置',
      AZURE_API_KEY: process.env.AZURE_API_KEY ? 
        `${process.env.AZURE_API_KEY.substring(0, 5)}...${process.env.AZURE_API_KEY.substring(process.env.AZURE_API_KEY.length - 5)}` : 
        '未设置'
    };
    
    fs.writeFileSync('azure-debug.log', 
      `测试时间: ${new Date().toISOString()}\n环境变量:\n${JSON.stringify(envVars, null, 2)}\n`, 
      { flag: 'a' }
    );
    
    console.log('📝 环境变量已记录到 azure-debug.log');
  } catch (err) {
    console.error('无法写入日志文件:', err);
  }
}

async function testAzureAI() {
  // 记录环境变量
  logEnvironmentVariables();
  
  try {
    console.log('🧪 开始测试Azure AI API连接...');
    
    // 从环境变量获取配置
    const azureEndpoint = process.env.AZURE_AI_ENDPOINT;
    const azureApiKey = process.env.AZURE_API_KEY;
    
    if (!azureEndpoint || !azureApiKey) {
      console.error('❌ 环境变量缺失: AZURE_AI_ENDPOINT 或 AZURE_API_KEY 未设置');
      return;
    }
    
    console.log(`📄 配置信息:
- 端点: ${azureEndpoint}
- API密钥: ${azureApiKey.substring(0, 5)}...${azureApiKey.substring(azureApiKey.length - 5)}`);
    
    // 尝试方法1: 使用完整端点路径和api-key头
    await testMethod1(azureEndpoint, azureApiKey);
    
    // 尝试方法2: 使用基本端点和Bearer认证
    await testMethod2(azureEndpoint, azureApiKey);
    
  } catch (error) {
    console.error('❌ 主测试函数失败:', error.message);
  }
}

// 方法1: 使用完整端点路径和api-key头
async function testMethod1(azureEndpoint, azureApiKey) {
  try {
    console.log('\n🔍 测试方法1: 使用api-key认证');
    
    // 尝试不同的端点格式
    let apiUrl;
    
    if (azureEndpoint.includes('/api/projects/')) {
      // 如果是Azure AI Foundry格式的端点
      apiUrl = `${azureEndpoint}/completions`;
    } else {
      // 标准Azure OpenAI格式
      apiUrl = `${azureEndpoint}/openai/deployments/gpt-35-turbo/chat/completions?api-version=2023-07-01-preview`;
    }
    
    console.log(`🔗 API URL: ${apiUrl}`);
    
    // 构建请求体
    const requestBody = {
      messages: [
        { role: 'system', content: '你是一个有用的AI助手。' },
        { role: 'user', content: '你好，请介绍一下你自己。' }
      ],
      max_tokens: 500,
      temperature: 0.7
    };
    
    // 仅在标准OpenAI格式时添加model字段
    if (!apiUrl.includes('/api/projects/')) {
      requestBody.model = 'gpt-35-turbo';
    }
    
    console.log('📤 发送请求...');
    
    // 发送请求
    const response = await axios.post(apiUrl, requestBody, {
      headers: {
        'api-key': azureApiKey,
        'Content-Type': 'application/json'
      },
      timeout: 20000,
      validateStatus: null // 不抛出HTTP错误
    });
    
    // 检查响应
    if (response.status >= 200 && response.status < 300) {
      console.log(`✅ 请求成功! 状态码: ${response.status}`);
      console.log('📥 响应数据:', JSON.stringify(response.data, null, 2));
      
      // 提取AI回复
      const aiMessage = response.data?.choices?.[0]?.message?.content;
      console.log('\n🤖 AI回复:\n', aiMessage);
      return true;
    } else {
      console.error(`❌ 请求失败! 状态码: ${response.status}`);
      if (response.data?.error) {
        console.error('🔍 错误详情:', JSON.stringify(response.data.error, null, 2));
      } else {
        console.error('🔍 响应数据:', JSON.stringify(response.data, null, 2));
      }
      return false;
    }
  } catch (error) {
    console.error('❌ 方法1测试失败:', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText
    });
    
    if (error.response?.data?.error) {
      console.error('🔍 Azure API错误详情:', JSON.stringify(error.response.data.error, null, 2));
    } else if (error.response?.data) {
      console.error('🔍 响应数据:', JSON.stringify(error.response.data, null, 2));
    }
    return false;
  }
}

// 方法2: 使用基本端点和Bearer认证
async function testMethod2(azureEndpoint, azureApiKey) {
  try {
    console.log('\n🔍 测试方法2: 使用Bearer认证');
    
    // 从端点中获取基本域名
    let baseEndpoint = azureEndpoint;
    if (baseEndpoint.includes('/api/')) {
      baseEndpoint = baseEndpoint.substring(0, baseEndpoint.indexOf('/api'));
    }
    
    // Azure AI Studio风格的端点
    const apiUrl = `${baseEndpoint}/language/:query-knowledgebases`;
    
    console.log(`🔗 API URL: ${apiUrl}`);
    
    // 构建请求体
    const requestBody = {
      question: "你好，请介绍一下你自己。",
      top: 3,
      includeUnstructuredSources: true,
      confidenceScoreThreshold: 0.5,
      answerSpanRequest: {
        enable: true,
        confidenceScoreThreshold: 0.5,
        topAnswersWithSpan: 1
      }
    };
    
    console.log('📤 发送请求...');
    
    // 发送请求
    const response = await axios.post(apiUrl, requestBody, {
      headers: {
        'Authorization': `Bearer ${azureApiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 20000,
      validateStatus: null // 不抛出HTTP错误
    });
    
    // 检查响应
    if (response.status >= 200 && response.status < 300) {
      console.log(`✅ 请求成功! 状态码: ${response.status}`);
      console.log('📥 响应数据:', JSON.stringify(response.data, null, 2));
      return true;
    } else {
      console.error(`❌ 请求失败! 状态码: ${response.status}`);
      if (response.data?.error) {
        console.error('🔍 错误详情:', JSON.stringify(response.data.error, null, 2));
      } else {
        console.error('🔍 响应数据:', JSON.stringify(response.data, null, 2));
      }
      return false;
    }
  } catch (error) {
    console.error('❌ 方法2测试失败:', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText
    });
    
    if (error.response?.data?.error) {
      console.error('🔍 Azure API错误详情:', JSON.stringify(error.response.data.error, null, 2));
    } else if (error.response?.data) {
      console.error('🔍 响应数据:', JSON.stringify(error.response.data, null, 2));
    }
    return false;
  }
}

// 执行测试
testAzureAI();
