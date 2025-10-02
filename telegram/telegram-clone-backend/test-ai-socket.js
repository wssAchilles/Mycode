// Test script for AI Socket.IO connection
const { io } = require('socket.io-client');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

console.log('🧪 Testing AI Socket.IO connection to localhost:5850');

// Create socket connection
const socket = io('http://localhost:5850', {
  transports: ['websocket', 'polling'],
  reconnectionAttempts: 3,
  timeout: 10000,
  autoConnect: true,
});

// Connection events
socket.on('connect', () => {
  console.log('✅ Connected to AI Socket.IO server');
  
  // Authenticate
  console.log('🔐 Sending authentication request...');
  socket.emit('authenticate', { token: 'ai-test-client' });
  
  // Send test message after 1 second
  setTimeout(() => {
    console.log('📨 Sending test message to AI...');
    socket.emit('aiChat', {
      message: '你好，我是测试脚本。请简单介绍一下你自己。'
    });
  }, 1000);
});

socket.on('authenticated', (data) => {
  console.log('🔐 Authentication response:', data);
});

socket.on('aiTyping', (data) => {
  console.log('⌨️ AI typing status:', data.typing ? 'typing...' : 'stopped typing');
});

socket.on('aiResponse', (data) => {
  console.log('📩 Received AI response:');
  console.log('-------------------------');
  console.log(data.message);
  console.log('-------------------------');
  console.log('Success:', data.success);
  console.log('Timestamp:', data.timestamp);
  
  // Disconnect after receiving response
  console.log('👋 Test completed, disconnecting in 2 seconds...');
  setTimeout(() => {
    socket.disconnect();
    console.log('🔌 Disconnected from server');
    process.exit(0);
  }, 2000);
});

socket.on('connect_error', (error) => {
  console.error('❌ Connection error:', error.message);
});

socket.on('disconnect', () => {
  console.log('🔌 Disconnected from AI Socket.IO server');
});

// Exit if no response after 20 seconds
setTimeout(() => {
  console.error('⏱️ Test timed out after 20 seconds');
  process.exit(1);
}, 20000);
