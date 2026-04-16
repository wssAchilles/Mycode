import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

export interface DirectGeminiHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface DirectGeminiImagePayload {
  mimeType: string;
  base64Data: string;
}

export interface DirectGeminiRequest {
  message: string;
  imageData?: DirectGeminiImagePayload;
  conversationHistory?: DirectGeminiHistoryItem[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemInstruction?: string;
}

export interface DirectGeminiResponse {
  message: string;
  tokensUsed: number;
  model: string;
}

export async function callDirectGeminiAI(request: DirectGeminiRequest): Promise<DirectGeminiResponse> {
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (!geminiApiKey || geminiApiKey.trim() === '') {
    throw new Error('Google Gemini API密钥未配置');
  }

  const modelName = request.model || 'gemini-2.0-flash';
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiApiKey}`;
  const conversationHistory = Array.isArray(request.conversationHistory) ? request.conversationHistory.slice(-10) : [];

  const contents: Array<{ role: 'user' | 'model'; parts: Array<Record<string, unknown>> }> = [];
  if (request.systemInstruction?.trim()) {
    contents.push({
      role: 'model',
      parts: [{ text: request.systemInstruction.trim() }],
    });
  }

  for (const item of conversationHistory) {
    if (!item?.content?.trim()) {
      continue;
    }
    contents.push({
      role: item.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: item.content.trim() }],
    });
  }

  const currentParts: Array<Record<string, unknown>> = [{ text: request.message }];
  if (request.imageData?.base64Data && request.imageData?.mimeType) {
    currentParts.push({
      inline_data: {
        mime_type: request.imageData.mimeType,
        data: request.imageData.base64Data,
      },
    });
  }

  contents.push({
    role: 'user',
    parts: currentParts,
  });

  const payload: Record<string, unknown> = { contents };
  if (request.temperature || request.maxTokens) {
    payload.generationConfig = {
      temperature: request.temperature ?? 0.7,
      maxOutputTokens: request.maxTokens ?? 512,
    };
  }

  const response = await axios.post(apiUrl, payload, {
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

  const message = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!message || typeof message !== 'string') {
    throw new Error('gemini_empty_response');
  }

  return {
    message,
    tokensUsed: Number(response.data?.usageMetadata?.totalTokenCount || 0),
    model: modelName,
  };
}
