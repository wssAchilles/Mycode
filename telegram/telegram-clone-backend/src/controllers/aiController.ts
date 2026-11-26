import { Request, Response } from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import { AiConversation, type IAiConversation } from '../models/AiConversation';
import { callDirectGeminiAI } from '../services/agentPlane/client/directGeminiClient';
import { generateUserAgentReply } from '../services/agentPlane/orchestrator/agentResponseService';
import { createChildLogger } from '../utils/logger';
import { sendSuccess, errors } from '../utils/apiResponse';
import { catchAsync } from '../middleware/errorHandler';
const log = createChildLogger('controllers:aiController');

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

async function prepareAiContextAndReply(params: {
  userId: string;
  message: string;
  imageData?: AIChatRequest['body']['imageData'];
  conversationHistory?: AIChatRequest['body']['conversationHistory'];
  conversationId?: string;
}) {
  const { userId, message, imageData, conversationHistory = [], conversationId } = params;

  let conversationDoc: IAiConversation | null = null;
  if (conversationId) {
    conversationDoc = await AiConversation.findOne({ conversationId, userId, isActive: true });
  }

  // 组装上下文（最多保留最近 10 条）
  const historyMessages = conversationDoc?.messages.slice(-10) || [];
  const combinedHistory = [
    ...historyMessages.map((msg: any) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    })),
    ...conversationHistory.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    })),
  ];

  const agentReply = await generateUserAgentReply({
    userId,
    message,
    imageData,
    conversationHistory: combinedHistory.map((item) => ({
      role: item.role === 'model' ? 'assistant' : 'user',
      content: String(item.parts?.[0]?.text || ''),
    })),
    conversationId,
  });

  return { conversationDoc, agentReply };
}

async function persistAiConversationExchange(params: {
  userId: string;
  conversationDoc: IAiConversation | null;
  message: string;
  aiMessage: string;
  imageData?: AIChatRequest['body']['imageData'];
}): Promise<string | undefined> {
  const { userId, message, aiMessage, imageData } = params;
  let conversationDoc = params.conversationDoc;
  let activeConversationId = conversationDoc?.conversationId;

  try {
    const userMessageRecord = {
      id: `user-${Date.now()}`,
      role: 'user' as const,
      content: message,
      timestamp: new Date(),
      type: imageData ? ('image' as const) : ('text' as const),
      imageData: imageData
        ? {
            mimeType: imageData.mimeType,
            fileName: 'inline',
            fileSize: imageData.base64Data?.length || 0,
          }
        : undefined,
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
      const created = await AiConversation.createNewConversation(userId, userMessageRecord);
      created.messages.push(aiMessageRecord);
      await created.save();
      activeConversationId = created.conversationId;
    }
  } catch (err) {
    log.warn({ err }, 'AI 对话持久化失败');
  }

  return activeConversationId;
}

function splitStreamChunks(text: string): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const remaining = text.length - cursor;
    const step = remaining > 400 ? 22 : remaining > 120 ? 16 : 10;
    chunks.push(text.slice(cursor, cursor + step));
    cursor += step;
  }
  return chunks;
}

