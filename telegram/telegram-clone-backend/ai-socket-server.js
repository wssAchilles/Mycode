// AI Socket.IO Server for handling real-time AI chat communication
// This server runs on port 5850 and interfaces with Google Gemini API

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const cors = require('cors');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Check if GEMINI_API_KEY is set
if (!process.env.GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY environment variable is not set');
  console.error('Please set GEMINI_API_KEY in your .env file or environment variables');
  process.exit(1);
}

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);

// Configure CORS
app.use(cors({
  origin: '*', // In production, you should specify allowed origins
  methods: ['GET', 'POST'],
  credentials: true
}));

// Initialize Socket.IO server with CORS configuration
const io = new Server(server, {
  cors: {
    origin: '*', // In production, you should specify allowed origins
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// API route for health check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'AI Socket.IO server is running',
    timestamp: new Date().toISOString()
  });
});

// Call Gemini AI API with enhanced network handling and fallback mode
async function callGeminiAI(message, imageData) {
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    console.log(`🔑 API Key (truncated): ${geminiApiKey ? geminiApiKey.substring(0, 5) + '...' + geminiApiKey.substring(geminiApiKey.length - 5) : 'undefined'}`);
    
    // Check for offline mode or simulation flag
    const offlineMode = process.env.AI_OFFLINE_MODE === 'true' || false;
    
    if (offlineMode) {
      console.log('🔌 Running in OFFLINE mode - using simulated AI responses');
      return simulateAiResponse(message, imageData);
    }

    // 添加网络连接检测和重试机制
    console.log('🌐 Testing network connectivity to Google API...');
    
    const modelName = 'gemini-1.5-pro-latest';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiApiKey}`;
    
    const parts = [{ text: message }];
    
    // Add image data if provided
    if (imageData && imageData.base64Data && imageData.mimeType) {
      parts.push({
        inline_data: {
          mime_type: imageData.mimeType,
          data: imageData.base64Data
        }
      });
      console.log('🖼️ Image included in Gemini API request');
    }
    
    const requestBody = {
      contents: [{ parts }]
    };
    
    console.log(`🔄 Sending request to Gemini API (model: ${modelName})`);
    console.log(`🔗 API URL: ${apiUrl}`);
    
    try {
      // 使用多重重试机制和更好的错误处理
      let lastError = null;
      const maxRetries = 2;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`🔄 尝试连接Gemini API (${attempt}/${maxRetries})`);
          
          const controller = new AbortController();
          const timeoutId = setTimeout(() => {
            console.log('⏰ 请求超时，取消连接');
            controller.abort();
          }, 20000);
          
          const response = await axios.post(apiUrl, requestBody, {
            headers: { 
              'Content-Type': 'application/json',
              'User-Agent': 'TelegramClone/1.0'
            },
            timeout: 20000,
            signal: controller.signal,
            validateStatus: function (status) {
              return status >= 200 && status < 500; // 允许更多状态码进行处理
            },
            // 添加代理和DNS配置（如果需要）
            // proxy: false,
            // family: 4, // 强制使用IPv4
          });
          
          clearTimeout(timeoutId);
          
          if (response.status >= 200 && response.status < 300) {
            const aiMessage = response.data?.candidates?.[0]?.content?.parts?.[0]?.text ||
                              '抱歉，我现在无法理解你的问题，请稍后再试。';
            
            console.log(`✅ Gemini API response received (${aiMessage.length} chars)`);
            return {
              message: aiMessage,
              success: true,
              timestamp: new Date().toISOString(),
              source: 'gemini-api'
            };
          } else {
            lastError = new Error(`API Error: ${response.status} ${response.statusText}`);
            console.error('❌ Gemini API error:', response.status, response.statusText);
            if (attempt === maxRetries) {
              console.log('⚠️ All retry attempts failed, falling back to simulated response');
              return simulateAiResponse(message, imageData);
            }
            continue;
          }
        } catch (retryError) {
          lastError = retryError;
          console.error(`❌ Attempt ${attempt} failed:`, retryError.message);
          
          if (attempt === maxRetries) {
            console.log('⚠️ All retry attempts exhausted, falling back to simulated response');
            return simulateAiResponse(message, imageData);
          }
          
          // 等待一段时间后重试
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    } catch (error) {
      console.error('❌ Error calling Gemini API:', error.message);
      console.log('⚠️ Falling back to simulated response due to error');
      return simulateAiResponse(message, imageData);
    }
  } catch (outerError) {
    console.error('❌ Critical error in callGeminiAI:', outerError.message);
    return simulateAiResponse(message, imageData);
  }
}

// Enhanced AI response simulation with more intelligent replies
function simulateAiResponse(message, imageData) {
  console.log('🤖 Generating enhanced simulated AI response');
  
  const lowerMessage = message.toLowerCase();
  let response = '';
  
  // 智能回复逻辑
  if (lowerMessage.includes('你好') || lowerMessage.includes('hello') || lowerMessage.includes('hi')) {
    response = '👋 你好！我是您的AI助手。虽然现在处于离线模式，但我仍然可以帮助您！\n\n我可以：\n• 回答一些基本问题\n• 进行简单对话\n• 提供使用建议\n\n有什么我可以帮助您的吗？';
  } else if (lowerMessage.includes('你是谁') || lowerMessage.includes('介绍') || lowerMessage.includes('who are you')) {
    response = '🤖 我是Telegram Clone的AI聊天助手！\n\n正常情况下我会连接到Google Gemini API为您提供强大的AI能力，但现在我处于离线模式。\n\n即使在离线模式下，我也能：\n• 进行基本对话\n• 回答简单问题\n• 提供应用使用帮助\n\n网络恢复后我就能提供更强大的AI功能了！';
  } else if (lowerMessage.includes('谢谢') || lowerMessage.includes('thank')) {
    response = '😊 不客气！很高兴能帮助您。\n\n虽然我现在处于离线模式，但为您服务依然是我的荣幸！如果还有其他问题，随时告诉我。';
  } else if (lowerMessage.includes('时间') || lowerMessage.includes('time')) {
    const now = new Date();
    response = `⏰ 当前时间是：${now.toLocaleString('zh-CN')}\n\n这是一个基本的时间查询功能，即使在离线模式下也能正常工作。`;
  } else if (lowerMessage.includes('天气') || lowerMessage.includes('weather')) {
    response = '🌤️ 抱歉，天气查询功能需要网络连接才能正常工作。\n\n请在网络恢复后重试，届时我就能为您提供准确的天气信息了。';
  } else if (lowerMessage.includes('帮助') || lowerMessage.includes('help')) {
    response = '📚 AI助手使用指南：\n\n在离线模式下，我可以：\n• 进行基本对话交流\n• 回答简单问题\n• 提供时间信息\n• 解答应用使用问题\n\n网络恢复后，我将提供：\n• 智能问答\n• 图片分析\n• 复杂推理\n• 创意生成\n\n输入 "/ai 你的问题" 来与我对话！';
  } else if (imageData) {
    response = '🖼️ 我看到您发送了一张图片！\n\n在正常连接模式下，我可以：\n• 分析图片内容\n• 识别物体和场景\n• 回答关于图片的问题\n• 提供图片描述\n\n现在由于网络问题，暂时无法处理图片。请稍后重试！';
  } else if (lowerMessage.includes('666') || lowerMessage.includes('测试')) {
    response = '✅ 测试成功！\n\n我收到了您的测试消息。AI助手正在正常运行，只是目前处于离线模式。\n\n系统状态：\n• Socket连接：正常\n• AI服务器：运行中\n• 网络状态：离线模式\n• 响应时间：<1秒';
  } else {
    response = `💭 我收到了您的消息："${message.length > 50 ? message.substring(0, 50) + '...' : message}"\n\n虽然现在处于离线模式，但我理解您想要交流！正常情况下我会基于Google Gemini AI为您提供智能回复。\n\n您可以尝试：\n• 问我时间\n• 说"你好"打招呼\n• 输入"帮助"查看功能\n\n网络恢复后我就能提供完整的AI能力了！`;
  }
  
  return {
    message: response,
    success: true,
    timestamp: new Date().toISOString(),
    source: 'enhanced-simulation',
    offline: true,
    networkStatus: 'Google API 无法访问，使用智能离线模式'
  };
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`🔌 New client connected: ${socket.id}`);
  
  // Handle authentication (simple version)
  socket.on('authenticate', (data) => {
    // In a real application, you would validate credentials here
    console.log(`🔐 Client ${socket.id} authentication:`, data);
    socket.emit('authenticated', { success: true, message: 'Authentication successful' });
  });
  
  // Handle AI chat messages
  socket.on('aiChat', async (data) => {
    const { message, imageData } = data;
    
    if (!message) {
      socket.emit('aiResponse', { 
        success: false, 
        message: '请提供有效的消息内容。',
        error: 'No message provided'
      });
      return;
    }
    
    console.log(`📨 Received message from client ${socket.id}: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`);
    
    // Notify client that we're processing the request
    socket.emit('aiTyping', { typing: true });
    
    try {
      // Call Gemini AI API
      const response = await callGeminiAI(message, imageData);
      
      // Send response back to client
      socket.emit('aiResponse', response);
      
      // Typing stopped
      socket.emit('aiTyping', { typing: false });
    } catch (error) {
      console.error('❌ Error processing AI request:', error);
      
      // Send error response to client
      socket.emit('aiResponse', {
        success: false,
        message: '处理您的请求时发生错误，请稍后再试。',
        error: error.message
      });
      
      // Typing stopped
      socket.emit('aiTyping', { typing: false });
    }
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
  });
});

// Set port and start server
const PORT = process.env.AI_SOCKET_PORT || 5850;
server.listen(PORT, () => {
  console.log(`
┌────────────────────────────────────────────────────┐
│  🤖 AI Socket.IO Server                            │
│  🚀 Running on port: ${PORT}                         │
│  ⏱️  Started at: ${new Date().toLocaleTimeString()}                 │
│  🔌 Socket.IO endpoint: ws://localhost:${PORT}        │
│  🩺 Health check: http://localhost:${PORT}/health     │
└────────────────────────────────────────────────────┘
`);
});

// Handle server errors
server.on('error', (error) => {
  console.error('❌ Server error:', error);
});

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down AI Socket.IO server...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
