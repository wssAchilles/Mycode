import { Request, Response } from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

// 确保环境变量已加载
dotenv.config();

export interface AIChatRequest extends Request {
  body: {
    message: string;
    imageData?: {
      mimeType: string;
      base64Data: string;
    };
    conversationHistory?: Array<{
      role: 'user' | 'assistant';
      content: string;
    }>;
  };
}

export const getAiResponse = async (req: AIChatRequest, res: Response) => {
  try {
    const { message, imageData, conversationHistory = [] } = req.body;

    // 验证必要参数
    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        success: false,
        error: '请提供有效的消息内容'
      });
    }

    // 获取Google Gemini API配置
    const geminiApiKey = process.env.GEMINI_API_KEY;

    console.log('🔑 检查API密钥:', {
      hasKey: !!geminiApiKey,
      keyLength: geminiApiKey ? geminiApiKey.length : 0,
      keyPrefix: geminiApiKey ? geminiApiKey.substring(0, 10) + '...' : 'null'
    });

    if (!geminiApiKey || geminiApiKey.trim() === '') {
      console.error('❌ Google Gemini API密钥缺失或为空');
      return res.status(500).json({
        success: false,
        error: 'AI服务暂时不可用：API密钥未配置'
      });
    }

    console.log('🤖 收到AI聊天请求:', {
      message: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
      historyLength: conversationHistory.length,
      hasImageData: !!imageData,
      timestamp: new Date().toISOString()
    });

    // 简化的API调用，直接使用gemini-1.5-pro-latest模型
    const modelName = 'gemini-1.5-pro-latest';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiApiKey}`;
    
    console.log('🔗 构建API请求:', {
      url: apiUrl.replace(geminiApiKey, 'API_KEY_HIDDEN'),
      model: modelName
    });

    // 构建多模态请求体
    const parts: any[] = [{ text: message }];
    
    // 如果有图片数据，添加到请求中
    if (imageData && imageData.base64Data && imageData.mimeType) {
      console.log('🖼️ 检测到图片数据，添加到多模态请求中:', {
        mimeType: imageData.mimeType,
        dataLength: imageData.base64Data.length
      });
      parts.push({
        inline_data: {
          mime_type: imageData.mimeType,
          data: imageData.base64Data
        }
      });
    }

    const requestBody = {
      contents: [{ parts }]
    };

    console.log('📋 发送给Google Gemini的请求体:', {
      hasImage: !!imageData,
      imageType: imageData?.mimeType,
      partsCount: parts.length,
      requestBody: JSON.stringify(requestBody, null, 2)
    });

    // 发送API请求
    console.log('🚀 发送API请求到:', apiUrl.replace(geminiApiKey, 'API_KEY_HIDDEN'));
    
    const chatResponse = await axios.post(
      apiUrl,
      requestBody,
      {
        timeout: 30000,
        validateStatus: null,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      }
    );

    console.log('📡 收到API响应:', {
      status: chatResponse.status,
      statusText: chatResponse.statusText,
      hasData: !!chatResponse.data
    });

    // 检查响应状态
    if (chatResponse.status >= 200 && chatResponse.status < 300) {
      console.log('✅ Google Gemini响应成功:', {
        status: chatResponse.status,
        timestamp: new Date().toISOString()
      });
      
      // 记录详细响应结构用于调试
      console.log('📄 Gemini响应结构:', JSON.stringify(chatResponse.data, null, 2));

      // 从Google Gemini响应中提取回复文本
      const aiMessage = chatResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text || 
                       '抱歉，我现在无法理解你的问题，请稍后再试。';

      console.log('🤖 AI回复内容:', aiMessage.substring(0, 200) + (aiMessage.length > 200 ? '...' : ''));

      // 返回成功响应
      return res.json({
        success: true,
        data: {
          message: aiMessage,
          timestamp: new Date().toISOString(),
          tokens_used: chatResponse.data?.usageMetadata?.totalTokenCount || 0
        }
      });
    } else {
      // 响应状态码不是2xx
      console.error(`❌ Google Gemini请求失败! 状态码: ${chatResponse.status}`, {
        status: chatResponse.status,
        statusText: chatResponse.statusText,
        data: chatResponse.data,
        error: chatResponse.data?.error
      });
      
      throw new Error(`API请求失败，状态码: ${chatResponse.status}, 错误: ${JSON.stringify(chatResponse.data?.error || {})}`);
    }

  } catch (error: any) {
    console.error('❌ AI聊天请求失败:', {
      errorMessage: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data ? JSON.stringify(error.response.data).substring(0, 500) : 'No data',
      timestamp: new Date().toISOString()
    });
    
    // 将完整的Google Gemini错误详情记录到控制台以便调试
    if (error.response?.data) {
      console.error('Google Gemini错误详情:', JSON.stringify(error.response.data, null, 2));
    }

    // 根据错误类型返回不同的错误信息
    let errorMessage = 'AI服务暂时不可用，请稍后再试';
    let statusCode = 500;

    if (error.response) {
      const status = error.response.status;
      const errorData = error.response.data;

      if (status === 401) {
        errorMessage = 'AI服务认证失败，请检查API密钥';
        statusCode = 401;
      } else if (status === 404) {
        errorMessage = 'AI服务端点不存在，请检查API配置';
        statusCode = 404;
      } else if (status === 429) {
        errorMessage = '请求频率过高，请稍后再试';
        statusCode = 429;
      } else if (status === 400) {
        errorMessage = '请求格式错误，请检查您的输入';
        statusCode = 400;
      } else if (errorData?.error?.message || errorData?.message) {
        // 在开发环境中返回详细错误，生产环境返回通用错误
        const detailedError = errorData?.error?.message || errorData?.message || '未知错误';
        errorMessage = process.env.NODE_ENV === 'development' ?
          `AI服务错误: ${detailedError}` :
          'AI服务暂时不可用，请稍后再试';
      }
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = 'AI服务响应超时，请稍后再试';
      statusCode = 504;
    }

    return res.status(statusCode).json({
      success: false,
      error: errorMessage
    });
  }
};

// 健康检查端点
export const checkAiHealth = async (req: Request, res: Response) => {
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    
    if (!geminiApiKey || geminiApiKey.trim() === '') {
      return res.status(503).json({ 
        status: 'error', 
        message: 'Google Gemini API密钥缺失或为空' 
      });
    }

    console.log('🔍 执行AI服务健康检查...');
    
    // 简化的健康检查，直接测试API
    const modelName = 'gemini-1.5-pro-latest';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiApiKey}`;
    
    // 发送测试请求检查Google Gemini API状态
    const testResponse = await axios.post(
      apiUrl,
      {
        contents: [{ parts: [{ text: 'Hello' }] }]
      },
      {
        timeout: 10000,
        validateStatus: null,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      }
    );
    
    console.log('🔍 健康检查响应:', {
      status: testResponse.status,
      statusText: testResponse.statusText,
      hasData: !!testResponse.data
    });
    
    // 检查响应
    if (testResponse.status === 200) {
      return res.json({
        status: 'ok',
        message: 'Google Gemini服务运行正常',
        timestamp: new Date().toISOString(),
        details: {
          model: modelName,
          available: true,
          responseTime: 'OK'
        }
      });
    } else {
      console.warn('⚠️ AI健康检查返回非200状态码:', {
        status: testResponse.status,
        data: testResponse.data
      });
      
      return res.status(testResponse.status || 503).json({
        status: 'warning',
        message: `AI服务状态异常: ${testResponse.status}`,
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error: any) {
    console.error('❌ AI健康检查失败:', error.message);
    
    return res.status(503).json({
      status: 'error',
      message: '无法连接到AI服务: ' + error.message,
      timestamp: new Date().toISOString()
    });
  }
};

// 简化的AI调用函数，供Socket.IO服务使用
export const callGeminiAI = async (message: string, imageData?: { mimeType: string; base64Data: string }): Promise<string> => {
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    
    if (!geminiApiKey || geminiApiKey.trim() === '') {
      throw new Error('Google Gemini API密钥未配置');
    }

    console.log('🤖 Socket.IO AI调用:', {
      message: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
      hasImageData: !!imageData
    });

    // 使用验证过的API调用逻辑
    const modelName = 'gemini-1.5-pro-latest';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiApiKey}`;
    
    // 构建请求体
    const parts: any[] = [{ text: message }];
    
    // 如果有图片数据，添加到请求中
    if (imageData && imageData.base64Data && imageData.mimeType) {
      console.log('🖼️ Socket.IO AI调用包含图片数据');
      parts.push({
        inline_data: {
          mime_type: imageData.mimeType,
          data: imageData.base64Data
        }
      });
    }

    const requestBody = {
      contents: [{ parts }]
    };

    const response = await axios.post(apiUrl, requestBody, {
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    if (response.status >= 200 && response.status < 300) {
      const aiMessage = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || 
                       '抱歉，我现在无法理解你的问题。';
      
      console.log('✅ Socket.IO AI调用成功:', aiMessage.substring(0, 100) + '...');
      return aiMessage;
    } else {
      throw new Error(`AI API调用失败: ${response.status}`);
    }
    
  } catch (error: any) {
    console.error('❌ Socket.IO AI调用失败:', error.message);
    return '抱歉，我现在无法回复你的消息。请稍后再试。';
  }
};