function writeSseEvent(res: Response, event: string, data: unknown): void {
  if (res.writableEnded) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export const getAiResponse = catchAsync(async (req: AIChatRequest, res: Response) => {
  const { message, imageData, conversationHistory = [], conversationId } = req.body;

  // 验证必要参数
  if (!message || typeof message !== 'string') {
    return errors.badRequest(res, '请提供有效的消息内容');
  }

  const { conversationDoc, agentReply } = await prepareAiContextAndReply({
    userId: req.userId!,
    message,
    imageData,
    conversationHistory,
    conversationId,
  });
  const aiMessage = agentReply.message;

  const activeConversationId = await persistAiConversationExchange({
    userId: req.userId!,
    conversationDoc,
    message,
    aiMessage,
    imageData,
  });

  log.info({ preview: aiMessage.substring(0, 200) + (aiMessage.length > 200 ? '...' : '') }, 'AI 回复内容');

  // 返回成功响应
  return sendSuccess(res, {
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
  });
});

/**
 * SSE 流式 AI 对话端点：逐步输出分块并在断开时中止
 */
export const streamAiResponse = async (req: AIChatRequest, res: Response): Promise<void> => {
  const { message, imageData, conversationHistory = [], conversationId } = req.body;
  if (!message || typeof message !== 'string') {
    errors.badRequest(res, '请提供有效的消息内容');
    return;
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let aborted = false;
  req.on('close', () => {
    aborted = true;
  });

  writeSseEvent(res, 'start', { status: 'thinking' });

  try {
    const { conversationDoc, agentReply } = await prepareAiContextAndReply({
      userId: req.userId!,
      message,
      imageData,
      conversationHistory,
      conversationId,
    });

    if (aborted) {
      res.end();
      return;
    }

    const aiMessage = agentReply.message;
    const activeConversationId = await persistAiConversationExchange({
      userId: req.userId!,
      conversationDoc,
      message,
      aiMessage,
      imageData,
    });

    const chunks = splitStreamChunks(aiMessage);
    for (const delta of chunks) {
      if (aborted || res.writableEnded) {
        res.end();
        return;
      }
      writeSseEvent(res, 'delta', { delta });
      await new Promise((resolve) => setTimeout(resolve, 16));
    }

    if (!aborted && !res.writableEnded) {
      writeSseEvent(res, 'done', {
        message: aiMessage,
        timestamp: new Date().toISOString(),
        conversationId: activeConversationId,
        agent: {
          mode: agentReply.mode,
          fallback: agentReply.fallback,
          usedScopes: agentReply.usedScopes,
          suggestions: agentReply.suggestions,
        },
      });
      res.end();
    }
  } catch (err: unknown) {
    if (!aborted && !res.writableEnded) {
      const errorText = err instanceof Error ? err.message : 'AI 生成失败，请稍后重试';
      writeSseEvent(res, 'error', { error: errorText });
      res.end();
    }
  }
};

// 健康检查端点
export const checkAiHealth = catchAsync(async (req: Request, res: Response) => {
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (!geminiApiKey || geminiApiKey.trim() === '') {
    return errors.unavailable(res, 'Google Gemini API密钥缺失或为空');
  }

  log.info('🔍 执行AI服务健康检查...');

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

  log.info({ data: {
    status: testResponse.status,
    statusText: testResponse.statusText,
    hasData: !!testResponse.data
  } }, '🔍 健康检查响应');

  // 检查响应
  if (testResponse.status === 200) {
    return sendSuccess(res, {
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
    log.warn({ data: {
      status: testResponse.status,
      data: testResponse.data
    } }, '⚠️ AI健康检查返回非200状态码');

    return errors.unavailable(res, `AI服务状态异常: ${testResponse.status}`);
  }
});

// 简化的AI调用函数，供Socket.IO服务使用
export const callGeminiAI = async (message: string, imageData?: { mimeType: string; base64Data: string }): Promise<string> => {
  try {
    log.info({
      message: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
      hasImageData: !!imageData,
    }, 'Socket.IO AI调用');

    const response = await callDirectGeminiAI({
      message,
      imageData,
      systemInstruction: '请始终使用简体中文回答用户的问题。',
    });
    log.info({ preview: response.message.substring(0, 100) + '...' }, 'Socket.IO AI调用成功');
    return response.message;

  } catch (error: unknown) {
    log.error({ err: error }, 'Socket.IO AI调用失败');
    return '抱歉，我现在无法回复你的消息。请稍后再试。';
  }
};

// 获取智能回复建议
export const getSmartReplies = catchAsync(async (req: Request, res: Response) => {
  const { message, context = [] } = req.body;

  if (!message || typeof message !== 'string') {
    return errors.badRequest(res, '请提供有效的消息内容');
  }

  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    return errors.internal(res, 'AI服务未配置');
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
    log.warn({ data: text }, '智能回复解析失败');
    suggestions = ['收到', '好的', '稍等']; // 降级策略
  }

  return sendSuccess(res, { suggestions });
});
