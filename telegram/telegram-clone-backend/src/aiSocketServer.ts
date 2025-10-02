import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import dotenv from 'dotenv';
import { callGeminiAI } from './controllers/aiController';

// Load environment variables
dotenv.config();

// Create Express app and HTTP server for AI Socket.IO
const app = express();
const httpServer = createServer(app);
const AI_PORT = Number(process.env.AI_SOCKET_PORT) || 5850;

// Set up CORS middleware for AI server
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Create Socket.IO server with CORS configuration
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:5173',
      'http://127.0.0.1:5173'
    ],
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'AI Socket.IO Server is running',
    timestamp: new Date().toISOString()
  });
});

// Handle socket connections
io.on('connection', (socket: Socket) => {
  console.log(`🤖 AI Socket.IO: New connection established - ${socket.id}`);

  // Handle authentication
  socket.on('authenticate', async (data: { token: string }) => {
    try {
      console.log(`🔐 AI Socket.IO: Authentication request from ${socket.id}`);
      // We don't need full authentication for AI socket, just acknowledge
      socket.emit('authenticated', { success: true });
    } catch (error) {
      console.error('❌ AI Socket.IO: Authentication failed:', error);
      socket.emit('authError', {
        type: 'error',
        message: 'Authentication failed'
      });
    }
  });

  // Handle AI chat messages
  socket.on('aiChat', async (data: { message: string; imageData?: { mimeType: string; base64Data: string } }) => {
    try {
      console.log(`📝 AI Socket.IO: Received AI chat message from ${socket.id}`);
      
      // Call Gemini API
      const aiResponse = await callGeminiAI(data.message, data.imageData);
      
      // Send response back to client
      socket.emit('aiResponse', {
        success: true,
        message: aiResponse,
        timestamp: new Date().toISOString()
      });
      
    } catch (error: any) {
      console.error('❌ AI Socket.IO: Error processing AI chat:', error);
      socket.emit('aiResponse', {
        success: false,
        error: error.message || 'Failed to process AI chat',
        timestamp: new Date().toISOString()
      });
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`🔌 AI Socket.IO: Client disconnected - ${socket.id}`);
  });
});

// Start the AI Socket.IO server
const startAiSocketServer = async () => {
  try {
    httpServer.listen(AI_PORT, () => {
      console.log('='.repeat(60));
      console.log(`🤖 AI Socket.IO Server started successfully!`);
      console.log(`🌍 AI Socket.IO Server running at: http://localhost:${AI_PORT}`);
      console.log(`🔌 AI WebSocket Server: ws://localhost:${AI_PORT}`);
      console.log(`📅 Started at: ${new Date().toISOString()}`);
      console.log('='.repeat(60));
    });
  } catch (error) {
    console.error('❌ Failed to start AI Socket.IO Server:', error);
  }
};

// Export server for importing in other modules
export { startAiSocketServer };

// Start server if this file is run directly
if (require.main === module) {
  startAiSocketServer();
}
