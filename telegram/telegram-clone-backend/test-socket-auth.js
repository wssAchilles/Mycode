// Test Socket.IO connection with authentication and AI chat functionality
const { io } = require('socket.io-client');
const dotenv = require('dotenv');

dotenv.config();

const MAIN_SOCKET_URL = 'http://localhost:5000';
const AI_SOCKET_URL = 'http://localhost:5850';

// JWT token from our authentication test
const JWT_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1NWU0MGM4My1kMjQyLTQ4ZTktOWE3ZC05ODk1ZmNlNjA2ZjQiLCJ1c2VybmFtZSI6ImFpX3Rlc3RfdXNlciIsImlhdCI6MTc1NDY2MTI5MSwiZXhwIjoxNzU1MjY2MDkxLCJhdWQiOiJ0ZWxlZ3JhbS1jbG9uZS11c2VycyIsImlzcyI6InRlbGVncmFtLWNsb25lIn0.1Mjf1ZlWCwlQ9qxzkQzN6WoxKNl6XWQ2vh1YLI84Ogw';

async function testMainSocketIO() {
  console.log('🔌 Testing main Socket.IO server authentication and AI chat...\n');
  
  // Connect to main Socket.IO server
  const mainSocket = io(MAIN_SOCKET_URL, {
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 3,
    timeout: 10000,
    autoConnect: true,
  });
  
  // Set up event listeners
  mainSocket.on('connect', () => {
    console.log('✅ Connected to main Socket.IO server');
    
    // Authenticate
    console.log('🔐 Sending authentication...');
    mainSocket.emit('authenticate', { token: JWT_TOKEN });
  });
  
  mainSocket.on('authenticated', (data) => {
    console.log('🔐 Authentication successful:', data);
    
    // Test AI chat message
    setTimeout(() => {
      console.log('🤖 Sending AI chat message through main Socket.IO...');
      mainSocket.emit('sendMessage', {
        content: '/ai 你好，我是测试脚本。请简单介绍一下你自己。',
        type: 'text',
        receiverId: 'ai',
        isGroupChat: false
      });
    }, 1000);
  });
  
  mainSocket.on('authError', (error) => {
    console.error('🔐 Authentication failed:', error);
  });
  
  mainSocket.on('message', (data) => {
    console.log('📩 Received message from main Socket.IO:');
    console.log('-------------------------');
    console.log('Type:', data.type);
    console.log('Content:', data.message || data.content || JSON.stringify(data, null, 2));
    console.log('-------------------------');
    
    // Disconnect after receiving response
    console.log('👋 Test completed, disconnecting in 2 seconds...');
    setTimeout(() => {
      mainSocket.disconnect();
      console.log('🔌 Disconnected from main Socket.IO server');
    }, 2000);
  });
  
  mainSocket.on('connect_error', (error) => {
    console.error('❌ Main Socket.IO connection error:', error.message);
  });
  
  mainSocket.on('disconnect', () => {
    console.log('🔌 Disconnected from main Socket.IO server');
  });
  
  // Exit if no response after 30 seconds
  setTimeout(() => {
    console.error('⏱️ Test timed out after 30 seconds');
    process.exit(1);
  }, 30000);
}

async function testAISocketIO() {
  console.log('\n🤖 Testing dedicated AI Socket.IO server...\n');
  
  // Connect to AI Socket.IO server
  const aiSocket = io(AI_SOCKET_URL, {
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 3,
    timeout: 10000,
    autoConnect: true,
  });
  
  // Set up event listeners
  aiSocket.on('connect', () => {
    console.log('✅ Connected to AI Socket.IO server');
    
    // Authenticate
    console.log('🔐 Sending authentication to AI server...');
    aiSocket.emit('authenticate', { token: 'ai-test-client' });
  });
  
  aiSocket.on('authenticated', (data) => {
    console.log('🔐 AI server authentication successful:', data);
    
    // Test AI chat message
    setTimeout(() => {
      console.log('🤖 Sending message to dedicated AI Socket.IO server...');
      aiSocket.emit('aiChat', {
        message: '你好，我是通过专用AI Socket.IO服务器连接的测试脚本。请介绍一下你自己。'
      });
    }, 1000);
  });
  
  aiSocket.on('aiResponse', (data) => {
    console.log('📩 Received response from AI Socket.IO server:');
    console.log('-------------------------');
    console.log('Success:', data.success);
    console.log('Message:', data.message);
    console.log('Source:', data.source || 'unknown');
    console.log('Timestamp:', data.timestamp);
    console.log('-------------------------');
    
    // Disconnect after receiving response
    console.log('👋 AI server test completed, disconnecting...');
    setTimeout(() => {
      aiSocket.disconnect();
      console.log('🔌 Disconnected from AI Socket.IO server');
      process.exit(0);
    }, 2000);
  });
  
  aiSocket.on('connect_error', (error) => {
    console.error('❌ AI Socket.IO connection error:', error.message);
  });
  
  aiSocket.on('disconnect', () => {
    console.log('🔌 Disconnected from AI Socket.IO server');
  });
}

// Run both tests
console.log('🧪 Starting Socket.IO authentication and AI chat tests...\n');
testMainSocketIO();

// Test AI Socket.IO after 5 seconds
setTimeout(() => {
  testAISocketIO();
}, 5000);
