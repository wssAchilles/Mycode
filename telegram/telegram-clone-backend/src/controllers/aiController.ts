import { Request, Response } from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import { AiConversation } from '../models/AiConversation';
import { callDirectGeminiAI } from '../services/agentPlane/client/directGeminiClient';
import { generateUserAgentReply } from '../services/agentPlane/orchestrator/agentResponseService';

// 确保环境变量已加载
dotenv.config({ quiet: true });

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
    conversationId?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  };
}

export const getAiResponse = async (req: AIChatRequest, res: Response) => {
  try {
    const { message, imageData, conversationHistory = [], conversationId, model, temperature, maxTokens } = req.body;

    // 验证必要参数
    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        success: false,
        error: '请提供有效的消息内容'
      });
    }

    // 读取已有对话上下文
    let conversationDoc = null;
    if (conversationId) {
      conversationDoc = await AiConversation.findOne({ conversationId, userId: req.userId, isActive: true });
    }

    // 组装上下文（最多保留最近 10 条）
    const historyMessages = conversationDoc?.messages.slice(-10) || [];
    const combinedHistory = [
      ...historyMessages.map((msg: any) => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      })),
      ...conversationHistory.map((msg) => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      }))
    ];

    const agentReply = await generateUserAgentReply({
      userId: req.userId!,
      message,
      imageData,
      conversationHistory: combinedHistory.map((item) => ({
        role: item.role === 'model' ? 'assistant' : 'user',
        content: String(item.parts?.[0]?.text || ''),
      })),
      conversationId,
    });
    const aiMessage = agentReply.message;

      // 持久化会话
      let activeConversationId = conversationDoc?.conversationId;
      try {
        const userMessageRecord = {
          id: `user-${Date.now()}`,
          role: 'user' as const,
          content: message,
          timestamp: new Date(),
          type: imageData ? 'image' as const : 'text' as const,
          imageData: imageData ? {
            mimeType: imageData.mimeType,
            fileName: 'inline',
            fileSize: imageData.base64Data?.length || 0,
          } : undefined,
        };
        const aiMessageRecord = {
          id: `ai-${Date.now()}`,
          role: 'assistant' as const,
          content: aiMessage,
          timestamp: new Date(),
          type: 'text' as const,
        };

        if (conversationDoc) {
          conversationDoc.messages.push(userMessageRecord);
          conversationDoc.messages.push(aiMessageRecord);
          conversationDoc.updatedAt = new Date();
          await conversationDoc.save();
          activeConversationId = conversationDoc.conversationId;
        } else {
          const created = await AiConversation.createNewConversation(req.userId!, userMessageRecord);
          created.messages.push(aiMessageRecord);
          await created.save();
          conversationDoc = created;
          activeConversationId = created.conversationId;
        }
      } catch (err) {
        console.warn('⚠️ AI 对话持久化失败:', err);
      }

      console.log('🤖 AI回复内容:', aiMessage.substring(0, 200) + (aiMessage.length > 200 ? '...' : ''));

      // 返回成功响应
      return res.json({
        success: true,
        data: {
          message: aiMessage,
          timestamp: new Date().toISOString(),
          tokens_used: 0,
          conversationId: activeConversationId,
          agent: {
            mode: agentReply.mode,
            fallback: agentReply.fallback,
            usedScopes: agentReply.usedScopes,
            suggestions: agentReply.suggestions,
          },
        }
      });

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
    const modelName = 'gemini-2.0-flash';
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
    console.log('🤖 Socket.IO AI调用:', {
      message: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
      hasImageData: !!imageData
    });

    const response = await callDirectGeminiAI({
      message,
      imageData,
      systemInstruction: '请始终使用简体中文回答用户的问题。',
    });
    console.log('✅ Socket.IO AI调用成功:', response.message.substring(0, 100) + '...');
    return response.message;

  } catch (error: any) {
    console.error('❌ Socket.IO AI调用失败:', error.message);
    return '抱歉，我现在无法回复你的消息。请稍后再试。';
  }
};

// 获取智能回复建议
export const getSmartReplies = async (req: Request, res: Response) => {
  try {
    const { message, context = [] } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        success: false,
        error: '请提供有效的消息内容'
      });
    }

    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      return res.status(500).json({ success: false, error: 'AI服务未配置' });
    }

    // 构建提示词
    const prompt = `你是一个智能回复助手。请根据对方发送的消息，生成 3 个简短、得体且符合聊天语境的回复建议。
对方的消息是："${message}"
${context.length > 0 ? `此之前的上下文：${context.slice(-3).map((m: any) => m.content).join('\n')}` : ''}

要求：
1. 回复要简短（不超过 15 个字）。
2. 只返回一个合法的 JSON 字符串数组，例如 ["好的", "稍等", "收到"]。
3. 不要包含 Markdown 代码块标记（如 \`\`\`json），仅返回纯文本 JSON 数组。`;

    const response = await callDirectGeminiAI({
      message: prompt,
      model: 'gemini-2.0-flash',
      systemInstruction: '你是一个智能回复助手，只输出 JSON 字符串数组，不要输出任何额外说明。',
      maxTokens: 256,
      temperature: 0.4,
    });

    const text = response.message || '[]';

    // 清理可能存在的 Markdown
    const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();

    let suggestions = [];
    try {
      suggestions = JSON.parse(cleanText);
    } catch (e) {
      console.warn('智能回复解析失败:', text);
      suggestions = ['收到', '好的', '稍等']; // 降级策略
    }

    return res.json({
      success: true,
      data: { suggestions }
    });

  } catch (error: any) {
    console.error('获取智能回复失败:', error.message);
    return res.status(500).json({
      success: false,
      error: '获取回复建议失败'
    });
  }
};
